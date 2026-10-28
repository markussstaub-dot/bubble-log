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
const ABHOLEN = 15000;                // ms: Messfenster so oft ins Log holen

let laeuft = false, modus = null, abholTimer = 0;
// Im Entwicklermodus laufen die Sensoren auch beim Warten mit (kostet etwas Akku), damit Stillstand und Anfahren im Log stehen
export const auchBeimWarten = () => devlog.aktiv();

// Startet neu oder setzt die Zusammenfassung zurück (bei Fahrtbeginn nach dem Warten sonst veraltete Werte)
export async function start(neuerModus = 'fahrt') {
  if (!NATIV) return;
  if (laeuft) await fensterHolen();
  modus = neuerModus; laeuft = true;
  try { await Fahrsensoren.start(); } catch (e) { laeuft = false; console.warn('Sensoren nicht verfügbar', e); return; }
  clearInterval(abholTimer);
  if (devlog.aktiv()) abholTimer = setInterval(fensterHolen, ABHOLEN);
}
export async function stopp() {
  if (!laeuft) return;
  clearInterval(abholTimer); abholTimer = 0;
  await fensterHolen();
  laeuft = false;
  await Fahrsensoren.stop().catch(() => {});
}
// 5-s-Messfenster vom Plugin ins Entwickler-Log; das Plugin puffert sie, falls Android die App im Hintergrund drosselt
async function fensterHolen() {
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
