// Notizen als eigene Daten (SPEC-konsole.md, 15.11.2026): Format, Zuordnung zur Fahrt über die Zeit, Ort und CSV-Feld.
// Ohne DOM und Capacitor, damit es sich testen lässt. Gespeichert wird in eigen.notizen (main.js), empfangen in notizen.js.
//
// Eine Notiz: { t, quelle, art, text, lat?, lon?, fahrtId? }
//   t       Zeitpunkt in ms (beim Sticky die Zeit am Gerät, beim Teilen der Empfang)
//   quelle  woher: 'sticky', 'teilen', 'browser' …
//   art     was: 'diktat', 'knopf', 'text' …
//   fahrtId nur, wenn der Absender die Fahrt selbst kennt; sonst wird über die Zeit zugeordnet

export const TEXT_MAX = 2000;            // Zeichen; ein langes geteiltes Dokument wird gekürzt
export const VOR_START = 2 * 60e3;       // ms vor dem Fahrtbeginn zählt noch zur Fahrt (Notiz beim Einsteigen)
export const NACH_ENDE = 10 * 60e3;      // ms nach dem Ende zählt noch zur Fahrt (Diktat nach dem Abstellen)
export const ORT_FRISCH = 3 * 60e3;      // ms: so alt darf der letzte GPS-Punkt sein, um als Ort der Notiz zu gelten

const zahl = v => typeof v === 'number' && Number.isFinite(v) ? v : null;

// Rohdaten (Sticky-Zeile, geteilter Text) → Notiz oder null, wenn kein Text da ist.
// ort: { lat, lon, t } letzter bekannter Standort; gilt nur, wenn er zur Zeit der Notiz passt.
export function notizAus(roh, { jetzt = Date.now(), ort = null } = {}) {
  if (!roh || typeof roh !== 'object') return null;
  const text = String(roh.text ?? '').trim().slice(0, TEXT_MAX);
  // Knopf-Notizen der Sticky-App haben teils keinen Text, nur den Knopf
  const anzeige = text || (roh.knopf ? `Knopf ${roh.knopf}` : '');
  if (!anzeige) return null;
  const t = zahl(roh.t) ?? jetzt;
  const n = { t, quelle: String(roh.quelle || 'unbekannt'), art: String(roh.art || 'text'), text: anzeige };
  const lat = zahl(roh.lat), lon = zahl(roh.lon);
  if (lat != null && lon != null) Object.assign(n, { lat, lon });
  else if (ort && Math.abs((ort.t ?? jetzt) - t) <= ORT_FRISCH) Object.assign(n, { lat: ort.lat, lon: ort.lon });
  if (roh.fahrtId) n.fahrtId = String(roh.fahrtId);
  return n;
}

// Zeitfenster einer Fahrt, in das Notizen fallen
const fenster = f => [f.t0 - VOR_START, (f.t1 ?? f.t0) + NACH_ENDE];

// Fahrt-ID für einen Zeitpunkt: zuerst die Fahrt, in der t liegt, sonst die nächste innerhalb der Fenster.
export function fahrtFuer(t, fahrten) {
  let best = null, abstand = Infinity;
  for (const f of fahrten) {
    if (f.t0 == null) continue;
    const t1 = f.t1 ?? f.t0;
    if (t >= f.t0 && t <= t1) return f.id;
    const [a, b] = fenster(f);
    if (t < a || t > b) continue;
    const d = t < f.t0 ? f.t0 - t : t - t1;
    if (d < abstand) { abstand = d; best = f.id; }
  }
  return best;
}

// Notizen, die zu dieser Fahrt gehören, nach Zeit sortiert
export function notizenDerFahrt(f, notizen, fahrten) {
  return (notizen || []).filter(n => (n.fahrtId ?? fahrtFuer(n.t, fahrten)) === f.id).sort((a, b) => a.t - b.t);
}

// Notizen eines Tages (Datum wie f.tag, über tagVon), auch die ohne Fahrt
export const notizenDesTages = (tag, notizen, tagVon) => (notizen || []).filter(n => tagVon(n.t) === tag).sort((a, b) => a.t - b.t);

// Ort einer Notiz: eigener Ort, sonst geschätzt entlang der Fahrt (Punkte tragen keine Zeit, also anteilig
// zwischen Beginn und Ende). Ergebnis [lat, lon, ungefähr] oder null.
export function ortVon(n, f) {
  if (n.lat != null && n.lon != null) return [n.lat, n.lon, false];
  const P = f?.punkte; if (!P?.length || f.t0 == null) return null;
  const t1 = f.t1 ?? f.t0, anteil = t1 > f.t0 ? Math.min(1, Math.max(0, (n.t - f.t0) / (t1 - f.t0))) : 1;
  const p = P[Math.round(anteil * (P.length - 1))];
  return [p[0], p[1], true];
}

// CSV-Feld „Notizen“: „09:38 Schild falsch | 09:52 Stau“, in Anführungszeichen, wenn nötig
export function csvFeld(liste, uhr) {
  if (!liste.length) return '';
  const s = liste.map(n => `${uhr(n.t)} ${n.text.replace(/\s+/g, ' ')}`).join(' | ');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
