// Akku-Schätzung während der Fahrt mit Grund (src/fahrtschaetzung.js, SPEC-usability.md US2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahrtSchaetzung, grundText, winterZuschlag } from '../src/fahrtschaetzung.js';

test('flach und warm: gelernter Verbrauch, Grund ist nur die Temperatur', () => {
  const s = fahrtSchaetzung({ start: 91, km: 16, proKm: 1.1, temp: 12 });
  assert.equal(s.soc, 73);
  assert.equal(grundText(s), '≈ 1,1 %/km · 12 °C');
});

test('kalt: Winterzuschlag steht im Grund und senkt den Akku', () => {
  const s = fahrtSchaetzung({ start: 69, km: 20, proKm: 1.1, temp: 3 });
  assert.equal(s.soc, 43);                        // 20 × 1,1 × 1,2 = 26,4
  assert.equal(grundText(s), '≈ 1,3 %/km · 3 °C, Winter +20 %');
});

test('Winterzuschlag in Stufen, ohne Temperatur keiner', () => {
  assert.deepEqual([15, 10, 9.9, 5, 4, 0, -0.1, -8, null].map(winterZuschlag), [0, 0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0]);
});

test('bergauf und bergab', () => {
  const auf = fahrtSchaetzung({ start: 80, km: 5, proKm: 1.1, temp: 10, steig: 1, hm: { auf: 80, ab: 10 } });
  assert.equal(auf.soc, 74);
  assert.match(grundText(auf), /≈ 1,3 %\/km · 10 °C · bergauf ↑ 80 Hm$/);
  const ab = fahrtSchaetzung({ start: 80, km: 5, proKm: 1.1, temp: 10, steig: 0, hm: { auf: 5, ab: 60 } });
  assert.match(grundText(ab), /bergab ↓ 60 Hm$/);
});

test('am Anfang der Fahrt und ohne Temperatur', () => {
  const s = fahrtSchaetzung({ start: 50, km: 0.1, proKm: 1.2, steig: 0.3 });
  assert.equal(grundText(s), '≈ 1,2 %/km · flach gerechnet');   // Steigung auf 100 m zählt noch nicht als Grund
  assert.equal(fahrtSchaetzung({ start: 2, km: 10, proKm: 1.1 }).soc, 0);
});
