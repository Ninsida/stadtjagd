# Stadtjagd

Eine private Schnitzeljagd durch die eigene Stadt in wenigen Minuten erstellen und per Link oder QR-Code mit Freunden spielen – ohne App, ohne Konto, ohne Server.

**Live:** https://ninsida.github.io/stadtjagd/

## So funktioniert's

1. **Jagd erstellen:** Stationen auf der Karte setzen, pro Station ein Rätsel, ein oder mehrere Lösungswörter und optional einen Hinweis eintragen.
2. **Teilen:** Am Ende gibt es einen Spiel-Link und einen QR-Code.
3. **Spielen:** Eine Station gilt als geschafft, wenn man höchstens 30 m entfernt ist („Ich bin da“) oder das richtige Lösungswort eingibt. Ohne GPS-Freigabe klappt alles auch nur per Lösungswort.

Außerdem:

- **Automatisch erstellen:** Die App sucht Sehenswürdigkeiten in der Nähe (Wikipedia) und baut daraus eine fertige Jagd mit Rätseln.
- **Orts-Vorschläge:** Sehenswürdigkeiten als Punkte auf der Karte, per Tipp als Station übernehmen.
- **Teams:** 2–8 Teams mit eigenen Wegen, gemeinsamem Ziel und optionalem Finale-Rätsel, für das jedes Team einen Teil des Lösungsworts sammelt.
- **Probelauf:** Der Ersteller spielt seine Jagd ohne Speichern durch und sieht dabei den Abstand zur Station.
- **QR-Codes drucken** und **als App auf dem Home-Bildschirm speichern**.

## Datenschutz

- Die komplette Jagd steckt im Link (komprimiert im Teil hinter `#`). Dieser Teil wird nie an einen Server geschickt.
- Lösungswörter stehen im Spiel-Link nur als Hash (SHA-256), nicht im Klartext.
- Standort, Fortschritt und Entwürfe bleiben im Browser (`localStorage`). Kein Tracking, keine Konten.
- Nur bei „Automatisch erstellen“ und „Orte vorschlagen“ geht – nach Zustimmung – eine Position an die Wikipedia-Ortssuche.

## Technik

- Nur HTML, CSS und JavaScript (ES-Module) – kein Framework, kein Build-Tool.
- Bibliotheken per CDN: [Leaflet](https://leafletjs.com/) mit OpenStreetMap-Karten, [lz-string](https://github.com/pieroxy/lz-string), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), [SortableJS](https://sortablejs.github.io/Sortable/).

| Datei | Aufgabe |
|---|---|
| `index.html`, `create.html`, `play.html` | Startseite, Ersteller, Spieler |
| `js/hunt.js` | Datenformat, Lösungswörter normalisieren und hashen, Links kodieren |
| `js/game.js` | Spielregeln: Fortschritt, Abstand, Hinweis, Überspringen, Zeit |
| `js/storage.js` | Speichern im Browser |
| `js/ui-*.js` | Oberfläche der jeweiligen Seite |
| `js/places.js` | Sehenswürdigkeiten aus Wikipedia, Rätsel daraus, automatische Jagd |
| `js/confetti.js`, `js/texts.js` | Konfetti und Sprüche |
| `sw.js`, `js/pwa.js`, `manifest.webmanifest` | Als App installierbar, lädt auch bei schlechtem Netz |
| `test.html` | Tests für die Spiellogik |

`hunt.js`, `game.js` und `storage.js` greifen nicht auf die Seite (DOM) zu – so lassen sie sich später in eine echte App übernehmen.

## Lokal starten

Die Seiten müssen über einen kleinen Server laufen (nicht per Doppelklick als Datei), weil Browser ES-Module, GPS und `crypto.subtle` sonst blockieren:

```bash
node .claude/serve.js
```

Danach `http://localhost:8000` öffnen. Die Tests laufen unter `http://localhost:8000/test.html`.
