// Tagesabschluss: Verteilen des Verbrauchs auf Fahrten zwischen bekannten Akkuständen
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verteilen } from '../src/tagesabschluss.js';

const h = x => x * 3600e3;

test('ein Abschnitt: Verbrauch nach Gewicht, letzte Fahrt endet genau beim Anker', () => {
  const r = verteilen([{ t0: h(1), t1: h(2) }, { t0: h(3), t1: h(4) }], [1, 3], [{ t: 0, soc: 50 }, { t: h(5), soc: 30 }]);
  assert.deepEqual(r, [{ start: 50, ende: 45 }, { start: 45, ende: 30 }]);
});

test('Laden zwischen zwei Fahrten: Start nach dem Laden als Anker trennt die Abschnitte', () => {
  // Brötchenfahrt der Mami-Runde: 33 → 22 bei Mami, geladen auf 47, zurück 33 (wie am 01.11.2026)
  const fahrten = [{ t0: h(14), t1: h(14.1) }, { t0: h(15.7), t1: h(15.9) }, { t0: h(17.1), t1: h(17.4) }];
  const r = verteilen(fahrten, [3, 8, 11], [{ t: h(13), soc: 33 }, { t: h(15.9), soc: 22 }, { t: h(17.1), soc: 47 }, { t: h(18), soc: 33 }]);
  assert.deepEqual(r, [{ start: 33, ende: 30 }, { start: 30, ende: 22 }, { start: 47, ende: 33 }]);
});

test('Akku gestiegen ohne Angabe zum Laden: Fehler statt erfundener Werte', () => {
  const r = verteilen([{ t0: h(1), t1: h(2) }], [1], [{ t: 0, soc: 20 }, { t: h(3), soc: 60 }]);
  assert.match(r[0].fehler, /geladen/);
});

test('Fahrt vor dem ersten bekannten Stand bleibt offen', () => {
  const r = verteilen([{ t0: h(1), t1: h(2) }, { t0: h(4), t1: h(5) }], [1, 1], [{ t: h(3), soc: 40 }, { t: h(6), soc: 30 }]);
  assert.ok(r[0].fehler);
  assert.deepEqual(r[1], { start: 40, ende: 30 });
});

test('ohne Gewichte gleichmäßig verteilt', () => {
  const r = verteilen([{ t0: h(1), t1: h(2) }, { t0: h(3), t1: h(4) }], [0, 0], [{ t: 0, soc: 40 }, { t: h(5), soc: 30 }]);
  assert.deepEqual(r, [{ start: 40, ende: 35 }, { start: 35, ende: 30 }]);
});
