// storage.js – Kleine Hülle um localStorage.
//
// Kein DOM-Zugriff. localStorage kann fehlen oder Fehler werfen
// (z. B. im privaten Modus mancher Browser) – dann geht eben nichts
// verloren, es wird nur nichts gespeichert.

const PREFIX = "stadtjagd:";

export const KEYS = {
  draft: "draft",
  progress: (huntId) => "progress:" + huntId,
  introSeen: (huntId) => "intro:" + huntId,
};

// Liest einen Wert. Gibt null zurück, wenn nichts da ist oder er kaputt ist.
export function load(key) {
  try {
    const text = localStorage.getItem(PREFIX + key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Speicher nicht verfügbar oder voll – Spiel läuft trotzdem weiter.
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // siehe oben
  }
}
