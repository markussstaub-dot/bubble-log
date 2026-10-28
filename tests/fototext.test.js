// Akkustand und Kilometerstand aus dem erkannten Text des Tacho-Displays (src/fototext.js).
// Texte nach den Fotos beider Ansichten vom 28.10.2026, 19:16 (SPEC-foto.md), in der Art, wie ML Kit Blöcke ausgibt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leseDisplay, socPlausibel, textAusDateiname } from '../src/fototext.js';

const RUNDINSTRUMENTE = ['0', 'km/h', 'R N D', 'trip km', '0790,5', '100%', 'total km', '007973', '19:16', '28.10.2026'].join('\n');
const STRASSE = ['19:16', '28.10.2026', '99 %', '00', 'km/h', 'D', 'trip km 0790,5', 'total km'].join('\n');

test('Rundinstrumente: 100% und Kilometerstand', () => {
  assert.deepEqual(leseDisplay(RUNDINSTRUMENTE), { soc: 100, km: 7973, kandidaten: [100] });
});

test('Straße: 99 % mit Leerzeichen, kein Kilometerstand (leere Kästchen)', () => {
  const r = leseDisplay(STRASSE);
  assert.equal(r.soc, 99);
  assert.equal(r.km, null);
});

test('Ziffern-Kästchen mit Leerzeichen und O statt 0', () => {
  assert.equal(leseDisplay('total km\n0 0 7 9 7 3').km, 7973);
  assert.equal(leseDisplay('total km OO7973').km, 7973);
});

test('Prozentzeichen in eigener Zeile wird noch zugeordnet', () => {
  assert.equal(leseDisplay('19:16\n48\n%\n0790,5').soc, 48);
});

test('Uhrzeit, Datum, Tempo und trip km zählen nie als Akkustand', () => {
  assert.equal(leseDisplay('19:16 28.10.2026 00 km/h 0790,5').soc, null);
  assert.equal(leseDisplay('12:45%').soc, null);       // Doppelpunkt davor: Uhrzeit
  assert.equal(leseDisplay('0790,5%').soc, null);      // Komma davor: Kommazahl
  assert.equal(leseDisplay('28.10.%').soc, null);
});

test('mehrere verschiedene Prozentzahlen: nicht eindeutig', () => {
  const r = leseDisplay('48 % 12 %');
  assert.equal(r.soc, null);
  assert.deepEqual(r.kandidaten, [48, 12]);
  assert.equal(leseDisplay('48 % … 48%').soc, 48);    // dieselbe Zahl doppelt ist eindeutig
});

test('über 100 und leerer Text', () => {
  assert.equal(leseDisplay('250 %').soc, null);
  assert.deepEqual(leseDisplay(''), { soc: null, km: null, kandidaten: [] });
  assert.equal(leseDisplay().soc, null);
});

test('Plausibilität: Ende höchstens 1 Punkt über dem Start', () => {
  assert.equal(socPlausibel(80), true);
  assert.equal(socPlausibel(null), false);
  assert.equal(socPlausibel(101), false);
  assert.equal(socPlausibel(100, { start: 99 }), true);   // Rundung der Ansichten
  assert.equal(socPlausibel(85, { start: 80 }), false);
  assert.equal(socPlausibel(0, { start: 80 }), true);
});

test('Browser-Platzhalter: Zahl aus dem Dateinamen', () => {
  assert.equal(leseDisplay(textAusDateiname('akku-48.jpg')).soc, 48);
  assert.deepEqual(leseDisplay(textAusDateiname('akku-100-km-007973.jpg')), { soc: 100, km: 7973, kandidaten: [100] });
  assert.equal(leseDisplay(textAusDateiname('IMG_2026.jpg')).soc, null);
});
