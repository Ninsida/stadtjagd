// ui-play.js – Oberfläche der Spieler-Ansicht (play.html).
//
// Hier passiert alles, was mit der Seite zu tun hat: Bildschirme umschalten,
// Klicks verarbeiten, Karte und GPS. Die eigentlichen Spielregeln stehen
// in game.js – diese Datei ruft sie nur auf.

import * as Hunt from "./hunt.js";
import * as Game from "./game.js";
import * as Storage from "./storage.js";
import "./pwa.js"; // als App installierbar, lädt auch bei schlechtem Netz
import { TEXTS, pickText } from "./texts.js";
import { launchConfetti } from "./confetti.js";

const $ = (id) => document.getElementById(id);

// Signal an die Seite: Skript (und alle Imports) wurden geladen.
// Sonst zeigt die Seite einen Ladehinweis.
document.documentElement.dataset.ready = "true";

// Probelauf (play.html?probe#j=...): für den Ersteller zum Ausprobieren.
// Nichts wird gespeichert, und Überspringen ist immer möglich.
const IS_PROBE = new URLSearchParams(location.search).has("probe");

// Zustand der Seite
let hunt = null; // Spiel-Jagd (mit Hashes)
let fingerprint = ""; // Abdruck der Route – erkennt nachträglich geänderte Jagden
let progress = null; // Fortschritt des Spielers
let hintOpen = false; // Hinweis an der aktuellen Station aufgeklappt?
let clockTimer = null;

// Karte und GPS
let gpsAvailable = "geolocation" in navigator;
let watchId = null;
let map = null;
let positionMarker = null;
let accuracyCircle = null;
let lastPosition = null; // letzte GPS-Position (nur für die Probelauf-Hilfe)
let probeMarker = null; // Station auf der Karte – NUR im Probelauf sichtbar

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();

async function init() {
  hunt = loadHunt();
  if (!hunt || hunt.stations.length === 0) {
    showScreen("error");
    return;
  }
  document.title = hunt.title + " – Stadtjagd";
  fingerprint = await Hunt.routeFingerprint(hunt);
  showTeam();

  if (IS_PROBE) {
    hunt = { ...hunt, skip: { allowed: true, afterFails: 0 } };
    progress = newProgress();
    $("probe-banner").hidden = false;
  } else {
    // Gespeicherten Fortschritt laden – sonst neu anlegen (die Uhr startet jetzt).
    const saved = Storage.load(Storage.KEYS.progress(hunt.id));
    if (saved && Game.isValidProgress(hunt, saved) && saved.fp === fingerprint) {
      progress = saved;
    } else {
      // Gab es Fortschritt zu einer älteren Fassung der Jagd? Dann Bescheid sagen.
      if (saved) {
        $("reset-notice").hidden = false;
        Storage.remove(Storage.KEYS.introSeen(hunt.id));
      }
      progress = newProgress();
      saveProgress();
    }
  }

  bindEvents();

  if (Game.isFinished(progress)) {
    showFinished();
  } else if (IS_PROBE || !Storage.load(Storage.KEYS.introSeen(hunt.id))) {
    showIntro();
  } else {
    startRiddles();
  }
}

// Jagd aus dem Link lesen (#j=...). Ohne gültigen Link: null.
function loadHunt() {
  if (location.hash.length <= 1) {
    $("error-text").textContent =
      "Hier fehlt noch die Jagd. Öffne den Link oder scanne den QR-Code, den du bekommen hast.";
    return null;
  }
  const parsed = Hunt.parseLinkHash(location.hash);
  return parsed && parsed.mode === "play" ? parsed.hunt : null;
}

function bindEvents() {
  $("btn-start").addEventListener("click", onStartClick);
  $("answer-form").addEventListener("submit", onAnswerSubmit);
  $("btn-here").addEventListener("click", onHereClick);
  $("btn-hint").addEventListener("click", onHintClick);
  $("btn-skip").addEventListener("click", onSkipClick);
  $("btn-restart").addEventListener("click", onRestartClick);
  $("btn-replay").addEventListener("click", onRestartClick);
  $("finale-form").addEventListener("submit", onFinaleSubmit);
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

// Teamname und -farbe anzeigen (nur bei Team-Links).
function showTeam() {
  if (!hunt.team) return;
  // Farbe ist beim Einlesen des Links geprüft (#rrggbb) – sicher für CSS.
  document.documentElement.style.setProperty("--team-color", hunt.team.color);
  const label = hunt.team.name;
  for (const id of ["intro-team", "header-team", "finished-team"]) {
    $(id).textContent = label;
    $(id).hidden = false;
  }
  $("intro-team").textContent = "Ihr seid " + label;
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
  playAnimation($("riddle-text"), "is-popping");
  if (IS_PROBE) updateProbeHelp();
}

// Welche Buttons gerade sichtbar sind, hängt vom Fortschritt ab.
function renderButtons() {
  $("btn-here").hidden = !gpsAvailable;
  $("btn-hint").hidden = !Game.canShowHint(hunt, progress) || hintOpen;
  $("hint-box").hidden = !hintOpen;
  $("btn-skip").hidden = !Game.canSkip(hunt, progress);
}

// celebrate = true direkt nach dem Lösen (nicht beim Neuladen der fertigen Jagd)
function showFinished(celebrate = false) {
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
  renderFinale();
  showScreen("finished");
  if (celebrate) launchConfetti("big");
}

function renderFinale() {
  const solved = Boolean(progress.finaleSolved);
  $("finale-box").hidden = !Game.hasFinale(hunt) || solved;
  $("finale-solved").hidden = !solved;
  if (!Game.hasFinale(hunt)) return;
  $("finale-riddle").textContent = hunt.finale.riddle;
  $("finale-part-number").textContent = `(${hunt.finale.partNumber} von ${hunt.team.count})`;
  $("finale-part").textContent = hunt.finale.part;
}

async function onFinaleSubmit(event) {
  event.preventDefault();
  const input = $("finale-input");
  if (input.value.trim() === "") return;

  $("btn-finale").disabled = true;
  const result = await Game.checkFinale(hunt, progress, input.value);
  $("btn-finale").disabled = false;
  input.value = "";

  if (result.correct) {
    updateProgress(result.progress);
    renderFinale();
    launchConfetti("big");
  } else {
    const el = $("finale-feedback");
    el.textContent = "Das ist noch nicht das ganze Wort. Habt ihr alle Teile?";
    el.className = "feedback is-error";
    playAnimation($("finale-form"), "is-shaking");
  }
}

function setFeedback(text, type) {
  const el = $("feedback");
  el.textContent = text;
  el.className = "feedback" + (type ? " is-" + type : "");
}

// Startet eine CSS-Animation neu – auch wenn sie gerade schon läuft.
function playAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // Trick: zwingt den Browser, neu zu rechnen
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
}

// ---------------------------------------------------------------------------
// Aktionen des Spielers
// ---------------------------------------------------------------------------

function onStartClick() {
  if (!IS_PROBE) Storage.save(Storage.KEYS.introSeen(hunt.id), true);
  $("reset-notice").hidden = true;
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
    onStationSolved(result.progress, pickText(TEXTS.right), true);
  } else {
    updateProgress(result.progress);
    setFeedback(pickText(TEXTS.wrong), "error");
    playAnimation($("answer-form"), "is-shaking");
    renderButtons();
    input.focus();
  }
}

function onHereClick() {
  const button = $("btn-here");
  button.disabled = true;
  $("btn-here-label").textContent = "Prüfe Standort …";

  const done = () => {
    button.disabled = false;
    $("btn-here-label").textContent = "Ich bin da";
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
        onStationSolved(result.progress, pickText(TEXTS.found), true);
      } else if (result.result === "inaccurate") {
        setFeedback("GPS gerade ungenau – versuch's gleich nochmal oder gib das Lösungswort ein.", "error");
      } else {
        // Bewusst ohne Entfernung oder Richtung!
        setFeedback(pickText(TEXTS.notHere), "error");
        playAnimation(button, "is-shaking");
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
  onStationSolved(Game.skipStation(hunt, progress, Date.now()), pickText(TEXTS.skipped));
}

function onRestartClick() {
  if (!confirm("Jagd wirklich neu starten? Fortschritt und Zeit werden zurückgesetzt.")) return;
  stopClock();
  stopGps();
  updateProgress(newProgress());
  if (!IS_PROBE) Storage.remove(Storage.KEYS.introSeen(hunt.id));
  hintOpen = false;
  setFeedback("");
  showIntro();
}

// Gemeinsamer Weg nach "geschafft" (Wort, GPS oder Überspringen).
// celebrate = Konfetti (nicht beim Überspringen)
function onStationSolved(newProgress, message, celebrate = false) {
  updateProgress(newProgress);
  hintOpen = false;
  if (Game.isFinished(progress)) {
    setFeedback("");
    showFinished(true); // Ende immer feiern – auch wenn die letzte übersprungen wurde
  } else {
    renderRiddle();
    setFeedback(message, "success");
    window.scrollTo(0, 0);
    if (celebrate) launchConfetti("small");
  }
}

function updateProgress(newProgress) {
  progress = newProgress;
  saveProgress();
}

// Neuer Fortschritt (Uhr startet jetzt), mit Abdruck der aktuellen Route.
function newProgress() {
  return { ...Game.createProgress(Date.now()), fp: fingerprint };
}

function saveProgress() {
  if (IS_PROBE) return; // Probelauf: nichts speichern
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
  if (IS_PROBE) setTimeout(updateProbeHelp); // Hinweis "ohne Standort" zeigen
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
  lastPosition = { lat: latLng[0], lng: latLng[1], accuracy: pos.coords.accuracy };
  if (IS_PROBE) updateProbeHelp();
}

// Probelauf-Hilfe für den Ersteller: Station auf der Karte zeigen und den
// Abstand in Metern nennen. Für echte Spieler bleibt das verborgen.
function updateProbeHelp() {
  const station = Game.currentStation(hunt, progress);
  const info = $("probe-info");
  if (!station) {
    info.hidden = true;
    return;
  }
  info.hidden = false;

  if (map) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="station-marker is-goal">${progress.current + 1}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    if (!probeMarker) probeMarker = L.marker([station.lat, station.lng], { icon, interactive: false }).addTo(map);
    else probeMarker.setLatLng([station.lat, station.lng]).setIcon(icon);
  }

  if (!gpsAvailable) {
    info.textContent = "Probelauf: Ohne Standort gibt es keine Abstandsanzeige.";
  } else if (!lastPosition) {
    info.textContent = "Probelauf: Die Station ist gelb auf der Karte markiert. Warte auf deinen Standort …";
  } else {
    const distance = Math.round(Game.distanceMeters(lastPosition, station));
    const accuracy = Math.round(lastPosition.accuracy);
    const verdict =
      lastPosition.accuracy > Game.MAX_GPS_ACCURACY_M
        ? "GPS gerade zu ungenau"
        : distance <= Game.SOLVE_RADIUS_M
          ? "„Ich bin da“ würde jetzt klappen"
          : `noch zu weit (ab ${Game.SOLVE_RADIUS_M} m klappt es)`;
    info.textContent = `Probelauf: ${distance} m bis zur Station · GPS ±${accuracy} m · ${verdict}`;
  }
}

function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    disableGps();
  } else if (!positionMarker) {
    $("map-status").textContent = "Standort gerade nicht verfügbar …";
  }
}
