// texts.js – Lustige Sprüche für die Spieler-Ansicht.
//
// Kein DOM-Zugriff. Neue Sprüche einfach in die Listen schreiben.

export const TEXTS = {
  wrong: [
    "Fast! Aber nur fast.",
    "Netter Versuch.",
    "Das Rätsel lacht dich gerade aus.",
    "Knapp daneben ist auch vorbei.",
    "Hmm, das war's nicht.",
    "Leider nein. Kopf hoch!",
    "Sherlock würde nochmal nachdenken.",
    "Nope. Aber gib nicht auf!",
  ],
  right: [
    "Bingo!",
    "Läuft bei dir.",
    "Sherlock wäre stolz.",
    "Volltreffer!",
    "Zack, gelöst!",
    "Du bist ja ein Naturtalent.",
    "Genau richtig!",
  ],
  found: [
    "Gefunden! Du stehst genau richtig.",
    "Ziel erreicht!",
    "Na also, da bist du ja!",
  ],
  // Bewusst ohne Hinweis auf Entfernung oder Richtung
  notHere: [
    "Hier ist es noch nicht.",
    "Nicht ganz der richtige Ort.",
    "Weitersuchen!",
  ],
  skipped: [
    "Station übersprungen – weiter geht's.",
    "Egal, die nächste schaffst du!",
  ],
};

// Zufälliger Spruch aus einer Liste – möglichst nicht zweimal derselbe hintereinander.
const lastPicked = new Map();

export function pickText(list) {
  if (list.length === 1) return list[0];
  let text;
  do {
    text = list[Math.floor(Math.random() * list.length)];
  } while (text === lastPicked.get(list));
  lastPicked.set(list, text);
  return text;
}
