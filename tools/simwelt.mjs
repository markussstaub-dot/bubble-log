// Endliche Sim-Welt für die 3D-Ansicht: Vektor-Kacheln (Zoom 14, OpenMapTiles-Schema) von OpenFreeMap rund um
// Bexbach herunterladen → public/simwelt/14/x/y.pbf und public/simwelt/welt.json. Die App liest nur diese Dateien,
// die 3D-Sim braucht dann kein Netz mehr.
// Aufruf: node tools/simwelt.mjs [Radius in Kacheln, Standard 2 → 5 × 5 Kacheln ≈ 8 × 8 km]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const MITTE = [49.3466, 7.2561];   // Bexbach
const Z = 14, RADIUS = Number(process.argv[2] ?? 2);
const kachelX = lon => Math.floor((lon + 180) / 360 * 2 ** Z);
const kachelY = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z); };

const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const vorlage = tilejson.tiles[0];
const cx = kachelX(MITTE[1]), cy = kachelY(MITTE[0]);
rmSync('public/simwelt', { recursive: true, force: true });
const kacheln = []; let bytes = 0;
for (let x = cx - RADIUS; x <= cx + RADIUS; x++) for (let y = cy - RADIUS; y <= cy + RADIUS; y++) {
  const r = await fetch(vorlage.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
  if (!r.ok) throw new Error(`Kachel ${x}/${y}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(`public/simwelt/${Z}/${x}`, { recursive: true });
  writeFileSync(`public/simwelt/${Z}/${x}/${y}.pbf`, buf);
  kacheln.push([x, y]); bytes += buf.length;
}
const stand = (vorlage.match(/planet\/(\d{8})/) || [])[1] || '';
writeFileSync('public/simwelt/welt.json', JSON.stringify({ zoom: Z, mitte: MITTE, stand, kacheln }));
console.log(`${kacheln.length} Kacheln, ${(bytes / 1e6).toFixed(2)} MB, Stand ${stand}`);
