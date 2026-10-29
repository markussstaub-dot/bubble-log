// Barometer und Beschleunigung während einer Fahrt (natives Plugin: android/app/src/main/java/app/bubblelog/microlino/Fahrsensoren.java).
// Im Browser gibt es keine Werte; die Fahrt läuft dann ohne Höhenmeter, Straße und Fahrstil.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as devlog from './devlog.js';

const Fahrsensoren = registerPlugin('Fahrsensoren');
const NATIV = Capacitor.isNativePlatform();

export const RAU = 1.2;          // m/s² senkrechtes Rütteln (Effektivwert) pro Abschnitt: ab hier rau, z. B. Kopfsteinpflaster
export const SEHR_RAU = 2.5;     // ab hier sehr rau, z. B. Schlaglöcher
export const TEMPO_SPRUNG = 2;   // m/s Tempoänderung in 4 s um einen starken Ausschlag: Bremsen bzw. Beschleunigen, sonst Kurve
const HOEHE_SCHWELLE = 2;        // m: kleinere Schwankungen (Lüftung, Tür) zählen nicht als Höhenmeter
// Entwicklermodus, nur zum Mitschreiben (entscheidet nichts): darunter wäre laut Vibration Stillstand. Geschätzt,
// wird an echten Logs abgestimmt.
export const RUHE_VIBRATION = 0.15;   // m/s² Effektivwert senkrecht
const ABHOLEN = 15000;                // ms: Messfenster höchstens so oft ins Log holen

let laeuft = false, modus = null, zuletztGeholt = 0;
// Im Entwicklermodus laufen die Sensoren auch beim Warten mit (kostet etwas Akku), damit Stillstand und Anfahren im Log stehen
export const auchBeimWarten = () => devlog.aktiv();

// Startet neu oder setzt die Zusammenfassung zurück (bei Fahrtbeginn nach dem Warten sonst veraltete Werte)
export async function start(neuerModus = 'fahrt') {
  if (!NATIV) return;
  if (laeuft) await fensterHolen();
  modus = neuerModus; laeuft = true;
  try { await Fahrsensoren.start(); } catch (e) { laeuft = false; console.warn('Sensoren nicht verfügbar', e); return; }
}
export async function stopp() {
  if (!laeuft) return;
  await fensterHolen();
  laeuft = false;
  await Fahrsensoren.stop().catch(() => {});
}
// Bei jedem GPS-Punkt (tracker.js): GPS weckt JavaScript ohnehin, ein setInterval wird im Hintergrund gedrosselt
export function beiGpsPunkt() {
  if (Date.now() - zuletztGeholt >= ABHOLEN) fensterHolen();
}
// 5-s-Messfenster vom Plugin ins Entwickler-Log; das Plugin puffert sie bis zum nächsten Abholen
async function fensterHolen() {
  zuletztGeholt = Date.now();
  if (!laeuft || !devlog.aktiv()) return;
  try {
    const { fenster = [] } = await Fahrsensoren.messfenster();
    for (const f of fenster) devlog.log('vibration', { ...f, modus, ruhig: f.rau < RUHE_VIBRATION });
  } catch { /* älteres Plugin ohne messfenster */ }
}
// { hoehe?: m, rau?: m/s², stoss?: m/s², ausschlaege: [{ t, g }] } seit dem letzten Abholen, oder null
export async function abholen() {
  if (!laeuft) return null;
  try { return await Fahrsensoren.abholen(); } catch { return null; }
}

// Lebenszeichen des GPS-Dienstes (SPEC-gps-abbruch.md, Stufe 2): Das Plugin prüft nativ jede Minute, ob noch Punkte
// kommen, meldet in "fahrt" einen Ausfall per Benachrichtigung und schickt Ereignisse (gpsAusfall, gpsZurueck,
// dienstWeg, energie) an onEreignis(name, daten).
export function lebenszeichen(gpsModus) {
  if (NATIV) Fahrsensoren.lebenszeichen({ modus: gpsModus }).catch(() => {});
}
export function aufEreignisse(onEreignis) {
  if (!NATIV) return;
  for (const name of ['gpsAusfall', 'gpsZurueck', 'dienstWeg', 'energie'])
    Fahrsensoren.addListener(name, d => onEreignis(name, d)).catch(() => {});
}
// { akkuEingeschraenkt, energiesparen, standort: 'immer' | 'nutzung' | 'nein' }; null im Browser oder mit älterem Plugin
export async function systemStatus() {
  if (!NATIV) return null;
  try { return await Fahrsensoren.status(); } catch { return null; }
}
export function appInfos() { if (NATIV) Fahrsensoren.appInfos().catch(() => {}); }

// Höhenmeter auf und ab aus den Punkthöhen ([lat, lon, höhe, rau]); null ohne Barometerwerte
export function hoehenmeter(punkte) {
  const h = punkte.map(p => p[2]).filter(v => v != null);
  if (h.length < 2) return null;
  let ref = h[0], auf = 0, ab = 0;
  for (const v of h) {
    if (v - ref >= HOEHE_SCHWELLE) { auf += v - ref; ref = v; }
    else if (ref - v >= HOEHE_SCHWELLE) { ab += ref - v; ref = v; }
  }
  return { auf: Math.round(auf), ab: Math.round(ab) };
}
// Anteil der Abschnitte mit rauer Straße in Prozent; null ohne Beschleunigungswerte
export function rauAnteil(punkte) {
  const r = punkte.map(p => p[3]).filter(v => v != null);
  return r.length ? Math.round(r.filter(v => v >= RAU).length / r.length * 100) : null;
}
export const strasse = rau => rau == null ? '–' : rau >= SEHR_RAU ? 'sehr rau' : rau >= RAU ? 'rau' : 'glatt';
