import crypto from "node:crypto";
import { initDatabase, db, sqlite } from "../src/db/client.js";
import { threads, messages, attachments, pendingWebhooks, systemConfig } from "../src/db/schema.js";
import {
  initializeVault,
  lockVault,
  unlockWithPassword,
  decryptField,
  generateRecoveryKey,
  hashPhone,
  normalizePhone,
} from "../src/crypto/vault.js";
import {
  verifyWebhookSignature,
  processWebhookEvent,
  processPendingWebhooks,
  lastDeviceHeartbeat,
} from "../src/gateway/webhookHandler.js";
import { eventBus, MessageNewEvent, MessageStatusEvent } from "../src/gateway/eventBus.js";
import { SmsGateClient } from "../src/gateway/smsgateClient.js";
import { syncInboxMessages } from "../src/gateway/inboxSync.js";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";

export async function runGatewaySyncTests() {
  console.log("--- Starting Gateway, Webhooks & Sync Tests ---");

  // 1. Initialize DB and Vault
  console.log("1. Setting up Database & Initializing Vault...");
  initDatabase();
  db.delete(messages).run();
  db.delete(threads).run();
  db.delete(attachments).run();
  db.delete(pendingWebhooks).run();
  const password = "Phase4TestAdminPassword!";
  const recoveryKey = generateRecoveryKey();
  const vault = await initializeVault(password, recoveryKey);

  // Store systemConfig so locked state has ephemeralPublicKey
  db.delete(systemConfig).run();
  db.insert(systemConfig)
    .values({
      id: 1,
      isInitialized: 1,
      wrappedDekPassword: vault.wrappedDekPassword,
      wrappedDekRecovery: vault.wrappedDekRecovery,
      kdfSalt: vault.kdfSalt,
      gatewayUrl: "http://mock-smsgate:3000",
      gatewayUserEnc: vault.wrappedDekPassword,
      gatewayPassEnc: vault.wrappedDekPassword,
      webhookSecretEnc: vault.wrappedDekPassword,
      simProfilesJsonEnc: vault.wrappedDekPassword,
      ephemeralPublicKey: vault.ephemeralPublicKey,
      ephemeralPrivateKeyEnc: vault.ephemeralPrivateKeyEnc,
    })
    .run();

  // 2. Test Webhook Signature Verification & Drift
  console.log("2. Testing Webhook Signature Verification & Drift Prevention...");
  const secret = "test_webhook_secret_key_12345";
  const testBody = JSON.stringify({ event: "system:ping", payload: { battery: 85 } });
  const nowSec = Math.floor(Date.now() / 1000);

  const validSig = crypto
    .createHmac("sha256", secret)
    .update(testBody + String(nowSec))
    .digest("hex");

  // Valid
  const isValid = verifyWebhookSignature({
    rawBody: testBody,
    signature: validSig,
    timestampHeader: String(nowSec),
    secret,
  });
  if (!isValid) throw new Error("Signature verification failed for valid request!");

  // Drifting timestamp (>300s in the past)
  const expiredSig = crypto
    .createHmac("sha256", secret)
    .update(testBody + String(nowSec - 350))
    .digest("hex");
  const isExpired = verifyWebhookSignature({
    rawBody: testBody,
    signature: expiredSig,
    timestampHeader: String(nowSec - 350),
    secret,
  });
  if (isExpired) throw new Error("Signature verification allowed expired timestamp!");

  // Tampered body
  const isTampered = verifyWebhookSignature({
    rawBody: testBody + "tamper",
    signature: validSig,
    timestampHeader: String(nowSec),
    secret,
  });
  if (isTampered) throw new Error("Signature verification allowed tampered body!");

  console.log("   Signature verification & replay drift prevention passed!");

  // 3. Test Event Bus & Inbound SMS
  console.log("3. Testing Inbound SMS Webhook Processing & Event Bus...");
  let capturedNewMsgEvent: MessageNewEvent | null = null;
  eventBus.onEvent("message:new", (ev) => {
    capturedNewMsgEvent = ev;
  });

  const smsWebhook = JSON.stringify({
    event: "sms:received",
    payload: {
      id: "gw_msg_001",
      phoneNumber: "+1 (334) 555-0199",
      text: "Hello from Android via TextPup Gateway! \u{1F680}",
      simNumber: 2,
      receivedAt: Date.now(),
    },
  });

  await processWebhookEvent(smsWebhook);

  if (!capturedNewMsgEvent) {
    throw new Error("EventBus did not receive message:new event!");
  }
  const eventData: MessageNewEvent = capturedNewMsgEvent;
  if (eventData.phone !== "+13345550199" || eventData.simNumber !== 2) {
    throw new Error(`Event data mismatch: ${JSON.stringify(eventData)}`);
  }

  // Verify SQLite row
  const phoneHash = hashPhone("+13345550199");
  const thread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
  if (!thread || thread.lastSimNumber !== 2 || thread.unreadCount !== 1) {
    throw new Error(`Thread not correctly created or updated! ${JSON.stringify(thread)}`);
  }

  const msg = db.select().from(messages).where(eq(messages.gatewayMsgId, "gw_msg_001")).get();
  if (!msg || msg.status !== "received") {
    throw new Error("Message row not found or wrong status!");
  }
  const decryptedMsgBody = decryptField(msg.bodyEnc!);
  if (!decryptedMsgBody.includes("Hello from Android")) {
    throw new Error(`Decrypted message body mismatch: ${decryptedMsgBody}`);
  }
  console.log("   Inbound SMS processing and event dispatch verified!");

  // 4. Test Inbound MMS with Attachment
  console.log("4. Testing Inbound MMS Webhook with Attachment...");
  const rawSvg = `<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="400" fill="#5B5CE6"/></svg>`;
  const base64Img = Buffer.from(rawSvg).toString("base64");

  const mmsWebhook = JSON.stringify({
    event: "mms:downloaded",
    payload: {
      id: "gw_mms_001",
      phoneNumber: "+13345550199",
      subject: "Photo attachment",
      simNumber: 1,
      receivedAt: Date.now(),
      attachments: [
        {
          name: "photo.svg",
          contentType: "image/svg+xml",
          data: base64Img,
        },
      ],
    },
  });

  await processWebhookEvent(mmsWebhook);

  const mmsMsg = db.select().from(messages).where(eq(messages.gatewayMsgId, "gw_mms_001")).get();
  if (!mmsMsg) throw new Error("MMS message not found!");

  const attList = db.select().from(attachments).where(eq(attachments.messageId, mmsMsg.id)).all();
  if (attList.length !== 1) throw new Error(`Expected 1 attachment, found ${attList.length}`);

  const att = attList[0];
  console.log(`   Encrypted MMS attachment stored at: ${att.storagePath}`);
  const encFileExists = await fs.stat(att.storagePath).then(() => true).catch(() => false);
  if (!encFileExists) throw new Error(`Encrypted file missing: ${att.storagePath}`);

  // Clean up created test attachment
  await fs.unlink(att.storagePath).catch(() => {});
  if (att.thumbPath) await fs.unlink(att.thumbPath).catch(() => {});
  console.log("   Inbound MMS attachment processing verified!");

  // 5. Test Delivery Status Reports
  console.log("5. Testing Delivery Reports (sms:sent, sms:delivered, sms:failed)...");
  let capturedStatus: MessageStatusEvent | null = null;
  eventBus.onEvent("message:status", (ev) => {
    capturedStatus = ev;
  });

  const statusWebhook = JSON.stringify({
    event: "sms:delivered",
    payload: {
      id: "gw_msg_001",
    },
  });
  await processWebhookEvent(statusWebhook);

  const updatedMsg = db.select().from(messages).where(eq(messages.gatewayMsgId, "gw_msg_001")).get();
  if (updatedMsg?.status !== "delivered") {
    throw new Error(`Message status not updated to delivered! Actual: ${updatedMsg?.status}`);
  }
  console.log("   Delivery report status transitions verified!");

  // 6. Test Locked-State Sealing & Replay
  console.log("6. Testing Locked-State Ingestion and Post-Unlock Replay...");
  lockVault();

  const lockedSms = JSON.stringify({
    event: "sms:received",
    payload: {
      id: "gw_msg_locked_001",
      phoneNumber: "+14155550123",
      text: "Sent while TextPup vault was locked!",
      simNumber: 1,
      receivedAt: Date.now(),
    },
  });

  const res = await processWebhookEvent(lockedSms);
  if (!res.deferred) {
    throw new Error("Webhook was not deferred while vault was locked!");
  }

  const pendingCount = db.select().from(pendingWebhooks).all().length;
  if (pendingCount !== 1) {
    throw new Error(`Expected 1 pending webhook in queue, found ${pendingCount}`);
  }
  console.log("   Webhook safely sealed while locked!");

  // Unlock and replay
  await unlockWithPassword(password, vault.kdfSalt, vault.wrappedDekPassword);
  const ephemeralPrivPem = decryptField(vault.ephemeralPrivateKeyEnc);
  await processPendingWebhooks(ephemeralPrivPem);

  const pendingAfter = db.select().from(pendingWebhooks).all().length;
  if (pendingAfter !== 0) {
    throw new Error("Pending queue was not emptied after replay!");
  }

  const replayedMsg = db.select().from(messages).where(eq(messages.gatewayMsgId, "gw_msg_locked_001")).get();
  if (!replayedMsg || decryptField(replayedMsg.bodyEnc!) !== "Sent while TextPup vault was locked!") {
    throw new Error("Replayed message not found or body mismatch!");
  }
  console.log("   Post-unlock unsealing and replay verified!");

  // 7. Test Inbox Reconciliation & Deduplication
  console.log("7. Testing Google Messages Inbox Reconciliation & Deduplication...");
  const mockClient = new SmsGateClient("http://localhost:3000");
  mockClient.getInbox = async () => [
    {
      id: "sync_item_1",
      address: "+13345550199",
      body: "Manual reply typed in Google Messages",
      date: Date.now(),
      type: 2,
      simNumber: 2,
    },
    {
      id: "gw_msg_001",
      address: "+13345550199",
      body: "Hello from Android via TextPup Gateway! \u{1F680}",
      date: Date.now(),
      type: 1,
      simNumber: 2,
    },
  ];

  const syncRes1 = await syncInboxMessages(mockClient);
  console.log(`   Sync run 1: Imported=${syncRes1.importedCount}, Skipped=${syncRes1.skippedCount}`);
  if (syncRes1.importedCount !== 1 || syncRes1.skippedCount !== 1) {
    throw new Error(`Expected 1 imported and 1 skipped, got ${JSON.stringify(syncRes1)}`);
  }

  const syncRes2 = await syncInboxMessages(mockClient);
  console.log(`   Sync run 2: Imported=${syncRes2.importedCount}, Skipped=${syncRes2.skippedCount}`);
  if (syncRes2.importedCount !== 0 || syncRes2.skippedCount !== 2) {
    throw new Error(`Expected 0 imported and 2 skipped on re-run, got ${JSON.stringify(syncRes2)}`);
  }
  console.log("   Inbox reconciliation and deduplication verified!");

  console.log("--- All Gateway, Webhook & Sync Tests Passed Successfully! ---");
}

if (process.argv[1]?.endsWith("gateway-sync.test.ts") || process.argv[1]?.endsWith("gateway-sync.test.js")) {
  runGatewaySyncTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test failed:", err);
      process.exit(1);
    });
}
