// ui-play.js – Oberfläche der Spieler-Ansicht (play.html).
//
// Hier passiert alles, was mit der Seite zu tun hat: Bildschirme umschalten,
// Klicks verarbeiten, Karte und GPS. Die eigentlichen Spielregeln stehen
// in game.js – diese Datei ruft sie nur auf.

import * as Hunt from "./hunt.js";
import * as Game from "./game.js";
import * as Storage from "./storage.js";
import { DEMO_HUNT } from "./demo-hunt.js";

const $ = (id) => document.getElementById(id);

// Zustand der Seite
let hunt = null; // Spiel-Jagd (mit Hashes)
let progress = null; // Fortschritt des Spielers
let hintOpen = false; // Hinweis an der aktuellen Station aufgeklappt?
let clockTimer = null;

// Karte und GPS
let gpsAvailable = "geolocation" in navigator;
let watchId = null;
let map = null;
let positionMarker = null;
let accuracyCircle = null;

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();

async function init() {
  hunt = await loadHunt();
  if (!hunt || hunt.stations.length === 0) {
    showScreen("error");
    return;
  }
  document.title = hunt.title + " – Stadtjagd";

  // Gespeicherten Fortschritt laden – sonst neu anlegen (die Uhr startet jetzt).
  const saved = Storage.load(Storage.KEYS.progress(hunt.id));
  if (saved && Game.isValidProgress(hunt, saved)) {
    progress = saved;
  } else {
    progress = Game.createProgress(Date.now());
    saveProgress();
  }

  bindEvents();

  if (Game.isFinished(progress)) {
    showFinished();
  } else if (!Storage.load(Storage.KEYS.introSeen(hunt.id))) {
    showIntro();
  } else {
    startRiddles();
  }
}

// Jagd aus dem Link lesen. Ohne Link: Demo-Jagd (vorübergehend).
async function loadHunt() {
  if (location.hash) {
    const parsed = Hunt.parseLinkHash(location.hash);
    return parsed && parsed.mode === "play" ? parsed.hunt : null;
  }
  return Hunt.toPlayHunt(DEMO_HUNT);
}

function bindEvents() {
  $("btn-start").addEventListener("click", onStartClick);
  $("answer-form").addEventListener("submit", onAnswerSubmit);
  $("btn-here").addEventListener("click", onHereClick);
  $("btn-hint").addEventListener("click", onHintClick);
  $("btn-skip").addEventListener("click", onSkipClick);
  $("btn-restart").addEventListener("click", onRestartClick);
  $("btn-replay").addEventListener("click", onRestartClick);
  // Neuer Link in derselben Seite eingefügt → komplett neu laden
  window.addEventListener("hashchange", () => location.reload());
}

// ---------------------------------------------------------------------------
// Bildschirme
// ---------------------------------------------------------------------------

function showScreen(name) {
  for (const screen of ["error", "intro", "riddle", "finished"]) {
    $("screen-" + screen).hidden = screen !== name;
  }
  window.scrollTo(0, 0);
}

function showIntro() {
  $("intro-title").textContent = hunt.title;
  $("intro-text").textContent = hunt.intro || "";
  $("intro-text").hidden = !hunt.intro;
  showScreen("intro");
}

function startRiddles() {
  showScreen("riddle");
  startClock();
  startGps(); // erst jetzt, weil die Karte sichtbar sein muss
  renderRiddle();
}

// Zeigt die aktuelle Station an.
function renderRiddle() {
  const station = Game.currentStation(hunt, progress);
  const total = hunt.stations.length;

  $("station-label").textContent = `Station ${progress.current + 1} von ${total}`;
  $("progress-fill").style.width = (progress.current / total) * 100 + "%";
  $("riddle-text").textContent = station.riddle;
  $("hint-text").textContent = station.hint || "";
  renderButtons();
}

// Welche Buttons gerade sichtbar sind, hängt vom Fortschritt ab.
function renderButtons() {
  $("btn-here").hidden = !gpsAvailable;
  $("btn-hint").hidden = !Game.canShowHint(hunt, progress) || hintOpen;
  $("hint-text").hidden = !hintOpen;
  $("btn-skip").hidden = !Game.canSkip(hunt, progress);
}

function showFinished() {
  stopClock();
  stopGps();

  const skipped = progress.skipped.length;
  $("finished-title").textContent = hunt.title;
  $("finished-time").textContent = Game.formatDuration(Game.elapsedMs(progress, Date.now()));
  $("finished-skipped").textContent =
    skipped === 1 ? "1 Station übersprungen" : `${skipped} Stationen übersprungen`;
  $("finished-skipped").hidden = skipped === 0;
  $("outro-text").textContent = hunt.outro || "";
  $("outro-text").hidden = !hunt.outro;
  showScreen("finished");
}

function setFeedback(text, type) {
  const el = $("feedback");
  el.textContent = text;
  el.className = "feedback" + (type ? " is-" + type : "");
}

// ---------------------------------------------------------------------------
// Aktionen des Spielers
// ---------------------------------------------------------------------------

function onStartClick() {
  Storage.save(Storage.KEYS.introSeen(hunt.id), true);
  startRiddles();
}

async function onAnswerSubmit(event) {
  event.preventDefault(); // Formular nicht wirklich abschicken (kein Server!)
  const input = $("answer-input");
  const button = $("btn-check");
  if (input.value.trim() === "") return;

  button.disabled = true;
  const result = await Game.checkAnswer(hunt, progress, input.value, Date.now());
  button.disabled = false;
  input.value = "";

  if (result.correct) {
    onStationSolved(result.progress, "Richtig! Weiter geht's.");
  } else {
    updateProgress(result.progress);
    setFeedback("Leider falsch. Versuch's nochmal!", "error");
    renderButtons();
    input.focus();
  }
}

function onHereClick() {
  const button = $("btn-here");
  button.disabled = true;
  button.textContent = "Prüfe Standort …";

  const done = () => {
    button.disabled = false;
    button.textContent = "Ich bin da";
  };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      done();
      const position = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      const result = Game.checkLocation(hunt, progress, position, Date.now());
      if (result.result === "solved") {
        onStationSolved(result.progress, "Gefunden! Weiter geht's.");
      } else if (result.result === "inaccurate") {
        setFeedback("GPS gerade ungenau – versuch's gleich nochmal oder gib das Lösungswort ein.", "error");
      } else {
        // Bewusst ohne Entfernung oder Richtung!
        setFeedback("Hier ist es noch nicht.", "error");
      }
    },
    (err) => {
      done();
      if (err.code === err.PERMISSION_DENIED) {
        disableGps();
      } else {
        setFeedback("Standort nicht gefunden – versuch's nochmal oder gib das Lösungswort ein.", "error");
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function onHintClick() {
  hintOpen = true;
  renderButtons();
}

function onSkipClick() {
  if (!Game.canSkip(hunt, progress)) return;
  if (!confirm("Diese Station wirklich überspringen?")) return;
  onStationSolved(Game.skipStation(hunt, progress, Date.now()), "Station übersprungen.");
}

function onRestartClick() {
  if (!confirm("Jagd wirklich neu starten? Fortschritt und Zeit werden zurückgesetzt.")) return;
  stopClock();
  stopGps();
  updateProgress(Game.createProgress(Date.now()));
  Storage.remove(Storage.KEYS.introSeen(hunt.id));
  hintOpen = false;
  setFeedback("");
  showIntro();
}

// Gemeinsamer Weg nach "geschafft" (Wort, GPS oder Überspringen).
function onStationSolved(newProgress, message) {
  updateProgress(newProgress);
  hintOpen = false;
  if (Game.isFinished(progress)) {
    setFeedback("");
    showFinished();
  } else {
    renderRiddle();
    setFeedback(message, "success");
    window.scrollTo(0, 0);
  }
}

function updateProgress(newProgress) {
  progress = newProgress;
  saveProgress();
}

function saveProgress() {
  Storage.save(Storage.KEYS.progress(hunt.id), progress);
}

// ---------------------------------------------------------------------------
// Uhr
// ---------------------------------------------------------------------------

function startClock() {
  updateClock();
  if (clockTimer === null) {
    clockTimer = setInterval(updateClock, 1000);
  }
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

function updateClock() {
  $("clock").textContent = Game.formatDuration(Game.elapsedMs(progress, Date.now()));
}

// ---------------------------------------------------------------------------
// Karte und GPS
// ---------------------------------------------------------------------------

// Zeigt nur den EIGENEN Standort – niemals die Station.
function startGps() {
  if (!gpsAvailable) {
    disableGps();
    return;
  }
  if (watchId !== null) return; // läuft schon

  initMap();
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 10000,
  });
}

function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Spieler hat GPS verweigert oder es gibt keins → nur Lösungswort.
function disableGps() {
  gpsAvailable = false;
  stopGps();
  $("map-wrap").hidden = true;
  $("no-gps").hidden = false;
  renderButtons();
}

function initMap() {
  if (map) return;
  // Startansicht ist egal: Die Karte bleibt verdeckt, bis der eigene Standort da ist.
  map = L.map("map").setView([51.1657, 10.4515], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

function onPosition(pos) {
  const latLng = [pos.coords.latitude, pos.coords.longitude];
  if (!positionMarker) {
    accuracyCircle = L.circle(latLng, { radius: pos.coords.accuracy, weight: 1, fillOpacity: 0.1 }).addTo(map);
    positionMarker = L.circleMarker(latLng, {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#2ec4b6",
      fillOpacity: 1,
    }).addTo(map);
    map.setView(latLng, 17); // nur beim ersten Mal zentrieren, danach darf man frei schieben
    $("map-status").hidden = true;
  } else {
    positionMarker.setLatLng(latLng);
    accuracyCircle.setLatLng(latLng).setRadius(pos.coords.accuracy);
  }
}

function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    disableGps();
  } else if (!positionMarker) {
    $("map-status").textContent = "Standort gerade nicht verfügbar …";
  }
}
