// sw.js – Service Worker: macht Stadtjagd als App installierbar und lädt
// die Seiten auch bei schlechtem Netz.
//
// Strategie "Netz zuerst": Online kommt immer die neueste Version vom Server
// (und wird für später gespeichert). Nur wenn das Netz fehlt, nehmen wir die
// gespeicherte Kopie. So bleibt niemand auf einer alten Version hängen.
//
// Karten-Kacheln und die OpenStreetMap-Suche werden bewusst NICHT gespeichert.

const CACHE = "stadtjagd-v1";

// Grundgerüst, das gleich beim Installieren gespeichert wird
const APP_FILES = [
  "./",
  "index.html",
  "create.html",
  "play.html",
  "css/style.css",
  "js/hunt.js",
  "js/game.js",
  "js/storage.js",
  "js/texts.js",
  "js/confetti.js",
  "js/places.js",
  "js/pwa.js",
  "js/ui-index.js",
  "js/ui-create.js",
  "js/ui-play.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
];

// Fremde Server, deren Dateien wir speichern dürfen (Bibliotheken vom CDN)
const CACHEABLE_HOSTS = ["cdnjs.cloudflare.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting(); // neue Version sofort aktivieren
});

self.addEventListener("activate", (event) => {
  // Alte Speicher-Versionen aufräumen
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // z. B. Kacheln: Browser macht's selbst

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // Kein Netz: gespeicherte Kopie (Seiten ohne den Teil hinter "#" – den sieht der Server nie)
      .catch(() => caches.match(request, { ignoreSearch: url.pathname.endsWith(".html") }))
  );
});
