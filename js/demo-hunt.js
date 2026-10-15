// demo-hunt.js – VORÜBERGEHEND: fest eingebaute Test-Jagd für play.html.
// Wird benutzt, solange es noch keinen Ersteller gibt (play.html ohne #j=...).
// Kann gelöscht werden, sobald create.html echte Links erzeugt.
//
// Lösungswörter zum Testen: "Fernsehturm" / "Alex", "Spree", "Dom"

export const DEMO_HUNT = {
  v: 1,
  id: "demo0001", // feste ID, damit der Fortschritt beim Neuladen erhalten bleibt
  title: "Demo-Jagd Berlin Mitte",
  intro: "Willkommen zur Demo-Jagd!\nLöse drei Rätsel rund um den Alexanderplatz.",
  outro: "Treffpunkt zum Feiern: am Brunnen der Völkerfreundschaft.",
  skip: { allowed: true, afterFails: 2 },
  stations: [
    {
      lat: 52.52082,
      lng: 13.40942,
      riddle: "Ich bin 368 Meter groß und habe eine silberne Kugel auf dem Kopf. Wer bin ich?",
      answers: ["Fernsehturm", "Alex"],
      hint: "Man sieht mich von fast überall in Berlin.",
    },
    {
      lat: 52.51934,
      lng: 13.40257,
      riddle: "Ich fließe mitten durch Berlin und trage Ausflugsschiffe. Wie heiße ich?",
      answers: ["Spree"],
      hint: "",
    },
    {
      lat: 52.51904,
      lng: 13.40107,
      riddle: "Meine grüne Kuppel steht auf der Museumsinsel. Wie nennt man mich kurz?",
      answers: ["Dom", "Berliner Dom"],
      hint: "Hier wird gebetet, nicht gebadet.",
    },
  ],
};
