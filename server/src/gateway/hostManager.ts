import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "../db/client.js";
import { systemConfig, messages, threads, attachments } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { isVaultUnlocked, encryptField, decryptField, hashPhone, normalizePhone } from "../crypto/vault.js";
import { processInboundMedia } from "../media/processor.js";
import { encryptMediaBuffer } from "../crypto/mediaCrypto.js";
import { eventBus } from "./eventBus.js";

export interface PairedDevice {
  id: string;
  name: string;
  isOnline: boolean;
  batteryPercent: number;
  lastPingAt: number;
  lastSeenAt: number;
  sims: Array<{
    slotIndex: number;
    simNumber: number;
    carrierName: string;
    phoneNumber?: string;
  }>;
}

export interface HostRadioStatus {
  isOnline: boolean;
  batteryPercent: number;
  lastPingAt: number;
  lastSeenAt: number;
  deviceId?: string;
  deviceName?: string;
  sims: Array<{
    slotIndex: number;
    simNumber: number;
    carrierName: string;
    phoneNumber?: string;
  }>;
  devices?: PairedDevice[];
}

export const pairedDevicesMap = new Map<string, PairedDevice>();

export let latestHostStatus: HostRadioStatus = {
  isOnline: false,
  batteryPercent: 100,
  lastPingAt: 0,
  lastSeenAt: 0,
  sims: [],
  devices: [],
};

interface ActivePairingToken {
  token: string;
  expiresAt: number;
}

const pairingTokenFilePath = path.resolve(process.cwd(), "data", ".pairing_token");
const hostTokenFilePath = path.resolve(process.cwd(), "data", ".host_token");

export function savePairedHostToken(token: string) {
  try {
    const dir = path.dirname(hostTokenFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hostTokenFilePath, token.trim(), "utf-8");
  } catch {}
}

export function getPairedHostToken(): string | null {
  try {
    if (fs.existsSync(hostTokenFilePath)) {
      return fs.readFileSync(hostTokenFilePath, "utf-8").trim();
    }
  } catch {}
  return null;
}

/**
 * Disconnect and unpair companion device(s), resetting gateway tokens and live state
 */
export function unpairHostDevice(deviceId?: string) {
  // 1. Close active companion socket
  if (activeCompanionSocket) {
    try {
      activeCompanionSocket.close(4001, "Unpaired by user");
    } catch {}
    activeCompanionSocket = null;
  }

  // 2. Clear token files
  try {
    if (fs.existsSync(hostTokenFilePath)) fs.unlinkSync(hostTokenFilePath);
    if (fs.existsSync(pairingTokenFilePath)) fs.unlinkSync(pairingTokenFilePath);
  } catch {}

  currentPairingToken = null;

  if (deviceId && pairedDevicesMap.has(deviceId)) {
    pairedDevicesMap.delete(deviceId);
  } else {
    pairedDevicesMap.clear();
  }

  // 3. Reset host status
  latestHostStatus = {
    isOnline: false,
    batteryPercent: 100,
    lastPingAt: 0,
    lastSeenAt: 0,
    sims: [],
    devices: Array.from(pairedDevicesMap.values()),
  };

  // 4. Emit event to all web clients
  eventBus.emitEvent("device:status", latestHostStatus);
}

function loadSavedPairingToken(): ActivePairingToken | null {
  try {
    if (fs.existsSync(pairingTokenFilePath)) {
      const data = JSON.parse(fs.readFileSync(pairingTokenFilePath, "utf-8"));
      if (data?.token && data?.expiresAt && data.expiresAt > Date.now()) {
        return data;
      }
    }
  } catch {}
  return null;
}

let currentPairingToken: ActivePairingToken | null = loadSavedPairingToken();
let activeCompanionSocket: WebSocket | null = null;

/**
 * Discovers computer's primary local LAN IPv4 address (e.g. 192.168.1.x)
 */
export function getLocalLanIp(): string {
  const interfaces = os.networkInterfaces();
  
  // Prefer Wi-Fi or Ethernet over virtual adapters (WSL, Hyper-V, ZeroTier, etc.)
  const preferredOrder = ["wi-fi", "ethernet", "wlan", "eth", "en"];
  for (const prefix of preferredOrder) {
    for (const name of Object.keys(interfaces)) {
      if (name.toLowerCase().startsWith(prefix)) {
        for (const net of interfaces[name] || []) {
          if (net.family === "IPv4" && !net.internal) {
            return net.address;
          }
        }
      }
    }
  }

  // Fallback to any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

/**
 * Generate a new 10-minute pairing token and QR payload
 */
export function generatePairingInfo(overrideServerUrl?: string) {
  const token = `pair_${crypto.randomBytes(16).toString("hex")}`;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  currentPairingToken = { token, expiresAt };
  savePairedHostToken(token);
  try {
    const dir = path.dirname(pairingTokenFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pairingTokenFilePath, JSON.stringify(currentPairingToken), "utf-8");
  } catch {}

  let serverUrl = overrideServerUrl?.trim();
  if (!serverUrl) {
    const port = Number(process.env.PORT) || 8080;
    const lanIp = getLocalLanIp();
    serverUrl = `http://${lanIp}:${port}`;
  }

  const payload = {
    serverUrl,
    pairingToken: token,
    expiresAt,
  };

  return {
    serverUrl,
    pairingToken: token,
    expiresAt,
    qrPayload: JSON.stringify(payload),
  };
}

/**
 * Validates companion token against ephemeral pairing token or saved token
 */
export function validateHostToken(token: string): boolean {
  if (!token) return false;

  // 1. Check persistent paired host token
  const pairedToken = getPairedHostToken();
  if (pairedToken && pairedToken === token) {
    return true;
  }

  // 2. Check ephemeral pairing token (or reload from disk)
  if (!currentPairingToken) {
    currentPairingToken = loadSavedPairingToken();
  }
  if (currentPairingToken) {
    if (Date.now() <= currentPairingToken.expiresAt && currentPairingToken.token === token) {
      return true;
    }
  }

  // 3. Check saved pairing secret in system config
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    if (config?.gatewayPassEnc && isVaultUnlocked()) {
      const savedSecret = decryptField(config.gatewayPassEnc);
      if (savedSecret && savedSecret === token) {
        return true;
      }
    }

    // 4. Fallback: During onboarding setup before system is initialized, accept any pair_* token
    if (config?.isInitialized === 0 && token.startsWith("pair_")) {
      return true;
    }
  } catch (err) {
    console.warn("Could not check saved gatewayPassEnc:", err);
  }

  // 5. Fallback: If pairing token matches the token prefix
  if (currentPairingToken && token.startsWith("pair_")) {
    return true;
  }

  return false;
}

export function isHostConnected(): boolean {
  return activeCompanionSocket !== null && activeCompanionSocket.readyState === WebSocket.OPEN;
}

export function sendHostCommand(cmd: Record<string, any>): boolean {
  if (activeCompanionSocket && activeCompanionSocket.readyState === WebSocket.OPEN) {
    activeCompanionSocket.send(JSON.stringify(cmd));
    return true;
  }
  return false;
}

/**
 * Central event processor for events received from the Android host (via WS or HTTP)
 */
export async function handleHostEvent(body: any): Promise<{ success: boolean; [key: string]: any }> {
  const event = body?.event;

  // 1. Status Heartbeat
  if (event === "status:update") {
    const deviceId = String(body.deviceId || "default_device");
    const deviceName = String(body.deviceName || "Android Host");
    const batteryPercent = Number(body.batteryPercent) || 100;
    const now = Date.now();
    const sims = Array.isArray(body.sims) ? body.sims : [];

    const deviceRecord: PairedDevice = {
      id: deviceId,
      name: deviceName,
      isOnline: true,
      batteryPercent,
      lastPingAt: now,
      lastSeenAt: now,
      sims,
    };
    pairedDevicesMap.set(deviceId, deviceRecord);

    latestHostStatus = {
      isOnline: true,
      batteryPercent,
      lastPingAt: now,
      lastSeenAt: now,
      deviceId,
      deviceName,
      sims,
      devices: Array.from(pairedDevicesMap.values()),
    };
    eventBus.emitEvent("device:status", latestHostStatus);
    return { success: true };
  }

  // 2. Sent SMS Delivery Status
  if (event === "message:sent_status") {
    const messageId = body.messageId;
    const status = body.status === "delivered" ? "delivered" : "failed";
    const error = body.error;

    if (messageId) {
      const existing = db.select().from(messages).where(eq(messages.id, messageId)).get();
      db.update(messages)
        .set({
          status,
          errorReasonEnc: error ? encryptField(error) : null,
        })
        .where(eq(messages.id, messageId))
        .run();

      eventBus.emitEvent("message:status", {
        messageId,
        threadId: existing?.threadId || "",
        status,
        errorReason: error,
      });
    }
    return { success: true };
  }

  // 3. Inbound SMS
  if (event === "sms:received") {
    if (!isVaultUnlocked()) {
      console.warn("Incoming SMS received but vault is locked. Skipping insertion.");
      return { success: false, error: "Vault locked on server" };
    }

    const rawSender = body.sender || "";
    const e164 = normalizePhone(rawSender);
    if (!e164) return { success: false, error: "Invalid sender" };

    const phoneHash = hashPhone(e164);
    const textBody = body.body || "";
    const simNumber = Number(body.simNumber) || 1;
    const timestamp = Number(body.timestamp) || Date.now();
    const direction: "inbound" | "outbound" = body.direction === "outbound" ? "outbound" : "inbound";
    const status = direction === "outbound" ? "delivered" : "received";
    const isSync = Boolean(body.isSync);
    const isHistorical = isSync || (Date.now() - timestamp > 120_000);
    const gatewayMsgId = body.gatewayMsgId || `host_sms_${timestamp}_${phoneHash.slice(0, 6)}_${direction}_${simNumber}`;

    let thread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
    const threadId = thread?.id || crypto.randomUUID();

    // Deduplicate or rectify previously misattributed messages
    const existing = db.select().from(messages).where(eq(messages.gatewayMsgId, gatewayMsgId)).get();
    if (existing) {
      if (existing.direction !== direction) {
        db.update(messages)
          .set({ direction, status })
          .where(eq(messages.id, existing.id))
          .run();
      }
      return { success: true, duplicate: true };
    }

    // Check if an existing message exists for this thread & timestamp (e.g. from previous sync with missing direction)
    const legacyMatch = db.select().from(messages).where(
      and(
        eq(messages.threadId, threadId),
        eq(messages.createdAt, timestamp)
      )
    ).get();

    if (legacyMatch) {
      if (legacyMatch.direction !== direction) {
        db.update(messages)
          .set({ direction, status, gatewayMsgId })
          .where(eq(messages.id, legacyMatch.id))
          .run();
      }
      return { success: true, updated: true };
    }

    const previewEnc = encryptField(textBody.length > 80 ? textBody.slice(0, 80) + "..." : textBody);
    const shouldIncrementUnread = !isHistorical && direction === "inbound";

    if (thread) {
      db.update(threads)
        .set({
          lastSimNumber: simNumber,
          lastPreviewEnc: previewEnc,
          lastMessageAt: Math.max(thread.lastMessageAt, timestamp),
          unreadCount: shouldIncrementUnread ? (thread.unreadCount || 0) + 1 : (thread.unreadCount || 0),
        })
        .where(eq(threads.id, threadId))
        .run();
    } else {
      db.insert(threads)
        .values({
          id: threadId,
          phoneHash,
          phoneEnc: encryptField(e164),
          lastSimNumber: simNumber,
          lastPreviewEnc: previewEnc,
          lastMessageAt: timestamp,
          unreadCount: shouldIncrementUnread ? 1 : 0,
        })
        .run();
    }

    const messageId = crypto.randomUUID();
    db.insert(messages)
      .values({
        id: messageId,
        gatewayMsgId,
        threadId,
        direction,
        simNumber,
        bodyEnc: encryptField(textBody),
        status,
        createdAt: timestamp,
      })
      .run();

    if (!isHistorical) {
      eventBus.emitEvent("message:new", {
        messageId,
        threadId,
        phone: e164,
        direction,
        simNumber,
        body: textBody,
        hasAttachment: false,
        createdAt: timestamp,
      });
    }
    eventBus.emitEvent("thread:update", threadId);

    return { success: true, messageId };
  }

  // 4. Inbound MMS
  if (event === "mms:received") {
    if (!isVaultUnlocked()) {
      console.warn("Incoming MMS received but vault is locked. Skipping insertion.");
      return { success: false, error: "Vault locked on server" };
    }

    const rawSender = body.sender || "";
    const e164 = normalizePhone(rawSender);
    if (!e164) return { success: false, error: "Invalid sender" };

    const phoneHash = hashPhone(e164);
    const textBody = body.subject || "";
    const simNumber = Number(body.simNumber) || 1;
    const timestamp = Number(body.timestamp) || Date.now();
    const gatewayMsgId = `host_mms_${timestamp}_${phoneHash.slice(0, 6)}`;

    let thread = db.select().from(threads).where(eq(threads.phoneHash, phoneHash)).get();
    const threadId = thread?.id || crypto.randomUUID();
    const previewEnc = encryptField(textBody.trim() ? textBody : "[Media Attachment]");

    if (thread) {
      db.update(threads)
        .set({
          lastSimNumber: simNumber,
          lastPreviewEnc: previewEnc,
          lastMessageAt: Math.max(thread.lastMessageAt, timestamp),
          unreadCount: (thread.unreadCount || 0) + 1,
        })
        .where(eq(threads.id, threadId))
        .run();
    } else {
      db.insert(threads)
        .values({
          id: threadId,
          phoneHash,
          phoneEnc: encryptField(e164),
          lastSimNumber: simNumber,
          lastPreviewEnc: previewEnc,
          lastMessageAt: timestamp,
          unreadCount: 1,
        })
        .run();
    }

    const messageId = crypto.randomUUID();
    db.insert(messages)
      .values({
        id: messageId,
        gatewayMsgId,
        threadId,
        direction: "inbound",
        simNumber,
        bodyEnc: textBody.trim() ? encryptField(textBody) : null,
        status: "received",
        createdAt: timestamp,
      })
      .run();

    const rawParts: any[] = body.attachments || [];
    for (const part of rawParts) {
      const mimeType = part.mimeType || "image/jpeg";
      const filename = part.name || "attachment.jpg";
      const rawBuf = Buffer.from(part.data || "", "base64");
      if (rawBuf.length === 0) continue;

      const attachmentId = crypto.randomUUID();
      const mediaMeta = await processInboundMedia(rawBuf, mimeType);
      const fullEnc = await encryptMediaBuffer(rawBuf, attachmentId);

      let thumbPath: string | null = null;
      let thumbIvAndTag: string | null = null;
      if (mediaMeta.thumbBuffer) {
        const thumbEnc = await encryptMediaBuffer(mediaMeta.thumbBuffer, `thumb_${attachmentId}`);
        thumbPath = thumbEnc.storagePath;
        thumbIvAndTag = thumbEnc.ivAndTag;
      }

      db.insert(attachments)
        .values({
          id: attachmentId,
          messageId,
          kind: mediaMeta.kind,
          mimeType,
          filenameEnc: encryptField(filename),
          storagePath: fullEnc.storagePath,
          ivAndTag: fullEnc.ivAndTag,
          thumbPath,
          thumbIvAndTag,
          width: mediaMeta.width,
          height: mediaMeta.height,
          sizeBytes: rawBuf.length,
        })
        .run();
    }

    const isHistorical = Boolean(body.isSync) || (Date.now() - timestamp > 120_000);
    if (!isHistorical) {
      eventBus.emitEvent("message:new", {
        messageId,
        threadId,
        phone: e164,
        direction: "inbound",
        simNumber,
        body: textBody,
        hasAttachment: rawParts.length > 0,
        createdAt: timestamp,
      });
    }
    eventBus.emitEvent("thread:update", threadId);

    return { success: true, messageId };
  }

  return { success: true };
}

/**
 * Attach WebSocket server to the Node HTTP server
 */
export function initHostWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({
    noServer: true,
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/api/gateway/connect") {
      const authHeader = request.headers["authorization"] || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("token") || "";

      if (!validateHostToken(token)) {
        console.warn("[WS] Unauthorized connection attempt from:", request.socket.remoteAddress);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws: WebSocket, req) => {
    console.log("[WS] TextPup Android Host Phone connected from:", req.socket.remoteAddress);
    activeCompanionSocket = ws;
    latestHostStatus.isOnline = true;
    latestHostStatus.lastSeenAt = Date.now();
    eventBus.emitEvent("device:status", latestHostStatus);

    ws.on("message", async (data) => {
      try {
        const text = data.toString();
        const json = JSON.parse(text);
        await handleHostEvent(json);
      } catch (err) {
        console.error("[WS] Error parsing message:", err);
      }
    });

    ws.on("close", (code, reason) => {
      console.log(`[WS] Android Host Phone disconnected (${code} - ${reason.toString()})`);
      if (activeCompanionSocket === ws) {
        activeCompanionSocket = null;
        latestHostStatus.isOnline = false;
        for (const [id, dev] of pairedDevicesMap) {
          pairedDevicesMap.set(id, { ...dev, isOnline: false });
        }
        latestHostStatus.devices = Array.from(pairedDevicesMap.values());
        eventBus.emitEvent("device:status", latestHostStatus);
      }
    });

    ws.on("error", (err) => {
      console.error("[WS] Socket error:", err);
    });
  });

  return wss;
}
