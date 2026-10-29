// Fahrt nachtragen (src/nachtragen.js): Lücke erkennen, Ziel-Vorschläge, Strecke, Prüfung.
// Uhrzeiten wie bei der Testfahrt am 29.10.2026: Akku zuletzt 09:28, App zu ab 16:22, Akku-Eingabe 17:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spurZeile, spurAnhaengen, lueckeFinden, zielVorschlaege, strecke, pruefen, nachtragFahrt, alsEingabe, ausEingabe, LUECKE_MIN } from '../src/nachtragen.js';

const um = (h, m) => new Date(2026, 9, 29, h, m).getTime();
const spurAus = zeilen => { const s = []; for (const [typ, daten, t] of zeilen) spurAnhaengen(s, spurZeile(typ, daten, t)); return s; };

test('spurZeile: nur Sichtbarkeit und echte Bewegung', () => {
  assert.deepEqual(spurZeile('app', { sichtbar: false }, 1), { t: 1, e: 'verborgen' });
  assert.deepEqual(spurZeile('app', { start: true, offen: null }, 2), { t: 2, e: 'start' });
  assert.deepEqual(spurZeile('vibration', { ruhig: false, rau: 0.4 }, 3), { t: 3, e: 'bewegt' });
  assert.equal(spurZeile('vibration', { ruhig: true }, 4), null);
  assert.deepEqual(spurZeile('gps', { tempo: 0.2, tempoBerechnet: 8 }, 5), { t: 5, e: 'bewegt' });
  assert.equal(spurZeile('gps', { tempo: 9, verworfen: 'sprung' }, 6), null);
  assert.equal(spurZeile('gps', { tempo: 0.5 }, 7), null);
  assert.equal(spurZeile('app', { system: {} }, 8), null);
});

test('spurAnhaengen: höchstens ein „bewegt“ pro Minute, alte Einträge fallen weg', () => {
  const s = [];
  assert.ok(spurAnhaengen(s, { t: um(16, 30), e: 'bewegt' }));
  assert.ok(!spurAnhaengen(s, { t: um(16, 30) + 30e3, e: 'bewegt' }));
  assert.ok(spurAnhaengen(s, { t: um(16, 31) + 1, e: 'bewegt' }));
  spurAnhaengen(s, { t: um(16, 30) + 3 * 864e5, e: 'sichtbar' });
  assert.deepEqual(s.map(z => z.e), ['sichtbar']);
});

test('Testfahrt 29.10.: App zu 16:22–17:00 mit Bewegung → Lücke ab 16:22', () => {
  const spur = spurAus([
    ['app', { sichtbar: true }, um(9, 30)], ['app', { sichtbar: false }, um(16, 22)],
    ['gps', { tempoBerechnet: 9 }, um(16, 25)], ['vibration', { ruhig: false }, um(16, 40)],
    ['app', { sichtbar: true }, um(17, 0)],
  ]);
  assert.deepEqual(lueckeFinden(spur, { seit: um(9, 28), jetzt: um(17, 0) }), { von: um(16, 22), bis: um(17, 0), bewegt: true });
});

test('kurz weggeschaltet (unter 10 min) ist keine Lücke', () => {
  const spur = spurAus([['app', { sichtbar: false }, um(16, 22)], ['gps', { tempo: 9 }, um(16, 25)], ['app', { sichtbar: true }, um(16, 22) + LUECKE_MIN - 1000]]);
  assert.equal(lueckeFinden(spur, { seit: 0, jetzt: um(17, 0) }), null);
});

test('Lücke ohne Bewegung: vorgeschlagen, aber bewegt = false', () => {
  const spur = spurAus([['app', { sichtbar: false }, um(12, 0)], ['app', { sichtbar: true }, um(13, 0)]]);
  assert.deepEqual(lueckeFinden(spur, { seit: 0, jetzt: um(13, 5) }), { von: um(12, 0), bis: um(13, 0), bewegt: false });
});

test('jüngste Lücke mit Bewegung gewinnt vor einer späteren ohne', () => {
  const spur = spurAus([
    ['app', { sichtbar: false }, um(14, 0)], ['gps', { tempo: 9 }, um(14, 20)], ['app', { sichtbar: true }, um(14, 40)],
    ['app', { sichtbar: false }, um(15, 0)], ['app', { sichtbar: true }, um(16, 0)],
  ]);
  assert.equal(lueckeFinden(spur, { seit: 0, jetzt: um(16, 1) }).von, um(14, 0));
});

test('Lücke beginnt frühestens beim letzten Akkustand', () => {
  const spur = spurAus([['app', { sichtbar: false }, um(8, 0)], ['gps', { tempo: 9 }, um(9, 50)], ['app', { sichtbar: true }, um(10, 0)]]);
  assert.equal(lueckeFinden(spur, { seit: um(9, 28), jetzt: um(10, 0) }).von, um(9, 28));
  assert.equal(lueckeFinden(spur, { seit: um(10, 0), jetzt: um(10, 5) }), null);
});

test('App beendet ohne „verborgen“: Neustart schließt die Lücke ab dem letzten Eintrag', () => {
  const spur = spurAus([['app', { sichtbar: true }, um(16, 0)], ['gps', { tempo: 6 }, um(16, 20)], ['app', { start: true }, um(17, 0)]]);
  assert.deepEqual(lueckeFinden(spur, { seit: 0, jetzt: um(17, 0) }), { von: um(16, 20), bis: um(17, 0), bewegt: true });
});

test('zielVorschlaege: das Ziel, das den Verbrauch erklärt, kommt zuerst', () => {
  const ziele = [{ kurz: 'Homburg', km: 6 }, { kurz: 'Saarbrücken', km: 25 }, { kurz: 'Neunkirchen', km: 9 }];
  // 24 % bei 0,8 %/km ≈ 30 km, hin und zurück ≈ 15 km einfach → Neunkirchen (9) vor Homburg (6)
  assert.deepEqual(zielVorschlaege(ziele, { verbrauch: 24, proKm: 0.8 }).map(z => z.kurz), ['Neunkirchen', 'Homburg', 'Saarbrücken']);
  assert.equal(zielVorschlaege(ziele, { verbrauch: 20, proKm: 0.8, retour: false })[0].kurz, 'Saarbrücken');
  assert.deepEqual(zielVorschlaege(ziele, { verbrauch: 0, proKm: 0.8 }).map(z => z.kurz), ['Homburg', 'Neunkirchen', 'Saarbrücken']);
});

test('strecke: Ziel einfach oder hin und zurück, sonst km von Hand', () => {
  assert.equal(strecke({ quelle: 'ziel', zielKm: 7.34, retour: true }), 14.7);
  assert.equal(strecke({ quelle: 'ziel', zielKm: 7.34, retour: false }), 7.3);
  assert.equal(strecke({ quelle: 'ziel', zielKm: null }), null);
  assert.equal(strecke({ quelle: 'hand', handKm: '12,5' }), 12.5);
  assert.equal(strecke({ quelle: 'hand', handKm: '' }), null);
  assert.equal(strecke({ quelle: 'hand', handKm: '-3' }), null);
});

test('pruefen: Zeitraum, Akku und Strecke', () => {
  const ok = { t0: um(16, 22), t1: um(17, 0), start: 98, ende: 74, km: 14.7, jetzt: um(17, 0) };
  assert.equal(pruefen(ok), null);
  assert.match(pruefen({ ...ok, t1: ok.t0 }), /nach dem Beginn/);
  assert.match(pruefen({ ...ok, t1: um(18, 0) }), /Zukunft/);
  assert.match(pruefen({ ...ok, ende: 99 }), /voller/);
  assert.match(pruefen({ ...ok, km: null }), /km/);
  assert.match(pruefen({ ...ok, t0: NaN }), /Beginn/);
});

test('nachtragFahrt: Siegel, keine Spur, Quelle der Strecke', () => {
  const f = nachtragFahrt({ t0: um(16, 22), t1: um(17, 0), start: 98, ende: 74, km: 14.7, zweck: 'Privat', quelle: 'ziel', ziel: 'Homburg', retour: true, startQuelle: 'vorschlag', endeQuelle: 'drehrad' });
  assert.equal(f.id, 'n' + um(16, 22));
  assert.equal(f.tag, '29.10.');
  assert.equal(f.von, '16:22'); assert.equal(f.nach, '17:00');
  assert.equal(f.nachgetragen, true);
  assert.deepEqual(f.punkte, []);
  assert.equal(f.hm, undefined); assert.equal(f.temp, null);
  assert.deepEqual(f.strecke, { quelle: 'ziel', ziel: 'Homburg', retour: true });
  assert.deepEqual(nachtragFahrt({ t0: 1, t1: 2, km: 3, quelle: 'hand' }).strecke, { quelle: 'hand' });
});

test('alsEingabe/ausEingabe: Ortszeit hin und zurück', () => {
  assert.equal(alsEingabe(um(16, 22)), '2026-10-29T16:22');
  assert.equal(ausEingabe('2026-10-29T16:22'), um(16, 22));
  assert.ok(Number.isNaN(ausEingabe('')));
});
