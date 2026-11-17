import { Hono } from "hono";
import webPush from "web-push";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushSubscriptions, users } from "../db/schema.js";
import { requireAuth, type AuthEnv } from "../auth/session.js";
import { eventBus, MessageNewEvent } from "../gateway/eventBus.js";

// VAPID Keys: Generate or use environment
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  const generated = webPush.generateVAPIDKeys();
  vapidPublicKey = generated.publicKey;
  vapidPrivateKey = generated.privateKey;
}

webPush.setVapidDetails(
  "mailto:admin@textpup.local",
  vapidPublicKey,
  vapidPrivateKey
);

export const pushRouter = new Hono<AuthEnv>();

/**
 * GET /api/push/vapid-key: Retrieve public VAPID key
 */
pushRouter.get("/vapid-key", requireAuth, (c) => {
  return c.json({ publicKey: vapidPublicKey });
});

/**
 * POST /api/push/subscribe: Register Web Push subscription
 */
pushRouter.post("/subscribe", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const { endpoint, keys } = body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return c.json({ error: "Invalid subscription payload" }, 400);
  }

  // Upsert subscription
  const existing = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .get();

  if (existing) {
    db.update(pushSubscriptions)
      .set({
        userId: user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .where(eq(pushSubscriptions.id, existing.id))
      .run();
  } else {
    db.insert(pushSubscriptions)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        createdAt: Date.now(),
      })
      .run();
  }

  return c.json({ success: true });
});

/**
 * POST /api/push/unsubscribe: Remove Web Push subscription
 */
pushRouter.post("/unsubscribe", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { endpoint } = body;

  if (endpoint) {
    db.delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .run();
  }

  return c.json({ success: true });
});

/**
 * Broadcasts a Web Push notification to all active browser subscriptions.
 * Removes expired or unsubscribed endpoints (HTTP 404/410).
 */
export async function dispatchWebPush(notification: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}) {
  const subscriptions = db.select().from(pushSubscriptions).all();
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon.svg",
    data: {
      url: notification.url || "/",
    },
    tag: notification.tag || "textpup-msg",
  });

  const sendPromises = subscriptions.map(async (sub) => {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      await webPush.sendNotification(pushSub, payload);
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
      }
    }
  });

  await Promise.allSettled(sendPromises);
}

// Automatically forward inbound messages to Web Push
eventBus.onEvent("message:new", (event: MessageNewEvent) => {
  if (event.direction === "inbound") {
    const preview = event.body
      ? event.body.slice(0, 100)
      : event.hasAttachment
      ? "[Attachment]"
      : "New message";

    dispatchWebPush({
      title: `SMS from ${event.phone} (SIM ${event.simNumber})`,
      body: preview,
      url: `/thread/${event.threadId}`,
      tag: `thread-${event.threadId}`,
    }).catch(() => {});
  }
});
