import { Hono } from "hono";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { systemConfig, users, webauthnCredentials } from "../db/schema.js";
import {
  initializeVault,
  generateRecoveryKey,
  encryptField,
  isVaultUnlocked,
  unlockWithRawDek,
} from "../crypto/vault.js";
import {
  generateTotpSecret,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "./totp.js";
import {
  getWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
} from "./webauthn.js";
import { hashPassword, createSession, setSessionCookie } from "./session.js";
import { generatePairingInfo, latestHostStatus } from "../gateway/hostManager.js";

const tokenFilePath = path.resolve(process.cwd(), "data", ".setup_token");
const vaultDekFilePath = path.resolve(process.cwd(), "data", ".setup_vault_dek");

export function saveSetupVaultDek(dek: Buffer) {
  try {
    const dir = path.dirname(vaultDekFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(vaultDekFilePath, dek.toString("hex"), "utf-8");
  } catch {}
}

export function restoreSetupVaultDekIfPending() {
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    if (config && config.isInitialized === 1) {
      cleanupSetupVaultDekFile();
      return;
    }
    if (fs.existsSync(vaultDekFilePath) && !isVaultUnlocked()) {
      const hex = fs.readFileSync(vaultDekFilePath, "utf-8").trim();
      if (hex.length === 64) {
        unlockWithRawDek(Buffer.from(hex, "hex"));
      }
    }
  } catch {}
}

export function cleanupSetupVaultDekFile() {
  try {
    if (fs.existsSync(vaultDekFilePath)) {
      fs.unlinkSync(vaultDekFilePath);
    }
  } catch {}
}

// Restore active setup DEK on startup if setup is still pending
restoreSetupVaultDekIfPending();

function getOrGenerateSetupToken(): string {
  if (process.env.APP_SETUP_TOKEN) {
    return process.env.APP_SETUP_TOKEN.trim();
  }
  try {
    if (fs.existsSync(tokenFilePath)) {
      const saved = fs.readFileSync(tokenFilePath, "utf-8").trim();
      if (saved && saved.length >= 8) {
        return saved;
      }
    }
  } catch {}

  const newToken = crypto.randomBytes(16).toString("hex");
  try {
    const dir = path.dirname(tokenFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tokenFilePath, newToken, "utf-8");
  } catch {}
  return newToken;
}

export function cleanupSetupTokenFile() {
  try {
    if (fs.existsSync(tokenFilePath)) {
      fs.unlinkSync(tokenFilePath);
    }
  } catch {}
}

// Global or environment setup token (persisted until setup completes)
export const runtimeSetupToken = getOrGenerateSetupToken();

export const setupRouter = new Hono();

/**
 * Gatekeeper middleware:
 * 1. Allow GET /status and /api/setup/status so client knows onboarding is complete.
 * 2. Permanently 404s all mutating /api/setup/* endpoints if system is already initialized.
 * 3. Requires timing-safe match on X-Setup-Token header for all mutating actions.
 */
setupRouter.use("*", async (c, next) => {
  const isStatusEndpoint = c.req.path.endsWith("/status") && c.req.method === "GET";
  const isPairQrEndpoint = c.req.path.endsWith("/pair-qr") && c.req.method === "GET";
  const isGatewayStatusEndpoint = c.req.path.endsWith("/gateway/status") && c.req.method === "GET";
  if (isStatusEndpoint || isPairQrEndpoint || isGatewayStatusEndpoint) {
    return await next();
  }

  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  if (config && config.isInitialized === 1) {
    return c.json({ error: "Not Found" }, 404);
  }

  // All other endpoints require X-Setup-Token
  const providedToken = c.req.header("X-Setup-Token");
  if (!providedToken) {
    return c.json({ error: "Missing X-Setup-Token header" }, 401);
  }

  const expectedBuf = Buffer.from(runtimeSetupToken);
  const providedBuf = Buffer.from(providedToken);
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return c.json({ error: "Invalid X-Setup-Token" }, 403);
  }

  await next();
});

/**
 * GET /api/setup/status: Check onboarding status and resume step progress
 */
setupRouter.get("/status", (c) => {
  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  if (config && config.isInitialized === 1) {
    return c.json({ initialized: true });
  }

  const admin = db.select().from(users).all()[0];
  let step = 1;
  let hasAdmin = false;
  let has2Fa = false;

  if (admin) {
    hasAdmin = true;
    step = 2;
    const creds = db.select().from(webauthnCredentials).all();
    if (admin.totpSecretEnc || creds.length > 0) {
      has2Fa = true;
      step = 3;
    }
  }

  return c.json({
    initialized: false,
    step,
    hasAdmin,
    has2Fa,
    username: admin?.username || null,
    setupToken: runtimeSetupToken,
  });
});

/**
 * POST /api/setup/reset: Wipe incomplete setup progress and start over at Step 1
 */
setupRouter.post("/reset", (c) => {
  db.delete(users).run();
  db.delete(systemConfig).run();
  db.delete(webauthnCredentials).run();
  cleanupSetupVaultDekFile();
  return c.json({
    success: true,
    message: "Setup progress wiped successfully. Ready to restart from Step 1.",
  });
});

/**
 * POST /api/setup/step1: Initialize vault and create admin account
 */
setupRouter.post("/step1", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || typeof username !== "string" || username.trim().length < 3) {
    return c.json({ error: "Username must be at least 3 characters" }, 400);
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  // Clean any previous incomplete setup attempt
  db.delete(users).run();
  db.delete(systemConfig).run();
  db.delete(webauthnCredentials).run();

  const recoveryKey = generateRecoveryKey();
  const recoveryCodes = generateRecoveryCodes(8);
  const recoveryHashes = recoveryCodes.map(hashRecoveryCode);

  const vaultInit = await initializeVault(password, recoveryKey);
  saveSetupVaultDek(vaultInit.dek);
  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();

  db.insert(users)
    .values({
      id: userId,
      username: username.trim(),
      passwordHash,
      recoveryCodesHashJson: JSON.stringify(recoveryHashes),
      createdAt: Date.now(),
    })
    .run();

  db.insert(systemConfig)
    .values({
      id: 1,
      isInitialized: 0,
      wrappedDekPassword: vaultInit.wrappedDekPassword,
      wrappedDekRecovery: vaultInit.wrappedDekRecovery,
      kdfSalt: vaultInit.kdfSalt,
      ephemeralPublicKey: vaultInit.ephemeralPublicKey,
      ephemeralPrivateKeyEnc: vaultInit.ephemeralPrivateKeyEnc,
    })
    .run();

  return c.json({
    success: true,
    step: 2,
    userId,
    recoveryKey,
    recoveryCodes,
  });
});

/**
 * POST /api/setup/step2/totp/generate: Generate TOTP secret and QR URI
 */
setupRouter.post("/step2/totp/generate", (c) => {
  const admin = db.select().from(users).all()[0];
  if (!admin) {
    return c.json({ error: "Admin user not found. Complete step 1 first." }, 400);
  }

  const { secretBase32, uri } = generateTotpSecret(admin.username);
  return c.json({ secret: secretBase32, uri });
});

/**
 * POST /api/setup/step2/totp/verify: Verify code and save encrypted secret
 */
setupRouter.post("/step2/totp/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { secret, code } = body;

  if (!secret || !code) {
    return c.json({ error: "Missing secret or code" }, 400);
  }

  const isValid = verifyTotpCode(secret, code);
  if (!isValid) {
    return c.json({ error: "Invalid 6-digit TOTP code" }, 400);
  }

  const admin = db.select().from(users).all()[0];
  if (!admin) {
    return c.json({ error: "Admin user not found" }, 400);
  }

  const encryptedSecret = encryptField(secret);
  db.update(users)
    .set({ totpSecretEnc: encryptedSecret })
    .where(eq(users.id, admin.id))
    .run();

  return c.json({ success: true, message: "TOTP 2FA enrolled successfully" });
});

/**
 * POST /api/setup/step2/passkey/register-options: WebAuthn registration challenge
 */
setupRouter.post("/step2/passkey/register-options", async (c) => {
  const admin = db.select().from(users).all()[0];
  if (!admin) {
    return c.json({ error: "Admin user not found" }, 400);
  }

  const existing = db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, admin.id))
    .all();

  const options = await getWebAuthnRegistrationOptions(admin, existing);
  return c.json(options);
});

/**
 * POST /api/setup/step2/passkey/register-verify: Verify and save passkey
 */
setupRouter.post("/step2/passkey/register-verify", async (c) => {
  const admin = db.select().from(users).all()[0];
  if (!admin) {
    return c.json({ error: "Admin user not found" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const { response, deviceLabel } = body;

  try {
    const verification = await verifyWebAuthnRegistration(admin.id, response);
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: "Passkey verification failed" }, 400);
    }

    const { credential } = verification.registrationInfo;
    const credId = credential.id;

    db.insert(webauthnCredentials)
      .values({
        id: credId,
        userId: admin.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        deviceLabel: deviceLabel || "WebAuthn Authenticator",
        createdAt: Date.now(),
      })
      .run();

    return c.json({ success: true, message: "Passkey enrolled successfully" });
  } catch (err: any) {
    return c.json({ error: err.message || "Passkey registration error" }, 400);
  }
});

/**
 * GET /api/setup/pair-qr: Generate QR pairing payload for companion phone app during setup
 */
setupRouter.get("/pair-qr", (c) => {
  const customUrl = c.req.query("serverUrl");
  const info = generatePairingInfo(customUrl);
  return c.json({
    success: true,
    ...info,
  });
});

/**
 * GET /api/setup/gateway/status: Telemetry of connected companion host during setup
 */
setupRouter.get("/gateway/status", (c) => {
  return c.json(latestHostStatus);
});

/**
 * POST /api/setup/step3/pair: Pair TextPup Host Companion App, calibrate SIMs, finalize setup
 */
setupRouter.post("/step3/pair", async (c) => {
  try {
    const admin = db.select().from(users).all()[0];
    if (!admin) {
      return c.json({ error: "Admin not found" }, 400);
    }

    // Ensure mandatory 2FA was completed
    const passkeys = db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, admin.id)).all();
    if (!admin.totpSecretEnc && passkeys.length === 0) {
      return c.json({ error: "Setup requires at least one 2FA factor (TOTP or Passkey) to be enrolled." }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const { simProfiles = {} } = body;

    // Encrypt sim profiles if vault is currently unlocked, otherwise null
    let simProfilesJsonEnc: string | null = null;
    if (isVaultUnlocked()) {
      try {
        simProfilesJsonEnc = encryptField(JSON.stringify(simProfiles));
      } catch (err: any) {
        console.warn("Could not encrypt sim profiles during step3:", err?.message);
      }
    }

    // Finalize system configuration with native companion app
    db.update(systemConfig)
      .set({
        isInitialized: 1,
        gatewayUrl: "textpup_host",
        gatewayUserEnc: null,
        gatewayPassEnc: null,
        webhookSecretEnc: null,
        simProfilesJsonEnc,
      })
      .where(eq(systemConfig.id, 1))
      .run();

    // Create session and set cookie
    const { sessionId, expiresAt } = await createSession(
      admin.id,
      c.req.header("User-Agent"),
      c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For")
    );
    setSessionCookie(c, sessionId, expiresAt);

    // Clean up setup token & vault DEK files upon successful initialization
    cleanupSetupTokenFile();
    cleanupSetupVaultDekFile();

    console.log("=======================================================");
    console.log("TextPup setup successfully finalized with Host Phone!");
    console.log("=======================================================");

    return c.json({
      success: true,
      message: "TextPup initialized and paired successfully with Android Host!",
      mode: "textpup_host",
    });
  } catch (err: any) {
    console.error("Step 3 finalize error:", err);
    return c.json({ error: err.message || "Gateway pairing failed" }, 500);
  }
});
