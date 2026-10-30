// Sim-Tab: Oberfläche des Fahrsimulators (Karte oder 3D, Anzeige, Joystick oder Tasten). Der Sandkasten selbst
// (Kopie der Daten, Fahrterkennung im Sim-Modus) bleibt in main.js; die Physik steckt in fahrsim.js, die 3D-Ansicht
// in sim3d/. main.js verbindet sich einmal über simTabVerbinden und reicht dabei die nötigen Helfer herein.
import * as fahrsim from './fahrsim.js';
import * as bm6 from './bm6.js';

const $ = id => document.getElementById(id);
const LICHT_TEXT = { echt: '🕒 Echtzeit', tag: '☀️ Tag', nacht: '🌙 Nacht' };

// app: { eigen(), tracker(), start(), ziele(), schaetzung(o), socJetzt(), km(x), toast(text) }
let app = null, sim3d = null, drei = false, tasten = false, hudTakt = 0;
export function simTabVerbinden(a) { app = a; }

function ansicht() {
  return `<div class="sim-banner">SIMULATION · nichts wird gespeichert</div>
    <div class="sim-karte" id="simKarte"></div>
    <div class="sim-hud" id="simHud"></div>
    <div class="chips" id="simBm6"></div>
    <div class="sim-steuer" id="simSteuer">${steuerung()}</div>
    <div class="grid2"><button class="btn" data-act="simWarten">⏩ 3 min stehen</button><button class="btn" data-sim-zurueck data-sim="zurueck">Rückwärts</button></div>
    <div class="grid2"><button class="btn" data-act="sim3d" id="sim3d">${drei ? '🗺️ Karte' : '🧊 3D-Ansicht'}</button><button class="btn" data-act="simDrehen" id="simDrehen" ${drei ? 'hidden' : ''}>${fahrsim.dreht() ? '🧭 Dreht mit' : '🧭 Eingenordet'}</button><button class="btn" data-act="simLicht" id="simLicht" ${drei ? '' : 'hidden'}>${LICHT_TEXT[sim3d?.licht() ?? 'echt']}</button></div>
    <button class="btn" data-act="simJoystick" id="simJoystickKnopf">${tasten ? '🕹️ Joystick statt Tasten' : '◀ ▶ Tasten statt Joystick'}</button>
    <p class="small muted" style="margin:0">Joystick: nach vorn Gas (je weiter, desto schneller), zurück bremsen und im Stand rückwärts, seitlich lenken. Tastatur: W/S oder Pfeile Gas und rückwärts, A/D lenken, Leertaste bremsen, T Turbo, C Kamera (3D). Die 3D-Welt ist ein 11 × 11 km großes Stück rund um Bexbach und geht ohne Netz; Häuser, Bäume und der rot-weiße Rand sind Hindernisse. Tippen aufs 3D-Bild wechselt die Kamera, Licht „Echtzeit“ folgt dem Sonnenstand. Die App erkennt Fahrten wie mit echtem GPS; „3 min stehen“ beendet die Fahrt im Zeitraffer. Beim Verlassen des Tabs ist alles wie vorher.</p>`;
}
// Joystick (Standard) oder einzelne Tasten zum Gedrückthalten
function steuerung() {
  const turbo = `<button class="sim-btn klein" data-act="simTurbo" id="simTurbo">Turbo</button>`;
  if (!tasten) return `<div class="sim-joy" id="simJoy" aria-label="Joystick: vorn Gas, zurück Bremse, seitlich lenken"><div class="sim-knauf" id="simKnauf"></div></div>
    <div class="sim-reihe sim-spalte">${turbo}<button class="sim-btn" data-sim="bremse">Bremse</button></div>`;
  return `<div class="sim-reihe"><button class="sim-btn" data-sim="links" aria-label="Links lenken">◀</button><button class="sim-btn" data-sim="rechts" aria-label="Rechts lenken">▶</button></div>
    <div class="sim-reihe">${turbo}<button class="sim-btn" data-sim="bremse">Bremse</button><button class="sim-btn gas" data-sim="gas">Gas</button></div>`;
}
export function simHud() {
  const el = $('simHud'); if (!el) return;
  const z = fahrsim.zustand(), o = app.eigen().offen, t = app.tracker();
  el.innerHTML = `<div><div class="num">${Math.round(z.kmh)}</div><div class="muted small">km/h${z.turbo ? ' · Turbo' : ''}${z.rueckwaerts ? ' · R' : ''}</div></div>
    <div><div class="num">${o ? app.km(o.km) : '–'}</div><div class="muted small">${o ? (o.status === 'faehrt' ? 'Fahrt läuft' : 'Fahrt beendet') : t.modus === 'warten' ? 'wartet auf Fahrt' : t.modus}</div></div>
    <div><div class="num">${o?.startSoc != null ? app.schaetzung(o) : app.socJetzt()} %</div><div class="muted small">Akku geschätzt</div></div>`;
  $('simTurbo')?.classList.toggle('an', z.turbo);
  bm6Chips();
}
// 12-V-Batterie (simulierter BM6, SPEC-12v.md): Verhalten wählen, aktueller Wert
function bm6Chips() {
  const el = $('simBm6'); if (!el) return;
  bm6.aktuell().then(w => {
    el.innerHTML = `<span class="chip">12 V: ${w && bm6.aktiv() ? `${w.v.toFixed(2).replace('.', ',')} V` : 'aus'}</span>` + Object.entries(bm6.SIM_PROFILE)
      .map(([k, t]) => `<button class="chip" data-act="simBm6" data-wert="${k}" aria-pressed="${bm6.profil() === k}">${t}</button>`).join('');
  });
}
// Tab zeichnen; Karte und Fahrzustand bleiben beim Neuzeichnen erhalten
export function simTabZeichnen(view) {
  if (!$('simKarte')) {
    view.innerHTML = ansicht();
    fahrsim.starte($('simKarte'), { start: app.start(), onPosition: loc => app.tracker().einspeisen(loc), onHud: () => { if (++hudTakt % 6 === 0) simHud(); } });
    if (drei) dreiSchalten(true);
  }
  simHud();
}
export function simTabStoppen() { sim3d?.stoppe(); fahrsim.stoppe(); }

// 3D-Ansicht (three.js) erst laden, wenn sie gebraucht wird
async function dreiSchalten(an) {
  drei = an;
  if (an) {
    sim3d ??= await import('./sim3d/index.js');
    if ($('simKarte') && fahrsim.laeuft() && !sim3d.laeuft()) {
      sim3d.starte($('simKarte'), { anzeige: () => {   // Akku und laufende Fahrt aus dem Sandkasten für die Cockpit-Displays
        const o = app.eigen().offen;
        return { akku: o?.startSoc != null ? app.schaetzung(o) : app.socJetzt(), fahrtKm: o?.status === 'faehrt' ? o.km : null };
      } });
      sim3d.setZiele(app.ziele());
    }
  } else sim3d?.stoppe();
  const b = $('sim3d'); if (b) b.textContent = an ? '🗺️ Karte' : '🧊 3D-Ansicht';
  const d = $('simDrehen'); if (d) d.hidden = an;
  const l = $('simLicht'); if (l) { l.hidden = !an; l.textContent = LICHT_TEXT[sim3d?.licht() ?? 'echt']; }
}

// Klick auf data-act; true, wenn es eine Sim-Aktion war
export function simAktion(act, d = {}) {
  switch (act) {
    case 'simTurbo': fahrsim.turbo(); simHud(); return true;
    case 'simDrehen': $('simDrehen').textContent = fahrsim.kartenDrehung() ? '🧭 Dreht mit' : '🧭 Eingenordet'; return true;
    case 'sim3d': dreiSchalten(!drei); return true;
    case 'simLicht': if (sim3d) $('simLicht').textContent = LICHT_TEXT[sim3d.lichtWechseln()]; return true;
    case 'simJoystick':
      tasten = !tasten; fahrsim.setJoystick(null);
      $('simSteuer').innerHTML = steuerung(); simHud();
      $('simJoystickKnopf').textContent = tasten ? '🕹️ Joystick statt Tasten' : '◀ ▶ Tasten statt Joystick';
      return true;
    case 'simBm6': bm6.setProfil(d.wert); bm6Chips(); return true;
    case 'simWarten': fahrsim.warten(185); simHud(); app.toast('3 Minuten gestanden'); return true;
  }
  return false;
}

// Sim-Knöpfe zum Gedrückthalten, pro Finger einzeln (Gas und Lenken gleichzeitig)
const finger = new Map();
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-sim]'); if (!b) return;
  e.preventDefault(); finger.set(e.pointerId, b); fahrsim.taste(b.dataset.sim, true); b.classList.add('an');
});
const loslassen = e => {
  const b = finger.get(e.pointerId); if (!b) return;
  finger.delete(e.pointerId);
  if (![...finger.values()].includes(b)) { fahrsim.taste(b.dataset.sim, false); b.classList.remove('an'); }
};
document.addEventListener('pointerup', loslassen); document.addEventListener('pointercancel', loslassen);

// Joystick: ein Finger hält den Knauf; Auslenkung relativ zum Radius, Knauf folgt bis zum Rand
let joyFinger = null;
function joySetzen(e) {
  const pad = $('simJoy'), knauf = $('simKnauf'); if (!pad) return;
  const r = pad.getBoundingClientRect(), rad = r.width / 2 - 22;
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const l = Math.hypot(dx, dy); if (l > rad) { dx *= rad / l; dy *= rad / l; }
  knauf.style.transform = `translate(${dx}px, ${dy}px)`;
  fahrsim.setJoystick(dx / rad, -dy / rad);
}
document.addEventListener('pointerdown', e => {
  const pad = e.target.closest('#simJoy'); if (!pad || joyFinger !== null) return;
  e.preventDefault(); joyFinger = e.pointerId; pad.classList.add('an'); joySetzen(e);
  try { pad.setPointerCapture(e.pointerId); } catch { /* Finger schon weg: dann eben ohne Capture */ }
});
document.addEventListener('pointermove', e => { if (e.pointerId === joyFinger) joySetzen(e); });
const joyLoslassen = e => {
  if (e.pointerId !== joyFinger) return;
  joyFinger = null; fahrsim.setJoystick(null);
  const knauf = $('simKnauf'); if (knauf) knauf.style.transform = '';
  $('simJoy')?.classList.remove('an');
};
document.addEventListener('pointerup', joyLoslassen); document.addEventListener('pointercancel', joyLoslassen);
