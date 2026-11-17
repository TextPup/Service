import { initDatabase, db, sqlite } from "../src/db/client.js";
import { systemConfig } from "../src/db/schema.js";
import {
  initializeVault,
  lockVault,
  unlockWithPassword,
  unlockWithRecovery,
  isVaultUnlocked,
  encryptField,
  decryptField,
  hashPhone,
  normalizePhone,
  sealPayload,
  unsealPayload,
  generateRecoveryKey,
} from "../src/crypto/vault.js";
import { encryptMediaBuffer, decryptMediaFile } from "../src/crypto/mediaCrypto.js";

export async function runCryptoVaultTests() {
  console.log("--- Starting Crypto Vault & Schema Tests ---");

  // 1. Initialize SQLite Database
  console.log("1. Initializing database schema...");
  initDatabase();
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  console.log("   Created tables:", tables.map((t) => t.name).join(", "));
  if (tables.length < 9) {
    throw new Error(`Expected at least 9 tables, found ${tables.length}`);
  }

  // 2. Initialize Crypto Vault
  console.log("2. Initializing Vault with Argon2id and Recovery Key...");
  const password = "SuperSecretAdminPassword123!";
  const recoveryKey = generateRecoveryKey();
  console.log(`   Generated Recovery Key: ${recoveryKey}`);

  const vaultInit = await initializeVault(password, recoveryKey);
  console.log("   Vault initialized successfully. Salt:", vaultInit.kdfSalt);

  // 3. Test Field Encryption & Decryption
  console.log("3. Testing AES-256-GCM Field Encryption & Decryption...");
  const sampleSecret = "Sensitive incoming SMS message text with emoji \u{1F436}";
  const encryptedField = encryptField(sampleSecret);
  console.log("   Ciphertext formatted string:", encryptedField);
  const decryptedField = decryptField(encryptedField);
  if (decryptedField !== sampleSecret) {
    throw new Error(`Decrypted text mismatch! Expected: ${sampleSecret}, Got: ${decryptedField}`);
  }
  console.log("   Field encryption and decryption verified!");

  // 4. Test Phone Normalization and Blind Indexing
  console.log("4. Testing Phone Normalization and HMAC-SHA256 Blind Indexing...");
  const rawPhones = [
    "(334) 555-0199",
    "+1 334-555-0199",
    "334.555.0199",
    "+13345550199",
  ];
  const normalizedPhones = rawPhones.map(normalizePhone);
  const hashes = rawPhones.map(hashPhone);
  console.log("   Normalized phones:", normalizedPhones);
  console.log("   Generated phone hashes:", hashes);

  // Check all hashes match the exact same deterministic hash
  const firstHash = hashes[0];
  if (!hashes.every((h) => h === firstHash)) {
    throw new Error("Phone hashes for equivalent numbers do not match!");
  }
  console.log("   Blind indexing determinism verified!");

  // 5. Test Media Encryption and Decryption
  console.log("5. Testing Media Encryption & Decryption to disk...");
  const testMediaBytes = Buffer.from("MOCK_JPEG_IMAGE_BINARY_DATA_BUFFER_12345");
  const mediaResult = await encryptMediaBuffer(testMediaBytes, "test-media-1");
  console.log("   Media written to:", mediaResult.storagePath, "Size:", mediaResult.sizeBytes);

  const decryptedMedia = await decryptMediaFile(mediaResult.storagePath, mediaResult.ivAndTag);
  if (!decryptedMedia.equals(testMediaBytes)) {
    throw new Error("Decrypted media bytes do not match original bytes!");
  }
  console.log("   Media encryption and decryption verified!");

  // 6. Test Locked-State Sealing & Unsealing
  console.log("6. Testing Locked-State Ephemeral Public-Key Sealing...");
  const webhookPayload = JSON.stringify({
    event: "sms:received",
    message: "Inbound webhook arrived while server was locked!",
    timestamp: Date.now(),
  });
  const sealed = sealPayload(webhookPayload, vaultInit.ephemeralPublicKey);
  console.log("   Sealed webhook string length:", sealed.length);

  // Lock vault
  lockVault();
  if (isVaultUnlocked()) {
    throw new Error("Vault should be locked!");
  }
  console.log("   Vault successfully locked. Active keys wiped from memory.");

  // Decrypt ephemeral private key after unlocking
  console.log("7. Unlocking Vault with Password...");
  const unlockSuccess = await unlockWithPassword(
    password,
    vaultInit.kdfSalt,
    vaultInit.wrappedDekPassword
  );
  if (!unlockSuccess || !isVaultUnlocked()) {
    throw new Error("Failed to unlock vault with password!");
  }
  console.log("   Vault unlocked with password!");

  // Unseal the sealed webhook
  const ephemeralPrivPem = decryptField(vaultInit.ephemeralPrivateKeyEnc);
  const unsealed = unsealPayload(sealed, ephemeralPrivPem);
  if (unsealed !== webhookPayload) {
    throw new Error("Unsealed payload does not match original webhook payload!");
  }
  console.log("   Sealed payload unsealed successfully after unlock!");

  // Test Unlock with Recovery Key
  console.log("8. Testing Unlock with Recovery Key...");
  lockVault();
  const unlockRecoverySuccess = unlockWithRecovery(recoveryKey, vaultInit.wrappedDekRecovery);
  if (!unlockRecoverySuccess || !isVaultUnlocked()) {
    throw new Error("Failed to unlock vault with recovery key!");
  }
  console.log("   Vault unlocked with recovery key!");

  console.log("--- All Crypto Vault Tests Passed Successfully! ---");
}

if (process.argv[1]?.endsWith("crypto-vault.test.ts") || process.argv[1]?.endsWith("crypto-vault.test.js")) {
  runCryptoVaultTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test failed:", err);
      process.exit(1);
    });
}
