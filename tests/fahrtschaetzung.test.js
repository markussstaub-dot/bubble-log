// Akku-Schätzung während der Fahrt mit Grund (src/fahrtschaetzung.js, SPEC-usability.md US2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahrtSchaetzung, grundText } from '../src/fahrtschaetzung.js';

test('flach und warm: gelernter Verbrauch, Grund ist nur die Temperatur', () => {
  const s = fahrtSchaetzung({ start: 91, km: 16, proKm: 1.1, temp: 8, kaltZuschlag: 0.3 });
  assert.equal(s.soc, 73);
  assert.equal(grundText(s), '≈ 1,1 %/km · 8 °C');
});

test('kalt: Zuschlag steht im Grund und senkt den Akku', () => {
  const s = fahrtSchaetzung({ start: 69, km: 20, proKm: 1.1, temp: 3, kaltZuschlag: 0.3 });
  assert.equal(s.soc, 40);                        // 20 × 1,1 × 1,3 = 28,6
  assert.equal(grundText(s), '≈ 1,4 %/km · 3 °C, Kälte +30 %');
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
