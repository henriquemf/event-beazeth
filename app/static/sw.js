const STATIC_CACHE = "en-static-v1";

// Estáticos chegam com ?v=<mtime>, então cache-first nunca serve arquivo velho.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/static/")) return;
  if (url.pathname.endsWith("/sw.js")) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Notificação", body: event.data.text() };
  }

  const title = data.title || "Event Notifier";
  const options = {
    body: data.body || "",
    icon: data.icon || "/static/icon.svg",
    badge: data.badge || "/static/icon.svg",
    tag: data.tag || "event-notifier",
    renotify: false,
  };

  // Avisa as abas abertas para tocarem o som do app. O service worker nao tem
  // AudioContext, entao quem toca e a pagina; sem aba aberta fica so o som do
  // proprio sistema, que e o comportamento normal de notificacao.
  const avisarAbas = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((abas) => abas.forEach((aba) => aba.postMessage({ type: "en-push", tag: options.tag })));

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), avisarAbas]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
