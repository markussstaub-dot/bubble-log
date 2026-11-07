// Tempolimit groß anzeigen (SPEC-tempolimit.md): OSM-maxspeed um das Zuhause offline, Zuordnung GPS → Straße.
// Kacheln zu 0,1° aus docs/tempolimit/ (GitHub Pages, erzeugt mit tools/tempolimit.mjs) einmal herunterladen und als
// Datei speichern (≈ 4–5 MB, zu groß für Preferences). Vorlage: ladecache.js.
//
// Limit-Code wie in den Kacheln: Zahl = km/h, 0 = keine Begrenzung, -1 = Schrittgeschwindigkeit, null = unbekannt („?“);
// -2 nur in den Kacheln: Einbahnstraße in dieser Richtung, wird nie zugeordnet.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const NATIV = Capacitor.isNativePlatform();
const DATEI = 'tempolimit.json';
const BASIS = import.meta.env?.DEV ? '/docs/tempolimit/' : 'https://markussstaub-dot.github.io/bubble-log/tempolimit/';
export const RADIUS_KM = 40;
export const QUELLE = '© OpenStreetMap-Mitwirkende';

// Zuordnung (Spec: ≈ 20 m, ≈ 45°, Wechsel nach 2–3 gleichen Fixes)
export const ZUORDNUNG = {
  ABSTAND: 20,        // m bis zur Straßenmitte
  WINKEL: 45,         // ° zwischen Fahrtrichtung und Straße
  RICHTUNG_AB: 8,     // m Bewegung, bevor eine neue Fahrtrichtung gilt (Stand an der Ampel ändert nichts)
  GLEICH: 2,          // gleiche Fixes für ein neues Limit
  GLEICH_UNBEKANNT: 3 // … für „?“ (eine Kreuzung oder ein GPS-Ausreißer soll das Schild nicht leeren)
};

const R = 6371000, RAD = Math.PI / 180, EINBAHN = -2;
const KACHEL = 10;   // pro Grad

// Kacheln, deren Rechteck den Kreis berührt
export function kachelnUm([lat, lon], km = RADIUS_KM) {
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * RAD)), out = [];
  for (let a = Math.floor((lat - dLat) * KACHEL); a <= Math.floor((lat + dLat) * KACHEL); a++)
    for (let b = Math.floor((lon - dLon) * KACHEL); b <= Math.floor((lon + dLon) * KACHEL); b++) {
      const nLat = Math.min(Math.max(lat, a / KACHEL), (a + 1) / KACHEL), nLon = Math.min(Math.max(lon, b / KACHEL), (b + 1) / KACHEL);
      const d = R * RAD * Math.hypot(nLat - lat, (nLon - lon) * Math.cos(lat * RAD));
      if (d <= km * 1000) out.push(`${a}_${b}`);
    }
  return out;
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- Daten ----------
let daten = null;      // { stand, quelle, zuhause, radiusKm, geladen, w: [[id, vor, rück, c], …] }
let stuecke = null;    // [{ id, f, b, pts: Float64Array [lat, lon, …], s, w, n, o }]
const bereitListe = new Set();
export const bereit = () => !!stuecke?.length;
export const info = () => daten && { stand: daten.stand, quelle: daten.quelle, zuhause: daten.zuhause, radiusKm: daten.radiusKm, geladen: daten.geladen, stuecke: daten.w.length };

export function setzeDaten(d) { aufbauen(d); }   // Tests
function aufbauen(d) {
  daten = d; nah = null;
  stuecke = d.w.map(([id, f, b, c]) => {
    const pts = new Float64Array(c.length); let la = 0, lo = 0, s = 90, n = -90, w = 180, o = -180;
    for (let i = 0; i < c.length; i += 2) {
      la += c[i]; lo += c[i + 1]; const A = la / 1e5, B = lo / 1e5; pts[i] = A; pts[i + 1] = B;
      if (A < s) s = A; if (A > n) n = A; if (B < w) w = B; if (B > o) o = B;
    }
    return { id, f, b, pts, s, n, w, o };
  });
}

export async function herunterladen(zuhause, fortschritt = () => {}) {
  const index = await json(BASIS + 'index.json');
  const keys = kachelnUm(zuhause).filter(k => index.kacheln[k]);
  if (!keys.length) throw new Error('Für diesen Ort gibt es keine Tempolimit-Daten (nur Saarland und Rheinland-Pfalz).');
  const w = [];
  for (const [i, k] of keys.entries()) {
    fortschritt(i, keys.length);
    w.push(...(await json(`${BASIS}${k}.json`)).w);
  }
  const d = { stand: index.stand, quelle: index.quelle, zuhause, radiusKm: RADIUS_KM, geladen: Date.now(), w };
  const text = JSON.stringify(d);
  await Filesystem.writeFile({ path: DATEI, data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
  aufbauen(d);
  return { ...info(), bytes: text.length };
}

export async function laden() {
  try {
    const { data } = await Filesystem.readFile({ path: DATEI, directory: Directory.Data, encoding: Encoding.UTF8 });
    aufbauen(JSON.parse(data)); return info();
  } catch (e) { return null; }   // noch nicht geladen
}

export async function loeschen() {
  daten = stuecke = nah = null;
  await Filesystem.deleteFile({ path: DATEI, directory: Directory.Data }).catch(() => {});
}

// ---------- Nahbereich: Raster nur um die aktuelle Position (≈ 2 km Block), sonst wäre der Index auf dem Handy groß ----------
const BLOCK = 0.02, RAND = 0.01, ZELLE = 0.0005;   // Grad; Zelle ≈ 55 × 36 m, also größer als ABSTAND
let nah = null;   // { key, zellen: Map(zelle → [[stück, segmentIndex]]) }
const zelle = (a, b) => Math.floor(a / ZELLE) * 1e6 + Math.floor(b / ZELLE);
function nahbereich(lat, lon) {
  const key = `${Math.floor(lat / BLOCK)}_${Math.floor(lon / BLOCK)}`;
  if (nah?.key === key) return nah;
  const s = Math.floor(lat / BLOCK) * BLOCK - RAND, n = s + BLOCK + 2 * RAND, w = Math.floor(lon / BLOCK) * BLOCK - RAND, o = w + BLOCK + 2 * RAND;
  const zellen = new Map();
  for (const st of stuecke) {
    if (st.n < s || st.s > n || st.o < w || st.w > o) continue;
    const p = st.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const a0 = Math.floor(Math.min(p[i], p[i + 2]) / ZELLE), a1 = Math.floor(Math.max(p[i], p[i + 2]) / ZELLE);
      const b0 = Math.floor(Math.min(p[i + 1], p[i + 3]) / ZELLE), b1 = Math.floor(Math.max(p[i + 1], p[i + 3]) / ZELLE);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
        const z = a * 1e6 + b; let l = zellen.get(z); if (!l) zellen.set(z, l = []); l.push(st, i);
      }
    }
  }
  return nah = { key, zellen };
}

const winkelDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
const kurs = (a, b) => { const k = Math.cos(a[0] * RAD); return (Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) / RAD + 360) % 360; };
const meter = (a, b) => R * RAD * Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * RAD));

// Bester Abschnitt für Position und Fahrtrichtung → { limit, weg, abstand, winkel } oder null (kein Treffer)
export function treffer([lat, lon], richtung, S = ZUORDNUNG) {
  if (!stuecke) return null;
  const { zellen } = nahbereich(lat, lon), k = Math.cos(lat * RAD), gesehen = new Set();
  let best = null;
  const za = Math.floor(lat / ZELLE), zb = Math.floor(lon / ZELLE);
  for (let a = za - 1; a <= za + 1; a++) for (let b = zb - 1; b <= zb + 1; b++) {
    const l = zellen.get(a * 1e6 + b); if (!l) continue;
    for (let j = 0; j < l.length; j += 2) {
      const st = l[j], i = l[j + 1], p = st.pts;
      const sig = st.id * 1e4 + i; if (gesehen.has(sig)) continue; gesehen.add(sig);
      // lokal eben in Metern, Position = Ursprung
      const x1 = (p[i + 1] - lon) * k * R * RAD, y1 = (p[i] - lat) * R * RAD, x2 = (p[i + 3] - lon) * k * R * RAD, y2 = (p[i + 2] - lat) * R * RAD;
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      let t = l2 ? -(x1 * dx + y1 * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x1 + t * dx, y1 + t * dy);
      if (d > S.ABSTAND || (best && d >= best.abstand)) continue;
      const w = winkelDiff(richtung, (Math.atan2(dx, dy) / RAD + 360) % 360);
      let limit;
      if (w <= S.WINKEL) limit = st.f; else if (w >= 180 - S.WINKEL) limit = st.b; else continue;
      if (limit === EINBAHN) continue;   // Gegenfahrbahn bzw. falsche Richtung einer Einbahnstraße
      best = { limit, weg: st.id, abstand: Math.round(d * 10) / 10, winkel: Math.round(w > 90 ? 180 - w : w), rueck: w > 90 };
    }
  }
  return best;
}

// Während einer Fahrt: jeder GPS-Fix → angezeigtes Limit mit Hysterese. onWechsel(neu, vorher, details) für das Devlog.
export function createZuordnung({ onWechsel = () => {}, S = ZUORDNUNG } = {}) {
  let anker = null, richtung = null, angezeigt, kandidat, gleich = 0;
  return {
    get limit() { return angezeigt; },   // undefined = noch nichts entschieden
    zuruecksetzen() { anker = richtung = null; angezeigt = kandidat = undefined; gleich = 0; },
    punkt(p) {
      if (!stuecke) return angezeigt;
      if (!anker) { anker = p; return angezeigt; }
      if (meter(anker, p) < S.RICHTUNG_AB) return angezeigt;   // steht oder kriecht: Schild bleibt
      richtung = kurs(anker, p); anker = p;
      const t = treffer(p, richtung, S), neu = t ? t.limit : null;
      if (neu === kandidat) gleich++; else { kandidat = neu; gleich = 1; }
      if (neu !== angezeigt && gleich >= (neu == null ? S.GLEICH_UNBEKANNT : S.GLEICH)) {
        const vorher = angezeigt; angezeigt = neu;
        onWechsel(neu, vorher ?? null, { ...(t || {}), lat: +p[0].toFixed(5), lon: +p[1].toFixed(5), richtung: Math.round(richtung) });
      }
      return angezeigt;
    },
  };
}

// ---------- Anzeige ----------
// Rundes Schild: Zahl mit rotem Rand, Aufhebung (weiß mit Schrägstreifen), Schritt, „?“ grau
export function schildHtml(code, id = 'tlSchild') {
  return `<div class="tl-schild ${schildKlasse(code)}" id="${id}" role="img" aria-label="${schildText(code, true)}"><span>${schildText(code)}</span></div>`;
}
export function schildKlasse(code) {
  return code == null ? 'tl-unbekannt' : code === 0 ? 'tl-ende' : code === -1 ? 'tl-schritt' : code >= 100 ? 'tl-zahl tl-drei' : 'tl-zahl';
}
export function schildText(code, lang = false) {
  if (code == null) return lang ? 'Tempolimit unbekannt' : '?';
  if (code === 0) return lang ? 'Keine Begrenzung' : '';
  if (code === -1) return lang ? 'Schrittgeschwindigkeit' : 'Schritt';
  return lang ? `Tempolimit ${code} km/h` : String(code);
}
export function schildSetzen(el, code) {
  if (!el) return;
  const k = `tl-schild ${schildKlasse(code)}`;
  if (el.className !== k) el.className = k;
  const s = el.firstElementChild, t = schildText(code);
  if (s && s.textContent !== t) s.textContent = t;
  el.setAttribute('aria-label', schildText(code, true));
}

// ---------- Display wach halten ----------
// App: FLAG_KEEP_SCREEN_ON und setKeepScreenOn über das eigene Plugin (Fahrsensoren.bildschirmWach), zusätzlich die
// Screen Wake Lock API, falls der WebView sie kann (Befund 07.11.: Display ging trotz Schild aus). Browser: nur Wake Lock.
// onLog(an, details) bei jedem Wechsel und Fehler, für das Devlog.
const Fahrsensoren = registerPlugin('Fahrsensoren');
let wach = false, sperre = null, fehlerGemeldet = false;
export async function wachHalten(an, onLog = () => {}) {
  if (an === wach) return;
  wach = an;
  const d = {};
  if (NATIV) {
    try { Object.assign(d, await Fahrsensoren.bildschirmWach({ an })); }
    catch (e) { d.nativ = e.message; }
  }
  try {
    if (an && navigator.wakeLock && !sperre) {
      sperre = await navigator.wakeLock.request('screen'); d.wakeLock = true;
      sperre.addEventListener('release', () => { sperre = null; if (!NATIV) wach = false; });   // Browser gibt die Sperre beim Wegwechseln frei
    } else if (!an && sperre) { await sperre.release(); sperre = null; }
    else if (an && !navigator.wakeLock) d.wakeLock = 'fehlt';
  } catch (e) { d.wakeLock = e.message; }
  const ok = !an || d.flag === true || d.wakeLock === true;
  if (!ok) wach = false;   // nächste Sekunde neu versuchen, aber nur einmal ins Log
  if (ok || !fehlerGemeldet) onLog(an, ok ? d : { ...d, fehlgeschlagen: true });
  fehlerGemeldet = !ok;
}
