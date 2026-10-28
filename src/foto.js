// Foto vom Tacho-Display (SPEC-foto.md): Kamera öffnen, verkleinert speichern, Text erkennen.
// Kamera: <input type="file" capture>; Capacitor startet damit direkt die Kamera-App des Handys (BridgeWebChromeClient,
// braucht `<queries>` für IMAGE_CAPTURE im Manifest, keine Kamera-Berechtigung). Im Browser kommt die Dateiauswahl.
// Texterkennung: eigenes Plugin Texterkennung.java (Google ML Kit, offline). Im Browser Platzhalter aus dem Dateinamen.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { leseDisplay, textAusDateiname } from './fototext.js';

const Texterkennung = registerPlugin('Texterkennung');
const NATIV = Capacitor.isNativePlatform();
export const ORDNER = 'fotos';
const KANTE = 640, QUALITAET = 0.6;           // gespeichertes Foto: etwa 40–60 KB
const KANTE_ERKENNUNG = 1600;                 // nur für die Erkennung, wird nicht gespeichert

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

// Bild auf höchstens `kante` px (längste Seite) bringen, als JPEG-Base64 ohne Präfix. Der Browser dreht nach EXIF.
async function jpeg(datei, kante, qualitaet) {
  const bild = await createImageBitmap(datei);
  const f = Math.min(1, kante / Math.max(bild.width, bild.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bild.width * f), height: Math.round(bild.height * f) });
  c.getContext('2d').drawImage(bild, 0, 0, c.width, c.height); bild.close?.();
  return c.toDataURL('image/jpeg', qualitaet).split(',')[1];
}

// Ergebnis: { name, text, soc, km, kandidaten, dauer (ms), quelle: 'mlkit' | 'dateiname' | 'fehler' }
// speichern = false (Sim-Tab-Sandkasten): nur erkennen, keine Datei anlegen.
export async function verarbeiten(datei, praefix, { speichern = true } = {}) {
  const t0 = performance.now();
  let text = '', quelle = 'dateiname', fehler;
  if (NATIV) {
    try { text = (await Texterkennung.lesen({ data: await jpeg(datei, KANTE_ERKENNUNG, 0.85) })).text || ''; quelle = 'mlkit'; }
    catch (e) { quelle = 'fehler'; fehler = e.message; }
    Texterkennung.aufraeumen().catch(() => {});   // Originalfoto der Kamera-App aus dem Zwischenordner löschen
  } else text = textAusDateiname(datei.name);
  const dauer = Math.round(performance.now() - t0);
  let name = null;
  if (speichern) {
    name = `${praefix}-${Date.now()}.jpg`;
    await Filesystem.writeFile({ path: `${ORDNER}/${name}`, data: await jpeg(datei, KANTE, QUALITAET), directory: Directory.Data, recursive: true });
  }
  return { name, text, dauer, quelle, fehler, ...leseDisplay(text) };
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
