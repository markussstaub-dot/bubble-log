// Zwischenspeichern der laufenden Fahrt (src/store.js). Anlass: Fahrt 12.11.2026 09:38–09:44 verloren. Nach dem
// direkten Speichern beim Start der 12-V-Messung legte speichernSpaeter keinen Timer mehr an; beim Neustart der App
// um 10:05 stand die Fahrt noch auf 09:39 (0,4 km) und wurde als zu kurz verworfen.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Preferences im Browser-Modus schreibt in window.localStorage
const ablage = new Map();
globalThis.window = { localStorage: {
  getItem: k => ablage.get(k) ?? null, setItem: (k, v) => ablage.set(k, String(v)), removeItem: k => ablage.delete(k),
  get length() { return ablage.size; }, key: i => [...ablage.keys()][i] ?? null,
} };
const { speichern, speichernSpaeter, SPAETER_MS } = await import('../src/store.js');
const { createErkennung, gpsStand, gpsAusfall, distanz } = await import('../src/erkennung.js');
const { leseLog } = await import('../src/replay.js');

const gespeichert = () => JSON.parse(ablage.get('CapacitorStorage.bubble-log.v2') ?? 'null');
const fertig = () => new Promise(r => setImmediate(r));   // Preferences.set ist asynchron
let uhr = Date.UTC(2026, 10, 1);   // jeder Test ein Stück später, damit der letzte Speicherzeitpunkt nicht stört
const neueUhr = apis => { uhr += 3600000; mock.timers.enable({ apis, now: uhr }); };

test('nach direktem Speichern bei wartendem Timer speichert speichernSpaeter weiter', async t => {
  neueUhr(['setTimeout', 'Date']); t.after(() => mock.timers.reset());
  speichernSpaeter({ n: 1 });                 // lange nichts gespeichert: sofort
  mock.timers.tick(1000); speichernSpaeter({ n: 2 });   // Timer läuft
  mock.timers.tick(1000); speichern({ n: 3 });          // direkt (z. B. 12-V-Messung)
  mock.timers.tick(1000); speichernSpaeter({ n: 4 });
  mock.timers.tick(SPAETER_MS); await fertig();
  assert.equal(gespeichert().n, 4);
});

test('ohne feuernde Timer (Doze) speichern die GPS-Punkte selbst, höchstens alle 15 s', async t => {
  neueUhr(['Date']); t.after(() => mock.timers.reset());
  const geschrieben = [];
  for (let n = 1; n <= 60; n++) {
    speichernSpaeter({ n }); await fertig();
    const g = gespeichert().n; if (geschrieben.at(-1) !== g) geschrieben.push(g);
    mock.timers.tick(1000);
  }
  assert.deepEqual(geschrieben, [1, 16, 31, 46]);
  speichern({ n: 0 });   // Timer von oben aufräumen
});

// Das echte Log vom 12.11. durch Erkennung + Speicherweg der App: was steht beim Neustart um 10:05:19 im Speicher?
const LOG = new URL('./fahrten/handy-2026-11-12.jsonl', import.meta.url);
test('Fahrt 12.11. 09:38: beim Neustart steht die ganze Strecke im Speicher', { skip: !existsSync(LOG) && 'Log nur lokal' }, async t => {
  const zeilen = leseLog(readFileSync(LOG, 'utf8'));
  uhr = zeilen[0].t; mock.timers.enable({ apis: ['setTimeout', 'Date'], now: uhr }); t.after(() => mock.timers.reset());
  const eigen = { offen: null };
  const erkennung = createErkennung({
    onStart(start, punkt) {   // wie fahrtBeginnen: direkt sichern
      eigen.offen = { t0: Date.now(), km: distanz(start.p, punkt.p) / 1000, punkte: [punkt.p], gps: gpsStand(null, punkt) };
      speichern(eigen); erkennung.setModus('fahrt');
    },
    onPunkt(punkt) {   // wie main.js onPunkt: 25-m-Punkte, Wächter-Stand, speichernSpaeter
      const o = eigen.offen; if (!o) return;
      const d = distanz(o.punkte.at(-1), punkt.p);
      if (d >= 25) { o.km += d / 1000; o.punkte.push(punkt.p); }
      o.gps = gpsStand(o.gps, punkt); speichernSpaeter(eigen);
    },
    onStopp() { eigen.offen = null; speichern(eigen); erkennung.setModus('warten'); },
  });
  let neustart = null;
  for (const z of zeilen) {
    if (z.t > Date.now()) mock.timers.tick(z.t - Date.now());
    if (z.typ === 'app' && z.start && z.t > zeilen[0].t + 60000) { neustart = z.t; break; }
    if (z.typ === 'gps') {
      if (erkennung.modus === 'aus') erkennung.setModus(z.modus === 'fahrt' ? 'warten' : z.modus);
      erkennung.verarbeite({ latitude: z.lat, longitude: z.lon, accuracy: z.gen, speed: z.tempo, altitude: z.hoehe, bearing: z.kurs, time: z.zeit });
    }
    if (z.typ === 'bordnetz' && z.messung && eigen.offen) speichern(eigen);   // bordnetz.js sichert direkt
  }
  await fertig();
  assert.ok(neustart, 'Neustart der App im Log');
  const o = gespeichert().offen;
  assert.ok(o, 'offene Fahrt im Speicher');
  const ende = gpsAusfall(o.gps, neustart);
  const uhrzeit = new Date(ende.t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
  assert.ok(uhrzeit >= '09:42:00', `Ende ${uhrzeit}`);
  assert.ok(o.km >= 3, `${o.km.toFixed(2)} km`);
});
