// Synthetische Grundfälle für die Fahrterkennung (src/erkennung.js über src/replay.js).
// Ein Punkt pro Sekunde, Strecke geradeaus nach Osten. Uhrzeiten ab 12:00:00, siehe tests/hilfe.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahrplan, BEXBACH, T0 } from './hilfe.js';
import { createErkennung, distanz, gpsStand, gpsAusfall, fahrtEnde, SCHWELLEN } from '../src/erkennung.js';
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

// Handy mit zum Bäcker (30.10.2026): bisher lag es bei den Testfahrten im Auto. Geparkt wird nach 1200 m bei 12:02:00,
// dann zu Fuß 80 m weiter in den Laden, 4 min drin, zurück und weiter.
const PARKEN = [BEXBACH[0], BEXBACH[1] + 1200 / (111320 * Math.cos(BEXBACH[0] * Math.PI / 180))];
const zumBaecker = drinnen => [{ s: 120, v: 10 }, { s: 15, v: 0 }, { s: 60, v: 1.33 }, ...drinnen, { s: 60, v: -1.33 }, { s: 15, v: 0 }, { s: 120, v: 10 }, { s: 240, v: 0 }];
const bisParkplatz = f => Math.round(distanz(f.nach, PARKEN));

test('Handy mit in den Laden: Fahrt endet am Auto, der Fußweg zählt nicht in die km', () => {
  const r = spieleAb(fahrplan(zumBaecker([{ s: 240, v: 0 }])));
  assert.deepEqual(pruefe(r, { tag: '2026-10-28', fahrten: [
    { start: '12:00:00', ende: '12:02:00', toleranz_s: 5, km: 1.2, km_toleranz: 0.02 },
    { start: '12:08:30', toleranz_s: 10, km: 1.2, km_toleranz: 0.05 },
  ] }), []);
  assert.ok(bisParkplatz(r.fahrten[0]) <= 10, `Ende ${bisParkplatz(r.fahrten[0])} m vom Auto`);
  assert.ok(distanz(r.fahrten[0].parkplatz, PARKEN) <= 25, `Parkplatz ${Math.round(distanz(r.fahrten[0].parkplatz, PARKEN))} m vom Auto`);
});

test('Handy mit in den Laden, GPS springt drinnen um 60 m: Fahrt endet trotzdem am Auto', () => {
  const drift = [];
  for (let i = 0; i < 4; i++) drift.push({ s: 40, v: 0, gen: 20 }, { sprung: 30, v: 0, n: 3, gen: 20 }, { sprung: 60, v: 0, n: 5, gen: 20 }, { sprung: 30, v: 0, n: 3, gen: 20 });
  const r = spieleAb(fahrplan(zumBaecker(drift)));
  assert.equal(r.fahrten.length, 2, r.fahrten.map(f => `${f.startUhr}–${f.endeUhr} ${f.km} km`).join(', '));
  assert.ok(bisParkplatz(r.fahrten[0]) <= 10, `Ende ${bisParkplatz(r.fahrten[0])} m vom Auto`);
  assert.ok(Math.abs(r.fahrten[0].km - 1.2) <= 0.02, `km ${r.fahrten[0].km}`);
});

test('Handy mit in den Laden nach langsamem Abbremsen: Fahrt endet trotzdem am Auto', () => {
  const r = spieleAb(fahrplan([{ s: 115, v: 10 }, { s: 3, v: 4 }, { s: 2, v: 1.5 }, { s: 15, v: 0 }, { s: 60, v: 1.33 }, { s: 240, v: 0 }]));
  assert.equal(r.fahrten.length, 1);
  assert.ok(Math.abs(r.fahrten[0].km - 1.16) <= 0.04, `km ${r.fahrten[0].km}`);
  assert.ok(r.fahrten[0].endeUhr <= '12:02:01', `Ende ${r.fahrten[0].endeUhr}`);
});

test('Funkloch im Laden (keine Punkte): Fahrt endet am Auto', () => {
  const r = spieleAb(fahrplan(zumBaecker([{ s: 240, v: 0, luecke: true }])));
  assert.equal(r.fahrten.length, 2);
  assert.ok(bisParkplatz(r.fahrten[0]) <= 10, `Ende ${bisParkplatz(r.fahrten[0])} m vom Auto`);
  assert.ok(Math.abs(r.fahrten[0].km - 1.2) <= 0.02, `km ${r.fahrten[0].km}`);
});

test('Parken im Schritttempo bleibt Teil der Fahrt (km und Ende)', () => {
  passt([{ s: 120, v: 10 }, { s: 30, v: 2 }, { s: 240, v: 0 }],
    { fahrten: [{ start: '12:00:00', ende: '12:02:30', toleranz_s: 5, km: 1.26, km_toleranz: 0.03 }] });
});

test('Stau im Schritttempo (unter 7 km/h) über 150 m beendet die Fahrt nicht', () => {
  passt([{ s: 120, v: 10 }, { s: 10, v: 0 }, { s: 200, v: 1.5 }, { s: 60, v: 10 }, { s: 240, v: 0 }],
    { fahrten: [{ start: '12:00:00', ende: '12:06:30', toleranz_s: 5, km: 2.1, km_toleranz: 0.05 }] });
});

// Wächter beim Öffnen der App (SPEC-gps-abbruch.md, Stufe 1): GPS-Dienst beendet, es kommen keine Punkte mehr
const geoeffnet = (plan, nachS) => { const z = fahrplan(plan); return spieleAb(z, { geoeffnet: z.at(-1).t + nachS * 1000 }); };

test('GPS-Ausfall: offene Fahrt + 10 min ohne Punkte endet beim Öffnen am letzten bewegten Punkt', () => {
  const r = geoeffnet([{ s: 120, v: 10 }, { s: 60, v: 0 }], 600);
  assert.equal(r.fahrten.length, 1);
  assert.deepEqual(pruefe(r, { tag: '2026-10-28', fahrten: [{ start: '12:00:00', ende: '12:02:00', toleranz_s: 2, km: 1.2 }] }), []);
  assert.ok(typen(r).includes('stopp nach GPS-Ausfall'));
});

test('GPS-Ausfall mitten in der Fahrt (Tempo beim letzten Punkt): Ende am letzten Punkt', () => {
  const r = geoeffnet([{ s: 120, v: 10 }], 600);
  assert.deepEqual(pruefe(r, { tag: '2026-10-28', fahrten: [{ start: '12:00:00', ende: '12:02:00', toleranz_s: 2 }] }), []);
});

test('Öffnen mit frischen Punkten (Ampel, Stau): Fahrt bleibt offen', () => {
  const r = geoeffnet([{ s: 120, v: 10 }, { s: 60, v: 0 }], 30);
  assert.equal(r.fahrten.length, 1);
  assert.equal(r.fahrten[0].ende, null);
});

test('Wächter: Punkt aus dem Warten zählt nicht, nur Punkte der Fahrt selbst', () => {
  const e = createErkennung();
  e.setModus('fahrt');
  assert.equal(e.pruefeAusfall(Date.now(), undefined), false);
  const stand = gpsStand(null, { p: BEXBACH, t: T0, tempo: 5 });
  assert.equal(e.pruefeAusfall(T0 + SCHWELLEN.STOPP_DAUER - 1, stand), false);
  assert.equal(e.pruefeAusfall(T0 + SCHWELLEN.STOPP_DAUER, stand), true);
});

// Testfahrt 29.10.2026: Fahrt vergessen, um 17:00 zu Hause Akku eingetippt → Start per Hand, letzter Punkt von 16:22
const loc = (t, [lat, lon], speed = 0) => ({ latitude: lat, longitude: lon, accuracy: 4, speed, time: t });

test('Start per Hand nach 38 min Pause: Fahrt endet nicht sofort am alten Punkt aus dem Warten', () => {
  const stopps = [], log = [];
  const e = createErkennung({ onStopp: p => stopps.push(p), onLog: (typ, d) => log.push(d.schritt) });
  e.setModus('warten');
  e.verarbeite(loc(T0, BEXBACH));
  e.setModus('fahrt');
  e.verarbeite(loc(T0 + 38 * 60000, [BEXBACH[0] + 0.00005, BEXBACH[1]]));
  assert.deepEqual(stopps, []);
  assert.ok(log.includes('alter Punkt verworfen'));
  assert.ok(!log.includes('stopp nach Lücke'));
});

test('Lücke mitten in der Fahrt beendet sie weiterhin (alter Punkt stammt aus der Fahrt)', () => {
  const stopps = [];
  const e = createErkennung({ onStopp: p => stopps.push(p) });
  e.setModus('fahrt');
  e.verarbeite(loc(T0, BEXBACH, 5));
  e.verarbeite(loc(T0 + 1000, [BEXBACH[0], BEXBACH[1] + 0.0001], 5));
  e.verarbeite(loc(T0 + 1000 + 20 * 60000, [BEXBACH[0], BEXBACH[1] + 0.0002]));
  assert.equal(stopps.length, 1);
});

// Fahrtenbuch 29.10.2026 (Log handy-2026-10-29-testfahrt.jsonl): Start per Hand um 17:00:03.932 (t0, Uhr des Handys),
// APK 1418 beendete die Fahrt 59 ms später am Punkt aus dem Warten von 16:22:12.909 → gespeichert „von 17:00 bis 16:22“.
// Der erste Fix der Fahrt war 16 ms vor t0 gemessen: bricht das GPS danach ab, endet der Wächter ebenfalls vor t0.
const T_WARTEN = 1793287332909, T_START = 1793289603932, T_FIX = 1793289603916;
test('Fahrtende liegt nie vor dem Beginn (von 17:00 bis 16:22)', () => {
  assert.equal(fahrtEnde(T_START, T_WARTEN), T_START);
  const stand = gpsStand(null, { p: BEXBACH, t: T_FIX, tempo: 0 });
  const ende = gpsAusfall(stand, T_START + SCHWELLEN.STOPP_DAUER);
  assert.ok(ende.t < T_START);   // Ursache: die GPS-Zeit des Punkts liegt vor t0
  assert.equal(fahrtEnde(T_START, ende.t), T_START);
  assert.equal(fahrtEnde(T_START, T_START + 60000), T_START + 60000);   // normales Ende bleibt unverändert
});

test('gpsStand merkt den letzten bewegten Punkt, Stillstand danach ändert ihn nicht', () => {
  let s = gpsStand(null, { p: [1, 1], t: 1, tempo: 10 });
  s = gpsStand(s, { p: [1, 2], t: 2, tempo: 0.2 });
  assert.deepEqual(s, { letzter: { p: [1, 2], t: 2 }, bewegt: { p: [1, 1], t: 1 } });
  assert.deepEqual(gpsAusfall(s, 2 + SCHWELLEN.STOPP_DAUER), { p: [1, 1], t: 1, luecke: SCHWELLEN.STOPP_DAUER });
});
