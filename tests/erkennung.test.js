// Synthetische Grundfälle für die Fahrterkennung (src/erkennung.js über src/replay.js).
// Ein Punkt pro Sekunde, Strecke geradeaus nach Osten. Uhrzeiten ab 12:00:00, siehe tests/hilfe.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahrplan } from './hilfe.js';
import { spieleAb, pruefe } from '../src/replay.js';

const fahrten = plan => spieleAb(fahrplan(plan)).fahrten;
const typen = r => r.ereignisse.map(e => e.typ);
const passt = (plan, erwartet) => assert.deepEqual(pruefe(spieleAb(fahrplan(plan)), { tag: '2026-10-28', ...erwartet }), []);

test('Stadtfahrt mit Ampelstopps unter 3 min bleibt eine Fahrt', () => {
  passt([{ s: 30, v: 0 }, { s: 120, v: 10 }, { s: 90, v: 0 }, { s: 120, v: 12 }, { s: 170, v: 0 }, { s: 60, v: 8 }, { s: 300, v: 0 }],
    { fahrten: [{ start: '12:00:30', ende: '12:09:50', toleranz_s: 10, km: 3.12, km_toleranz: 0.05 }] });
});

test('Parken über 3 min beendet die Fahrt, Weiterfahren startet eine neue', () => {
  passt([{ s: 120, v: 10 }, { s: 300, v: 0 }, { s: 120, v: 10 }, { s: 240, v: 0 }],
    { fahrten: [{ start: '12:00:00', ende: '12:02:00', toleranz_s: 10, km: 1.2 }, { start: '12:07:00', ende: '12:09:00', toleranz_s: 10, km: 1.2 }] });
});

test('Fahrt läuft am Log-Ende noch: ende bleibt leer', () => {
  const f = fahrten([{ s: 120, v: 10 }]);
  assert.equal(f.length, 1);
  assert.equal(f[0].ende, null);
});

test('einzelner GPS-Sprung wird verworfen, Strecke bleibt richtig', () => {
  const r = spieleAb(fahrplan([{ s: 120, v: 10 }, { sprung: 2000, v: 10 }, { s: 60, v: 10 }, { s: 240, v: 0 }]));
  assert.equal(r.verworfen.sprung, 1);
  assert.ok(!typen(r).includes('neu aufgesetzt'));
  assert.equal(r.fahrten.length, 1);
  assert.ok(Math.abs(r.fahrten[0].km - 1.83) < 0.1, `km ${r.fahrten[0].km}`);
});

test('drei Sprünge in Folge: Erkennung setzt neu auf, Fahrt läuft weiter', () => {
  const r = spieleAb(fahrplan([{ s: 120, v: 10 }, { sprung: 3000, v: 10, n: 3 }, { s: 60, v: 10 }, { s: 240, v: 0 }]));
  assert.ok(typen(r).includes('neu aufgesetzt'));
  assert.equal(r.fahrten.length, 1);
});

test('Gehtempo startet keine Fahrt', () => {
  const r = spieleAb(fahrplan([{ s: 900, v: 1.4 }]));
  assert.deepEqual(r.fahrten, []);
  assert.ok(!typen(r).includes('kandidat'));
});

test('kurzer schneller Schub (10 s) wird Kandidat und wieder verworfen', () => {
  const r = spieleAb(fahrplan([{ s: 10, v: 5 }, { s: 90, v: 0 }]));
  assert.deepEqual(r.fahrten, []);
  assert.deepEqual(typen(r), ['kandidat', 'kandidat verworfen']);
});

test('Funkloch während der Fahrt (200 s ohne Punkte) beendet die Fahrt nicht', () => {
  passt([{ s: 120, v: 10 }, { s: 200, v: 10, luecke: true }, { s: 60, v: 10 }, { s: 240, v: 0 }],
    { fahrten: [{ start: '12:00:00', ende: '12:06:20', toleranz_s: 10, km: 3.8 }] });
});

test('ungenaue Punkte (±60 m) werden verworfen und starten keine Fahrt', () => {
  const r = spieleAb(fahrplan([{ s: 300, v: 10, gen: 60 }]));
  assert.deepEqual(r.fahrten, []);
  assert.equal(r.verworfen.ungenau, 300);
});

test('jeder zweite Punkt ungenau: Fahrt wird trotzdem erkannt', () => {
  const plan = [];
  for (let i = 0; i < 60; i++) plan.push({ s: 1, v: 10 }, { s: 1, v: 10, gen: 60 });
  plan.push({ s: 240, v: 0 });
  passt(plan, { fahrten: [{ start: '12:00:00', ende: '12:02:00', toleranz_s: 10, km: 1.2 }] });
});

test('Schwellen lassen sich pro Aufruf überschreiben', () => {
  const plan = fahrplan([{ s: 120, v: 10 }, { s: 150, v: 0 }, { s: 120, v: 10 }, { s: 240, v: 0 }]);
  assert.equal(spieleAb(plan).fahrten.length, 1);
  assert.equal(spieleAb(plan, { schwellen: { STOPP_DAUER: 120000 } }).fahrten.length, 2);
});

test('Simulator an/aus im Log: Erkennung beginnt frisch, offene Fahrt gilt als abgebrochen', () => {
  const a = fahrplan([{ s: 120, v: 10 }]), b = fahrplan([{ s: 120, v: 10 }, { s: 240, v: 0 }], { t0: a.at(-1).t + 1000 });
  const r = spieleAb([...a, { t: a.at(-1).t + 500, typ: 'sim', an: true }, ...b]);
  assert.equal(r.fahrten.length, 2);
  assert.equal(r.fahrten[0].abgebrochen, true);
  assert.equal(r.damals[0].typ, 'sim');
});

// Befunde: so verhält sich die Erkennung heute, gewünscht wäre es anders. Laufen als todo (rot, aber kein Fehler).
test('GPS-Fehler über 3 Punkte stabil: der Umweg zählt nicht in die km', () => {
  const f = fahrten([{ s: 120, v: 10 }, { sprung: 3000, v: 10, n: 3 }, { s: 60, v: 10 }, { s: 240, v: 0 }]);
  assert.ok(Math.abs(f[0].km - 1.83) < 0.2, `km ${f[0].km}`);
});

test('Befund: Ampel von 178 s beendet die Fahrt schon (Stillstand zählt ab bis zu 40 m vor dem Halt)', { todo: 'effektiv ≈ 175 s statt 180 s' }, () => {
  assert.equal(fahrten([{ s: 120, v: 10 }, { s: 178, v: 0 }, { s: 120, v: 10 }, { s: 240, v: 0 }]).length, 1);
});

test('Parken ohne GPS (Tiefgarage) mit ungenauem erstem Fix danach: zwei getrennte Fahrten', () => {
  assert.equal(fahrten([{ s: 120, v: 10 }, { s: 1200, v: 0, luecke: true }, { s: 10, v: 10, gen: 60 }, { s: 120, v: 10 }, { s: 240, v: 0 }]).length, 2);
});
