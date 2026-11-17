import { EventEmitter } from "node:events";

export interface MessageNewEvent {
  messageId: string;
  threadId: string;
  phone: string; // Plaintext (for live active UI)
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

export interface TextPupEventMap {
  "message:new": (event: MessageNewEvent) => void;
  "message:status": (event: MessageStatusEvent) => void;
  "device:status": (event: DeviceStatusEvent) => void;
  "thread:update": (threadId: string) => void;
  "vault:status": (event: VaultStatusEvent) => void;
}

class TypedEventBus extends EventEmitter {
  emitEvent<K extends keyof TextPupEventMap>(event: K, ...args: Parameters<TextPupEventMap[K]>): boolean {
    return this.emit(event, ...args);
  }

  onEvent<K extends keyof TextPupEventMap>(event: K, listener: TextPupEventMap[K]): this {
    return this.on(event, listener as (...args: any[]) => void);
  }

  offEvent<K extends keyof TextPupEventMap>(event: K, listener: TextPupEventMap[K]): this {
    return this.off(event, listener as (...args: any[]) => void);
  }
}

export const eventBus = new TypedEventBus();
// Increase listener ceiling for multiple concurrent browser sessions
eventBus.setMaxListeners(50);
