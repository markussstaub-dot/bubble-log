// Physik des Akku-Drehrads (src/scrollrad.js): rastet ein, bleibt im Bereich, dreht auf Zielwerte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RadPhysik } from '../src/scrollrad.js';

test('Schwung kommt auf einer ganzen Zahl zur Ruhe', () => {
  const ph = new RadPhysik(101, 20);
  ph.vel = 17;
  ph.laufen(4);
  assert.ok(ph.ruht);
  assert.ok(Math.abs(ph.pos - Math.round(ph.pos)) < 0.01, `pos ${ph.pos}`);
  assert.ok(ph.pos > 21, 'Schwung trägt über mehrere Werte');
  assert.ok(ph.ereignisse.filter(e => e.typ === 'rast').length >= 2);
});

test('Gummi-Anschlag hält das Rad im Bereich', () => {
  for (const [start, v] of [[2, -200], [98, 200]]) {
    const ph = new RadPhysik(101, start);
    ph.vel = v;
    ph.laufen(4);
    assert.ok(ph.index === 0 || ph.index === 100, `index ${ph.index}`);
    assert.ok(ph.pos > -0.05 && ph.pos < 100.05, `pos ${ph.pos}`);
    assert.ok(ph.ereignisse.some(e => e.typ === 'anschlag'));
  }
});

test('dreheZu stellt den Wert ein, index meldet sofort das Ziel', () => {
  const ph = new RadPhysik(101, 100 - 80);    // 80 %
  ph.dreheZu(100 - 37);                       // Foto erkennt 37 %
  assert.equal(100 - ph.index, 37);
  ph.laufen(3);
  assert.equal(100 - ph.index, 37);
  assert.ok(ph.ruht);
});

test('Finger zieht das Rad und lässt es mit Schwung los', () => {
  const ph = new RadPhysik(101, 50);
  ph.finger = { ziel: 50, v: 0 };
  for (let i = 0; i < 10; i++) { ph.finger.ziel += 0.5; ph.finger.v = 30; ph.laufen(1 / 60); }
  ph.finger = null;
  ph.laufen(3);
  assert.ok(ph.index > 55, `index ${ph.index}`);
  assert.ok(ph.ruht);
});
