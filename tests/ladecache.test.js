// Ladesäulen um das Zuhause: welche 1°-Kacheln ein Umkreis berührt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kachelnUm } from '../src/ladecache.js';

test('120 km um Bexbach berühren die Kacheln rund um 49/7', () => {
  const k = kachelnUm([49.3466, 7.2561], 120);
  for (const muss of ['49_7', '48_6', '50_8', '49_5']) assert.ok(k.includes(muss), muss);
  assert.ok(!k.includes('51_7'));
});

test('kleiner Umkreis mitten in einer Kachel: nur diese Kachel', () => {
  assert.deepEqual(kachelnUm([53.5, 10.5], 10), ['53_10']);
});
