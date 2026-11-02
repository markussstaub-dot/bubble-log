// Visuelles Logbuch (SPEC-logbuch.md): Tagestour aus den gespeicherten Fahrten, mit Unschärfe um private Orte.
// Ohne DOM und Leaflet, damit es sich testen lässt; gezeichnet wird in main.js.
import { distanz } from './erkennung.js';

// Punkte einer Fahrt ([lat, lon, …]) ohne die Stücke im Umkreis privater Orte → Liste sichtbarer Abschnitte
export function unscharf(punkte, orte, radius) {
  if (!radius || !orte.length) return punkte.length ? [punkte] : [];
  const abschnitte = []; let jetzt = [];
  for (const p of punkte) {
    if (orte.some(o => distanz(o, p) < radius)) { if (jetzt.length > 1) abschnitte.push(jetzt); jetzt = []; }
    else jetzt.push(p);
  }
  if (jetzt.length > 1) abschnitte.push(jetzt);
  return abschnitte;
}

// Mitte des Unschärfekreises: fest um 20–35 % des Radius versetzt (aus den Koordinaten abgeleitet, also bei jedem
// Öffnen gleich), damit die Kreismitte nicht auf der Haustür sitzt
export function kreisMitte([lat, lon], radius) {
  const h = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1, w = h * Math.PI * 2, d = radius * (0.2 + 0.15 * h);
  return [lat + d * Math.cos(w) / 111320, lon + d * Math.sin(w) / (111320 * Math.cos(lat * Math.PI / 180))];
}

// Private Orte, die eine Tagestour tatsächlich berührt (nur die bekommen einen Kreis)
export const beruehrt = (fahrten, orte, radius) => orte.filter(o => fahrten.some(f => (f.punkte || []).some(p => distanz(o.p, p) < radius)));

// Kennzahlen und Akku-Verlauf eines Tages. fahrten: gespeicherte Fahrten (chronologisch egal)
export function tagestour(fahrten) {
  const l = [...fahrten].sort((a, b) => a.t0 - b.t0);
  const verlauf = [];   // [{ t, soc, art: 'fahrt' | 'laden' }]
  for (const f of l) {
    const vorher = verlauf.at(-1);
    if (vorher && f.start > vorher.soc) verlauf.push({ t: f.t0, soc: f.start, art: 'laden' });
    else if (!vorher || f.start !== vorher.soc) verlauf.push({ t: f.t0, soc: f.start, art: 'start' });
    else verlauf.push({ t: f.t0, soc: f.start, art: 'stand' });
    verlauf.push({ t: f.t1, soc: f.ende, art: 'fahrt' });
  }
  const verbraucht = l.reduce((s, f) => s + Math.max(0, f.start - f.ende), 0);
  const geladen = verlauf.reduce((s, v, i) => s + (v.art === 'laden' ? v.soc - verlauf[i - 1].soc : 0), 0);
  return {
    fahrten: l, verlauf,
    km: Math.round(l.reduce((s, f) => s + (f.km || 0), 0) * 10) / 10,
    verbraucht, hm: l.reduce((s, f) => s + (f.hm || 0), 0),
    kalt: l.some(f => f.kalt), nachtMin: l.find(f => f.nachtMin != null)?.nachtMin ?? null,
    geschaetzt: l.some(f => f.endeQuelle === 'vorschlag'), geladen,
  };
}
