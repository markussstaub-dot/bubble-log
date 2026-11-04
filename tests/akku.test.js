// Sparmodus beim Warten (SPEC-akku.md): Kandidat weckt das GPS auf 1 s, Verwerfen schickt es zurück in Ruhe (30 s).
// Replay: dieselben Logs mit ausgedünnten Wartepunkten (höchstens einer je 30 s ohne Kandidat) erkennen dieselben Fahrten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fahrplan } from './hilfe.js';
import { createErkennung, gpsWahl, RUHE_TAKT, VOLL_TAKT, SCHWELLEN } from '../src/erkennung.js';
import { spieleAb, gpsZuLoc } from '../src/replay.js';

// Erkennung mit Protokoll der onKandidat-Meldungen; start: was onStart tun soll (Modus wechseln oder nicht)
function mitMeldungen({ wechseltBeimStart = true } = {}) {
  const meldungen = [];
  const e = createErkennung({ onKandidat: an => meldungen.push(an), onStart: () => { if (wechseltBeimStart) e.setModus('fahrt'); } });
  e.setModus('warten');
  const fuettere = plan => { for (const z of fahrplan(plan)) e.verarbeite(gpsZuLoc(z)); };
  return { e, meldungen, fuettere };
}

test('gpsWahl: Warten in Ruhe 30 s, wach und Fahrt jede Sekunde', () => {
  assert.deepEqual(gpsWahl('warten', false), { abstand: 30, takt: RUHE_TAKT });
  assert.equal(RUHE_TAKT, 30000);
  assert.deepEqual(gpsWahl('warten', true), { abstand: 30, takt: VOLL_TAKT });
  assert.deepEqual(gpsWahl('fahrt', false), { abstand: 0, takt: 1000 });
  assert.deepEqual(gpsWahl('fahrt', true, 60000), { abstand: 0, takt: 1000 });   // Fahrtmodus unverändert
  assert.equal(gpsWahl('warten', false, 15000).takt, 15000);   // Entwicklermodus: 15 s
  assert.equal(gpsWahl('warten', false, VOLL_TAKT).takt, 1000);   // Entwicklermodus: volle Rate
});

test('Kandidat meldet wach, Verwerfen nach KANDIDAT_MAX meldet Ruhe', () => {
  const { e, meldungen, fuettere } = mitMeldungen();
  fuettere([{ s: 10, v: 0 }]);
  assert.deepEqual(meldungen, []);
  fuettere([{ s: 5, v: 4 }]);   // Radler/Auto kurz vorbei, zu kurz für einen Start
  assert.deepEqual(meldungen, [true]);
  assert.equal(e.kandidat, true);
  fuettere([{ s: SCHWELLEN.KANDIDAT_MAX / 1000 + 5, v: 0 }]);
  assert.deepEqual(meldungen, [true, false]);
  assert.equal(e.kandidat, false);
  assert.equal(e.modus, 'warten');
});

test('Start mit Moduswechsel: nur wach, kein Zurück auf Ruhe (der Fahrtmodus setzt den Takt)', () => {
  const { e, meldungen, fuettere } = mitMeldungen();
  fuettere([{ s: 5, v: 0 }, { s: 60, v: 10 }]);
  assert.equal(e.modus, 'fahrt');
  assert.deepEqual(meldungen, [true]);
});

test('Start ignoriert (Modus bleibt warten): GPS geht zurück auf Ruhe', () => {
  const { e, meldungen, fuettere } = mitMeldungen({ wechseltBeimStart: false });
  fuettere([{ s: 5, v: 0 }, { s: 30, v: 10 }]);
  assert.equal(e.modus, 'warten');
  assert.deepEqual(meldungen.slice(0, 2), [true, false]);
});

test('Replay im Sparmodus: einzelner schneller Punkt weckt, danach zählt jeder Punkt', () => {
  // langsam gehen, dann losfahren: ausgedünnt startet die Fahrt höchstens RUHE_TAKT später
  const plan = [{ s: 300, v: 0.5 }, { s: 180, v: 10 }, { s: 240, v: 0 }];
  const voll = spieleAb(fahrplan(plan)), spar = spieleAb(fahrplan(plan), { ruheTakt: RUHE_TAKT });
  assert.equal(spar.fahrten.length, 1);
  assert.ok(spar.ausgeduennt > 200, `nur ${spar.ausgeduennt} Punkte weggelassen`);
  assert.ok(spar.fahrten[0].start - voll.fahrten[0].start <= RUHE_TAKT);
  assert.equal(spar.fahrten[0].ende, voll.fahrten[0].ende);
});

// Echte Logs (nicht versioniert): tests/fahrten/*.jsonl und, falls vorhanden, die Rohlogs in logs/
const MIN_KM = 0.3;   // wie main.js: kürzere automatische Fahrten verwirft die App
const ordner = [new URL('./fahrten/', import.meta.url), new URL('../logs/', import.meta.url)].filter(existsSync);
const logs = ordner.flatMap(o => readdirSync(o).filter(n => n.endsWith('.jsonl')).map(n => ({ name: n, url: new URL(n, o) })));
if (!logs.length) test('Replay im Sparmodus: keine Logs', { skip: 'tests/fahrten/ und logs/ sind leer' }, () => {});
for (const { name, url } of logs) {
  test(`Replay im Sparmodus (30 s) erkennt alle Fahrten: ${name}`, () => {
    const text = readFileSync(url, 'utf8');
    const zaehlt = r => r.fahrten.filter(f => f.km >= MIN_KM || f.start == null);
    const voll = zaehlt(spieleAb(text)), spar = zaehlt(spieleAb(text, { ruheTakt: RUHE_TAKT }));
    const zeige = l => l.map(f => `${f.startUhr}–${f.endeUhr} ${f.km} km`).join(', ') || 'keine';
    assert.equal(spar.length, voll.length, `voll: ${zeige(voll)} | Sparmodus: ${zeige(spar)}`);
    spar.forEach((f, i) => {
      if (f.ende != null) assert.ok(Math.abs(f.ende - voll[i].ende) <= 60000, `Fahrt ${i + 1}: Ende ${f.endeUhr} statt ${voll[i].endeUhr}`);
      assert.ok(f.start == null || f.start >= voll[i].start, `Fahrt ${i + 1}: Start ${f.startUhr} vor ${voll[i].startUhr}`);
    });
  });
}

// Befund 04.11.2026 (Replay 29.10.): Stop-and-go gleich nach dem Losfahren. Trifft das 30-s-Raster jedes Mal einen
// langsamen Moment, kommt der Kandidat spät (dort 90 s, 0,8 km fehlen am Anfang). Möglicher Ausweg, nicht umgesetzt:
// schon ab GEH_TEMPO (2 m/s) wecken, ohne die Kandidaten-Schwelle zu ändern.
test('⚠ Befund: Stop-and-go im Takt des Sparmodus verschiebt den Start um mehr als RUHE_TAKT', { todo: 'Weckschwelle offen, SPEC-akku.md' }, () => {
  const plan = [{ s: 20, v: 0 }, ...Array.from({ length: 4 }, () => [{ s: 10, v: 8 }, { s: 20, v: 0.5 }]).flat(), { s: 120, v: 10 }, { s: 240, v: 0 }];
  const voll = spieleAb(fahrplan(plan)), spar = spieleAb(fahrplan(plan), { ruheTakt: RUHE_TAKT });
  assert.ok(spar.fahrten[0].start - voll.fahrten[0].start <= RUHE_TAKT, `${(spar.fahrten[0].start - voll.fahrten[0].start) / 1000} s später`);
});
