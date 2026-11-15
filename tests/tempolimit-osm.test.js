// Umrechnung OSM → Tempolimit-Kacheln und Laden aus Overpass (src/tempolimit-osm.js, src/tempolimit.js; SPEC-tempolimit.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limit, wegLimits, landAusTags, teilen, ausOverpass, overpassAbfrage, kachelBox, douglasPeucker } from '../src/tempolimit-osm.js';
import { overpassKachel } from '../src/tempolimit.js';

test('limit(): Zahlen, mph, none, walk, Unbekanntes', () => {
  assert.equal(limit('50'), 50);
  assert.equal(limit(' 30 '), 30);
  assert.equal(limit('30 mph'), 48);
  assert.equal(limit('none'), 0);
  assert.equal(limit('walk'), -1);
  for (const v of [undefined, null, 'signals', 'variable', '50;30', 'XX:urban', 'DE:irgendwas']) assert.equal(limit(v), null, String(v));
});

test('Länderregeln für implizite Werte', () => {
  const t = { 'DE:urban': 50, 'DE:rural': 100, 'DE:motorway': 0, 'DE:living_street': -1, 'DE:bicycle_road': 30, 'DE:zone30': 30, 'DE:zone:20': 20,
    'CH:urban': 50, 'CH:rural': 80, 'CH:trunk': 100, 'CH:motorway': 120,
    'AT:urban': 50, 'AT:rural': 100, 'AT:trunk': 100, 'AT:motorway': 130,
    'IT:urban': 50, 'IT:rural': 90, 'IT:trunk': 110, 'IT:motorway': 130,
    'FR:urban': 50, 'FR:rural': 80, 'FR:trunk': 110, 'FR:motorway': 130, 'FR:zone30': 30 };
  for (const [k, v] of Object.entries(t)) assert.equal(limit(k), v, k);
});

test('wegLimits(): Klassen, Zonen, Richtung, Einbahn', () => {
  assert.deepEqual(wegLimits({ highway: 'primary', maxspeed: '70' }), { f: 70, b: 70, klasse: 'primary' });
  assert.deepEqual(wegLimits({ highway: 'residential' }), { f: null, b: null, klasse: 'residential' });   // ohne Limit: „?“, nicht raten
  assert.equal(wegLimits({ highway: 'service' }), null);                                                   // Parkplatz ohne Limit: weg
  assert.equal(wegLimits({ highway: 'footway', maxspeed: '10' }), null);
  assert.equal(wegLimits({ highway: 'residential', area: 'yes' }), null);
  assert.deepEqual(wegLimits({ highway: 'service', maxspeed: '20' }), { f: 20, b: 20, klasse: 'service' });
  assert.deepEqual(wegLimits({ highway: 'residential', 'zone:maxspeed': 'DE:30' }), { f: 30, b: 30, klasse: 'residential' });
  assert.deepEqual(wegLimits({ highway: 'residential', 'source:maxspeed': 'DE:zone30' }), { f: 30, b: 30, klasse: 'residential' });
  assert.deepEqual(wegLimits({ highway: 'secondary', maxspeed: '70', 'maxspeed:backward': '50' }), { f: 70, b: 50, klasse: 'secondary' });
  assert.deepEqual(wegLimits({ highway: 'motorway_link', maxspeed: '80', oneway: 'yes' }), { f: 80, b: -2, klasse: 'motorway' });
  assert.deepEqual(wegLimits({ highway: 'motorway', maxspeed: 'none' }), { f: 0, b: -2, klasse: 'motorway' });   // Autobahn implizit Einbahn
  assert.deepEqual(wegLimits({ highway: 'primary', junction: 'roundabout', maxspeed: '50' }).b, -2);
  assert.deepEqual(wegLimits({ highway: 'residential', oneway: '-1', maxspeed: '30' }), { f: -2, b: 30, klasse: 'residential' });
  assert.deepEqual(wegLimits({ highway: 'motorway', oneway: 'no', maxspeed: '120' }).b, 120);
});

test('living_street ohne Limit je Land, Land aus den Tags', () => {
  const ls = { highway: 'living_street' };
  assert.equal(wegLimits(ls, 'DE').f, -1);
  assert.equal(wegLimits(ls, 'AT').f, -1);
  assert.equal(wegLimits(ls, 'CH').f, 20);
  assert.equal(wegLimits(ls, 'FR').f, 20);
  assert.equal(wegLimits(ls, 'IT').f, null);
  assert.equal(wegLimits(ls, null).f, null);
  assert.equal(wegLimits({ ...ls, maxspeed: '10' }, 'CH').f, 10);
  assert.equal(landAusTags({ maxspeed: 'CH:urban' }), 'CH');
  assert.equal(landAusTags({ maxspeed: '50', 'source:maxspeed': 'DE:zone30' }), 'DE');
  assert.equal(landAusTags({ maxspeed: '50' }), null);
});

test('Douglas-Peucker 5 m und Teilen an der Kachelgrenze', () => {
  const M = 1 / 111195;
  // fast gerade (2 m Abweichung) → 2 Punkte; 20 m Knick bleibt
  assert.equal(douglasPeucker([[49.35, 7.25], [49.35 + 100 * M, 7.25 + 2 * M], [49.35 + 200 * M, 7.25]]).length, 2);
  assert.equal(douglasPeucker([[49.35, 7.25], [49.35 + 100 * M, 7.25 + 30 * M], [49.35 + 200 * M, 7.25]]).length, 3);
  const stuecke = [];
  teilen(7, 50, 30, [[49.391, 7.25], [49.405, 7.25]], (k, e) => stuecke.push([k, e]));   // ein Segment über 49,4°: Kachel seiner Mitte
  assert.deepEqual(stuecke.map(s => s[0]), ['493_72']);
  const zwei = [];
  teilen(8, 50, 50, [[49.395, 7.25], [49.399, 7.251], [49.405, 7.25]], (k, e) => zwei.push([k, e]));
  assert.deepEqual(zwei.map(s => s[0]), ['493_72', '494_72']);
  assert.deepEqual(zwei[0][1].slice(0, 3), [8, 50, 50]);
  assert.deepEqual(zwei[0][1][3].slice(0, 2), [4939500, 725000]);   // 1e-5 Grad, dann Differenzen
  assert.deepEqual(zwei[1][1][3].slice(0, 2), [4939900, 725100]);   // Teilstück beginnt am letzten Punkt davor
});

test('Overpass-Antwort → Kachel; nur Stücke dieser Kachel, Land für living_street', () => {
  assert.deepEqual(kachelBox('473_85'), [47.3, 8.5, 47.4, 8.6]);
  assert.match(overpassAbfrage('473_85'), /\(47\.3,8\.5,47\.4,8\.6\)/);
  const antwort = { osm3s: { timestamp_osm_base: '2026-11-15T10:47:20Z' }, elements: [
    { type: 'way', id: 1, tags: { highway: 'primary', maxspeed: 'CH:urban' }, geometry: [{ lat: 47.35, lon: 8.55 }, { lat: 47.36, lon: 8.55 }] },
    { type: 'way', id: 2, tags: { highway: 'living_street' }, geometry: [{ lat: 47.35, lon: 8.56 }, { lat: 47.351, lon: 8.56 }] },
    { type: 'way', id: 3, tags: { highway: 'secondary', maxspeed: '80' }, geometry: [{ lat: 47.38, lon: 8.57 }, { lat: 47.395, lon: 8.58 }, { lat: 47.42, lon: 8.57 }] },
    { type: 'way', id: 4, tags: { highway: 'service' }, geometry: [{ lat: 47.35, lon: 8.57 }, { lat: 47.351, lon: 8.57 }] },
  ] };
  const t = ausOverpass(antwort, '473_85');
  assert.equal(t.land, 'CH');
  assert.equal(t.stand, '2026-11-15');
  assert.deepEqual(t.w.map(e => e.slice(0, 3)), [[1, 50, 50], [2, 20, 20], [3, 80, 80]]);
  assert.equal(t.w[2][3].length, 4);   // von Weg 3 nur das erste Stück, das zweite hat seine Mitte nördlich von 47,4
});

const antwort = (status, body = { elements: [] }) => ({ ok: status === 200, status, json: async () => body });
const S = { SERVER: ['https://a', 'https://b'], WARTEN: [1, 2], TIMEOUT: 1000 };

test('Overpass: Wartezeit bei 429/504, dann Ersatzserver', async () => {
  const aufrufe = [], gewartet = [];
  const folge = [429, 504, 502, 200];
  const j = await overpassKachel('493_72', { S, warten: async ms => gewartet.push(ms),
    fetchFn: async (url, o) => { aufrufe.push(url); assert.equal(o.method, 'POST'); return antwort(folge.shift()); } });
  assert.deepEqual(j, { elements: [] });
  assert.deepEqual(aufrufe, ['https://a', 'https://a', 'https://a', 'https://b']);
  assert.deepEqual(gewartet, [1, 2]);   // nach dem 3. Fehlschlag gleich zum nächsten Server
});

test('Overpass: anderer Fehler wechselt sofort, Netzfehler zählen wie Überlast, Laufzeitfehler im remark', async () => {
  const aufrufe = [];
  const folge = [() => antwort(400), () => { throw new Error('offline'); }, () => antwort(200, { remark: 'runtime error: Query timed out', elements: [] }), () => antwort(200, { elements: [1] })];
  const j = await overpassKachel('493_72', { S, warten: async () => {}, fetchFn: async url => { aufrufe.push(url); return folge.shift()(); } });
  assert.deepEqual(j.elements, [1]);
  assert.deepEqual(aufrufe, ['https://a', 'https://b', 'https://b', 'https://b']);
});

test('Overpass: alle Server überlastet → Fehler', async () => {
  let n = 0;
  await assert.rejects(overpassKachel('493_72', { S: { ...S, RUNDEN: 2 }, warten: async () => {}, fetchFn: async () => { n++; return antwort(429); } }), /HTTP 429/);
  assert.equal(n, 12);   // 2 Runden × 2 Server × (1 + 2 Wartezeiten)
});

test('Erweitern: vorhandener Cache wird wieder nach Kacheln sortiert', async () => {
  const { setzeDaten, vorhandeneKacheln, kachelnUm } = await import('../src/tempolimit.js');
  const zuhause = [49.347, 7.2506], eintraege = [];
  // ein Weg über die Kachelgrenze 49,4° (Knick, damit er nicht zu einem Segment vereinfacht wird) und einer weit weg
  teilen(1, 50, 50, [[49.395, 7.25], [49.399, 7.251], [49.405, 7.25]], (k, e) => eintraege.push([k, e]));
  teilen(2, 30, 30, [[49.30, 7.21], [49.301, 7.211]], (k, e) => eintraege.push([k, e]));
  setzeDaten({ zuhause, radiusKm: 25, stand: '2026-11-15', w: eintraege.map(x => x[1]) });
  const m = vorhandeneKacheln(zuhause);
  assert.equal(m.size, kachelnUm(zuhause, 25).length);   // auch leere Kacheln zählen als fertig
  for (const [k, e] of eintraege) assert.ok(m.get(k).includes(e), k);
  assert.equal([...m.values()].flat().length, 3);
  assert.equal(vorhandeneKacheln([47.37, 8.54]), null);   // anderes Zuhause: nichts übernehmen
});
