// Konsole (src/konsole.js): Filter und Zeilenformat
import test from 'node:test';
import assert from 'node:assert/strict';
import { passt, kurz } from '../src/konsole.js';

const gps = { t: 1, typ: 'gps', lat: 49.3, lon: 7.25, tempo: 3.2 };
const fahrt = { t: 2, typ: 'fahrt', km: 0.3, schritt: 'beginn' };
const notiz = { t: 3, typ: 'notiz', quelle: 'sticky', art: 'diktat', text: 'Schild zeigt 50, ist aber 30', sorte: 'fahrt' };
const fehler = { t: 4, typ: 'bordnetz', fehler: 'suchen', text: 'aus' };

test('Filter', () => {
  assert.equal(passt(gps, 'ohneGps'), false);
  assert.equal(passt(fahrt, 'ohneGps'), true);
  assert.equal(passt(notiz, 'notiz'), true);
  assert.equal(passt(fahrt, 'notiz'), false);
  assert.equal(passt(notiz, 'fahrt'), true, 'Notizen gehören zur Fahrt');
  assert.equal(passt(fehler, 'fehler'), true, 'Feld fehler zählt auch');
  assert.equal(passt(gps, 'alles'), true);
});

test('Suche ohne Groß/klein', () => {
  assert.equal(passt(notiz, 'alles', 'schild'), true);
  assert.equal(passt(fahrt, 'alles', 'schild'), false);
});

test('Zeile: wichtige Felder zuerst, Zahlen gekürzt, Länge begrenzt', () => {
  assert.equal(kurz(fahrt), 'schritt=beginn km=0.3');
  assert.match(kurz(notiz), /^text=Schild/);
  assert.equal(kurz({ t: 0, typ: 'x', v: 1 / 3 }), 'v=0.33333');
  assert.equal(kurz({ t: 0, typ: 'x', s: 'a'.repeat(500) }, 50).length, 50);
});
