// „Verlauf“ (SPEC-konsole.md, 15.11.2026): wichtige Ereignisse in Klartext für alle, oben im Fahrten-Tab.
//
// Quelle der Daten: ein eigener kleiner Speicher, nicht das Devlog. Das Devlog schreibt nur im Entwicklermodus und
// enthält rohe GPS-Punkte; der Verlauf soll für alle laufen und nur Klartext zeigen. Er liest deshalb über
// devlog.mitlesen() jede Log-Zeile mit (das geht auch ohne Entwicklermodus), übersetzt sie hier und behält nur, was
// eine Übersetzung hat. Gespeichert unter eigenem Schlüssel (nicht in eigen), damit das Fahrtenbuch nicht wächst und
// während der Fahrt nicht öfter geschrieben wird: höchstens alle 20 s, 14 Tage, 1000 Einträge.
import { Preferences } from '@capacitor/preferences';

const KEY = 'bubble-log.verlauf';
const TAGE = 14, MAX = 1000, SCHREIB_PAUSE = 20000;

const de = (v, n = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: n, maximumFractionDigits: n });
const km = v => v == null ? '' : `${de(v, v < 10 ? 1 : 0)} km`;
const klammer = s => s ? ` (${s})` : '';

// Gründe der Fahrterkennung in Alltagssprache
const VERWORFEN = { 'zu kurz': 'zu kurz', 'gps-ausfall, nachtragen': 'GPS ausgefallen, zum Nachtragen' };
const QUELLE_FEHLER = {
  'gps-ausfall': 'GPS ausgefallen', 'gps-dienst': 'Standortdienst beendet', gps: 'GPS', js: 'App-Fehler', route: 'Route',
  cache: 'Wege ab Zuhause', suche: 'Suche', ladepunkte: 'Ladesäulen', tempolimit: 'Tempolimits', notizen: 'Notizen',
};

// Übersetzungstabelle Typ → Klartext. Gibt null zurück, wenn das Ereignis nicht in den Verlauf gehört.
export const KLARTEXT = {
  fahrt(e) {
    switch (e.schritt) {
      case 'beginn': return e.manuell ? 'Fahrt von Hand gestartet' : 'Fahrt erkannt';
      case 'ende': return `Fahrt beendet${klammer(km(e.km))}`;
      case 'gespeichert': return `Fahrt gespeichert: ${e.von}–${e.nach}, ${km(e.km)}, Akku ${e.start} → ${e.ende} %`;
      case 'verworfen': return `Fahrt verworfen: ${VERWORFEN[e.ausgeloest] ?? 'von Hand'}${klammer(km(e.km))}`;
      case 'verwerfen rückgängig': return 'Verwerfen rückgängig gemacht';
      case 'zurückgestellt': return 'Fahrt wartet auf den Akkustand';
      case 'beginn abgelehnt': case 'start ignoriert': return 'Neue Fahrt nicht begonnen: Es ist noch eine Fahrt offen';
      case 'nachgetragen': return `Fahrt nachgetragen${klammer(km(e.km))}`;
      case 'nachtrag gelöscht': return 'Nachgetragene Fahrt gelöscht';
      case 'löschen rückgängig': return 'Löschen rückgängig gemacht';
      case 'korrigiert': return `Fahrt korrigiert: Akku ${e.start?.[1]} → ${e.ende?.[1]} %`;
      case 'tagesabschluss': return `Tagesabschluss: ${e.anzahl} Fahrten mit Akkustand gespeichert`;
      case 'kette': return e.fehler ? 'Wartende Fahrten bleiben offen: kein Akkustand davor' : `${e.anzahl} wartende Fahrten verteilt`;
      case 'auto-weiter': return 'Dialog geschlossen: Der Microlino fährt wieder';
      default: return null;
    }
  },
  laden(e) {
    if (e.abgelehnt) return `Ladung nicht gespeichert: ${e.abgelehnt}`;
    if (e.geloescht) return `Ladevorgang ${e.von} → ${e.bis} % gelöscht`;
    if (e.zurueck) return 'Ladevorgang rückgängig gemacht';
    if (e.von != null && e.bis != null) return `Geladen${e.ort ? ` in ${e.ort}` : ''}: ${e.von} → ${e.bis} %`;
    return null;
  },
  eingabe(e) {
    if (e.plausi) return `Akkustand ${e.wert} % nachgefragt (erwartet etwa ${e.erwartet} %)`;
    if (e.startSoc != null) return `Akku am Start: ${e.startSoc} %${e.automatisch ? ' (übernommen)' : ''}`;
    if (e.soc != null) return `Akku eingetragen: ${e.soc} %`;
    return null;
  },
  notiz: e => `🗒 ${e.text ?? (e.knopf ? `Knopf ${e.knopf}` : 'Notiz')}`,
  tempolimit(e) {
    if (e.limit !== undefined) return e.limit ? `Tempolimit ${e.limit}` : 'Tempolimit unbekannt';
    if (e.geladen != null) return `Tempolimits geladen (${e.kacheln} Kacheln, ${e.km} km um Zuhause)`;
    return null;
  },
  fehler: e => `Fehler: ${QUELLE_FEHLER[e.quelle] ?? e.quelle ?? 'unbekannt'}${e.text ? ` – ${e.text}` : ''}`,
  bordnetz(e) {
    if (e.fehler) return `12-V-Messung fehlgeschlagen${e.text ? `: ${e.text}` : ''}`;
    if (e.gekoppelt) return `12-V-Messgerät ${e.gekoppelt} gekoppelt`;
    return null;
  },
  ladeort: e => e.neu ? `Ladeort „${e.neu}“ gemerkt` : null,
  app: e => e.start ? 'App gestartet' : null,
};

export function klartext(e) {
  if (!e || e.sim) return null;   // Simulator gehört nicht in den Verlauf
  const f = KLARTEXT[e.typ];
  try { return f ? f(e) || null : null; } catch { return null; }
}

// Log-Zeile → kompakter Verlaufseintrag { t, typ, quelle?, text } oder null
export function eintragAus(typ, daten, t = Date.now()) {
  const e = { t: daten?.t ?? t, typ, ...daten };
  const text = klartext(e);
  if (!text) return null;
  const v = { t: e.t, typ, text };
  if (e.quelle && (typ === 'notiz' || typ === 'fehler')) v.quelle = String(e.quelle);
  if (typ !== 'fehler' && e.fehler) v.fehler = true;
  return v;
}

// Hängt an (verspätete Notizen einsortiert) und kürzt auf TAGE und MAX
export function anhaengen(liste, v, jetzt = Date.now()) {
  if (!v) return false;
  const i = liste.findLastIndex(x => x.t <= v.t);
  liste.splice(i + 1, 0, v);
  const grenze = jetzt - TAGE * 864e5;
  let weg = 0; while (weg < liste.length && (liste[weg].t < grenze || liste.length - weg > MAX)) weg++;
  if (weg) liste.splice(0, weg);
  return true;
}

// ---------- Speicher und Live-Abonnenten ----------
let liste = [], geladen = null, timer = 0;
const hoerer = new Set();

export function laden() {
  return geladen ??= Preferences.get({ key: KEY })
    .then(({ value }) => { const alt = JSON.parse(value || '[]'); liste = [...alt, ...liste].sort((a, b) => a.t - b.t); })
    .catch(e => console.warn('Verlauf nicht geladen', e));
}
export const eintraege = () => liste.slice();
export function abonnieren(f) { hoerer.add(f); return () => hoerer.delete(f); }

function sichern() { clearTimeout(timer); timer = 0; return Preferences.set({ key: KEY, value: JSON.stringify(liste) }).catch(e => console.warn('Verlauf nicht gespeichert', e)); }

// Für devlog.mitlesen: jede Log-Zeile, übersetzt oder verworfen
export function mitlesen(typ, daten) {
  const v = eintragAus(typ, daten);
  if (!anhaengen(liste, v)) return;
  for (const f of hoerer) { try { f(v); } catch (x) { console.warn(x); } }
  if (!timer) timer = setTimeout(sichern, v.typ === 'fehler' ? 1000 : SCHREIB_PAUSE);
}
export const jetztSichern = () => liste.length ? sichern() : Promise.resolve();

export async function loeschen() { liste = []; clearTimeout(timer); timer = 0; await Preferences.remove({ key: KEY }).catch(() => {}); }

// ---------- Filter-Chips aus den vorhandenen Einträgen ----------
const TYP_NAME = { fahrt: 'Fahrten', laden: 'Laden', eingabe: 'Akku', notiz: 'Notizen', tempolimit: 'Tempolimit', fehler: 'Fehler', bordnetz: '12 V', ladeort: 'Ladeorte', app: 'App' };
const QUELLE_NAME = { sticky: 'Sticky', teilen: 'Geteilt', browser: 'Browser' };

// [[schlüssel, name]]: „Alles“, dann jeder vorhandene Typ (häufigste zuerst), dann die Quellen der Notizen, wenn es
// mehr als eine gibt. Schlüssel: 'alles', 'typ:fahrt', 'quelle:sticky'
export function chips(liste) {
  const typen = new Map(), quellen = new Set();
  for (const v of liste) {
    typen.set(v.typ, (typen.get(v.typ) || 0) + 1);
    if (v.typ === 'notiz' && v.quelle) quellen.add(v.quelle);
  }
  const fehler = liste.some(v => v.fehler) && !typen.has('fehler');
  return [['alles', 'Alles'],
    ...[...typen].sort((a, b) => b[1] - a[1]).map(([t]) => [`typ:${t}`, TYP_NAME[t] ?? t]),
    ...(fehler ? [['typ:fehler', 'Fehler']] : []),
    ...(quellen.size > 1 ? [...quellen].map(q => [`quelle:${q}`, `🗒 ${QUELLE_NAME[q] ?? q}`]) : [])];
}
export function passt(v, filter, suche = '') {
  const [art, wert] = filter.split(':');
  const ok = art === 'typ' ? v.typ === wert || (wert === 'fehler' && !!v.fehler)
    : art === 'quelle' ? v.quelle === wert
    : true;
  if (!ok) return false;
  const s = suche.trim().toLowerCase();
  return !s || v.text.toLowerCase().includes(s);
}
