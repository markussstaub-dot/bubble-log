// Ladesäulenregister der Bundesnetzagentur → src/ladepunkte.json (nur was der Microlino nutzen kann)
// Aufruf: node tools/ladepunkte.mjs <Ladesaeulenregister.csv> [Radius km, Standard 150]
// Quelle: https://www.bundesnetzagentur.de/ladeinfrastruktur  (CSV „Liste der Ladesäulen“)
import { readFileSync, writeFileSync } from 'node:fs';

const [, , datei, radiusArg] = process.argv;
if (!datei) { console.error('Aufruf: node tools/ladepunkte.mjs <Ladesaeulenregister.csv> [Radius km]'); process.exit(1); }
const ZUHAUSE = [49.3466, 7.2561];   // Bexbach
const RADIUS = Number(radiusArg || 150) * 1000;

function distanz(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// CSV mit Semikolon und Anführungszeichen (Felder wie "RFID-Karte;Onlinezahlung" enthalten Semikolons)
function zeilen(text) {
  const out = []; let feld = '', zeile = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; }
      else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === ';') { zeile.push(feld); feld = ''; }
    else if (c === '\n') { zeile.push(feld.replace(/\r$/, '')); out.push(zeile); zeile = []; feld = ''; }
    else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); out.push(zeile); }
  return out;
}

const text = readFileSync(datei, 'utf8').replace(/^﻿/, '');
const stand = (text.match(/Letzte Aktualisierung vom:\s*([\d.]+)/) || [])[1] || '';
const alle = zeilen(text);
const kopfIndex = alle.findIndex(z => z[0] === 'Ladeeinrichtungs-ID');
if (kopfIndex < 0) throw new Error('Kopfzeile nicht gefunden – Format der Bundesnetzagentur geändert?');
const kopf = alle[kopfIndex], spalte = n => kopf.indexOf(n);
const S = {
  status: spalte('Status'), betreiber: spalte('Betreiber'), name: spalte('Anzeigename (Karte)'), anzahl: spalte('Anzahl Ladepunkte'),
  strasse: kopf.findIndex(k => k.startsWith('Stra')), nr: spalte('Hausnummer'), ort: spalte('Ort'),
  lat: spalte('Breitengrad'), lon: kopf.findIndex(k => k.startsWith('L') && k.endsWith('ngengrad')),
  zeiten: kopf.findIndex(k => k.startsWith('Öffnungszeiten') && !k.includes(':')), parken: spalte('Informationen zum Parkraum'),
  bezahl: spalte('Bezahlsysteme'), ort2: spalte('Standortbezeichnung'),
};
const stecker = kopf.map((k, i) => k.startsWith('Steckertypen') ? i : -1).filter(i => i >= 0);
const zahl = s => Number(String(s).replace(',', '.'));
const glatt = s => String(s || '').replace(/\s+/g, ' ').trim();

const standorte = new Map();
let gelesen = 0, passend = 0;
for (const z of alle.slice(kopfIndex + 1)) {
  if (z.length < kopf.length - 5 || !z[S.lat]) continue;
  gelesen++;
  if (!/in betrieb/i.test(z[S.status])) continue;
  const p = [zahl(z[S.lat]), zahl(z[S.lon])];
  if (!isFinite(p[0]) || !isFinite(p[1]) || distanz(ZUHAUSE, p) > RADIUS) continue;
  let typ2 = 0, kupplung = 0, schuko = 0, kw = 0;
  for (const i of stecker) {
    const s = z[i] || '';
    // ein Feld kann mehrere Stecker nennen, z. B. "AC Typ 2 Steckdose, AC Schuko"
    if (/AC Typ 2 Steckdose/i.test(s)) typ2++;
    if (/AC Typ 2 Fahrzeugkupplung/i.test(s)) kupplung++;
    if (/Schuko/i.test(s)) schuko++;
    if (/AC/i.test(s)) kw = Math.max(kw, zahl(z[i + 1]) || 0);
  }
  if (!typ2 && !kupplung && !schuko) continue;   // nur Gleichstrom: für den Microlino nutzlos
  passend++;
  const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const s = standorte.get(key) || {
    p: [+p[0].toFixed(5), +p[1].toFixed(5)], b: glatt(z[S.name] || z[S.betreiber]),
    a: glatt([z[S.strasse], z[S.nr]].filter(Boolean).join(' ')), o: glatt(z[S.ort]),
    z: z[S.zeiten] === '247' ? '24/7' : (z[S.zeiten] && z[S.zeiten] !== 'Keine Angabe' ? z[S.zeiten] : ''),
    t2: 0, k: 0, s: 0, kw: 0, n: 0,
  };
  s.t2 += typ2; s.k += kupplung; s.s += schuko; s.kw = Math.max(s.kw, kw); s.n += Number(z[S.anzahl]) || 0;
  standorte.set(key, s);
}
const liste = [...standorte.values()].sort((a, b) => a.p[0] - b.p[0]);
const ziel = new URL('../src/ladepunkte.json', import.meta.url);
writeFileSync(ziel, JSON.stringify({ quelle: 'Bundesnetzagentur, Ladesäulenregister (CC BY 4.0)', stand, zuhause: ZUHAUSE, radiusKm: RADIUS / 1000, standorte: liste }));
console.log(`Stand ${stand}: ${gelesen} Ladeeinrichtungen gelesen, ${passend} mit Typ 2 oder Schuko im Umkreis von ${RADIUS / 1000} km → ${liste.length} Standorte`);
console.log(`Typ 2 Steckdose: ${liste.filter(s => s.t2).length}, Typ-2-Kabel fest: ${liste.filter(s => s.k).length}, Schuko: ${liste.filter(s => s.s).length}`);
