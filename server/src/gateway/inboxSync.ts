import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { threads, messages, contacts } from "../db/schema.js";
import {
  isVaultUnlocked,
  encryptField,
  hashPhone,
  normalizePhone,
  decryptField,
} from "../crypto/vault.js";
import { SmsGateClient, GatewayInboxMessage } from "./smsgateClient.js";
import { eventBus } from "./eventBus.js";

let syncIntervalTimer: NodeJS.Timeout | null = null;
let isSyncRunning = false;

/**
 * Reconciles messages from SMSGate /3rdparty/v1/inbox to capture historical messages
 * and manually sent messages typed inside Google Messages on the host phone.
 */
export async function syncInboxMessages(
  client: SmsGateClient,
  options: { limit?: number; since?: number } = {}
): Promise<{ importedCount: number; skippedCount: number }> {
  if (!isVaultUnlocked()) {
    console.log("InboxSync: Skipping sync because vault is locked.");
    return { importedCount: 0, skippedCount: 0 };
  }

  let rawMessages: GatewayInboxMessage[] = [];
  try {
    rawMessages = await client.getInbox(options);
  } catch (err: any) {
    console.warn(`InboxSync: Could not fetch inbox from SMSGate: ${err.message}`);
    return { importedCount: 0, skippedCount: 0 };
  }

  let importedCount = 0;
  let skippedCount = 0;

  for (const item of rawMessages) {
    try {
      // In Local Server Mode, SMSGate returns:
      // sender, recipient, contentPreview / body / text, createdAt (ISO8601) or date (timestamp ms)
      const rawAddress = (item as any).sender || (item as any).address || (item as any).phone || "";
      const e164 = normalizePhone(rawAddress);
      if (!e164) {
        skippedCount++;
        continue;
      }

      const phoneHash = hashPhone(e164);
      const textBody =
        (item as any).contentPreview ??
        (item as any).body ??
        (item as any).text ??
        (item as any).message ??
        "";

      // In Local Server /inbox, items represent received inbound SMS unless specified
      const isOutbound =
        (item as any).type === 2 ||
        (item as any).type === "OUTBOX" ||
        (item as any).type === "SENT";
      const direction: "inbound" | "outbound" = isOutbound ? "outbound" : "inbound";
      const simNumber = Number(item.simNumber) || 1;

      let timestamp = Date.now();
      if ((item as any).createdAt) {
        timestamp = new Date((item as any).createdAt).getTime();
      } else if (item.date) {
        timestamp = Number(item.date);
      }

      const gatewayId = item.id || `sync_${timestamp}_${phoneHash.slice(0, 8)}`;

      // 1. Check if message with same gatewayMsgId exists
      const existingByGatewayId = db
        .select()
        .from(messages)
        .where(eq(messages.gatewayMsgId, gatewayId))
        .get();

      if (existingByGatewayId) {
        skippedCount++;
        continue;
      }

      // 2. Content & Timestamp Deduplication:
      // If thread exists, check if there's an existing message within +/- 3000ms with identical direction & body
      let existingThread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();

      if (existingThread) {
        const recentMessages = db
          .select()
          .from(messages)
          .where(eq(messages.threadId, existingThread.id))
          .all();

        const isDuplicate = recentMessages.some((m) => {
          if (m.direction !== direction) return false;
          if (Math.abs(m.createdAt - timestamp) > 3000) return false;
          const body = m.bodyEnc ? decryptField(m.bodyEnc) : "";
          return body === textBody;
        });

        if (isDuplicate) {
          skippedCount++;
          continue;
        }
      }

      // Upsert thread
      const existingContact = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();
      const threadId = existingThread?.id || crypto.randomUUID();
      const preview = textBody.length > 80 ? textBody.slice(0, 80) + "..." : textBody;
      const previewEnc = encryptField(preview);

      if (existingThread) {
        db.update(threads)
          .set({
            lastSimNumber: simNumber,
            lastPreviewEnc: previewEnc,
            lastMessageAt: Math.max(existingThread.lastMessageAt, timestamp),
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
            unreadCount: direction === "inbound" ? 1 : 0,
          })
          .run();
      }

      // Insert message
      const messageId = crypto.randomUUID();
      db.insert(messages)
        .values({
          id: messageId,
          gatewayMsgId: gatewayId,
          threadId,
          direction,
          simNumber,
          bodyEnc: encryptField(textBody),
          status: direction === "outbound" ? "delivered" : "received",
          createdAt: timestamp,
        })
        .run();

      importedCount++;

      // Dispatch event
      eventBus.emitEvent("message:new", {
        messageId,
        threadId,
        phone: e164,
        direction,
        simNumber,
        body: textBody,
        hasAttachment: false,
        createdAt: timestamp,
      });
      eventBus.emitEvent("thread:update", threadId);
    } catch (err) {
      console.error("InboxSync: Error processing message item:", err);
      skippedCount++;
    }
  }

  return { importedCount, skippedCount };
}

/**
 * Starts periodic background sync loop.
 */
export function startInboxSync(client: SmsGateClient, intervalMs = 60000) {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
  }

  console.log(`InboxSync: Starting background reconciliation every ${Math.round(intervalMs / 1000)}s`);

  syncIntervalTimer = setInterval(async () => {
    if (isSyncRunning) return;
    isSyncRunning = true;
    try {
      // Sync last 5 minutes of messages to reconcile host phone manual sends
      const since = Date.now() - intervalMs * 3;
      await syncInboxMessages(client, { since });
    } catch (err) {
      console.error("InboxSync: Background poll error:", err);
    } finally {
      isSyncRunning = false;
    }
  }, intervalMs);
}

/**
 * Stops background sync loop.
 */
export function stopInboxSync() {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
    syncIntervalTimer = null;
    console.log("InboxSync: Background reconciliation stopped.");
  }
}
