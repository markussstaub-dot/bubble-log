import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ortVorschlag } from '../src/ladeort.js';

// Grob: 1° Breite ≈ 111 km, 1° Länge ≈ 72 km bei 49° N
const nahe = (a, b, m) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 72000) < m;
const ZUHAUSE = [49.3471, 7.2506], MAMI = [49.3636, 7.1800];
const liste = ['Zuhause', 'Mami', 'Bei Freunden', 'Arbeit', 'Öffentlich'];
const basis = { gewaehlt: null, liste, zuhause: ZUHAUSE, eigene: [], nahe };

test('zu Hause: Zuhause', () => assert.equal(ortVorschlag({ ...basis, hier: [49.3472, 7.2507] }), 'Zuhause'));
test('09.11. bei Mami, noch kein eigener Ladeort: kein Vorschlag statt Zuhause', () =>
  assert.equal(ortVorschlag({ ...basis, hier: MAMI }), ''));
test('bei Mami als eigenem Ladeort: Mami', () =>
  assert.equal(ortVorschlag({ ...basis, hier: MAMI, eigene: [{ name: 'Mami', p: MAMI }] }), 'Mami'));
test('eigene Wahl gewinnt', () => assert.equal(ortVorschlag({ ...basis, hier: MAMI, gewaehlt: 'Öffentlich' }), 'Öffentlich'));
test('ohne Standort oder ohne Zuhause: Zuhause wie bisher', () => {
  assert.equal(ortVorschlag({ ...basis, hier: null }), 'Zuhause');
  assert.equal(ortVorschlag({ ...basis, hier: MAMI, zuhause: null }), 'Zuhause');
});

import { nachfragen } from '../src/ladeort.js';
const T = 1794235040161;
test('09.11. zweites Speichern 1,6 s nach dem Drehrad: nachfragen', () =>
  assert.equal(nachfragen({ letzter: { id: 'l' + T }, jetzt: T + 1600 }), true));
test('zweiter Tipp kurz danach bestätigt', () =>
  assert.equal(nachfragen({ letzter: { id: 'l' + T }, jetzt: T + 5000, bestaetigtUm: T + 1600 }), false));
test('alte Bestätigung zählt nicht', () =>
  assert.equal(nachfragen({ letzter: { id: 'l' + T }, jetzt: T + 40000, bestaetigtUm: T + 1600 }), true));
test('letztes Laden länger her oder keins: speichern', () => {
  assert.equal(nachfragen({ letzter: { id: 'l' + T }, jetzt: T + 61000 }), false);
  assert.equal(nachfragen({ letzter: undefined, jetzt: T }), false);
});
