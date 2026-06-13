// Service Worker do CRM IDEAL (PWA).
// Responsabilidades:
//   1. Cachear o shell do app pra abrir offline / instalavel ("App-Shell").
//   2. Receber Web Push e mostrar notificacao mesmo com o app fechado.
//   3. Ao tocar na notificacao, abrir/focar o app na conversa certa.
//
// IMPORTANTE: bump CACHE quando mudar arquivos do shell, senao o celular serve
// a versao velha do cache. O Vercel atualiza no servidor, mas o SW intercepta.
const CACHE = "crm-ideal-v10";
const SHELL = [
  "/app/",
  "/app/index.html",
  "/app/ideal-ui.css",
  "/app/proto.css",
  "/app/app.css",
  "/app/app.js?v=5",
  "/app/manifest.webmanifest",
  "/app/icons/icon-192.png",
  "/app/icons/icon-512.png",
  "/app/icons/icon-192-mask.png",
  "/app/icons/icon-512-mask.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network-first pra chamadas de API (sempre dados frescos); cache-first pro
// shell estatico. Nunca cacheia /api/ — dados de conversa precisam ser ao vivo.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/app")) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Recebe o push disparado pelo servidor (src/push/web-push.ts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "CRM IDEAL", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "CRM IDEAL";
  const options = {
    body: data.body || "Nova mensagem",
    icon: "/app/icons/icon-192.png",
    badge: "/app/icons/icon-192.png",
    tag: data.tag || "crm-ideal",
    renotify: true,
    vibrate: [200, 100, 200],
    data: { wa_id: data.wa_id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Toque na notificacao: abre a conversa certa (ou foca a aba existente).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const waId = event.notification.data && event.notification.data.wa_id;
  const target = waId ? `/app/?chat=${encodeURIComponent(waId)}` : "/app/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes("/app") && "focus" in client) {
            client.postMessage({ type: "open-chat", wa_id: waId });
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
