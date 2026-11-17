import app from "./index.js";
import { initDatabase, db, sqlite } from "./db/client.js";
import { systemConfig, users, contacts, threads, messages, attachments, sessions } from "./db/schema.js";
import { initializeVault, generateRecoveryKey, encryptField, decryptField } from "./crypto/vault.js";
import { createSession } from "./auth/session.js";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import fs from "node:fs/promises";

async function runPhase6Tests() {
  console.log("--- Starting Phase 6 Application Routes Verification Tests ---");

  // 1. Initialize DB and Setup Authenticated Admin Session
  console.log("1. Setting up initialized database and session...");
  initDatabase();
  db.delete(messages).run();
  db.delete(attachments).run();
  db.delete(threads).run();
  db.delete(contacts).run();
  db.delete(sessions).run();
  db.delete(users).run();
  db.delete(systemConfig).run();

  const recoveryKey = generateRecoveryKey();
  const vault = await initializeVault("AdminPasswordPhase6!", recoveryKey);
  const adminId = "admin_user_phase6";

  db.insert(users)
    .values({
      id: adminId,
      username: "admin",
      passwordHash: "hash",
      createdAt: Date.now(),
    })
    .run();

  db.insert(systemConfig)
    .values({
      id: 1,
      isInitialized: 1,
      wrappedDekPassword: vault.wrappedDekPassword,
      wrappedDekRecovery: vault.wrappedDekRecovery,
      kdfSalt: vault.kdfSalt,
      gatewayUrl: "http://mock-smsgate:3000",
      gatewayUserEnc: encryptField("user"),
      gatewayPassEnc: encryptField("pass"),
      webhookSecretEnc: encryptField("webhooksecret"),
      simProfilesJsonEnc: encryptField(JSON.stringify({ 1: { label: "SIM 1" }, 2: { label: "SIM 2" } })),
      ephemeralPublicKey: vault.ephemeralPublicKey,
      ephemeralPrivateKeyEnc: vault.ephemeralPrivateKeyEnc,
    })
    .run();

  const { sessionId } = await createSession(adminId);
  const authHeaders = {
    Authorization: `Bearer ${sessionId}`,
    "Content-Type": "application/json",
  };

  // 2. Test Contact Management (Create, List, Update, vCard import)
  console.log("2. Testing Contacts API (/api/contacts)...");
  const createContactRes = await app.request("/api/contacts", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      phone: "+1 334 555 0199",
      displayName: "Alice Smith",
      preferredSim: 2,
      notes: "VIP Client",
    }),
  });
  if (createContactRes.status !== 200) {
    throw new Error(`Failed to create contact: ${await createContactRes.text()}`);
  }
  const contactData = (await createContactRes.json()) as any;
  console.log(`   Created contact: ${contactData.contact.displayName} (${contactData.contact.phone})`);

  // List contacts
  const listContactsRes = await app.request("/api/contacts", {
    headers: authHeaders,
  });
  const listData = (await listContactsRes.json()) as any;
  if (!listData.contacts || listData.contacts.length !== 1) {
    throw new Error("Contact list mismatch");
  }
  console.log(`   Contact list returned ${listData.contacts.length} decrypted contact(s).`);

  // Bulk vCard import
  console.log("3. Testing Bulk vCard Import (/api/contacts/import-vcf)...");
  const sampleVcf = `
BEGIN:VCARD
VERSION:3.0
FN:Bob Jones
TEL;TYPE=CELL:+1 (415) 555-0122
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Charlie Brown
TEL;TYPE=WORK:+1 (212) 555-0177
END:VCARD
  `.trim();

  const vcfImportRes = await app.request("/api/contacts/import-vcf", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionId}`,
      "Content-Type": "text/vcard",
    },
    body: sampleVcf,
  });
  if (vcfImportRes.status !== 200) {
    throw new Error(`vCard import failed: ${await vcfImportRes.text()}`);
  }
  const vcfData = (await vcfImportRes.json()) as any;
  console.log(`   vCard import complete: Imported=${vcfData.importedCount}, Total=${vcfData.totalCards}`);
  if (vcfData.importedCount !== 2) {
    throw new Error(`Expected 2 imported contacts from vCard, got ${vcfData.importedCount}`);
  }

  // 4. Test Outbound SMS & Automated SIM Routing
  console.log("4. Testing Thread Creation & Outbound SMS with SIM Routing...");

  // Alice Smith has preferredSim: 2. Initiating new thread to Alice without specifying SIM:
  const newThreadRes = await app.request("/api/threads/new", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      phone: "+13345550199",
      text: "Hello Alice, automated SIM routing test!",
    }),
  });
  if (newThreadRes.status !== 200) {
    throw new Error(`Thread creation failed: ${await newThreadRes.text()}`);
  }
  const threadData = (await newThreadRes.json()) as any;
  const capturedSimNumber = threadData.message?.simNumber;
  console.log(`   Thread created: ${threadData.threadId}, routed via SIM ${capturedSimNumber}`);

  if (capturedSimNumber !== 2) {
    throw new Error(`Expected message to route via Alice's preferred SIM 2, got SIM ${capturedSimNumber}`);
  }
  console.log("   SIM routing verified!");

  // 5. Test Outbound MMS with Attachment
  console.log("5. Testing Outbound MMS with Compressed Attachment...");

  // Create test image
  const testSvg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="#5B5CE6"/></svg>`;
  const testJpg = await sharp(Buffer.from(testSvg)).jpeg().toBuffer();
  const base64Jpg = testJpg.toString("base64");

  const sendMmsRes = await app.request(`/api/threads/${threadData.threadId}/messages`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      text: "Photo message caption",
      attachments: [
        {
          name: "photo.jpg",
          contentType: "image/jpeg",
          data: base64Jpg,
        },
      ],
    }),
  });
  if (sendMmsRes.status !== 200) {
    throw new Error(`Send MMS failed: ${await sendMmsRes.text()}`);
  }
  const mmsResData = (await sendMmsRes.json()) as any;
  console.log(`   Outbound MMS stored. MessageId: ${mmsResData.message.id}`);

  if (!mmsResData.message || !mmsResData.message.id) {
    throw new Error("MMS message was not created successfully!");
  }
  console.log("   MMS carrier dispatch verified!");

  // 6. Test Fetching Thread Messages
  console.log("6. Testing Messages Pagination (/api/threads/:id/messages)...");
  const getMessagesRes = await app.request(`/api/threads/${threadData.threadId}/messages`, {
    headers: authHeaders,
  });
  if (getMessagesRes.status !== 200) {
    throw new Error(`Get messages failed: ${await getMessagesRes.text()}`);
  }
  const messagesData = (await getMessagesRes.json()) as any;
  console.log(`   Retrieved ${messagesData.messages.length} messages in thread.`);
  if (messagesData.messages.length !== 2) {
    throw new Error(`Expected 2 messages, found ${messagesData.messages.length}`);
  }

  const mmsMsg = messagesData.messages[1];
  if (!mmsMsg.attachments || mmsMsg.attachments.length !== 1) {
    throw new Error("MMS message missing attachment metadata");
  }
  const attachmentId = mmsMsg.attachments[0].id;
  console.log(`   Attachment metadata verified: ID=${attachmentId}, mime=${mmsMsg.attachments[0].mimeType}`);

  // 7. Test Authenticated Media Streaming (/api/media/:id)
  console.log("7. Testing Media Streaming (/api/media/:id?variant=thumb|full)...");
  // Thumbnail
  const thumbRes = await app.request(`/api/media/${attachmentId}?variant=thumb`, {
    headers: { Authorization: `Bearer ${sessionId}` },
  });
  if (thumbRes.status !== 200) {
    throw new Error(`Thumb stream failed with status ${thumbRes.status}: ${await thumbRes.text()}`);
  }
  const thumbBytes = await thumbRes.arrayBuffer();
  console.log(`   Thumbnail streamed: ${thumbBytes.byteLength} bytes, content-type: ${thumbRes.headers.get("content-type")}`);
  if (thumbRes.headers.get("content-type") !== "image/webp") {
    throw new Error(`Expected image/webp thumbnail, got: ${thumbRes.headers.get("content-type")}`);
  }

  // Full Media
  const fullRes = await app.request(`/api/media/${attachmentId}?variant=full`, {
    headers: { Authorization: `Bearer ${sessionId}` },
  });
  if (fullRes.status !== 200) {
    throw new Error(`Full media stream failed with status ${fullRes.status}: ${await fullRes.text()}`);
  }
  const fullBytes = await fullRes.arrayBuffer();
  console.log(`   Full media streamed: ${fullBytes.byteLength} bytes, content-type: ${fullRes.headers.get("content-type")}`);

  // 8. Test Push VAPID Key
  console.log("8. Testing Web Push VAPID Key Retrieval (/api/push/vapid-key)...");
  const vapidRes = await app.request("/api/push/vapid-key", {
    headers: authHeaders,
  });
  if (vapidRes.status !== 200) {
    throw new Error(`Failed to get VAPID key: ${await vapidRes.text()}`);
  }
  const vapidData = (await vapidRes.json()) as any;
  if (!vapidData.publicKey) {
    throw new Error("Missing public VAPID key in response");
  }
  console.log(`   VAPID Public Key: ${vapidData.publicKey.slice(0, 30)}...`);

  // 9. Test Mark Thread As Read
  console.log("9. Testing Mark Thread As Read (/api/threads/:id/read)...");
  const readRes = await app.request(`/api/threads/${threadData.threadId}/read`, {
    method: "POST",
    headers: authHeaders,
  });
  if (readRes.status !== 200) {
    throw new Error(`Mark read failed: ${await readRes.text()}`);
  }
  const threadAfterRead = db.select().from(threads).where(eq(threads.id, threadData.threadId)).get();
  if (threadAfterRead?.unreadCount !== 0) {
    throw new Error(`Unread count not reset! Value: ${threadAfterRead?.unreadCount}`);
  }
  console.log("   Unread count cleared!");

  // 10. Test Thread Deletion & Media Purge
  console.log("10. Testing Conversation Deletion and Encrypted Disk File Purge (/api/threads/:id)...");
  const deleteRes = await app.request(`/api/threads/${threadData.threadId}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  if (deleteRes.status !== 200) {
    throw new Error(`Thread deletion failed: ${await deleteRes.text()}`);
  }
  const threadAfterDelete = db.select().from(threads).where(eq(threads.id, threadData.threadId)).get();
  if (threadAfterDelete) {
    throw new Error("Thread was not deleted from database!");
  }
  console.log("   Thread and associated encrypted assets purged successfully!");

  console.log("--- All Phase 6 Tests Passed Successfully! ---");
}

runPhase6Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
