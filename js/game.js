// game.js – Spiellogik: Fortschritt, Lösung prüfen, Abstand, Zeit.
//
// Kein DOM-Zugriff! Alle Funktionen bekommen Daten rein und geben
// NEUE Daten zurück, statt die alten zu verändern. "now" (Zeitstempel in ms)
// wird von außen übergeben – so lässt sich alles leicht testen.

import { hashAnswer } from "./hunt.js";

export const SOLVE_RADIUS_M = 30; // so nah muss man an der Station sein
export const MAX_GPS_ACCURACY_M = 50; // ungenauere Positionen akzeptieren wir nicht

const EARTH_RADIUS_M = 6371000;

// ---------------------------------------------------------------------------
// Fortschritt
// ---------------------------------------------------------------------------

// Neuer Fortschritt beim ersten Öffnen – die Uhr startet jetzt.
export function createProgress(now) {
  return {
    startedAt: now,
    current: 0, // Index der aktuellen Station
    fails: 0, // Fehlversuche an der aktuellen Station
    skipped: [], // Indizes übersprungener Stationen
    finishedAt: null,
  };
}

export function isFinished(progress) {
  return progress.finishedAt !== null;
}

// Die Station, an der der Spieler gerade ist (oder null, wenn fertig).
export function currentStation(hunt, progress) {
  if (isFinished(progress)) return null;
  return hunt.stations[progress.current] ?? null;
}

// Prüft, ob ein gespeicherter Fortschritt zu dieser Jagd passt.
// (localStorage kann alte oder kaputte Daten enthalten.)
export function isValidProgress(hunt, progress) {
  return (
    typeof progress === "object" &&
    progress !== null &&
    Number.isFinite(progress.startedAt) &&
    Number.isInteger(progress.current) &&
    progress.current >= 0 &&
    progress.current <= hunt.stations.length &&
    Number.isInteger(progress.fails) &&
    Array.isArray(progress.skipped) &&
    (progress.finishedAt === null || Number.isFinite(progress.finishedAt))
  );
}

// Zur nächsten Station gehen. Nach der letzten ist die Jagd beendet.
function advance(hunt, progress, now) {
  const next = progress.current + 1;
  return {
    ...progress,
    current: next,
    fails: 0,
    finishedAt: next >= hunt.stations.length ? now : null,
  };
}

// ---------------------------------------------------------------------------
// Lösung per Lösungswort
// ---------------------------------------------------------------------------

// Ergebnis: { correct: true/false, progress: neuer Fortschritt }
export async function checkAnswer(hunt, progress, input, now) {
  const station = currentStation(hunt, progress);
  if (!station) return { correct: false, progress };

  const inputHash = await hashAnswer(hunt.id, input);
  if (station.h.includes(inputHash)) {
    return { correct: true, progress: advance(hunt, progress, now) };
  }
  return { correct: false, progress: { ...progress, fails: progress.fails + 1 } };
}

// ---------------------------------------------------------------------------
// Lösung per GPS ("Ich bin da")
// ---------------------------------------------------------------------------

// Abstand zwischen zwei Punkten auf der Erde in Metern (Haversine-Formel).
// a und b: { lat, lng }
export function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// position: { lat, lng, accuracy } – accuracy in Metern, wie vom Browser geliefert.
// Ergebnis: { result: "solved" | "too-far" | "inaccurate", progress }
// Ein GPS-Fehlschlag zählt NICHT als Fehlversuch.
export function checkLocation(hunt, progress, position, now) {
  const station = currentStation(hunt, progress);
  if (!station) return { result: "too-far", progress };

  if (position.accuracy > MAX_GPS_ACCURACY_M) {
    return { result: "inaccurate", progress };
  }
  if (distanceMeters(position, station) <= SOLVE_RADIUS_M) {
    return { result: "solved", progress: advance(hunt, progress, now) };
  }
  return { result: "too-far", progress };
}

// ---------------------------------------------------------------------------
// Hinweis und Überspringen
// ---------------------------------------------------------------------------

// Hinweis erst nach dem 1. Fehlversuch – und nur, wenn es einen gibt.
export function canShowHint(hunt, progress) {
  const station = currentStation(hunt, progress);
  return Boolean(station && station.hint) && progress.fails >= 1;
}

export function canSkip(hunt, progress) {
  const station = currentStation(hunt, progress);
  return Boolean(station) && hunt.skip.allowed && progress.fails >= hunt.skip.afterFails;
}

export function skipStation(hunt, progress, now) {
  if (!canSkip(hunt, progress)) return progress;
  const skipped = [...progress.skipped, progress.current];
  return advance(hunt, { ...progress, skipped }, now);
}

// ---------------------------------------------------------------------------
// Zeit
// ---------------------------------------------------------------------------

// Vergangene Zeit in ms. Nach dem Ende bleibt die Uhr stehen.
export function elapsedMs(progress, now) {
  const end = progress.finishedAt ?? now;
  return Math.max(0, end - progress.startedAt);
}

// 75000 → "01:15", 3725000 → "1:02:05"
export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
