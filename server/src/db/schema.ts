import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";

export const systemConfig = sqliteTable("system_config", {
  id: integer("id").primaryKey(), // Constrained to 1
  isInitialized: integer("is_initialized").notNull().default(0),
  wrappedDekPassword: text("wrapped_dek_password"),
  wrappedDekRecovery: text("wrapped_dek_recovery"),
  kdfSalt: text("kdf_salt"),
  gatewayUrl: text("gateway_url"),
  gatewayUserEnc: text("gateway_user_enc"),
  gatewayPassEnc: text("gateway_pass_enc"),
  webhookSecretEnc: text("webhook_secret_enc"),
  simProfilesJsonEnc: text("sim_profiles_json_enc"),
  ephemeralPublicKey: text("ephemeral_public_key"),
  ephemeralPrivateKeyEnc: text("ephemeral_private_key_enc"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  recoveryCodesHashJson: text("recovery_codes_hash_json"),
  createdAt: integer("created_at").notNull(),
});

export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: blob("public_key", { mode: "buffer" }).notNull(),
  counter: integer("counter").notNull(),
  transports: text("transports"),
  deviceLabel: text("device_label"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  ipPrefix: text("ip_prefix"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  phoneHash: text("phone_hash").notNull().unique(),
  phoneEnc: text("phone_enc").notNull(),
  displayNameEnc: text("display_name_enc").notNull(),
  notesEnc: text("notes_enc"),
  avatarColor: text("avatar_color").notNull(),
  preferredSim: integer("preferred_sim"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  phoneHash: text("phone_hash").notNull().unique(),
  phoneEnc: text("phone_enc").notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  lastSimNumber: integer("last_sim_number").notNull().default(1),
  lastPreviewEnc: text("last_preview_enc"),
  lastThumbAttachmentId: text("last_thumb_attachment_id"),
  lastMessageAt: integer("last_message_at").notNull(),
  unreadCount: integer("unread_count").notNull().default(0),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  gatewayMsgId: text("gateway_msg_id").unique(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // "inbound" | "outbound"
  simNumber: integer("sim_number").notNull(),
  bodyEnc: text("body_enc"),
  status: text("status").notNull(), // "pending" | "sent" | "delivered" | "failed" | "received"
  errorReasonEnc: text("error_reason_enc"),
  createdAt: integer("created_at").notNull(),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "image" | "video" | "audio" | "document"
  mimeType: text("mime_type").notNull(),
  filenameEnc: text("filename_enc"),
  storagePath: text("storage_path").notNull(),
  ivAndTag: text("iv_and_tag").notNull(), // "ivHex:tagHex"
  thumbPath: text("thumb_path"),
  thumbIvAndTag: text("thumb_iv_and_tag"),
  width: integer("width"),
  height: integer("height"),
  sizeBytes: integer("size_bytes").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const pendingWebhooks = sqliteTable("pending_webhooks", {
  id: text("id").primaryKey(),
  sealedPayload: text("sealed_payload").notNull(),
  createdAt: integer("created_at").notNull(),
});
