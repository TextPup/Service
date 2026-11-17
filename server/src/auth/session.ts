import argon2 from "argon2";
import crypto from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/client.js";
import { users, sessions, systemConfig } from "../db/schema.js";
import {
  isVaultUnlocked,
  lockVault,
  unlockWithPassword,
  decryptField,
} from "../crypto/vault.js";
import { eventBus } from "../gateway/eventBus.js";
import { processPendingWebhooks } from "../gateway/webhookHandler.js";

// Session cookie constants
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const SESSION_COOKIE_NAME = IS_PRODUCTION ? "__Host-sid" : "sid";
export const SLIDING_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ABSOLUTE_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Inactivity Auto-Lock settings (default: 15 minutes of inactivity)
const autoLockMinutes = process.env.VAULT_AUTO_LOCK_MINUTES !== undefined
  ? Number(process.env.VAULT_AUTO_LOCK_MINUTES)
  : 15;
export const AUTO_LOCK_IDLE_MS = autoLockMinutes > 0 ? autoLockMinutes * 60 * 1000 : 0;

let lastVaultActivity = Date.now();

export function touchVaultActivity() {
  lastVaultActivity = Date.now();
}

// Background auto-lock watcher running every 5s
if (AUTO_LOCK_IDLE_MS > 0 && process.env.NODE_ENV !== "test") {
  const autoLockTimer = setInterval(() => {
    if (isVaultUnlocked() && Date.now() - lastVaultActivity >= AUTO_LOCK_IDLE_MS) {
      console.log(`[Vault] Inactivity timeout reached (${autoLockMinutes}m). Locking crypto vault.`);
      lockVault();
      eventBus.emitEvent("vault:status", { isVaultUnlocked: false });
    }
  }, 5000);
  if (autoLockTimer.unref) {
    autoLockTimer.unref();
  }
}

// Rate Limiter tracking state
interface RateLimitRecord {
  attempts: number[];
  lockedUntil?: number;
}
const ipRateLimits = new Map<string, RateLimitRecord>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const record = ipRateLimits.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }

  // Filter attempts in the last 60 seconds
  record.attempts = record.attempts.filter((ts) => now - ts < 60000);
  if (record.attempts.length >= 5) {
    // 5 attempts within 60s -> exponential lockout (initial 5 min lockout)
    record.lockedUntil = now + 5 * 60 * 1000;
    return {
      allowed: false,
      retryAfterSec: 300,
    };
  }

  return { allowed: true };
}

export function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = ipRateLimits.get(ip) || { attempts: [] };
  record.attempts.push(now);
  ipRateLimits.set(ip, record);
}

export function resetRateLimit(ip: string) {
  ipRateLimits.delete(ip);
}

/**
 * Hashes a master password using Argon2id with spec memory/cost parameters.
 */
export async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Verifies password against Argon2id hash.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Creates a new session in SQLite and attaches cookie.
 */
export async function createSession(
  userId: string,
  userAgent?: string,
  ip?: string
) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const expiresAt = now + SLIDING_EXPIRATION_MS;
  const ipPrefix = ip ? ip.split(".").slice(0, 3).join(".") : undefined;

  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      userAgent: userAgent || "Unknown Client",
      ipPrefix,
      expiresAt,
      createdAt: now,
    })
    .run();

  return { sessionId, expiresAt };
}

/**
 * Attaches the session cookie to the Hono response.
 */
export function setSessionCookie(c: Context, sessionId: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "Strict",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/**
 * Clears the session cookie.
 */
export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: "/",
    secure: IS_PRODUCTION,
  });
}

/**
 * Validates a session by ID and slides expiration up to 30 days max.
 */
export async function validateSession(sessionId: string) {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt < now) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }

  // Check absolute 30-day lifetime
  if (now - session.createdAt > ABSOLUTE_MAX_LIFETIME_MS) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }

  // Slide expiration (7 days from now, but capped at created + 30d)
  const maxAllowedExpires = session.createdAt + ABSOLUTE_MAX_LIFETIME_MS;
  const newExpires = Math.min(now + SLIDING_EXPIRATION_MS, maxAllowedExpires);

  db.update(sessions)
    .set({ expiresAt: newExpires })
    .where(eq(sessions.id, sessionId))
    .run();

  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;

  return { user, session };
}

/**
 * Revokes a session by ID.
 */
export async function revokeSession(sessionId: string) {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/**
 * Revokes all sessions for a specific user.
 */
export async function revokeAllUserSessions(userId: string) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export type AuthEnv = {
  Variables: {
    user: typeof users.$inferSelect;
    session: typeof sessions.$inferSelect;
    isVaultUnlocked: boolean;
  };
};

/**
 * Hono Middleware requiring an authenticated session.
 */
export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {

  const cookieSid = getCookie(c, SESSION_COOKIE_NAME);
  const authHeader = c.req.header("Authorization");
  const bearerSid = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const sessionId = cookieSid || bearerSid;

  if (!sessionId) {
    return c.json({ error: "Unauthorized: Missing session" }, 401);
  }

  const result = await validateSession(sessionId);
  if (!result) {
    clearSessionCookie(c);
    return c.json({ error: "Unauthorized: Invalid or expired session" }, 401);
  }

  c.set("user", result.user);
  c.set("session", result.session);
  c.set("isVaultUnlocked", isVaultUnlocked());
  touchVaultActivity();

  await next();
};
