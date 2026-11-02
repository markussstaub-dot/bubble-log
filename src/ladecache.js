// Ladesäulen um das eigene Zuhause (SPEC-ladepunkte.md): Kacheln zu 1° × 1° aus docs/ladepunkte/ (GitHub Pages,
// erzeugt mit tools/ladepunkte.mjs --kacheln) einmal herunterladen und auf dem Handy speichern. Danach offline.
import { Preferences } from '@capacitor/preferences';
import { distanz } from './erkennung.js';

const KEY = 'bubble-log.ladepunkte';
// Im Browser (npm run dev) aus dem Projektordner, in der App von GitHub Pages
const BASIS = import.meta.env?.DEV ? '/docs/ladepunkte/' : 'https://markussstaub-dot.github.io/bubble-log/ladepunkte/';
export const RADIUS_KM = 120;

// Schlüssel aller Kacheln, die den Umkreis berühren (Kachel „lat_lon“ = südwestliche Ecke in ganzen Grad)
export function kachelnUm([lat, lon], km = RADIUS_KM) {
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180)), out = [];
  for (let a = Math.floor(lat - dLat); a <= Math.floor(lat + dLat); a++)
    for (let b = Math.floor(lon - dLon); b <= Math.floor(lon + dLon); b++) out.push(`${a}_${b}`);
  return out;
}

async function json(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Lädt die Kacheln, behält nur Standorte im Umkreis, speichert und gibt { stand, quelle, standorte, zuhause, radiusKm, geladen } zurück
export async function herunterladen(zuhause, fortschritt = () => {}) {
  const index = await json(BASIS + 'index.json');
  const keys = kachelnUm(zuhause).filter(k => index.kacheln[k]);
  if (!keys.length) throw new Error('Für diesen Ort gibt es keine Ladesäulen-Daten (nur Deutschland und Schweiz).');
  const standorte = [];
  for (const [i, k] of keys.entries()) {
    fortschritt(i, keys.length);
    const d = await json(`${BASIS}${k}.json`);
    for (const s of d.standorte) if (distanz(zuhause, s.p) <= RADIUS_KM * 1000) standorte.push(s);
  }
  const daten = { stand: index.stand, quelle: index.quelle, standorte, zuhause, radiusKm: RADIUS_KM, geladen: Date.now() };
  await Preferences.set({ key: KEY, value: JSON.stringify(daten) });
  return daten;
}

export async function gespeichert() {
  try { const { value } = await Preferences.get({ key: KEY }); return value ? JSON.parse(value) : null; }
  catch (e) { return null; }
}
