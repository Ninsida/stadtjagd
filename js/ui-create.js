// ui-create.js – Oberfläche der Ersteller-Ansicht (create.html).
//
// Stationen auf der Karte setzen, bearbeiten, löschen und sortieren,
// Entwurf speichern, am Ende Links und QR-Code erzeugen.
// Prüfen und Datenformat kommen aus hunt.js.

import * as Hunt from "./hunt.js";
import * as Storage from "./storage.js";
import * as Places from "./places.js";
import "./pwa.js"; // als App installierbar, lädt auch bei schlechtem Netz

const $ = (id) => document.getElementById(id);

// Signal an die Seite: Skript (und alle Imports) wurden geladen.
// Sonst zeigt die Seite einen Ladehinweis.
document.documentElement.dataset.ready = "true";

// Ab dieser Länge wird ein QR-Code für viele Handy-Kameras schwierig.
const LONG_LINK = 2000;

// Zustand der Seite
let hunt = null;
let showErrors = false; // Fehler erst nach dem ersten Klick auf "Fertigstellen" anzeigen
let editing = null; // { index, lat, lng } – index null = neue Station

// Karte
let map = null;
let stationMarkers = [];
let routeLines = []; // gestrichelte Linien: eine pro Team (oder eine ohne Teams)
let newMarker = null; // grauer Marker für eine Station, die gerade angelegt wird
let placeMarkers = []; // lila Punkte: vorgeschlagene Orte aus Wikipedia

const GERMANY_CENTER = [51.1657, 10.4515];
const DRAG_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">' +
  '<circle cx="7" cy="4" r="1.6"/><circle cx="13" cy="4" r="1.6"/>' +
  '<circle cx="7" cy="10" r="1.6"/><circle cx="13" cy="10" r="1.6"/>' +
  '<circle cx="7" cy="16" r="1.6"/><circle cx="13" cy="16" r="1.6"/></svg>';

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();

function init() {
  hunt = loadInitialHunt();
  initMap();
  fillSettings();
  bindEvents();
  Sortable.create($("station-list"), {
    handle: ".drag-handle", // nur am Griff ziehen – sonst stört es beim Scrollen
    animation: 150,
    onEnd: onSortEnd,
  });
  renderAll();

  // Von der Startseite "Überrasch mich" → Dialog gleich öffnen
  if (new URLSearchParams(location.search).has("auto")) {
    history.replaceState(null, "", location.pathname);
    openAutoDialog();
  }
}

// Welche Jagd beim Öffnen in den Editor kommt:
// 1. Bearbeiten-Link in der Adresse (#e=...)  2. gespeicherter Entwurf  3. neue Jagd
function loadInitialHunt() {
  const draft = Hunt.toEditableHunt(Storage.load(Storage.KEYS.draft));
  const hadHash = location.hash.length > 1;
  const link = hadHash ? Hunt.parseLinkHash(location.hash) : null;

  // Link-Daten aus der Adresszeile entfernen. Sonst würde ein Neuladen
  // die Jagd aus dem Link wieder über den neueren Entwurf schreiben.
  if (hadHash) history.replaceState(null, "", location.pathname + location.search);

  if (link && link.mode === "edit") {
    const linkHunt = Hunt.toEditableHunt(link.hunt);
    const otherDraft =
      draft && draft.id !== linkHunt.id && (draft.title.trim() !== "" || draft.stations.length > 0);
    if (!otherDraft || confirm("Bearbeiten-Link öffnen? Dein aktueller Entwurf auf diesem Gerät wird dabei ersetzt.")) {
      return linkHunt;
    }
  } else if (hadHash) {
    alert("Dieser Link ist kein gültiger Bearbeiten-Link. Vielleicht wurde er beim Kopieren abgeschnitten?");
  }

  return draft ?? Hunt.createHunt();
}

function saveDraft() {
  Storage.save(Storage.KEYS.draft, hunt);
}

function bindEvents() {
  $("title-input").addEventListener("input", (e) => {
    hunt.title = e.target.value;
    saveDraft();
    renderErrors();
  });
  $("intro-input").addEventListener("input", (e) => {
    hunt.intro = e.target.value;
    saveDraft();
  });
  $("outro-input").addEventListener("input", (e) => {
    hunt.outro = e.target.value;
    saveDraft();
  });
  $("skip-allowed").addEventListener("change", (e) => {
    hunt.skip.allowed = e.target.checked;
    $("skip-fails-field").hidden = !hunt.skip.allowed;
    saveDraft();
    renderErrors();
  });
  $("skip-fails").addEventListener("input", (e) => {
    hunt.skip.afterFails = Number(e.target.value);
    saveDraft();
    renderErrors();
  });

  // Teams
  $("teams-enabled").addEventListener("change", onTeamsToggle);
  $("btn-add-team").addEventListener("click", onAddTeam);
  $("shuffle-input").addEventListener("change", (e) => {
    hunt.shuffle = e.target.checked;
    renderAll();
  });
  $("finale-enabled").addEventListener("change", (e) => {
    hunt.finale.enabled = e.target.checked;
    renderTeams();
    renderAll();
  });
  $("finale-riddle-input").addEventListener("input", (e) => {
    hunt.finale.riddle = e.target.value;
    saveDraft();
    renderErrors();
  });
  $("finale-answer-input").addEventListener("input", (e) => {
    hunt.finale.answer = e.target.value;
    saveDraft();
    renderFinalePreview();
    renderErrors();
  });
  $("goal-input").addEventListener("change", (e) => {
    // Das Ziel gilt immer für alle Teams → Team-Auswahl ausblenden
    $("station-teams").hidden = e.target.checked || !Hunt.hasTeams(hunt);
  });

  $("btn-here").addEventListener("click", onHereClick);
  $("btn-places").addEventListener("click", onPlacesToggle);
  $("btn-auto").addEventListener("click", openAutoDialog);
  $("auto-form").addEventListener("submit", onAutoSubmit);
  $("btn-auto-cancel").addEventListener("click", () => $("auto-dialog").close());
  $("btn-finish").addEventListener("click", onFinishClick);
  $("btn-new").addEventListener("click", onNewHuntClick);

  // Ergebnis-Bildschirm (Spiel-Links bekommen ihre Buttons pro Karte in showResult)
  $("btn-copy-edit").addEventListener("click", () => copyLink($("edit-link"), "Bearbeiten-Link kopiert!"));
  $("btn-back").addEventListener("click", () => showScreen("editor"));
  $("btn-print").addEventListener("click", () => window.print()); // Druckansicht regelt das CSS (@media print)

  // Bearbeiten-Link in den schon offenen Tab eingefügt → Seite neu laden,
  // damit loadInitialHunt() ihn einliest. (Unser eigenes Entfernen des
  // Hashes per history.replaceState löst dieses Ereignis nicht aus.)
  window.addEventListener("hashchange", () => location.reload());

  // Formular-Blatt
  $("station-form").addEventListener("submit", onStationSave);
  $("btn-cancel-station").addEventListener("click", closeSheet);
  $("btn-delete-station").addEventListener("click", onStationDelete);
  $("btn-add-answer").addEventListener("click", () => addAnswerRow("", true));
  $("station-dialog").addEventListener("close", onSheetClosed);
}

// Einstellungsfelder mit den Werten der Jagd füllen.
function fillSettings() {
  $("title-input").value = hunt.title;
  $("intro-input").value = hunt.intro;
  $("outro-input").value = hunt.outro;
  $("skip-allowed").checked = hunt.skip.allowed;
  $("skip-fails").value = hunt.skip.afterFails;
  $("skip-fails-field").hidden = !hunt.skip.allowed;
  $("teams-enabled").checked = Hunt.hasTeams(hunt);
  $("shuffle-input").checked = hunt.shuffle;
  $("finale-enabled").checked = hunt.finale.enabled;
  $("finale-riddle-input").value = hunt.finale.riddle;
  $("finale-answer-input").value = hunt.finale.answer;
  renderTeams();
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function onTeamsToggle(event) {
  if (event.target.checked) {
    // Mit zwei Teams starten – mehr kann man hinzufügen
    while (hunt.teams.length < Hunt.MIN_TEAMS) hunt.teams.push(Hunt.createTeam(hunt));
  } else {
    hunt.teams = [];
    hunt.finale.enabled = false;
    $("finale-enabled").checked = false;
    // Team-Zuordnungen der Stationen passen nicht mehr → zurück auf "alle"
    hunt.stations.forEach((s) => (s.teams = null));
  }
  renderTeams();
  renderAll();
}

function onAddTeam() {
  if (hunt.teams.length >= Hunt.MAX_TEAMS) return;
  hunt.teams.push(Hunt.createTeam(hunt));
  renderTeams();
  renderAll();
}

function onRemoveTeam(index) {
  const name = hunt.teams[index].name || "dieses Team";
  if (!confirm(`„${name}“ entfernen?`)) return;
  hunt = Hunt.removeTeam(hunt, index);
  renderTeams();
  renderAll();
}

// Teams-Bereich neu aufbauen: Liste mit Name und Farbe, Buttons, Finale.
function renderTeams() {
  const on = Hunt.hasTeams(hunt);
  $("teams-panel").hidden = !on;
  $("finale-fields").hidden = !hunt.finale.enabled;
  $("btn-add-team").hidden = hunt.teams.length >= Hunt.MAX_TEAMS;

  const list = $("team-list");
  list.replaceChildren();
  hunt.teams.forEach((team, index) => {
    const li = document.createElement("li");
    li.className = "team-row";
    li.style.setProperty("--team-color", team.color);

    const dot = document.createElement("span");
    dot.className = "team-dot";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 30;
    input.value = team.name;
    input.setAttribute("aria-label", `Name von Team ${index + 1}`);
    input.addEventListener("input", () => {
      team.name = input.value;
      saveDraft();
      renderList(); // Teamnamen stehen auch in der Stationsliste
      renderErrors();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-icon";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Team ${index + 1} entfernen`);
    // Unter zwei Teams geht nicht – dann lieber Teams ganz ausschalten
    remove.disabled = hunt.teams.length <= Hunt.MIN_TEAMS;
    remove.addEventListener("click", () => onRemoveTeam(index));

    li.append(dot, input, remove);
    list.append(li);
  });
  renderFinalePreview();
}

// Zeigt, wie das Finale-Wort aufgeteilt wird: "Rot: SC · Blau: HA · Grün: TZ"
function renderFinalePreview() {
  const answer = Hunt.finaleKey(hunt.finale.answer);
  if (!Hunt.hasTeams(hunt) || answer === "") {
    $("finale-preview").textContent = "Das Wort wird auf die Teams aufgeteilt – jedes Team findet nur seinen Teil.";
    return;
  }
  const parts = Hunt.splitFinale(answer, hunt.teams.length);
  $("finale-preview").textContent =
    "Aufteilung: " + hunt.teams.map((t, i) => `${t.name || "Team " + (i + 1)}: ${parts[i] || "–"}`).join(" · ");
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

function initMap() {
  map = L.map("map").setView(GERMANY_CENTER, 6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  map.on("click", (e) => openSheet(null, e.latlng));

  if (hunt.stations.length > 0) {
    // Gespeicherte Jagd: alle Stationen ins Bild holen
    const points = hunt.stations.map((s) => [s.lat, s.lng]);
    map.fitBounds(points, { padding: [40, 40], maxZoom: 17 });
  } else if ("geolocation" in navigator) {
    // Neue Jagd: auf den eigenen Standort zentrieren, wenn erlaubt. Klappt es
    // nicht, bleibt eben Deutschland sichtbar – kein Fehler nötig.
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }
}

function renderMap() {
  stationMarkers.forEach((m) => m.remove());
  routeLines.forEach((l) => l.remove());

  stationMarkers = hunt.stations.map((station, index) => {
    const marker = L.marker([station.lat, station.lng], {
      icon: numberIcon(station.goal ? "Z" : index + 1, station.goal ? "is-goal" : ""),
      draggable: true,
      title: "Station " + (index + 1),
    }).addTo(map);
    marker.on("click", () => openSheet(index));
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      station.lat = Hunt.roundCoord(pos.lat);
      station.lng = Hunt.roundCoord(pos.lng);
      saveDraft();
      renderMap(); // Linie neu zeichnen
    });
    return marker;
  });

  // Gestrichelte Linien zeigen die Reihenfolge – bei Teams eine pro Team in Teamfarbe
  const routes = Hunt.teamRoutes(hunt);
  routeLines = routes.map((route, t) => {
    const points = route.map((i) => [hunt.stations[i].lat, hunt.stations[i].lng]);
    const color = Hunt.hasTeams(hunt) ? hunt.teams[t].color : "#ff5a5f";
    return L.polyline(points, { color, weight: 3, opacity: 0.85, dashArray: "6 8", dashOffset: String(t * 4) }).addTo(map);
  });
}

// Runder Marker mit Nummer (als HTML statt Bild).
function numberIcon(label, extraClass = "") {
  return L.divIcon({
    className: "", // Leaflets weißes Standard-Kästchen abschalten
    html: `<div class="station-marker ${extraClass}">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function onHereClick() {
  const button = $("btn-here");
  const status = $("location-status");
  if (!("geolocation" in navigator)) {
    status.textContent = "Dein Gerät kann den Standort nicht bestimmen. Tippe stattdessen auf die Karte.";
    return;
  }

  button.disabled = true;
  $("btn-here-label").textContent = "Suche Standort …";
  status.textContent = "";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      resetHereButton();
      const latLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.setView(latLng, 17);
      openSheet(null, latLng);
    },
    (err) => {
      resetHereButton();
      status.textContent =
        err.code === err.PERMISSION_DENIED
          ? "Standort nicht freigegeben. Tippe stattdessen auf die Karte."
          : "Standort nicht gefunden. Versuch's nochmal oder tippe auf die Karte.";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function resetHereButton() {
  $("btn-here").disabled = false;
  $("btn-here-label").textContent = "Station an meinem Standort";
}

// ---------------------------------------------------------------------------
// Stationsliste
// ---------------------------------------------------------------------------

function renderList() {
  const list = $("station-list");
  const errors = showErrors ? Hunt.validateHunt(hunt) : [];
  list.replaceChildren(); // alte Einträge entfernen

  hunt.stations.forEach((station, index) => {
    const stationErrors = errors.filter((e) => e.station === index);

    const li = document.createElement("li");
    li.className = "station-item" + (stationErrors.length ? " is-invalid" : "");

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.innerHTML = DRAG_ICON; // fester Inhalt, keine Nutzereingabe
    handle.setAttribute("aria-label", "Ziehen zum Sortieren");

    const number = document.createElement("span");
    number.className = "station-number" + (station.goal ? " is-goal" : "");
    number.textContent = station.goal ? "Z" : index + 1;

    const body = document.createElement("button");
    body.type = "button";
    body.className = "station-body";
    body.addEventListener("click", () => openSheet(index));

    const riddle = document.createElement("span");
    riddle.className = "station-riddle";
    const firstLine = station.riddle.trim().split("\n")[0];
    riddle.textContent = firstLine || "Noch kein Rätsel";
    riddle.classList.toggle("is-empty", !firstLine);

    const meta = document.createElement("span");
    meta.className = "station-meta";
    meta.textContent = describeStation(station);

    body.append(riddle, meta);

    if (stationErrors.length) {
      const errorText = document.createElement("span");
      errorText.className = "station-errors";
      errorText.textContent = stationErrors.map((e) => e.message).join(" ");
      body.append(errorText);
    }

    li.append(handle, number, body);
    list.append(li);
  });

  const count = hunt.stations.length;
  $("station-count").textContent = count ? `(${count})` : "";
  $("stations-empty").hidden = count > 0;
}

// z. B. "Lösung: Fischbrunnen (+1) · mit Hinweis" – die Liste sieht nur der Ersteller
function describeStation(station) {
  const answers = station.answers.filter((a) => a.trim() !== "");
  const more = answers.length > 1 ? ` (+${answers.length - 1})` : "";
  const parts = [answers.length ? `Lösung: ${answers[0]}${more}` : "noch keine Lösung"];
  if (station.hint.trim()) parts.push("mit Hinweis");
  if (station.goal) parts.unshift("Ziel");
  else if (Hunt.hasTeams(hunt) && station.teams !== null) {
    const names = station.teams.map((t) => hunt.teams[t]?.name).filter(Boolean);
    parts.push(names.length ? "nur " + names.join(", ") : "kein Team");
  }
  return parts.join(" · ");
}

function onSortEnd(event) {
  if (event.oldIndex === event.newIndex) return;
  hunt.stations = Hunt.moveStation(hunt.stations, event.oldIndex, event.newIndex);
  renderAll();
}

// ---------------------------------------------------------------------------
// Formular-Blatt für eine Station
// ---------------------------------------------------------------------------

// index = Nummer der Station oder null für eine neue (dann mit latLng).
// prefill = optionale Vorbelegung für eine neue Station (z. B. aus einem Orts-Vorschlag).
function openSheet(index, latLng, prefill = null) {
  // Schon offen? Dann nichts tun – auf Touch-Geräten kommt ein Tippen
  // manchmal doppelt an.
  if ($("station-dialog").open) return;

  const isNew = index === null;
  const station = isNew ? prefill : hunt.stations[index];

  editing = isNew
    ? { index: null, lat: Hunt.roundCoord(latLng.lat), lng: Hunt.roundCoord(latLng.lng) }
    : { index };

  $("sheet-title").textContent = isNew ? "Neue Station" : `Station ${index + 1}`;
  $("riddle-input").value = station ? station.riddle : "";
  $("hint-input").value = station ? station.hint : "";
  $("btn-delete-station").hidden = isNew;
  $("goal-input").checked = station ? station.goal : false;
  renderStationTeamOptions(station);

  $("answer-rows").replaceChildren();
  const answers = station && station.answers.length ? station.answers : [""];
  answers.forEach((a) => addAnswerRow(a));

  if (isNew) {
    newMarker = L.marker([editing.lat, editing.lng], {
      icon: numberIcon(hunt.stations.length + 1, "is-new"),
      interactive: false,
    }).addTo(map);
  }

  $("station-dialog").showModal();
}

// Kästchen "Für welche Teams?" – nur sichtbar, wenn es Teams gibt und die
// Station nicht das Ziel ist. Alle angehakt = Station gilt für alle Teams.
function renderStationTeamOptions(station) {
  const box = $("station-team-options");
  box.replaceChildren();
  $("station-teams").hidden = !Hunt.hasTeams(hunt) || $("goal-input").checked;
  hunt.teams.forEach((team, t) => {
    const label = document.createElement("label");
    label.className = "team-option";
    label.style.setProperty("--team-color", team.color);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.value = String(t);
    check.checked = !station || Hunt.stationBelongsToTeam(station, t);
    const text = document.createElement("span");
    text.textContent = team.name || "Team " + (t + 1);
    label.append(check, text);
    box.append(label);
  });
}

function addAnswerRow(value, focus = false) {
  const row = document.createElement("div");
  row.className = "answer-row";

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 100;
  input.value = value;
  input.placeholder = "Lösungswort";
  input.autocapitalize = "off";
  input.setAttribute("aria-label", "Lösungswort");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-icon";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Wort entfernen");
  remove.addEventListener("click", () => {
    // Die letzte Zeile bleibt stehen und wird nur geleert.
    if ($("answer-rows").children.length > 1) row.remove();
    else input.value = "";
  });

  row.append(input, remove);
  $("answer-rows").append(row);
  if (focus) input.focus();
}

function onStationSave(event) {
  event.preventDefault();

  const answers = [...$("answer-rows").querySelectorAll("input")]
    .map((input) => input.value.trim())
    .filter((a) => a !== "");
  const goal = $("goal-input").checked;
  let teams = null;
  if (Hunt.hasTeams(hunt) && !goal) {
    const checked = [...$("station-team-options").querySelectorAll("input:checked")].map((c) => Number(c.value));
    teams = checked.length === hunt.teams.length ? null : checked; // alle angehakt = null
  }
  const values = {
    riddle: $("riddle-input").value.trim(),
    answers,
    hint: $("hint-input").value.trim(),
    goal,
    teams,
  };
  // Es gibt nur ein Ziel: neues Ziel → bei allen anderen Stationen abwählen
  if (goal) hunt.stations.forEach((s) => (s.goal = false));

  if (editing.index === null) {
    hunt.stations.push({ ...Hunt.createStation(editing.lat, editing.lng), ...values });
  } else {
    Object.assign(hunt.stations[editing.index], values);
  }

  closeSheet();
  renderAll();
}

function onStationDelete() {
  if (!confirm(`Station ${editing.index + 1} wirklich löschen?`)) return;
  hunt.stations.splice(editing.index, 1);
  closeSheet();
  renderAll();
}

// Formular schließen und sofort aufräumen.
function closeSheet() {
  cleanUpSheet();
  $("station-dialog").close();
}

// Läuft, wenn der Browser das Formular schließt – auch per Escape-Taste.
// Das "close"-Ereignis kommt leicht verzögert. Ist bis dahin schon das
// nächste Formular offen, darf es nichts mehr wegräumen.
function onSheetClosed() {
  if ($("station-dialog").open) return;
  cleanUpSheet();
}

function cleanUpSheet() {
  if (newMarker) {
    newMarker.remove();
    newMarker = null;
  }
  editing = null;
}

// ---------------------------------------------------------------------------
// Orts-Vorschläge und automatische Jagd (Daten aus Wikipedia, siehe places.js)
// ---------------------------------------------------------------------------

const CONSENT_KEY = "placesConsent";

// Einmal fragen, ob die Kartenposition an Wikipedia gehen darf.
function askPlacesConsent() {
  if (Storage.load(CONSENT_KEY)) return true;
  const ok = confirm(
    "Für Vorschläge wird die Position der Karte an Wikipedia geschickt, " +
      "um Sehenswürdigkeiten in der Nähe zu finden. Sonst nichts. Einverstanden?"
  );
  if (ok) Storage.save(CONSENT_KEY, true);
  return ok;
}

function setPlacesStatus(text, type = "") {
  $("places-status").textContent = text;
  $("places-status").className = "feedback" + (type ? " is-" + type : "");
}

async function onPlacesToggle() {
  const button = $("btn-places");
  if (placeMarkers.length > 0) {
    clearPlaceMarkers();
    setPlacesStatus("");
    return;
  }
  if (!askPlacesConsent()) return;

  // Umkreis = sichtbarer Kartenausschnitt (Mitte bis Ecke), höchstens 3 km
  const center = map.getCenter();
  const radius = Math.min(3000, center.distanceTo(map.getBounds().getNorthEast()));
  if (map.getZoom() < 13) {
    setPlacesStatus("Zoom etwas näher heran – dann finde ich Orte in diesem Ausschnitt.", "error");
    return;
  }

  button.disabled = true;
  $("btn-places-label").textContent = "Suche Orte …";
  try {
    const places = await Places.fetchPlaces(center.lat, center.lng, radius);
    showPlaceMarkers(places);
    setPlacesStatus(
      places.length
        ? `${placeMarkers.length} Orte gefunden – tippe einen lila Punkt an, um ihn als Station zu übernehmen.`
        : "Hier habe ich keine passenden Sehenswürdigkeiten gefunden.",
      places.length ? "success" : "error"
    );
  } catch (err) {
    setPlacesStatus(err.message, "error");
  } finally {
    button.disabled = false;
    $("btn-places-label").textContent = placeMarkers.length ? "Vorschläge ausblenden" : "Orte vorschlagen";
    button.setAttribute("aria-pressed", String(placeMarkers.length > 0));
  }
}

function showPlaceMarkers(places) {
  clearPlaceMarkers();
  // Orte, an denen schon eine Station steht, nicht nochmal vorschlagen
  const fresh = places.filter((p) => !hunt.stations.some((s) => map.distance([s.lat, s.lng], [p.lat, p.lng]) < 25));
  placeMarkers = fresh.map((place) => {
    const marker = L.marker([place.lat, place.lng], {
      icon: L.divIcon({ className: "", html: '<div class="place-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: place.name,
    }).addTo(map);
    marker.bindPopup(() => placePopup(place, marker));
    return marker;
  });
}

function clearPlaceMarkers() {
  placeMarkers.forEach((m) => m.remove());
  placeMarkers = [];
  $("btn-places-label").textContent = "Orte vorschlagen";
  $("btn-places").setAttribute("aria-pressed", "false");
}

// Inhalt der Sprechblase: Name, Art, Button. Mit DOM-Elementen statt HTML-Text,
// weil der Name von außen (Wikipedia) kommt.
function placePopup(place, marker) {
  const box = document.createElement("div");
  box.className = "place-popup";
  const name = document.createElement("strong");
  name.textContent = place.name;
  const kind = document.createElement("span");
  kind.textContent = Places.PLACE_KINDS[place.kind].label;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = "Als Station übernehmen";
  button.addEventListener("click", () => {
    map.closePopup();
    // Wegbeschreibung von der letzten normalen Station aus – das Ziel kommt ja immer zuletzt
    const last = hunt.stations.filter((st) => !st.goal).at(-1) ?? null;
    marker.remove();
    placeMarkers = placeMarkers.filter((m) => m !== marker);
    openSheet(null, L.latLng(place.lat, place.lng), Places.stationFromPlace(place, last));
  });
  box.append(name, kind, button);
  return box;
}

function openAutoDialog() {
  $("auto-status").textContent = "";
  $("btn-auto-go").disabled = false;
  $("auto-dialog").showModal();
}

async function onAutoSubmit(event) {
  event.preventDefault();
  const status = $("auto-status");
  const setStatus = (text, type = "") => {
    status.textContent = text;
    status.className = "feedback" + (type ? " is-" + type : "");
  };

  const hasContent = hunt.title.trim() !== "" || hunt.stations.length > 0;
  if (hasContent && !confirm("Deine aktuelle Jagd wird dabei ersetzt. Weiter?")) return;

  const count = Number($("auto-count").value);
  const radius = Places.DISTANCES[$("auto-distance").value].radius;
  const useHere = document.querySelector('input[name="auto-start"]:checked').value === "here";

  $("btn-auto-go").disabled = true;
  try {
    setStatus(useHere ? "Suche deinen Standort …" : "Suche Orte …");
    const start = useHere ? await currentPosition() : { lat: map.getCenter().lat, lng: map.getCenter().lng };
    setStatus("Suche Sehenswürdigkeiten …");
    Storage.save(CONSENT_KEY, true); // Klick auf "Los" = einverstanden (Text steht im Dialog)
    const places = await Places.fetchPlaces(start.lat, start.lng, radius);
    const newHunt = Places.buildAutoHunt(places, start, count);

    if (newHunt.stations.length < 2) {
      setStatus("Hier gibt es zu wenige Sehenswürdigkeiten. Probier eine längere Strecke oder einen anderen Startpunkt.", "error");
      return;
    }

    hunt = newHunt;
    showErrors = false;
    clearPlaceMarkers();
    fillSettings();
    renderAll();
    map.fitBounds([[start.lat, start.lng], ...hunt.stations.map((s) => [s.lat, s.lng])], { padding: [40, 40], maxZoom: 17 });
    $("auto-dialog").close();
    const fewer = hunt.stations.length < count ? ` (mehr passende Orte gab es hier nicht)` : "";
    setPlacesStatus(`${hunt.stations.length} Stationen erstellt${fewer}. Schau sie dir an und passe Titel und Rätsel nach Lust an.`, "success");
    window.scrollTo(0, 0);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    $("btn-auto-go").disabled = false;
  }
}

// Eigener Standort als Promise – mit verständlicher Fehlermeldung.
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Dein Gerät kann den Standort nicht bestimmen. Wähle „Mitte der Karte“."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Standort nicht verfügbar. Wähle „Mitte der Karte“ und schiebe die Karte an den Startort.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ---------------------------------------------------------------------------
// Prüfen und Fertigstellen
// ---------------------------------------------------------------------------

function renderErrors() {
  // Vor dem ersten "Fertigstellen" (oder nach "Neue Jagd") keine Fehler zeigen
  const errors = showErrors ? Hunt.validateHunt(hunt) : [];

  const titleError = errors.find((e) => e.field === "title");
  $("title-error").textContent = titleError ? titleError.message : "";
  $("title-error").hidden = !titleError;
  $("title-input").classList.toggle("is-invalid", Boolean(titleError));

  const skipError = errors.find((e) => e.field === "skip");
  $("skip-error").textContent = skipError ? skipError.message : "";
  $("skip-error").hidden = !skipError;
  $("skip-fails").classList.toggle("is-invalid", Boolean(skipError));

  const teamErrors = errors.filter((e) => e.field === "teams" || e.field === "finale" || e.field === "goal");
  $("teams-error").textContent = teamErrors.map((e) => e.message).join(" ");
  $("teams-error").hidden = teamErrors.length === 0;

  if (errors.length === 0) setFinishStatus("", "");
}

async function onFinishClick() {
  showErrors = true;
  renderAll();

  const errors = Hunt.validateHunt(hunt);
  if (errors.length > 0) {
    const noStations = errors.find((e) => e.field === "stations");
    setFinishStatus(noStations ? noStations.message : "Bitte prüfe die rot markierten Stellen.", "error");
    return;
  }
  await showResult();
}

function setFinishStatus(text, type) {
  const el = $("finish-status");
  el.textContent = text;
  el.className = "feedback" + (type ? " is-" + type : "");
}

function onNewHuntClick() {
  const message =
    "Neue Jagd beginnen? Der aktuelle Entwurf wird gelöscht.\n" +
    "Tipp: Kopier dir vorher den Bearbeiten-Link (über \"Jagd fertigstellen\").";
  if (!confirm(message)) return;

  hunt = Hunt.createHunt();
  showErrors = false;
  clearPlaceMarkers();
  setPlacesStatus("");
  fillSettings();
  $("location-status").textContent = "";
  renderAll(); // speichert auch gleich den leeren Entwurf
  window.scrollTo(0, 0);
}

function renderAll() {
  renderMap();
  renderList();
  renderErrors();
  saveDraft();
}

// ---------------------------------------------------------------------------
// Ergebnis: Links und QR-Code
// ---------------------------------------------------------------------------

function showScreen(name) {
  $("screen-editor").hidden = name !== "editor";
  $("screen-result").hidden = name !== "result";
  // Leaflet muss nachmessen, wenn die Karte wieder sichtbar wird
  if (name === "editor") map.invalidateSize();
  window.scrollTo(0, 0);
}

async function showResult() {
  // Ordner, in dem create.html liegt – dort liegt auch play.html
  const baseUrl = new URL(".", location.href).href;
  const results = await Hunt.toPlayHunts(hunt); // eine Spiel-Jagd pro Team (oder eine)

  $("result-intro").textContent = Hunt.hasTeams(hunt)
    ? "Jedes Team bekommt seinen eigenen Link oder QR-Code. Am Ziel treffen sich alle."
    : "Schick deinen Freunden den Link oder lass sie den QR-Code scannen.";
  $("screen-result").classList.toggle("has-teams", Hunt.hasTeams(hunt));

  const cards = $("result-cards");
  cards.replaceChildren();
  for (const { team, playHunt } of results) {
    cards.append(buildResultCard(team, Hunt.buildPlayLink(baseUrl, playHunt)));
  }

  $("edit-link").value = Hunt.buildEditLink(baseUrl, hunt);
  $("print-title").textContent = hunt.title;
  $("copy-status").textContent = "";
  showScreen("result");
}

// Eine Karte aus der Vorlage im HTML: QR-Code, Link, Kopieren, Teilen, Probelauf.
function buildResultCard(team, playLink) {
  const card = $("tpl-result-card").content.firstElementChild.cloneNode(true);
  const q = (selector) => card.querySelector(selector);

  if (team) {
    // Farbe stammt aus TEAM_COLORS bzw. ist beim Laden als #rrggbb geprüft
    card.style.setProperty("--team-color", team.color);
    card.classList.add("is-team");
    q(".result-team").textContent = team.name;
    q(".result-team").hidden = false;
  }

  renderQrCode(q(".qr-code"), q(".qr-error"), playLink);
  q(".length-warning").hidden = playLink.length <= LONG_LINK;
  q(".play-link").value = playLink;

  const what = team ? `Link für ${team.name}` : "Spiel-Link";
  q(".btn-copy").addEventListener("click", () => copyLink(q(".play-link"), what + " kopiert!"));
  q(".btn-share").hidden = !navigator.share;
  q(".btn-share").addEventListener("click", () => shareLink(playLink, team));
  // Gleicher Link, nur mit "?probe" – dann speichert die Spieler-Seite nichts
  q(".btn-probe").href = playLink.replace("play.html#", "play.html?probe#");
  q(".btn-probe").textContent = team ? `Probelauf als ${team.name}` : "Probelauf starten";
  return card;
}

function renderQrCode(box, errorEl, text) {
  box.replaceChildren();
  errorEl.hidden = true;

  // Erst mittlere Fehlerkorrektur ("M") versuchen. Ist der Link dafür zu lang,
  // geht "L" – passt mehr hinein, ist aber etwas empfindlicher.
  for (const level of ["M", "L"]) {
    try {
      const qr = qrcode(0, level); // 0 = Größe automatisch wählen
      qr.addData(text);
      qr.make();
      // Die Bibliothek liefert fertiges SVG (nur Kästchen, keine Nutzereingabe als HTML)
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      return;
    } catch {
      // zu lang für diese Stufe – nächste versuchen
    }
  }
  errorEl.textContent = "Der Link ist zu lang für einen QR-Code. Teile ihn stattdessen per Kopieren.";
  errorEl.hidden = false;
}

async function copyLink(input, message) {
  const status = $("copy-status");
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = message;
  } catch {
    // Moderne Zwischenablage nicht erlaubt → älterer Weg: Text markieren und kopieren.
    // Klappt auch das nicht, bleibt der Text markiert und man kopiert ihn selbst.
    input.select();
    const copied = document.execCommand("copy");
    status.textContent = copied
      ? message
      : "Kopieren hat nicht geklappt – der Link ist markiert, kopier ihn bitte selbst.";
  }
}

async function shareLink(url, team) {
  const text = team
    ? `Ihr seid ${team.name}! Spielt die Schnitzeljagd: ${hunt.title}`
    : "Spiel meine Schnitzeljagd: " + hunt.title;
  try {
    await navigator.share({ title: hunt.title, text, url });
  } catch {
    // Teilen abgebrochen – nichts zu tun
  }
}
