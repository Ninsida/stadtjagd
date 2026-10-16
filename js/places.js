// places.js – Sehenswerte Orte in der Nähe und automatische Jagden.
//
// Kein DOM-Zugriff. Die Orte kommen aus der Ortssuche der deutschen Wikipedia
// (alle Artikel mit Koordinaten im Umkreis). Sie ist schnell, kostenlos und
// zuverlässig. Achtung Datenschutz: Dafür geht eine Position (Kartenmitte oder
// Standort) an Wikipedia – deshalb fragt die Oberfläche vorher um Erlaubnis.

import { createHunt, createStation, roundCoord } from "./hunt.js";
import { distanceMeters } from "./game.js";

const WIKI_API = "https://de.wikipedia.org/w/api.php";
const TIMEOUT_MS = 12000;

// Ortsarten: woran man sie am Namen erkennt und welcher Rätsel-Text passt.
// Reihenfolge zählt – "Paulustor" ist ein Tor, auch wenn "Paulus" nach Kirche klingt.
// "the" = wie man im Rätsel nach dem Namen fragt.
export const PLACE_KINDS = {
  fountain: { match: /brunnen/i, label: "Brunnen", clue: "Hier plätschert Wasser.", the: "der Brunnen" },
  gate: { match: /tor(\s|$)/i, label: "Tor", clue: "Durch dieses Tor kam man früher in die Stadt.", the: "das Tor" },
  worship: {
    match: /kirche|kapelle|\bdom\b|münster|kathedrale|basilika|synagoge|moschee|abtei|kloster/i,
    label: "Gotteshaus",
    clue: "Hier wird gebetet und gesungen.",
    the: "das Gotteshaus",
  },
  museum: { match: /museum/i, label: "Museum", clue: "Hier wird Spannendes ausgestellt.", the: "das Museum" },
  library: { match: /bibliothek|bücherei/i, label: "Bibliothek", clue: "Hier stehen tausende Geschichten im Regal.", the: "die Bibliothek" },
  theater: { match: /theater|oper(nhaus)?\b|konzerthaus|philharmonie/i, label: "Bühne", clue: "Hier gibt es Vorhang auf und Applaus.", the: "das Haus" },
  townhall: { match: /rathaus/i, label: "Rathaus", clue: "Hier wird die Stadt regiert.", the: "das Rathaus" },
  tower: { match: /turm|türme/i, label: "Turm", clue: "Etwas Hohes ragt in den Himmel.", the: "der Turm" },
  clock: { match: /uhr(\s|$)/i, label: "Uhr", clue: "Hier zeigt eine Uhr allen die Zeit.", the: "die Uhr" },
  monument: {
    match: /denkmal|säule|statue|skulptur|plastik|obelisk|monument/i,
    label: "Denkmal",
    clue: "Ein Denkmal erinnert an etwas Besonderes.",
    the: "das Denkmal",
  },
  bridge: { match: /brücke|steg(\s|$)/i, label: "Brücke", clue: "Hier geht es trockenen Fußes übers Wasser.", the: "die Brücke" },
  castle: { match: /schloss|palais|festung|zitadelle|\bburg\b/i, label: "Schloss/Burg", clue: "Hier wohnten früher wichtige Leute.", the: "das Bauwerk" },
  park: { match: /park(\s|$)|garten(\s|$)|gärten(\s|$)/i, label: "Park", clue: "Ein grüner Ort zum Durchatmen.", the: "der Park" },
  viewpoint: { match: /aussicht/i, label: "Aussichtspunkt", clue: "Von hier habt ihr einen tollen Ausblick.", the: "der Aussichtspunkt" },
  square: { match: /platz$/i, label: "Platz", clue: "Ein großer Platz, auf dem sich viele Menschen treffen.", the: "der Platz" },
  house: { match: /\bhaus\b/i, label: "Gebäude", clue: "Ein ganz besonderes Haus.", the: "das Haus" },
};

// Was nicht in ein Spiel gehört: Schulen und Kitas (Kinder), Friedhöfe und
// Gedenkstätten (Respekt), Firmen, Banken, Hotels, Bahnhöfe, Straßen.
const EXCLUDE = new RegExp(
  [
    "schule", "gymnasium", "kita", "kindergarten", "universität", "campus",
    "friedhof", "gedenkstätte", "grabmal", "grabstätte",
    "bank", "sparkasse", "versicherung", "gmbh", "\\bag\\b", "verein", "stiftung", "verband", "club",
    "klinik", "krankenhaus", "hospital", "hotel", "hôtel", "\\binn\\b", "radisson",
    "bahnhof", "haltestelle", "straße", "strasse", "gasse", "allee", "\\bweg\\b",
    "kaufhaus", "center", "centre", "werk\\b", "bezirk", "kreis", "ortsteil",
  ].join("|"),
  "i"
);

// Wikipedia-Koordinatentypen, die keine besuchbaren Orte sind
const SKIP_TYPES = ["city", "country", "state", "adm1st", "adm2nd", "adm3rd", "railwaystation", "airport", "event", "edu"];

// Umkreis-Stufen für die automatische Jagd (Luftlinie vom Start)
export const DISTANCES = {
  short: { radius: 500, label: "kurz (ca. 500 m Umkreis)" },
  medium: { radius: 1000, label: "mittel (ca. 1 km Umkreis)" },
  long: { radius: 2000, label: "lang (ca. 2 km Umkreis)" },
};

const DIRECTIONS = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];

// ---------------------------------------------------------------------------
// Orte laden
// ---------------------------------------------------------------------------

// Adresse der Wikipedia-Ortssuche. "origin=*" erlaubt den Aufruf aus dem Browser.
export function buildSearchUrl(lat, lng, radius) {
  const params = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${roundCoord(lat)}|${roundCoord(lng)}`,
    gsradius: String(Math.min(10000, Math.round(radius))), // Wikipedia erlaubt max. 10 km
    gslimit: "200",
    gsprop: "type",
    format: "json",
    origin: "*",
  });
  return `${WIKI_API}?${params}`;
}

// Fragt Wikipedia und gibt eine aufgeräumte Liste von Orten zurück.
// Wirft einen Fehler mit verständlicher Meldung, wenn es nicht klappt.
export async function fetchPlaces(lat, lng, radius) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(buildSearchUrl(lat, lng, radius), { signal: controller.signal });
    if (!response.ok) throw new Error("http");
    return parsePlaces(await response.json());
  } catch {
    throw new Error("Die Orte konnten nicht geladen werden. Bist du online? Versuch es gleich nochmal.");
  } finally {
    clearTimeout(timer);
  }
}

// Wikipedia-Antwort → [{ lat, lng, name, kind }]
// Nur Orte, deren Name zu einer bekannten Ortsart passt.
export function parsePlaces(json) {
  const places = [];
  const seen = new Set();
  for (const item of json.query?.geosearch ?? []) {
    if (SKIP_TYPES.includes(item.type)) continue;
    const name = cleanTitle(item.title ?? "");
    if (!name || /\d/.test(name) || EXCLUDE.test(name)) continue; // Ziffern: meist Hausnummern
    const kind = kindOf(name);
    if (!kind || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    places.push({ lat: roundCoord(item.lat), lng: roundCoord(item.lon), name, kind });
  }
  return places;
}

// "Weltzeituhr (Alexanderplatz)" → "Weltzeituhr" – der Teil in Klammern
// unterscheidet nur gleichnamige Artikel und steht nicht am Ort.
export function cleanTitle(title) {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function kindOf(name) {
  for (const [kind, { match }] of Object.entries(PLACE_KINDS)) {
    if (match.test(name)) return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rätsel aus einem Ort
// ---------------------------------------------------------------------------

// Himmelsrichtung von a nach b, z. B. "Nordosten"
export function directionName(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360; // 0 = Norden, 90 = Osten
  return DIRECTIONS[Math.round(bearing / 45) % 8];
}

// Station im Editor-Format aus einem Ort. "from" = wo die Spieler vorher sind
// (Start oder vorige Station) – daraus entsteht die Wegbeschreibung.
export function stationFromPlace(place, from) {
  const info = PLACE_KINDS[place.kind];
  let way = "";
  if (from) {
    const meters = Math.max(50, Math.round(distanceMeters(from, place) / 50) * 50); // auf 50 m runden
    way = ` Geht etwa ${meters} m Richtung ${directionName(from, place)}.`;
  }
  const letters = Array.from(place.name.replace(/\s+/g, ""));
  return {
    ...createStation(place.lat, place.lng),
    riddle: `${info.clue}${way} Wie heißt ${info.the}?`,
    answers: answersFor(place),
    hint: `Der Name beginnt mit „${letters.slice(0, 2).join("")}…“ und hat ${letters.length} Buchstaben.`,
  };
}

// Lösungswörter: der ganze Name – und bei langen Namen zusätzlich das
// Kernwort, z. B. "Berliner Fernsehturm" → auch "Fernsehturm".
export function answersFor(place) {
  const { match } = PLACE_KINDS[place.kind];
  const words = place.name.split(/[\s-]+/).filter((w) => w.length >= 4);
  const core = words.filter((w) => match.test(w)).sort((a, b) => b.length - a.length)[0];
  return core && core !== place.name ? [place.name, core] : [place.name];
}

// ---------------------------------------------------------------------------
// Automatische Jagd
// ---------------------------------------------------------------------------

// Wählt "count" Orte für einen Rundgang ab "start":
// - immer den "besten" nächsten Ort: nah, aber mindestens MIN_SPACING von allen
//   bisherigen entfernt (sonst zwei Stationen am selben Platz)
// - Abwechslung: Ortsarten, die schon dran waren, zählen als weiter weg
// - etwas Zufall, damit "nochmal" eine andere Jagd ergibt
// rng = Zufallsfunktion (für Tests austauschbar)
const MIN_SPACING = 80; // Meter
const SAME_KIND_PENALTY = 250; // "gefühlte" Extra-Meter für eine schon benutzte Ortsart

export function pickRoute(places, start, count, rng = Math.random) {
  const route = [];
  const usedKinds = {};
  let current = start;
  let remaining = places.filter((p) => distanceMeters(start, p) >= 40); // nicht direkt am Start

  while (route.length < count && remaining.length > 0) {
    let best = null;
    let bestScore = Infinity;
    for (const place of remaining) {
      const score =
        (distanceMeters(current, place) + (usedKinds[place.kind] ?? 0) * SAME_KIND_PENALTY) * (0.75 + rng() * 0.5);
      if (score < bestScore) {
        best = place;
        bestScore = score;
      }
    }
    route.push(best);
    usedKinds[best.kind] = (usedKinds[best.kind] ?? 0) + 1;
    current = best;
    remaining = remaining.filter((p) => p !== best && distanceMeters(best, p) >= MIN_SPACING);
  }
  return route;
}

// Komplette Jagd im Editor-Format. Die letzte Station ist das Ziel.
export function buildAutoHunt(places, start, count, rng = Math.random) {
  const route = pickRoute(places, start, count, rng);
  const hunt = createHunt();
  hunt.title = "Entdeckertour";
  hunt.intro =
    "Diese Jagd führt euch zu Sehenswürdigkeiten in der Nähe. " +
    "Löst die Rätsel per Lösungswort – oder geht hin und tippt „Ich bin da“.";
  hunt.stations = route.map((place, i) => stationFromPlace(place, i === 0 ? start : route[i - 1]));
  if (hunt.stations.length > 0) hunt.stations[hunt.stations.length - 1].goal = true;
  return hunt;
}
