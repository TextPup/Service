import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  threads,
  messages,
  attachments,
  contacts,
  pendingWebhooks,
  systemConfig,
} from "../db/schema.js";
import {
  isVaultUnlocked,
  encryptField,
  hashPhone,
  normalizePhone,
  sealPayload,
  unsealPayload,
} from "../crypto/vault.js";
import { encryptMediaBuffer } from "../crypto/mediaCrypto.js";
import { processInboundMedia } from "../media/processor.js";
import { eventBus } from "./eventBus.js";

export interface WebhookVerificationParams {
  rawBody: string;
  signature: string | null | undefined;
  timestampHeader: string | null | undefined;
  secret: string;
}

/**
 * Validates the HMAC-SHA256 signature and timestamp drift of an incoming cellular radio gateway webhook.
 */
export function verifyWebhookSignature({
  rawBody,
  signature,
  timestampHeader,
  secret,
}: WebhookVerificationParams): boolean {
  if (!signature || !timestampHeader || !secret) {
    return false;
  }

  // Check timestamp drift: reject if |now - timestamp| > 300s
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number(timestampHeader);
  if (isNaN(ts) || Math.abs(nowSec - ts) > 300) {
    return false;
  }

  // Compute expected HMAC-SHA256 over rawBody + timestampHeader
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody + timestampHeader);
  const expectedSigHex = hmac.digest("hex");

  try {
    const sigBuf = Buffer.from(signature.trim(), "hex");
    const expBuf = Buffer.from(expectedSigHex, "hex");
    if (sigBuf.length !== expBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * In-memory device heartbeat state
 */
export let lastDeviceHeartbeat = {
  isOnline: true,
  lastPingAt: Date.now(),
  batteryPercent: undefined as number | undefined,
};

export interface InboundWebhookEvent {
  event: "sms:received" | "mms:downloaded" | "sms:sent" | "sms:delivered" | "sms:failed" | "system:ping";
  payload: any;
}

/**
 * Ingests a cellular radio gateway webhook event. If the crypto vault is locked,
 * seals the payload with the ephemeral public key and queues it in SQLite.
 */
export async function processWebhookEvent(rawBody: string): Promise<{ handled: boolean; deferred?: boolean }> {
  let parsed: InboundWebhookEvent;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid JSON in webhook payload");
  }

  // Handle system ping even if locked, updating memory heartbeat
  if (parsed.event === "system:ping") {
    lastDeviceHeartbeat = {
      isOnline: true,
      lastPingAt: Date.now(),
      batteryPercent: parsed.payload?.battery ?? parsed.payload?.batteryPercent,
    };
    eventBus.emitEvent("device:status", lastDeviceHeartbeat);
    return { handled: true };
  }

  // If vault is locked, seal payload immediately
  if (!isVaultUnlocked()) {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    if (config?.ephemeralPublicKey) {
      const sealed = sealPayload(rawBody, config.ephemeralPublicKey);
      db.insert(pendingWebhooks)
        .values({
          id: crypto.randomUUID(),
          sealedPayload: sealed,
          createdAt: Date.now(),
        })
        .run();
      console.log("Vault locked: Inbound webhook safely sealed to pending_webhooks queue.");
      return { handled: true, deferred: true };
    }
    throw new Error("Vault is locked and no ephemeral public key available to seal payload");
  }

  // Process live event with active vault keys
  await handleUnlockedEvent(parsed);
  return { handled: true };
}

/**
 * Handles decrypted/unlocked webhook events.
 */
async function handleUnlockedEvent(event: InboundWebhookEvent) {
  const { event: eventName, payload } = event;

  switch (eventName) {
    case "sms:received": {
      await handleSmsReceived(payload);
      break;
    }
    case "mms:downloaded": {
      await handleMmsDownloaded(payload);
      break;
    }
    case "sms:sent":
    case "sms:delivered":
    case "sms:failed": {
      await handleDeliveryStatus(eventName, payload);
      break;
    }
    default:
      console.log(`Unhandled webhook event: ${eventName}`);
  }
}

/**
 * Handles incoming SMS
 */
async function handleSmsReceived(payload: any) {
  const rawSender = payload.phoneNumber || payload.phone || payload.address || "";
  const e164 = normalizePhone(rawSender);
  if (!e164) {
    throw new Error("Missing or invalid phone number in sms:received");
  }

  const phoneHash = hashPhone(e164);
  const textBody = payload.text || payload.message || payload.body || "";
  const simNumber = Number(payload.simNumber) || 1;
  const timestamp = Number(payload.receivedAt || payload.timestamp || Date.now());
  const gatewayMsgId = payload.id || payload.messageId || `in_${crypto.randomUUID()}`;

  // Match contact if existing
  const existingContact = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();

  // Find or upsert thread
  let existingThread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
  const threadId = existingThread?.id || crypto.randomUUID();

  const preview = textBody.length > 80 ? textBody.slice(0, 80) + "..." : textBody;
  const previewEnc = encryptField(preview);

  if (existingThread) {
    db.update(threads)
      .set({
        lastSimNumber: simNumber,
        lastPreviewEnc: previewEnc,
        lastMessageAt: timestamp,
        unreadCount: (existingThread.unreadCount || 0) + 1,
        contactId: existingContact?.id ?? existingThread.contactId,
      })
      .where(eq(threads.id, threadId))
      .run();
  } else {
    db.insert(threads)
      .values({
        id: threadId,
        phoneHash,
        phoneEnc: encryptField(e164),
        contactId: existingContact?.id,
        lastSimNumber: simNumber,
        lastPreviewEnc: previewEnc,
        lastMessageAt: timestamp,
        unreadCount: 1,
      })
      .run();
  }

  // Insert message
  const messageId = crypto.randomUUID();
  db.insert(messages)
    .values({
      id: messageId,
      gatewayMsgId,
      threadId,
      direction: "inbound",
      simNumber,
      bodyEnc: encryptField(textBody),
      status: "received",
      createdAt: timestamp,
    })
    .run();

  // Emit real-time events
  eventBus.emitEvent("message:new", {
    messageId,
    threadId,
    phone: e164,
    direction: "inbound",
    simNumber,
    body: textBody,
    hasAttachment: false,
    createdAt: timestamp,
  });
  eventBus.emitEvent("thread:update", threadId);
}

/**
 * Handles incoming MMS with attachments
 */
async function handleMmsDownloaded(payload: any) {
  const rawSender = payload.phoneNumber || payload.phone || payload.address || "";
  const e164 = normalizePhone(rawSender);
  if (!e164) {
    throw new Error("Missing or invalid phone number in mms:downloaded");
  }

  const phoneHash = hashPhone(e164);
  const textBody = payload.text || payload.message || payload.subject || "";
  const simNumber = Number(payload.simNumber) || 1;
  const timestamp = Number(payload.receivedAt || payload.timestamp || Date.now());
  const gatewayMsgId = payload.id || payload.messageId || `in_${crypto.randomUUID()}`;

  const existingContact = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();

  let existingThread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
  const threadId = existingThread?.id || crypto.randomUUID();

  const preview = textBody ? (textBody.length > 80 ? textBody.slice(0, 80) + "..." : textBody) : "[Media Attachment]";
  const previewEnc = encryptField(preview);

  if (existingThread) {
    db.update(threads)
      .set({
        lastSimNumber: simNumber,
        lastPreviewEnc: previewEnc,
        lastMessageAt: timestamp,
        unreadCount: (existingThread.unreadCount || 0) + 1,
        contactId: existingContact?.id ?? existingThread.contactId,
      })
      .where(eq(threads.id, threadId))
      .run();
  } else {
    db.insert(threads)
      .values({
        id: threadId,
        phoneHash,
        phoneEnc: encryptField(e164),
        contactId: existingContact?.id,
        lastSimNumber: simNumber,
        lastPreviewEnc: previewEnc,
        lastMessageAt: timestamp,
        unreadCount: 1,
      })
      .run();
  }

  const messageId = crypto.randomUUID();
  db.insert(messages)
    .values({
      id: messageId,
      gatewayMsgId,
      threadId,
      direction: "inbound",
      simNumber,
      bodyEnc: textBody ? encryptField(textBody) : null,
      status: "received",
      createdAt: timestamp,
    })
    .run();

  // Process attachments
  const rawAttachments: any[] = payload.attachments || [];
  let lastThumbId: string | null = null;

  for (const att of rawAttachments) {
    const contentType = att.contentType || att.mimeType || "application/octet-stream";
    const filename = att.name || att.filename || "attachment";
    const rawDataBuf = Buffer.from(att.data || "", "base64");

    if (rawDataBuf.length === 0) continue;

    const attachmentId = crypto.randomUUID();
    const mediaMeta = await processInboundMedia(rawDataBuf, contentType);

    // Encrypt full attachment to /data/media/<uuid>.enc
    const fullEnc = await encryptMediaBuffer(rawDataBuf, attachmentId);

    // If thumbnail was generated, encrypt thumbnail
    let thumbPath: string | null = null;
    let thumbIvAndTag: string | null = null;
    if (mediaMeta.thumbBuffer) {
      const thumbEnc = await encryptMediaBuffer(mediaMeta.thumbBuffer, `thumb_${attachmentId}`);
      thumbPath = thumbEnc.storagePath;
      thumbIvAndTag = thumbEnc.ivAndTag;
      lastThumbId = attachmentId;
    }

    db.insert(attachments)
      .values({
        id: attachmentId,
        messageId,
        kind: mediaMeta.kind,
        mimeType: contentType,
        filenameEnc: encryptField(filename),
        storagePath: fullEnc.storagePath,
        ivAndTag: fullEnc.ivAndTag,
        thumbPath,
        thumbIvAndTag,
        width: mediaMeta.width,
        height: mediaMeta.height,
        sizeBytes: fullEnc.sizeBytes,
      })
      .run();
  }

  if (lastThumbId) {
    db.update(threads)
      .set({ lastThumbAttachmentId: lastThumbId })
      .where(eq(threads.id, threadId))
      .run();
  }

  eventBus.emitEvent("message:new", {
    messageId,
    threadId,
    phone: e164,
    direction: "inbound",
    simNumber,
    body: textBody,
    hasAttachment: rawAttachments.length > 0,
    createdAt: timestamp,
  });
  eventBus.emitEvent("thread:update", threadId);
}

/**
 * Handles outbound delivery status reports (sms:sent, sms:delivered, sms:failed)
 */
async function handleDeliveryStatus(eventName: string, payload: any) {
  const gatewayId = payload.id || payload.messageId;
  if (!gatewayId) return;

  const msg = db.select().from(messages).where(eq(messages.gatewayMsgId, gatewayId)).get();
  if (!msg) return;

  let newStatus: "pending" | "sent" | "delivered" | "failed" = "pending";
  let errorReason: string | null = null;

  if (eventName === "sms:sent") {
    newStatus = "sent";
  } else if (eventName === "sms:delivered") {
    newStatus = "delivered";
  } else if (eventName === "sms:failed") {
    newStatus = "failed";
    errorReason = payload.error || payload.reason || "Carrier dispatch failure";
  }

  db.update(messages)
    .set({
      status: newStatus,
      errorReasonEnc: errorReason ? encryptField(errorReason) : null,
    })
    .where(eq(messages.id, msg.id))
    .run();

  eventBus.emitEvent("message:status", {
    messageId: msg.id,
    threadId: msg.threadId,
    status: newStatus,
    errorReason,
  });
}

/**
 * Processes queued pending webhooks that were sealed while the vault was locked.
 * Called immediately upon unlocking the vault.
 */
export async function processPendingWebhooks(ephemeralPrivateKeyPem: string) {
  const pending = db.select().from(pendingWebhooks).all();
  if (pending.length === 0) return;

  console.log(`Replaying ${pending.length} pending webhook(s)...`);

  for (const item of pending) {
    try {
      const unsealedJson = unsealPayload(item.sealedPayload, ephemeralPrivateKeyPem);
      const event: InboundWebhookEvent = JSON.parse(unsealedJson);
      await handleUnlockedEvent(event);
      db.delete(pendingWebhooks).where(eq(pendingWebhooks.id, item.id)).run();
    } catch (err) {
      console.error(`Failed to replay pending webhook ${item.id}:`, err);
    }
  }

  console.log("All pending webhooks processed.");
}
