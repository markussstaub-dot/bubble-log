// Verlauf (src/verlauf.js): Klartext aus Log-Zeilen, Speicherliste, Filter-Chips aus den vorhandenen Einträgen
import test from 'node:test';
import assert from 'node:assert/strict';
import { klartext, eintragAus, anhaengen, chips, passt } from '../src/verlauf.js';

const k = (typ, daten) => klartext({ t: 0, typ, ...daten });

test('Fahrt in Klartext, mit Grund beim Verwerfen', () => {
  assert.equal(k('fahrt', { schritt: 'beginn', manuell: false, km: 0.3 }), 'Fahrt erkannt');
  assert.equal(k('fahrt', { schritt: 'beginn', manuell: true }), 'Fahrt von Hand gestartet');
  assert.equal(k('fahrt', { schritt: 'ende', km: 3.21 }), 'Fahrt beendet (3,2 km)');
  assert.equal(k('fahrt', { schritt: 'verworfen', ausgeloest: 'zu kurz', km: 0.12 }), 'Fahrt verworfen: zu kurz (0,1 km)');
  assert.equal(k('fahrt', { schritt: 'verworfen', km: 2 }), 'Fahrt verworfen: von Hand (2,0 km)');
  assert.equal(k('fahrt', { schritt: 'verworfen', ausgeloest: 'gps-ausfall, nachtragen', km: 1 }), 'Fahrt verworfen: GPS ausgefallen, zum Nachtragen (1,0 km)');
  assert.equal(k('fahrt', { schritt: 'gespeichert', von: '09:38', nach: '09:52', km: 12.4, start: 80, ende: 71 }), 'Fahrt gespeichert: 09:38–09:52, 12 km, Akku 80 → 71 %');
  assert.equal(k('fahrt', { schritt: 'zurückgestellt' }), 'Fahrt wartet auf den Akkustand');
  assert.equal(k('fahrt', { schritt: 'dialog ersetzt' }), null, 'interne Schritte nicht');
});

test('Laden, Notizen, Fehler, Tempolimit', () => {
  assert.equal(k('laden', { ort: 'Zuhause', von: 20, bis: 80 }), 'Geladen in Zuhause: 20 → 80 %');
  assert.equal(k('laden', { abgelehnt: 'kein Ort', von: 20, bis: 80 }), 'Ladung nicht gespeichert: kein Ort');
  assert.equal(k('laden', { rad: 'von', wert: 30 }), null, 'Drehen am Rad nicht');
  assert.equal(k('notiz', { text: 'Schild falsch' }), '🗒 Schild falsch');
  assert.equal(k('fehler', { quelle: 'gps-ausfall', dauer: 90 }), 'Fehler: GPS ausgefallen');
  assert.equal(k('fehler', { quelle: 'route', text: 'kein Netz' }), 'Fehler: Route – kein Netz');
  assert.equal(k('tempolimit', { limit: 50, vorher: 30 }), 'Tempolimit 50');
  assert.equal(k('tempolimit', { schild: true }), null);
  assert.equal(k('bordnetz', { fehler: 'verbinden', text: 'aus' }), '12-V-Messung fehlgeschlagen: aus');
});

test('Keine GPS-Rohdaten und nichts aus dem Simulator', () => {
  for (const typ of ['gps', 'sensor', 'vibration', 'modus', 'erkennung', 'display']) assert.equal(k(typ, { lat: 49, lon: 7 }), null, typ);
  assert.equal(k('tempolimit', { limit: 50, sim: true }), null);
});

test('Eintrag: kompakt, Zeit der Notiz bleibt', () => {
  assert.deepEqual(eintragAus('notiz', { t: 5, quelle: 'sticky', text: 'x', lat: 1 }, 99), { t: 5, typ: 'notiz', text: '🗒 x', quelle: 'sticky' });
  assert.deepEqual(eintragAus('fahrt', { schritt: 'beginn' }, 7), { t: 7, typ: 'fahrt', text: 'Fahrt erkannt' });
  assert.equal(eintragAus('gps', { lat: 1 }, 7), null);
  assert.equal(eintragAus('bordnetz', { fehler: 'x' }, 7).fehler, true, 'Fehler in anderen Typen bleiben erkennbar');
});

test('Liste: verspätet einsortiert, alte und zu viele fallen weg', () => {
  const l = [];
  const jetzt = 30 * 864e5;
  anhaengen(l, { t: jetzt - 10, typ: 'fahrt', text: 'b' }, jetzt);
  anhaengen(l, { t: jetzt - 20, typ: 'notiz', text: 'a' }, jetzt);
  assert.deepEqual(l.map(v => v.text), ['a', 'b']);
  anhaengen(l, { t: 1, typ: 'fahrt', text: 'uralt' }, jetzt);
  assert.equal(l.some(v => v.text === 'uralt'), false, 'älter als 14 Tage');
  assert.equal(anhaengen(l, null, jetzt), false);
  for (let i = 0; i < 1100; i++) anhaengen(l, { t: jetzt + i, typ: 'fahrt', text: String(i) }, jetzt);
  assert.equal(l.length, 1000);
});

test('Chips aus den vorhandenen Typen und Quellen', () => {
  const l = [
    { t: 1, typ: 'fahrt', text: 'Fahrt erkannt' }, { t: 2, typ: 'fahrt', text: 'Fahrt beendet' },
    { t: 3, typ: 'notiz', quelle: 'sticky', text: '🗒 a' },
  ];
  assert.deepEqual(chips(l), [['alles', 'Alles'], ['typ:fahrt', 'Fahrten'], ['typ:notiz', 'Notizen']]);
  l.push({ t: 4, typ: 'notiz', quelle: 'teilen', text: '🗒 b' }, { t: 5, typ: 'bordnetz', text: 'x', fehler: true });
  const c = chips(l).map(x => x[0]);
  assert.ok(c.includes('quelle:sticky') && c.includes('quelle:teilen'), 'Quellen ab zwei verschiedenen');
  assert.ok(c.includes('typ:fehler'), 'Fehler-Chip auch ohne Typ fehler');
  assert.equal(passt(l[4], 'typ:fehler'), true);
  assert.equal(passt(l[3], 'quelle:teilen'), true);
  assert.equal(passt(l[2], 'quelle:teilen'), false);
  assert.equal(passt(l[0], 'alles', 'ERKANNT'), true);
});
