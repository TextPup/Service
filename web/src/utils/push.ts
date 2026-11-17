/**
 * Converts a URL-safe Base64 string to a Uint8Array for PushManager subscription.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Requests Web Push notification permission and registers the subscription with TextPup.
 */
export async function subscribeToPushNotifications(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications are not supported in this browser.");
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission was not granted:", permission);
      return false;
    }

    const reg = await navigator.serviceWorker.ready;

    // Fetch public VAPID key from TextPup server
    const vapidRes = await fetch("/api/push/vapid-key");
    if (!vapidRes.ok) {
      throw new Error("Failed to fetch public VAPID key");
    }
    const { publicKey } = await vapidRes.json();
    if (!publicKey) return false;

    // Check existing subscription
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
    }

    // Send subscription to server
    const subJson = subscription.toJSON();
    const saveRes = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });

    return saveRes.ok;
  } catch (err) {
    console.warn("Could not subscribe to push notifications:", err);
    return false;
  }
}
