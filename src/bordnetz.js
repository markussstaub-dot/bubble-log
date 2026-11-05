// 12-V-Bordnetz im Ablauf der App (SPEC-12v.md): beim Fahren mitschreiben, Ruhewert nach dem Abstellen,
// Knopf „Springt nicht an“. Die Rechnung steckt in bordspannung.js, das Gerät in bm6.js; main.js verbindet sich
// einmal über verbinden() und ruft die Funktionen an den passenden Stellen der Fahrt auf.
// Messungen liegen in eigen.bordnetz: [{ t, v, temp, anlass, stufe, fahrt, p, foto, notiz }], die Minutenwerte einer Fahrt
// in fahrt.v12 = { start, minuten: [[t, kleinster, Mittel, größter], …], bewertung, ruhe }.
import * as bm6 from './bm6.js';
import * as devlog from './devlog.js';
import { einrechnen, fahrtBewerten, ruheStufe } from './bordspannung.js';

export const RUHE_NACH = 120000;   // ms nach dem Abstellen: Ruhewert, falls das Handy dann noch beim Auto ist
const ABHOLEN = 15000;             // ms: Werte höchstens so oft abholen (bei GPS-Punkten, wie die Sensoren)

// app: { eigen(), sichern(), melde(id, titel, text) }
let app = null, zuletzt = 0, ruheTimer = 0;
export function verbinden(a) { app = a; }
export const an = () => !!app?.eigen().bm6?.an;
const adresse = () => app.eigen().bm6?.adresse;
const vText = v => `${v.toFixed(2).replace('.', ',')} V`;

function messen(m) {
  (app.eigen().bordnetz ||= []).push(m); app.sichern();
  devlog.log('bordnetz', { messung: m.anlass, v: m.v, stufe: m.stufe });
  return m;
}

export async function fahrtBeginn(o) {
  if (!an()) return;
  clearTimeout(ruheTimer); ruheTimer = 0;
  o.v12 = { minuten: [], summen: {} };
  bm6.motor(true);
  await geraetVerbinden();
}
// App neu gestartet, während eine Fahrt lief: wieder verbinden
export async function fortsetzen(o) {
  if (!an() || !o?.v12 || o.status !== 'faehrt' || bm6.aktiv()) return;
  bm6.motor(true);
  await geraetVerbinden();
}
async function geraetVerbinden() {
  try { await bm6.start(adresse()); await bm6.abholen(); zuletzt = Date.now(); }   // Werte von davor gehören nicht zur Fahrt
  catch (e) { devlog.log('bordnetz', { fehler: 'verbinden', text: e.message }); }
}

// Bei jedem GPS-Punkt der Fahrt; sofort = ohne Wartezeit (Fahrtende)
export async function beiPunkt(o, sofort = false) {
  if (!o?.v12?.summen || !bm6.aktiv()) return;
  if (!sofort && Date.now() - zuletzt < ABHOLEN) return;
  zuletzt = Date.now();
  const werte = await bm6.abholen(); if (!werte.length) return;
  if (o.v12.start == null) { const [t, v, temp] = werte[0]; o.v12.start = v; messen({ t, v, temp, anlass: 'start', fahrt: 'f' + o.t0 }); }
  einrechnen(o.v12.minuten, o.v12.summen, werte.map(w => [w[0], w[1]]));
  if (devlog.aktiv()) devlog.log('bordnetz', { werte: werte.map(w => [w[0], w[1]]) });   // Entwicklermodus: jeder Einzelwert
}

// Fahrt beendet: bewerten, nach RUHE_NACH den Ruhewert holen. Ergebnis: Bewertung oder null
export async function fahrtEnde(o, { ruheNach = RUHE_NACH, sichtbar = true } = {}) {
  if (!o?.v12?.summen) return o?.v12?.bewertung ?? null;
  await beiPunkt(o, true);
  bm6.motor(false);
  const b = o.v12.bewertung = fahrtBewerten(o.v12.minuten);
  delete o.v12.summen; app.sichern();
  devlog.log('bordnetz', { fahrt: 'ende', ...b });
  clearTimeout(ruheTimer); ruheTimer = setTimeout(ruheMessen, ruheNach, 'f' + o.t0, Date.now() + ruheNach / 2);
  if (b?.stufe === 'verdaechtig' && !sichtbar) app.melde(5, '12 V beim Fahren auffällig', `Ø ${vText(b.mittel)}, Schwankung ${vText(b.schwankung)}. Werte stehen im Fahrtenbuch.`);
  return b;
}
async function ruheMessen(id, frischAb) {
  ruheTimer = 0;
  const w = await bm6.aktuell();
  await bm6.abholen(); await bm6.stopp();
  if (!w || w.t < frischAb) { devlog.log('bordnetz', { ruhe: 'kein frischer Wert', letzter: w?.t ?? null }); return; }   // Handy schon weg
  const stufe = ruheStufe(w.v);
  messen({ t: w.t, v: w.v, temp: w.temp, anlass: 'ruhe', fahrt: id, stufe });
  const e = app.eigen(), f = e.fahrten.find(x => x.id === id) || (e.offen && 'f' + e.offen.t0 === id ? e.offen : null);
  if (f?.v12) { f.v12.ruhe = w.v; app.sichern(); }
  if (stufe === 'verdaechtig') app.melde(6, '12-V-Batterie schwach', `${vText(w.v)} nach dem Abstellen (verdächtig unter 12,0 V). Bitte im Blick behalten.`);
}
// Fahrt verworfen oder zu kurz: Aufzeichnung beenden
export async function abbrechen() {
  clearTimeout(ruheTimer); ruheTimer = 0;
  bm6.motor(false); await bm6.stopp();
}

// Knopf „Springt nicht an“ und danach „nach dem Trennen/Verbinden“: Zeit, Ort, Temperatur sofort, Spannung sobald da.
// anlass: 'startproblem' | 'nachher'; fertig(m) wird nach der Spannungsmessung aufgerufen
export function vorfall(anlass, { p, temp }, fertig = () => {}) {
  const m = messen({ t: Date.now(), v: null, temp, p, anlass });
  if (!an()) { fertig(m); return m; }
  laufend.add(m);
  bm6.einmal(adresse()).then(w => {
    laufend.delete(m);
    if (w) { m.v = w.v; m.vT = w.t; m.stufe = ruheStufe(w.v); m.temp ??= w.temp; }
    app.sichern(); devlog.log('bordnetz', { messung: anlass, v: m.v, stufe: m.stufe }); fertig(m);
  }, e => { laufend.delete(m); devlog.log('bordnetz', { fehler: anlass, text: e.message }); fertig(m); });
  return m;
}
const laufend = new Set();
export const misst = m => laufend.has(m);
