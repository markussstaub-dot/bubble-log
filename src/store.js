// Dauerhafte Speicherung auf dem Gerät (Android: SharedPreferences, Browser: localStorage).
// Anders als der localStorage des WebViews geht das nicht verloren, wenn Android den Cache leert.
import { Preferences } from '@capacitor/preferences';

const KEY = 'bubble-log.v2';
const ALT_KEY = 'bubble-log.v1';   // Prototyp im Browser

export const LEER = { fahrten: [], laden: [], akku: 10.5, soc: null, offen: null, erfassung: false, temp: null, parkplatzMerken: true, parkplatz: null, entwickler: false, ladestrom: 8, fotoExport: false };

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

let wartend = null, timer = 0;
export function speichern(daten) {
  clearTimeout(timer); wartend = null;
  return Preferences.set({ key: KEY, value: JSON.stringify(daten) }).catch(e => console.warn('Speichern fehlgeschlagen', e));
}
// Während einer Fahrt kommen jede Sekunde Punkte; die werden höchstens alle 15 s geschrieben
export function speichernSpaeter(daten) {
  wartend = daten;
  if (!timer) timer = setTimeout(() => { timer = 0; if (wartend) speichern(wartend); }, 15000);
}
