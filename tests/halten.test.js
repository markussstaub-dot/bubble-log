// Langer Druck zum Beenden (SPEC-usability.md, US4): kurzes Tippen beendet nichts.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { langerDruck, HALTEN_MS } from '../src/halten.js';

function knopf() {
  const l = {}, klassen = new Set();
  return {
    addEventListener: (ev, fn) => (l[ev] ||= []).push(fn),
    feuern: (ev, e = {}) => (l[ev] || []).forEach(fn => fn({ type: ev, button: 0, ...e })),
    classList: { add: k => klassen.add(k), remove: k => klassen.delete(k) }, klassen,
    style: { setProperty() {} },
  };
}

test('US4: kurzes Tippen (200 ms) beendet nichts', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const k = knopf(); let n = 0; langerDruck(k, () => n++);
  k.feuern('pointerdown'); mock.timers.tick(200); k.feuern('pointerup'); mock.timers.tick(5000);
  assert.equal(n, 0); assert.ok(!k.klassen.has('haelt'));
  mock.timers.reset();
});

test('US4: ≈ 1 s halten beendet genau einmal, Ring läuft solange', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const k = knopf(); let n = 0; langerDruck(k, () => n++);
  k.feuern('pointerdown'); assert.ok(k.klassen.has('haelt'));
  mock.timers.tick(HALTEN_MS - 1); assert.equal(n, 0);
  mock.timers.tick(1); assert.equal(n, 1); assert.ok(!k.klassen.has('haelt'));
  k.feuern('pointerup'); mock.timers.tick(5000); assert.equal(n, 1);
  mock.timers.reset();
});

test('US4: Finger rutscht ab (Handy zurechtrücken) bricht ab', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const k = knopf(); let n = 0; langerDruck(k, () => n++);
  for (const ev of ['pointerleave', 'pointercancel']) { k.feuern('pointerdown'); mock.timers.tick(900); k.feuern(ev); mock.timers.tick(2000); }
  assert.equal(n, 0);
  mock.timers.reset();
});

test('Tastatur: Enter halten wie Finger, andere Tasten nichts', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const k = knopf(); let n = 0; langerDruck(k, () => n++);
  k.feuern('keydown', { key: 'a' }); mock.timers.tick(2000); assert.equal(n, 0);
  k.feuern('keydown', { key: 'Enter' }); mock.timers.tick(300); k.feuern('keyup'); mock.timers.tick(2000); assert.equal(n, 0);
  k.feuern('keydown', { key: 'Enter' }); mock.timers.tick(HALTEN_MS); assert.equal(n, 1);
  mock.timers.reset();
});
