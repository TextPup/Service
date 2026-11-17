const CACHE_NAME = "textpup-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install Event: cache core app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event: prune old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Network-first for API, Cache-first for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip caching API requests, webhooks, SSE streams
  if (url.pathname.startsWith("/api")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === "basic" &&
            event.request.method === "GET"
          ) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
      );
    })
  );
});

// Web Push Notification Handler
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "TextPup Message",
      body: event.data.text(),
    };
  }

  const options = {
    body: payload.body || "New SMS received",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/favicon.svg",
    vibrate: [100, 50, 100],
    data: payload.data || { url: "/" },
    tag: payload.tag || "textpup-general",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title || "TextPup", options));
});

// Notification Click Handler: Focus existing client or open new window
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
