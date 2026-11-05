// 12-V-Bordspannung (src/bordspannung.js): BM6-Antworten lesen, Minutenwerte, Bewertung, Beleg-Export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { SCHLUESSEL, BEFEHL, BEFEHL_VERSCHLUESSELT, antwortLesen, einrechnen, ruheStufe, fahrtBewerten, belegCsv, kurveSvg } from '../src/bordspannung.js';

const aes = (hex, art) => {
  const c = (art === 'ver' ? createCipheriv : createDecipheriv)('aes-128-cbc', Buffer.from(SCHLUESSEL), Buffer.alloc(16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(hex, 'hex')), c.final()]).toString('hex');
};
// Antwort wie vom BM6: 23 °C, 80 %, 11,95 V (Beispiel aus tarball.ca)
const ANTWORT = 'd15507' + '00' + '17' + '00' + '50' + '0' + '4ab' + '00000000000000';

test('Schlüssel und Befehl ergeben den bekannten verschlüsselten Befehl', () => {
  assert.equal(SCHLUESSEL.length, 16);
  assert.equal(aes(BEFEHL, 'ver'), BEFEHL_VERSCHLUESSELT);
});

test('Antwort entschlüsseln und lesen', () => {
  const verschluesselt = aes(ANTWORT, 'ver');
  assert.deepEqual(antwortLesen(aes(verschluesselt, 'ent')), { v: 11.95, temp: 23, soc: 80 });
});

test('negative Temperatur und fremde Antworten', () => {
  assert.equal(antwortLesen('d1550701' + '05' + ANTWORT.slice(10)).temp, -5);
  assert.equal(antwortLesen('d15505' + ANTWORT.slice(6)), null);
  assert.equal(antwortLesen(''), null);
});

test('Ancel BM200 (05.11.2026): Platzhalter nach dem Verbinden ist kein Messwert, die echte Antwort schon', () => {
  assert.equal(antwortLesen('d15507ff000000000000000000000000'), null);
  assert.deepEqual(antwortLesen('d15507001a010004ab00000000020000'), { v: 11.95, temp: 26, soc: 0 });
});

test('Minutenwerte: kleinster, Mittel, größter je Minute, auch über mehrere Abholungen', () => {
  const m = [], s = {}, t0 = Date.UTC(2026, 9, 30, 10, 0, 0);
  einrechnen(m, s, [[t0, 13.6], [t0 + 20000, 13.8]]);
  einrechnen(m, s, [[t0 + 40000, 13.7], [t0 + 61000, 13.0]]);
  assert.deepEqual(m, [[t0, 13.6, 13.7, 13.8], [t0 + 60000, 13, 13, 13]]);
});

test('Ruhewert: ok, beobachten, verdächtig', () => {
  assert.equal(ruheStufe(12.7), 'ok');
  assert.equal(ruheStufe(12.4), 'ok');
  assert.equal(ruheStufe(12.2), 'beobachten');
  assert.equal(ruheStufe(12.0), 'beobachten');
  assert.equal(ruheStufe(11.99), 'verdaechtig');
});

const fahrt = mittel => mittel.map((v, i) => [i * 60000, v - 0.1, v, v + 0.1]);

test('Fahrt gleichmäßig um 13,7 V ist ok, erste und letzte Minute zählen nicht', () => {
  const b = fahrtBewerten(fahrt([12.8, 13.7, 13.7, 13.6, 13.7, 12.9]));
  assert.equal(b.stufe, 'ok');
  assert.equal(b.mittel, 13.68);
});

test('Fahrt um 13 V oder stark schwankend ist verdächtig', () => {
  assert.equal(fahrtBewerten(fahrt([13.0, 13.0, 13.1, 13.0, 13.0])).stufe, 'verdaechtig');
  assert.equal(fahrtBewerten(fahrt([13.7, 13.9, 13.3, 13.8, 13.7])).stufe, 'verdaechtig');
  assert.equal(fahrtBewerten(fahrt([13.3, 13.3, 13.3, 13.3])).stufe, 'beobachten');
  assert.equal(fahrtBewerten([]), null);
});

test('Beleg: Zusammenfassung mit Startproblem und Wert davor, Zeilen nach Zeit', () => {
  const t = Date.UTC(2026, 9, 30, 9, 0, 0);
  const messungen = [
    { t, v: 12.3, anlass: 'ruhe', stufe: 'verdaechtig' },
    { t: t + 3600e3, v: 11.8, anlass: 'startproblem', stufe: 'verdaechtig', notiz: 'Aldi' },
  ];
  const fahrten = [{ von: '08:00', nach: '08:20', v12: { minuten: [[t - 600e3, 13.0, 13.1, 13.3]], bewertung: { stufe: 'verdaechtig' } } }];
  const csv = belegCsv(messungen, fahrten).split('\r\n');
  assert.match(csv[1], /^Fahrten mit Messung;1;davon verdächtig;1/);
  assert.match(csv[3], /^Startproblem .*;11,8 V;zuvor 12,3 V/);
  const daten = csv.slice(csv.findIndex(z => z.startsWith('Datum;')) + 1);
  assert.equal(daten.length, 3);
  assert.match(daten[0], /;13,1;13;13,3;;Fahrt 08:00–08:20;verdächtig;/);
  assert.match(daten[2], /;11,8;;;;Springt nicht an;verdächtig;Aldi$/);
});

test('Kurve nur mit Werten', () => {
  assert.equal(kurveSvg([]), '');
  assert.match(kurveSvg(fahrt([13.7, 13.6])), /^<svg/);
});
