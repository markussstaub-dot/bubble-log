// Replay: Entwickler-Log (JSON Lines aus devlog.js) noch einmal durch die Fahrterkennung schicken.
// Läuft ohne GPS und Capacitor (Browser und node --test). Speichert nichts.
// Ergebnis: was die Erkennung heute entscheidet (ereignisse, fahrten) und was das Handy damals geloggt hat (damals).
import { createErkennung, distanz, gpsStand } from './erkennung.js';

const PUNKT_ABSTAND = 25;   // m zwischen gespeicherten Streckenpunkten, wie in main.js (dort zählt so die Strecke)

const p2 = n => String(n).padStart(2, '0');
export const uhr = ms => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

// Text → Zeilen-Objekte; kaputte Zeilen (abgeschnittenes Ende beim Absturz) werden übersprungen
export function leseLog(text) {
  const zeilen = [];
  for (const z of text.split(/\r?\n/)) {
    if (!z.trim()) continue;
    try { zeilen.push(JSON.parse(z)); } catch { /* unvollständige Zeile */ }
  }
  return zeilen;
}

// gps-Zeile → loc wie vom Plugin; ohne zeit (Browser-GPS) gilt die Log-Zeit
export const gpsZuLoc = z => ({ latitude: z.lat, longitude: z.lon, accuracy: z.gen, speed: z.tempo, altitude: z.hoehe, bearing: z.kurs, time: z.zeit ?? z.t });

// eingabe: JSONL-Text oder schon gelesene Zeilen. schwellen: einzelne Werte aus SCHWELLEN überschreiben.
// startModus: sonst der Modus der ersten gps-Zeile. Danach wechselt der Modus wie in der App: Start → fahrt, Stopp → warten.
// Bei einer sim-Zeile (Simulator an/aus) beginnt die Erkennung frisch wie in der App, der Modus kommt aus der nächsten gps-Zeile.
// Bei einer app-Zeile (Start oder sichtbar) läuft der Wächter wie in der App (SPEC-gps-abbruch.md). geoeffnet: ms, zu denen
// die App danach noch geöffnet wurde, ohne dass es im Log steht (GPS-Dienst tot, Log-Ende); dort läuft der Wächter auch.
export function spieleAb(eingabe, { schwellen, startModus, geoeffnet = [] } = {}) {
  const zeilen = typeof eingabe === 'string' ? leseLog(eingabe) : eingabe;
  const ereignisse = [], fahrten = [], damals = [];
  let jetzt = null, offen = null, punkte = 0, verworfen = { ungenau: 0, sprung: 0 }, ausfall = null;

  const ereignis = (typ, zeit, ort, mehr = {}) => ereignisse.push({ typ, zeit, uhr: uhr(zeit), ort, ...mehr });
  const erkennung = createErkennung({
    schwellen, jetzt: () => jetzt.t,
    onLog(typ, d) {
      if (typ === 'gps' && d.verworfen) verworfen[d.verworfen]++;
      if (typ !== 'erkennung') return;
      const ort = [jetzt.lat, jetzt.lon], t = jetzt.zeit ?? jetzt.t;
      if (d.schritt === 'kandidat') ereignis('kandidat', t, ort);
      else if (d.schritt === 'kandidat verworfen') ereignis('kandidat verworfen', t, ort);
      else if (d.schritt.startsWith('neu aufgesetzt')) ereignis('neu aufgesetzt', t, ort, { spruenge: d.spruenge });
      else if (d.schritt === 'stopp nach GPS-Ausfall') ausfall = d.luecke;
    },
    onStart(start, punkt) {
      if (offen) return;   // wie main.js: läuft schon eine Fahrt, zählt der Start nicht
      offen = { start: start.t, erkannt: punkt.t, ende: null, gestoppt: null, km: distanz(start.p, punkt.p) / 1000, von: start.p, nach: null, letzter: punkt.p, gps: gpsStand(null, punkt) };
      ereignis('start', start.t, start.p, { erkannt: punkt.t, km: runde(offen.km) });
      erkennung.setModus('fahrt');
    },
    onPunkt(punkt) {
      if (!offen) return;
      offen.gps = gpsStand(offen.gps, punkt);
      const d = distanz(offen.letzter, punkt.p);
      if (d >= PUNKT_ABSTAND) { offen.km += d / 1000; offen.letzter = [+punkt.p[0].toFixed(5), +punkt.p[1].toFixed(5)]; }
    },
    onStopp(ende) {
      if (!offen) return;
      Object.assign(offen, { ende: ende.t, gestoppt: jetzt.zeit ?? jetzt.t, nach: ende.p });
      if (ausfall != null) { offen.gpsAusfall = ausfall; ausfall = null; }
      ereignis(offen.gpsAusfall != null ? 'stopp nach GPS-Ausfall' : 'stopp', ende.t, ende.p, { erkannt: offen.gestoppt, km: runde(offen.km) });
      abschliessen();
      erkennung.setModus('warten');
    },
  });
  function abschliessen() {
    const { letzter, gps, ...f } = offen;
    fahrten.push({ ...f, km: runde(f.km), startUhr: f.start != null ? uhr(f.start) : null, endeUhr: f.ende != null ? uhr(f.ende) : null });
    offen = null;
  }

  function waechter(t) {
    if (!offen || !jetzt) return;
    jetzt = { ...jetzt, t, zeit: t };
    erkennung.pruefeAusfall(t, offen.gps);
  }

  let modusOffen = true;   // Modus noch aus der nächsten gps-Zeile übernehmen
  if (startModus) { erkennung.setModus(startModus); modusOffen = false; }
  for (const z of zeilen) {
    if (z.typ === 'gps') {
      if (modusOffen) {
        const m = z.modus === 'fahrt' ? 'fahrt' : 'warten';
        erkennung.setModus(m); modusOffen = false;
        if (m === 'fahrt' && !offen) offen = { start: null, erkannt: null, ende: null, gestoppt: null, km: 0, von: null, nach: null, letzter: [z.lat, z.lon], fortgesetzt: true };
      }
      jetzt = z; punkte++;
      erkennung.verarbeite(gpsZuLoc(z));
    } else if (z.typ === 'erkennung' || z.typ === 'fahrt' || z.typ === 'modus' || z.typ === 'sim') {
      const { t, typ, ...rest } = z;
      damals.push({ t, uhr: uhr(t), typ, ...rest });
      if (typ === 'sim') {
        if (offen) { offen.abgebrochen = true; abschliessen(); }
        erkennung.zuruecksetzen(); modusOffen = true;
      }
    } else if (z.typ === 'app' && (z.start || z.sichtbar)) waechter(z.t);
  }
  for (const t of [].concat(geoeffnet)) waechter(t);
  if (offen) abschliessen();   // Fahrt läuft am Log-Ende noch (ende: null)
  return { ereignisse, fahrten, damals, punkte, verworfen };
}

const runde = km => Math.round(km * 100) / 100;

// Erwartung { fahrten: [{ start: 'HH:MM:SS', ende, toleranz_s, km, km_toleranz }] } gegen das Ergebnis prüfen.
// Uhrzeiten gelten am Tag der ersten Fahrt (bzw. am tag: 'JJJJ-MM-TT'). Rückgabe: Liste der Abweichungen, leer = passt.
export function pruefe(ergebnis, erwartet) {
  const fehler = [], ist = ergebnis.fahrten, soll = erwartet.fahrten || [];
  if (ist.length !== soll.length) fehler.push(`${ist.length} Fahrt(en) erkannt, erwartet ${soll.length}: ${ist.map(f => `${f.startUhr}–${f.endeUhr} ${f.km} km`).join(', ') || 'keine'}`);
  const basis = erwartet.tag ? new Date(erwartet.tag + 'T00:00:00') : ist[0] ? new Date(ist[0].start ?? ist[0].ende) : null;
  const ms = hhmmss => { const [h, m, s = 0] = hhmmss.split(':').map(Number); const d = new Date(basis); d.setHours(h, m, s, 0); return +d; };
  soll.forEach((e, i) => {
    const f = ist[i]; if (!f || !basis) return;
    const tol = (e.toleranz_s ?? 60) * 1000;
    if (e.start && (f.start == null || Math.abs(f.start - ms(e.start)) > tol)) fehler.push(`Fahrt ${i + 1}: Start ${f.startUhr ?? '–'}, erwartet ${e.start} ± ${tol / 1000} s`);
    if (e.ende && (f.ende == null || Math.abs(f.ende - ms(e.ende)) > tol)) fehler.push(`Fahrt ${i + 1}: Ende ${f.endeUhr ?? '–'}, erwartet ${e.ende} ± ${tol / 1000} s`);
    const kmTol = e.km_toleranz ?? Math.max(0.2, (e.km ?? 0) * 0.1);
    if (e.km != null && Math.abs(f.km - e.km) > kmTol) fehler.push(`Fahrt ${i + 1}: ${f.km} km, erwartet ${e.km} ± ${kmTol} km`);
  });
  return fehler;
}
