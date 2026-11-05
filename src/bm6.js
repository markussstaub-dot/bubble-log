// BM6-Batteriewächter an der 12-V-Batterie (SPEC-12v.md): Suchen, Verbinden, Werte abholen.
// Auf dem Handy über das eigene Plugin Batteriewaechter.java (Bluetooth LE, entschlüsselt dort). Es puffert die Antworten,
// bis JavaScript sie abholt (wie Fahrsensoren); gelesen werden sie hier mit bordspannung.js (getestet).
// Im Browser und im Simulator ein simulierter BM6 mit wählbarem Verhalten.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { antwortLesen } from './bordspannung.js';

const Batteriewaechter = registerPlugin('Batteriewaechter');
const NATIV = Capacitor.isNativePlatform();

// Simulierter BM6. Verhalten: normal, schwacher DC/DC-Wandler (lädt beim Fahren nur ~13 V und schwankt),
// Batterie sackt ab (Ruhespannung fällt unter 12,0 V)
export const SIM_PROFILE = { normal: 'normal', dcdc: 'schwacher DC/DC', absacken: 'Batterie sackt ab' };
const SIM_ZIEL = { normal: [12.7, 13.7, 0.03], dcdc: [12.65, 13.0, 0.25], absacken: [11.85, 13.6, 0.03] };   // Ruhe, Fahren, Streuung
const SIM_TAKT = 1000, SIM_TRAEGHEIT = 0.08;   // je Sekunde rückt die Spannung so viel Anteil zum Ziel
let sim = !NATIV, simProfil = 'normal', simMotor = false, simV = 12.7, simTimer = 0;

let laeuft = false, puffer = [], letzter = null;
const lesen = ([t, hex]) => { const w = antwortLesen(hex); return w ? { t, ...w } : null; };

export const simuliert = () => sim;
export async function setSim(an) { if (sim === (an || !NATIV)) return; await stopp(); sim = an || !NATIV; letzter = null; puffer = []; }
export const profil = () => simProfil;
export function setProfil(p) { if (SIM_ZIEL[p]) simProfil = p; }
// Der Simulator weiß nicht, ob das Auto an ist; main.js sagt es bei Fahrtbeginn und -ende
export function motor(an) { simMotor = an; }
function simSchritt() {
  const [ruhe, fahren, streu] = SIM_ZIEL[simProfil];
  simV += ((simMotor ? fahren : ruhe) - simV) * SIM_TRAEGHEIT;
  const v = Math.round((simV + (Math.random() * 2 - 1) * (simMotor ? streu : 0.01)) * 100) / 100;
  letzter = { t: Date.now(), v, temp: 12, soc: Math.round(Math.max(0, Math.min(100, (v - 11.8) / 0.009))) };
  puffer.push([letzter.t, letzter.v, letzter.temp, letzter.soc]);
}

// Einmal suchen (etwa 8 s); Ergebnis [{ name, adresse, rssi }], stärkstes Signal zuerst
export async function suchen() {
  if (sim) return [{ name: 'BM6 (simuliert)', adresse: 'SIM', rssi: -50 }];
  const { geraete } = await Batteriewaechter.suchen({ sekunden: 8 });
  return geraete.sort((a, b) => b.rssi - a.rssi);
}
// Verbinden und Werte laufend empfangen, bis stopp(); das Plugin verbindet von selbst neu, wenn die Verbindung abreißt
export async function start(adresse) {
  if (laeuft) return;
  laeuft = true;
  if (sim) { simTimer = setInterval(simSchritt, SIM_TAKT); simSchritt(); return; }
  try { await Batteriewaechter.start({ adresse }); } catch (e) { laeuft = false; throw e; }
}
export async function stopp() {
  if (!laeuft) return;
  laeuft = false;
  if (simTimer) { clearInterval(simTimer); simTimer = 0; return; }
  await Batteriewaechter.stop().catch(() => {});
}
export const aktiv = () => laeuft;
// Werte seit dem letzten Abholen: [[t, v, temp, soc], …]
export async function abholen() {
  if (!sim && laeuft) {
    const { werte } = await Batteriewaechter.abholen().catch(() => ({ werte: [] }));
    for (const w of werte.map(lesen).filter(Boolean)) { letzter = w; puffer.push([w.t, w.v, w.temp, w.soc]); }
  }
  const raus = puffer; puffer = [];
  return raus;
}
// Letzter Wert { t, v, temp, soc } oder null, ohne den Puffer anzufassen (Anzeige, Knopf „Springt nicht an“)
export async function aktuell() {
  if (!sim && laeuft) {
    const r = await Batteriewaechter.letzter().catch(() => null);
    const w = r?.hex ? lesen([r.t, r.hex]) : null;
    if (w && (!letzter || w.t > letzter.t)) letzter = w;
  }
  return letzter;
}
// Ein frischer Wert. Verbindet nur dafür, wenn nicht ohnehin verbunden; null, wenn binnen `ms` nichts kam.
export async function einmal(adresse, ms = 20000) {
  const ab = Date.now(), selbst = !laeuft;
  if (selbst) await start(adresse);
  try {
    while (Date.now() - ab < ms) {
      const w = await aktuell();
      if (w && w.t >= ab) return w;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  } finally { if (selbst) await stopp(); }
}
