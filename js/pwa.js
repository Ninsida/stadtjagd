// pwa.js – meldet den Service Worker an (siehe sw.js).
//
// Kein DOM-Zugriff. Funktioniert nur über https oder localhost – bei
// geöffneten Dateien (file://) passiert einfach nichts.

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  // Erst nach dem Laden, damit der erste Seitenaufbau nicht gebremst wird
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Klappt es nicht, läuft die Seite eben ohne Offline-Funktion weiter.
    });
  });
}
