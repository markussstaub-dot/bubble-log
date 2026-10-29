// Scrollrad nach dem Standard aus „God's Own UI Elements“ (../../design/gods-own-ui/scrollrad, Scrollrad MK IV):
// Trommel mit echter Physik (Masse, Reibung, Rastung, Gummi-Anschlag), Klick per Web Audio und Vibration je Rastung.
// RadPhysik ist ohne DOM und wird in tests/scrollrad.test.js geprüft.

export const STANDARD = { masse: 1, viskos: 2.5, haft: 1.5, rast: 60, zeta: 0.7, griff: 800 };
const ANSCHLAG = 3000;

export class RadPhysik {
  // pos und Indizes zählen in Rastungen: 0 … anzahl−1
  constructor(anzahl, pos = 0, p = STANDARD) {
    this.n = anzahl; this.pos = pos; this.vel = 0; this.p = { ...p };
    this.finger = null;          // { ziel, v } solange ein Finger zieht
    this.virtuellRest = 0;       // Sekunden, die ein „gedachter Finger“ das Rad noch auf ein Ziel dreht
    this.rastK = Math.round(pos); this.imAnschlag = false;
    this.ereignisse = [];        // { typ: 'rast' | 'anschlag', v, t }
  }
  get index() { return Math.min(this.n - 1, Math.max(0, Math.round(this.finger && this.virtuellRest > 0 ? this.finger.ziel : this.pos))); }
  get ruht() { return !this.finger && this.vel === 0; }
  dreheZu(ziel, sek = 0.15 + 0.02 * Math.min(60, Math.abs(ziel - this.pos))) {
    this.finger = { ziel: Math.min(this.n - 1, Math.max(0, ziel)), v: 0 }; this.virtuellRest = sek;
  }
  schritt(dt, t = 0) {
    const p = this.p, I = p.masse;
    if (this.virtuellRest > 0 && (this.virtuellRest -= dt) <= 0) { this.finger = null; this.virtuellRest = 0; }
    let tau = -p.rast * Math.sin(2 * Math.PI * this.pos);
    const cs = 2 * Math.sqrt(ANSCHLAG * I);      // kritisch gedämpft: Rad bleibt am Rand, statt zurückzufedern
    if (this.pos < 0) tau += -ANSCHLAG * this.pos - cs * this.vel;
    else if (this.pos > this.n - 1) tau += -ANSCHLAG * (this.pos - this.n + 1) - cs * this.vel;
    if (this.finger) tau += p.griff * (this.finger.ziel - this.pos) - 1.6 * Math.sqrt(p.griff * I) * (this.vel - this.finger.v);
    tau -= p.viskos * this.vel;
    // Rastdämpfung nur langsam im Rastpunkt, damit es nicht nachwippt
    tau -= 2 * p.zeta * Math.sqrt(2 * Math.PI * p.rast * I) * Math.max(0, 1 - Math.abs(this.vel) / 8) * this.vel;
    // Haftreibung im Stand etwas höher als im Lauf, sonst kriecht das Rad am Rand der Rastmulde ewig weiter
    if (Math.abs(this.vel) < 0.05) {
      if (Math.abs(tau) <= p.haft * 1.3) { this.vel = 0; return; }
      tau -= p.haft * Math.sign(tau);
    } else tau -= p.haft * Math.sign(this.vel);
    this.vel = Math.max(-400, Math.min(400, this.vel + tau / I * dt));
    this.pos += this.vel * dt;
    const k = Math.round(this.pos);
    if (k !== this.rastK) { this.rastK = k; if (k >= 0 && k < this.n) this.ereignisse.push({ typ: 'rast', v: Math.abs(this.vel), t }); }
    const aussen = this.pos < -0.02 || this.pos > this.n - 1 + 0.02;
    if (aussen && !this.imAnschlag && Math.abs(this.vel) > 2) this.ereignisse.push({ typ: 'anschlag', v: Math.abs(this.vel), t });
    this.imAnschlag = aussen;
  }
  laufen(sek, hz = 2000) { const dt = 1 / hz; for (let i = 0, n = Math.round(sek * hz); i < n; i++) this.schritt(dt, i * dt); }
}

// ---------- Klang und Vibration ----------
let ac = null, rauschen = null, letzterKlick = 0;
function audioStart() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  rauschen = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = rauschen.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function klick(versatz, staerke, anschlag) {
  if (!ac) return;
  const t = ac.currentTime + 0.005 + versatz;
  if (t - letzterKlick < 1 / 150) return;
  letzterKlick = t;
  const src = ac.createBufferSource(); src.buffer = rauschen;
  const f = ac.createBiquadFilter(); f.type = anschlag ? 'lowpass' : 'bandpass';
  f.frequency.value = anschlag ? 500 : 4800; f.Q.value = anschlag ? 0.7 : 8;
  const g = ac.createGain(), dauer = anschlag ? 0.08 : 0.012;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 * staerke, t + 0.0007);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
  src.connect(f).connect(g).connect(ac.destination); src.start(t, Math.random() * 0.4); src.stop(t + dauer + 0.02);
}
let letzteVib = 0;
function vibriere(ms) {
  const jetzt = performance.now();
  if (typeof navigator.vibrate !== 'function' || jetzt - letzteVib < 33 || navigator.userActivation?.hasBeenActive === false) return;
  letzteVib = jetzt;
  try { navigator.vibrate(ms); } catch {}
}

// ---------- Rad auf einem Canvas ----------
// opts: { anzahl, index, text(i), einheit, onChange(i), zeilenHoehe }
export function scrollrad(cv, opts) {
  const zeile = opts.zeilenHoehe || 44;
  const ph = new RadPhysik(opts.anzahl, opts.index);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, laeuft = false, tAlt = 0, gemeldet = ph.index;
  const fing = { id: null, startY: 0, startPos: 0, letzteT: 0 };
  const R = () => H / 2;                       // Trommelradius
  const winkel = () => zeile / R();            // Winkel je Rastung, damit die Mitte zeile px hoch ist

  function groesse() {
    DPR = Math.min(window.devicePixelRatio || 1, 3); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); zeichnen();
  }
  const ro = new ResizeObserver(groesse); ro.observe(cv);

  function zeichnen() {
    if (!W) return;
    const css = getComputedStyle(cv), farbe = n => css.getPropertyValue(n).trim();
    const ink = farbe('--ink'), muted = farbe('--muted'), line = farbe('--line'), sunk = farbe('--sunk');
    const schrift = farbe('--f-display') || 'sans-serif', r = R(), w = winkel(), cy = H / 2, cx = W / 2;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    // Mittelband wie bisher die Markierung
    ctx.fillStyle = sunk; ctx.fillRect(0, cy - zeile / 2, W, zeile);
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy - zeile / 2 + 0.5); ctx.lineTo(W, cy - zeile / 2 + 0.5);
    ctx.moveTo(0, cy + zeile / 2 - 0.5); ctx.lineTo(W, cy + zeile / 2 - 0.5); ctx.stroke();
    // Rändelung an den Seiten, läuft mit der Trommel
    ctx.strokeStyle = line;
    for (const xs of [6, W - 18]) for (let j = 0; j < 100; j++) {
      const b = ((j * Math.PI * 2 / 100 - ph.pos * w) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(b) >= Math.PI / 2) continue;
      const y = cy + r * Math.sin(b), c = Math.cos(b), h = 3 * c;
      ctx.globalAlpha = 0.25 + 0.75 * c; ctx.lineWidth = 0.6 + c;
      ctx.beginPath(); ctx.moveTo(xs, y - h); ctx.lineTo(xs + 12, y + h); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Zahlen auf der Trommel
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const basis = Math.round(ph.pos);
    for (let i = basis - 6; i <= basis + 6; i++) {
      if (i < 0 || i >= ph.n) continue;
      const a = (i - ph.pos) * w;
      if (Math.abs(a) >= Math.PI / 2 - 0.05) continue;
      const y = cy + r * Math.sin(a), c = Math.cos(a), nah = Math.max(0, 1 - Math.abs(i - ph.pos));
      ctx.save(); ctx.translate(cx, y); ctx.scale(1, c);
      ctx.font = `${nah > 0.5 ? 600 : 400} ${26 + 14 * nah}px ${schrift}`;
      ctx.fillStyle = nah > 0.5 ? ink : muted; ctx.globalAlpha = Math.pow(c, 1.6);
      ctx.fillText(opts.text(i), 0, 0);
      ctx.restore();
    }
    if (opts.einheit) {
      ctx.font = `22px ${schrift}`; ctx.fillStyle = muted; ctx.globalAlpha = 1;
      ctx.fillText(opts.einheit, W * 0.78, cy);
    }
  }

  function rahmen(jetzt) {
    if (!cv.isConnected) { laeuft = false; ro.disconnect(); return; }
    const dtR = Math.min(0.05, (jetzt - tAlt) / 1000); tAlt = jetzt;
    if (ph.finger && fing.id !== null && jetzt - fing.letzteT > 40) ph.finger.v *= 0.7;   // Finger steht still
    const schritte = Math.max(1, Math.round(dtR * 2000)), dt = dtR / schritte;
    for (let i = 0; i < schritte; i++) ph.schritt(dt, i * dt);
    for (const e of ph.ereignisse) {
      if (e.typ === 'rast') { klick(e.t, Math.min(1, 0.25 + e.v / 25), false); vibriere(10); }
      else { klick(e.t, Math.min(1, e.v / 30), true); vibriere(25); }
    }
    ph.ereignisse.length = 0;
    if (ph.index !== gemeldet) { gemeldet = ph.index; opts.onChange?.(gemeldet); }
    zeichnen();
    // Ruht das Rad, schläft auch die Schleife (Akku im Auto schonen)
    if (ph.ruht) { laeuft = false; return; }
    requestAnimationFrame(rahmen);
  }
  function wecken() { if (!laeuft) { laeuft = true; tAlt = performance.now(); requestAnimationFrame(rahmen); } }

  cv.addEventListener('pointerdown', e => {
    if (fing.id !== null) return;
    audioStart();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    Object.assign(fing, { id: e.pointerId, startY: e.clientY, startPos: ph.pos, letzteT: performance.now() });
    ph.virtuellRest = 0; ph.finger = { ziel: ph.pos, v: 0 }; wecken();
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== fing.id) return;
    const jetzt = performance.now(), ziel = fing.startPos + (fing.startY - e.clientY) / zeile;
    const dtm = Math.max(1, jetzt - fing.letzteT) / 1000;
    ph.finger.v = 0.6 * ((ziel - ph.finger.ziel) / dtm) + 0.4 * ph.finger.v;
    ph.finger.ziel = ziel; fing.letzteT = jetzt;
  });
  const los = e => { if (e.pointerId !== fing.id) return; fing.id = null; ph.finger = null; wecken(); };
  cv.addEventListener('pointerup', los);
  cv.addEventListener('pointercancel', los);
  cv.addEventListener('wheel', e => { e.preventDefault(); ph.vel += (e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * 0.03; wecken(); }, { passive: false });
  cv.addEventListener('keydown', e => {
    const r = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
    if (!r) return;
    e.preventDefault(); audioStart(); ph.dreheZu(ph.index + r); wecken();
  });

  groesse();
  return {
    index: () => ph.index,
    // Rad sichtbar auf einen Wert drehen, z. B. nach der Foto-Erkennung
    setze(i) { ph.dreheZu(i); wecken(); },
  };
}
