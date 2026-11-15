// Notizen (src/notizbuch.js): Format, Zuordnung zur Fahrt über die Zeit, Ort, CSV-Spalte
import test from 'node:test';
import assert from 'node:assert/strict';
import { notizAus, fahrtFuer, notizenDerFahrt, notizenDesTages, ortVon, csvFeld, VOR_START, NACH_ENDE, TEXT_MAX } from '../src/notizbuch.js';
import { csvText } from '../src/export.js';

const MIN = 60e3, T = Date.UTC(2026, 10, 15, 8, 0);
const a = { id: 'fA', tag: '15.11.', t0: T, t1: T + 20 * MIN, punkte: [[49, 7], [49.01, 7.01], [49.02, 7.02]] };
const b = { id: 'fB', tag: '15.11.', t0: T + 25 * MIN, t1: T + 40 * MIN, punkte: [[49.1, 7.1], [49.2, 7.2]] };
const fahrten = [a, b];

test('Notiz aus Rohdaten: Text, Zeit, Quelle, Ort nur wenn frisch', () => {
  const ort = { lat: 49.5, lon: 7.5, t: T };
  assert.deepEqual(notizAus({ text: '  Schild falsch ', quelle: 'teilen' }, { jetzt: T, ort }),
    { t: T, quelle: 'teilen', art: 'text', text: 'Schild falsch', lat: 49.5, lon: 7.5 });
  assert.equal(notizAus({ text: '' }), null, 'ohne Text keine Notiz');
  assert.equal(notizAus({ knopf: 2, t: T }).text, 'Knopf 2', 'Knopf der Sticky-App ohne Text');
  assert.equal(notizAus({ text: 'alt', t: T - 30 * MIN }, { jetzt: T, ort }).lat, undefined, 'alte Sticky-Notiz bekommt nicht den Ort von jetzt');
  assert.deepEqual([notizAus({ text: 'x', lat: 1, lon: 2 }, { ort }).lat, notizAus({ text: 'x', lat: 1, lon: 2 }, { ort }).lon], [1, 2], 'eigener Ort gewinnt');
  assert.equal(notizAus({ text: 'x'.repeat(5000) }).text.length, TEXT_MAX);
});

test('Zuordnung: während der Fahrt, kurz davor, kurz danach, sonst keine', () => {
  assert.equal(fahrtFuer(T + 5 * MIN, fahrten), 'fA');
  assert.equal(fahrtFuer(T - VOR_START + 1, fahrten), 'fA', 'beim Einsteigen');
  assert.equal(fahrtFuer(T - VOR_START - 1, fahrten), null);
  assert.equal(fahrtFuer(a.t1 + 2 * MIN, fahrten), 'fA', 'nach dem Abstellen, näher an A');
  assert.equal(fahrtFuer(b.t0 - MIN, fahrten), 'fB', 'kurz vor B ist näher an B als an A');
  assert.equal(fahrtFuer(b.t1 + NACH_ENDE + 1, fahrten), null);
  assert.equal(fahrtFuer(T + 30 * MIN, fahrten), 'fB', 'in B, auch wenn A noch im Nachlauf wäre');
});

test('Notizen der Fahrt und des Tages, eigene fahrtId gewinnt', () => {
  const n1 = { t: T + 5 * MIN, text: 'eins' }, n2 = { t: T + 30 * MIN, text: 'zwei' }, n3 = { t: T + 6 * MIN, text: 'drei', fahrtId: 'fB' };
  const alle = [n2, n1, n3];
  assert.deepEqual(notizenDerFahrt(a, alle, fahrten).map(n => n.text), ['eins']);
  assert.deepEqual(notizenDerFahrt(b, alle, fahrten).map(n => n.text), ['drei', 'zwei'], 'nach Zeit sortiert');
  assert.equal(notizenDesTages('15.11.', alle, () => '15.11.').length, 3);
});

test('Ort: eigener, sonst anteilig entlang der Fahrt', () => {
  assert.deepEqual(ortVon({ t: T, lat: 1, lon: 2 }, a), [1, 2, false]);
  assert.deepEqual(ortVon({ t: T + 10 * MIN }, a), [49.01, 7.01, true], 'Mitte der Fahrt');
  assert.deepEqual(ortVon({ t: a.t1 + 5 * MIN }, a), [49.02, 7.02, true], 'nach dem Ende: Abstellort');
  assert.equal(ortVon({ t: T }, null), null);
});

test('CSV: Spalte Notizen hinten, Semikolon und Anführungszeichen sicher', () => {
  const uhr = t => new Date(t).toISOString().slice(11, 16);
  assert.equal(csvFeld([], uhr), '');
  assert.equal(csvFeld([{ t: T, text: 'Stau' }, { t: T + MIN, text: 'Schild\nfalsch' }], uhr), '08:00 Stau | 08:01 Schild falsch');
  assert.equal(csvFeld([{ t: T, text: 'a; "b"' }], uhr), '"08:00 a; ""b"""');
  const f = { ...a, von: '09:00', nach: '09:20', km: 3.2, start: 80, ende: 76, zweck: 'Privat' };
  const zeilen = csvText([f], { notizen: [{ t: T + MIN, text: 'Stau' }] }).split('\r\n');
  assert.match(zeilen[0], /;Notizen$/);
  assert.match(zeilen[1], / Stau$/);
  assert.equal(zeilen[0].split(';').length, zeilen[1].split(';').length, 'gleich viele Spalten');
  assert.match(csvText([f], { fotos: true }).split('\r\n')[0], /;Foto Start;Foto Ende;Notizen$/);
});
