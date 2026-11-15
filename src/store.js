// Dauerhafte Speicherung auf dem Gerät (Android: SharedPreferences, Browser: localStorage).
// Anders als der localStorage des WebViews geht das nicht verloren, wenn Android den Cache leert.
import { Preferences } from '@capacitor/preferences';

const KEY = 'bubble-log.v2';
const ALT_KEY = 'bubble-log.v1';   // Prototyp im Browser

export const LEER = { fahrten: [], laden: [], akku: 10.5, soc: null, offen: null, erfassung: false, temp: null, parkplatzMerken: true, parkplatz: null, entwickler: false, ladestrom: 8, fotoExport: false, socT: null, spur: [], notizen: [] };

export async function laden() {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) return { ...LEER, ...JSON.parse(value) };
    // Einmalig: eigene Einträge aus dem Browser-Prototyp übernehmen (ohne Beispieldaten)
    const alt = JSON.parse(localStorage.getItem(ALT_KEY) || 'null');
    if (alt) return { ...LEER, fahrten: alt.fahrten || [], laden: alt.laden || [], akku: alt.akku || 10.5, soc: alt.soc ?? null };
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
  return { ...LEER };
}

export const SPAETER_MS = 15000;
let wartend = null, timer = 0, zuletzt = 0;
export function speichern(daten) {
  // timer = 0 gehört dazu (Fahrt 12.11.2026 verloren): Blieb die alte Timer-Nummer stehen, legte speichernSpaeter nach
  // einem direkten Speichern (Fahrtbeginn, 12-V-Messung) nie wieder einen Timer an, und die Fahrt stand bis zum
  // Neustart der App auf dem Stand von 09:39 (0,4 statt 3,2 km).
  clearTimeout(timer); timer = 0; wartend = null; zuletzt = Date.now();
  return Preferences.set({ key: KEY, value: JSON.stringify(daten) }).catch(e => console.warn('Speichern fehlgeschlagen', e));
}
// Während einer Fahrt kommen jede Sekunde Punkte; die werden höchstens alle 15 s geschrieben. Ist das letzte Speichern
// schon so lange her, gleich hier: Im Hintergrund (Doze) drosselt der WebView Timer, die GPS-Punkte wecken JS aber.
export function speichernSpaeter(daten) {
  wartend = daten;
  if (Date.now() - zuletzt >= SPAETER_MS) return speichern(daten);
  if (!timer) timer = setTimeout(() => { timer = 0; if (wartend) speichern(wartend); }, SPAETER_MS - (Date.now() - zuletzt));
}
