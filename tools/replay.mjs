// Log abspielen und anzeigen: node tools/replay.mjs DATEI.jsonl [STOPP_DAUER=120000 …] [RUHE_TAKT=30000]
// RUHE_TAKT: Sparmodus beim Warten nachstellen (SPEC-akku.md), ohne Kandidat nur ein Punkt je so viele ms.
// Zeigt, was die Erkennung heute entscheidet, darunter was das Handy damals geloggt hat, und eine Vorlage für *.erwartet.json.
import { readFileSync } from 'node:fs';
import { spieleAb } from '../src/replay.js';

const [datei, ...rest] = process.argv.slice(2);
if (!datei) { console.log('Aufruf: node tools/replay.mjs DATEI.jsonl [SCHWELLE=WERT …]'); process.exit(1); }
const { RUHE_TAKT: ruheTakt = 0, ...schwellen } = Object.fromEntries(rest.map(a => a.split('=')).map(([k, v]) => [k, Number(v)]));
const r = spieleAb(readFileSync(datei, 'utf8'), { schwellen, ruheTakt });

console.log(`${r.punkte} GPS-Punkte, verworfen: ${r.verworfen.ungenau} ungenau, ${r.verworfen.sprung} Sprung${ruheTakt ? `, ${r.ausgeduennt} im Sparmodus weggelassen` : ''}`);
console.log('\nErkennung heute:');
for (const e of r.ereignisse) console.log(`  ${e.uhr}  ${e.typ.padEnd(18)} ${e.ort.map(x => x.toFixed(5)).join(', ')}${e.km != null ? `  ${e.km} km` : ''}`);
console.log('\nDamals geloggt:');
for (const d of r.damals) { const { t, uhr, typ, ...x } = d; console.log(`  ${uhr}  ${typ.padEnd(9)} ${JSON.stringify(x)}`); }
console.log('\nVorlage *.erwartet.json:');
console.log(JSON.stringify({ fahrten: r.fahrten.filter(f => f.start != null && f.ende != null).map(f => ({ start: f.startUhr, ende: f.endeUhr, toleranz_s: 60, km: f.km })) }, null, 2));
