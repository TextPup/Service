import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { getEncKey } from "./vault.js";
import { mediaDir } from "../db/client.js";

const AES_GCM_IV_LEN = 12;
const AES_GCM_TAG_LEN = 16;

export interface EncryptedMediaResult {
  storagePath: string; // Relative or absolute path to .enc file
  ivAndTag: string; // "ivHex:tagHex"
  sizeBytes: number;
}

/**
 * Encrypts a binary Buffer using AES-256-GCM and writes to /data/media/<fileId>.enc
 */
export async function encryptMediaBuffer(
  buffer: Buffer,
  fileId: string
): Promise<EncryptedMediaResult> {
  const encKey = getEncKey();
  const iv = crypto.randomBytes(AES_GCM_IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv, {
    authTagLength: AES_GCM_TAG_LEN,
  });

  const encryptedData = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const fileName = `${fileId}.enc`;
  const storagePath = path.join(mediaDir, fileName);

  await fs.promises.writeFile(storagePath, encryptedData);

  return {
    storagePath,
    ivAndTag: `${iv.toString("hex")}:${authTag.toString("hex")}`,
    sizeBytes: encryptedData.length,
  };
}

/**
 * Decrypts an encrypted media file and returns the plaintext Buffer.
 */
export async function decryptMediaFile(
  storagePath: string,
  ivAndTag: string
): Promise<Buffer> {
  const encKey = getEncKey();
  const [ivHex, tagHex] = ivAndTag.split(":");
  if (!ivHex || !tagHex) {
    throw new Error("Invalid ivAndTag format, expected 'ivHex:tagHex'");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");

  const encryptedData = await fs.promises.readFile(storagePath);

  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, iv, {
    authTagLength: AES_GCM_TAG_LEN,
  });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * Creates a decrypted Readable stream from an encrypted media file.
 */
export function createDecryptedMediaStream(
  storagePath: string,
  ivAndTag: string
): Readable {
  const encKey = getEncKey();
  const [ivHex, tagHex] = ivAndTag.split(":");
  if (!ivHex || !tagHex) {
    throw new Error("Invalid ivAndTag format, expected 'ivHex:tagHex'");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, iv, {
    authTagLength: AES_GCM_TAG_LEN,
  });
  decipher.setAuthTag(authTag);

  const readStream = fs.createReadStream(storagePath);
  return readStream.pipe(decipher);
}
