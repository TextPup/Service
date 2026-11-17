import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema.js";

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const mediaDir = path.join(dataDir, "media");
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

const dbPath = path.join(dataDir, "textpup.db");

export const sqlite: SqliteDatabase = new Database(dbPath);


// Enable WAL mode, foreign keys, and busy timeout
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

/**
 * Initializes database tables using DDL to guarantee schema parity
 * regardless of external migration runners.
 */
export function initDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_initialized INTEGER NOT NULL DEFAULT 0,
      wrapped_dek_password TEXT,
      wrapped_dek_recovery TEXT,
      kdf_salt TEXT,
      gateway_url TEXT,
      gateway_user_enc TEXT,
      gateway_pass_enc TEXT,
      webhook_secret_enc TEXT,
      sim_profiles_json_enc TEXT,
      ephemeral_public_key TEXT,
      ephemeral_private_key_enc TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      totp_secret_enc TEXT,
      recovery_codes_hash_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL,
      transports TEXT,
      device_label TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      ip_prefix TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      phone_hash TEXT NOT NULL UNIQUE,
      phone_enc TEXT NOT NULL,
      display_name_enc TEXT NOT NULL,
      notes_enc TEXT,
      avatar_color TEXT NOT NULL,
      preferred_sim INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      phone_hash TEXT NOT NULL UNIQUE,
      phone_enc TEXT NOT NULL,
      contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
      last_sim_number INTEGER NOT NULL DEFAULT 1,
      last_preview_enc TEXT,
      last_thumb_attachment_id TEXT,
      last_message_at INTEGER NOT NULL,
      unread_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      gateway_msg_id TEXT UNIQUE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      sim_number INTEGER NOT NULL,
      body_enc TEXT,
      status TEXT NOT NULL,
      error_reason_enc TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      filename_enc TEXT,
      storage_path TEXT NOT NULL,
      iv_and_tag TEXT NOT NULL,
      thumb_path TEXT,
      thumb_iv_and_tag TEXT,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_webhooks (
      id TEXT PRIMARY KEY,
      sealed_payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export { dataDir, mediaDir, dbPath };
