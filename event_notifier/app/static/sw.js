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

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
