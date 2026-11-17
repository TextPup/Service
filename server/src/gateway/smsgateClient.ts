export interface SimSlot {
  slotIndex: number;
  simNumber: number; // 1 or 2
  carrierName: string;
  phoneNumber?: string;
  iccid?: string;
}

export interface GatewayDevice {
  id: string;
  name: string;
  isOnline: boolean;
  batteryPercent?: number;
  lastSeenAt?: number;
  sims: SimSlot[];
}

export interface SendSmsRequest {
  phoneNumbers: string[];
  textMessage: {
    text: string;
  };
  simNumber: number;
  withDeliveryReport?: boolean;
}

export interface MmsAttachmentPayload {
  contentType: string;
  data: string; // Base64 encoded string
  name: string;
}

export interface SendMmsRequest {
  phoneNumbers: string[];
  mmsMessage: {
    subject?: string;
    text?: string;
    attachments: MmsAttachmentPayload[];
  };
  simNumber: number;
  withDeliveryReport?: boolean;
}

export interface SendMessageResult {
  id: string; // Gateway message ID
  state: "pending" | "sent" | "delivered" | "failed" | string;
  recipients?: Array<{
    phoneNumber: string;
    state: string;
  }>;
}

export interface GatewayWebhook {
  id: string;
  url: string;
  event: string;
}

export interface GatewayInboxMessage {
  id: string;
  address: string; // Phone number
  body?: string;
  date: number; // Timestamp in ms
  type: number; // 1 = inbox, 2 = sent
  simNumber?: number;
  attachments?: Array<{
    contentType: string;
    data: string;
    name?: string;
  }>;
}

export interface GatewayHealthResponse {
  status: string;
  version?: string;
  releaseId?: number;
  checks?: Record<string, {
    description?: string;
    observedUnit?: string;
    observedValue?: any;
    status?: string;
  }>;
}

export class SmsGateClient {
  private baseUrl: string;
  private authHeader: string;
  private pathPrefix: string | null = null; // Auto-detected: "" (local phone server) or "/3rdparty/v1" (cloud/proxy)

  constructor(gatewayUrl: string, username = "", password = "") {
    let clean = gatewayUrl.trim().replace(/\/+$/, "");
    if (clean.endsWith("/3rdparty/v1")) {
      clean = clean.slice(0, -"/3rdparty/v1".length).replace(/\/+$/, "");
      this.pathPrefix = "/3rdparty/v1";
    }
    this.baseUrl = clean;
    const creds = Buffer.from(`${username}:${password}`).toString("base64");
    this.authHeader = `Basic ${creds}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers as Record<string, string>),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `SMSGate HTTP ${res.status} error for ${options.method || "GET"} ${endpoint}: ${errorBody}`
      );
    }

    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  }

  /**
   * Health Check: GET /health (unauthenticated)
   */
  async getHealth(): Promise<GatewayHealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`SMSGate Health check failed (${res.status}): ${errorBody}`);
    }
    return (await res.json()) as GatewayHealthResponse;
  }

  /**
   * Detects whether the server uses direct root endpoints (local server mode, e.g. /devices)
   * or cloud/proxy endpoints (e.g. /3rdparty/v1/devices).
   */
  private async resolvePathPrefix(): Promise<string> {
    if (this.pathPrefix !== null) {
      return this.pathPrefix;
    }

    // Probe 1: Direct root /devices (standard for local server on Android phone)
    try {
      const res = await fetch(`${this.baseUrl}/devices`, {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
        },
      });
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        this.pathPrefix = "";
        return "";
      }
    } catch {
      // Continue to probe /3rdparty/v1/devices
    }

    // Probe 2: /3rdparty/v1/devices (standard for cloud gateway / proxy)
    try {
      const res = await fetch(`${this.baseUrl}/3rdparty/v1/devices`, {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
        },
      });
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        this.pathPrefix = "/3rdparty/v1";
        return "/3rdparty/v1";
      }
    } catch {
      // Fallback
    }

    // Default to direct root if unresolvable
    this.pathPrefix = "";
    return "";
  }

  /**
   * Device & Multi-SIM Discovery: GET /devices or GET /3rdparty/v1/devices
   */
  async getDevices(): Promise<GatewayDevice[]> {
    const prefix = await this.resolvePathPrefix();
    const data = await this.request<any>(`${prefix}/devices`);
    const rawDevices: any[] = Array.isArray(data) ? data : data.devices || [];

    const parsedDevices: GatewayDevice[] = rawDevices.map((d: any) => {
      // Handle both simCards (OpenAPI spec) and sims (legacy/alternate)
      const rawSims: any[] = Array.isArray(d.simCards)
        ? d.simCards
        : Array.isArray(d.sims)
        ? d.sims
        : [];

      const sims: SimSlot[] = rawSims.map((s: any, idx: number) => ({
        slotIndex: s.slotIndex ?? idx,
        simNumber: s.simNumber ?? (idx + 1),
        carrierName: s.carrierName || `SIM ${s.simNumber ?? (idx + 1)}`,
        phoneNumber: s.phoneNumber || undefined,
        iccid: s.iccid || undefined,
      }));

      // If no SIM cards reported in device list, provide standard dual-SIM fallback
      if (sims.length === 0) {
        sims.push(
          { slotIndex: 0, simNumber: 1, carrierName: "SIM 1" },
          { slotIndex: 1, simNumber: 2, carrierName: "SIM 2" }
        );
      }

      return {
        id: d.id || "default_device",
        name: d.name || "Android Host Phone",
        isOnline: Boolean(d.isOnline ?? true),
        batteryPercent: d.batteryPercent ?? d.battery,
        lastSeenAt: d.lastSeen ? new Date(d.lastSeen).getTime() : d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : undefined,
        sims,
      };
    });

    if (parsedDevices.length > 0) {
      return parsedDevices;
    }

    // If /devices returned an empty array (which can happen on local phone server before registration),
    // synthesize a default local host device with dual-SIM slots
    let batteryPercent: number | undefined;
    try {
      const health = await this.getHealth();
      const batteryCheck = health.checks?.["battery:level"];
      if (batteryCheck && typeof batteryCheck.observedValue === "number") {
        batteryPercent = batteryCheck.observedValue;
      }
    } catch {
      // Ignore health check failure
    }

    return [
      {
        id: "local_android_host",
        name: "Local Android Gateway",
        isOnline: true,
        batteryPercent,
        lastSeenAt: Date.now(),
        sims: [
          { slotIndex: 0, simNumber: 1, carrierName: "SIM 1" },
          { slotIndex: 1, simNumber: 2, carrierName: "SIM 2" },
        ],
      },
    ];
  }

  /**
   * Send SMS: POST /messages (or POST /message fallback)
   */
  async sendSms(req: SendSmsRequest): Promise<SendMessageResult> {
    const prefix = await this.resolvePathPrefix();
    const payload = {
      phoneNumbers: req.phoneNumbers,
      textMessage: req.textMessage,
      simNumber: req.simNumber,
      withDeliveryReport: req.withDeliveryReport ?? true,
    };

    try {
      return await this.request<SendMessageResult>(`${prefix}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      // If 404 on /messages, fallback to singular /message (supported in some older versions)
      if (err.message?.includes("404")) {
        return await this.request<SendMessageResult>(`${prefix}/message`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      throw err;
    }
  }

  /**
   * Send MMS: POST /messages
   */
  async sendMms(req: SendMmsRequest): Promise<SendMessageResult> {
    const prefix = await this.resolvePathPrefix();
    const payload = {
      phoneNumbers: req.phoneNumbers,
      mmsMessage: req.mmsMessage,
      simNumber: req.simNumber,
      withDeliveryReport: req.withDeliveryReport ?? true,
    };

    try {
      return await this.request<SendMessageResult>(`${prefix}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      if (err.message?.includes("404")) {
        return await this.request<SendMessageResult>(`${prefix}/message`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      throw err;
    }
  }

  /**
   * Webhook Management: GET /webhooks
   */
  async getWebhooks(): Promise<GatewayWebhook[]> {
    const prefix = await this.resolvePathPrefix();
    const data = await this.request<any>(`${prefix}/webhooks`);
    return Array.isArray(data) ? data : data.webhooks || [];
  }

  /**
   * Webhook Management: POST /webhooks
   */
  async registerWebhook(url: string, event: string): Promise<GatewayWebhook> {
    const prefix = await this.resolvePathPrefix();
    return await this.request<GatewayWebhook>(`${prefix}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ url, event }),
    });
  }

  /**
   * Webhook Management: DELETE /webhooks/:id
   */
  async deleteWebhook(id: string): Promise<void> {
    const prefix = await this.resolvePathPrefix();
    await this.request<void>(`${prefix}/webhooks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  /**
   * Registers all required webhooks if not already registered:
   * sms:received, mms:downloaded, sms:sent, sms:delivered, sms:failed, system:ping
   */
  async ensureWebhooks(targetUrl: string): Promise<GatewayWebhook[]> {
    const requiredEvents = [
      "sms:received",
      "mms:downloaded",
      "sms:sent",
      "sms:delivered",
      "sms:failed",
      "system:ping",
    ];

    const existing = await this.getWebhooks().catch(() => [] as GatewayWebhook[]);
    const registered: GatewayWebhook[] = [];

    for (const event of requiredEvents) {
      const found = existing.find((w) => w.url === targetUrl && w.event === event);
      if (found) {
        registered.push(found);
      } else {
        try {
          const created = await this.registerWebhook(targetUrl, event);
          registered.push(created);
        } catch (err) {
          console.error(`Failed to register webhook for ${event}:`, err);
        }
      }
    }

    return registered;
  }

  /**
   * Inbox History Sync: GET /inbox
   */
  async getInbox(params?: { limit?: number; since?: number }): Promise<GatewayInboxMessage[]> {
    const prefix = await this.resolvePathPrefix();
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", params.limit.toString());
    if (params?.since) query.set("since", params.since.toString());

    const qs = query.toString();
    const endpoint = `${prefix}/inbox${qs ? `?${qs}` : ""}`;
    const data = await this.request<any>(endpoint);
    return Array.isArray(data) ? data : data.messages || [];
  }
}
