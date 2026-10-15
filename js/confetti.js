// confetti.js – Kleiner, selbst gebauter Konfetti-Effekt (ohne Bibliothek).
//
// So funktioniert's: Eine durchsichtige Zeichenfläche (<canvas>) liegt kurz
// über der Seite. Jedes Konfetti-Stück ist ein Objekt mit Position und
// Geschwindigkeit. 60-mal pro Sekunde bewegen wir alle Stücke ein Stück
// weiter, lassen die Schwerkraft wirken und zeichnen sie neu.

const COLORS = ["#ff5a5f", "#2ec4b6", "#ffbe0b", "#8338ec", "#3a86ff", "#fb5607"];
const GRAVITY = 0.25;
const DRAG = 0.985; // Luftwiderstand: Geschwindigkeit nimmt pro Bild leicht ab

// size: "small" (Station geschafft) oder "big" (Jagd geschafft)
export function launchConfetti(size = "small") {
  // Wer im System "Bewegung reduzieren" eingestellt hat, bekommt kein Konfetti.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);

  // Scharf zeichnen auch auf Handys mit hoher Pixeldichte
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  const pieces = [];
  if (size === "big") {
    // Zwei Kanonen links und rechts unten, die nach innen schießen
    pieces.push(...burst(120, 0, height, -60, width, height));
    pieces.push(...burst(120, width, height, -120, width, height));
  } else {
    pieces.push(...burst(70, width / 2, height * 0.35, -90, width, height, 360));
  }

  // Dauer in Millisekunden. Zeitbasiert statt "Anzahl Bilder", weil der Browser
  // im Hintergrund weniger (oder gar keine) Bilder zeichnet.
  const duration = size === "big" ? 4500 : 2500;
  let start = null;
  let frame = 0;

  // Sicherheitsnetz: Fläche spätestens kurz nach Ende entfernen.
  setTimeout(() => canvas.remove(), duration + 500);

  function tick(now) {
    if (start === null) start = now;
    const elapsed = now - start;
    frame++;
    ctx.clearRect(0, 0, width, height);
    for (const p of pieces) {
      p.vx *= DRAG;
      p.vy = p.vy * DRAG + GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      // Kippen um die eigene Achse: Breite schwankt → wirkt wie Flattern
      const flutter = Math.cos(frame * 0.1 + p.phase);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(0, Math.min(1, (duration - elapsed) / 600)); // am Ende ausblenden
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, (-p.h / 2) * flutter, p.w, p.h * flutter);
      ctx.restore();
    }

    if (elapsed < duration && canvas.isConnected) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(tick);
}

// Erzeugt "count" Stücke an Punkt (x, y), die grob in Richtung "angle" fliegen.
// angle in Grad: -90 = nach oben, -60 = schräg nach rechts oben.
// spread = Streuung in Grad (360 = in alle Richtungen).
function burst(count, x, y, angle, width, height, spread = 50) {
  const pieces = [];
  const speedBase = Math.min(width, height) / 30;
  for (let i = 0; i < count; i++) {
    const a = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const speed = speedBase * (0.6 + Math.random() * 0.9);
    pieces.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 8,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      phase: Math.random() * Math.PI * 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  return pieces;
}
