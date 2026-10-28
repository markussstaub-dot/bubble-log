// Mini-Fahrsimulator: Microlino von oben auf der OpenStreetMap-Karte.
// Fahrphysik aus der Probefahrt im „Microlino Button-Planer“ (Einspurmodell, Radstand 1,47 m,
// 50 km/h normal, 90 km/h mit Turbo). Liefert jede Sekunde eine Position wie ein GPS.
import L from 'leaflet';

const WHEELBASE = 1.47, STEER_MAX = 0.37, VMAX = 13.9, VMAX_TURBO = 25, VREV = 4.2;
const GPS_TAKT = 1000;   // ms zwischen zwei gemeldeten Positionen
const MAX_QUER = 3.5;    // m/s² Querbeschleunigung in Kurven, etwa zügiges Stadtfahren

let karte = null, marker = null, spur = null, raf = 0, gpsTimer = 0, letzteZeit = 0;
let innen = null, drehen = true;   // drehen: Karte dreht mit, der Microlino zeigt immer nach oben (wie ein Navi)
let ursprung = [0, 0], meldung = () => {}, hud = () => {};
const car = { e: 0, n: 0, yaw: Math.PI / 2, v: 0, steer: 0, turbo: false };
const keys = new Set();
let uhrVersatz = 0;   // ms, um die die gespielte Uhr vorläuft („3 min warten“)

// Mini-Microlino von oben, Front oben: Bubble-Form, Fronttür mit Scheibe und Lichtband, Stoff-Schiebedach,
// Außenspiegel, hinten schmalere Spur. Lack wie im Button-Planer (#8fbac6).
const MICROLINO = `<svg viewBox="0 0 30 46" width="30" height="46" aria-hidden="true">
  <ellipse cx="15" cy="24" rx="12" ry="20" fill="rgba(0,0,0,.25)"/>
  <g fill="#1d2023"><rect x="2" y="9" width="3.4" height="7" rx="1.2"/><rect x="24.6" y="9" width="3.4" height="7" rx="1.2"/>
    <rect x="4" y="31" width="3.2" height="7" rx="1.2"/><rect x="22.8" y="31" width="3.2" height="7" rx="1.2"/></g>
  <path d="M15 2 C23 2 27 8 27 17 L26.5 31 C26 38 21.5 43 15 43 C8.5 43 4 38 3.5 31 L3 17 C3 8 7 2 15 2 Z" fill="#8fbac6" stroke="#4e7682" stroke-width="1"/>
  <path d="M6.3 8.5 C9 5 21 5 23.7 8.5 L22.5 14.5 C19 13 11 13 7.5 14.5 Z" fill="#23343a" opacity=".9"/>
  <path d="M7 4.6 C11 2.6 19 2.6 23 4.6" fill="none" stroke="#fff4dc" stroke-width="1.6" stroke-linecap="round"/>
  <rect x="8.5" y="16" width="13" height="16" rx="4" fill="#a6cad4"/>
  <rect x="11" y="18" width="8" height="11" rx="2.5" fill="#34383c"/>
  <path d="M8.5 36 C11 38.5 19 38.5 21.5 36" fill="none" stroke="#23343a" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M10 41.3 L12 41.3 M18 41.3 L20 41.3" stroke="#d0302a" stroke-width="1.4" stroke-linecap="round"/>
  <ellipse cx="2" cy="13.5" rx="1.6" ry="1.1" fill="#1d2023"/><ellipse cx="28" cy="13.5" rx="1.6" ry="1.1" fill="#1d2023"/>
</svg>`;

const simZeit = () => Date.now() + uhrVersatz;
function position() {
  const lat = ursprung[0] + car.n / 111320;
  return [lat, ursprung[1] + car.e / (111320 * Math.cos(ursprung[0] * Math.PI / 180))];
}
const gpsPunkt = () => { const [lat, lon] = position(); return { latitude: lat, longitude: lon, accuracy: 5, speed: Math.abs(car.v), altitude: null, time: simZeit() }; };

function schritt(dt) {
  // Joystick: nach vorn = Gas (stufenlos), nach hinten = bremsen und im Stand rückwärts, seitlich = lenken
  const js = joystick && Math.hypot(joystick.x, joystick.y) > 0.12 ? joystick : null;
  const jsVor = js && js.y > 0.12 ? js.y : 0, jsZurueck = js && js.y < -0.12 ? -js.y : 0;
  const fwd = keys.has('gas') || jsVor > 0, back = keys.has('zurueck') || (jsZurueck > 0 && car.v <= 0.3);
  const brake = keys.has('bremse') || (jsZurueck > 0 && car.v > 0.3);
  const turboOn = car.turbo, stufe = keys.has('gas') || !jsVor ? 1 : jsVor;   // Joystick halb vorn ≈ halbe Höchstgeschwindigkeit
  const vmax = (turboOn ? VMAX_TURBO : VMAX) * Math.max(0.2, stufe), acc = (turboOn ? 4 : 2.6) * Math.max(0.4, stufe);
  let a = 0;
  if (fwd) a = car.v < -0.1 ? 7 : (car.v < vmax ? acc * (1 - 0.6 * car.v / vmax) : 0);
  else if (back) a = car.v > 0.1 ? -7 : (car.v > -VREV ? -2 : 0);
  if (brake) a = -Math.sign(car.v) * (keys.has('bremse') ? 8 : 3 + 5 * jsZurueck);
  a -= car.v * 0.04 + (fwd || back ? 0 : Math.sign(car.v) * 0.4);
  const vPrev = car.v;
  car.v += a * dt;
  if ((brake || (!fwd && !back)) && Math.sign(car.v) !== Math.sign(vPrev)) car.v = 0;
  if (car.v > vmax) car.v = Math.max(vmax, car.v - 3 * dt);
  const steerIn = js && Math.abs(js.x) > 0.08 ? -js.x : (keys.has('links') ? 1 : 0) - (keys.has('rechts') ? 1 : 0);
  // ruhiger als in der 3D-Probefahrt: Einschlag so begrenzt, dass die Querbeschleunigung höchstens MAX_QUER bleibt
  // (langsam wendig wie beim Rangieren, schnell sanfte Kurven), dazu langsameres Einlenken
  const smax = Math.min(STEER_MAX, Math.atan(MAX_QUER * WHEELBASE / Math.max(1, car.v * car.v)));
  car.steer += (steerIn * smax - car.steer) * Math.min(1, dt * (steerIn ? 2.5 : 5));
  const vorher = { e: car.e, n: car.n, yaw: car.yaw };
  car.yaw += car.v / WHEELBASE * Math.tan(car.steer) * dt;   // yaw: Winkel gegen den Uhrzeigersinn ab Osten
  car.e += Math.cos(car.yaw) * car.v * dt;
  car.n += Math.sin(car.yaw) * car.v * dt;
  // an Häusern abprallen (nur mit 3D-Ansicht); wer schon in einem Haus steht, darf heraus fahren
  if (hindernis?.(car) && !hindernis(vorher)) { Object.assign(car, vorher); car.v = -car.v * 0.25; }
}

function zeichnen() {
  const p = position(), grad = car.yaw * 180 / Math.PI;
  marker.setLatLng(p);
  const pfeil = marker.getElement()?.firstElementChild;
  if (pfeil) pfeil.style.transform = `rotate(${90 - grad}deg)`;
  // mitdrehende Karte: so gedreht, dass die Fahrtrichtung oben ist; der Pfeil dreht sich damit zurück nach oben
  innen.style.transform = drehen ? `rotate(${grad - 90}deg)` : '';
  karte.panTo(p, { animate: false });
}

function loop(t) {
  const dt = Math.min(0.1, (t - (letzteZeit || t)) / 1000); letzteZeit = t;
  schritt(dt); zeichnen(); hud();
  raf = requestAnimationFrame(loop);
}

const TASTEN = { w: 'gas', arrowup: 'gas', s: 'zurueck', arrowdown: 'zurueck', a: 'links', arrowleft: 'links', d: 'rechts', arrowright: 'rechts', ' ': 'bremse' };
const runter = e => { const k = TASTEN[e.key.toLowerCase()]; if (k) { keys.add(k); e.preventDefault(); } if (e.key.toLowerCase() === 't') car.turbo = !car.turbo; };
const hoch = e => { const k = TASTEN[e.key.toLowerCase()]; if (k) keys.delete(k); };

export function starte(el, { start, onPosition, onHud }) {
  stoppe();
  ursprung = start; meldung = onPosition; hud = onHud;
  Object.assign(car, { e: 0, n: 0, yaw: Math.PI / 2, v: 0, steer: 0, turbo: false }); uhrVersatz = 0; keys.clear();
  // Innen-Fläche so groß wie die Diagonale, damit beim Drehen keine leeren Ecken entstehen
  const w = el.clientWidth || 360, h = el.clientHeight || 360, d = Math.ceil(Math.hypot(w, h));
  innen = document.createElement('div');
  innen.style.cssText = `position:absolute;width:${d}px;height:${d}px;left:${(w - d) / 2}px;top:${(h - d) / 2}px;transform-origin:50% 50%`;
  el.style.position = 'relative'; el.appendChild(innen);
  const quelle = document.createElement('div');
  quelle.className = 'sim-quelle'; quelle.textContent = '© OpenStreetMap'; el.appendChild(quelle);
  karte = L.map(innen, { zoomControl: false, attributionControl: false, keyboard: false, dragging: false }).setView(start, 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(karte);
  spur = L.polyline([start], { color: '#b7791f', weight: 4, opacity: .7 }).addTo(karte);
  marker = L.marker(start, { icon: L.divIcon({ className: 'sim-auto', iconSize: [30, 46], iconAnchor: [15, 23], html: `<div class="sim-pfeil">${MICROLINO}</div>` }) }).addTo(karte);
  document.addEventListener('keydown', runter); document.addEventListener('keyup', hoch);
  gpsTimer = setInterval(() => { const g = gpsPunkt(); meldung(g); if (Math.abs(car.v) > 0.5) spur.addLatLng([g.latitude, g.longitude]); }, GPS_TAKT);
  letzteZeit = 0; raf = requestAnimationFrame(loop);
}

export function stoppe() {
  cancelAnimationFrame(raf); clearInterval(gpsTimer); raf = 0; gpsTimer = 0;
  document.removeEventListener('keydown', runter); document.removeEventListener('keyup', hoch);
  if (karte) { karte.remove(); karte = null; }
  innen = null;
  keys.clear(); joystick = null;
}

export const laeuft = () => !!karte;
export const taste = (name, an) => { if (an) keys.add(name); else keys.delete(name); };
// Joystick-Auslenkung x (rechts +) und y (vorn +) je -1 … 1; null beim Loslassen
let joystick = null;
export const setJoystick = (x, y) => { joystick = x == null ? null : { x, y }; };
export const turbo = () => { car.turbo = !car.turbo; return car.turbo; };
export const kartenDrehung = () => { drehen = !drehen; return drehen; };
export const dreht = () => drehen;
// für die 3D-Ansicht (sim3d.js): Fahrzeugzustand in Metern ab Startpunkt und der Startpunkt selbst
export const auto = () => car;
export const uhr = () => simZeit();   // gespielte Uhrzeit (ms), für Tag und Nacht in der 3D-Ansicht
let hindernis = null;   // (car) => true, wenn das Auto dort in einem Haus stecken würde
export const setHindernis = fn => { hindernis = fn; };
export const herkunft = () => ursprung;
export const zustand = () => ({ kmh: Math.abs(car.v) * 3.6, turbo: car.turbo, rueckwaerts: car.v < -0.05 });
// Stillstand im Zeitraffer: Sekunden mit stehendem Auto melden, damit die Fahrterkennung das Ende erkennt
export function warten(sekunden) {
  car.v = 0; keys.clear();
  for (let i = 0; i < sekunden; i++) { uhrVersatz += 1000; meldung(gpsPunkt()); }
}
