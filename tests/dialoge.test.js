// Veraltete Dialoge (src/dialoge.js), nachgestellt nach der Testfahrt vom 30.10.2026:
// 10:24 Fahrt 1 gespeichert, danach „Akkustand jetzt“ offen, App in den Hintergrund. 10:25–10:33 Fahrt erkannt (ohne
// Start-Akku), 10:36 im Hintergrund beendet (4,9 km). 10:41 App sichtbar, der alte Dialog war noch offen, „Fahrt jetzt
// starten“ hat die beendete Fahrt überschrieben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beimOeffnen, veraltet, OHNE_FAHRT } from '../src/dialoge.js';

const beendet = { status: 'beendet', startSoc: null, km: 4.9 };
const faehrt = { status: 'faehrt', startSoc: null, km: 0.3 };

test('30.10. 10:41: „Akkustand jetzt“ offen, beendete Fahrt wartet → Akku-Abfrage zum Fahrtende', () => {
  assert.equal(beimOeffnen(beendet, 'warten'), 'ende');
  assert.equal(beimOeffnen(beendet, 'losfahren'), 'ende');
  assert.equal(beimOeffnen(beendet, 'ergebnis'), 'ende');   // Ergebnis der vorigen Fahrt noch offen
});

test('30.10. 10:41: „Fahrt jetzt starten“ aus dem alten Dialog ist veraltet', () => {
  assert.ok(veraltet('go', beendet));
  assert.ok(veraltet('socMerken', beendet));   // würde den Akkustand der wartenden Fahrt verfälschen
  assert.ok(veraltet('ntAusAkku', beendet));   // würde dieselbe Fahrt ein zweites Mal eintragen
  assert.ok(veraltet('go', faehrt));
});

test('ohne offene Fahrt gelten die Dialoge und Knöpfe wie bisher', () => {
  assert.equal(beimOeffnen(null, 'warten'), null);
  assert.equal(beimOeffnen(null, null), null);
  for (const akt of ['go', 'socMerken', 'ntAusAkku']) assert.ok(!veraltet(akt, null));
});

test('Knöpfe zur offenen Fahrt bleiben erlaubt', () => {
  for (const akt of ['save', 'discard', 'startok', 'stop', 'ende', 'foto', 'close']) assert.ok(!veraltet(akt, beendet), akt);
});

test('kein Dialog offen: beendete Fahrt fragt das Ende ab', () => {
  assert.equal(beimOeffnen(beendet, null), 'ende');
});

// SPEC-usability.md, US1: Zwischen Losfahren und Ankommen erscheint kein Dialog
test('US1: während der Fahrt nie eine Frage, auch ohne Start-Akku (ältere Version)', () => {
  for (const o of [faehrt, { status: 'faehrt', startSoc: 70 }, { status: 'faehrt', startSoc: 70, gesehen: true }])
    for (const art of [null, 'warten', 'losfahren', 'ergebnis', 'laden', 'anderes'])
      assert.ok([null, 'fahrt'].includes(beimOeffnen(o, art)), `${JSON.stringify(o)} / ${art}: ${beimOeffnen(o, art)}`);
});

test('US1: im Hintergrund erkannte Fahrt zeigt beim Öffnen die Fahrtansicht, einmal', () => {
  assert.equal(beimOeffnen({ status: 'faehrt', startSoc: 70 }, null), 'fahrt');
  assert.equal(beimOeffnen({ status: 'faehrt', startSoc: 70, gesehen: true }, null), null);   // ausgeblendet: bleibt zu
});

test('Fahrt im Hintergrund erkannt, noch unterwegs: alter Dialog weicht der Fahrtansicht', () => {
  assert.equal(beimOeffnen(faehrt, 'warten'), 'fahrt');
  assert.equal(beimOeffnen({ status: 'faehrt', startSoc: 70, gesehen: true }, 'ergebnis'), 'fahrt');
});

test('Dialoge zur Fahrt oder andere (Einstellungen, Nachtragen) werden nicht ersetzt', () => {
  assert.equal(beimOeffnen(beendet, 'anderes'), null);
  assert.equal(beimOeffnen(faehrt, 'anderes'), null);
  assert.ok(!OHNE_FAHRT.includes('anderes'));
});
