// Ziel-Check: Ort suchen (Nominatim), Straßenroute (OSRM) und Höhenmeter entlang der Route (Open-Meteo).
// Alles öffentliche Dienste ohne Konto. Abgefragt wird nur, wenn der Nutzer ein Ziel prüft.
import { distanz } from './tracker.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const HOEHE = 'https://api.open-meteo.com/v1/elevation';
const HOEHE_SCHWELLE = 3;   // m: kleinere Schwankungen im Höhenmodell zählen nicht
const MAX_HOEHENPUNKTE = 100;   // Open-Meteo nimmt bis zu 100 Punkte pro Anfrage, zählt aber jeden einzeln (etwa 600 pro Minute)
const HOEHEN_ABSTAND = 300;     // m zwischen den Höhenpunkten; gröber unterschätzt die Steigung deutlich

async function holen(url, versuche = 1) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'Accept-Language': 'de' } });
  if (r.status === 429 && versuche > 0) {   // zu viele Abfragen: einmal kurz warten und nochmal
    await new Promise(ok => setTimeout(ok, 15000));
    return holen(url, versuche - 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// [{ name, kurz, p: [lat, lon] }]
export async function suchen(text) {
  const url = `${NOMINATIM}?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(text)}`;
  return (await holen(url)).map(e => {
    const a = e.address || {};
    const ort = a.city || a.town || a.village || a.municipality || a.county || '';
    const kurz = [e.name || a.road, ort].filter((x, i, l) => x && l.indexOf(x) === i).join(', ') || e.display_name;
    return { name: e.display_name, kurz, p: [Number(e.lat), Number(e.lon)] };
  });
}

// Punkte etwa gleichmäßig über die Route verteilt (höchstens MAX_HOEHENPUNKTE)
function verteilen(coords, anzahl) {
  const kum = [0];
  for (let i = 1; i < coords.length; i++) kum.push(kum[i - 1] + distanz(coords[i - 1], coords[i]));
  const ges = kum.at(-1), out = [];
  for (let k = 0, j = 0; k < anzahl; k++) {
    const ziel = ges * k / (anzahl - 1);
    while (j < kum.length - 1 && kum[j + 1] < ziel) j++;
    out.push(coords[j]);
  }
  return out;
}

export function hoehenmeter(hoehen) {
  let ref = hoehen[0], auf = 0, ab = 0;
  for (const v of hoehen) {
    if (v - ref >= HOEHE_SCHWELLE) { auf += v - ref; ref = v; }
    else if (ref - v >= HOEHE_SCHWELLE) { ab += ref - v; ref = v; }
  }
  return { auf: Math.round(auf), ab: Math.round(ab) };
}

// OSRM-Route → { km, minuten, coords: [[lat, lon], …], auf, ab, hoeheBekannt }, Höhenmeter dazu von Open-Meteo
async function mitHoehen(r) {
  const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const ergebnis = { km: r.distance / 1000, minuten: r.duration / 60, coords, auf: 0, ab: 0, hoeheBekannt: false };
  try {
    const anzahl = Math.max(2, Math.min(MAX_HOEHENPUNKTE, Math.round(r.distance / HOEHEN_ABSTAND) + 1));
    const pts = verteilen(coords, anzahl);
    const h = await holen(`${HOEHE}?latitude=${pts.map(p => p[0].toFixed(5)).join(',')}&longitude=${pts.map(p => p[1].toFixed(5)).join(',')}`);
    if (Array.isArray(h.elevation) && h.elevation.length === pts.length) Object.assign(ergebnis, hoehenmeter(h.elevation), { hoeheBekannt: true });
  } catch (e) { console.warn('Höhen nicht geladen', e); }
  return ergebnis;
}

export async function route(von, nach) {
  const d = await holen(`${OSRM}/${von[1]},${von[0]};${nach[1]},${nach[0]}?overview=full&geometries=geojson`);
  const r = d.routes?.[0];
  if (d.code !== 'Ok' || !r) throw new Error(d.message || 'Keine Route gefunden');
  return mitHoehen(r);
}

// ---------- Mini-Navi: bis zu drei Wege mit Abbiegeliste ----------
const RICHTUNG = { left: 'links', right: 'rechts', 'slight left': 'leicht links', 'slight right': 'leicht rechts',
  'sharp left': 'scharf links', 'sharp right': 'scharf rechts', straight: 'geradeaus', uturn: 'wenden' };
// ein OSRM-Schritt als deutscher Satz, z. B. „rechts abbiegen auf Rombachstraße“
export function anweisung(s) {
  const m = s.maneuver || {}, r = RICHTUNG[m.modifier] || '', auf = s.name ? ` auf ${s.name}` : '';
  switch (m.type) {
    case 'depart': return `Losfahren${auf}`;
    case 'arrive': return 'Ziel erreicht';
    case 'roundabout': case 'rotary': case 'exit roundabout': case 'exit rotary':
      return `Im Kreisverkehr ${m.exit ? `${m.exit}. Ausfahrt` : 'raus'}${auf}`;
    case 'continue': case 'new name': return r && r !== 'geradeaus' ? `${r[0].toUpperCase()}${r.slice(1)} halten${auf}` : `Weiter${auf}`;
    case 'fork': return `An der Gabelung ${r || 'weiter'}${auf}`;
    case 'merge': return `Einfädeln${auf}`;
    case 'on ramp': return `Auffahrt ${r}${auf}`.replace('  ', ' ');
    case 'off ramp': return `Ausfahrt ${r}${auf}`.replace('  ', ' ');
    case 'end of road': return `Am Ende der Straße ${r}${auf}`;
    default: return r === 'wenden' ? 'Wenden' : r ? `${r[0].toUpperCase()}${r.slice(1)} abbiegen${auf}` : `Weiter${auf}`;
  }
}

// [{ …route, schritte: [{ text, m }] }], die schnellste zuerst; OSRM liefert je nach Lage nur eine oder zwei Alternativen
export async function wege(von, nach) {
  const d = await holen(`${OSRM}/${von[1]},${von[0]};${nach[1]},${nach[0]}?overview=full&geometries=geojson&alternatives=3&steps=true`);
  if (d.code !== 'Ok' || !d.routes?.length) throw new Error(d.message || 'Keine Route gefunden');
  const out = [];
  for (const r of d.routes.slice(0, 3)) {   // nacheinander, wegen der Abfragegrenze von Open-Meteo
    const schritte = [];
    for (const s of r.legs.flatMap(l => l.steps)) {   // „aus dem Kreisverkehr raus“ steckt schon in der Einfahrt: Strecke dort dazuzählen
      if (/^exit (roundabout|rotary)$/.test(s.maneuver?.type) && schritte.length) schritte.at(-1).m += Math.round(s.distance);
      else schritte.push({ text: anweisung(s), m: Math.round(s.distance) });
    }
    out.push({ ...(await mitHoehen(r)), schritte });
  }
  return out;
}
