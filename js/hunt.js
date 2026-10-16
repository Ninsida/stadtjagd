// hunt.js – Datenformat einer Jagd: anlegen, prüfen, Lösungen hashen,
// in einen Link kodieren und wieder auslesen.
//
// Kein DOM-Zugriff! Benötigt nur:
//   - LZString (globale Variable, per <script> vom CDN geladen)
//   - crypto (im Browser und in Node eingebaut)

// Zwei Formate: Der Editor arbeitet mit v2 (kennt Teams), die Spiel-Links
// bleiben v1 (+ optionale Team-Felder). So funktionieren alte Spiel-Links weiter.
export const FORMAT_VERSION = 2;
export const PLAY_VERSION = 1;
export const MAX_SKIP_FAILS = 10;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 8;

// Feste Teamfarben – gut unterscheidbar, auch auf der Karte
export const TEAM_COLORS = ["#ff5a5f", "#3a86ff", "#2a9d4b", "#ffbe0b", "#8338ec", "#fb5607", "#2ec4b6", "#ff006e"];

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
    teams: [], // leer = klassische Jagd ohne Teams
    shuffle: true, // Reihenfolge pro Team per Rotation mischen
    finale: { enabled: false, riddle: "", answer: "" },
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
    goal: false, // gemeinsames Ziel: für alle Teams immer die letzte Station
    teams: null, // null = alle Teams, sonst Liste der Team-Nummern (0-basiert)
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

// ---------------------------------------------------------------------------
// Teams und Routen
// ---------------------------------------------------------------------------

export function hasTeams(hunt) {
  return hunt.teams.length > 0;
}

// Neues Team mit Standardnamen und der ersten noch freien Farbe.
export function createTeam(hunt) {
  const used = hunt.teams.map((t) => t.color);
  const color = TEAM_COLORS.find((c) => !used.includes(c)) ?? TEAM_COLORS[0];
  return { name: "Team " + (hunt.teams.length + 1), color };
}

// Entfernt ein Team und passt die Team-Nummern in den Stationen an
// (aus Team 3 wird Team 2, wenn Team 2 gelöscht wurde).
// Gibt eine NEUE Jagd zurück.
export function removeTeam(hunt, teamIndex) {
  return {
    ...hunt,
    teams: hunt.teams.filter((_, i) => i !== teamIndex),
    stations: hunt.stations.map((s) => {
      if (s.teams === null) return s;
      const teams = s.teams.filter((t) => t !== teamIndex).map((t) => (t > teamIndex ? t - 1 : t));
      return { ...s, teams };
    }),
  };
}

export function stationBelongsToTeam(station, teamIndex) {
  return station.teams === null || station.teams.includes(teamIndex);
}

// Berechnet die Route (Liste von Stations-Nummern) für jedes Team.
// Ohne Teams gibt es genau eine Route.
//  1. Stationen des Teams nehmen (ohne das Ziel)
//  2. bei "shuffle" um die Team-Nummer weiterdrehen:
//     A B C → Team 1: A B C, Team 2: B C A, Team 3: C A B
//  3. das Ziel ans Ende hängen
export function teamRoutes(hunt) {
  const goal = hunt.stations.findIndex((s) => s.goal);
  const teamCount = hasTeams(hunt) ? hunt.teams.length : 1;
  const routes = [];

  for (let t = 0; t < teamCount; t++) {
    let route = [];
    hunt.stations.forEach((station, index) => {
      if (index === goal) return;
      if (!hasTeams(hunt) || stationBelongsToTeam(station, t)) route.push(index);
    });
    if (hasTeams(hunt) && hunt.shuffle && route.length > 0) {
      const shift = t % route.length;
      route = [...route.slice(shift), ...route.slice(0, shift)];
    }
    if (goal >= 0) route.push(goal);
    routes.push(route);
  }
  return routes;
}

// Finale-Wort ohne Leerzeichen – so ist egal, ob man "Berliner Dom" oder "BerlinerDom" tippt.
export function finaleKey(answer) {
  return String(answer).replace(/\s+/g, "");
}

// Teilt das Finale-Wort gleichmäßig auf: "Schatz", 3 Teams → ["SC", "HA", "TZ"].
// Bleiben Buchstaben übrig, bekommen die ersten Teams einen mehr.
export function splitFinale(answer, count) {
  const letters = Array.from(finaleKey(answer).toUpperCase()); // Array.from: Umlaute zählen als 1 Zeichen
  const base = Math.floor(letters.length / count);
  const extra = letters.length % count;
  const parts = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    parts.push(letters.slice(pos, pos + size).join(""));
    pos += size;
  }
  return parts;
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

// "Fingerabdruck" der Route einer Spiel-Jagd: Orte, Reihenfolge und Lösungen.
// Ändert der Ersteller davon etwas, passt alter Spieler-Fortschritt nicht mehr.
// Texte (Rätsel, Hinweise, Titel) zählen bewusst nicht – ein Tippfehler-Fix
// soll niemanden zurück auf Start schicken.
export async function routeFingerprint(playHunt) {
  const route = playHunt.stations.map((s) => [s.lat, s.lng, s.h]);
  const data = new TextEncoder().encode(JSON.stringify(route));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest).slice(0, 6));
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

// Klassische Spiel-Jagd ohne Teams (das Ziel – falls markiert – kommt zuletzt).
export async function toPlayHunt(hunt) {
  const route = teamRoutes({ ...hunt, teams: [] })[0];
  return buildPlayHunt(hunt, route, null);
}

// Eine Spiel-Jagd pro Team – oder genau eine ohne Teams.
// Ergebnis: [{ team: { name, color } | null, playHunt }]
export async function toPlayHunts(hunt) {
  const routes = teamRoutes(hunt);
  const result = [];
  for (let t = 0; t < routes.length; t++) {
    const teamIndex = hasTeams(hunt) ? t : null;
    result.push({
      team: teamIndex === null ? null : hunt.teams[t],
      playHunt: await buildPlayHunt(hunt, routes[t], teamIndex),
    });
  }
  return result;
}

// Baut die Spiel-Jagd für eine Route. Dabei werden die Lösungen gehasht:
// "answers" (Klartext) wird zu "h". Leere Lösungswörter fallen weg.
// Jedes Team bekommt eine eigene ID ("abc123-2") – dadurch eigener Fortschritt
// und eigene Hashes.
async function buildPlayHunt(hunt, route, teamIndex) {
  const id = teamIndex === null ? hunt.id : `${hunt.id}-${teamIndex + 1}`;

  const stations = [];
  for (const index of route) {
    const station = hunt.stations[index];
    const answers = station.answers.filter((a) => normalizeAnswer(a) !== "");
    const h = [];
    for (const answer of answers) {
      h.push(await hashAnswer(id, answer));
    }
    const playStation = { lat: station.lat, lng: station.lng, riddle: station.riddle, h };
    if (station.hint) playStation.hint = station.hint;
    stations.push(playStation);
  }

  const playHunt = { v: PLAY_VERSION, id, title: hunt.title, skip: hunt.skip, stations };
  if (hunt.intro) playHunt.intro = hunt.intro;
  if (hunt.outro) playHunt.outro = hunt.outro;

  if (teamIndex !== null) {
    const team = hunt.teams[teamIndex];
    const count = hunt.teams.length;
    playHunt.team = { name: team.name, color: team.color, number: teamIndex + 1, count };
    if (hunt.finale.enabled) {
      playHunt.finale = {
        riddle: hunt.finale.riddle,
        part: splitFinale(hunt.finale.answer, count)[teamIndex],
        partNumber: teamIndex + 1,
        h: [await hashAnswer(id, finaleKey(hunt.finale.answer))],
      };
    }
  }
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

  const goals = hunt.stations.filter((s) => s.goal).length;
  if (goals > 1) {
    errors.push({ station: null, field: "goal", message: "Nur eine Station kann das Ziel sein." });
  }

  if (hasTeams(hunt)) {
    const n = hunt.teams.length;
    if (n < MIN_TEAMS || n > MAX_TEAMS) {
      errors.push({ station: null, field: "teams", message: `Mit Teams spielen: ${MIN_TEAMS} bis ${MAX_TEAMS} Teams.` });
    }
    if (hunt.teams.some((t) => t.name.trim() === "")) {
      errors.push({ station: null, field: "teams", message: "Jedes Team braucht einen Namen." });
    }
    teamRoutes(hunt).forEach((route, t) => {
      if (route.length === 0) {
        errors.push({ station: null, field: "teams", message: `${hunt.teams[t].name || "Ein Team"} hat noch keine Station.` });
      }
    });
    if (hunt.finale.enabled) {
      if (hunt.finale.riddle.trim() === "") {
        errors.push({ station: null, field: "finale", message: "Das Finale braucht einen Rätsel-Text." });
      }
      if (Array.from(finaleKey(hunt.finale.answer)).length < n) {
        errors.push({
          station: null,
          field: "finale",
          message: `Das Finale-Wort braucht mindestens ${n} Buchstaben – einen pro Team.`,
        });
      }
    }
  }

  hunt.stations.forEach((station, index) => {
    if (hasTeams(hunt) && station.teams !== null && station.teams.length === 0) {
      errors.push({ station: index, field: "teams", message: "Gehört zu keinem Team." });
    }
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

// Macht aus gespeicherten Daten (Entwurf oder Bearbeiten-Link) eine Jagd,
// mit der der Editor sicher arbeiten kann: fehlende Felder bekommen
// Standardwerte, alte v1-Jagden werden auf v2 gehoben, eine kaputte
// Fehlversuch-Zahl wird 3. Gibt null zurück, wenn die Daten grundsätzlich nicht passen.
export function toEditableHunt(raw) {
  if (!isObject(raw)) return null;
  if (raw.v !== 1 && raw.v !== FORMAT_VERSION) return null;
  const skip = isObject(raw.skip) ? raw.skip : {};
  const finale = isObject(raw.finale) ? raw.finale : {};
  const hunt = {
    ...raw,
    v: FORMAT_VERSION,
    intro: raw.intro ?? "",
    outro: raw.outro ?? "",
    skip: {
      allowed: skip.allowed === true,
      afterFails: Number.isInteger(skip.afterFails) ? skip.afterFails : 3,
    },
    teams: raw.teams ?? [],
    shuffle: raw.shuffle ?? true,
    finale: {
      enabled: finale.enabled === true,
      riddle: finale.riddle ?? "",
      answer: finale.answer ?? "",
    },
    stations: Array.isArray(raw.stations)
      ? raw.stations.map((s) =>
          isObject(s) ? { ...s, hint: s.hint ?? "", goal: s.goal === true, teams: s.teams ?? null } : s
        )
      : raw.stations,
  };
  return isValidStructure(hunt, "edit") ? hunt : null;
}

// Prüft, ob die Daten die erwartete Form haben. Ein Link kann von
// jedem verändert werden, deshalb trauen wir dem Inhalt nicht blind.
function isValidStructure(hunt, mode) {
  if (!isObject(hunt)) return false;
  const versionOk = mode === "play" ? hunt.v === PLAY_VERSION : hunt.v === 1 || hunt.v === FORMAT_VERSION;
  if (!versionOk) return false;
  if (!isString(hunt.id) || !isString(hunt.title)) return false;
  if (!isOptionalString(hunt.intro) || !isOptionalString(hunt.outro)) return false;
  if (!isObject(hunt.skip) || typeof hunt.skip.allowed !== "boolean") return false;
  if (!Number.isInteger(hunt.skip.afterFails)) return false;
  if (!Array.isArray(hunt.stations)) return false;

  if (mode === "play") {
    if (hunt.team !== undefined && !isValidPlayTeam(hunt.team)) return false;
    if (hunt.finale !== undefined && !isValidPlayFinale(hunt.finale)) return false;
  } else {
    if (hunt.teams !== undefined && !(Array.isArray(hunt.teams) && hunt.teams.every(isValidTeam))) return false;
    if (hunt.shuffle !== undefined && typeof hunt.shuffle !== "boolean") return false;
    if (hunt.finale !== undefined && !isValidEditFinale(hunt.finale)) return false;
  }

  const listKey = mode === "play" ? "h" : "answers";
  return hunt.stations.every(
    (s) =>
      isObject(s) &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      isString(s.riddle) &&
      isOptionalString(s.hint) &&
      Array.isArray(s[listKey]) &&
      s[listKey].every(isString) &&
      (s.goal === undefined || typeof s.goal === "boolean") &&
      (s.teams === undefined || s.teams === null || (Array.isArray(s.teams) && s.teams.every(Number.isInteger)))
  );
}

// Farben landen später im Stil der Seite – deshalb nur echte #rrggbb-Werte erlauben.
function isColor(x) {
  return isString(x) && /^#[0-9a-f]{6}$/i.test(x);
}
function isValidTeam(t) {
  return isObject(t) && isString(t.name) && isColor(t.color);
}
function isValidPlayTeam(t) {
  return isValidTeam(t) && Number.isInteger(t.number) && Number.isInteger(t.count);
}
function isValidEditFinale(f) {
  return isObject(f) && typeof f.enabled === "boolean" && isString(f.riddle) && isString(f.answer);
}
function isValidPlayFinale(f) {
  return (
    isObject(f) && isString(f.riddle) && isString(f.part) && Number.isInteger(f.partNumber) &&
    Array.isArray(f.h) && f.h.every(isString)
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
