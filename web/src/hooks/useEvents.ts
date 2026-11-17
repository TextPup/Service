import { useEffect, useRef, useCallback } from "react";

export interface MessageNewEvent {
  messageId: string;
  threadId: string;
  phone: string;
  direction: "inbound" | "outbound";
  simNumber: number;
  body: string | null;
  hasAttachment: boolean;
  createdAt: number;
}

export interface MessageStatusEvent {
  messageId: string;
  threadId: string;
  status: "pending" | "sent" | "delivered" | "failed";
  errorReason?: string | null;
}

export interface DeviceStatusEvent {
  isOnline: boolean;
  lastPingAt: number;
  batteryPercent?: number;
}

export interface VaultStatusEvent {
  isVaultUnlocked: boolean;
}

interface UseEventsOptions {
  enabled?: boolean;
  onMessageNew?: (event: MessageNewEvent) => void;
  onMessageStatus?: (event: MessageStatusEvent) => void;
  onDeviceStatus?: (event: DeviceStatusEvent) => void;
  onThreadUpdate?: (threadId: string) => void;
  onVaultStatus?: (event: VaultStatusEvent) => void;
}

export function useEvents({
  enabled = true,
  onMessageNew,
  onMessageStatus,
  onDeviceStatus,
  onThreadUpdate,
  onVaultStatus,
}: UseEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backoffRef = useRef(1000);

  // Keep latest callbacks in refs to avoid reconnecting SSE on handler identity change
  const callbacksRef = useRef({
    onMessageNew,
    onMessageStatus,
    onDeviceStatus,
    onThreadUpdate,
    onVaultStatus,
  });

  useEffect(() => {
    callbacksRef.current = {
      onMessageNew,
      onMessageStatus,
      onDeviceStatus,
      onThreadUpdate,
      onVaultStatus,
    };
  });

  const connect = useCallback(() => {
    if (!enabled) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/events", { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      backoffRef.current = 1000; // Reset backoff on successful connection
    };

    es.addEventListener("message:new", (e) => {
      try {
        const data: MessageNewEvent = JSON.parse(e.data);
        callbacksRef.current.onMessageNew?.(data);
      } catch (err) {
        console.warn("Failed to parse message:new SSE data", err);
      }
    });

    es.addEventListener("message:status", (e) => {
      try {
        const data: MessageStatusEvent = JSON.parse(e.data);
        callbacksRef.current.onMessageStatus?.(data);
      } catch (err) {
        console.warn("Failed to parse message:status SSE data", err);
      }
    });

    es.addEventListener("device:status", (e) => {
      try {
        const data: DeviceStatusEvent = JSON.parse(e.data);
        callbacksRef.current.onDeviceStatus?.(data);
      } catch (err) {
        console.warn("Failed to parse device:status SSE data", err);
      }
    });

    es.addEventListener("thread:update", (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacksRef.current.onThreadUpdate?.(data.threadId);
      } catch (err) {
        console.warn("Failed to parse thread:update SSE data", err);
      }
    });

    es.addEventListener("vault:status", (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacksRef.current.onVaultStatus?.(data);
      } catch (err) {
        console.warn("Failed to parse vault:status SSE data", err);
      }
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      // Exponential backoff reconnect: 1s -> 2s -> 4s -> max 15s
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 1.5, 15000);

      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connect]);
}
