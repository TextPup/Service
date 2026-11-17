# TextPup — Implementation Plan

This implementation plan breaks down the **TextPup** Technical Architecture & Implementation Specification (`SPEC.md`) into granular, trackable work items with checkmarks.

---

## Phase 1: Environment, Tooling & Container Stack Scaffolding
- [x] **1.1 Workspace & Monorepo/Subproject Setup**
  - [x] Initialize root `package.json` with workspace configuration or scripts for `server` and `web`.
  - [x] Configure TypeScript configs (`tsconfig.json` for server, `tsconfig.json` for web).
  - [x] Configure ESLint, Prettier, and `.gitignore` (ignoring `/data`, `node_modules`, `.env`, dist files).
- [x] **1.2 Docker Infrastructure**
  - [x] Create `docker-compose.yml` with 3 services:
    - [x] `mariadb:11` (with `MARIADB_DATABASE=smsgateway`, persistent volume `smsgate_db`).
    - [x] `sms-gateway` (`capcom6/sms-gateway:latest`, private mode, port `3000:3000`).
    - [x] `textpup` (Hono/Node/Bun, port `8080:8080`, persistent volume `textpup_data:/data`).
  - [x] Create multi-stage `Dockerfile` for `textpup`:
    - [x] Build stage for React PWA (`web`).
    - [x] Server stage with Node.js/Bun, `ffmpeg`, and build dependencies for `sharp`.
    - [x] Final runner image exposing port `8080` with `/data` mount point.
  - [x] Create `.env.example` with documented environment variables (`MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`, `GATEWAY_PRIVATE_TOKEN`, `APP_SETUP_TOKEN`, `RP_ID`, `RP_ORIGIN`).

---

## Phase 2: Database Schema & Core Cryptography Vault
- [x] **2.1 SQLite Client & Drizzle ORM Setup (`server/src/db/`)**
  - [x] Configure `client.ts` with SQLite (WAL journal mode, foreign keys enabled, busy timeout).
  - [x] Define Drizzle schema (`schema.ts`) for all 9 tables:
    - [x] `system_config` (single-row system state, wrapped DEKs, KDF salt, encrypted gateway credentials, encrypted SIM profiles).
    - [x] `users` (admin credentials, password hash, encrypted TOTP secret, hashed recovery codes).
    - [x] `webauthn_credentials` (WebAuthn credentials, public key blob, counter, transports).
    - [x] `sessions` (`__Host-sid` session store, user agent, IP prefix, expiration).
    - [x] `contacts` (blind index `phone_hash`, encrypted phone/name/notes, avatar color, preferred SIM).
    - [x] `threads` (blind index `phone_hash`, encrypted phone/preview, last SIM, unread count).
    - [x] `messages` (gateway message ID, thread relation, direction, SIM number, encrypted body, status, error).
    - [x] `attachments` (MIME type, encrypted filename, `.enc` storage paths, IV & Auth tags, dimensions).
    - [x] `push_subscriptions` (VAPID endpoints, p256dh, auth keys).
  - [x] Create migration/initialization script to auto-apply SQLite schema on server startup.
- [x] **2.2 Cryptographic Vault Implementation (`server/src/crypto/vault.ts`)**
  - [x] Implement DEK generation (256-bit cryptographic random key).
  - [x] Implement Argon2id KDF for Master Password KEK (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`).
  - [x] Implement Recovery Key derivation for Recovery KEK (from 24-word / 32-char recovery token).
  - [x] Implement DEK wrapping & unwrapping functions with AES-256-GCM.
  - [x] Implement HKDF-SHA256 subkey derivation from DEK (`enc_key` for data encryption, `hmac_key` for blind indexing).
  - [x] Implement `encryptField` and `decryptField` using AES-256-GCM (`ivHex:authTagHex:cipherBase64`).
  - [x] Implement `hashPhone` using HMAC-SHA256 over normalized E.164 numbers for deterministic lookups.
  - [x] Implement locked-state webhook buffer / ephemeral X25519 sealing for zero-loss restarts before vault unlock.
- [x] **2.3 Streaming Media Cryptography (`server/src/crypto/mediaCrypto.ts`)**
  - [x] Implement AES-256-GCM streaming/chunked file encryptor to `/data/media/*.enc`.
  - [x] Implement authenticated media decryption stream with IV and Auth Tag validation for HTTP range/download requests.

---

## Phase 3: Media Processing & Carrier Compression Pipeline
- [x] **3.1 Outbound & Inbound Media Processor (`server/src/media/processor.ts`)**
  - [x] Configure `sharp` image processing pipeline:
    - [x] Automatic EXIF and GPS metadata stripping.
    - [x] Longest edge constraint (max `1600px`).
    - [x] Iterative JPEG quality compression (`82` down to `65`) strictly enforcing `<= 750 KB` carrier ceiling.
    - [x] Generate high-efficiency `240px` WebP thumbnail (`quality: 60`) for message/thread previews.
  - [x] Configure `ffmpeg` video processing pipeline:
    - [x] Auto-transcode videos exceeding `850 KB` to `360p` / `480p` H.264 Baseline MP4 + mono AAC audio.
    - [x] Constrain video bitrate to guarantee `<= 850 KB` output.
    - [x] Extract frame `00:00:01` as a `240px` WebP poster thumbnail.
  - [x] Document/vCard/Audio handling:
    - [x] Enforce configurable hard MMS upload ceiling (default `1 MB`).
    - [x] Preserve original MIME types and encrypt filenames.

---

## Phase 4: SMSGate API Client, Webhooks & Sync Engine
- [x] **4.1 SMSGate Typed HTTP Client (`server/src/gateway/smsgateClient.ts`)**
  - [x] Implement Basic Auth header constructor (`base64(gateway_user:gateway_pass)`).
  - [x] `GET /3rdparty/v1/devices`: Fetch device online status, battery, and SIM slot array (`simNumber`, `carrierName`, `phoneNumber`, `iccid`).
  - [x] `POST /3rdparty/v1/messages` (SMS): Typed payload for single/multi-recipient text dispatch with delivery reports.
  - [x] `POST /3rdparty/v1/messages` (MMS): Typed payload for base64 attachments, subject, text, and SIM slot selection.
  - [x] `GET`, `POST`, `DELETE /3rdparty/v1/webhooks`: Lifecycle helper to register, list, and prune webhooks.
  - [x] `GET /3rdparty/v1/inbox`: Query host phone message store for backfill.
- [x] **4.2 Inbound Webhook Verification & Processor (`server/src/gateway/webhookHandler.ts`)**
  - [x] Verify `X-Signature` HMAC-SHA256 signature against `webhook_secret`.
  - [x] Verify `X-Timestamp` drift rejection (`|now - X-Timestamp| > 300s`).
  - [x] Handle `sms:received`:
    - [x] E.164 phone normalization -> `phone_hash`.
    - [x] Upsert thread with `last_sim_number = payload.simNumber` and increment `unread_count`.
    - [x] Encrypt body with `enc_key` and store in `messages`.
    - [x] Dispatch real-time SSE event `message:new` and trigger VAPID Web Push.
  - [x] Handle `mms:downloaded`:
    - [x] Process and compress inbound attachments.
    - [x] Generate encrypted `240px` WebP thumbnail -> `/data/media/thumb_<uuid>.enc`.
    - [x] Encrypt full attachment payload -> `/data/media/<uuid>.enc`.
    - [x] Link attachment record, update thread preview, dispatch SSE and Web Push.
  - [x] Handle `sms:sent`, `sms:delivered`, `sms:failed`:
    - [x] Update `messages.status` and optional encrypted `error_reason_enc`.
    - [x] Dispatch real-time SSE event `message:status`.
  - [x] Handle `system:ping`:
    - [x] Update device heartbeat cache and broadcast SSE `device:status`.
- [x] **4.3 Google Messages Reconciliation Engine (`server/src/gateway/inboxSync.ts`)**
  - [x] Initial setup backfill routine from `GET /3rdparty/v1/inbox`.
  - [x] Configurable background sync poll (e.g., every 60 seconds) to detect manual replies sent directly inside Google Messages on the host phone.
  - [x] Timestamp, sender, and content-hash deduplication preventing duplicate message entries.

---

## Phase 5: Authentication, Session Security & Setup Wizard API
- [x] **5.1 First-Run Setup Wizard (`server/src/auth/setup.ts`)**
  - [x] Validate server state: if `is_initialized === 1`, permanently return `404 Not Found`.
  - [x] Enforce `X-Setup-Token` timing-safe comparison with generated or configured `APP_SETUP_TOKEN`.
  - [x] **Step 1:** Create Admin account, hash password with Argon2id, initialize DEK, wrap DEK with Password KEK & Recovery KEK, return single-use recovery key + 8 recovery backup codes.
  - [x] **Step 2:** Enroll WebAuthn Passkey (`@simplewebauthn/server`) and/or generate TOTP secret with QR URI (`otpauth`). Block setup progression until at least one 2FA factor is active.
  - [x] **Step 3:** Pair SMSGate (`gateway_url`, credentials), fetch SIM cards from `/devices`, configure SIM labels and colors, register all 6 webhooks, run initial backfill, set `is_initialized = 1`.
- [x] **5.2 Authentication & Session Management (`server/src/auth/session.ts`)**
  - [x] Sliding-window rate limiter on `/api/auth/login` (5 attempts / 60 seconds with exponential IP lockout).
  - [x] Primary password validation with Argon2id.
  - [x] Secondary factor challenge: WebAuthn Passkey (`server/src/auth/webauthn.ts`) or TOTP verification (`server/src/auth/totp.ts`).
  - [x] Issue hardened `__Host-sid` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`).
  - [x] Session tracking in SQLite `sessions` table (sliding 7-day, absolute 30-day lifetime).
  - [x] Middleware for session authentication and active session revocation.

---

## Phase 6: Application Routes & Core Backend Services
- [x] **6.1 Threads & Messages API (`server/src/routes/threads.ts`)**
  - [x] `GET /api/threads`: List conversation threads with decrypted previews, contact names, unread counts, and last SIM badge.
  - [x] `GET /api/threads/:id/messages`: Paginated message list with decrypted bodies and attachment metadata.
  - [x] `POST /api/threads/:id/messages`: Outbound SMS/MMS sender with automated SIM routing (defaults to `last_sim_number` or contact preference, overrideable via request).
  - [x] `POST /api/threads/new`: Initiate a new conversation to a given phone number.
  - [x] `POST /api/threads/:id/read`: Mark thread messages as read and clear unread count.
  - [x] `DELETE /api/threads/:id`: Delete conversation and purge encrypted messages/attachments.
- [x] **6.2 Contacts API (`server/src/routes/contacts.ts`)**
  - [x] `GET /api/contacts`: List all contacts (decrypted in-memory for authenticated session).
  - [x] `POST /api/contacts`: Create new encrypted contact with phone hash blind index.
  - [x] `PUT /api/contacts/:id`: Update contact details, preferred SIM, notes, and avatar color.
  - [x] `DELETE /api/contacts/:id`: Remove contact.
  - [x] `POST /api/contacts/import-vcf`: Bulk vCard (`.vcf`) parser and encrypted importer.
- [x] **6.3 Authenticated Media Streaming (`server/src/routes/media.ts`)**
  - [x] `GET /api/media/:id?variant=thumb|full`: Authenticated media stream with decrypted bytes, correct MIME headers, and client caching headers.
- [x] **6.4 Web Push & Real-Time Events (`server/src/routes/push.ts` & `events.ts`)**
  - [x] `GET /api/push/vapid-key`: Return public VAPID key.
  - [x] `POST /api/push/subscribe`: Store browser PushSubscription.
  - [x] `GET /api/events`: Server-Sent Events (`streamSSE`) broadcaster for live updates (`message:new`, `message:status`, `thread:update`, `device:status`).

---

## Phase 7: Duxica Design System, PWA Assets & Frontend Shell
- [x] **7.1 Duxica Tokens & Theme Parity (`web/src/styles/tokens.css`)**
  - [x] Implement complete CSS variable palette for Light and Dark modes:
    - [x] Backgrounds: `--bg-app`, `--bg-sidebar`, `--bg-canvas`, `--bg-bubble-in`, `--bg-input`.
    - [x] Accents: `--accent-primary` (`#5B5CE6` / `#6366F1`), `--accent-hover`, `--accent-soft`.
    - [x] SIM badging: `--sim1-bg`, `--sim1-text` (Emerald), `--sim2-bg`, `--sim2-text` (Amber).
    - [x] Borders and drop shadows: `--border-subtle`, `--shadow-card`.
  - [x] Configure Tailwind CSS to reference custom properties and support dark mode toggling.
- [x] **7.2 TextPup Mascot & PWA Assets (`web/public/`)**
  - [x] Design SVG vector TextPup mascot icon: friendly puppy holding a white speech bubble with 3 indigo dots on `#5B5CE6`/`#6366F1` gradient.
  - [x] Generate responsive icon assets: `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (80% safe zone), `favicon.svg`.
  - [x] Create `manifest.json` configured for standalone PWA with `theme_color: #5B5CE6`.
  - [x] Create `sw.js` supporting offline app shell caching and native Web Push notifications.
- [x] **7.3 Core Layout Components (`web/src/components/kit/`)**
  - [x] `<AppShell/>`: Responsive desktop 3-zone layout (12px outer padding, floating rounded-2xl cards) vs. mobile 100dvh full-bleed stack view.
  - [x] `<SidebarRail/>`: Slim icon rail with navigation (Messages, Contacts, Settings, Theme toggle, host-phone heartbeat indicator).

---

## Phase 8: Core Frontend Pages & Components
- [x] **8.1 First-Run Setup Wizard (`web/src/pages/SetupWizard.tsx`)**
  - [x] Bootstrap token prompt for `X-Setup-Token`.
  - [x] Step 1 UI: Master password input, Argon2id generation, recovery phrase display and verification prompt.
  - [x] Step 2 UI: WebAuthn passkey registration button + TOTP QR code display with code verification.
  - [x] Step 3 UI: SMSGate URL and credentials input, live device/SIM card discovery test, SIM naming and color picker, initial sync confirmation.
- [x] **8.2 Authentication Screen (`web/src/pages/LoginPage.tsx`)**
  - [x] Master password login form.
  - [x] WebAuthn 1-tap passkey login trigger.
  - [x] TOTP 6-digit code or emergency recovery code input.
  - [x] Rate limit warning banners and error handling.
- [x] **8.3 Messenger View (`web/src/pages/MessengerView.tsx`)**
  - [x] `<ThreadList/>` panel (340px desktop, full-width mobile) with search, filter, and unread counts.
  - [x] `<ThreadCard/>`: Active card styling, avatar monogram, colored SIM 1/2 capsule badges, 36px WebP thumbnail preview.
  - [x] `<ActiveChat/>`: Header with contact/number info, SIM switcher, and message timeline.
  - [x] `<MessageBubble/>`: Asymmetric border radiuses, WebP image lightbox preview, HTML5 audio player, downloadable attachment cards, delivery status icons (`pending`, `sent`, `delivered`, `failed`).
  - [x] `<PillComposer/>`: Full pill input bar, drag-and-drop / clipboard paste, attachment thumbnail preview with pre-send compression badge, 1-tap SIM 1 / SIM 2 toggle capsule, circular send button.
- [x] **8.4 Contacts View (`web/src/pages/ContactsView.tsx`)**
  - [x] Contact list with alphabet navigation and search.
  - [x] Add/Edit Contact modal (name, phone, preferred SIM, notes, color).
  - [x] Drag-and-drop `.vcf` vCard bulk import modal with preview.
- [x] **8.5 Settings View (`web/src/pages/SettingsView.tsx`)**
  - [x] Host phone health status (connection state, battery level, last ping).
  - [x] SIM card configuration (custom labels, carrier names, colors).
  - [x] Security settings (manage WebAuthn passkeys, view active sessions with revocation, generate new recovery codes).
  - [x] Background reconciliation interval adjustments.

---

## Phase 9: Real-time SSE Integration, Web Push & PWA Service Worker
- [x] **9.1 SSE Real-time Hook (`web/src/hooks/useEvents.ts`)**
  - [x] Establish resilient EventSource connection to `/api/events` with auto-reconnect and backoff.
  - [x] Live state updates for incoming messages, delivery receipt transitions, and device connectivity.
- [x] **9.2 Push Notification Integration (`web/src/utils/push.ts` & `sw.js`)**
  - [x] Request Web Push notification permission and register service worker subscription with `/api/push/subscribe`.
  - [x] Service worker background push event listener displaying system notifications with direct conversation open links.

---

## Phase 10: End-to-End Verification, Docker Build & Production Hardening
- [x] **10.1 Automated & Unit Verification**
  - [x] Test crypto vault (Argon2id KDF, AES-256-GCM encryption/decryption, HMAC-SHA256 blind indexing).
  - [x] Test media compression limits (images `<= 750 KB`, video `<= 850 KB`).
  - [x] Test SMSGate webhook signature validation and time drift prevention.
- [x] **10.2 Production Build & Container Verification**
  - [x] Build production frontend assets (`vite build`).
  - [x] Validate Docker multi-stage build and full `docker-compose up` startup.
  - [x] Confirm reverse-proxy / Cloudflare Tunnel compatibility and security headers.
