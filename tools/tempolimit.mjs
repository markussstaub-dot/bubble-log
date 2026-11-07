// Tempolimits aus OpenStreetMap (SPEC-tempolimit.md): Geofabrik-Extrakte (.osm.pbf) → Kacheln zu 0,1° × 0,1° in
// docs/tempolimit/ (GitHub Pages). Die App lädt die Kacheln im Umkreis von 40 km um das Zuhause (src/tempolimit.js).
//
// Aufruf: node tools/tempolimit.mjs <saarland-latest.osm.pbf> <rheinland-pfalz-latest.osm.pbf> [--bbox S,W,N,O]
// Extrakte: https://download.geofabrik.de/europe/germany/  (Overpass taugt für große Gebiete nicht, 07.11.2026 überlastet)
//
// Kachel „493_72“ = südwestliche Ecke 49,3° N / 7,2° O. Inhalt: { w: [[wegId, vor, rück, [lat0, lon0, dLat, dLon, …]], …] }
//   vor/rück: Limit in Wegrichtung bzw. dagegen (maxspeed:forward/backward vor maxspeed): km/h, 0 = keine Begrenzung
//   („none“), -1 = Schrittgeschwindigkeit („walk“), -2 = Einbahnstraße, diese Richtung gibt es nicht, null = unbekannt. Koordinaten in 1e-5 Grad, ab dem 2. Punkt als
//   Differenz. Straßen ohne Limit sind mit null dabei, damit die App dort „?“ zeigt statt die Nachbarstraße zu nehmen.
//   Geometrie vereinfacht (Douglas-Peucker, 5 m). Lange Wege werden an den Kachelgrenzen geteilt.
// Eigener kleiner PBF-Leser (Blob → zlib → PrimitiveBlock) mit dem Paket pbf, kein osmium nötig.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';

const args = process.argv.slice(2);
const bboxArg = args.includes('--bbox') ? args.splice(args.indexOf('--bbox'), 2)[1].split(',').map(Number) : null;
const dateien = args;
if (!dateien.length) { console.error('Aufruf: node tools/tempolimit.mjs <extrakt.osm.pbf> […] [--bbox S,W,N,O]'); process.exit(1); }
const ZIEL = new URL('../docs/tempolimit/', import.meta.url);
const TOLERANZ = 5;   // m, Vereinfachung
const KACHEL = 10;    // Kacheln pro Grad (0,1°)

// Straßen, auf denen ein Auto fährt. service/track nur, wenn ein Limit dran steht (sonst Parkplätze und Einfahrten en masse).
const STRASSEN = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'road']);
const NUR_MIT_LIMIT = new Set(['service', 'track']);

// maxspeed-Wert → km/h | 0 (none) | -1 (walk) | null
const IMPLIZIT = { 'DE:urban': 50, 'DE:rural': 100, 'DE:motorway': 0, 'DE:living_street': -1, 'DE:bicycle_road': 30, 'DE:zone30': 30, 'DE:zone:30': 30, 'DE:zone20': 20, 'DE:zone:20': 20, 'DE:zone10': 10, 'DE:zone:10': 10 };
export function limit(v) {
  if (v == null) return null;
  v = v.trim();
  if (v === 'none') return 0;
  if (v === 'walk') return -1;
  if (v in IMPLIZIT) return IMPLIZIT[v];
  const m = /^(\d{1,3})(\s*mph)?$/.exec(v);
  if (!m) return null;   // signals, variable, „50;30“ …
  return m[2] ? Math.round(Number(m[1]) * 1.609) : Number(m[1]);
}
// zone:maxspeed=DE:30 bzw. source:maxspeed=DE:zone30 als Ersatz, wenn maxspeed fehlt
const zone = t => limit(t['zone:maxspeed']?.replace(/^DE:(\d+)$/, '$1')) ?? (t['source:maxspeed'] in IMPLIZIT ? IMPLIZIT[t['source:maxspeed']] : null);

// ---------- PBF lesen ----------
function* bloecke(datei) {
  const buf = readFileSync(datei);
  let pos = 0;
  while (pos < buf.length) {
    const kopfLen = buf.readUInt32BE(pos); pos += 4;
    const kopf = new PbfReader(buf.subarray(pos, pos + kopfLen)).readFields((tag, o, p) => {
      if (tag === 1) o.typ = p.readString(); else if (tag === 3) o.groesse = p.readVarint();
    }, {});
    pos += kopfLen;
    const blob = new PbfReader(buf.subarray(pos, pos + kopf.groesse)).readFields((tag, o, p) => {
      if (tag === 1) o.roh = p.readBytes(); else if (tag === 3) o.zlib = p.readBytes();
    }, {});
    pos += kopf.groesse;
    yield { typ: kopf.typ, daten: blob.roh ?? inflateSync(blob.zlib) };
  }
}
function stand(datei) {   // HeaderBlock.osmosis_replication_timestamp (Feld 32, Sekunden)
  for (const b of bloecke(datei)) {
    if (b.typ !== 'OSMHeader') continue;
    const h = new PbfReader(b.daten).readFields((tag, o, p) => { if (tag === 32) o.ts = p.readVarint(); }, {});
    return h.ts ? new Date(h.ts * 1000) : null;
  }
  return null;
}
// Ein PrimitiveBlock: Strings, Granularität, Gruppen (roh als Byte-Bereiche, damit nur gelesen wird, was gebraucht wird)
function block(daten) {
  const b = { strings: [], gran: 100, latOff: 0, lonOff: 0, gruppen: [] };
  new PbfReader(daten).readFields((tag, o, p) => {
    if (tag === 1) p.readFields((t, s, q) => { if (t === 1) s.push(new TextDecoder().decode(q.readBytes())); }, o.strings, p.readVarint() + p.pos);
    else if (tag === 2) { const len = p.readVarint(); o.gruppen.push(daten.subarray(p.pos, p.pos + len)); p.pos += len; }
    else if (tag === 17) o.gran = p.readVarint();
    else if (tag === 19) o.latOff = p.readVarint(true);
    else if (tag === 20) o.lonOff = p.readVarint(true);
  }, b);
  return b;
}
function wege(b, f) {   // f(id, tags, refs)
  for (const g of b.gruppen) new PbfReader(g).readFields((tag, _, p) => {
    if (tag !== 3) return;
    const w = p.readFields((t, o, q) => {
      if (t === 1) o.id = q.readVarint();
      else if (t === 2) q.readPackedVarint(o.k);
      else if (t === 3) q.readPackedVarint(o.v);
      else if (t === 8) q.readPackedSVarint(o.r);
    }, { id: 0, k: [], v: [], r: [] }, p.readVarint() + p.pos);
    const tags = {}; w.k.forEach((k, i) => { tags[b.strings[k]] = b.strings[w.v[i]]; });
    for (let i = 1; i < w.r.length; i++) w.r[i] += w.r[i - 1];
    f(w.id, tags, w.r);
  });
}
function knoten(b, f) {   // f(id, lat, lon) für DenseNodes und einfache Nodes
  const g2 = n => 1e-9 * (b.latOff + b.gran * n), h2 = n => 1e-9 * (b.lonOff + b.gran * n);
  for (const g of b.gruppen) new PbfReader(g).readFields((tag, _, p) => {
    if (tag === 2) {
      const d = p.readFields((t, o, q) => {
        if (t === 1) q.readPackedSVarint(o.id); else if (t === 8) q.readPackedSVarint(o.lat); else if (t === 9) q.readPackedSVarint(o.lon);
      }, { id: [], lat: [], lon: [] }, p.readVarint() + p.pos);
      let id = 0, la = 0, lo = 0;
      for (let i = 0; i < d.id.length; i++) { id += d.id[i]; la += d.lat[i]; lo += d.lon[i]; f(id, g2(la), h2(lo)); }
    } else if (tag === 1) {
      const n = p.readFields((t, o, q) => { if (t === 1) o.id = q.readSVarint(); else if (t === 8) o.lat = q.readSVarint(); else if (t === 9) o.lon = q.readSVarint(); }, {}, p.readVarint() + p.pos);
      f(n.id, g2(n.lat), h2(n.lon));
    }
  });
}

// ---------- 1. Durchgang: Wege ----------
const gefunden = new Map();   // wegId → { f, b, refs, klasse }
let refAnzahl = 0;
for (const d of dateien) {
  for (const blk of bloecke(d)) {
    if (blk.typ !== 'OSMData') continue;
    wege(block(blk.daten), (id, t, refs) => {
      const hw = t.highway; if (!hw || gefunden.has(id) || t.area === 'yes') return;
      const allg = limit(t.maxspeed) ?? zone(t) ?? (hw === 'living_street' ? -1 : null);   // verkehrsberuhigt = Schritt (StVO)
      let f = limit(t['maxspeed:forward']) ?? allg, b = limit(t['maxspeed:backward']) ?? allg;
      // Einbahnstraße: Gegenrichtung gibt es nicht (-2), sonst nähme die App auf der Autobahn die Gegenfahrbahn
      const ow = t.oneway, einbahn = ['yes', 'true', '1'].includes(ow) || (ow !== 'no' && (hw === 'motorway' || ['roundabout', 'circular'].includes(t.junction)));
      if (einbahn) b = -2; else if (ow === '-1') f = -2;
      if (!STRASSEN.has(hw) && !(NUR_MIT_LIMIT.has(hw) && (f != null || b != null))) return;
      gefunden.set(id, { f, b, refs, klasse: hw.replace('_link', '') }); refAnzahl += refs.length;
    });
  }
  console.log(`${d}: ${gefunden.size} Wege bisher`);
}
// Gebrauchte Knoten sortiert, Koordinaten per Binärsuche
let ids = new Float64Array(refAnzahl), n = 0;
for (const w of gefunden.values()) for (const r of w.refs) ids[n++] = r;
ids.sort();
{ let m = 0; for (let i = 0; i < n; i++) if (i === 0 || ids[i] !== ids[m - 1]) ids[m++] = ids[i]; ids = ids.slice(0, m); }
const lat = new Float64Array(ids.length).fill(NaN), lon = new Float64Array(ids.length).fill(NaN);
const suche = id => { let a = 0, z = ids.length - 1; while (a <= z) { const m = (a + z) >> 1; if (ids[m] < id) a = m + 1; else if (ids[m] > id) z = m - 1; else return m; } return -1; };

// ---------- 2. Durchgang: Knoten ----------
let staende = [];
for (const d of dateien) {
  staende.push(stand(d));
  for (const blk of bloecke(d)) {
    if (blk.typ !== 'OSMData') continue;
    knoten(block(blk.daten), (id, la, lo) => { const i = suche(id); if (i >= 0) { lat[i] = la; lon[i] = lo; } });
  }
  console.log(`${d}: Knoten gelesen`);
}

// ---------- Vereinfachen, teilen, schreiben ----------
const R = 6371000, RAD = Math.PI / 180;
function douglasPeucker(pkt) {   // pkt: [[lat, lon]], Toleranz in Metern (lokal eben)
  if (pkt.length < 3) return pkt;
  const k = Math.cos(pkt[0][0] * RAD), xy = pkt.map(([a, b]) => [b * RAD * R * k, a * RAD * R]);
  const behalten = new Uint8Array(pkt.length); behalten[0] = behalten[pkt.length - 1] = 1;
  const stapel = [[0, pkt.length - 1]];
  while (stapel.length) {
    const [s, e] = stapel.pop(); let max = 0, idx = -1;
    const [x1, y1] = xy[s], [x2, y2] = xy[e], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i]; let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > max) { max = d; idx = i; }
    }
    if (max > TOLERANZ) { behalten[idx] = 1; stapel.push([s, idx], [idx, e]); }
  }
  return pkt.filter((_, i) => behalten[i]);
}
const kachelVon = (a, b) => `${Math.floor(a * KACHEL)}_${Math.floor(b * KACHEL)}`;
const imBereich = ([a, b]) => !bboxArg || (a >= bboxArg[0] && b >= bboxArg[1] && a <= bboxArg[2] && b <= bboxArg[3]);
const kacheln = new Map(), statistik = {};
let fehlend = 0, punkte = 0;
const strecke = p => { let s = 0; for (let i = 1; i < p.length; i++) { const k = Math.cos(p[i][0] * RAD); s += R * RAD * Math.hypot(p[i][0] - p[i - 1][0], (p[i][1] - p[i - 1][1]) * k); } return s; };
for (const [id, w] of gefunden) {
  const roh = [];
  for (const r of w.refs) { const i = suche(r); if (i < 0 || Number.isNaN(lat[i])) { fehlend++; continue; } roh.push([lat[i], lon[i]]); }
  if (roh.length < 2 || !roh.some(imBereich)) continue;
  const st = statistik[w.klasse] ??= { km: 0, mit: 0 }, km = strecke(roh) / 1000;
  st.km += km; if ((w.f ?? -2) !== -2 || (w.b ?? -2) !== -2) st.mit += km;
  const p = douglasPeucker(roh);
  // an Kachelgrenzen teilen: jedes Teilstück gehört zur Kachel seiner Mitte
  let stueck = [p[0]], kachel = null;
  const abgeben = () => {
    if (stueck.length < 2) return;
    const c = []; let la0 = 0, lo0 = 0;
    for (const [a, b] of stueck) { const A = Math.round(a * 1e5), B = Math.round(b * 1e5); c.push(A - la0, B - lo0); la0 = A; lo0 = B; }
    if (!kacheln.has(kachel)) kacheln.set(kachel, []);
    kacheln.get(kachel).push([id, w.f, w.b, c]); punkte += stueck.length;
  };
  for (let i = 1; i < p.length; i++) {
    const k = kachelVon((p[i - 1][0] + p[i][0]) / 2, (p[i - 1][1] + p[i][1]) / 2);
    if (kachel && k !== kachel) { abgeben(); stueck = [p[i - 1]]; }
    kachel = k; stueck.push(p[i]);
  }
  abgeben();
}

mkdirSync(ZIEL, { recursive: true });
for (const f of readdirSync(ZIEL)) if (f.endsWith('.json')) rmSync(new URL(f, ZIEL));
const index = {
  quelle: '© OpenStreetMap-Mitwirkende (ODbL), Auszug von Geofabrik',
  stand: staende.filter(Boolean).map(d => d.toISOString().slice(0, 10)).sort()[0] ?? new Date().toISOString().slice(0, 10),
  kachelGrad: 1 / KACHEL, kacheln: {},
};
let bytes = 0;
for (const [k, w] of kacheln) {
  const text = JSON.stringify({ w });
  writeFileSync(new URL(`${k}.json`, ZIEL), text); bytes += text.length;
  index.kacheln[k] = text.length;
}
writeFileSync(new URL('index.json', ZIEL), JSON.stringify(index));
console.log(`${kacheln.size} Kacheln, ${punkte} Punkte, ${(bytes / 1e6).toFixed(1)} MB, Stand ${index.stand}${fehlend ? `, ${fehlend} Knoten fehlten (Weg am Rand des Extrakts)` : ''}`);
for (const [k, s] of Object.entries(statistik).sort((a, b) => b[1].km - a[1].km)) console.log(`  ${k.padEnd(14)} ${s.km.toFixed(0).padStart(6)} km, mit Limit ${(100 * s.mit / s.km).toFixed(0)} %`);
