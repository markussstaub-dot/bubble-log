// Ladepunkte für den Microlino (AC Typ 2 oder Schuko) aus dem Ladesäulenregister der Bundesnetzagentur.
// Die Daten liegen in der App (src/ladepunkte.json, erzeugt mit tools/ladepunkte.mjs) und gehen offline.
import daten from './ladepunkte.json';
import { distanz } from './tracker.js';

export const STAND = daten.stand;
export const QUELLE = daten.quelle;
const ALLE = daten.standorte;
const SPANNUNG = 230, WIRKUNGSGRAD = 0.9;   // einphasig; etwa 10 % gehen beim Laden verloren

// kW, die im Akku ankommen, bei gegebenem Ladestrom
export const ladeKw = ampere => ampere * SPANNUNG / 1000 * WIRKUNGSGRAD;
// Minuten für so viele Prozent Akku
export const ladeMinuten = (prozent, akkuKwh, ampere) => Math.max(0, prozent) / 100 * akkuKwh / ladeKw(ampere) * 60;

export function beschreibung(s) {
  const stecker = [s.t2 && 'Typ 2', s.k && 'Typ-2-Kabel', s.s && 'Schuko'].filter(Boolean).join(', ');
  return [stecker, s.z === '24/7' ? '24/7' : ''].filter(Boolean).join(' · ');
}
export const adresse = s => [s.a, s.o].filter(Boolean).join(', ');

// Ladepunkte im Umkreis (Luftlinie in m), nächste zuerst: [{ ...standort, m }]
export function umkreis(p, meter, max = Infinity) {
  const grad = meter / 111000 + 0.01, out = [];
  for (const s of ALLE) {
    if (Math.abs(s.p[0] - p[0]) > grad || Math.abs(s.p[1] - p[1]) > grad * 1.6) continue;   // grober Vorfilter
    const m = distanz(p, s.p);
    if (m <= meter) out.push({ ...s, m });
  }
  return out.sort((a, b) => a.m - b.m).slice(0, max);
}

// Ladepunkte nahe einer Route (höchstens `korridor` m neben der Linie) mit km ab Start: [{ ...standort, kmAb, m }]
export function entlang(coords, korridor = 1000) {
  const kum = [0];
  for (let i = 1; i < coords.length; i++) kum.push(kum[i - 1] + distanz(coords[i - 1], coords[i]) / 1000);
  const lat = coords.map(c => c[0]), lon = coords.map(c => c[1]), rand = korridor / 111000 + 0.01;
  const box = [Math.min(...lat) - rand, Math.max(...lat) + rand, Math.min(...lon) - rand * 1.6, Math.max(...lon) + rand * 1.6];
  const out = [];
  for (const s of ALLE) {
    if (s.p[0] < box[0] || s.p[0] > box[1] || s.p[1] < box[2] || s.p[1] > box[3]) continue;
    let best = Infinity, bi = 0;
    for (let i = 0; i < coords.length; i++) { const m = distanz(coords[i], s.p); if (m < best) { best = m; bi = i; } }
    if (best <= korridor) out.push({ ...s, kmAb: kum[bi], m: best });
  }
  return out;
}

export const alle = () => ALLE;

// Fester Schlüssel eines Standorts (wie beim Zusammenfassen in tools/ladepunkte.mjs), für eigene Markierungen
export const schluessel = s => `${s.p[0].toFixed(4)},${s.p[1].toFixed(4)}`;
const NACH_SCHLUESSEL = new Map(ALLE.map(s => [schluessel(s), s]));
export const finde = key => NACH_SCHLUESSEL.get(key);
