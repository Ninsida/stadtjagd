// ui-create.js – Oberfläche der Ersteller-Ansicht (create.html).
//
// Stationen auf der Karte setzen, bearbeiten, löschen und sortieren,
// Entwurf speichern, am Ende Links und QR-Code erzeugen.
// Prüfen und Datenformat kommen aus hunt.js.

import * as Hunt from "./hunt.js";
import * as Storage from "./storage.js";

const $ = (id) => document.getElementById(id);

// Ab dieser Länge wird ein QR-Code für viele Handy-Kameras schwierig.
const LONG_LINK = 2000;

// Zustand der Seite
let hunt = null;
let showErrors = false; // Fehler erst nach dem ersten Klick auf "Fertigstellen" anzeigen
let editing = null; // { index, lat, lng } – index null = neue Station

// Karte
let map = null;
let stationMarkers = [];
let routeLine = null;
let newMarker = null; // grauer Marker für eine Station, die gerade angelegt wird

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

  $("btn-here").addEventListener("click", onHereClick);
  $("btn-finish").addEventListener("click", onFinishClick);
  $("btn-new").addEventListener("click", onNewHuntClick);

  // Ergebnis-Bildschirm
  $("btn-copy-play").addEventListener("click", () => copyLink("play-link", "Spiel-Link kopiert!"));
  $("btn-copy-edit").addEventListener("click", () => copyLink("edit-link", "Bearbeiten-Link kopiert!"));
  $("btn-share").addEventListener("click", onShareClick);
  $("btn-back").addEventListener("click", () => showScreen("editor"));

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
  if (routeLine) routeLine.remove();

  stationMarkers = hunt.stations.map((station, index) => {
    const marker = L.marker([station.lat, station.lng], {
      icon: numberIcon(index + 1),
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

  // Gestrichelte Linie zeigt die Reihenfolge
  const points = hunt.stations.map((s) => [s.lat, s.lng]);
  routeLine = L.polyline(points, { color: "#ff5a5f", weight: 3, dashArray: "6 8" }).addTo(map);
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
    number.className = "station-number";
    number.textContent = index + 1;

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

// z. B. "2 Lösungswörter · mit Hinweis"
function describeStation(station) {
  const n = station.answers.filter((a) => a.trim() !== "").length;
  const parts = [n === 1 ? "1 Lösungswort" : `${n} Lösungswörter`];
  if (station.hint.trim()) parts.push("mit Hinweis");
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
function openSheet(index, latLng) {
  // Schon offen? Dann nichts tun – auf Touch-Geräten kommt ein Tippen
  // manchmal doppelt an.
  if ($("station-dialog").open) return;

  const isNew = index === null;
  const station = isNew ? null : hunt.stations[index];

  editing = isNew
    ? { index: null, lat: Hunt.roundCoord(latLng.lat), lng: Hunt.roundCoord(latLng.lng) }
    : { index };

  $("sheet-title").textContent = isNew ? "Neue Station" : `Station ${index + 1}`;
  $("riddle-input").value = station ? station.riddle : "";
  $("hint-input").value = station ? station.hint : "";
  $("btn-delete-station").hidden = isNew;

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
  const values = {
    riddle: $("riddle-input").value.trim(),
    answers,
    hint: $("hint-input").value.trim(),
  };

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
  const playHunt = await Hunt.toPlayHunt(hunt);
  const playLink = Hunt.buildPlayLink(baseUrl, playHunt);
  const editLink = Hunt.buildEditLink(baseUrl, hunt);

  $("play-link").value = playLink;
  $("edit-link").value = editLink;
  $("length-warning").hidden = playLink.length <= LONG_LINK;
  $("btn-share").hidden = !navigator.share;
  $("copy-status").textContent = "";
  renderQrCode(playLink);
  showScreen("result");
}

function renderQrCode(text) {
  const box = $("qr-code");
  box.replaceChildren();
  $("qr-error").hidden = true;

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
  $("qr-error").textContent = "Der Link ist zu lang für einen QR-Code. Teile ihn stattdessen per Kopieren.";
  $("qr-error").hidden = false;
}

async function copyLink(inputId, message) {
  const input = $(inputId);
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

async function onShareClick() {
  try {
    await navigator.share({
      title: hunt.title,
      text: "Spiel meine Schnitzeljagd: " + hunt.title,
      url: $("play-link").value,
    });
  } catch {
    // Teilen abgebrochen – nichts zu tun
  }
}
