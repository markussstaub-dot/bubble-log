// Visuelles Logbuch: Unschärfe um private Orte und Kennzahlen einer Tagestour
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unscharf, kreisMitte, tagestour } from '../src/logbuch.js';
import { distanz } from '../src/erkennung.js';

const ZUHAUSE = [49.35, 7.25];
const linie = Array.from({ length: 21 }, (_, i) => [49.35, 7.25 + i * 0.001]);   // ca. 73 m je Schritt nach Osten

test('Unschärfe schneidet den Anfang um Zuhause ab', () => {
  const a = unscharf(linie, [ZUHAUSE], 400);
  assert.equal(a.length, 1);
  assert.ok(a[0].every(p => distanz(ZUHAUSE, p) >= 400));
  assert.ok(a[0].length < linie.length);
});

test('Unschärfe in der Mitte teilt die Fahrt in zwei Abschnitte', () => {
  const a = unscharf(linie, [linie[10]], 200);
  assert.equal(a.length, 2);
});

test('ohne Radius bleibt alles sichtbar', () => {
  assert.deepEqual(unscharf(linie, [ZUHAUSE], 0), [linie]);
});

test('Kreismitte ist versetzt, aber höchstens 35 % des Radius', () => {
  const m = kreisMitte(ZUHAUSE, 400), d = distanz(ZUHAUSE, m);
  assert.ok(d >= 400 * 0.19 && d <= 400 * 0.36, `Versatz ${d}`);
  assert.deepEqual(kreisMitte(ZUHAUSE, 400), m);   // immer gleich
});

test('Tagestour: Verbrauch, Ladesprung und Kennzahlen', () => {
  const t = tagestour([
    { t0: 3, t1: 4, km: 9.9, start: 47, ende: 33, hm: 120 },
    { t0: 1, t1: 2, km: 5.7, start: 30, ende: 22, hm: 80, kalt: true, nachtMin: -2 },
  ]);
  assert.equal(t.km, 15.6);
  assert.equal(t.verbraucht, 22);
  assert.equal(t.geladen, 25);
  assert.equal(t.hm, 200);
  assert.ok(t.kalt);
  assert.deepEqual(t.verlauf.map(v => v.art), ['start', 'fahrt', 'laden', 'fahrt']);
});
