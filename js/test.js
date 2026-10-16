// test.js – Kleine Testseite für die Spiellogik (öffnen über test.html).

import * as Hunt from "./hunt.js";
import * as Game from "./game.js";
import * as Places from "./places.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(condition, message = "Bedingung nicht erfüllt") {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`erwartet ${e}, bekommen ${a}`);
}

// Eine kleine Beispiel-Jagd für mehrere Tests.
function sampleHunt() {
  const hunt = Hunt.createHunt();
  hunt.title = "Testjagd";
  hunt.skip = { allowed: true, afterFails: 2 };
  hunt.stations = [
    { ...Hunt.createStation(52.52, 13.405), riddle: "Rätsel 1", answers: ["Kölner Dom", "Dom"], hint: "Groß" },
    { ...Hunt.createStation(52.521, 13.41), riddle: "Rätsel 2", answers: ["Brücke"] },
  ];
  return hunt;
}

// Jagd mit 4 Stationen (A, B, C gemeinsam, D = Ziel) und 3 Teams.
function teamHunt() {
  const hunt = sampleHunt();
  const st = (lat, riddle, answer) => ({ ...Hunt.createStation(lat, 13.4), riddle, answers: [answer] });
  hunt.stations = [st(52.51, "A", "a"), st(52.52, "B", "b"), st(52.53, "C", "c"), { ...st(52.54, "Ziel", "z"), goal: true }];
  hunt.teams = [
    { name: "Rot", color: "#ff5a5f" },
    { name: "Blau", color: "#3a86ff" },
    { name: "Grün", color: "#2a9d4b" },
  ];
  hunt.finale = { enabled: true, riddle: "Was sucht ihr?", answer: "Schatz" };
  return hunt;
}

// --- hunt.js ---------------------------------------------------------------

test("normalizeAnswer: Groß/klein, Rand, Umlaute, Leerzeichen", () => {
  assertEqual(Hunt.normalizeAnswer("  Kölner   DOM "), "koelner dom");
  assertEqual(Hunt.normalizeAnswer("STRASSE"), Hunt.normalizeAnswer("Straße"));
  assertEqual(Hunt.normalizeAnswer("Müller"), "mueller");
  // "ä" als a + Trema-Zeichen (kommt bei manchen Tastaturen vor)
  assertEqual(Hunt.normalizeAnswer("Bär"), "baer");
});

test("createId: 8 Zeichen, nur a–z und 0–9", () => {
  const id = Hunt.createId();
  assert(/^[a-z0-9]{8}$/.test(id), id);
});

test("roundCoord: 5 Nachkommastellen", () => {
  assertEqual(Hunt.roundCoord(52.5200123456), 52.52001);
});

test("moveStation: verschiebt, ohne das Original zu ändern", () => {
  const list = ["a", "b", "c", "d"];
  assertEqual(Hunt.moveStation(list, 0, 2), ["b", "c", "a", "d"]);
  assertEqual(Hunt.moveStation(list, 3, 0), ["d", "a", "b", "c"]);
  assertEqual(list, ["a", "b", "c", "d"]);
});

test("hashAnswer: gleich trotz Schreibweise, verschieden je Jagd", async () => {
  const a = await Hunt.hashAnswer("abc", "Kölner Dom");
  const b = await Hunt.hashAnswer("abc", "  koelner dom ");
  const c = await Hunt.hashAnswer("xyz", "Kölner Dom");
  assertEqual(a, b);
  assert(a !== c, "andere Jagd-ID muss anderen Hash ergeben");
  assert(/^[A-Za-z0-9_-]{12}$/.test(a), "Hash-Format: " + a);
});

test("validateHunt: leere Jagd hat Fehler, Beispieljagd nicht", () => {
  const empty = Hunt.createHunt();
  const fields = Hunt.validateHunt(empty).map((e) => e.field);
  assertEqual(fields, ["title", "stations"]);
  assertEqual(Hunt.validateHunt(sampleHunt()), []);
});

test("validateHunt: Station ohne Rätsel und mit leerem Lösungswort", () => {
  const hunt = sampleHunt();
  hunt.stations[1].riddle = "  ";
  hunt.stations[1].answers = ["   "];
  const errors = Hunt.validateHunt(hunt);
  assertEqual(errors.map((e) => [e.station, e.field]), [[1, "riddle"], [1, "answers"]]);
});

test("toPlayHunt: kein Klartext mehr, Hashes stattdessen", async () => {
  const hunt = sampleHunt();
  const play = await Hunt.toPlayHunt(hunt);
  const json = JSON.stringify(play);
  assert(!json.includes("Dom") && !json.includes("Brücke"), "Klartext gefunden: " + json);
  assertEqual(play.stations[0].h.length, 2);
  assert(!("hint" in play.stations[1]), "leerer Hinweis sollte fehlen");
});

test("Link: kodieren und dekodieren (Spiel + Bearbeiten)", async () => {
  const hunt = sampleHunt();
  const play = await Hunt.toPlayHunt(hunt);
  const base = "https://example.org/stadtjagd/";

  const playLink = Hunt.buildPlayLink(base, play);
  assert(playLink.startsWith(base + "play.html#j="), playLink);
  const parsedPlay = Hunt.parseLinkHash(new URL(playLink).hash);
  assertEqual(parsedPlay, { mode: "play", hunt: play });

  const editLink = Hunt.buildEditLink(base, hunt);
  const parsedEdit = Hunt.parseLinkHash(new URL(editLink).hash);
  assertEqual(parsedEdit, { mode: "edit", hunt });
});

test("Link: kaputte oder manipulierte Daten → null", () => {
  assertEqual(Hunt.parseLinkHash("#j=quatsch"), null);
  assertEqual(Hunt.parseLinkHash("#x=abc"), null);
  assertEqual(Hunt.parseLinkHash(""), null);
  // gültiges LZString, aber falsche Struktur
  const bad = Hunt.encodeHunt({ v: 1, id: "a", title: 5 });
  assertEqual(Hunt.parseLinkHash("#j=" + bad), null);
  // Bearbeiten-Daten in einem Spiel-Link (answers statt h)
  const edit = Hunt.encodeHunt(sampleHunt());
  assertEqual(Hunt.parseLinkHash("#j=" + edit), null);
});

test("routeFingerprint: Texte egal, Ort/Reihenfolge/Lösung nicht", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt());
  const fp = await Hunt.routeFingerprint(play);
  assert(/^[A-Za-z0-9_-]{8}$/.test(fp), fp);

  const textChanged = { ...play, title: "Neu", stations: play.stations.map((s) => ({ ...s, riddle: "anders" })) };
  assertEqual(await Hunt.routeFingerprint(textChanged), fp);

  const moved = { ...play, stations: play.stations.map((s, i) => (i === 0 ? { ...s, lat: s.lat + 0.001 } : s)) };
  assert((await Hunt.routeFingerprint(moved)) !== fp, "verschobene Station muss anderen Abdruck ergeben");

  const reordered = { ...play, stations: [...play.stations].reverse() };
  assert((await Hunt.routeFingerprint(reordered)) !== fp, "neue Reihenfolge muss anderen Abdruck ergeben");
});

test("toEditableHunt: ergänzt fehlende Felder, lehnt Unsinn ab", () => {
  const raw = {
    v: 1, id: "abc", title: "T",
    skip: { allowed: true, afterFails: null }, // null entsteht aus NaN im JSON
    stations: [{ lat: 1, lng: 2, riddle: "R", answers: ["A"] }],
  };
  const hunt = Hunt.toEditableHunt(raw);
  assertEqual([hunt.intro, hunt.outro, hunt.skip.afterFails, hunt.stations[0].hint], ["", "", 3, ""]);
  assertEqual(Hunt.toEditableHunt(null), null);
  assertEqual(Hunt.toEditableHunt({ v: 1, id: "abc" }), null);
  const complete = sampleHunt();
  assertEqual(Hunt.toEditableHunt(complete), complete); // vollständige Jagd bleibt gleich
});

test("toEditableHunt: hebt alte v1-Jagden auf v2", () => {
  const v1 = { v: 1, id: "abc", title: "T", skip: { allowed: false, afterFails: 3 },
    stations: [{ lat: 1, lng: 2, riddle: "R", answers: ["A"], hint: "" }] };
  const hunt = Hunt.toEditableHunt(v1);
  assertEqual([hunt.v, hunt.teams, hunt.shuffle, hunt.finale.enabled, hunt.stations[0].goal, hunt.stations[0].teams],
    [2, [], true, false, false, null]);
});

test("teamRoutes: ohne Teams Listenreihenfolge, Ziel immer zuletzt", () => {
  const hunt = teamHunt();
  hunt.teams = [];
  hunt.stations = [hunt.stations[3], ...hunt.stations.slice(0, 3)]; // Ziel steht vorne in der Liste
  assertEqual(Hunt.teamRoutes(hunt), [[1, 2, 3, 0]]);
});

test("teamRoutes: Rotation pro Team, Ziel zuletzt", () => {
  assertEqual(Hunt.teamRoutes(teamHunt()), [[0, 1, 2, 3], [1, 2, 0, 3], [2, 0, 1, 3]]);
  const noShuffle = { ...teamHunt(), shuffle: false };
  assertEqual(Hunt.teamRoutes(noShuffle), [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]]);
});

test("teamRoutes: Stationen nur für bestimmte Teams", () => {
  const hunt = teamHunt();
  hunt.shuffle = false;
  hunt.stations[1].teams = [0]; // B nur für Rot
  hunt.stations[2].teams = [1, 2]; // C nur für Blau und Grün
  assertEqual(Hunt.teamRoutes(hunt), [[0, 1, 3], [0, 2, 3], [0, 2, 3]]);
});

test("removeTeam: Team-Nummern in Stationen rücken nach", () => {
  const hunt = teamHunt();
  hunt.stations[0].teams = [0, 2];
  hunt.stations[1].teams = [1];
  const after = Hunt.removeTeam(hunt, 1); // Blau weg
  assertEqual(after.teams.map((t) => t.name), ["Rot", "Grün"]);
  assertEqual([after.stations[0].teams, after.stations[1].teams, after.stations[2].teams], [[0, 1], [], null]);
  assertEqual(hunt.teams.length, 3); // Original unverändert
});

test("createTeam: nächster Name und freie Farbe", () => {
  const hunt = teamHunt();
  const team = Hunt.createTeam(hunt);
  assertEqual(team, { name: "Team 4", color: Hunt.TEAM_COLORS[3] });
});

test("splitFinale: gleichmäßig, Rest an die ersten Teams", () => {
  assertEqual(Hunt.splitFinale("Schatz", 3), ["SC", "HA", "TZ"]);
  assertEqual(Hunt.splitFinale("Berliner Dom", 3), ["BERL", "INER", "DOM"]); // Leerzeichen fallen weg
  assertEqual(Hunt.splitFinale("Eis", 2), ["EI", "S"]);
  assertEqual(Hunt.splitFinale("Bär", 3), ["B", "Ä", "R"]);
});

test("toPlayHunts: eigene ID, Route, Teamdaten und Finale-Teil pro Team", async () => {
  const results = await Hunt.toPlayHunts(teamHunt());
  assertEqual(results.length, 3);
  const blau = results[1].playHunt;
  assertEqual([blau.v, blau.id.endsWith("-2"), blau.stations.map((s) => s.riddle)], [1, true, ["B", "C", "A", "Ziel"]]);
  assertEqual(blau.team, { name: "Blau", color: "#3a86ff", number: 2, count: 3 });
  assertEqual([blau.finale.part, blau.finale.partNumber], ["HA", 2]);
  assert(!JSON.stringify(blau).toLowerCase().includes("schatz"), "Finale-Wort darf nicht im Klartext stehen");
  // Spiel-Link mit Teamdaten lässt sich wieder lesen
  assertEqual(Hunt.parseLinkHash("#j=" + Hunt.encodeHunt(blau)).hunt, blau);
});

test("toPlayHunts: ohne Teams genau eine Jagd ohne Teamfelder", async () => {
  const results = await Hunt.toPlayHunts(sampleHunt());
  assertEqual(results.length, 1);
  assertEqual([results[0].team, "team" in results[0].playHunt, "finale" in results[0].playHunt], [null, false, false]);
});

test("validateHunt: Teams-Fehler", () => {
  assertEqual(Hunt.validateHunt(teamHunt()), []);

  const one = { ...teamHunt(), teams: [{ name: "Allein", color: "#ff5a5f" }] };
  assert(Hunt.validateHunt(one).some((e) => e.field === "teams"), "1 Team ist zu wenig");

  const shortFinale = teamHunt();
  shortFinale.finale.answer = "Ei";
  assert(Hunt.validateHunt(shortFinale).some((e) => e.field === "finale"), "2 Buchstaben für 3 Teams");

  const orphan = teamHunt();
  orphan.stations[0].teams = [];
  assert(Hunt.validateHunt(orphan).some((e) => e.station === 0 && e.field === "teams"), "Station ohne Team");

  const twoGoals = teamHunt();
  twoGoals.stations[0].goal = true;
  assert(Hunt.validateHunt(twoGoals).some((e) => e.field === "goal"), "zwei Ziele");
});

test("Spiel-Link: Teamfarbe muss echte Farbe sein", async () => {
  const blau = (await Hunt.toPlayHunts(teamHunt()))[1].playHunt;
  const bad = { ...blau, team: { ...blau.team, color: "red;background:url(x)" } };
  assertEqual(Hunt.parseLinkHash("#j=" + Hunt.encodeHunt(bad)), null);
});

// --- game.js ---------------------------------------------------------------

test("distanceMeters: 1° Breite ≈ 111,2 km, gleicher Punkt = 0", () => {
  const d = Game.distanceMeters({ lat: 50, lng: 10 }, { lat: 51, lng: 10 });
  assert(Math.abs(d - 111195) < 10, "bekommen " + d);
  assertEqual(Game.distanceMeters({ lat: 50, lng: 10 }, { lat: 50, lng: 10 }), 0);
});

test("checkAnswer: richtig (auch Alternativwort), falsch zählt Fehlversuch", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt());
  let p = Game.createProgress(1000);

  let r = await Game.checkAnswer(play, p, "falsch", 2000);
  assertEqual([r.correct, r.progress.fails, r.progress.current], [false, 1, 0]);

  r = await Game.checkAnswer(play, r.progress, "  DOM ", 3000);
  assertEqual([r.correct, r.progress.fails, r.progress.current], [true, 0, 1]);

  r = await Game.checkAnswer(play, r.progress, "Bruecke", 4000);
  assert(r.correct, "Umlaut-Variante sollte passen");
  assert(Game.isFinished(r.progress), "Jagd sollte fertig sein");
  assertEqual(r.progress.finishedAt, 4000);
  assertEqual(Game.currentStation(play, r.progress), null);
});

test("checkLocation: ≤ 30 m gelöst, weiter weg nicht, ungenau nicht", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt());
  const p = Game.createProgress(0);
  // 0,0002° Breite ≈ 22 m nördlich der ersten Station
  const near = { lat: 52.5202, lng: 13.405, accuracy: 10 };
  const far = { lat: 52.5205, lng: 13.405, accuracy: 10 }; // ≈ 56 m
  const fuzzy = { lat: 52.52, lng: 13.405, accuracy: 80 };

  assertEqual(Game.checkLocation(play, p, near, 5).result, "solved");
  assertEqual(Game.checkLocation(play, p, near, 5).progress.current, 1);
  assertEqual(Game.checkLocation(play, p, far, 5).result, "too-far");
  assertEqual(Game.checkLocation(play, p, fuzzy, 5).result, "inaccurate");
  // GPS-Fehlschlag zählt nicht als Fehlversuch
  assertEqual(Game.checkLocation(play, p, far, 5).progress.fails, 0);
});

test("Hinweis erst nach 1 Fehlversuch und nur wenn vorhanden", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt());
  let p = Game.createProgress(0);
  assertEqual(Game.canShowHint(play, p), false);
  p = { ...p, fails: 1 };
  assertEqual(Game.canShowHint(play, p), true);
  p = { ...p, current: 1 }; // Station 2 hat keinen Hinweis
  assertEqual(Game.canShowHint(play, p), false);
});

test("Überspringen: nur wenn erlaubt und nach genug Fehlversuchen", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt()); // afterFails: 2
  let p = { ...Game.createProgress(0), fails: 1 };
  assertEqual(Game.canSkip(play, p), false);
  assertEqual(Game.skipStation(play, p, 9), p); // nichts passiert

  p = { ...p, fails: 2 };
  assertEqual(Game.canSkip(play, p), true);
  p = Game.skipStation(play, p, 9);
  assertEqual([p.current, p.fails, p.skipped], [1, 0, [0]]);

  const noSkip = { ...play, skip: { allowed: false, afterFails: 1 } };
  assertEqual(Game.canSkip(noSkip, { ...p, fails: 5 }), false);
});

test("isValidProgress: erkennt kaputte gespeicherte Daten", async () => {
  const play = await Hunt.toPlayHunt(sampleHunt());
  assert(Game.isValidProgress(play, Game.createProgress(0)));
  assert(!Game.isValidProgress(play, null));
  assert(!Game.isValidProgress(play, { ...Game.createProgress(0), current: 7 }));
  assert(!Game.isValidProgress(play, { startedAt: "gestern" }));
});

test("checkFinale: ganzes Wort nötig, Leerzeichen und Groß/klein egal", async () => {
  const rot = (await Hunt.toPlayHunts(teamHunt()))[0].playHunt;
  const p = Game.createProgress(0);
  assertEqual((await Game.checkFinale(rot, p, "SC")).correct, false); // nur der eigene Teil
  const r = await Game.checkFinale(rot, p, " sch atz ");
  assertEqual([r.correct, r.progress.finaleSolved], [true, true]);
  const classic = await Hunt.toPlayHunt(sampleHunt());
  assertEqual([Game.hasFinale(classic), (await Game.checkFinale(classic, p, "x")).correct], [false, false]);
});

test("Zeit: läuft, bleibt am Ende stehen, Formatierung", () => {
  const p = Game.createProgress(10_000);
  assertEqual(Game.elapsedMs(p, 85_000), 75_000);
  assertEqual(Game.elapsedMs({ ...p, finishedAt: 20_000 }, 999_999), 10_000);
  assertEqual(Game.formatDuration(75_000), "01:15");
  assertEqual(Game.formatDuration(3_725_000), "1:02:05");
  assertEqual(Game.formatDuration(0), "00:00");
});

// --- places.js -------------------------------------------------------------

// Erfundene Orte rund um einen Startpunkt (0,001° Breite ≈ 111 m)
const START = { lat: 52.5, lng: 13.4 };
function fakePlaces() {
  return [
    { lat: 52.501, lng: 13.4, name: "Neptunbrunnen", kind: "fountain" },
    { lat: 52.5012, lng: 13.4003, name: "Kleiner Brunnen", kind: "fountain" }, // ~35 m neben dem ersten
    { lat: 52.502, lng: 13.402, name: "Marienkirche", kind: "worship" },
    { lat: 52.503, lng: 13.4, name: "Stadtpark", kind: "park" },
    { lat: 52.5, lng: 13.405, name: "Alter Turm", kind: "tower" },
    { lat: 52.50005, lng: 13.4, name: "Direkt am Start", kind: "artwork" }, // zu nah am Start
  ];
}

test("buildSearchUrl: Wikipedia-Ortssuche mit Position und Umkreis", () => {
  const url = new URL(Places.buildSearchUrl(52.52191, 13.41321, 1000));
  assertEqual([url.hostname, url.searchParams.get("list"), url.searchParams.get("gscoord"), url.searchParams.get("gsradius")],
    ["de.wikipedia.org", "geosearch", "52.52191|13.41321", "1000"]);
  assertEqual(new URL(Places.buildSearchUrl(52.5, 13.4, 50000)).searchParams.get("gsradius"), "10000");
});

test("parsePlaces: nur passende Orte, Klammerzusatz weg, Unpassendes raus", () => {
  const item = (title, type = "landmark") => ({ title, type, lat: 52.5, lon: 13.4 });
  const json = { query: { geosearch: [
    item("Weltzeituhr (Alexanderplatz)"),
    item("Fischbrunnen (München)", "building"),
    item("Paulustor (Fulda)"),
    item("Alexanderplatz"),
    item("Bahnhof Berlin Alexanderplatz", "railwaystation"),
    item("Fulda", "city"),
    item("Berliner Sparkasse"),
    item("Winfriedschule Fulda", "building"),
    item("Alter jüdischer Friedhof (Fulda)"),
    item("Marienplatz 21 (München)"),
    item("Stelzenkrug (Berlin)", "building"), // kein bekanntes Wort → raus
    item("Fischbrunnen"), // doppelt
  ] } };
  assertEqual(Places.parsePlaces(json).map((p) => [p.name, p.kind]), [
    ["Weltzeituhr", "clock"],
    ["Fischbrunnen", "fountain"],
    ["Paulustor", "gate"],
    ["Alexanderplatz", "square"],
  ]);
});

test("kindOf: Reihenfolge und Wortgrenzen", () => {
  assertEqual(Places.kindOf("Kölner Dom"), "worship");
  assertEqual(Places.kindOf("Domplatz"), "square");
  assertEqual(Places.kindOf("Brandenburger Tor"), "gate");
  assertEqual(Places.kindOf("Fernsehturm"), "tower");
  assertEqual(Places.kindOf("Fuldaer Stadtschloss"), "castle");
  assertEqual(Places.kindOf("Motorhalle"), null);
});

test("directionName: Himmelsrichtungen", () => {
  assertEqual(Places.directionName(START, { lat: 52.51, lng: 13.4 }), "Norden");
  assertEqual(Places.directionName(START, { lat: 52.5, lng: 13.41 }), "Osten");
  assertEqual(Places.directionName(START, { lat: 52.49, lng: 13.385 }), "Südwesten");
});

test("stationFromPlace: Rätsel mit Weg, Name als Lösung, Hinweis", () => {
  const st = Places.stationFromPlace(fakePlaces()[0], START);
  assertEqual(st.riddle, "Hier plätschert Wasser. Geht etwa 100 m Richtung Norden. Wie heißt der Brunnen?");
  assertEqual(st.answers, ["Neptunbrunnen"]);
  assertEqual(st.hint, "Der Name beginnt mit „Ne…“ und hat 13 Buchstaben.");
});

test("answersFor: Kernwort zusätzlich bei langen Namen", () => {
  assertEqual(Places.answersFor({ name: "Berliner Fernsehturm", kind: "tower" }), ["Berliner Fernsehturm", "Fernsehturm"]);
  assertEqual(Places.answersFor({ name: "Hochschul- und Landesbibliothek Fulda", kind: "library" }),
    ["Hochschul- und Landesbibliothek Fulda", "Landesbibliothek"]);
  assertEqual(Places.answersFor({ name: "Fischbrunnen", kind: "fountain" }), ["Fischbrunnen"]);
});

test("pickRoute: Anzahl, Abstand zwischen Stationen, nicht am Start", () => {
  const route = Places.pickRoute(fakePlaces(), START, 10, () => 0.5);
  const names = route.map((p) => p.name);
  assert(!names.includes("Direkt am Start"), "zu nah am Start");
  assert(!(names.includes("Neptunbrunnen") && names.includes("Kleiner Brunnen")), "zwei Brunnen nebeneinander");
  for (let i = 0; i < route.length; i++) {
    for (let j = i + 1; j < route.length; j++) {
      assert(Game.distanceMeters(route[i], route[j]) >= 80, names[i] + " / " + names[j]);
    }
  }
  assertEqual(Places.pickRoute(fakePlaces(), START, 2, () => 0.5).length, 2);
});

test("buildAutoHunt: gültige Jagd, letzte Station ist das Ziel", () => {
  const hunt = Places.buildAutoHunt(fakePlaces(), START, 3, () => 0.5);
  assertEqual(hunt.stations.length, 3);
  assertEqual(hunt.stations.map((s) => s.goal), [false, false, true]);
  assertEqual(Hunt.validateHunt(hunt), []);
});

// --- Ausführen ---------------------------------------------------------------

async function run() {
  const list = document.getElementById("results");
  let passed = 0;
  for (const { name, fn } of tests) {
    const li = document.createElement("li");
    try {
      await fn();
      li.className = "pass";
      li.textContent = "OK  " + name;
      passed++;
    } catch (err) {
      li.className = "fail";
      li.textContent = "FEHLER  " + name + " – " + err.message;
      console.error(name, err);
    }
    list.appendChild(li);
  }
  const summary = document.getElementById("summary");
  summary.textContent = `${passed} von ${tests.length} Tests bestanden`;
  summary.className = passed === tests.length ? "pass" : "fail";
}

run();
