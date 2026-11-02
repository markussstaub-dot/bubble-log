// Ladestellen der Schweiz (BFE, ich-tanke-strom.ch, Open Data im OICP-Format) in die Kacheln von docs/ladepunkte/
// mischen. Erst `node tools/ladepunkte.mjs <register.csv> --kacheln` (Deutschland, überschreibt die Kacheln), dann:
//   node tools/ladepunkte-ch.mjs <ch.bfe.ladestellen-elektromobilitaet.json>
// Quelle: https://data.geo.admin.ch/ch.bfe.ladestellen-elektromobilitaet/data/oicp/ch.bfe.ladestellen-elektromobilitaet.json
// Format wie in der App: { p, b, a, o, z, t2, k, s, kw, n } (siehe tools/ladepunkte.mjs)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const datei = process.argv[2];
if (!datei) { console.error('Aufruf: node tools/ladepunkte-ch.mjs <ch.bfe.ladestellen-elektromobilitaet.json>'); process.exit(1); }
const ordner = new URL('../docs/ladepunkte/', import.meta.url);
const QUELLE_CH = 'BFE, ich-tanke-strom.ch (Open Data)';
const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const glatt = s => String(s || '').replace(/\s+/g, ' ').trim();

const daten = JSON.parse(readFileSync(datei, 'utf8'));
const standorte = new Map();
let gelesen = 0, passend = 0;
for (const betreiber of daten.EVSEData || []) {
  for (const e of betreiber.EVSEDataRecord || []) {
    gelesen++;
    const [lat, lon] = String(e.GeoCoordinates?.Google || '').split(/\s+/).map(Number);
    // nur Schweiz und Liechtenstein; einige Einträge haben 0/0 oder vertauschte Koordinaten
    if (!isFinite(lat) || !isFinite(lon) || lat < 45.7 || lat > 47.9 || lon < 5.8 || lon > 10.6) continue;
    const plugs = (e.Plugs || []).join(',');
    // Microlino: AC Typ 2 (Dose oder festes Kabel) oder Haushaltssteckdose (Schuko, Schweizer Typ J/T13 mit Adapterkabel)
    const t2 = /Type 2 Outlet/i.test(plugs) ? 1 : 0, k = /Type 2 Connector/i.test(plugs) ? 1 : 0, s = /Schuko|Type F|Type J|Swiss/i.test(plugs) ? 1 : 0;
    if (!t2 && !k && !s) continue;
    passend++;
    const kw = Math.max(0, ...(e.ChargingFacilities || []).filter(f => /AC/i.test(f.powertype || '')).map(f => Number(f.power) || 0));
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const namen = [].concat(e.ChargingStationNames || []);   // mal Liste, mal einzelnes Objekt
    const name = (namen.find(n => n?.lang === 'de') || namen[0])?.value;
    const st = standorte.get(key) || { p: [+lat.toFixed(5), +lon.toFixed(5)], b: glatt(betreiber.OperatorName || name), a: glatt(e.Address?.Street), o: glatt(e.Address?.City),
      z: e.IsOpen24Hours ? '24/7' : '', t2: 0, k: 0, s: 0, kw: 0, n: 0 };
    st.t2 += t2; st.k += k; st.s += s; st.kw = Math.max(st.kw, Math.round(kw)); st.n += 1;
    standorte.set(key, st);
  }
}

const indexDatei = new URL('index.json', ordner);
if (!existsSync(indexDatei)) throw new Error('Erst die deutschen Kacheln erzeugen (tools/ladepunkte.mjs … --kacheln)');
const index = JSON.parse(readFileSync(indexDatei, 'utf8'));
const kacheln = new Map();
for (const s of standorte.values()) { const k = `${Math.floor(s.p[0])}_${Math.floor(s.p[1])}`; if (!kacheln.has(k)) kacheln.set(k, []); kacheln.get(k).push(s); }
for (const [k, l] of kacheln) {
  const f = new URL(`${k}.json`, ordner), alt = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { standorte: [] };
  const vorhanden = new Set(alt.standorte.map(s => `${s.p[0].toFixed(4)},${s.p[1].toFixed(4)}`));
  const neu = [...alt.standorte, ...l.filter(s => !vorhanden.has(`${s.p[0].toFixed(4)},${s.p[1].toFixed(4)}`))];
  writeFileSync(f, JSON.stringify({ quelle: alt.quelle ? `${alt.quelle} · ${QUELLE_CH}` : QUELLE_CH, stand: alt.stand ? `${alt.stand} · CH ${heute}` : `CH ${heute}`, standorte: neu }));
  index.kacheln[k] = neu.length;
}
index.quelle = `Bundesnetzagentur, Ladesäulenregister (CC BY 4.0) · ${QUELLE_CH}`;
index.stand = `DE ${String(index.stand).replace(/^DE /, '').split(' · ')[0]} · CH ${heute}`;
writeFileSync(indexDatei, JSON.stringify(index));
console.log(`${gelesen} Ladepunkte gelesen, ${passend} mit Typ 2 oder Haushaltssteckdose → ${standorte.size} Standorte in ${kacheln.size} Kacheln`);
