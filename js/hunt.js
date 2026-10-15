// hunt.js – Datenformat einer Jagd: anlegen, prüfen, Lösungen hashen,
// in einen Link kodieren und wieder auslesen.
//
// Kein DOM-Zugriff! Benötigt nur:
//   - LZString (globale Variable, per <script> vom CDN geladen)
//   - crypto (im Browser und in Node eingebaut)

export const FORMAT_VERSION = 1;
export const MAX_SKIP_FAILS = 10;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const HASH_BYTES = 9; // 9 Bytes = 12 Zeichen Base64url

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

// Zufällige ID, z. B. "k3f9x2qa". Nutzt den sicheren Zufallsgenerator.
export function createId(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const b of bytes) {
    id += ID_ALPHABET[b % ID_ALPHABET.length];
  }
  return id;
}

// Eine leere Jagd im Klartext-Format (für den Editor).
export function createHunt() {
  return {
    v: FORMAT_VERSION,
    id: createId(),
    title: "",
    intro: "",
    outro: "",
    skip: { allowed: false, afterFails: 3 },
    stations: [],
  };
}

// Eine neue Station an einer Position.
export function createStation(lat, lng) {
  return {
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    riddle: "",
    answers: [],
    hint: "",
  };
}

// Verschiebt eine Station in der Reihenfolge (z. B. nach Drag & Drop).
// Gibt eine NEUE Liste zurück, die alte bleibt unverändert.
export function moveStation(stations, fromIndex, toIndex) {
  const result = [...stations];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

// 5 Nachkommastellen ≈ 1 m Genauigkeit – reicht und hält den Link kurz.
export function roundCoord(value) {
  return Math.round(value * 1e5) / 1e5;
}

// ---------------------------------------------------------------------------
// Lösungswörter
// ---------------------------------------------------------------------------

// Macht aus "  Kölner   DOM " → "koelner dom".
// Wird beim Erstellen UND beim Spielen benutzt, damit beide Seiten gleich rechnen.
export function normalizeAnswer(text) {
  return String(text)
    .normalize("NFC") // "ä" kann intern aus a + ¨ bestehen → zu einem Zeichen machen
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ");
}

// Berechnet den "Fingerabdruck" eines Lösungsworts.
// Die Jagd-ID wird mit eingerechnet, damit gleiche Wörter in
// verschiedenen Jagden verschiedene Hashes haben.
export async function hashAnswer(huntId, answer) {
  const text = huntId + ":" + normalizeAnswer(answer);
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const shortBytes = new Uint8Array(digest).slice(0, HASH_BYTES);
  return toBase64Url(shortBytes);
}

// Bytes → Base64url (wie Base64, aber ohne + / =, damit es in URLs passt).
function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Klartext-Jagd → Spiel-Jagd
// ---------------------------------------------------------------------------

// Ersetzt bei jeder Station "answers" (Klartext) durch "h" (Hashes).
// Leere Lösungswörter werden weggelassen.
export async function toPlayHunt(hunt) {
  const stations = [];
  for (const station of hunt.stations) {
    const answers = station.answers.filter((a) => normalizeAnswer(a) !== "");
    const h = [];
    for (const answer of answers) {
      h.push(await hashAnswer(hunt.id, answer));
    }
    const playStation = { lat: station.lat, lng: station.lng, riddle: station.riddle, h };
    if (station.hint) playStation.hint = station.hint;
    stations.push(playStation);
  }

  const playHunt = { v: hunt.v, id: hunt.id, title: hunt.title, skip: hunt.skip, stations };
  if (hunt.intro) playHunt.intro = hunt.intro;
  if (hunt.outro) playHunt.outro = hunt.outro;
  return playHunt;
}

// ---------------------------------------------------------------------------
// Prüfen vor dem Fertigstellen
// ---------------------------------------------------------------------------

// Gibt eine Liste von Fehlern zurück. Leere Liste = alles in Ordnung.
// station = Index der Station oder null, wenn es die ganze Jagd betrifft.
export function validateHunt(hunt) {
  const errors = [];

  if (hunt.title.trim() === "") {
    errors.push({ station: null, field: "title", message: "Bitte gib der Jagd einen Titel." });
  }
  if (hunt.stations.length === 0) {
    errors.push({ station: null, field: "stations", message: "Füge mindestens eine Station hinzu." });
  }
  if (hunt.skip.allowed) {
    const n = hunt.skip.afterFails;
    if (!Number.isInteger(n) || n < 1 || n > MAX_SKIP_FAILS) {
      errors.push({
        station: null,
        field: "skip",
        message: `Überspringen nach 1 bis ${MAX_SKIP_FAILS} Fehlversuchen.`,
      });
    }
  }

  hunt.stations.forEach((station, index) => {
    if (station.riddle.trim() === "") {
      errors.push({ station: index, field: "riddle", message: "Rätsel-Text fehlt." });
    }
    const hasAnswer = station.answers.some((a) => normalizeAnswer(a) !== "");
    if (!hasAnswer) {
      errors.push({ station: index, field: "answers", message: "Mindestens ein Lösungswort fehlt." });
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Kodieren / Dekodieren für den Link
// ---------------------------------------------------------------------------

// Objekt → kurzer Text, der sicher in einer URL stehen darf.
export function encodeHunt(hunt) {
  return LZString.compressToEncodedURIComponent(JSON.stringify(hunt));
}

// Text aus dem Link → Jagd-Objekt.
// Gibt null zurück, wenn der Link kaputt oder manipuliert ist.
// mode: "play" erwartet Hashes (h), "edit" erwartet Klartext (answers).
export function decodeHunt(text, mode) {
  let hunt;
  try {
    const json = LZString.decompressFromEncodedURIComponent(text);
    if (!json) return null;
    hunt = JSON.parse(json);
  } catch {
    return null;
  }
  return isValidStructure(hunt, mode) ? hunt : null;
}

// Prüft, ob die Daten die erwartete Form haben. Ein Link kann von
// jedem verändert werden, deshalb trauen wir dem Inhalt nicht blind.
function isValidStructure(hunt, mode) {
  if (!isObject(hunt)) return false;
  if (hunt.v !== FORMAT_VERSION) return false;
  if (!isString(hunt.id) || !isString(hunt.title)) return false;
  if (!isOptionalString(hunt.intro) || !isOptionalString(hunt.outro)) return false;
  if (!isObject(hunt.skip) || typeof hunt.skip.allowed !== "boolean") return false;
  if (!Number.isInteger(hunt.skip.afterFails)) return false;
  if (!Array.isArray(hunt.stations)) return false;

  const listKey = mode === "play" ? "h" : "answers";
  return hunt.stations.every(
    (s) =>
      isObject(s) &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      isString(s.riddle) &&
      isOptionalString(s.hint) &&
      Array.isArray(s[listKey]) &&
      s[listKey].every(isString)
  );
}

function isObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isString(x) {
  return typeof x === "string";
}
function isOptionalString(x) {
  return x === undefined || typeof x === "string";
}

// ---------------------------------------------------------------------------
// Links bauen und lesen
// ---------------------------------------------------------------------------

// baseUrl = Ordner der App, z. B. "https://name.github.io/stadtjagd/"
export function buildPlayLink(baseUrl, playHunt) {
  return new URL("play.html", baseUrl).href + "#j=" + encodeHunt(playHunt);
}

export function buildEditLink(baseUrl, hunt) {
  return new URL("create.html", baseUrl).href + "#e=" + encodeHunt(hunt);
}

// Liest den Teil hinter "#" (z. B. location.hash).
// Ergebnis: { mode: "play" | "edit", hunt } oder null.
export function parseLinkHash(hash) {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (text.startsWith("j=")) {
    const hunt = decodeHunt(text.slice(2), "play");
    return hunt ? { mode: "play", hunt } : null;
  }
  if (text.startsWith("e=")) {
    const hunt = decodeHunt(text.slice(2), "edit");
    return hunt ? { mode: "edit", hunt } : null;
  }
  return null;
}
