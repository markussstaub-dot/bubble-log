// Herkunft der Akkuwerte (src/herkunft.js): Vorschlag, Drehrad, Foto; nur bestätigte Schätzungen zählen nicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { herkunft, nurSchaetzung } from '../src/herkunft.js';

test('unverändert bestätigter Vorschlag', () => {
  assert.equal(herkunft({ wert: 62, vorschlag: 62 }), 'vorschlag');
});

test('am Drehrad verändert oder bewusst angefasst', () => {
  assert.equal(herkunft({ wert: 58, vorschlag: 62 }), 'drehrad');
  assert.equal(herkunft({ wert: 62, vorschlag: 62, beruehrt: true }), 'drehrad');
});

test('Foto erkannt und so bestätigt, auch wenn es zufällig dem Vorschlag entspricht', () => {
  assert.equal(herkunft({ wert: 37, vorschlag: 62, foto: 37 }), 'foto');
  assert.equal(herkunft({ wert: 62, vorschlag: 62, foto: 62 }), 'foto');
});

test('Foto erkannt, danach am Drehrad korrigiert', () => {
  assert.equal(herkunft({ wert: 38, vorschlag: 62, foto: 37, beruehrt: true }), 'drehrad');
});

test('nur der Endwert entscheidet, ob eine Fahrt bloß die Schätzung bestätigt', () => {
  assert.equal(nurSchaetzung({ startQuelle: 'drehrad', endeQuelle: 'vorschlag' }), true);
  assert.equal(nurSchaetzung({ startQuelle: 'vorschlag', endeQuelle: 'drehrad' }), false);
  assert.equal(nurSchaetzung({ startQuelle: 'foto', endeQuelle: 'foto' }), false);
  assert.equal(nurSchaetzung({ start: 80, ende: 70 }), false, 'alte Fahrten ohne Herkunft zählen weiter');
});
