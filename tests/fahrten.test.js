// Echte (und Sim-)Fahrten: jede tests/fahrten/NAME.jsonl wird abgespielt und gegen NAME.erwartet.json geprüft.
// Format: { "fahrten": [{ "start": "HH:MM:SS", "ende": "HH:MM:SS", "toleranz_s": 60, "km": 3.2 }] }, Leerfahrt: "fahrten": [].
// Optional "geoeffnet": "HH:MM:SS": die App wurde danach geöffnet, ohne dass es im Log steht (Wächter, SPEC-gps-abbruch.md).
// Ohne Erwartungsdatei wird der Fall übersprungen und das Replay-Ergebnis angezeigt (Vorlage: node tools/replay.mjs DATEI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spieleAb, pruefe, leseLog } from '../src/replay.js';

const uhrAm = (ms, hhmmss) => { const [h, m, s = 0] = hhmmss.split(':').map(Number); const d = new Date(ms); d.setHours(h, m, s, 0); return +d; };

const ORDNER = new URL('./fahrten/', import.meta.url);
const logs = existsSync(ORDNER) ? readdirSync(ORDNER).filter(n => n.endsWith('.jsonl')).sort() : [];

if (!logs.length) test('tests/fahrten/ ist leer', { skip: 'noch keine Logs' }, () => {});
for (const name of logs) {
  const erwartetDatei = new URL(name.replace(/\.jsonl$/, '.erwartet.json'), ORDNER);
  const ergebnis = (erwartet = {}) => {
    const zeilen = leseLog(readFileSync(new URL(name, ORDNER), 'utf8'));
    return spieleAb(zeilen, { geoeffnet: erwartet.geoeffnet ? uhrAm(zeilen[0].t, erwartet.geoeffnet) : [] });
  };
  if (!existsSync(erwartetDatei)) {
    const f = ergebnis().fahrten.map(f => `${f.startUhr}–${f.endeUhr} ${f.km} km`).join(', ') || 'keine Fahrt';
    test(name, { skip: `keine Erwartungsdatei; erkannt: ${f}` }, () => {});
    continue;
  }
  test(name, () => {
    const erwartet = JSON.parse(readFileSync(erwartetDatei, 'utf8'));
    assert.deepEqual(pruefe(ergebnis(erwartet), erwartet), []);
  });
}
