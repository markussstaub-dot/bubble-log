// Tempolimits aus OpenStreetMap (SPEC-tempolimit.md), Prüfwerkzeug: Geofabrik-Extrakte (.osm.pbf) → Kacheln zu
// 0,1° × 0,1° in docs/tempolimit/. Die App baut ihren Cache seit 15.11.2026 selbst aus Overpass (src/tempolimit.js);
// beide benutzen dieselbe Umrechnung (src/tempolimit-osm.js), die Kacheln hier dienen zum Vergleich.
//
// Aufruf: node tools/tempolimit.mjs <saarland-latest.osm.pbf> <rheinland-pfalz-latest.osm.pbf> [--bbox S,W,N,O] [--land DE]
// Extrakte: https://download.geofabrik.de/europe/germany/
//
// Format der Kacheln und Umrechnung: src/tempolimit-osm.js.
// Eigener kleiner PBF-Leser (Blob → zlib → PrimitiveBlock) mit dem Paket pbf, kein osmium nötig.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';
import { wegLimits, landAusTags, teilen, strecke } from '../src/tempolimit-osm.js';

const args = process.argv.slice(2);
const bboxArg = args.includes('--bbox') ? args.splice(args.indexOf('--bbox'), 2)[1].split(',').map(Number) : null;
const LAND = args.includes('--land') ? args.splice(args.indexOf('--land'), 2)[1] : 'DE';   // für living_street ohne Limit
const dateien = args;
if (!dateien.length) { console.error('Aufruf: node tools/tempolimit.mjs <extrakt.osm.pbf> […] [--bbox S,W,N,O]'); process.exit(1); }
const ZIEL = new URL('../docs/tempolimit/', import.meta.url);
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
      if (!t.highway || gefunden.has(id)) return;
      const l = wegLimits(t, landAusTags(t) ?? LAND); if (!l) return;
      gefunden.set(id, { ...l, refs }); refAnzahl += refs.length;
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
const imBereich = ([a, b]) => !bboxArg || (a >= bboxArg[0] && b >= bboxArg[1] && a <= bboxArg[2] && b <= bboxArg[3]);
const kacheln = new Map(), statistik = {};
let fehlend = 0, punkte = 0;
for (const [id, w] of gefunden) {
  const roh = [];
  for (const r of w.refs) { const i = suche(r); if (i < 0 || Number.isNaN(lat[i])) { fehlend++; continue; } roh.push([lat[i], lon[i]]); }
  if (roh.length < 2 || !roh.some(imBereich)) continue;
  const st = statistik[w.klasse] ??= { km: 0, mit: 0 }, km = strecke(roh) / 1000;
  st.km += km; if ((w.f ?? -2) !== -2 || (w.b ?? -2) !== -2) st.mit += km;
  teilen(id, w.f, w.b, roh, (k, eintrag) => {
    if (!kacheln.has(k)) kacheln.set(k, []);
    kacheln.get(k).push(eintrag); punkte += eintrag[3].length / 2;
  });
}

mkdirSync(ZIEL, { recursive: true });
for (const f of readdirSync(ZIEL)) if (f.endsWith('.json')) rmSync(new URL(f, ZIEL));
const index = {
  quelle: '© OpenStreetMap-Mitwirkende (ODbL), Auszug von Geofabrik',
  stand: staende.filter(Boolean).map(d => d.toISOString().slice(0, 10)).sort()[0] ?? new Date().toISOString().slice(0, 10),
  kachelGrad: 0.1, kacheln: {},
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
