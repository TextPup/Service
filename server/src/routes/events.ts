import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth, type AuthEnv } from "../auth/session.js";
import { isVaultUnlocked } from "../crypto/vault.js";
import {
  eventBus,
  MessageNewEvent,
  MessageStatusEvent,
  DeviceStatusEvent,
  VaultStatusEvent,
} from "../gateway/eventBus.js";
import { latestHostStatus } from "../gateway/hostManager.js";

export const eventsRouter = new Hono<AuthEnv>();

/**
 * GET /api/events: Hono streamSSE Real-time Event Broadcaster
 */
eventsRouter.get("/", requireAuth, (c) => {
  return streamSSE(c, async (stream) => {
    // Send initial device status snapshot
    await stream.writeSSE({
      event: "device:status",
      data: JSON.stringify(latestHostStatus),
    });

    // Send initial vault status snapshot
    await stream.writeSSE({
      event: "vault:status",
      data: JSON.stringify({ isVaultUnlocked: isVaultUnlocked() }),
    });

    // Event listeners
    const onMessageNew = async (event: MessageNewEvent) => {
      try {
        await stream.writeSSE({
          event: "message:new",
          data: JSON.stringify(event),
        });
      } catch {
        // Stream aborted
      }
    };

    const onMessageStatus = async (event: MessageStatusEvent) => {
      try {
        await stream.writeSSE({
          event: "message:status",
          data: JSON.stringify(event),
        });
      } catch {
        // Stream aborted
      }
    };

    const onDeviceStatus = async (event: DeviceStatusEvent) => {
      try {
        await stream.writeSSE({
          event: "device:status",
          data: JSON.stringify(event),
        });
      } catch {
        // Stream aborted
      }
    };

    const onThreadUpdate = async (threadId: string) => {
      try {
        await stream.writeSSE({
          event: "thread:update",
          data: JSON.stringify({ threadId }),
        });
      } catch {
        // Stream aborted
      }
    };

    const onVaultStatus = async (event: VaultStatusEvent) => {
      try {
        await stream.writeSSE({
          event: "vault:status",
          data: JSON.stringify(event),
        });
      } catch {
        // Stream aborted
      }
    };

    eventBus.onEvent("message:new", onMessageNew);
    eventBus.onEvent("message:status", onMessageStatus);
    eventBus.onEvent("device:status", onDeviceStatus);
    eventBus.onEvent("thread:update", onThreadUpdate);
    eventBus.onEvent("vault:status", onVaultStatus);

    // Keepalive ping interval every 25s
    const keepaliveTimer = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: "ping",
          data: String(Date.now()),
        });
        await stream.writeSSE({
          event: "vault:status",
          data: JSON.stringify({ isVaultUnlocked: isVaultUnlocked() }),
        });
      } catch {
        // Stream aborted
      }
    }, 25000);

    // Cleanup listeners on connection termination
    stream.onAbort(() => {
      clearInterval(keepaliveTimer);
      eventBus.offEvent("message:new", onMessageNew);
      eventBus.offEvent("message:status", onMessageStatus);
      eventBus.offEvent("device:status", onDeviceStatus);
      eventBus.offEvent("thread:update", onThreadUpdate);
      eventBus.offEvent("vault:status", onVaultStatus);
    });

    // Keep stream alive until abort
    while (!stream.aborted) {
      await stream.sleep(1000);
    }
  });
});
