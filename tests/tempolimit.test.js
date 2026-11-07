// Zuordnung GPS → Straße für das Tempolimit-Schild (src/tempolimit.js, SPEC-tempolimit.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setzeDaten, createZuordnung, treffer, kachelnUm } from '../src/tempolimit.js';

const LAT = 49.35, LON = 7.25, M_LAT = 1 / 111195, M_LON = M_LAT / Math.cos(LAT * Math.PI / 180);
const c = pts => { const out = []; let a0 = 0, b0 = 0; for (const [a, b] of pts) { const A = Math.round(a * 1e5), B = Math.round(b * 1e5); out.push(A - a0, B - b0); a0 = A; b0 = B; } return out; };
// Nord-Süd-Straße (vor 50, rück 30), 40 m östlich parallel eine 70er, quer bei +500 m eine 100er
setzeDaten({ w: [
  [1, 50, 30, c([[LAT, LON], [LAT + 1000 * M_LAT, LON]])],
  [2, 70, 70, c([[LAT, LON + 40 * M_LON], [LAT + 1000 * M_LAT, LON + 40 * M_LON]])],
  [3, 100, 100, c([[LAT + 500 * M_LAT, LON - 300 * M_LON], [LAT + 500 * M_LAT, LON + 300 * M_LON]])],
] });
const p = (nord, ost = 0) => [LAT + nord * M_LAT, LON + ost * M_LON];

function fahre(punkte) {
  const wechsel = [], z = createZuordnung({ onWechsel: (neu, vorher) => wechsel.push([neu, vorher]) });
  const verlauf = punkte.map(x => z.punkt(x));
  return { verlauf, wechsel, z };
}

test('Richtung entscheidet über vor/rück', () => {
  const nord = fahre([0, 1, 2, 3].map(i => p(100 + i * 14, 3)));
  assert.deepEqual(nord.verlauf, [undefined, undefined, 50, 50]);   // erster Fix = Anker, dann 2 gleiche
  const sued = fahre([0, 1, 2, 3].map(i => p(300 - i * 14, -3)));
  assert.equal(sued.verlauf.at(-1), 30);
});

test('Parallelstraße: nimmt die nähere', () => {
  assert.equal(fahre([0, 1, 2].map(i => p(100 + i * 14, 30))).verlauf.at(-1), 70);
  assert.equal(treffer(p(100, 12), 0).limit, 50);
});

test('Querstraße zählt nicht, Kreuzung lässt das Schild stehen', () => {
  const r = fahre([0, 1, 2, 3, 4, 5, 6].map(i => p(458 + i * 14, 0)));   // fährt über die 100er
  assert.ok(r.verlauf.slice(2).every(v => v === 50), JSON.stringify(r.verlauf));
  assert.equal(treffer(p(500, 0), 90).limit, 100);   // in Richtung der Querstraße
});

test('kein Treffer → „?“ erst nach 3 Fixes', () => {
  const r = fahre([...[0, 1, 2].map(i => p(100 + i * 14)), ...[0, 1, 2, 3].map(i => p(150 + i * 14, 200))]);
  // Sprung nach Osten: erster Fix danach hat schräge Richtung → kein Treffer, dann weiter nördlich ohne Straße
  assert.equal(r.verlauf[2], 50);
  assert.equal(r.verlauf.at(-1), null);
  assert.deepEqual(r.wechsel.at(-1), [null, 50]);
});

test('Stand an der Ampel ändert nichts', () => {
  const r = fahre([p(100), p(114), p(128), p(129), p(129.5), p(130)]);
  assert.deepEqual(r.verlauf.slice(2), [50, 50, 50, 50]);
});

test('Kacheln im Umkreis', () => {
  const k = kachelnUm([49.3466, 7.2561], 40);
  assert.ok(k.includes('493_72') && k.length > 50 && k.length < 90, k.length);
  assert.ok(!k.includes('489_67'));   // Ecke außerhalb des Kreises
});
