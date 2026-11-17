import crypto from "node:crypto";
import argon2 from "argon2";

// Constants
const AES_GCM_IV_LEN = 12; // 96 bits for GCM
const AES_GCM_TAG_LEN = 16; // 128 bits
const DEK_BYTE_LEN = 32; // 256 bits

let activeDek: Buffer | null = null;
let activeEncKey: Buffer | null = null;
let activeHmacKey: Buffer | null = null;

/**
 * Normalizes a phone number to standard E.164 formatting.
 * Strips formatting characters, ensures leading '+'.
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.trim().replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    return cleaned;
  }
  // Standardize 10-digit US/NANP numbers if no country code provided
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+${cleaned}`;
  }
  return `+${cleaned}`;
}

/**
 * Generates a high-entropy recovery key (formatted as 32 hex/alphanumeric characters in 4-char groups).
 */
export function generateRecoveryKey(): string {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString("hex");
  return hex.match(/.{1,4}/g)?.join("-") || hex;
}

/**
 * Generates a 32-character random setup token.
 */
export function generateSetupToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Derives a 32-byte Password KEK using Argon2id with spec parameters:
 * memoryCost: 65536 (64MB), timeCost: 3, parallelism: 1
 */
export async function derivePasswordKek(password: string, salt: Buffer): Promise<Buffer> {
  const rawHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    salt,
    hashLength: 32,
    raw: true,
  });
  return Buffer.from(rawHash);
}

/**
 * Derives a 32-byte Recovery KEK from the recovery key string.
 */
export function deriveRecoveryKek(recoveryKey: string): Buffer {
  const normalized = recoveryKey.trim().replace(/-/g, "").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest();
}

/**
 * Encrypts a plaintext Buffer using AES-256-GCM.
 * Output format: "ivHex:authTagHex:ciphertextBase64"
 */
export function encryptWithKey(key: Buffer, plaintext: Buffer | string): string {
  const iv = crypto.randomBytes(AES_GCM_IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AES_GCM_TAG_LEN,
  });
  const dataBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf-8");
  const encrypted = Buffer.concat([cipher.update(dataBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts a string formatted as "ivHex:authTagHex:ciphertextBase64" using AES-256-GCM.
 */
export function decryptWithKey(key: Buffer, encryptedStr: string): Buffer {
  const parts = encryptedStr.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format, expected ivHex:authTagHex:cipherBase64");
  }
  const [ivHex, tagHex, cipherBase64] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherBase64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AES_GCM_TAG_LEN,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derives subkeys (enc_key and hmac_key) from the DEK using HKDF-SHA256.
 */
export function deriveSubkeysFromDek(dek: Buffer) {
  const encKeyRaw = crypto.hkdfSync(
    "sha256",
    dek,
    Buffer.alloc(0),
    Buffer.from("textpup-aes-256-gcm-enc", "utf-8"),
    32
  );
  const hmacKeyRaw = crypto.hkdfSync(
    "sha256",
    dek,
    Buffer.alloc(0),
    Buffer.from("textpup-hmac-sha256-blind-index", "utf-8"),
    32
  );

  activeDek = Buffer.from(dek);
  activeEncKey = Buffer.from(encKeyRaw);
  activeHmacKey = Buffer.from(hmacKeyRaw);
}

/**
 * Directly restores the active subkeys from a raw DEK.
 */
export function unlockWithRawDek(dek: Buffer): void {
  deriveSubkeysFromDek(dek);
}

/**
 * Initializes the cryptographic vault on Step 1 of onboarding.
 * Generates fresh DEK, derives Password KEK and Recovery KEK, wraps DEK,
 * and generates ephemeral X25519 keypair for locked-state sealing.
 */
export async function initializeVault(password: string, recoveryKey: string) {
  const salt = crypto.randomBytes(16);
  const passwordKek = await derivePasswordKek(password, salt);
  const recoveryKek = deriveRecoveryKek(recoveryKey);

  const dek = crypto.randomBytes(DEK_BYTE_LEN);
  const wrappedDekPassword = encryptWithKey(passwordKek, dek);
  const wrappedDekRecovery = encryptWithKey(recoveryKek, dek);

  // Generate ephemeral X25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const ephemeralPublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const ephemeralPrivateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  deriveSubkeysFromDek(dek);
  const ephemeralPrivateKeyEnc = encryptField(ephemeralPrivateKeyPem);

  return {
    dek,
    wrappedDekPassword,
    wrappedDekRecovery,
    kdfSalt: salt.toString("hex"),
    ephemeralPublicKey,
    ephemeralPrivateKeyEnc,
  };
}

/**
 * Unlocks the vault using the administrator password.
 */
export async function unlockWithPassword(
  password: string,
  kdfSaltHex: string,
  wrappedDekPassword: string
): Promise<boolean> {
  try {
    const salt = Buffer.from(kdfSaltHex, "hex");
    const passwordKek = await derivePasswordKek(password, salt);
    const dek = decryptWithKey(passwordKek, wrappedDekPassword);
    if (dek.length !== DEK_BYTE_LEN) {
      return false;
    }
    deriveSubkeysFromDek(dek);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlocks the vault using the recovery key.
 */
export function unlockWithRecovery(recoveryKey: string, wrappedDekRecovery: string): boolean {
  try {
    const recoveryKek = deriveRecoveryKek(recoveryKey);
    const dek = decryptWithKey(recoveryKek, wrappedDekRecovery);
    if (dek.length !== DEK_BYTE_LEN) {
      return false;
    }
    deriveSubkeysFromDek(dek);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the vault is unlocked in memory.
 */
export function isVaultUnlocked(): boolean {
  return activeDek !== null && activeEncKey !== null && activeHmacKey !== null;
}

/**
 * Locks the vault and wipes keys from active memory.
 */
export function lockVault(): void {
  if (activeDek) activeDek.fill(0);
  if (activeEncKey) activeEncKey.fill(0);
  if (activeHmacKey) activeHmacKey.fill(0);
  activeDek = null;
  activeEncKey = null;
  activeHmacKey = null;
}

/**
 * Returns the active enc_key for AES-256-GCM operations.
 */
export function getEncKey(): Buffer {
  if (!activeEncKey) {
    throw new Error("Vault is locked. Unlock the vault to access encryption keys.");
  }
  return activeEncKey;
}

/**
 * Returns the active hmac_key for blind indexing.
 */
export function getHmacKey(): Buffer {
  if (!activeHmacKey) {
    throw new Error("Vault is locked. Unlock the vault to access HMAC keys.");
  }
  return activeHmacKey;
}

/**
 * Encrypts a sensitive database field (contact, body, preview, token) using AES-256-GCM.
 */
export function encryptField(plaintext: string): string {
  const encKey = getEncKey();
  return encryptWithKey(encKey, plaintext);
}

/**
 * Decrypts a sensitive database field using AES-256-GCM.
 */
export function decryptField(encryptedStr: string): string {
  const encKey = getEncKey();
  return decryptWithKey(encKey, encryptedStr).toString("utf-8");
}

/**
 * Safely decrypts an encrypted field or returns null if input is null/empty.
 */
export function decryptFieldOrNull(encryptedStr: string | null | undefined): string | null {
  if (!encryptedStr) return null;
  try {
    return decryptField(encryptedStr);
  } catch {
    return null;
  }
}

/**
 * Computes deterministic HMAC-SHA256 blind index hash for normalized E.164 phone number.
 */
export function hashPhone(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  const hmacKey = getHmacKey();
  return crypto.createHmac("sha256", hmacKey).update(normalized).digest("hex");
}

/**
 * Seals an arbitrary string (e.g. incoming webhook payload) using an ephemeral sender
 * key and the server's public X25519 key while the vault is locked.
 * Format: "senderPubPemBase64:ivHex:tagHex:cipherBase64"
 */
export function sealPayload(payload: string, serverPublicPem: string): string {
  const serverPubKey = crypto.createPublicKey(serverPublicPem);
  const senderKeypair = crypto.generateKeyPairSync("x25519");
  const sharedSecret = crypto.diffieHellman({
    privateKey: senderKeypair.privateKey,
    publicKey: serverPubKey,
  });

  const sealKey = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), Buffer.from("textpup-webhook-seal"), 32)
  );

  const encrypted = encryptWithKey(sealKey, payload);
  const senderPubPem = senderKeypair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const senderPubBase64 = Buffer.from(senderPubPem, "utf-8").toString("base64");

  return `${senderPubBase64}:${encrypted}`;
}

/**
 * Unseals a sealed payload using the server's private X25519 key after vault unlock.
 */
export function unsealPayload(sealedStr: string, serverPrivatePem: string): string {
  const firstColon = sealedStr.indexOf(":");
  if (firstColon === -1) {
    throw new Error("Invalid sealed payload format");
  }

  const senderPubBase64 = sealedStr.slice(0, firstColon);
  const encryptedPart = sealedStr.slice(firstColon + 1);

  const senderPubPem = Buffer.from(senderPubBase64, "base64").toString("utf-8");
  const senderPubKey = crypto.createPublicKey(senderPubPem);
  const serverPrivKey = crypto.createPrivateKey(serverPrivatePem);

  const sharedSecret = crypto.diffieHellman({
    privateKey: serverPrivKey,
    publicKey: senderPubKey,
  });

  const sealKey = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, Buffer.alloc(0), Buffer.from("textpup-webhook-seal"), 32)
  );

  return decryptWithKey(sealKey, encryptedPart).toString("utf-8");
}
