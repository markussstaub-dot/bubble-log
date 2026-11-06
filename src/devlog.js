// Entwicklermodus: rohe Daten zur späteren Auswertung als JSON Lines (eine Zeile = ein Ereignis), eine Datei pro Tag.
// Liegt im privaten App-Speicher (Android: Directory.Data), wird nach AUFBEWAHREN_TAGE gelöscht und über "Teilen" exportiert.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const NATIV = Capacitor.isNativePlatform();
const ORDNER = 'devlog';
const AUFBEWAHREN_TAGE = 14;
const MAX_PUFFER = 200;         // Zeilen, bevor sofort geschrieben wird
const SCHREIB_PAUSE = 10000;    // ms, sonst spätestens nach dieser Zeit
const WEB_MAX = 5000;           // Browser: nur im Speicher, die letzten Zeilen

let an = false, puffer = [], timer = 0, web = [];

export const aktiv = () => an;

export async function setAktiv(neu) {
  an = neu;
  if (!neu) { await flush(); return; }
  if (NATIV) {
    await Filesystem.mkdir({ path: ORDNER, directory: Directory.Data, recursive: true }).catch(() => {});   // gibt es schon
    aufraeumen();
  }
  log('devlog', { an: true, plattform: Capacitor.getPlatform(), ua: navigator.userAgent });
}

let mitleser = null;
// Liest jede Zeile mit, auch wenn der Entwicklermodus aus ist (Spur für „Fahrt nachtragen“, src/nachtragen.js)
export function mitlesen(f) { mitleser = f; }

export function log(typ, daten = {}) {
  mitleser?.(typ, daten);
  if (!an) return;
  puffer.push(JSON.stringify({ t: Date.now(), typ, ...daten }));
  if (puffer.length >= MAX_PUFFER) flush();
  else if (!timer) timer = setTimeout(flush, SCHREIB_PAUSE);
}

const p2 = n => String(n).padStart(2, '0');
const tagesDatei = (d = new Date()) => `${ORDNER}/bubble-log-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.jsonl`;

// Schreibvorgänge strikt nacheinander: Zwei appendFile gleichzeitig (voller Puffer + Timer) liefen im nativen Plugin
// ineinander, 06.11.2026 sechs zerrissene Zeilen.
let schreiben = Promise.resolve();
export function flush() {
  clearTimeout(timer); timer = 0;
  if (!puffer.length) return schreiben;
  const zeilen = puffer; puffer = [];
  if (!NATIV) { web.push(...zeilen); if (web.length > WEB_MAX) web = web.slice(-WEB_MAX); return schreiben; }
  const pfad = tagesDatei();
  return schreiben = schreiben.then(() => Filesystem.appendFile({ path: pfad, data: zeilen.join('\n') + '\n', directory: Directory.Data, encoding: Encoding.UTF8 }))
    .catch(e => console.warn('Entwickler-Log nicht geschrieben', e));
}

// [{ name, groesse (Byte), geaendert (ms) }], neueste zuerst
export async function dateien() {
  if (!NATIV) return web.length ? [{ name: 'bubble-log-browser.jsonl', groesse: web.join('\n').length, geaendert: Date.now() }] : [];
  try {
    const { files } = await Filesystem.readdir({ path: ORDNER, directory: Directory.Data });
    return files.filter(f => f.name.endsWith('.jsonl'))
      .map(f => ({ name: f.name, groesse: f.size, geaendert: f.mtime }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
}

async function aufraeumen() {
  const grenze = Date.now() - AUFBEWAHREN_TAGE * 864e5;
  for (const f of await dateien()) {
    if (f.geaendert < grenze) await Filesystem.deleteFile({ path: `${ORDNER}/${f.name}`, directory: Directory.Data }).catch(() => {});
  }
}

// Ergebnis: 'geteilt', 'abgebrochen', 'leer' oder 'heruntergeladen' (Browser)
export async function teilen() {
  await flush();
  if (!NATIV) {
    if (!web.length) return 'leer';
    const url = URL.createObjectURL(new Blob([web.join('\n') + '\n'], { type: 'application/x-ndjson' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'bubble-log-browser.jsonl' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'heruntergeladen';
  }
  const liste = await dateien();
  if (!liste.length) return 'leer';
  const uris = await Promise.all(liste.map(f => Filesystem.getUri({ path: `${ORDNER}/${f.name}`, directory: Directory.Data }).then(r => r.uri)));
  try {
    await Share.share({ title: 'Bubble Log – Entwickler-Logs', files: uris, dialogTitle: 'Logs teilen' });
    return 'geteilt';
  } catch (e) {
    if (/cancel/i.test(String(e?.message))) return 'abgebrochen';
    throw e;
  }
}

export async function loeschen() {
  puffer = []; web = [];
  if (!NATIV) return;
  await Filesystem.rmdir({ path: ORDNER, directory: Directory.Data, recursive: true }).catch(() => {});
  await Filesystem.mkdir({ path: ORDNER, directory: Directory.Data, recursive: true }).catch(() => {});
}
