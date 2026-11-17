import { Hono } from "hono";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, sessions, systemConfig, webauthnCredentials } from "../db/schema.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  revokeSession,
  requireAuth,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  touchVaultActivity,
  type AuthEnv,
} from "./session.js";
import {
  verifyTotpCode,
  verifyAndConsumeRecoveryCode,
} from "./totp.js";
import {
  getWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
} from "./webauthn.js";
import {
  isVaultUnlocked,
  lockVault,
  unlockWithPassword,
  unlockWithRecovery,
  decryptField,
} from "../crypto/vault.js";
import { processPendingWebhooks } from "../gateway/webhookHandler.js";
import { eventBus } from "../gateway/eventBus.js";

export const authRouter = new Hono<AuthEnv>();


// Ephemeral 2FA tokens store (5 min expiry)
interface Pending2fa {
  userId: string;
  expiresAt: number;
}
const pending2faMap = new Map<string, Pending2fa>();

/**
 * POST /api/auth/login: Primary password authentication
 */
authRouter.post("/login", async (c) => {
  const ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    "127.0.0.1";

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return c.json(
      { error: `Too many failed login attempts. Please wait ${rateCheck.retryAfterSec}s.` },
      429
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || !password) {
    recordFailedAttempt(ip);
    return c.json({ error: "Username and password are required" }, 400);
  }

  const user = db.select().from(users).where(eq(users.username, username.trim())).get();
  if (!user) {
    recordFailedAttempt(ip);
    return c.json({ error: "Invalid username or password" }, 401);
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    recordFailedAttempt(ip);
    return c.json({ error: "Invalid username or password" }, 401);
  }

  // Unlock vault with master password if locked
  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  if (config?.wrappedDekPassword && config?.kdfSalt && !isVaultUnlocked()) {
    const unlocked = await unlockWithPassword(password, config.kdfSalt, config.wrappedDekPassword);
    if (unlocked && config.ephemeralPrivateKeyEnc) {
      const ephemeralPrivPem = decryptField(config.ephemeralPrivateKeyEnc);
      await processPendingWebhooks(ephemeralPrivPem);
    }
    if (unlocked) {
      touchVaultActivity();
      eventBus.emitEvent("vault:status", { isVaultUnlocked: true });
      try {
        const { sendHostCommand } = await import("../gateway/hostManager.js");
        sendHostCommand({ action: "SYNC_HISTORY" });
      } catch (err) {
        console.warn("Could not initiate companion sync on login:", err);
      }
    }
  }

  // Check 2FA requirement
  const passkeys = db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id)).all();
  const hasTotp = Boolean(user.totpSecretEnc);
  const hasPasskey = passkeys.length > 0;

  if (hasTotp || hasPasskey) {
    const tempToken = crypto.randomUUID();
    pending2faMap.set(tempToken, {
      userId: user.id,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return c.json({
      require2fa: true,
      tempToken,
      methods: {
        totp: hasTotp,
        passkey: hasPasskey,
      },
    });
  }

  // No 2FA required (fallback)
  resetRateLimit(ip);
  const { sessionId, expiresAt } = await createSession(
    user.id,
    c.req.header("User-Agent"),
    ip
  );
  setSessionCookie(c, sessionId, expiresAt);

  return c.json({
    success: true,
    user: { id: user.id, username: user.username },
  });
});

/**
 * POST /api/auth/2fa: Verify secondary factor (TOTP, Recovery Code, or Passkey)
 */
authRouter.post("/2fa", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { tempToken, totpCode, recoveryCode, passkeyResponse } = body;

  if (!tempToken) {
    return c.json({ error: "Missing temporary 2FA token" }, 400);
  }

  const pending = pending2faMap.get(tempToken);
  if (!pending || pending.expiresAt < Date.now()) {
    pending2faMap.delete(tempToken);
    return c.json({ error: "2FA challenge session expired. Please log in again." }, 401);
  }

  const user = db.select().from(users).where(eq(users.id, pending.userId)).get();
  if (!user) {
    return c.json({ error: "User not found" }, 400);
  }

  let verified = false;

  // 1. Verify TOTP Code
  if (totpCode && user.totpSecretEnc && isVaultUnlocked()) {
    const secret = decryptField(user.totpSecretEnc);
    verified = verifyTotpCode(secret, totpCode);
  }

  // 2. Verify Recovery Backup Code
  if (!verified && recoveryCode && user.recoveryCodesHashJson) {
    const recRes = verifyAndConsumeRecoveryCode(recoveryCode, user.recoveryCodesHashJson);
    if (recRes.valid) {
      verified = true;
      db.update(users)
        .set({ recoveryCodesHashJson: recRes.remainingHashedCodesJson })
        .where(eq(users.id, user.id))
        .run();
    }
  }

  // 3. Verify Passkey Assertion
  if (!verified && passkeyResponse) {
    const passkeys = db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id)).all();
    const credId = passkeyResponse.id;
    const cred = passkeys.find((k) => k.id === credId);
    if (cred) {
      try {
        const authVerification = await verifyWebAuthnAuthentication(passkeyResponse, {
          id: cred.id,
          publicKey: cred.publicKey as Buffer,
          counter: cred.counter,
        });
        if (authVerification.verified) {
          verified = true;
          db.update(webauthnCredentials)
            .set({ counter: authVerification.authenticationInfo.newCounter })
            .where(eq(webauthnCredentials.id, cred.id))
            .run();
        }
      } catch (err) {
        console.warn("Passkey assertion error:", err);
      }
    }
  }

  if (!verified) {
    return c.json({ error: "Invalid 2FA authentication code or passkey" }, 401);
  }

  pending2faMap.delete(tempToken);
  const ip =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    "127.0.0.1";
  resetRateLimit(ip);

  const { sessionId, expiresAt } = await createSession(
    user.id,
    c.req.header("User-Agent"),
    ip
  );
  setSessionCookie(c, sessionId, expiresAt);

  return c.json({
    success: true,
    user: { id: user.id, username: user.username },
  });
});

/**
 * POST /api/auth/passkey/login-options: Get WebAuthn options for 1-tap login
 */
authRouter.post("/passkey/login-options", async (c) => {
  const creds = db.select().from(webauthnCredentials).all();
  const options = await getWebAuthnAuthenticationOptions(creds);
  return c.json(options);
});

/**
 * POST /api/auth/unlock: Unlocks vault with master password or recovery key if locked
 */
authRouter.post("/unlock", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { password, recoveryKey } = body;

  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
  if (!config) {
    return c.json({ error: "System not initialized" }, 400);
  }

  let unlocked = false;

  if (password && config.wrappedDekPassword && config.kdfSalt) {
    unlocked = await unlockWithPassword(password, config.kdfSalt, config.wrappedDekPassword);
  } else if (recoveryKey && config.wrappedDekRecovery) {
    unlocked = unlockWithRecovery(recoveryKey, config.wrappedDekRecovery);
  }

  if (!unlocked) {
    return c.json({ error: "Failed to unlock vault. Invalid password or recovery key." }, 401);
  }

  if (config.ephemeralPrivateKeyEnc) {
    const ephemeralPrivPem = decryptField(config.ephemeralPrivateKeyEnc);
    await processPendingWebhooks(ephemeralPrivPem);
  }

  // Trigger companion history sync on vault unlock
  try {
    const { sendHostCommand } = await import("../gateway/hostManager.js");
    sendHostCommand({ action: "SYNC_HISTORY" });
  } catch (err) {
    console.warn("Could not initiate companion sync on unlock:", err);
  }

  touchVaultActivity();
  eventBus.emitEvent("vault:status", { isVaultUnlocked: true });

  return c.json({ success: true, message: "Vault unlocked successfully" });
});

/**
 * POST /api/auth/lock: Explicitly lock vault and wipe active keys from memory
 */
authRouter.post("/lock", requireAuth, (c) => {
  lockVault();
  eventBus.emitEvent("vault:status", { isVaultUnlocked: false });
  return c.json({ success: true, message: "Vault locked successfully" });
});

/**
 * POST /api/auth/logout: Revoke active session
 */
authRouter.post("/logout", requireAuth, async (c) => {
  const session = c.get("session");
  if (session) {
    await revokeSession(session.id);
  }
  clearSessionCookie(c);
  return c.json({ success: true });
});

/**
 * GET /api/auth/me: Get active session profile and vault state
 */
authRouter.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  const isUnlocked = isVaultUnlocked();
  const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      hasTotp: Boolean(user.totpSecretEnc),
    },
    isVaultUnlocked: isUnlocked,
    isInitialized: config?.isInitialized === 1,
  });
});
