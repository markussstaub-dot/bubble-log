// Foto vom Tacho-Display (SPEC-foto.md): Kamera öffnen, verkleinert speichern, Text erkennen.
// Kamera: <input type="file" capture>; Capacitor startet damit direkt die Kamera-App des Handys (BridgeWebChromeClient,
// braucht `<queries>` für IMAGE_CAPTURE im Manifest, keine Kamera-Berechtigung). Im Browser kommt die Dateiauswahl.
// Texterkennung: eigenes Plugin Texterkennung.java (Google ML Kit, offline). Im Browser Platzhalter aus dem Dateinamen.
// Nativ dekodiert und verkleinert Texterkennung.java das Foto, nicht der WebView: Am Fold6 scheiterte createImageBitmap
// am Kamerafoto („The source image could not be decoded.“, Testfahrt 30.10.2026).
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { leseDisplay, textAusDateiname } from './fototext.js';

const Texterkennung = registerPlugin('Texterkennung');
const NATIV = Capacitor.isNativePlatform();
export const ORDNER = 'fotos';
const KANTE = 640, QUALITAET = 0.6;           // gespeichertes Foto: etwa 40–60 KB
const KANTE_ERKENNUNG = 1600;                 // nur für die Erkennung, wird nicht gespeichert
const QUALITAET_NATIV = Math.round(QUALITAET * 100);

// Kamera öffnen; Ergebnis: File oder null (abgebrochen). Muss direkt aus einem Tipp aufgerufen werden.
export function aufnehmen() {
  return new Promise(fertig => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => fertig(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => fertig(null), { once: true });
    input.click();
  });
}

// Bild auf höchstens `kante` px (längste Seite) bringen, als JPEG-Base64 ohne Präfix. Der Browser dreht nach EXIF. Nur im Browser.
async function jpeg(datei, kante, qualitaet) {
  const bild = await createImageBitmap(datei);
  const f = Math.min(1, kante / Math.max(bild.width, bild.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bild.width * f), height: Math.round(bild.height * f) });
  c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height); bild.close?.();
  return c.toDataURL('image/jpeg', qualitaet).split(',')[1];
}

// Datei als Base64 ohne Präfix (Ausweg, wenn Texterkennung.java das Original der Kamera-App nicht findet)
async function base64(datei) {
  const b = new Uint8Array(await datei.arrayBuffer()); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
// Nativ: erst das Original im Zwischenordner (über die Größe gefunden), sonst die Bytes aus dem WebView schicken
async function nativLesen(datei) {
  const optionen = { kante: KANTE_ERKENNUNG, kleinKante: KANTE, qualitaet: QUALITAET_NATIV };
  try { return await Texterkennung.lesen({ ...optionen, groesse: datei.size }); }
  catch (e) { if (e.code !== 'KEINE_DATEI' || !datei.size) throw e; }
  return Texterkennung.lesen({ ...optionen, data: await base64(datei) });
}

// Ergebnis: { name, text, soc, km, kandidaten, dauer (ms), quelle: 'mlkit' | 'dateiname' | 'fehler', fehler, bild }
// bild (nativ): { quelle: 'datei' | 'daten', bytes, mime, original, breite, hoehe } für das Entwickler-Log.
// Ist das Foto gar nicht lesbar, wirft es einen Fehler mit `daten` (Größe, Typ, Code) für das Log.
// speichern = false (Sim-Tab-Sandkasten): nur erkennen, keine Datei anlegen.
export async function verarbeiten(datei, praefix, { speichern = true } = {}) {
  const t0 = performance.now();
  let text = '', quelle = 'dateiname', fehler, klein, bild;
  if (NATIV) {
    try {
      const r = await nativLesen(datei);
      ({ klein, bild } = r); text = r.text || ''; fehler = r.fehler; quelle = fehler ? 'fehler' : 'mlkit';
    } catch (e) {
      throw Object.assign(new Error(e.message), { daten: { groesse: datei.size, typ: datei.type, code: e.code, bild: e.data } });
    } finally {
      Texterkennung.aufraeumen().catch(() => {});   // Originalfoto der Kamera-App aus dem Zwischenordner löschen
    }
  } else text = textAusDateiname(datei.name);
  const dauer = Math.round(performance.now() - t0);
  let name = null;
  if (speichern) {
    name = `${praefix}-${Date.now()}.jpg`;
    await Filesystem.writeFile({ path: `${ORDNER}/${name}`, data: klein ?? await jpeg(datei, KANTE, QUALITAET), directory: Directory.Data, recursive: true });
  }
  return { name, text, dauer, quelle, fehler, bild, ...leseDisplay(text) };
}

export async function loeschen(...namen) {
  for (const n of namen.filter(Boolean)) await Filesystem.deleteFile({ path: `${ORDNER}/${n}`, directory: Directory.Data }).catch(() => {});
}
export const alleLoeschen = () => Filesystem.rmdir({ path: ORDNER, directory: Directory.Data, recursive: true }).catch(() => {});

// Adresse für <img src>: nativ direkt aus dem App-Speicher, im Browser (IndexedDB) als data-URL
const urls = new Map();
export async function url(name) {
  if (!urls.has(name)) {
    if (NATIV) urls.set(name, Capacitor.convertFileSrc((await Filesystem.getUri({ path: `${ORDNER}/${name}`, directory: Directory.Data })).uri));
    else urls.set(name, `data:image/jpeg;base64,${(await Filesystem.readFile({ path: `${ORDNER}/${name}`, directory: Directory.Data })).data}`);
  }
  return urls.get(name);
}
