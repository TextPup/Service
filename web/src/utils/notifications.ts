import { subscribeToPushNotifications } from "./push";

/**
 * Checks current notification permission state
 */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Requests web notification permission and registers push subscription
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // Also subscribe to service worker background push if available
      subscribeToPushNotifications().catch(() => {});
      return true;
    }
    return false;
  } catch (err) {
    console.warn("Error requesting notification permission:", err);
    return false;
  }
}

/**
 * Plays a gentle, pleasant 2-tone chime using Web Audio API
 */
export function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // First note: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second note: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.0, now + 0.1);
    gain2.gain.setValueAtTime(0.15, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.4);
  } catch {
    // AudioContext might be blocked until user interacts with the page
  }
}

/**
 * Displays a desktop web notification if permission is granted
 */
export async function displayWebNotification(options: {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}) {
  if (getNotificationPermission() !== "granted") {
    return;
  }

  // Play audio chime
  playNotificationSound();

  const title = options.title || "TextPup";
  const notifOptions: NotificationOptions = {
    body: options.body,
    icon: options.icon || "/icons/icon-192.png",
    badge: "/icons/favicon.svg",
    tag: options.tag || "textpup-inbound",
  };

  try {
    // Try service worker registration first if active
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return;
      }
    }

    // Fall back to standard Notification constructor
    const n = new Notification(title, notifOptions);
    if (options.onClick) {
      n.onclick = () => {
        window.focus();
        options.onClick?.();
        n.close();
      };
    }
  } catch (err) {
    console.warn("Failed to display notification:", err);
  }
}
