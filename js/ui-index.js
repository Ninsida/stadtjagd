// ui-index.js – Startseite (index.html).
//
// Zeigt an, ob es einen Entwurf gibt, und öffnet eingefügte Links.

import * as Hunt from "./hunt.js";
import * as Storage from "./storage.js";

const $ = (id) => document.getElementById(id);

// Signal an die Seite: Skript (und alle Imports) wurden geladen.
// Sonst zeigt die Seite einen Ladehinweis.
document.documentElement.dataset.ready = "true";

showDraftInfo();
$("link-form").addEventListener("submit", onLinkSubmit);

// Gibt es schon einen angefangenen Entwurf? Dann Button umbenennen.
function showDraftInfo() {
  const draft = Hunt.toEditableHunt(Storage.load(Storage.KEYS.draft));
  if (!draft || (draft.title.trim() === "" && draft.stations.length === 0)) return;

  $("btn-create").textContent = "Entwurf weiterbearbeiten";
  const count = draft.stations.length;
  const stations = count === 1 ? "1 Station" : `${count} Stationen`;
  $("draft-info").textContent = `${draft.title.trim() || "Ohne Titel"} · ${stations}`;
  $("draft-info").hidden = false;
}

// Eingefügten Link prüfen und zur passenden Seite weiterleiten.
// Wir nehmen nur den Teil hinter "#" – so funktioniert es auch mit Links
// von einer anderen Adresse (z. B. localhost) und landet trotzdem hier.
function onLinkSubmit(event) {
  event.preventDefault();
  const text = $("link-input").value.trim();
  const hashIndex = text.indexOf("#");
  const parsed = hashIndex >= 0 ? Hunt.parseLinkHash(text.slice(hashIndex)) : null;

  if (!parsed) {
    $("link-error").textContent = "Das sieht nicht nach einem Stadtjagd-Link aus. Vielleicht unvollständig kopiert?";
    return;
  }
  const page = parsed.mode === "play" ? "play.html" : "create.html";
  location.href = page + text.slice(hashIndex);
}
