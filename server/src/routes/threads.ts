import { Hono } from "hono";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { eq, desc, and, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  threads,
  messages,
  attachments,
  contacts,
  systemConfig,
} from "../db/schema.js";
import {
  encryptField,
  decryptField,
  decryptFieldOrNull,
  hashPhone,
  normalizePhone,
  isVaultUnlocked,
} from "../crypto/vault.js";
import { encryptMediaBuffer } from "../crypto/mediaCrypto.js";
import { processOutboundMedia } from "../media/processor.js";
import { isHostConnected, sendHostCommand } from "../gateway/hostManager.js";
import { eventBus } from "../gateway/eventBus.js";
import { requireAuth, type AuthEnv } from "../auth/session.js";

export const threadsRouter = new Hono<AuthEnv>();
threadsRouter.use("*", requireAuth);

/**
 * POST /api/threads/sync & /import-history: Trigger inbox reconciliation from connected phone
 */
threadsRouter.post("/sync", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const sent = sendHostCommand({ action: "SYNC_HISTORY" });
  if (sent) {
    return c.json({ success: true, message: "Sync command sent to host phone" });
  }
  return c.json({ error: "TextPup Host phone is not connected" }, 503);
});

threadsRouter.post("/import-history", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const sent = sendHostCommand({ action: "SYNC_HISTORY" });
  if (sent) {
    return c.json({ success: true, message: "Sync command sent to host phone" });
  }
  return c.json({ error: "TextPup Host phone is not connected" }, 503);
});

/**
 * GET /api/threads: List conversation threads with decrypted previews and contact names
 */
threadsRouter.get("/", (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const rawThreads = db
    .select()
    .from(threads)
    .orderBy(desc(threads.lastMessageAt))
    .all();

  const result = rawThreads
    .map((th) => {
      try {
        const phone = decryptField(th.phoneEnc);
        const preview = decryptFieldOrNull(th.lastPreviewEnc);

        let displayName: string | null = null;
        let avatarColor: string = "#5B5CE6";

        if (th.contactId) {
          const ct = db.select().from(contacts).where(eq(contacts.id, th.contactId)).get();
          if (ct) {
            displayName = decryptField(ct.displayNameEnc);
            avatarColor = ct.avatarColor;
          }
        }

        return {
          id: th.id,
          phone,
          displayName,
          avatarColor,
          lastSimNumber: th.lastSimNumber,
          lastPreview: preview,
          lastThumbAttachmentId: th.lastThumbAttachmentId,
          lastMessageAt: th.lastMessageAt,
          unreadCount: th.unreadCount,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return c.json({ threads: result });
});

/**
 * GET /api/threads/:id/messages: Paginated messages with decrypted bodies and attachment metadata
 */
threadsRouter.get("/:id/messages", (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const threadId = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const before = Number(c.req.query("before"));

  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  let query = db
    .select()
    .from(messages)
    .where(
      before
        ? and(eq(messages.threadId, threadId), lt(messages.createdAt, before))
        : eq(messages.threadId, threadId)
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  const rawMessages = query.all();

  // Reverse so client receives chronological order
  rawMessages.reverse();

  const decryptedMessages = rawMessages.map((m) => {
    const rawAttachments = db
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, m.id))
      .all();

    const formattedAttachments = rawAttachments.map((att) => {
      let filename = "attachment";
      if (att.filenameEnc) {
        try {
          filename = decryptField(att.filenameEnc);
        } catch {
          // fallback
        }
      }

      return {
        id: att.id,
        kind: att.kind,
        mimeType: att.mimeType,
        filename,
        width: att.width,
        height: att.height,
        sizeBytes: att.sizeBytes,
        hasThumb: Boolean(att.thumbPath),
        thumbUrl: att.thumbPath ? `/api/media/${att.id}?variant=thumb` : null,
        mediaUrl: `/api/media/${att.id}?variant=full`,
      };
    });

    return {
      id: m.id,
      threadId: m.threadId,
      gatewayMsgId: m.gatewayMsgId,
      direction: m.direction,
      simNumber: m.simNumber,
      body: decryptFieldOrNull(m.bodyEnc),
      status: m.status,
      errorReason: decryptFieldOrNull(m.errorReasonEnc),
      createdAt: m.createdAt,
      attachments: formattedAttachments,
    };
  });

  return c.json({ messages: decryptedMessages });
});

/**
 * Shared message sender routine
 */
async function dispatchOutboundMessage({
  threadId,
  phone,
  text,
  requestedSim,
  rawAttachments = [],
}: {
  threadId: string;
  phone: string;
  text?: string;
  requestedSim?: number;
  rawAttachments?: Array<{ name: string; contentType: string; data: string }>;
}) {
  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) throw new Error("Thread not found");

  // Determine SIM slot via priority rules:
  // 1. Explicit request from composer (1 or 2)
  // 2. Contact's preferred SIM
  // 3. Thread's last SIM number
  let targetSim = requestedSim;
  if (!targetSim && thread.contactId) {
    const ct = db.select().from(contacts).where(eq(contacts.id, thread.contactId)).get();
    if (ct?.preferredSim) {
      targetSim = ct.preferredSim;
    }
  }
  if (!targetSim) {
    targetSim = thread.lastSimNumber || 1;
  }

  const now = Date.now();
  const messageId = crypto.randomUUID();
  let gatewayMsgId: string | null = null;
  let status: "pending" | "sent" | "delivered" | "failed" = "pending";
  let errorReason: string | null = null;

  // Process attachments if present
  const processedAttachments: Array<{
    id: string;
    kind: string;
    mimeType: string;
    filename: string;
    storagePath: string;
    ivAndTag: string;
    thumbPath: string | null;
    thumbIvAndTag: string | null;
    width?: number;
    height?: number;
    sizeBytes: number;
    base64Data: string;
  }> = [];

  let lastThumbId: string | null = null;

  for (const att of rawAttachments) {
    const rawBuffer = Buffer.from(att.data, "base64");
    const processed = await processOutboundMedia(rawBuffer, att.contentType);

    const attachmentId = crypto.randomUUID();
    const encResult = await encryptMediaBuffer(processed.compressedBuffer, attachmentId);

    let thumbPath: string | null = null;
    let thumbIvAndTag: string | null = null;
    if (processed.thumbBuffer) {
      const thumbEnc = await encryptMediaBuffer(processed.thumbBuffer, `thumb_${attachmentId}`);
      thumbPath = thumbEnc.storagePath;
      thumbIvAndTag = thumbEnc.ivAndTag;
      lastThumbId = attachmentId;
    }

    processedAttachments.push({
      id: attachmentId,
      kind: processed.kind,
      mimeType: processed.mimeType,
      filename: att.name || "attachment",
      storagePath: encResult.storagePath,
      ivAndTag: encResult.ivAndTag,
      thumbPath,
      thumbIvAndTag,
      width: processed.width,
      height: processed.height,
      sizeBytes: encResult.sizeBytes,
      base64Data: processed.compressedBuffer.toString("base64"),
    });
  }

  // Dispatch outbound message via connected TextPup Host companion phone
  const sent = sendHostCommand({
    action: "SEND_SMS",
    messageId,
    recipient: phone,
    body: text || "",
    simNumber: targetSim,
  });

  if (sent) {
    gatewayMsgId = `host_out_${messageId}`;
    status = "sent";
  } else {
    status = "failed";
    errorReason = "TextPup Host phone is not currently connected";
  }

  // Store message in SQLite
  db.insert(messages)
    .values({
      id: messageId,
      gatewayMsgId: gatewayMsgId || `out_${crypto.randomUUID()}`,
      threadId,
      direction: "outbound",
      simNumber: targetSim,
      bodyEnc: text ? encryptField(text) : null,
      status,
      errorReasonEnc: errorReason ? encryptField(errorReason) : null,
      createdAt: now,
    })
    .run();

  // Store attachments
  for (const pAtt of processedAttachments) {
    db.insert(attachments)
      .values({
        id: pAtt.id,
        messageId,
        kind: pAtt.kind,
        mimeType: pAtt.mimeType,
        filenameEnc: encryptField(pAtt.filename),
        storagePath: pAtt.storagePath,
        ivAndTag: pAtt.ivAndTag,
        thumbPath: pAtt.thumbPath,
        thumbIvAndTag: pAtt.thumbIvAndTag,
        width: pAtt.width,
        height: pAtt.height,
        sizeBytes: pAtt.sizeBytes,
      })
      .run();
  }

  // Update thread preview and last SIM
  const preview = text
    ? (text.length > 80 ? text.slice(0, 80) + "..." : text)
    : "[Attachment]";

  db.update(threads)
    .set({
      lastSimNumber: targetSim,
      lastPreviewEnc: encryptField(preview),
      lastMessageAt: now,
      lastThumbAttachmentId: lastThumbId || thread.lastThumbAttachmentId,
    })
    .where(eq(threads.id, threadId))
    .run();

  // Real-time broadcast
  eventBus.emitEvent("message:new", {
    messageId,
    threadId,
    phone,
    direction: "outbound",
    simNumber: targetSim,
    body: text || null,
    hasAttachment: processedAttachments.length > 0,
    createdAt: now,
  });
  eventBus.emitEvent("thread:update", threadId);

  return {
    id: messageId,
    threadId,
    direction: "outbound",
    simNumber: targetSim,
    body: text || null,
    status,
    errorReason,
    createdAt: now,
  };
}

/**
 * POST /api/threads/:id/messages: Send SMS or MMS to thread
 */
threadsRouter.post("/:id/messages", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const threadId = c.req.param("id");
  const thread = db.select().from(threads).where(eq(threads.id, threadId)).get();
  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const { text, simNumber, attachments: rawAttachments = [] } = body;

  if (!text && rawAttachments.length === 0) {
    return c.json({ error: "Message must contain text or attachments" }, 400);
  }

  const phone = decryptField(thread.phoneEnc);

  try {
    const msg = await dispatchOutboundMessage({
      threadId,
      phone,
      text,
      requestedSim: simNumber ? Number(simNumber) : undefined,
      rawAttachments,
    });
    return c.json({ message: msg });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to send message" }, 500);
  }
});

/**
 * POST /api/threads/new: Initiate new thread and dispatch first message
 */
threadsRouter.post("/new", async (c) => {
  if (!isVaultUnlocked()) {
    return c.json({ error: "Vault is locked" }, 423);
  }

  const body = await c.req.json().catch(() => ({}));
  const { phone, text, simNumber, attachments: rawAttachments = [] } = body;

  if (!phone) {
    return c.json({ error: "Phone number is required" }, 400);
  }

  const e164 = normalizePhone(phone);
  if (!e164) {
    return c.json({ error: "Invalid phone number format" }, 400);
  }

  const phoneHash = hashPhone(e164);
  const now = Date.now();

  // Find or create thread
  let thread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
  if (!thread) {
    const threadId = crypto.randomUUID();
    const contact = db.select().from(contacts).where(eq(contacts.phoneHash, phoneHash)).get();

    db.insert(threads)
      .values({
        id: threadId,
        phoneHash,
        phoneEnc: encryptField(e164),
        contactId: contact?.id,
        lastSimNumber: simNumber ? Number(simNumber) : 1,
        lastMessageAt: now,
        unreadCount: 0,
      })
      .run();

    thread = db.select().from(threads).where(eq(threads.id, threadId)).get()!;
  }

  let msg = null;
  if (text || rawAttachments.length > 0) {
    msg = await dispatchOutboundMessage({
      threadId: thread.id,
      phone: e164,
      text,
      requestedSim: simNumber ? Number(simNumber) : undefined,
      rawAttachments,
    });
  }

  return c.json({ threadId: thread.id, message: msg });
});

/**
 * POST /api/threads/:id/read: Clear unread count
 */
threadsRouter.post("/:id/read", (c) => {
  const id = c.req.param("id");
  db.update(threads).set({ unreadCount: 0 }).where(eq(threads.id, id)).run();
  eventBus.emitEvent("thread:update", id);
  return c.json({ success: true });
});

/**
 * DELETE /api/threads/:id: Purge conversation and encrypted files on disk
 */
threadsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const thread = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  // Find all attachments across messages in this thread and delete files
  const threadMessages = db.select().from(messages).where(eq(messages.threadId, id)).all();
  for (const m of threadMessages) {
    const atts = db.select().from(attachments).where(eq(attachments.messageId, m.id)).all();
    for (const a of atts) {
      if (a.storagePath) await fs.unlink(a.storagePath).catch(() => { });
      if (a.thumbPath) await fs.unlink(a.thumbPath).catch(() => { });
    }
  }

  db.delete(threads).where(eq(threads.id, id)).run();
  eventBus.emitEvent("thread:update", id);

  return c.json({ success: true });
});
