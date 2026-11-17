import { Hono } from "hono";
import { requireAuth, type AuthEnv } from "../auth/session.js";
import {
  generatePairingInfo,
  validateHostToken,
  latestHostStatus,
  handleHostEvent,
  unpairHostDevice,
} from "../gateway/hostManager.js";

export { latestHostStatus, type HostRadioStatus } from "../gateway/hostManager.js";

export const gatewayRouter = new Hono<AuthEnv>();

/**
 * GET /api/gateway/pair-qr: Generate one-time pairing QR payload
 */
gatewayRouter.get("/pair-qr", requireAuth, (c) => {
  const customUrl = c.req.query("serverUrl");
  const info = generatePairingInfo(customUrl);
  return c.json({
    success: true,
    qrPayload: info.qrPayload,
    serverUrl: info.serverUrl,
    pairingToken: info.pairingToken,
    expiresAt: info.expiresAt,
  });
});

/**
 * GET /api/gateway/status: Telemetry of connected companion host
 */
gatewayRouter.get("/status", requireAuth, (c) => {
  return c.json(latestHostStatus);
});

/**
 * POST /api/gateway/unpair: Disconnect active host companion and clear saved pairing token
 */
gatewayRouter.post("/unpair", requireAuth, (c) => {
  unpairHostDevice();
  return c.json({
    success: true,
    message: "Companion host device unpaired successfully",
  });
});

/**
 * GET /api/gateway/devices: List all paired companion devices (multi-device hub)
 */
gatewayRouter.get("/devices", requireAuth, (c) => {
  return c.json({
    devices: latestHostStatus.devices || [],
  });
});

/**
 * POST /api/gateway/devices/:id/unpair: Unpair specific companion device by ID
 */
gatewayRouter.post("/devices/:id/unpair", requireAuth, (c) => {
  const deviceId = c.req.param("id");
  unpairHostDevice(deviceId);
  return c.json({
    success: true,
    message: `Device ${deviceId} unpaired successfully`,
  });
});

/**
 * POST /api/gateway/events: Ingest real-time events from TextPup Host Android companion via HTTP
 */
gatewayRouter.post("/events", async (c) => {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Validate pairing token or existing pairing secret
  if (!token || !validateHostToken(token)) {
    return c.json({ error: "Missing or invalid authorization token" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = await handleHostEvent(body);
  if (!result.success && result.error) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result);
});
