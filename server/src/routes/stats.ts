import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { threads, messages, contacts, attachments, systemConfig } from "../db/schema.js";
import {
  isVaultUnlocked,
  decryptField,
  decryptFieldOrNull,
} from "../crypto/vault.js";
import { requireAuth, type AuthEnv } from "../auth/session.js";

export const statsRouter = new Hono<AuthEnv>();

statsRouter.use("*", requireAuth);

/**
 * GET /api/stats: High-level system statistics, dual-SIM metrics & telemetry
 */
statsRouter.get("/", async (c) => {
  const unlocked = isVaultUnlocked();

  // 1. Message counts
  const totalMessagesRow = sqlite.prepare("SELECT COUNT(*) as count FROM messages").get() as any;
  const inboundRow = sqlite.prepare("SELECT COUNT(*) as count FROM messages WHERE direction = 'inbound'").get() as any;
  const outboundRow = sqlite.prepare("SELECT COUNT(*) as count FROM messages WHERE direction = 'outbound'").get() as any;
  const sim1Row = sqlite.prepare("SELECT COUNT(*) as count FROM messages WHERE sim_number = 1").get() as any;
  const sim2Row = sqlite.prepare("SELECT COUNT(*) as count FROM messages WHERE sim_number = 2").get() as any;

  // 2. Threads and Contacts
  const totalThreadsRow = sqlite.prepare("SELECT COUNT(*) as count FROM threads").get() as any;
  const unreadThreadsRow = sqlite.prepare("SELECT COUNT(*) as count FROM threads WHERE unread_count > 0").get() as any;
  const totalContactsRow = sqlite.prepare("SELECT COUNT(*) as count FROM contacts").get() as any;

  // 3. Attachments & Media storage
  const mediaStatsRow = sqlite
    .prepare("SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as totalBytes FROM attachments")
    .get() as any;

  // 4. System config & SIM info
  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  let simProfiles: any = null;
  if (unlocked && config?.simProfilesJsonEnc) {
    try {
      const jsonStr = decryptField(config.simProfilesJsonEnc);
      simProfiles = JSON.parse(jsonStr);
    } catch {
      // fallback
    }
  }

  // 5. Recent message activity (decrypted if unlocked)
  let recentMessages: any[] = [];
  if (unlocked) {
    try {
      const rawRecents = db
        .select()
        .from(messages)
        .orderBy(desc(messages.createdAt))
        .limit(8)
        .all();

      recentMessages = rawRecents.map((m) => {
        let phone = "";
        let contactName: string | null = null;

        const th = db.select().from(threads).where(eq(threads.id, m.threadId)).get();
        if (th) {
          try {
            phone = decryptField(th.phoneEnc);
            if (th.contactId) {
              const ct = db.select().from(contacts).where(eq(contacts.id, th.contactId)).get();
              if (ct) contactName = decryptField(ct.displayNameEnc);
            }
          } catch {}
        }

        return {
          id: m.id,
          phone,
          contactName,
          direction: m.direction,
          simNumber: m.simNumber,
          body: decryptFieldOrNull(m.bodyEnc),
          createdAt: m.createdAt,
        };
      });
    } catch {}
  }

  return c.json({
    stats: {
      totalMessages: totalMessagesRow?.count || 0,
      inboundMessages: inboundRow?.count || 0,
      outboundMessages: outboundRow?.count || 0,
      sim1Messages: sim1Row?.count || 0,
      sim2Messages: sim2Row?.count || 0,
      totalThreads: totalThreadsRow?.count || 0,
      unreadThreads: unreadThreadsRow?.count || 0,
      totalContacts: totalContactsRow?.count || 0,
      totalAttachments: mediaStatsRow?.count || 0,
      mediaStorageBytes: mediaStatsRow?.totalBytes || 0,
      isVaultUnlocked: unlocked,
      gatewayUrl: config?.gatewayUrl || null,
      simProfiles,
      recentMessages,
    },
  });
});
