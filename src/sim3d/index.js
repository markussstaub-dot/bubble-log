// 3D-Ansicht für den Sim-Tab: Microlino (microlino.js) in einer endlichen Welt rund um Bexbach (welt.js), Tag und
// Nacht (licht.js), gemerkte Ziele als Leuchtsäulen (ziele.js). Die Fahrphysik bleibt in fahrsim.js, hier wird nur
// gezeichnet. Koordinaten: x = Osten, y = hoch, z = Süden (also z = -Norden), Meter ab Startpunkt.
import * as THREE from 'three';
import { auto, setHindernis, uhr } from '../fahrsim.js';
import { baueMicrolino } from './microlino.js';
import { weltStarten, weltNachfuehren, weltStoppen, blockiert, haus, hausMaterial } from './welt.js';
import { lichtStarten, lichtNachfuehren, lichtStoppen } from './licht.js';
import { zieleStarten, zieleNachfuehren, zieleStoppen } from './ziele.js';

export { setZiele } from './ziele.js';
export { lichtWechseln, licht } from './licht.js';

const V3 = THREE.Vector3;
const KAMERAS = ['Verfolger', 'Cockpit', 'Vogel'];

let renderer = null, szene = null, kamera = null, raf = 0, beobachter = null, leinwand = null, schild = null, quelle = null;
let wagen = null, kamModus = 0, letzteZeit = 0, hinweis = '', anzeige = () => ({});
const lage = { roll: 0, pitch: 0, spin: 0, vVorher: 0 };

function kameraSetzen(dt) {
  const c = auto(), vor = new V3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)), x = c.e, z = -c.n;
  if (kamModus === 0) {
    // Abstand verkürzen, wenn ein Haus zwischen Auto und Kamera steht
    let abstand = 6.2;
    for (let d = 1.5; d <= 6.2; d += 0.4) if (haus(x - vor.x * d, -(z - vor.z * d), 2.5)) { abstand = Math.max(1.5, d - 0.6); break; }
    const soll = new V3(x, 2.7, z).addScaledVector(vor, -abstand);
    kamera.position.lerp(soll, 1 - Math.exp(-dt * 4));
    kamera.lookAt(x + vor.x * 2, 1.0, z + vor.z * 2);
  } else if (kamModus === 1) {
    kamera.position.copy(wagen.root.localToWorld(new V3(-0.41, 1.22, -0.3)));
    kamera.lookAt(wagen.root.localToWorld(new V3(6, 0.9, -0.3)));
  } else {
    kamera.position.set(x - vor.x * 10, 38, z - vor.z * 10);
    kamera.lookAt(x, 0, z);
  }
}
function bild(t) {
  const dt = Math.min(0.1, (t - (letzteZeit || t)) / 1000); letzteZeit = t;
  const c = auto(), w = wagen.root;
  // Karosserie neigt sich in Kurven und beim Beschleunigen, Räder drehen und lenken mit
  const quer = c.v * c.v / 1.47 * Math.tan(c.steer), a = dt ? (c.v - lage.vVorher) / dt : 0; lage.vVorher = c.v;
  lage.roll += (Math.max(-0.06, Math.min(0.06, quer * 0.01)) - lage.roll) * Math.min(1, dt * 5);
  lage.pitch += (Math.max(-0.03, Math.min(0.03, a * 0.004)) - lage.pitch) * Math.min(1, dt * 5);
  lage.spin -= c.v * dt / 0.23;
  w.position.set(c.e, 0, -c.n);
  w.rotation.set(lage.roll, c.yaw, lage.pitch, 'YXZ');
  for (const r of wagen.raeder) { r.spin.rotation.z = lage.spin; r.pivot.rotation.y = r.vorn ? c.steer : 0; }
  w.updateMatrixWorld();
  for (const [l, wl] of wagen.ebenen) wl.copy(l).applyMatrix4(w.matrixWorld);
  const zeit = new Date(uhr()), { akku, fahrtKm } = anzeige();
  wagen.cockpit({ kmh: Math.abs(c.v) * 3.6, stufe: c.v > 0.05 ? 'D' : c.v < -0.05 ? 'R' : 'N', turbo: c.turbo, steer: c.steer, akku, fahrtKm,
    uhrzeit: `${String(zeit.getHours()).padStart(2, '0')}:${String(zeit.getMinutes()).padStart(2, '0')}` });
  weltNachfuehren();
  zieleNachfuehren();
  lichtNachfuehren();
  kameraSetzen(dt);
  renderer.render(szene, kamera);
  raf = requestAnimationFrame(bild);
}

function groesse() {
  const w = leinwand.parentElement.clientWidth, h = leinwand.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); kamera.aspect = w / h; kamera.updateProjectionMatrix();
}
function schildText() {
  if (schild) schild.textContent = `${KAMERAS[kamModus]} · tippen wechselt${hinweis ? ' · ' + hinweis : ''}`;
}
function melde(text) { hinweis = text; schildText(); setTimeout(() => { if (hinweis === text) { hinweis = ''; schildText(); } }, 6000); }
export function kameraWechseln() {
  kamModus = (kamModus + 1) % KAMERAS.length;
  kamera.fov = kamModus === 1 ? 70 : 55; kamera.updateProjectionMatrix(); schildText();
}
const tasteC = e => { if (e.key.toLowerCase() === 'c' && !e.target.matches('input, textarea')) kameraWechseln(); };

// optionen.anzeige(): { akku (%), fahrtKm (laufende Fahrt oder null) } für die Displays im Cockpit
export function starte(el, optionen = {}) {
  stoppe();
  anzeige = optionen.anzeige || (() => ({}));
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  leinwand = renderer.domElement; leinwand.className = 'sim-3d';
  el.appendChild(leinwand);
  schild = document.createElement('div'); schild.className = 'sim-3d-schild'; el.appendChild(schild);
  quelle = document.createElement('div'); quelle.className = 'sim-quelle'; quelle.textContent = '© OpenMapTiles © OpenStreetMap'; el.appendChild(quelle);
  leinwand.addEventListener('click', kameraWechseln);
  document.addEventListener('keydown', tasteC);
  setHindernis(blockiert);

  szene = new THREE.Scene();
  kamera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  wagen = baueMicrolino(); szene.add(wagen.root);  lichtStarten(szene, { hausMaterial, leuchten: wagen.leuchten, scheinwerfer: wagen.scheinwerfer });
  weltStarten(szene, melde);
  zieleStarten(szene);

  const c = auto();
  kamera.position.set(c.e - Math.cos(c.yaw) * 6.2, 2.7, -c.n + Math.sin(c.yaw) * 6.2);
  lage.vVorher = c.v; kamModus = 0; hinweis = ''; schildText();
  beobachter = new ResizeObserver(groesse); beobachter.observe(el); groesse();
  letzteZeit = 0; raf = requestAnimationFrame(bild);
}

export function stoppe() {
  cancelAnimationFrame(raf); raf = 0;
  document.removeEventListener('keydown', tasteC);
  setHindernis(null);
  beobachter?.disconnect(); beobachter = null;
  if (renderer) {
    szene.traverse(o => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.dispose(); } });
    renderer.dispose(); leinwand.remove(); schild.remove(); quelle.remove();
  }
  weltStoppen(); zieleStoppen(); lichtStoppen();
  renderer = szene = kamera = wagen = leinwand = schild = quelle = null;
}

export const laeuft = () => !!renderer;
