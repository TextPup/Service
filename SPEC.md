# TextPup — Technical Architecture & Implementation Specification

## 1. Project Overview & Core Objectives
**TextPup** is a self-hosted, multi-device, multi-SIM SMS/MMS web messenger and Progressive Web App (PWA) designed to bridge a dual-SIM Android host phone to desktop browsers and secondary mobile devices.

### Core Requirements
1. **Non-Intrusive Host Phone Coexistence:** The host Android phone runs the open-source **SMSGate** APK (`capcom6/android-sms-gateway`) alongside **Google Messages** (which remains the default SMS/RCS app). TextPup never requires replacing Google Messages on the host device.
2. **Full Multi-SIM Support:** Supports dual-SIM/eSIM discovery, per-thread and per-message SIM badges (`SIM 1` / `SIM 2`), automatic reply routing to the SIM that received the last message in a thread, and 1-tap SIM switching in the message composer.
3. **Rich SMS & MMS Media Support:** Sends and receives text, images, video, audio, and generic file attachments (`.vcf`, `.pdf`, etc.), with server-side carrier payload compression (`sharp` / `ffmpeg`) and encrypted thumbnail generation for fast conversation previews.
4. **Encrypted At-Rest Storage:** All sensitive SQLite fields (contacts, phone numbers, message bodies, previews) and all stored MMS media/thumbnails on disk are encrypted using `AES-256-GCM` with `HMAC-SHA256` blind indexes for fast lookups.
5. **Hardened Public-Facing Auth & First-Run Onboarding:** Features a bootstrap-token-locked first-run setup wizard, **Argon2id** password hashing, **WebAuthn Passkey** + **TOTP 2FA**, and `__Host-` `HttpOnly` session cookies safe for exposure behind a reverse proxy or Cloudflare Tunnel.
6. **Duxica-Inspired Responsive UI Kit & Branding:** Built with React, TypeScript, and Tailwind CSS following Duxica's Messenger UI Kit aesthetic (floating split-cards on desktop, full-bleed stack on mobile PWA, Light/Dark theme parity, asymmetric bubbles, pill controls) and the **TextPup** mascot icon (a friendly puppy holding a white speech bubble in its mouth against an electric indigo `#5B5CE6` / `#6366F1` background).

---

## 2. System Topology & Infrastructure

```text
┌──────────────────────────────────────────────────────────────────────┐
│ HOST ANDROID PHONE (Dual-SIM / eSIM)                                 │
│  ├── Google Messages (Remains Default SMS App; handles phone UI/RCS) │
│  └── SMSGate APK (capcom6/android-sms-gateway)                       │
│       • Permissions: SEND_SMS, RECEIVE_SMS, RECEIVE_MMS,             │
│         RECEIVE_WAP_PUSH, READ_SMS, READ_PHONE_STATE                 │
│       • Connects OUTBOUND to Private Server (/mobile/v1)             │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ LAN / Tailscale / Internal Docker Net
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DOCKER HOST (Single Compose Stack)                                   │
│  ├── 1. mariadb (mariadb:11) — Backing store for sms-gateway         │
│  ├── 2. sms-gateway (capcom6/sms-gateway:latest)                     │
│  │     • Runs in `private` mode gated by `GATEWAY__PRIVATE_TOKEN`    │
│  │     • Exposes `/3rdparty/v1/*` REST API & fires signed webhooks   │
│  └── 3. textpup (Hono + Bun/Node + SQLite + React PWA)               │
│        • Ingests webhooks, encrypts DB fields & MMS media (.enc)     │
│        • Compresses outbound MMS media (sharp / ffmpeg)              │
│        • Streams live updates over SSE (`streamSSE`) to clients      │
│        • Serves React PWA & handles Onboarding / Passkey / TOTP auth │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ HTTPS (Cloudflare Tunnel / Reverse Proxy)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENT DEVICES (Desktop Browsers & Secondary Android Phone PWA)      │
│  • Responsive Duxica-styled UI, SIM 1/2 badges, VAPID Web Push       │
└──────────────────────────────────────────────────────────────────────┘
```

### Android Coexistence & Sync Rules

* **Do Not Claim Default SMS App:** SMSGate operates strictly via runtime permissions (`SEND_SMS`, `RECEIVE_SMS`, `RECEIVE_MMS`, `RECEIVE_WAP_PUSH`, `READ_SMS`, `READ_PHONE_STATE`).
* **Inbound & Outbound Mirroring:** Incoming SMS/MMS trigger both Google Messages and SMSGate simultaneously. Outbound messages sent via SMSGate are written by Android into `content://sms`, appearing in Google Messages automatically.
* **Background Reconciliation:** Because manual replies typed directly inside Google Messages on the host phone do not fire outbound SMSGate webhooks, TextPup runs a configurable background poll (`GET /3rdparty/v1/inbox`, e.g., every 60 seconds) to import any manually sent messages deduplicated by timestamp/sender/body hash.
* **RCS Limitation:** End-to-end encrypted RCS messages stay inside Google Messages' private database and are outside the scope of Android's SMS/MMS bridge.

---

## 3. Repository & Directory Structure

```text
textpup/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── server/
│   ├── src/
│   │   ├── index.ts                 # Hono app entry, middleware, static PWA serving
│   │   ├── db/
│   │   │   ├── client.ts            # SQLite connection (WAL mode enabled)
│   │   │   └── schema.ts            # Drizzle ORM table definitions
│   │   ├── crypto/
│   │   │   ├── vault.ts             # DEK/KEK wrapping, HKDF subkey derivation, AES-256-GCM, HMAC-SHA256
│   │   │   └── mediaCrypto.ts       # Streaming file encryption/decryption for /data/media/*.enc
│   │   ├── gateway/
│   │   │   ├── smsgateClient.ts     # Typed HTTP client for /3rdparty/v1/*
│   │   │   ├── webhookHandler.ts    # HMAC-SHA256 signature verification + event processor
│   │   │   └── inboxSync.ts         # Initial backfill & periodic Google Messages reconciliation
│   │   ├── media/
│   │   │   └── processor.ts         # sharp (EXIF strip, <750KB JPEG, 240px WebP thumb) + ffmpeg (video/poster)
│   │   ├── auth/
│   │   │   ├── setup.ts             # First-run onboarding wizard routes (gated by SETUP_TOKEN)
│   │   │   ├── session.ts           # Argon2id, __Host-sid cookies, rate limiting, session management
│   │   │   ├── webauthn.ts          # @simplewebauthn/server passkey registration & login
│   │   │   └── totp.ts              # TOTP secret generation, QR URI, verification, recovery codes
│   │   ├── routes/
│   │   │   ├── threads.ts           # Thread list, message pagination, send SMS/MMS, mark read
│   │   │   ├── contacts.ts          # Encrypted Contact CRUD + .vcf (vCard) bulk import
│   │   │   ├── media.ts             # Authenticated /api/media/:id?variant=thumb|full streaming
│   │   │   ├── push.ts              # VAPID Web Push subscription & dispatch
│   │   │   └── events.ts            # Hono streamSSE real-time event broadcaster
├── web/
│   ├── public/
│   │   ├── manifest.json            # PWA manifest (standalone, theme_color #5B5CE6)
│   │   ├── sw.js                    # Service worker for offline shell & VAPID push notifications
│   │   └── icons/                   # icon-192.png, icon-512.png, icon-512-maskable.png, favicon.svg
│   └── src/
│       ├── styles/tokens.css        # Duxica Light & Dark CSS custom properties
│       ├── components/kit/          # Duxica-styled UI components (AppShell, ThreadCard, MessageBubble, PillComposer, etc.)
│       ├── pages/
│       │   ├── SetupWizard.tsx      # 3-step first-run onboarding flow
│       │   ├── LoginPage.tsx        # Password + Passkey/TOTP authentication screen
│       │   ├── MessengerView.tsx    # Responsive desktop 3-zone / mobile stack chat view
│       │   ├── ContactsView.tsx     # Encrypted contact directory + .vcf importer
│       │   └── SettingsView.tsx     # SIM labels/colors, device health, active sessions, 2FA management
```

---

## 4. Docker Compose Stack (`docker-compose.yml`)

```yaml
services:
  mariadb:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD}
      MARIADB_DATABASE: smsgateway
      MARIADB_USER: smsgateway
      MARIADB_PASSWORD: ${MARIADB_PASSWORD}
    volumes:
      - smsgate_db:/var/lib/mysql
    networks:
      - textpup_internal

  sms-gateway:
    image: capcom6/sms-gateway:latest
    restart: unless-stopped
    depends_on:
      - mariadb
    ports:
      - "3000:3000" # Accessible on LAN/Tailscale for host Android APK (/mobile/v1)
    environment:
      HTTP__LISTEN: "0.0.0.0:3000"
      DATABASE__DRIVER: "mysql"
      DATABASE__HOST: "mariadb"
      DATABASE__PORT: "3306"
      DATABASE__USER: "smsgateway"
      DATABASE__PASSWORD: ${MARIADB_PASSWORD}
      DATABASE__NAME: "smsgateway"
      GATEWAY__MODE: "private"
      GATEWAY__PRIVATE_TOKEN: ${GATEWAY_PRIVATE_TOKEN}
    networks:
      - textpup_internal

  textpup:
    build: .
    restart: unless-stopped
    depends_on:
      - sms-gateway
    ports:
      - "8080:8080" # Expose via reverse proxy / Cloudflare Tunnel
    environment:
      PORT: "8080"
      DATA_DIR: "/data"
      APP_SETUP_TOKEN: ${APP_SETUP_TOKEN:-} # Optional; auto-generated & logged on boot if blank
      RP_ID: ${RP_ID:-localhost}            # WebAuthn Relying Party domain (e.g., sms.example.com)
      RP_ORIGIN: ${RP_ORIGIN:-http://localhost:8080}
    volumes:
      - textpup_data:/data
    networks:
      - textpup_internal

volumes:
  smsgate_db:
  textpup_data:

networks:
  textpup_internal:
    driver: bridge
```

---

## 5. SMSGate (`capcom6/android-sms-gateway`) Integration Contract

### 5.1 Outbound REST API Endpoints (`/3rdparty/v1`)

Authenticate using `Authorization: Basic base64(gateway_user:gateway_pass)`.

1. **Device & Multi-SIM Discovery:** `GET /3rdparty/v1/devices`
* Parses `sims[]` (`slotIndex`, `simNumber` `1|2`, `carrierName`, `phoneNumber`, `iccid`) and device online status.

2. **Send SMS:** `POST /3rdparty/v1/messages`
```json
{
  "phoneNumbers": ["+13345550199"],
  "textMessage": { "text": "Hello from TextPup" },
  "simNumber": 1,
  "withDeliveryReport": true
}
```

3. **Send MMS (Images, Video, Audio, Files):** `POST /3rdparty/v1/messages`
```json
{
  "phoneNumbers": ["+13345550199"],
  "mmsMessage": {
    "subject": "",
    "text": "Optional caption",
    "attachments": [
      {
        "contentType": "image/jpeg",
        "data": "<base64-encoded-bytes>",
        "name": "attachment.jpg"
      }
    ]
  },
  "simNumber": 2,
  "withDeliveryReport": true
}
```

4. **Webhook Management:**
* `GET /3rdparty/v1/webhooks`
* `POST /3rdparty/v1/webhooks` with `{ "url": "http://textpup:8080/api/webhooks/smsgate", "event": "<event_name>" }`
* `DELETE /3rdparty/v1/webhooks/:id`
* Register for all 6 events: `sms:received`, `mms:downloaded`, `sms:sent`, `sms:delivered`, `sms:failed`, `system:ping`.

5. **Inbox History Sync:** `GET /3rdparty/v1/inbox`
* Queries existing SMS/MMS on the host phone (`READ_SMS` permission) for initial backfill and periodic Google Messages outbound reconciliation.

### 5.2 Inbound Webhook Verification & Event Handling (`POST /api/webhooks/smsgate`)

* **Signature Verification:** Verify `X-Signature` (HMAC-SHA256 over `rawBody + X-Timestamp` using `webhook_secret`) and reject requests where `|now - X-Timestamp| > 300s`.
* **Event Handlers:**
* `sms:received`: Normalize sender to E.164 -> compute `phone_hash` -> upsert `threads` (updating `last_sim_number = payload.simNumber`) -> encrypt body -> insert `messages` -> emit SSE `message:new` + trigger VAPID Web Push.
* `mms:downloaded`: Same thread/message upsert + iterate `payload.attachments[]` -> generate encrypted `240px` WebP thumbnail (for images/videos) -> encrypt full attachment binary to `/data/media/<uuid>.enc` -> store metadata in `attachments` -> link `threads.last_thumb_attachment_id` -> emit SSE `message:new` + Web Push.
* `sms:sent` / `sms:delivered` / `sms:failed`: Match `gateway_msg_id` -> update `messages.status` (and encrypted `error_reason_enc` if failed) -> emit SSE `message:status`.
* `system:ping`: Update in-memory `lastDevicePingAt` timestamp and emit SSE `device:status`.

---

## 6. Encryption & SQLite Database Schema

### 6.1 Cryptographic Design (`server/src/crypto/vault.ts`)

* **Key Hierarchy:**
* **DEK (Data Encryption Key):** 256-bit random key generated during Step 1 of onboarding.
* **Password KEK:** Derived from admin password via **Argon2id** (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`). Encrypts DEK into `wrapped_dek_password`.
* **Recovery KEK:** Derived from a 24-word/32-char recovery key shown once during setup. Encrypts DEK into `wrapped_dek_recovery` (enables password resets without losing encrypted history).
* **Subkeys (HKDF-SHA256 from DEK):**
* `enc_key`: Used with `AES-256-GCM` + fresh 12-byte random IV per encrypted string or file (`ivHex:authTagHex:cipherBase64`).
* `hmac_key`: Used with `HMAC-SHA256` to produce deterministic `phone_hash` values from normalized E.164 phone numbers.

* **Vault Lock State:** If the container restarts, the server boots in a `locked` state (still ingesting webhooks into a small encrypted-to-public-key staging queue or holding DEK if configured, or unlocking immediately on admin login). *Implementation detail:* Generate an ephemeral X25519/RSA public key stored in `system_config` so incoming webhooks arriving while the vault is locked are sealed immediately on arrival and unwrapped into the main SQLite tables as soon as the admin unlocks the session.

### 6.2 SQLite Schema (`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`)

```sql
CREATE TABLE system_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_initialized INTEGER NOT NULL DEFAULT 0,
  wrapped_dek_password TEXT NOT NULL,
  wrapped_dek_recovery TEXT NOT NULL,
  kdf_salt TEXT NOT NULL,
  gateway_url TEXT NOT NULL,
  gateway_user_enc TEXT NOT NULL,
  gateway_pass_enc TEXT NOT NULL,
  webhook_secret_enc TEXT NOT NULL,
  sim_profiles_json_enc TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT,
  recovery_codes_hash_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  device_label TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_prefix TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE contacts (
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

CREATE TABLE threads (
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

CREATE TABLE messages (
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

CREATE TABLE attachments (
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

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

---

## 7. Media Processing & Carrier Compression Rules (`server/src/media/processor.ts`)

1. **Outbound Image Pipeline (`sharp`):**
* Strip all EXIF/GPS metadata automatically.
* Resize images exceeding `1600px` on their longest edge and iteratively encode JPEG (`quality: 82` -> `65`) until byte size is **`<= 750 KB`** so mobile carriers accept the MMS reliably.
* Generate a `240px` wide WebP thumbnail (`quality: 60`) for UI previews.

2. **Outbound Video Pipeline (`ffmpeg`):**
* Transcode videos exceeding `850 KB` to `360p` (or `480p` for short clips) H.264 Baseline MP4 + AAC mono audio constrained to fit under **`850 KB`**.
* Extract frame `00:00:01` as a `240px` wide WebP poster thumbnail.

3. **Audio & Document Attachments (`audio/*`, `text/vcard`, `application/pdf`):**
* Enforce a configurable hard upload ceiling (default `1 MB` per carrier MMS rules) and store encrypted on disk with original MIME type and encrypted filename.

---

## 8. First-Run Onboarding & Public Security Architecture

### 8.1 First-Run Onboarding Wizard (`/setup`)

* **Bootstrap Gate:** When `is_initialized === 0`, Hono generates a 32-character `SETUP_TOKEN` (unless `APP_SETUP_TOKEN` is set in env) and logs it to stdout. Every `/api/setup/*` call validates `X-Setup-Token` using `crypto.timingSafeEqual`.
* **Step 1 — Vault & Admin Creation:** Validates `SETUP_TOKEN`, creates admin user with **Argon2id**, initializes the 256-bit DEK, and outputs the single-use recovery key + 8 recovery codes.
* **Step 2 — Mandatory 2FA Setup:** Enrolls a **WebAuthn Passkey** (`@simplewebauthn/server`) and/or **TOTP Authenticator** app (`otpauth` + QR code). Setup cannot finalize without at least one 2FA method enrolled.
* **Step 3 — SMSGate Pairing & SIM Calibration:** Accepts `gateway_url` (default `http://sms-gateway:3000`), `gateway_user`, and `gateway_pass`; calls `GET /3rdparty/v1/devices` to detect SIM 1 and SIM 2; lets the user name/color each SIM; registers all 6 SMSGate webhooks; triggers initial `GET /3rdparty/v1/inbox` import; sets `is_initialized = 1`; and **permanently disables `/api/setup/*` (`404 Not Found`)**.

### 8.2 Hardened Session & Edge Controls

* **Session Cookies:** `__Host-sid` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`), backed by SQLite `sessions` table with sliding 7-day / max 30-day expiration and active session list/revocation in Settings.
* **Rate Limiting & Headers:** Sliding-window rate limiter on `/api/auth/login` (5 attempts per 60s per IP + exponential lockout), Hono `secureHeaders()` with strict CSP (`default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:`), and full compatibility with **Cloudflare Tunnel + Cloudflare Access**.

---

## 9. Frontend UI Kit & Branding Specification (Duxica Aesthetic)

### 9.1 Design Tokens (`web/src/styles/tokens.css`)

```css
:root {
  --bg-app: #F4F6FA;
  --bg-sidebar: #FFFFFF;
  --bg-canvas: #F8FAFC;
  --bg-bubble-in: #FFFFFF;
  --bg-input: #F1F5F9;
  --text-primary: #0F172A;
  --text-secondary: #64748B;
  --text-muted: #94A3B8;
  --accent-primary: #5B5CE6;
  --accent-hover: #4B4CD4;
  --accent-soft: rgba(91, 92, 230, 0.12);
  --sim1-bg: rgba(16, 185, 129, 0.12);
  --sim1-text: #059669;
  --sim2-bg: rgba(245, 158, 11, 0.14);
  --sim2-text: #D97706;
  --border-subtle: #E2E8F0;
  --shadow-card: 0 2px 10px rgba(15, 23, 42, 0.04);
}

.dark {
  --bg-app: #0D0F14;
  --bg-sidebar: #13161F;
  --bg-canvas: #0F1219;
  --bg-bubble-in: #1B202C;
  --bg-input: #1A1F2B;
  --text-primary: #F1F5F9;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --accent-primary: #6366F1;
  --accent-hover: #7577F5;
  --accent-soft: rgba(99, 102, 241, 0.16);
  --sim1-bg: rgba(52, 211, 153, 0.14);
  --sim1-text: #34D399;
  --sim2-bg: rgba(251, 191, 36, 0.14);
  --sim2-text: #FBBF24;
  --border-subtle: #1F2433;
  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.28);
}
```

### 9.2 Responsive Component Rules & Brand Icon

* **Desktop (`>= 768px`):** `12px` outer app padding framing floating `rounded-2xl` cards: slim left icon rail (`Messages`, `Contacts`, `Theme Toggle`, `Settings` + live host-phone connection dot), `340px` Thread List panel, and flexible Active Chat panel.
* **Mobile PWA (`< 768px`):** Full-bleed single-pane stack navigation (`ThreadList` <-> `ActiveChat`) locked to `100dvh` so mobile keyboards never cover the bottom composer.
* **Key UI Elements:**
* `<ThreadCard/>`: `rounded-xl` highlight when active (`--accent-soft`), `44px` monogram/photo avatar, colored `SIM 1` / `SIM 2` capsule badge, unread count pill, and `36px × 36px` rounded thumbnail preview (`GET /api/media/:id?variant=thumb`) when the latest message contains media.
* `<MessageBubble/>`: Asymmetric `18px` radius (`rounded-2xl rounded-bl-xs` incoming on `--bg-bubble-in`; `rounded-2xl rounded-br-xs` outgoing on `--accent-primary` with white text), inline `240px` WebP preview expanding into a full-screen lightbox on click, inline HTML5 audio player / downloadable `.vcf`/`.pdf` pill cards, and live delivery checkmarks (`pending`, `sent`, `delivered`, `failed` with retry).
* `<PillComposer/>`: Full `rounded-full` pill input bar with drag-and-drop / `Ctrl+V` clipboard image paste, pre-send compressed file size indicator, a 1-tap `SIM 1` / `SIM 2` toggle capsule (auto-defaulting to `contact.preferred_sim ?? thread.last_sim_number`), and circular `#6366F1` send button.
* **TextPup Brand & PWA Icons:** Minimalist vector puppy head with floppy ears holding a white pill-shaped speech bubble (with three indigo dots) in its mouth over a `#5B5CE6` -> `#6366F1` gradient rounded square (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png` scaled to the 80% safe zone, `apple-touch-icon.png`, and `favicon.svg`).

---

## 10. Implementation Sequence for Developer / AI Agent

1. **Scaffold Project & Docker Stack:** Initialize `package.json` (Hono, Drizzle ORM, `sharp`, `argon2`, `@simplewebauthn/server`, `otpauth`, `web-push`, React, Vite, Tailwind CSS) and `Dockerfile` (including `ffmpeg` binary) + `docker-compose.yml`.
2. **Build Crypto Vault & SQLite Schema:** Implement `vault.ts`, `mediaCrypto.ts`, and Drizzle migrations for all 9 tables, including locked-state webhook sealing.
3. **Implement SMSGate Client, Webhooks & Media Processor:** Build `smsgateClient.ts`, HMAC-verified `webhookHandler.ts`, `sharp`/`ffmpeg` compression + thumbnail generator, and `inboxSync.ts`.
4. **Implement Onboarding & Auth Routes:** Build `/api/setup/*` (`SETUP_TOKEN` gate, Argon2id, WebAuthn Passkey, TOTP, SMSGate pairing) and `/api/auth/*` (`__Host-sid` cookies, rate limiting).
5. **Build Duxica Frontend & PWA:** Implement `tokens.css`, SVG TextPup mascot icons, `SetupWizard`, `LoginPage`, `MessengerView` (SSE real-time updates + `PillComposer`), `ContactsView` (with `.vcf` import), `SettingsView`, and `sw.js` Web Push notifications.
