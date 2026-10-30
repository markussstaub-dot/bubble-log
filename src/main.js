// Bubble Log – Begleit-App für den Microlino. Oberfläche aus dem Prototyp (knopf-display/handy-prototyp.html),
// dazu echte Fahrterkennung per GPS und dauerhafte Speicherung auf dem Gerät.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { laden, speichern, speichernSpaeter, LEER } from './store.js';
import { createTracker, distanz, fahrtEnde, gpsStand } from './tracker.js';
import { temperatur } from './wetter.js';
import { csvText, fotosVon, teilen, speichern as csvSpeichern } from './export.js';
import * as foto from './foto.js';
import { socPlausibel } from './fototext.js';
import { scrollrad } from './scrollrad.js';
import { herkunft, nurSchaetzung } from './herkunft.js';
import * as sensoren from './sensoren.js';
import * as devlog from './devlog.js';
import { suchen, route as routeBerechnen } from './route.js';
import * as lade from './laden.js';
import * as nt from './nachtragen.js';
import * as dialoge from './dialoge.js';
import { simTabVerbinden, simTabZeichnen, simTabStoppen, simHud, simAktion } from './simtab.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const NATIV = Capacitor.isNativePlatform();
if (import.meta.env.DEV && !NATIV) await import('./sim.js');   // Simulations-Panel nur im Browser beim Entwickeln, nie in der APK
const UMWEG = 1.3;          // Straßen sind im Schnitt so viel länger als die Luftlinie (für den groben Reichweiten-Ring)
const MAX_ZIELE = 6;        // zuletzt geprüfte Ziele
const STROMPREIS = 0.35;    // €/kWh Vorschlag für den ersten Ladevorgang (Haushaltsstrom Deutschland, grob); danach der zuletzt eingetragene
const ZUHAUSE_RADIUS = 1000;   // m: so nah an Zuhause gilt der gespeicherte Weg zu einem Ziel
const CACHE_TAGE = 90;         // danach wird eine gespeicherte Route neu berechnet
const MAX_LINIENPUNKTE = 200;  // Routenlinie für Karte und Speicher ausgedünnt
const BEXBACH = { name: 'Bexbach', p: [49.3466, 7.2561] };
// Startliste der gemerkten Ziele (Ortsmitte), einmalig beim ersten Start mit dieser Version
const STARTLISTE = [
  ['Homburg', 49.3264, 7.3383], ['Neunkirchen', 49.3449, 7.1803], ['St. Ingbert', 49.2775, 7.1167], ['Zweibrücken', 49.2489, 7.3639],
  ['Saarbrücken', 49.2354, 6.9969], ['St. Wendel', 49.4669, 7.1688], ['Völklingen', 49.2526, 6.859], ['Bostalsee', 49.564, 7.063],
  ['Kaiserslautern', 49.4447, 7.769], ['Pirmasens', 49.2011, 7.6052], ['Saarlouis', 49.3138, 6.7519], ['Sarreguemines', 49.11, 7.0683],
  ['Merzig', 49.4432, 6.6378], ['Landstuhl', 49.4127, 7.5704], ['Trier', 49.7499, 6.6371], ['Metz', 49.1193, 6.1757],
  ['Landau', 49.1987, 8.118], ['Mannheim', 49.4875, 8.466],
].map(([kurz, lat, lon]) => ({ kurz, p: [lat, lon] }));
const ZWECKE = ['Privat', 'Arbeitsweg', 'Geschäftlich'];
const STARTWERT = 0.8;      // %/km bis genug eigene Fahrten da sind (Schnitt der Beispielfahrten im Prototyp)
const MAX_VERBRAUCH = 5;    // %/km: mehr ist ein Eingabefehler, solche Fahrten zählen nicht in den Schnitt
const MIN_KM = 0.3;         // automatisch erkannte Fahrten darunter werden verworfen (Rangieren, GPS-Wackler)
const PUNKT_ABSTAND = 25;   // m zwischen gespeicherten Streckenpunkten; dazwischen zählt die Strecke nicht (GPS-Zittern)
const REKUP = 0.5;          // Anteil der Höhenenergie, der bergab zurückkommt (konservativ, wie bei „Hin und zurück“)

let eigen = { ...LEER };
// Im Sim-Tab (Sandkasten) arbeitet die App auf einer Kopie und speichert nichts
const sichern = () => V.sandbox ? Promise.resolve() : speichern(eigen);

// ---------- Modell ----------
const fahrten = () => eigen.fahrten;
const ladungen = () => eigen.laden;
const socJetzt = () => eigen.soc ?? 80;
const tempJetzt = () => eigen.temp ?? 10;
// Nur Fahrten ab 1 km mit glaubhaftem Verbrauch gehen in den Schnitt; ein Tippfehler am Drehrad verdirbt sonst die Reichweite
// Ebenso nicht, wenn der Endwert nur die unverändert bestätigte Schätzung ist (src/herkunft.js)
const zaehlt = x => !nurSchaetzung(x) && x.km >= 1 && x.start >= x.ende && (x.start - x.ende) / x.km <= MAX_VERBRAUCH;
const gelernt = (liste = fahrten()) => liste.filter(x => zaehlt(x) && x.start - x.ende >= 3).length >= 3;
const avg = (liste = fahrten()) => {
  if (!gelernt(liste)) return STARTWERT;
  const f = liste.filter(zaehlt);
  return f.reduce((a, x) => a + x.start - x.ende - steigAnteil(x), 0) /Math.max(.1, f.reduce((a, x) => a + x.km, 0));
};
const kaltZuschlag = () => {
  const f = fahrten().filter(x => x.temp != null), k = f.filter(x => x.temp < 5), w = f.filter(x => x.temp >= 5);
  return gelernt(k) && gelernt(w) ? Math.max(0, avg(k) / avg(w) - 1) : 0;
};
const steigProzent = hm => Math.max(0, hm) * 9.81 * 600 / 3.6e6 / eigen.akku * 100;   // 600 kg mit Fahrer, Rekuperation konservativ nicht abgezogen
// % Akku, die die Höhenmeter einer Fahrt gekostet haben. Der gelernte Verbrauch gilt damit für flache Strecken;
// die Reichweite rechnet die Steigung zum Ziel wieder dazu.
const steigAnteil = x => x.hm != null ? steigProzent(x.hm - REKUP * (x.hmAb || 0)) : 0;
const reichweite = soc => Math.round(soc / (avg() * (tempJetzt() < 5 ? 1 + kaltZuschlag() : 1)));
const de = (v, d = 1) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const km = v => `${de(v, v < 10 ? 1 : 0)} km`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const socKlasse = p => p > 50 ? 'good' : p > 20 ? 'warn' : 'bad';
const datum = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`; };
const uhrzeit = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const schaetzung = o => Math.max(0, Math.round((o.startSoc ?? socJetzt()) - o.km * avg()));
// Zeitpunkt des letzten bekannten Akkustands; ältere Daten ohne socT: Ende der letzten Fahrt bzw. letzter Ladevorgang
const socZeit = () => eigen.socT ?? Math.max(0, fahrten().at(-1)?.t1 ?? 0, Number(ladungen().at(-1)?.id?.slice(1)) || 0);
const zeitpunkt = t => datum(t) === datum(Date.now()) ? uhrzeit(t) : `${datum(t)} ${uhrzeit(t)}`;

// ---------- Kleine Grafiken ----------
function ring(p, size = 132, stroke = 12) {
  const r = (size - stroke) / 2, u = 2 * Math.PI * r, col = `var(--${socKlasse(p)})`;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="Akku ${p} Prozent"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${u * p / 100} ${u}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="var(--ink)" style="font:600 ${size * .3}px var(--f-display)">${p}<tspan style="font-size:${size * .14}px" fill="var(--muted)"> %</tspan></text></svg>`;
}
// GPS-Punkte in ein Rechteck projizieren (Längengrade mit cos(Breite) gestaucht)
function projiziere(punkte, w, h, rand) {
  const k = Math.cos(punkte[0][0] * Math.PI / 180), xs = punkte.map(p => p[1] * k), ys = punkte.map(p => -p[0]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), sx = Math.max(...xs) - x0 || 1e-6, sy = Math.max(...ys) - y0 || 1e-6;
  const s = Math.min((w - 2 * rand) / sx, (h - 2 * rand) / sy), ox = (w - sx * s) / 2, oy = (h - sy * s) / 2;
  return punkte.map((p, i) => [ox + (xs[i] - x0) * s, oy + (ys[i] - y0) * s]);
}
const pfad = pts => 'M' + pts.map(p => p.map(n => n.toFixed(1)).join(' ')).join(' L');
function miniRoute(f) {
  if (f.nachgetragen) return `<svg viewBox="0 0 44 44" aria-hidden="true"><rect width="44" height="44" fill="var(--land)"/><path d="M22 31h9M26 13a2.1 2.1 0 0 1 3 3L17.5 27.5l-4 1 1-4z" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (!f.punkte || f.punkte.length < 2) return `<svg viewBox="0 0 44 44" aria-hidden="true"><rect width="44" height="44" fill="var(--land)"/></svg>`;
  const pts = projiziere(f.punkte, 44, 44, 6);
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><rect width="44" height="44" fill="var(--land)"/><path d="${pfad(pts)}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="2.5" fill="var(--ink)"/></svg>`;
}
function karte(punkte, ausschlaege = []) {
  const raster = Array.from({ length: 9 }, (_, i) => `<path d="M${i * 45} 0 V400 M0 ${i * 50} H360"/>`).join('');
  let strecke = '';
  if (punkte.length > 1) {
    const pts = projiziere(punkte, 360, 400, 40), [ex, ey] = pts.at(-1);
    // Raue Abschnitte gelb, sehr raue rot; starkes Bremsen als roter, starkes Beschleunigen als gelber Punkt
    const rau = pts.slice(1).map((p, i) => punkte[i + 1][3] >= sensoren.RAU ? `<path d="${pfad([pts[i], p])}" stroke="var(--${punkte[i + 1][3] >= sensoren.SEHR_RAU ? 'bad' : 'warn'})"/>` : '').join('');
    const marken = ausschlaege.filter(([i]) => pts[i]).map(([i, typ]) => `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" fill="var(--${typ === 'B' ? 'bad' : 'warn'})" stroke="var(--surface)" stroke-width="2"/>`).join('');
    strecke = `<path d="${pfad(pts)}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <g fill="none" stroke-width="5" stroke-linecap="round">${rau}</g>${marken}
      <circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="6" fill="var(--ink)"/><circle cx="${ex}" cy="${ey}" r="9" fill="var(--accent)" stroke="var(--surface)" stroke-width="3"/>`;
  }
  return `<svg viewBox="0 0 360 400" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Aufgezeichnete Strecke">
    <rect width="360" height="400" fill="var(--land)"/><g stroke="var(--road)" stroke-width="1" opacity=".7">${raster}</g>${strecke}
    <text x="180" y="386" text-anchor="middle" fill="var(--muted)" style="font:500 12px var(--f-body)">${punkte.length > 1 ? `Aufgezeichnete Strecke${punkte.some(p => p[3] != null) ? ' · gelb/rot: raue Straße' : ''}` : 'Warte auf GPS …'}</text></svg>`;
}

// ---------- Ansichten ----------
const V = { tab: 'heute', filter: 'Alle', ziel: 0, retour: false, fahrtAnsicht: false, loeschen: false, standortFehler: false };
const $ = id => document.getElementById(id);
const titel = f => `${esc(f.von)} → ${esc(f.nach)}`;

// ---------- Wo steht mein Microlino? ----------
const RICHTUNGEN = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
function richtung(a, b) {   // Himmelsrichtung von a nach b
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  const grad = (Math.atan2(y, x) / r + 360) % 360;
  return RICHTUNGEN[Math.round(grad / 45) % 8];
}
const entfernung = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : km(m / 1000);
let hierAbfrage = 0;
function hierHolen() {   // eigener Standort nur, solange die Karte "Heute" offen ist
  if (!navigator.geolocation || Date.now() - hierAbfrage < 30000) return;
  hierAbfrage = Date.now();
  navigator.geolocation.getCurrentPosition(pos => {
    V.hier = [pos.coords.latitude, pos.coords.longitude];
    const tippt = document.activeElement?.id === 'zSuche';
    if ((V.tab === 'heute' || V.tab === 'reichweite' && !tippt) && !sheetOffen() && !V.fahrtAnsicht) render();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
}
function parkplatzKarte() {
  const pp = eigen.parkplatz; if (!pp || eigen.offen?.status === 'faehrt') return '';
  hierHolen();
  const heuteTag = datum(Date.now()) === datum(pp.t), seit = heuteTag ? `seit ${uhrzeit(pp.t)}` : `seit ${datum(pp.t)} ${uhrzeit(pp.t)}`;
  const d = V.hier ? distanz(V.hier, pp.p) : null;
  const wo = d == null ? 'Eigener Standort wird ermittelt …' : d < 30 ? 'Du bist direkt beim Microlino.' : `${entfernung(d)} Richtung ${richtung(V.hier, pp.p)}`;
  const url = `https://www.google.com/maps/search/?api=1&query=${pp.p[0]},${pp.p[1]}`;
  return `<section class="card between">
    <div style="min-width:0"><div class="label">Microlino steht hier ${seit}</div><b>${wo}</b></div>
    <a class="btn" href="${url}" style="text-decoration:none;white-space:nowrap">Karte</a></section>`;
}

function viewHeute() {
  const soc = socJetzt(), letzte = fahrten().at(-1), a = avg(), kz = kaltZuschlag(), o = eigen.offen;
  const woche = fahrten().slice(-7), wkm = woche.reduce((s, x) => s + x.km, 0), wkwh = woche.reduce((s, x) => s + (x.start - x.ende) / 100 * eigen.akku, 0);
  const kosten = ladungen().reduce((s, l) => s + (l.bis - l.von) / 100 * eigen.akku * l.preis, 0);
  return `
    ${o ? `<button class="card between" data-act="${o.status === 'faehrt' ? 'zeigen' : 'ende'}" style="text-align:left;border-color:var(--accent)">
      <div><div class="label">${o.status === 'faehrt' ? 'Fahrt läuft' : 'Fahrt beendet'}</div><b>${km(o.km)} seit ${uhrzeit(o.t0)}</b></div>
      <span class="pill good">${o.status === 'faehrt' ? 'Anzeigen' : 'Akku eintragen'}</span></button>` : ''}
    <section class="card hero">
      ${ring(soc)}
      <div style="min-width:0">
        <div class="label">Akku ${eigen.soc == null ? 'noch nicht eingetragen' : 'geschätzt'}</div>
        <div class="big">ca. ${reichweite(soc)} km</div>
        <div class="muted small">Reichweite bei ${tempJetzt()} °C${eigen.temp == null ? ' (angenommen)' : ''}, ${gelernt() ? `aus ${fahrten().length} Fahrten gelernt` : 'Startwert, wird ab 3 Fahrten gelernt'}</div>
      </div>
    </section>
    ${parkplatzKarte()}
    ${eigen.erfassung && V.system?.akkuEingeschraenkt ? `<button class="card between" data-act="settings" style="text-align:left">
      <span><span class="label warn">Akku-Optimierung an</span><br><span class="small">Android kann die Fahrterkennung im Hintergrund beenden. In den Einstellungen ändern.</span></span>
      <span class="pill warn">Ändern</span></button>` : ''}
    <div class="grid2"><button class="btn primary" data-act="start" ${o ? 'disabled' : ''}>Fahrt starten</button><button class="btn" data-act="charge">Laden eintragen</button></div>
    <button class="card switch" data-act="settings" style="text-align:left">
      <span><span class="label">Fahrterkennung</span><br><span class="small">${eigen.erfassung ? 'An: Fahrten starten von selbst' : 'Aus: Fahrten von Hand starten'}</span></span>
      <span class="pill ${eigen.erfassung ? 'good' : 'muted'}">${eigen.erfassung ? 'an' : 'aus'}</span></button>
    <div class="chips">
      <span class="chip">${tempJetzt()} °C · ${kz > 0 ? `Kälte +${Math.round(kz * 100)} %` : 'kein Kältezuschlag'}</span>
      <span class="chip">Ø ${de(a, 2)} %/km</span>
      <span class="chip">${de(a * eigen.akku, 1)} kWh/100 km</span>
    </div>
    ${letzte ? `<section class="card">
      <div class="between"><div class="label">Letzte Fahrt</div><span class="muted small">${esc(letzte.tag)}</span></div>
      <div class="trip" style="margin-top:8px">${miniRoute(letzte)}
        <div style="min-width:0"><b>${titel(letzte)}</b><div class="muted small">${km(letzte.km)} · ${letzte.start} → ${letzte.ende} % · ${esc(letzte.zweck)}</div></div>
        ${badge(letzte)}</div>
    </section>
    <section class="card">
      <div class="label">Letzte 7 Fahrten</div>
      <div class="stat3" style="margin-top:8px">
        <div><div class="num">${de(wkm, 0)}</div><div class="muted small">km</div></div>
        <div><div class="num">${de(wkwh, 1)}</div><div class="muted small">kWh</div></div>
        <div><div class="num">${de(kosten, 2)}</div><div class="muted small">€ Laden</div></div>
      </div>
    </section>` : `<section class="card"><div class="label">Noch keine Fahrten</div><p class="small muted" style="margin:6px 0 0">Schalte die Fahrterkennung ein oder starte die erste Fahrt von Hand. Ab drei Fahrten rechnet die App mit deinem eigenen Verbrauch.</p></section>`}`;
}
function badge(f) {
  if (f.start - f.ende < 3 || f.km < 1) return `<span class="pill muted">kurz</span>`;
  const v = (f.start - f.ende) / f.km, r = (v - steigAnteil(f) / f.km) / avg();   // Farbe ohne den Anteil der Steigung
  return `<span class="pill ${r > 1.08 ? 'warn' : r < .95 ? 'good' : 'muted'} mono">${de(v, 2)}</span>`;
}
function viewFahrten() {
  const liste = fahrten().filter(f => V.filter === 'Alle' || f.zweck === V.filter).slice().reverse();
  const summeKm = liste.reduce((a, x) => a + x.km, 0);
  return `
    <div class="chips">${['Alle', ...ZWECKE].map(z => `<button class="chip" data-filter="${z}" aria-pressed="${V.filter === z}">${z}</button>`).join('')}</div>
    <section class="card">
      <div class="stat3">
        <div><div class="num">${liste.length}</div><div class="muted small">Fahrten</div></div>
        <div><div class="num">${de(summeKm, 0)}</div><div class="muted small">km</div></div>
        <div><div class="num">${de(avg(liste.length ? liste : fahrten()), 2)}</div><div class="muted small">Ø %/km</div></div>
      </div>
    </section>
    <div class="list">${liste.map(f => `
      <section class="card trip"${f.nachgetragen ? ` data-act="ntBearbeiten" data-id="${esc(f.id)}" role="button" style="cursor:pointer"` : ''}>${miniRoute(f)}
        <div style="min-width:0"><b>${titel(f)}</b>${f.nachgetragen ? '<span class="pill siegel">nachgetragen</span>' : ''}
          <div class="muted small">${esc(f.tag)} · ${f.nachgetragen ? '≈ ' : ''}${km(f.km)} · ${f.start} → ${f.ende} % · ${esc(f.zweck)}${f.temp != null ? ` · ${f.temp} °C` : ''}${f.hm != null ? ` · ↑ ${f.hm} Hm` : ''}${f.brems ? ` · ${f.brems}× stark gebremst` : ''}${f.nachgetragen ? ` · ${f.strecke?.quelle === 'ziel' ? `${esc(f.strecke.ziel)}${f.strecke.retour ? ', hin und zurück' : ''}` : 'km von Hand'}` : ''}</div>
          ${f.fotoStart || f.fotoEnde ? `<div class="fotos">${[f.fotoStart, f.fotoEnde].filter(Boolean).map(n => `<img class="foto-mini" data-foto="${esc(n)}" data-act="fotoGross" alt="Foto vom Display">`).join('')}</div>` : ''}</div>
        ${badge(f)}</section>`).join('') || '<p class="muted">Keine Fahrten mit diesem Zweck.</p>'}</div>
    <button class="btn block gestrichelt" data-act="ntNeu">+ Fahrt nachtragen</button>
    ${fahrten().length ? `<section class="card list">
      <div class="label">Fahrtenbuch als CSV</div>
      <div class="grid2"><button class="btn primary" data-act="csvTeilen">Teilen</button><button class="btn" data-act="csvSpeichern">Speichern</button></div>
      <p class="small muted" style="margin:0">Teilen öffnet das Android-Menü (Mail, OneDrive, Drive …). Speichern legt die Datei unter Dokumente/Bubble Log ab. Excel öffnet sie direkt als Tabelle.</p>
      <button class="btn block" data-act="csv">Als Text in die Zwischenablage</button>
    </section>` : ''}
    <p class="small muted" style="margin:0">Das Fahrtenbuch ist eine Erfassungshilfe. Als Nachweis für das Finanzamt muss ein Fahrtenbuch zeitnah, lückenlos und nachträglich unveränderbar geführt werden; eine bearbeitbare CSV-Datei erfüllt das allein nicht.</p>`;
}
// ---------- Reichweite: Zuhause und gespeicherte Ziele ----------
const nahe = (a, b, m) => distanz(a, b) < m;
const favoriten = () => eigen.favoriten || [];
const favorit = p => favoriten().find(f => nahe(f.p, p, 300));
function ausduennen(coords) {
  const n = Math.min(coords.length, MAX_LINIENPUNKTE), s = (coords.length - 1) / Math.max(1, n - 1);
  return Array.from({ length: n }, (_, i) => coords[Math.round(i * s)]).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}
const cacheAus = r => ({ km: r.km, minuten: r.minuten, auf: r.auf, ab: r.ab, hoeheBekannt: r.hoeheBekannt, coords: ausduennen(r.coords), t: Date.now() });
// neu berechnen: kein Eintrag, älter als CACHE_TAGE, oder Höhen fehlten (dann frühestens nach einer Stunde wieder versuchen)
const cacheAlt = c => !c || Date.now() - c.t > CACHE_TAGE * 864e5 || (!c.hoeheBekannt && Date.now() - c.t > 3600e3);
let cacheLaeuft = false;
// Wird Zuhause während des Laufs geändert, gilt die laufende Route nicht und alle Ziele kommen ab dem neuen Zuhause dran.
async function cacheFuellen() {   // fehlende Routen ab Zuhause nacheinander holen, mit Pause wegen der Grenzen der Dienste
  if (cacheLaeuft || V.sandbox || !eigen.zuhause || !navigator.onLine) return;
  cacheLaeuft = true;
  const ort = () => eigen.zuhause?.p.join();   // Vergleich über die Koordinaten (im Sim-Tab ist eigen eine Kopie)
  let heim = ort(), versucht = new Set();      // pro Zuhause jedes Ziel höchstens einmal versuchen
  while (!V.sandbox) {
    if (ort() !== heim) { heim = ort(); versucht = new Set(); }
    const f = heim && favoriten().find(x => cacheAlt(x.cache) && !versucht.has(x)); if (!f) break;
    versucht.add(f);
    try {
      const r = await routeBerechnen(eigen.zuhause.p, f.p);
      if (ort() !== heim || V.sandbox) devlog.log('cache', { kurz: f.kurz, verworfen: 'zuhause geändert' });
      else {
        f.cache = cacheAus(r); sichern();
        devlog.log('cache', { kurz: f.kurz, km: r.km, auf: r.auf, ab: r.ab, hoeheBekannt: r.hoeheBekannt });
        if (V.tab === 'reichweite' && !V.zielwahl && document.activeElement?.id !== 'zSuche' && !sheetOffen() && !V.fahrtAnsicht) render();
      }
    } catch (e) { devlog.log('fehler', { quelle: 'cache', kurz: f.kurz, text: e.message }); }
    await new Promise(r => setTimeout(r, 12000));   // Open-Meteo erlaubt etwa 600 Höhenpunkte pro Minute, eine Route hat bis zu 100
  }
  cacheLaeuft = false;
}

// ---------- Reichweite: Ziel prüfen ----------
function startpunkt() {   // aktueller Standort, sonst der Abstellort, sonst Zuhause
  if (V.hier) return Promise.resolve({ p: V.hier, name: 'aktueller Standort' });
  return new Promise(ok => {
    const ersatz = () => ok(eigen.parkplatz ? { p: eigen.parkplatz.p, name: 'Abstellort' } : eigen.zuhause ? { p: eigen.zuhause.p, name: 'Zuhause' } : null);
    if (!navigator.geolocation) return ersatz();
    navigator.geolocation.getCurrentPosition(pos => { V.hier = [pos.coords.latitude, pos.coords.longitude]; ok({ p: V.hier, name: 'aktueller Standort' }); },
      ersatz, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
  });
}
async function zielPruefen(z) {
  V.zielwahl = z; V.treffer = null; V.zroute = 'laedt'; render();
  const start = await startpunkt();
  if (!start) { V.zroute = { fehler: 'Eigener Standort unbekannt. Standort freigeben oder einmal fahren, damit es einen Abstellort gibt.' }; render(); return; }
  const fav = favorit(z.p), abZuhause = eigen.zuhause && nahe(start.p, eigen.zuhause.p, ZUHAUSE_RADIUS);
  if (abZuhause && fav && !cacheAlt(fav.cache)) {   // gespeicherter Weg: geht auch ohne Netz
    V.zroute = { ...fav.cache, start: { p: eigen.zuhause.p, name: eigen.zuhause.name }, ausCache: true };
    devlog.log('ziel', { kurz: z.kurz, ausCache: true });
    if (V.tab === 'reichweite') render();
    return;
  }
  try {
    const r = await routeBerechnen(start.p, z.p);
    V.zroute = { ...r, start };
    if (abZuhause && fav) fav.cache = cacheAus(r);
    eigen.ziele = [{ kurz: z.kurz, p: z.p }, ...(eigen.ziele || []).filter(x => x.kurz !== z.kurz)].slice(0, MAX_ZIELE); sichern();
    devlog.log('ziel', { kurz: z.kurz, km: r.km, auf: r.auf, ab: r.ab, hoeheBekannt: r.hoeheBekannt, start: start.name });
  } catch (e) {
    V.zroute = { fehler: `Route nicht berechnet (${e.message}). Ohne Netz geht der Ziel-Check nicht.` };
    devlog.log('fehler', { quelle: 'route', text: e.message });
  }
  if (V.tab === 'reichweite') render();
}
function zielRechnung(r, retour = V.retour) {
  const soc = socJetzt(), t = tempJetzt(), weg = r.km * (retour ? 2 : 1);
  const basis = weg * avg(), kalt = t < 5 ? basis * kaltZuschlag() : 0;
  const steig = steigProzent(r.auf - REKUP * r.ab) + (retour ? steigProzent(r.ab - REKUP * r.auf) : 0);   // zurück werden die Abfahrten zu Steigungen
  const ankunft = Math.round(soc - basis - kalt - steig);
  return { soc, t, weg, basis, kalt, steig, ankunft, urteil: ankunft >= 15 ? ['good', 'Reicht'] : ankunft >= 5 ? ['warn', 'Knapp'] : ['bad', 'Unterwegs laden'] };
}
function viewReichweite() {
  if (!V.hier) hierHolen();
  const zuletzt = eigen.ziele || [], r = V.zroute, z = V.zielwahl;
  let ergebnis = '';
  if (r === 'laedt') ergebnis = `<section class="card"><div class="label">${esc(z.kurz)}</div><p class="small muted" style="margin:6px 0 0">Route und Höhenmeter werden berechnet …</p></section>`;
  else if (r?.fehler) ergebnis = `<section class="card"><div class="label">${esc(z.kurz)}</div><p class="small bad" style="margin:6px 0 0">${esc(r.fehler)}</p></section>`;
  else if (r) {
    const x = zielRechnung(r);
    const gemerkt = favorit(z.p);
    ergebnis = `
      <div class="between">
        <label class="row small" style="gap:8px"><input type="checkbox" id="retour" ${V.retour ? 'checked' : ''}> Hin und zurück</label>
        <button class="btn" data-act="zielMerken" aria-pressed="${!!gemerkt}">${gemerkt ? '★ Gemerkt' : '☆ Merken'}</button>
      </div>
      ${r.ausCache ? `<p class="small muted" style="margin:0">Gespeicherter Weg ab ${esc(r.start.name)} (Stand ${datum(r.t)})${r.hoeheBekannt ? '' : ', Höhenmeter fehlen noch'}. Geht auch ohne Netz.</p>` : ''}
      <section class="card hero">
        ${ring(Math.max(0, x.ankunft))}
        <div style="min-width:0">
          <div class="label">${V.retour ? 'Zurück mit' : 'Ankunft mit'}</div>
          <div class="big ${x.urteil[0]}">${x.urteil[1]}</div>
          <div class="muted small">${x.ankunft >= 0
            ? `${V.retour ? 'zurück am Start' : `in ${esc(z.kurz)}`} mit ca. ${x.ankunft} %`
            : `Reicht nicht: es fehlen ca. ${-x.ankunft} %${V.retour ? ' für den Rückweg' : ''}. Unterwegs laden.`}</div>
        </div>
      </section>
      <section class="card">
        <div class="label">So gerechnet</div>
        <div class="list small" style="margin-top:8px">
          <div class="between"><span>Start: ${esc(r.start.name)}, Akku jetzt</span><b class="mono">${x.soc} %</b></div>
          <div class="between"><span>${km(x.weg)} Straße × Ø ${de(avg(), 2)} %/km</span><b class="mono">−${de(x.basis, 0)} %</b></div>
          <div class="between"><span>Kälte (${x.t} °C, +${Math.round(kaltZuschlag() * 100)} %)</span><b class="mono">−${de(x.kalt, 0)} %</b></div>
          <div class="between"><span>${r.hoeheBekannt ? `Höhenmeter ↑ ${r.auf} / ↓ ${r.ab}${V.retour ? ', zurück umgekehrt' : ''}` : 'Höhenmeter nicht geladen'}</span><b class="mono">−${de(x.steig, 0)} %</b></div>
          <div class="between" style="border-top:1px solid var(--line);padding-top:6px"><span>${V.retour ? 'Zurück' : 'Ankunft'} · etwa ${Math.round(r.minuten * (V.retour ? 2 : 1))} min Fahrt</span><b class="mono ${x.urteil[0]}">${x.ankunft} %</b></div>
        </div>
      </section>
      ${ladenAbschnitt(r, z)}`;
  }
  return `
    <form id="zielForm" class="row" style="gap:8px">
      <input id="zSuche" type="search" enterkeyhint="search" placeholder="Ziel suchen, z. B. Einsiedeln Kloster" value="${esc(V.zsuche || '')}" style="flex:1">
      <button class="btn primary" type="submit">Suchen</button>
    </form>
    ${V.treffer ? `<div class="list">${V.treffer.length ? V.treffer.map((t, i) => `<button class="card" data-act="zielTreffer" data-i="${i}" style="text-align:left"><b>${esc(t.kurz)}</b><div class="muted small">${esc(t.name)}</div></button>`).join('') : '<p class="small muted" style="margin:0">Nichts gefunden. Anders schreiben, z. B. mit Ort.</p>'}</div>` : ''}
    ${!V.treffer && zuletzt.length ? `<div class="chips">${zuletzt.map((x, i) => `<button class="chip" data-act="zielZuletzt" data-i="${i}" aria-pressed="${z?.kurz === x.kurz}">${esc(x.kurz)}</button>`).join('')}</div>` : ''}
    ${z && !V.treffer ? `<button class="btn" data-act="zielListe" style="align-self:flex-start">← Alle gemerkten Ziele</button>` : ''}
    <div class="zkarte" id="zKarte" aria-label="Karte mit Reichweite und Ladepunkten"></div>
    ${!z && !V.treffer ? `<p class="small muted" style="margin:-4px 0 0">${eigen.zuhause && !V.hier && !eigen.parkplatz ? `Ab ${esc(eigen.zuhause.name)} (Standort unbekannt). ` : ''}<span class="lade">●</span> Ladepunkte in Reichweite · <span class="good">●</span> klappt mit ${esc(ladekarte())} · Punkt antippen für Details.</p>` : ''}
    ${ergebnis}
    ${!z && !V.treffer ? `<div class="chips" role="tablist">
      <button class="chip" role="tab" data-act="rwListe" data-wert="ziele" aria-pressed="${V.rwListe !== 'laden'}">Ziele (${favoriten().length})</button>
      <button class="chip" role="tab" data-act="rwListe" data-wert="laden" aria-pressed="${V.rwListe === 'laden'}">⚡ Ladepunkte</button></div>
      ${V.rwListe === 'laden' ? naheLadepunkte(15) : ampelListe()}` : ''}
    <p class="small muted" style="margin:0">„Reicht“ heißt mindestens 15 % Reserve bei Ankunft, „Knapp“ 5 bis 15 %, darunter besser unterwegs laden. Der Ring zeigt grob, wie weit der Akku reicht (ca. ${reichweite(socJetzt())} km Straße, als Luftlinie geteilt durch ${de(UMWEG, 1)}). Genau rechnet nur der Ziel-Check mit Route und Höhenmetern: ${gelernt() ? 'mit deinem Verbrauch' : 'noch mit dem Startwert, bis drei eigene Fahrten da sind'}.
    Suche, Route, Höhen und Karte kommen von OpenStreetMap, OSRM und Open-Meteo; dabei gehen Ziel und Startpunkt an diese Dienste.
    Ladepunkte (AC Typ 2 und Schuko, 120 km um Bexbach): ${lade.QUELLE}, Stand ${lade.STAND}; in der App gespeichert, ohne Belegung und Preise.</p>`;
}

// ---------- Laden ----------
const REST_LADEN = 10;   // % Reserve bei Ankunft an einer Ladesäule unterwegs
const ladestrom = () => eigen.ladestrom || 8;
const minutenText = min => {   // auf 5 Minuten gerundet, mindestens 5
  const m = Math.max(5, Math.round(min / 5) * 5);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')} min` : ''}`;
};
const navLink = s => `https://www.google.com/maps/dir/?api=1&destination=${s.p[0]},${s.p[1]}`;

// Eigene Erfahrung mit der Ladekarte: pro Säule oder pro Betreiber 'ok' oder 'nein'; die Säule gilt vor dem Betreiber
const ladekarte = () => eigen.ladekarte || 'Electroverse';
const erfahrung = () => (eigen.ladeErfahrung ??= { punkte: {}, betreiber: {} });
function ladeStatus(s) {
  const e = eigen.ladeErfahrung; if (!e) return null;
  const k = lade.schluessel(s);
  if (e.punkte[k]) return { wert: e.punkte[k], quelle: 'Säule' };
  if (e.betreiber[s.b]) return { wert: e.betreiber[s.b], quelle: 'Betreiber' };
  return null;
}
const rang = s => ({ ok: 0, nein: 2 })[ladeStatus(s)?.wert] ?? 1;
const nachErfahrung = (liste, dann) => liste.slice().sort((a, b) => rang(a) - rang(b) || dann(a, b));
const nutzbar = s => ladeStatus(s)?.wert !== 'nein';

function ladepunktZeile(s, info) {
  const st = ladeStatus(s);
  const marke = st?.wert === 'ok' ? ` <span class="pill good">✓ ${esc(ladekarte())}</span>` : st?.wert === 'nein' ? ' <span class="pill bad">✗ ging nicht</span>' : '';
  return `<button class="ampel${st?.wert === 'nein' ? ' gesperrt' : ''}" data-act="ladepunkt" data-key="${lade.schluessel(s)}">
    <span class="punkt ${st?.wert === 'ok' ? 'good' : 'lade'}" aria-hidden="true">⚡</span>
    <span class="ampel-name"><b>${esc(s.b)}${marke}</b><span class="small muted">${esc(lade.adresse(s))} · ${esc(lade.beschreibung(s))}</span></span>
    <span class="mono small">${info}</span></button>`;
}
function ladepunktSheet(key) {
  const s = lade.finde(key); if (!s) return;
  const e = erfahrung(), p = e.punkte[key], b = e.betreiber[s.b];
  const knopf = (act, wert, text, aktiv) => `<button class="btn${aktiv ? ' primary' : ''}" data-act="${act}" data-key="${key}" data-wert="${wert}" aria-pressed="${aktiv}">${text}</button>`;
  sheet(`<h2>${esc(s.b)}</h2>
    <p class="small muted" style="margin:0">${esc(lade.adresse(s))}<br>${esc(lade.beschreibung(s))}${s.kw ? ` · bis ${de(s.kw, 0)} kW` : ''}${s.n ? ` · ${s.n} Ladepunkte` : ''}</p>
    <a class="btn primary block" href="${navLink(s)}" style="text-align:center;text-decoration:none">Navigation starten</a>
    <div class="label">Diese Säule mit ${esc(ladekarte())}</div>
    <div class="grid2">${knopf('markePunkt', 'ok', '✓ Klappt', p === 'ok')}${knopf('markePunkt', 'nein', '✗ Ging nicht', p === 'nein')}</div>
    <div class="label">Alle Säulen von ${esc(s.b)}</div>
    <div class="grid2">${knopf('markeBetreiber', 'ok', '✓ Klappt', b === 'ok')}${knopf('markeBetreiber', 'nein', '✗ Geht nicht', b === 'nein')}</div>
    <p class="small muted" style="margin:0">Markierte Säulen stehen in den Listen oben (✓) bzw. unten und ausgegraut (✗). Die Markierung einer Säule gilt vor der ihres Betreibers. Nochmal tippen hebt eine Markierung auf.</p>
    <button class="btn block" data-act="close">Fertig</button>`);
}
function markieren(art, key, wert) {
  const s = lade.finde(key); if (!s) return;
  const ziel = art === 'punkt' ? erfahrung().punkte : erfahrung().betreiber, k = art === 'punkt' ? key : s.b;
  if (ziel[k] === wert) delete ziel[k]; else ziel[k] = wert;
  devlog.log('ladeerfahrung', { art, schluessel: k, wert: ziel[k] ?? null });
  sichern(); ladepunktSheet(key);
}
// Ladezeit und Ladepunkte zu einem geprüften Ziel
function ladenAbschnitt(r, z) {
  const hin = zielRechnung(r, false).ankunft, rz = zielRechnung(r, true).ankunft;
  const umZiel = lade.umkreis(z.p, 1000);
  const amZiel = nachErfahrung(umZiel, (a, b) => a.m - b.m).slice(0, 3);
  if (rz >= 15) return umZiel.length ? `<p class="small muted" style="margin:0">⚡ ${umZiel.length} Ladepunkt${umZiel.length > 1 ? 'e' : ''} im Umkreis von 1 km ums Ziel, Laden ist aber nicht nötig.</p>` : '';
  const zielNutzbar = umZiel.some(nutzbar);
  const zielZeilen = amZiel.length ? amZiel.map(s => ladepunktZeile(s, `${Math.round(s.m / 10) * 10} m`)).join('')
    : '<p class="small bad" style="margin:0">Kein öffentlicher Ladepunkt im Umkreis von 1 km ums Ziel. Steckdose beim Besuch fragen oder unterwegs laden.</p>';
  const rueck = minutenText(lade.ladeMinuten(15 - rz, eigen.akku, ladestrom()));
  if (hin >= 15) return `<section class="card list">
      <div class="label">Laden am Ziel</div>
      <p style="margin:0"><b>${rueck}</b> laden am Ziel, dann reicht es zurück mit 15 % Reserve <span class="small muted">(${15 - rz} % bei ${ladestrom()} A)</span>.</p>
      ${zielZeilen}
    </section>`;
  // Ladepunkte an der Route, noch mit mindestens REST_LADEN % erreichbar, möglichst weit vorne; die letzten 2 km zählen als Ziel
  const x = zielRechnung(r, false), proKm = (x.soc - hin) / r.km;   // Verbrauch inkl. Kälte und Steigung, gleichmäßig verteilt
  const unterwegs = nachErfahrung(lade.entlang(r.coords).filter(s => s.kmAb < r.km - 2).map(s => ({ ...s, an: Math.round(x.soc - s.kmAb * proKm) }))
    .filter(s => s.an >= REST_LADEN), (a, b) => b.kmAb - a.kmAb).slice(0, 3);
  const unterwegsZeilen = unterwegs.map(s => ladepunktZeile(s, `nach ${km(s.kmAb)}<br>an mit ${s.an} %`)).join('');
  const zwischen = minutenText(lade.ladeMinuten(15 - hin, eigen.akku, ladestrom()));
  if (hin >= REST_LADEN && zielNutzbar) return `<section class="card list">
      <div class="label">Knapp: am Ziel laden</div>
      <p style="margin:0">Du kommst mit etwa ${hin} % an, weniger als 15 % Reserve. Am Ziel <b>${rueck}</b> laden, dann reicht es zurück.</p>
      ${zielZeilen}
      ${unterwegsZeilen ? `<p class="small muted" style="margin:0">Sicherer: unterwegs ${zwischen} nachladen, z. B. hier:</p>${unterwegsZeilen}` : ''}
    </section>`;
  return `<section class="card list">
    <div class="label">Unterwegs laden</div>
    <p style="margin:0">Unterwegs etwa <b>${zwischen}</b> laden, dann kommst du mit 15 % an <span class="small muted">(${15 - hin} % bei ${ladestrom()} A)</span>.</p>
    ${unterwegsZeilen || '<p class="small bad" style="margin:0">Kein Ladepunkt direkt an der Route in Reichweite. Vorher voll laden oder eine andere Route wählen.</p>'}
  </section>`;
}
// Nächste Ladepunkte ab dem eigenen Standort (Notfall-Liste)
function naheLadepunkte(anzahl = 5) {
  const start = V.hier || eigen.parkplatz?.p || eigen.zuhause?.p; if (!start) return '';
  // bewährte Säulen zuerst (auch wenn etwas weiter weg), dann die nächsten, „ging nicht“ ans Ende
  const liste = nachErfahrung(lade.umkreis(start, 30000), (a, b) => a.m - b.m).slice(0, anzahl);
  if (!liste.length) return '';
  return `<section class="card list">
    <div class="label">Nächste Ladepunkte ${V.hier ? 'von hier' : eigen.parkplatz ? 'vom Abstellort' : 'ab Zuhause'}</div>
    ${liste.map(s => { const kmStr = s.m / 1000 * UMWEG, an = Math.round(socJetzt() - kmStr * avg()); return ladepunktZeile(s, `ca. ${km(kmStr)}<br>an mit ${an} %`); }).join('')}
    <p class="small muted" style="margin:0">Strecke grob geschätzt (Luftlinie × ${de(UMWEG, 1)}). Tippen: Navigation und als „klappt mit ${esc(ladekarte())}“ oder „ging nicht“ markieren.</p>
  </section>`;
}
// Ampel: grün = hin und zurück mit mindestens 15 % Rest, gelb = nur hin, rot = unterwegs laden
function ampel(f) {
  if (!f.cache) return { klasse: 'muted', text: 'wird berechnet …', km: Infinity };
  const hin = zielRechnung(f.cache, false).ankunft, rz = zielRechnung(f.cache, true).ankunft;
  if (rz < 15 && hin >= REST_LADEN && lade.umkreis(f.p, 1000).some(nutzbar)) {   // Rückweg nach Laden am Ziel
    return { klasse: 'lade', text: `⚡ ${minutenText(lade.ladeMinuten(15 - rz, eigen.akku, ladestrom()))} am Ziel`, km: f.cache.km, hin, rz };
  }
  return { klasse: rz >= 15 ? 'good' : hin >= 15 ? 'warn' : 'bad', text: rz >= 15 ? 'hin und zurück' : hin >= 15 ? 'nur hin' : 'laden', km: f.cache.km, hin, rz };
}
function ampelListe() {
  if (!eigen.zuhause) return `<section class="card"><div class="label">Gemerkte Ziele</div><p class="small muted" style="margin:6px 0 0">Lege in den Einstellungen dein Zuhause fest. Dann zeigt die App hier alle gemerkten Ziele mit Ampel, auch ohne Netz.</p></section>`;
  if (!favoriten().length) return `<section class="card"><div class="label">Gemerkte Ziele</div><p class="small muted" style="margin:6px 0 0">Prüfe ein Ziel und tippe auf „Merken“. Es erscheint dann hier mit Ampel.</p></section>`;
  const zeilen = favoriten().map((f, i) => ({ f, i, ...ampel(f) })).sort((a, b) => a.km - b.km);
  return `<section class="card list">
    <div class="label">Ab ${esc(eigen.zuhause.name)} mit ${socJetzt()} % Akku</div>
    <div class="small muted"><span class="good">●</span> hin und zurück · <span class="lade">●</span> zurück nach Laden am Ziel · <span class="warn">●</span> nur hin · <span class="bad">●</span> laden · jeweils mit 15 % Reserve</div>
    ${zeilen.map(z => `<button class="ampel" data-act="zielFavorit" data-i="${z.i}">
      <span class="punkt ${z.klasse}" aria-hidden="true">●</span>
      <span class="ampel-name"><b>${esc(z.f.kurz)}</b><span class="small muted">${z.f.cache ? `${km(z.f.cache.km)} · ↑ ${z.f.cache.auf} Hm` : z.text}</span></span>
      <span class="mono small ${z.klasse}">${z.f.cache ? `${z.text}<br>${Math.max(0, z.hin)} % / ${z.rz >= 0 ? `${z.rz} %` : '–'}` : ''}</span>
    </button>`).join('')}
  </section>`;
}
let karteObj = null;
function karteZeichnen() {
  if (karteObj) { karteObj.remove(); karteObj = null; }
  const el = $('zKarte'); if (!el) return;
  const r = V.zroute && typeof V.zroute === 'object' && !V.zroute.fehler ? V.zroute : null;
  const start = r?.start.p || V.hier || eigen.parkplatz?.p || eigen.zuhause?.p;
  if (!start) { el.innerHTML = '<p class="small muted" style="padding:12px;margin:0">Karte erscheint, sobald dein Standort bekannt ist oder ein Zuhause festgelegt ist.</p>'; return; }
  const farbe = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0E8F7E';
  karteObj = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });   // Canvas: tausende Ladepunkte bleiben flüssig
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(karteObj);
  const radius = reichweite(socJetzt()) * 1000 / UMWEG;
  L.circle(start, { radius, color: farbe, weight: 1.5, fillOpacity: .06 }).addTo(karteObj);
  const ringGrenzen = L.latLng(start).toBounds(radius * 2);   // ohne Kartenausschnitt berechenbar, anders als circle.getBounds()
  const ladeFarbe = getComputedStyle(document.documentElement).getPropertyValue('--lade').trim() || '#2D6FD0';
  const gutFarbe = getComputedStyle(document.documentElement).getPropertyValue('--good').trim() || '#2F8A4F';
  // Ladepunkte innerhalb des Rings; eigene Erfahrung: grün = klappt, grau = ging nicht.
  // Punktgröße folgt dem Zoom: in der Übersicht klein (sonst ein Klumpen), nah dran groß genug zum Antippen.
  const punktGroesse = (zoom, ok) => Math.max(2, Math.min(9, zoom - 7)) + (ok ? 2 : 0);
  const ladeMarker = [];
  for (const s of lade.umkreis(start, radius)) {
    const st = ladeStatus(s)?.wert;
    const m = L.circleMarker(s.p, { radius: 3, color: '#fff', weight: 1, fillColor: st === 'ok' ? gutFarbe : st === 'nein' ? '#9AA0A6' : ladeFarbe, fillOpacity: st === 'nein' ? .5 : .9 })
      .bindPopup(`<b>${esc(s.b)}</b><br>${esc(lade.adresse(s))}<br>${esc(lade.beschreibung(s))}<br><button class="btn" data-act="ladepunkt" data-key="${lade.schluessel(s)}" style="margin-top:6px">Details und markieren</button>`).addTo(karteObj);
    ladeMarker.push([m, st === 'ok']);
  }
  const groessen = () => { const z = karteObj.getZoom(); for (const [m, ok] of ladeMarker) m.setRadius(punktGroesse(z, ok)); };
  karteObj.on('zoomend', groessen);
  L.circleMarker(start, { radius: 6, color: '#fff', weight: 2, fillColor: farbe, fillOpacity: 1 }).addTo(karteObj);
  if (r) {
    const linie = L.polyline(r.coords, { color: farbe, weight: 5, opacity: .9 }).addTo(karteObj);
    L.circleMarker(r.coords.at(-1), { radius: 7, color: '#fff', weight: 2, fillColor: '#15201E', fillOpacity: 1 }).addTo(karteObj);
    karteObj.fitBounds(linie.getBounds().extend(start), { padding: [24, 24] });
  } else {
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
    for (const f of favoriten()) {
      const a = ampel(f);
      L.circleMarker(f.p, { radius: 5, color: '#fff', weight: 1.5, fillColor: a.klasse === 'muted' ? '#999' : css(a.klasse), fillOpacity: 1 })
        .bindTooltip(f.kurz).addTo(karteObj);
    }
    karteObj.fitBounds(ringGrenzen, { padding: [12, 12] });
  }
  groessen();
}
const LADEORTE = ['Zuhause', 'Bei Freunden', 'Arbeit', 'Öffentlich'];
// Preisvorschlag: zuletzt eingetragener Preis an diesem Ort, sonst Haushaltsstrom bzw. gratis bei Freunden
const preisFuer = ort => eigen.laden.findLast(l => l.ort === ort)?.preis ?? (ort === 'Bei Freunden' ? 0 : STROMPREIS);
// Ladepunkte zur Auswahl: in der Nähe des eigenen Standorts, bewährte zuerst
function ladepunktOptionen() {
  const start = V.hier || eigen.parkplatz?.p || eigen.zuhause?.p; if (!start) return [];
  return nachErfahrung(lade.umkreis(start, 5000), (a, b) => a.m - b.m).slice(0, 8);
}
function ladepunktAuswahl() {
  const opt = ladepunktOptionen(), st = s => ({ ok: ' ✓', nein: ' ✗' })[ladeStatus(s)?.wert] || '';
  return `<select id="lPunkt">${opt.map(s => `<option value="${lade.schluessel(s)}">${esc(s.b)}${st(s)} · ${esc(s.a)} (${entfernung(s.m)})</option>`).join('')}<option value="">Andere Säule / nicht in der Liste</option></select>`;
}
function viewLaden() {
  hierHolen();
  const l = ladungen().slice().reverse(), kwh = x => (x.bis - x.von) / 100 * eigen.akku;
  const ort = V.lOrt || 'Zuhause';
  return `
    <section class="card">
      <div class="label">Neuer Ladevorgang</div>
      <form id="ladeForm" class="list" style="margin-top:8px">
        <div class="grid2"><div class="field"><label for="lVon">Akku vorher %</label><input id="lVon" type="number" inputmode="numeric" min="0" max="100" value="${socJetzt()}"></div>
        <div class="field"><label for="lBis">Akku nachher %</label><input id="lBis" type="number" inputmode="numeric" min="0" max="100" value="100"></div></div>
        <div class="grid2"><div class="field"><label for="lOrt">Ort</label><select id="lOrt">${LADEORTE.map(o => `<option${o === ort ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label for="lPreis">€ pro kWh</label><input id="lPreis" type="number" inputmode="decimal" min="0" step="0.01" value="${preisFuer(ort)}"></div></div>
        <div class="field" id="lPunktFeld"${ort === 'Öffentlich' ? '' : ' hidden'}><label for="lPunkt">Ladepunkt</label>${ort === 'Öffentlich' ? ladepunktAuswahl() : ''}
          <span class="small muted">Nächste Säulen von ${V.hier ? 'deinem Standort' : eigen.parkplatz ? 'deinem Abstellort' : 'Zuhause'}. Nach dem Speichern kannst du sie gleich markieren.</span></div>
        <p class="small muted" id="lFehler" hidden></p>
        <button class="btn primary block" type="submit">Ladevorgang speichern</button>
      </form>
    </section>
    <div class="list">${l.map(x => `
      <section class="card between"${x.ladepunkt ? ` data-act="ladepunkt" data-key="${x.ladepunkt}" role="button" style="cursor:pointer"` : ''}><div style="min-width:0"><b>${esc(x.ort)}${x.ladepunktName ? ` · ${esc(x.ladepunktName)}` : ''}</b><div class="muted small">${esc(x.tag)} · ${x.von} → ${x.bis} %${x.ladepunkt ? ` · ${esc(lade.adresse(lade.finde(x.ladepunkt) || { a: '', o: '' }))}` : ''}</div></div>
        <div style="text-align:right"><div class="mono">${de(kwh(x), 1)} kWh</div><div class="muted small mono">${x.preis ? `${de(kwh(x) * x.preis, 2)} €` : 'gratis'}</div></div></section>`).join('')}</div>`;
}

// ---------- Sim-Tab: Fahrsimulator im Sandkasten (nur mit Entwicklermodus) ----------
function simStarten() {
  V.echt = eigen; eigen = structuredClone(eigen); V.sandbox = true;
  eigen.erfassung = true;   // im Simulator erkennt die App Fahrten immer selbst
  eigen.offen = null;       // eine echte offene Fahrt bleibt in den echten Daten, die Simulation beginnt frei
  tracker.setSim(true).then(() => tracker.setModus(zielModus()));
  devlog.log('sim', { an: true });
}
function simBeenden() {
  simTabStoppen();
  eigen = V.echt; V.echt = null; V.sandbox = false;
  tracker.setSim(false).then(() => tracker.setModus(zielModus()));
  devlog.log('sim', { an: false });
  toast('Simulation beendet, deine echten Daten sind unverändert');
}
simTabVerbinden({
  eigen: () => eigen, tracker: () => tracker, schaetzung, socJetzt, km, toast: t => toast(t),
  start: () => eigen.parkplatz?.p || V.hier || eigen.zuhause?.p || BEXBACH.p,
  // gemerkte Ziele mit ihrer Ampel, für die Leuchtsäulen in 3D
  ziele: () => favoriten().map(f => { const a = ampel(f); return { p: f.p, name: f.kurz, klasse: a.klasse, text: a.text }; }),
});
const TITEL = { heute: 'Heute', fahrten: 'Fahrten', reichweite: 'Reichweite', laden: 'Laden', sim: 'Simulation' };
function render() {
  $('title').textContent = TITEL[V.tab];
  const simTab = document.querySelector('[data-tab="sim"]'); if (simTab) simTab.hidden = !eigen.entwickler && !V.sandbox;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === V.tab ? 'page' : 'false'));
  if (V.tab === 'sim') { simTabZeichnen($('view')); return; }
  $('view').innerHTML = V.tab === 'fahrten' ? viewFahrten() : V.tab === 'reichweite' ? viewReichweite() : V.tab === 'laden' ? viewLaden() : viewHeute();
  karteZeichnen(); fotosZeigen($('view'));
  if (V.tab === 'reichweite') cacheFuellen();
}

// ---------- Overlays ----------
let toastT;
// rueckgaengig: Funktion für den Knopf „Rückgängig“ in der Meldung (steht dann 6 s)
function toast(t, rueckgaengig = null) {
  const el = $('toast'); V.rueckgaengig = rueckgaengig;
  el.innerHTML = esc(t) + (rueckgaengig ? '<button class="toast-knopf" data-act="rueckgaengig">Rückgängig</button>' : '');
  el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; V.rueckgaengig = null; }, rueckgaengig ? 6000 : 3000);
}
const overlay = html => { $('overlay').innerHTML = html; V.fahrtAnsicht = html.includes('class="drive"'); };
const sheetOffen = () => !!$('overlay').querySelector('.sheet');
// art: Art des Dialogs für src/dialoge.js ('warten', 'losfahren', 'ergebnis'); sheetArt(): null = kein Dialog offen
const sheet = (inner, art = '') => { V.sheetNr = (V.sheetNr || 0) + 1; overlay(`<div class="backdrop" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" data-art="${art}"><div class="grip"></div>${inner}</div>`); };
const sheetArt = () => { const el = $('overlay').querySelector('.sheet'); return el ? el.dataset.art || 'anderes' : null; };

let wheelWert = 0, rad = null;
// Akkustand-Rad nach dem Standard Scrollrad MK IV (src/scrollrad.js): Index 0 = 100 %, Index 100 = 0 %
function wheelHtml() { return `<div class="wheel-wrap"><canvas class="wheel" id="wheel" tabindex="0" role="spinbutton" aria-label="Akkustand in Prozent" aria-valuemin="0" aria-valuemax="100"></canvas></div>`; }
// Wert immer aus der echten Radstellung lesen, nicht aus einem zwischengespeicherten Stand
function leseWheel() { if (rad && $('wheel')) wheelWert = 100 - rad.index(); return wheelWert; }
function wheelInit(v) {
  wheelWert = v; $('wheel').setAttribute('aria-valuenow', v);
  V.socVorschlag = v; V.radBeruehrt = false;
  for (const ev of ['pointerdown', 'keydown', 'wheel']) $('wheel').addEventListener(ev, () => { V.radBeruehrt = true; }, { passive: true });
  rad = scrollrad($('wheel'), { anzahl: 101, index: 100 - v, text: i => String(100 - i), einheit: '%',
    onChange: i => { wheelWert = 100 - i; $('wheel')?.setAttribute('aria-valuenow', wheelWert); if ($('lueckeSoc')) $('lueckeSoc').textContent = wheelWert; } });
}
function wheelSetze(v) { if (rad && $('wheel')) rad.setze(100 - v); }
function socSheet(ueberschrift, v, knopf, text, extra = '') {
  V.fotoZiel = knopf[0] === 'save' ? 'ende' : 'start'; V.fotoErkannt = null;
  sheet(`<h2>${ueberschrift}</h2><p class="small muted" style="margin:0">${text}</p>
    ${wheelHtml()}
    <button class="btn block foto-knopf" data-act="foto">📷 Display fotografieren</button>
    <div class="foto-info small" id="fotoInfo" hidden></div>${extra}
    <button class="btn primary block" data-act="${knopf[0]}">${knopf[1]}</button>
    ${knopf[2] ? `<button class="btn block danger" data-act="${knopf[2][0]}">${knopf[2][1]}</button>` : ''}`, knopf[0] === 'go' ? 'losfahren' : '');
  wheelInit(v);
}

// Foto vom Tacho-Display: Drehrad auf den erkannten Wert stellen, übernommen wird erst mit dem Knopf darunter
async function fotoAufnehmen() {
  const ziel = V.fotoZiel, nr = V.sheetNr, datei = await foto.aufnehmen(); if (!datei) return;
  const info = $('fotoInfo'); if (info) { info.hidden = false; info.textContent = 'Foto wird gelesen …'; }
  let r;
  try { r = await foto.verarbeiten(datei, ziel, { speichern: !V.sandbox }); }
  catch (e) { console.warn(e); devlog.log('foto', { schritt: 'fehler', ziel, text: e.message, ...e.daten }); if (info) info.textContent = 'Foto konnte nicht gelesen werden.'; return; }
  // Dialog inzwischen ersetzt (z. B. beim Zurückkommen aus der Kamera wartete eine beendete Fahrt): Foto gehört nirgends hin
  if (nr !== V.sheetNr) { foto.loeschen(r.name); devlog.log('foto', { schritt: 'verworfen', ziel, grund: 'dialog ersetzt', soc: r.soc }); return; }
  // Foto gehört zur Fahrt; aus einem Dialog ohne Fahrt („Akkustand jetzt“, „Losfahren“) wartet es bis zum Beginn
  const o = dialoge.OHNE_FAHRT.includes(sheetArt()) ? null : eigen.offen, feld = ziel === 'ende' ? 'fotoEnde' : 'fotoStart';
  if (r.name) {
    if (o) { foto.loeschen(o[feld]); o[feld] = r.name; sichern(); }
    else { foto.loeschen(V.fotoNeu); V.fotoNeu = r.name; }
  }
  const ok = socPlausibel(r.soc, { start: ziel === 'ende' ? o?.startSoc : null });
  devlog.log('foto', { schritt: 'erkannt', ziel, text: r.text, soc: r.soc, kandidaten: r.kandidaten, km: r.km, plausibel: ok, dauer: r.dauer, quelle: r.quelle, fehler: r.fehler, datei: r.name, bild: r.bild });
  if (ok) { V.fotoErkannt = { ziel, soc: r.soc }; wheelSetze(r.soc); }
  if (!$('fotoInfo')) return;   // Dialog inzwischen geschlossen
  $('fotoInfo').innerHTML = `${r.name ? `<img class="foto-mini" data-foto="${r.name}" alt="Foto vom Display">` : ''}
    <span>${ok ? `Erkannt: <b>${r.soc} %</b>. Bitte prüfen und bestätigen.` : r.soc != null ? `Erkannt: ${r.soc} %, das passt nicht zum Start (${o?.startSoc} %). Drehrad bleibt.` : 'Nicht erkannt. Bitte am Drehrad einstellen.'}</span>`;
  fotosZeigen($('fotoInfo'));
}
// Herkunft des gerade bestätigten Werts; vor fotoBestaetigt() fragen, das V.fotoErkannt zurücksetzt
const wheelHerkunft = () => herkunft({ wert: wheelWert, vorschlag: V.socVorschlag, foto: V.fotoErkannt?.soc, beruehrt: V.radBeruehrt });
// Wert übernommen: im Entwicklermodus festhalten, ob die Erkennung gestimmt hat
function fotoBestaetigt(wert) {
  if (!V.fotoErkannt) return;
  devlog.log('foto', { schritt: 'bestätigt', ziel: V.fotoErkannt.ziel, erkannt: V.fotoErkannt.soc, wert, richtig: V.fotoErkannt.soc === wert });
  V.fotoErkannt = null;
}
function fotosZeigen(wurzel = document) {
  wurzel.querySelectorAll('img[data-foto]:not([src])').forEach(img => foto.url(img.dataset.foto).then(u => { img.src = u; }, () => img.remove()));
}

// ---------- Fahrt ----------
async function melde(id, titel, text) {
  devlog.log('meldung', { id, titel, text, sim: !!V.sandbox });
  if (!NATIV || V.sandbox) { toast(`${titel}: ${text}`); return; }
  try { await LocalNotifications.schedule({ notifications: [{ id, title: titel, body: text, schedule: { at: new Date(Date.now() + 300), allowWhileIdle: true } }] }); }
  catch (e) { console.warn('Benachrichtigung fehlgeschlagen', e); }
}
async function temperaturHolen(p) {
  const t = await temperatur(p);
  if (t == null) return;
  eigen.temp = t; if (eigen.offen && eigen.offen.temp == null) eigen.offen.temp = t;
  sichern(); if (!sheetOffen() && !V.fahrtAnsicht) render();
}
function zielModus() { return eigen.offen?.status === 'faehrt' ? 'fahrt' : eigen.erfassung ? 'warten' : 'aus'; }

// Nie eine offene Fahrt überschreiben (Testfahrt 30.10.2026: so ging eine beendete 4,9-km-Fahrt verloren). false = nicht begonnen
function fahrtBeginnen({ startSoc, startQuelle, punkte = [], km: strecke = 0, manuell }) {
  if (eigen.offen) { devlog.log('fahrt', { schritt: 'beginn abgelehnt', manuell, startSoc, offen: eigen.offen.status, km: eigen.offen.km }); return false; }
  eigen.offen = { t0: Date.now(), km: strecke, punkte, startSoc, startQuelle, status: 'faehrt', manuell, temp: null, brems: 0, beschl: 0, ausschlaege: [] };
  verlauf = []; wartend = [];
  devlog.log('fahrt', { schritt: 'beginn', manuell, startSoc, startQuelle, km: strecke });
  sichern(); tracker.setModus('fahrt');
  if (punkte[0]) temperaturHolen(punkte[0]);
  return true;
}
function fahrtAnsicht() {
  const o = eigen.offen; if (!o || o.status !== 'faehrt') return;
  const g = schaetzung(o);
  overlay(`<div class="drive" role="dialog" aria-label="Fahrt läuft">
    <div class="map" id="map">${karte(o.punkte)}</div>
    <div class="panel">
      <div class="between"><div><div class="label">Fahrt läuft seit ${uhrzeit(o.t0)}</div><div class="big" id="dKm">${km(o.km)}</div></div><button class="btn" data-act="close">Ausblenden</button></div>
      <div class="stat3"><div><div class="num" id="dZeit">0:00</div><div class="muted small">Fahrzeit</div></div><div><div class="num" id="dSoc">${g}</div><div class="muted small">% geschätzt</div></div><div><div class="num" id="dRw">${reichweite(g)}</div><div class="muted small">km Reichweite</div></div></div>
      <div class="stat3"><div><div class="num" id="dHm">–</div><div class="muted small">Höhenmeter ↑/↓</div></div><div><div class="num" id="dStr" style="font-size:18px;line-height:30px">–</div><div class="muted small">Straße</div></div><div><div class="num" id="dBrems">–</div><div class="muted small">stark gebremst</div></div></div>
      ${o.startSoc == null ? `<button class="btn block" data-act="startsoc">Akkustand beim Start eintragen</button>` : ''}
      ${devlog.aktiv() ? `<div class="small mono muted" id="dDev">DEV · warte auf GPS</div>` : ''}
      <button class="btn primary block" data-act="stop">Fahrt beenden</button>
    </div></div>`);
  fahrtAnzeigeAktualisieren();
}
function fahrtAnzeigeAktualisieren() {
  const o = eigen.offen; if (!V.fahrtAnsicht || !o) return;
  const min = (Date.now() - o.t0) / 60000, g = schaetzung(o);
  $('map').innerHTML = karte(o.punkte, o.ausschlaege);
  const dg = V.devGps;
  if ($('dDev') && dg) $('dDev').textContent = `DEV · GPS ±${Math.round(dg.gen)} m · ${de((dg.tempoBerechnet ?? dg.tempo ?? 0) * 3.6, 0)} km/h · vor ${Math.max(0, Math.round((Date.now() - (dg.zeit || Date.now())) / 1000))} s · ${o.punkte.length} Punkte · ${tracker.modus}`;
  const hm = sensoren.hoehenmeter(o.punkte), letzterRau = o.punkte.findLast(p => p[3] != null)?.[3];
  $('dHm').textContent = hm ? `${hm.auf}/${hm.ab}` : '–';
  $('dStr').textContent = sensoren.strasse(letzterRau);
  $('dBrems').textContent = letzterRau != null ? o.brems ?? 0 : '–';
  $('dKm').textContent = km(o.km); $('dZeit').textContent = `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
  $('dSoc').textContent = g; $('dRw').textContent = reichweite(g);
}
function startSocSheet() {
  socSheet('Akkustand beim Start', socJetzt(), ['startok', 'Übernehmen'], 'Wert vom Microlino-Display übernehmen. Vorgeschlagen ist der letzte bekannte Stand.');
}

// ---------- Fahrt nachtragen (SPEC-gps-abbruch.md, src/nachtragen.js) ----------
// Akku eintragen, während die App auf die nächste Fahrt wartet: jetzt starten, eine verpasste Fahrt nachtragen oder nur merken.
// War die App länger zu und hat sich das Handy bewegt, steht „Nachtragen“ oben.
function wartenSheet() {
  const l = nt.lueckeFinden(eigen.spur || [], { seit: socZeit(), jetzt: Date.now() }), oben = !!l?.bewegt;
  V.luecke = l; V.fotoZiel = 'start'; V.fotoErkannt = null;
  const nachtragen = `<button class="btn block${oben ? ' primary' : ''}" data-act="ntAusAkku">Fahrt nachtragen</button>`;
  const starten = `<button class="btn block${oben ? '' : ' primary'}" data-act="go">Fahrt jetzt starten</button>`;
  sheet(`<div class="between"><h2>Akkustand jetzt</h2><span class="small muted">${uhrzeit(Date.now())}</span></div>
    <p class="small muted" style="margin:0">Wert vom Microlino-Display übernehmen. Vorgeschlagen ist der letzte bekannte Stand.</p>
    ${wheelHtml()}
    <button class="btn block foto-knopf" data-act="foto">📷 Display fotografieren</button>
    <div class="foto-info small" id="fotoInfo" hidden></div>
    ${oben ? `<div class="hinweis"><b class="warn">Unterwegs gewesen?</b><span>Seit ${zeitpunkt(l.von)} war die App zu, und das Handy hat sich bewegt. Akku seitdem ${socJetzt()} → <span id="lueckeSoc">${socJetzt()}</span> %.</span></div>` : ''}
    ${oben ? nachtragen + starten : starten + nachtragen}
    <button class="btn-link" data-act="socMerken">Nur Akkustand merken</button>`, 'warten');
  wheelInit(socJetzt());
}
// Gemerkte Ziele mit gespeichertem Weg ab Zuhause ({ kurz, km } einfach)
const ntZiele = () => favoriten().filter(f => f.cache?.km).map(f => ({ kurz: f.kurz, km: f.cache.km }));
const ntKm = (n = V.nt) => nt.strecke({ quelle: n.quelle, zielKm: ntZiele().find(z => z.kurz === n.ziel)?.km, retour: n.retour, handKm: n.handKm });
const zahlOderNull = s => s === '' || s == null ? null : Number(s);
const eingabeZeit = t => Number.isFinite(t) ? nt.alsEingabe(t) : '';
// n: { id (beim Bearbeiten), t0, t1, start, ende, quelle, ziel, retour, handKm, zweck, ausAkku, vorgeschlagen, startQuelle, endeQuelle, fotoEnde }
function ntOeffnen(n) {
  V.nt = { quelle: 'ziel', retour: true, zweck: 'Privat', startQuelle: 'vorschlag', endeQuelle: 'hand', ...n, startAnfang: n.start, endeAnfang: n.ende };
  ntSheet();
}
function ntLesen() {   // Formular → V.nt, damit ein Neuzeichnen nichts verliert
  const n = V.nt, wert = id => $(id)?.value;
  n.t0 = nt.ausEingabe(wert('ntVon')); n.t1 = nt.ausEingabe(wert('ntBis'));
  n.start = zahlOderNull(wert('ntStart')); n.ende = zahlOderNull(wert('ntEnde'));
  if ($('ntKm')) n.handKm = wert('ntKm');
  if ($('ntRetour')) n.retour = $('ntRetour').checked;
  n.zweck = $('overlay').querySelector('#ntZweck [aria-pressed="true"]')?.dataset.zweck || n.zweck;
}
function ntSheet() {
  const offen = $('ntVon') ? $('overlay').querySelector('.sheet') : null;   // Neuzeichnen: Eingaben und Scrollstand behalten
  if (offen) ntLesen();
  const n = V.nt, ziele = ntZiele();
  if (!ziele.length) n.quelle = 'hand';
  const verbrauch = n.start != null && n.ende != null ? n.start - n.ende : 0;
  const sortiert = nt.zielVorschlaege(ziele, { verbrauch, proKm: avg(), retour: n.retour });
  if (!ziele.some(z => z.kurz === n.ziel)) n.ziel = sortiert[0]?.kurz;
  const zeigen = n.alle ? sortiert : sortiert.slice(0, 4);
  if (n.ziel && !zeigen.some(z => z.kurz === n.ziel)) zeigen.push(sortiert.find(z => z.kurz === n.ziel));
  sheet(`<div class="between"><h2>${n.id ? 'Nachgetragene Fahrt' : 'Fahrt nachtragen'}</h2><button class="btn" data-act="close">Abbrechen</button></div>
    <section class="card list">
      <div class="between"><div class="label">Wann</div>${n.vorgeschlagen ? '<span class="small" style="color:var(--accent)">aus dem Log vorgeschlagen</span>' : ''}</div>
      <div class="field"><label for="ntVon">Von</label><input id="ntVon" type="datetime-local" value="${eingabeZeit(n.t0)}"></div>
      <div class="field"><label for="ntBis">Bis</label><input id="ntBis" type="datetime-local" value="${eingabeZeit(n.t1)}"></div>
    </section>
    <section class="card list">
      <div class="label">Akku</div>
      <div class="nt-akku">
        <div class="field"><label for="ntStart">Start${n.id ? '' : ` · Stand ${zeitpunkt(socZeit())}`}</label><input id="ntStart" type="number" inputmode="numeric" min="0" max="100" value="${n.start ?? ''}"></div>
        <span aria-hidden="true">→</span>
        <div class="field"><label for="ntEnde">Ende${n.ausAkku ? ' · eben eingegeben' : ''}</label><input id="ntEnde" type="number" inputmode="numeric" min="0" max="100" value="${n.ende ?? ''}"></div>
        <span class="pill mono warn" id="ntVerbrauch"></span>
      </div>
      <div class="nt-balken" aria-hidden="true"><div id="ntBalkenStart"></div><div id="ntBalkenEnde"></div></div>
    </section>
    <section class="card list">
      <div class="label">Strecke</div>
      ${ziele.length ? `<div class="seg" role="group" aria-label="Strecke angeben">
        <button data-act="ntQuelle" data-wert="ziel" aria-pressed="${n.quelle === 'ziel'}">Ziel wählen</button>
        <button data-act="ntQuelle" data-wert="hand" aria-pressed="${n.quelle === 'hand'}">km eingeben</button></div>`
        : '<p class="small muted" style="margin:0">Keine gemerkten Ziele mit Weg ab Zuhause. Die km von Hand eingeben.</p>'}
      ${n.quelle === 'ziel' ? `${zeigen.map(z => `<button class="nt-ziel" data-act="ntZiel" data-ziel="${esc(z.kurz)}" aria-pressed="${z.kurz === n.ziel}"><span class="radio" aria-hidden="true"></span><b>${esc(z.kurz)}</b><span class="mono small muted">${km(z.km)}</span></button>`).join('')}
        ${zeigen.length < sortiert.length ? `<button class="btn-link" data-act="ntAlleZiele">Alle ${sortiert.length} Ziele zeigen</button>` : ''}
        <label class="switch" for="ntRetour"><span>Hin und zurück</span><input type="checkbox" id="ntRetour" ${n.retour ? 'checked' : ''}></label>`
      : `<div class="field"><label for="ntKm">Gefahrene km</label><input id="ntKm" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(n.handKm ?? '')}"></div>`}
      <div class="between nt-summe"><span class="small muted">Strecke geschätzt, ohne GPS-Spur</span><b id="ntSumme"></b></div>
    </section>
    <div class="chips" id="ntZweck">${ZWECKE.map(z => `<button class="chip" data-zweck="${z}" aria-pressed="${z === n.zweck}">${z}</button>`).join('')}</div>
    <p class="small bad" id="ntFehler" style="margin:0" hidden></p>
    <button class="btn primary block" data-act="ntSpeichern">Fahrt speichern</button>
    ${n.id ? `<button class="btn danger block" data-act="ntLoeschen">${n.loeschen ? 'Wirklich löschen' : 'Fahrt löschen'}</button>` : ''}`);
  if (offen) $('overlay').querySelector('.sheet').scrollTop = offen.scrollTop;
  ntAnzeige();
}
function ntAnzeige() {   // Verbrauch, Balken und Strecke nach jeder Eingabe
  const n = V.nt; if (!n || !$('ntSumme')) return;
  const v = n.start != null && n.ende != null ? n.start - n.ende : null, k = ntKm();
  $('ntVerbrauch').textContent = v == null ? '–' : `${v >= 0 ? '−' : '+'}${Math.abs(v)} %`;
  $('ntBalkenStart').style.width = `${n.start ?? 0}%`; $('ntBalkenEnde').style.width = `${Math.min(n.ende ?? 0, n.start ?? 0)}%`;
  $('ntSumme').textContent = k == null ? '–' : `≈ ${km(k)}`;
}
function ntSpeichern() {
  ntLesen();
  const n = V.nt, jetzt = Date.now(), strecke = ntKm();
  const fehler = nt.pruefen({ t0: n.t0, t1: n.t1, start: n.start, ende: n.ende, km: strecke, jetzt });
  if (fehler) { $('ntFehler').hidden = false; $('ntFehler').textContent = fehler; return; }
  const f = nt.nachtragFahrt({ id: n.id, t0: n.t0, t1: n.t1, start: n.start, ende: n.ende, km: strecke, zweck: n.zweck, quelle: n.quelle, ziel: n.ziel, retour: n.retour,
    startQuelle: n.start === n.startAnfang ? n.startQuelle : 'hand', endeQuelle: n.ende === n.endeAnfang ? n.endeQuelle : 'hand', fotoEnde: n.fotoEnde });
  const vorher = { fahrten: eigen.fahrten.slice(), soc: eigen.soc, socT: eigen.socT };
  eigen.fahrten = eigen.fahrten.filter(x => x.id !== n.id);   // beim Bearbeiten ersetzen, sonst nach Beginn einsortieren
  eigen.fahrten.splice(eigen.fahrten.findLastIndex(x => x.t0 <= f.t0) + 1, 0, f);
  if (n.ausAkku) { eigen.soc = f.ende; eigen.socT = jetzt; }
  else if (f.t1 >= socZeit()) { eigen.soc = f.ende; eigen.socT = f.t1; }
  { const { punkte, ...kurzfassung } = f; devlog.log('fahrt', { schritt: 'nachgetragen', bearbeitet: !!n.id, ...kurzfassung }); }
  V.nt = null; sichern(); overlay(''); V.tab = 'fahrten'; render();
  toast(n.id ? 'Fahrt geändert' : 'Fahrt nachgetragen', () => {
    Object.assign(eigen, vorher); sichern(); render();
    devlog.log('fahrt', { schritt: 'nachtrag rückgängig', id: f.id });
  });
}
function ntLoeschen() {
  const id = V.nt.id, vorher = eigen.fahrten.slice();
  eigen.fahrten = eigen.fahrten.filter(x => x.id !== id);
  devlog.log('fahrt', { schritt: 'nachtrag gelöscht', id });
  V.nt = null; sichern(); overlay(''); render();
  toast('Fahrt gelöscht', () => { eigen.fahrten = vorher; sichern(); render(); devlog.log('fahrt', { schritt: 'löschen rückgängig', id }); });
}
// Spur für die Lücken-Erkennung: App sichtbar/verborgen und Bewegung, auch ohne Entwicklermodus
devlog.mitlesen((typ, daten) => {
  if (!V.sandbox && nt.spurAnhaengen(eigen.spur ??= [], nt.spurZeile(typ, daten, Date.now()))) speichernSpaeter(eigen);
});
// Abstellort = letzter Streckenpunkt. Der vorige wird gemerkt, falls die Fahrt verworfen wird (Bus, Velo …).
function parkplatzSetzen(o) {
  o.parkVorher = eigen.parkplatz;
  const p = o.punkte.at(-1);
  if (eigen.parkplatzMerken && p) eigen.parkplatz = { p: [p[0], p[1]], t: o.t1 };
}
function fahrtBeenden(zeit = Date.now()) {
  const o = eigen.offen; if (!o || o.status !== 'faehrt') return;
  if (kurzVerwerfen(o, zeit)) return;
  o.status = 'beendet'; o.t1 = fahrtEnde(o.t0, zeit); parkplatzSetzen(o); sichern();
  devlog.log('fahrt', { schritt: 'ende', ausgeloest: 'hand oder sichtbar', km: o.km, t1: o.t1, gemeldet: zeit });
  tracker.setModus(zielModus());
  endeSheet();
}
function endeSheet() {
  const o = eigen.offen; if (!o) return;
  if (o.startSoc == null) {   // erst den Start nachtragen, dann das Ende
    socSheet(`Fahrt beendet · ${km(o.km)}`, socJetzt(), ['startok', 'Weiter'], 'Zuerst den Akkustand beim <b>Start</b> nachtragen. Vorgeschlagen ist der letzte bekannte Stand.');
    return;
  }
  socSheet(`Fahrt beendet · ${km(o.km)}`, schaetzung(o), ['save', 'Fahrt speichern', ['discard', 'Fahrt verwerfen']],
    'Akkustand <b>jetzt</b> vom Microlino-Display übernehmen. Vorgeschlagen ist die Schätzung aus deinem Verbrauch.',
    `<div class="label">Zweck</div><div class="chips" id="zweck">${ZWECKE.map((z, i) => `<button class="chip" data-zweck="${z}" aria-pressed="${i === 0}">${z}</button>`).join('')}</div>
     <p class="small warn" id="plausi" style="margin:0" hidden></p>`);
  V.plausiGefragt = false;
}
// Weicht der eingestellte Wert stark von der Schätzung ab, einmal nachfragen statt gleich zu speichern
function plausibel() {
  const o = eigen.offen, wert = leseWheel(), erwartet = schaetzung(o);
  if (V.plausiGefragt || Math.abs(wert - erwartet) < Math.max(10, o.km * avg() * 0.5)) return true;
  V.plausiGefragt = true;
  const el = $('plausi'); el.hidden = false;
  el.innerHTML = `Geschätzt waren etwa <b>${erwartet} %</b>, eingestellt sind <b>${wert} %</b>. Stimmt das? Zum Speichern noch einmal tippen.`;
  devlog.log('eingabe', { plausi: 'nachgefragt', wert, erwartet, km: o.km });
  return false;
}
// Automatisch erkannte Mini-Fahrt (Rangieren, GPS-Wackler) ohne Rückfrage verwerfen
function kurzVerwerfen(o, zeit) {
  if (o.manuell || o.km >= MIN_KM) return false;
  devlog.log('fahrt', { schritt: 'verworfen', ausgeloest: 'zu kurz', km: o.km, t1: zeit });
  fahrtVerwerfen(); toast(`Kurze Bewegung (${Math.round(o.km * 1000)} m) nicht als Fahrt gespeichert`);
  return true;
}
function fahrtVerwerfen() {
  if (eigen.offen && 'parkVorher' in eigen.offen) eigen.parkplatz = eigen.offen.parkVorher;
  if (eigen.offen && !V.sandbox) foto.loeschen(eigen.offen.fotoStart, eigen.offen.fotoEnde);
  eigen.offen = null; sichern(); tracker.setModus(zielModus()); overlay(''); render();
}
function fahrtSpeichern() {
  const o = eigen.offen; if (!o) return;
  const zweck = $('overlay').querySelector('[data-zweck][aria-pressed="true"]')?.dataset.zweck || 'Privat';
  const ende = Math.min(o.startSoc, wheelWert), t1 = fahrtEnde(o.t0, o.t1 || Date.now());   // auch für eine schon so beendete, offene Fahrt
  const f = { id: 'f' + o.t0, tag: datum(o.t0), t0: o.t0, t1, von: uhrzeit(o.t0), nach: uhrzeit(t1), km: Math.round(o.km * 10) / 10, start: o.startSoc, ende, temp: o.temp, zweck, punkte: o.punkte };
  f.startQuelle = o.startQuelle || 'drehrad'; f.endeQuelle = wheelHerkunft();
  if (o.fotoStart) f.fotoStart = o.fotoStart;
  if (o.fotoEnde) f.fotoEnde = o.fotoEnde;
  fotoBestaetigt(wheelWert);
  const hm = sensoren.hoehenmeter(o.punkte), rau = sensoren.rauAnteil(o.punkte);
  if (hm) { f.hm = hm.auf; f.hmAb = hm.ab; }
  if (rau != null) Object.assign(f, { rau, brems: o.brems ?? 0, beschl: o.beschl ?? 0, ausschlaege: o.ausschlaege ?? [] });
  { const { punkte, ausschlaege, ...kurzfassung } = f; devlog.log('fahrt', { schritt: 'gespeichert', ...kurzfassung, punkte: punkte.length }); }
  const vorher = avg(); eigen.fahrten.push(f); eigen.soc = ende; eigen.socT = t1; eigen.offen = null; sichern();
  tracker.setModus(zielModus());
  const kurz = f.start - f.ende < 3 || f.km < 1, v = kurz ? 0 : (f.start - f.ende) / f.km, steig = steigAnteil(f);
  const d = kurz ? 0 : Math.round(((v - steig / f.km) / vorher - 1) * 100);   // Vergleich ohne den Anteil der Steigung
  const h = (t1 - o.t0) / 3600000, tempo = h > 0 ? f.km / h : 0;
  sheet(`<div class="label">${km(f.km)} · ${f.start} → ${f.ende} % · ${esc(zweck)}</div>
    ${kurz ? `<h2 class="warn">Kurze Fahrt</h2><p class="small" style="margin:0">${f.km < 1 ? 'Unter 1 km zählt sie nicht in den Schnitt, die Fahrt bleibt aber im Fahrtenbuch.' : 'Zu wenig Prozent für einen genauen Einzelwert. Die Fahrt zählt trotzdem im Schnitt mit.'}</p>`
      : nurSchaetzung(f) ? `<h2>Schätzung übernommen</h2><p class="small" style="margin:0">Der Akkustand am Ende war die unveränderte Schätzung. Damit der Verbrauch nicht sich selbst bestätigt, zählt die Fahrt nicht in den Schnitt. Beim nächsten Mal den Wert vom Display einstellen oder fotografieren.</p>`
      : !zaehlt(f) ? `<h2 class="warn">${de(v, 1)} %/km</h2><p class="small" style="margin:0">Das ist mehr, als der Microlino verbrauchen kann (über ${MAX_VERBRAUCH} %/km). Vermutlich stimmt ein Akkuwert nicht; die Fahrt zählt nicht in den Schnitt.</p>`
      : `<div class="big">${de(v, 2)} %/km</div><div class="muted">${de(v * eigen.akku, 1)} kWh/100 km</div>
         <p style="margin:0" class="${d > 5 ? 'warn' : d < -5 ? 'good' : 'muted'}">${d > 5 ? `${d} % mehr als ${gelernt(eigen.fahrten.slice(0, -1)) ? 'üblich' : 'der Startwert'}` : d < -5 ? `${-d} % sparsamer als ${gelernt(eigen.fahrten.slice(0, -1)) ? 'üblich' : 'der Startwert'}` : 'Verbrauch wie üblich'}</p>
         <section class="card small"><div class="label">Warum?</div><div class="list" style="margin-top:6px">
           <div class="between"><span>Temperatur</span><b>${f.temp != null ? `${f.temp} °C` : 'unbekannt'}</b></div>
           <div class="between"><span>Ø Tempo</span><b>${de(tempo, 0)} km/h</b></div>
           ${f.hm != null ? `<div class="between"><span>Höhenmeter ↑ ${f.hm} / ↓ ${f.hmAb}</span><b>${steig >= .5 ? `≈ ${de(steig, 0)} % Akku` : 'kaum Einfluss'}</b></div>` : ''}
           ${f.rau != null ? `<div class="between"><span>Fahrstil</span><b>${f.brems}× stark gebremst, ${f.beschl}× stark beschleunigt</b></div>
           <div class="between"><span>Straße</span><b>${f.rau ? `${f.rau} % rau` : 'glatt'}</b></div>` : ''}</div></section>`}
    <div class="card hero">${ring(ende)}<div><div class="label">Jetzt</div><div class="big">ca. ${reichweite(ende)} km</div><div class="muted small">Reichweite bei ${ende} %</div></div></div>
    <button class="btn primary block" data-act="close">Fertig</button>`, 'ergebnis');
  render();
}

// Sensoren: bei jedem neuen Streckenpunkt die Zusammenfassung seit dem letzten abholen.
// Ein Punkt ist danach [lat, lon, Höhe in m (Barometer), senkrechtes Rütteln in m/s²].
let verlauf = [], wartend = [];   // GPS-Tempo der letzten Minute; starke Ausschläge, die noch auf das Tempo danach warten
async function sensorenAnhaengen(punkt) {
  const s = await sensoren.abholen(); if (!s) return;
  devlog.log('sensor', { punkt: [punkt[0], punkt[1]], ...s });
  punkt[2] = s.hoehe != null ? Math.round(s.hoehe * 10) / 10 : null;
  if (s.rau != null) punkt[3] = Math.round(s.rau * 10) / 10;
  wartend.push(...(s.ausschlaege || []));
}
function tempoUm(t) {   // GPS-Tempo am nächsten an t, höchstens 1,5 s daneben
  let best = null;
  for (const x of verlauf) if (!best || Math.abs(x[0] - t) < Math.abs(best[0] - t)) best = x;
  return best && Math.abs(best[0] - t) <= 1500 ? best[1] : null;
}
// Ob ein Ausschlag Bremsen, Beschleunigen oder eine Kurve war, zeigt das GPS-Tempo 2 s davor und danach.
// So muss die App nicht wissen, wie herum das Handy im Halter sitzt.
function ausschlaegeEinordnen(o, jetzt) {
  wartend = wartend.filter(a => {
    if (jetzt < a.t + 2000) return true;
    const vor = tempoUm(a.t - 2000), nach = tempoUm(a.t + 2000);
    if (vor == null || nach == null) return false;
    const typ = nach - vor <= -sensoren.TEMPO_SPRUNG ? 'B' : nach - vor >= sensoren.TEMPO_SPRUNG ? 'A' : null;
    if (!typ) return false;
    o.ausschlaege ??= []; o.ausschlaege.push([o.punkte.length - 1, typ]);
    if (typ === 'B') o.brems = (o.brems ?? 0) + 1; else o.beschl = (o.beschl ?? 0) + 1;
    return false;
  });
}

// Fahrterkennung: Rückmeldungen vom GPS
const tracker = createTracker({
  onLog(typ, daten) { devlog.log(typ, daten); if (typ === 'gps') V.devGps = daten; },
  onStart(start, punkt) {
    if (eigen.offen) return;
    fahrtBeginnen({ startSoc: null, punkte: [start.p, punkt.p], km: distanz(start.p, punkt.p) / 1000, manuell: false });
    eigen.offen.gps = gpsStand(null, punkt);
    if (V.sandbox) {   // im Simulator nicht unterbrechen: Start-Akku = aktueller Stand, Anzeige oben im Sim-Tab
      eigen.offen.startSoc = socJetzt(); eigen.offen.startQuelle = 'vorschlag'; toast('Fahrt erkannt (Simulation)'); simHud(); return;
    }
    melde(1, 'Fahrt erkannt', 'Tippen, um den Akkustand beim Start einzutragen.');
    if (document.visibilityState === 'visible') { fahrtAnsicht(); startSocSheet(); } else render();
  },
  onPunkt(punkt) {
    const o = eigen.offen; if (!o || o.status !== 'faehrt') return;
    const letzter = o.punkte.at(-1);
    if (!letzter) o.punkte.push(punkt.p);
    else {
      const d = distanz(letzter, punkt.p);
      if (d >= PUNKT_ABSTAND) { o.km += d / 1000; const neu = [+punkt.p[0].toFixed(5), +punkt.p[1].toFixed(5)]; o.punkte.push(neu); sensorenAnhaengen(neu); }
    }
    o.gps = gpsStand(o.gps, punkt);   // für den Wächter, auch nach einem Neustart der App
    verlauf.push([punkt.t, punkt.tempo]); while (verlauf[0][0] < punkt.t - 60000) verlauf.shift();
    ausschlaegeEinordnen(o, punkt.t);
    if (o.temp == null && o.punkte.length === 1) temperaturHolen(punkt.p);
    if (!V.sandbox) speichernSpaeter(eigen);
    fahrtAnzeigeAktualisieren();
  },
  onStopp(ruhe) {
    const o = eigen.offen; if (!o || o.status !== 'faehrt') return;
    if (kurzVerwerfen(o, ruhe.t)) return;
    melde(2, 'Fahrt beendet', `${km(o.km)} – tippen, um den Akkustand einzutragen.`);
    if (document.visibilityState === 'visible') fahrtBeenden(ruhe.t);
    else { o.status = 'beendet'; o.t1 = fahrtEnde(o.t0, ruhe.t); parkplatzSetzen(o); sichern(); tracker.setModus(zielModus()); render(); devlog.log('fahrt', { schritt: 'ende', ausgeloest: 'hintergrund', km: o.km, t1: o.t1, gemeldet: ruhe.t }); }
  },
  onFehler(code) {
    if (code === 'standort') { V.standortFehler = true; toast('Standort nicht erlaubt. In den Einstellungen freigeben.'); }
    else console.warn('GPS-Fehler', code);
  },
});

// Wächter (SPEC-gps-abbruch.md, Stufe 1): Hat Android den GPS-Dienst mitten in der Fahrt beendet, kommen keine Punkte
// mehr und die Erkennung kommt nie zum Stopp. Beim Start und Sichtbarwerden: letzter Punkt älter als STOPP_DAUER →
// Fahrt endet am letzten bewegten Punkt (onStopp, dann die gewohnte Akku-Abfrage). Sonst GPS neu anfordern.
function waechter({ neuStarten = true } = {}) {
  const o = eigen.offen;
  if (o?.status === 'faehrt' && !V.sandbox && tracker.pruefeAusfall(Date.now(), o.gps)) return;
  if (neuStarten && !V.sandbox) tracker.neuStarten();
}
// Akku-Optimierung, Energiesparmodus und Standortrecht (nur in der App); true, wenn sich etwas geändert hat
async function systemPruefen() {
  const s = await sensoren.systemStatus(); if (!s) return false;
  const neu = JSON.stringify(s) !== JSON.stringify(V.system);
  V.system = s; if (neu) devlog.log('app', { system: s });
  return neu;
}
function systemKarte() {
  const s = V.system;
  const zeile = (name, wert, klasse) => `<div class="between"><span>${name}</span><span class="pill ${klasse}">${wert}</span></div>`;
  return `<section class="card list">
    <div class="label">Akku und Standort</div>
    ${s ? zeile('Akku', s.akkuEingeschraenkt ? 'eingeschränkt' : 'nicht eingeschränkt', s.akkuEingeschraenkt ? 'warn' : 'good')
      + zeile('Standort', { immer: 'immer', nutzung: 'nur bei Nutzung', nein: 'nicht erlaubt' }[s.standort] ?? s.standort, s.standort === 'nein' ? 'bad' : 'good')
      + (s.energiesparen ? zeile('Energiesparmodus', 'an', 'warn') : '')
      : `<p class="small muted" style="margin:0">Nur in der App abfragbar.</p>`}
    <p class="small muted" style="margin:0">Damit Android die Fahrterkennung nicht beendet: Akku <b>„Nicht eingeschränkt“</b>. Für den Standort reicht „Während der Nutzung“, solange die Dauer-Benachrichtigung zu sehen ist. Beides steht in den App-Infos.</p>
    <div class="grid2"><button class="btn" data-act="appInfosAkku">Akku-Einstellung</button><button class="btn" data-act="appInfosStandort">Standort-Recht</button></div>
  </section>`;
}
// Ereignisse vom nativen Lebenszeichen ins Entwickler-Log
sensoren.aufEreignisse((name, d) => {
  if (name === 'gpsAusfall') devlog.log('fehler', { quelle: 'gps-ausfall', ...d });
  else if (name === 'dienstWeg') devlog.log('fehler', { quelle: 'gps-dienst', text: 'Dienst beendet', ...d });
  else if (name === 'gpsZurueck') devlog.log('modus', { gps: 'zurück', ...d });
  else if (name === 'energie') devlog.log('modus', d);
});

// Beim Öffnen der App: offene Fahrt fortsetzen oder nachfragen. Ein Dialog von vor der Fahrt („Akkustand jetzt“,
// „Losfahren“, Ergebnis der vorigen Fahrt) gilt dann nicht mehr und weicht (src/dialoge.js).
function pruefeOffen() {
  const art = sheetArt(), was = dialoge.beimOeffnen(eigen.offen, art); if (!was) return;
  if (art) {
    devlog.log('fahrt', { schritt: 'dialog ersetzt', dialog: art, offen: eigen.offen.status, km: eigen.offen.km });
    foto.loeschen(V.fotoNeu); V.fotoNeu = null; V.fotoErkannt = null;
  }
  if (was === 'ende') endeSheet();
  else if (was === 'start') { fahrtAnsicht(); startSocSheet(); }
  else fahrtAnsicht();
}

async function erfassungSetzen(an) {
  if (an && NATIV) {
    const p = await LocalNotifications.requestPermissions().catch(() => ({ display: 'denied' }));
    if (p.display !== 'granted') toast('Ohne Benachrichtigungen meldet die App erkannte Fahrten nicht.');
  }
  eigen.erfassung = an; V.standortFehler = false; sichern();
  await tracker.setModus(zielModus());
}

function settingsSheet() {
  sheet(`<h2>Einstellungen</h2>
    <div class="field"><label for="akku">Akku deines Microlino</label><select id="akku">${[5.5, 10.5, 15].map(k => `<option value="${k}" ${k === eigen.akku ? 'selected' : ''}>${k === 5.5 ? 'Short Range' : k === 10.5 ? 'Mid Range' : 'Long Range'} · ${de(k, 1)} kWh</option>`).join('')}</select></div>
    <label class="switch card" for="erfassung"><span><b>Fahrterkennung</b><br><span class="small muted">Erkennt Fahrten ab etwa 11 km/h und beendet sie nach 3 Minuten Stillstand. Solange sie an ist, zeigt Android eine Dauer-Benachrichtigung und das GPS bleibt aktiv; das kostet etwas Akku am Handy. Nach einem Neustart des Handys die App einmal öffnen.</span></span>
      <input type="checkbox" id="erfassung" ${eigen.erfassung ? 'checked' : ''}></label>
    ${systemKarte()}
    <div class="field"><label for="ladekarte">Deine Ladekarte</label><input id="ladekarte" type="search" value="${esc(ladekarte())}" maxlength="30">
      <span class="small muted">${Object.keys(erfahrung().punkte).length} Säulen und ${Object.keys(erfahrung().betreiber).length} Betreiber markiert. Markieren: in einer Ladepunkt-Liste auf die Säule tippen.</span></div>
    <div class="field"><label for="ladestrom">Ladestrom unterwegs (Ampere)</label><input id="ladestrom" type="number" inputmode="numeric" min="6" max="32" step="1" value="${ladestrom()}">
      <span class="small muted">≈ ${de(lade.ladeKw(ladestrom()), 1)} kW im Akku · 10 % dauern etwa ${minutenText(lade.ladeMinuten(10, eigen.akku, ladestrom()))}. Daraus rechnet die App die Ladezeiten.</span></div>
    <section class="card list">
      <div class="label">Zuhause</div>
      <p class="small" style="margin:0">${eigen.zuhause ? `<b>${esc(eigen.zuhause.name)}</b> (${eigen.zuhause.p.map(v => v.toFixed(3)).join(', ')}). Wege ab hier zu gemerkten Zielen speichert die App, sie gehen dann auch ohne Netz.` : 'Nicht festgelegt.'}</p>
      <div class="grid2"><button class="btn" data-act="zuhauseHier">Hier ist Zuhause</button>${eigen.zuhause ? `<button class="btn" data-act="zuhauseWeg">Entfernen</button>` : ''}</div>
    </section>
    <label class="switch card" for="parkplatzMerken"><span><b>Abstellort merken</b><br><span class="small muted">Merkt sich am Ende jeder Fahrt, wo der Microlino steht, und zeigt es unter „Heute“. Bleibt nur auf diesem Handy. Ausschalten löscht den gespeicherten Ort.</span></span>
      <input type="checkbox" id="parkplatzMerken" ${eigen.parkplatzMerken ? 'checked' : ''}></label>
    ${V.standortFehler ? `<button class="btn block" data-act="standort">Standort-Freigabe öffnen</button>` : ''}
    <label class="switch card" for="fotoExport"><span><b>Fotos beim Export mitgeben</b><br><span class="small muted">Die CSV bekommt die Spalten „Foto Start“ und „Foto Ende“, beim Teilen und Speichern kommen die Display-Fotos der Fahrten mit. Aus: Export wie bisher.</span></span>
      <input type="checkbox" id="fotoExport" ${eigen.fotoExport ? 'checked' : ''}></label>
    ${fahrten().length ? `<button class="btn block" data-act="csvTeilen">Fahrtenbuch als CSV teilen</button>` : ''}
    <section class="card list">
      <label class="switch" for="entwickler"><span><b>Entwicklermodus</b><br><span class="small muted">Schreibt jede GPS-Position, die Sensorwerte und alle Schritte der Fahrterkennung in eine Datei pro Tag (JSON Lines). Bleibt 14 Tage auf dem Handy, dann wird es gelöscht. Kein zusätzlicher Handy-Akku, nur etwas Speicher.</span></span>
        <input type="checkbox" id="entwickler" ${devlog.aktiv() ? 'checked' : ''}></label>
      ${devlog.aktiv() ? `<p class="small mono muted" id="devInfo" style="margin:0">Logs werden gezählt …</p>
        <div class="grid2"><button class="btn" data-act="devTeilen">Logs teilen</button>${V.devLoeschen
          ? `<button class="btn danger" data-act="devLoeschenJa">Wirklich löschen</button>` : `<button class="btn" data-act="devLoeschen">Logs löschen</button>`}</div>` : ''}
    </section>
    ${V.loeschen ? `<p class="small bad" style="margin:0">Alle ${fahrten().length} Fahrten und ${ladungen().length} Ladevorgänge werden gelöscht. Das lässt sich nicht rückgängig machen.</p>
      <div class="grid2"><button class="btn" data-act="loeschenNein">Abbrechen</button><button class="btn danger" data-act="loeschenJa">Endgültig löschen</button></div>`
      : `<button class="btn block danger" data-act="loeschen">Alle Daten löschen</button>`}
    <p class="small muted" style="margin:0">Alle Daten bleiben auf diesem Handy. Nur die Temperatur wird bei Open-Meteo abgefragt.</p>
    <p class="small muted mono" style="margin:0;text-align:center">Bubble Log ${__APP_VERSION__}</p>
    <button class="btn primary block" data-act="close">Fertig</button>`);
  systemPruefen().then(neu => { if (neu && $('overlay').querySelector('.sheet h2')?.textContent === 'Einstellungen') settingsSheet(); });
  if (devlog.aktiv()) devlog.flush().then(devlog.dateien).then(liste => {
    const el = $('devInfo'); if (!el) return;
    const kb = liste.reduce((s, f) => s + f.groesse, 0) / 1024;
    el.textContent = liste.length ? `${liste.length} ${liste.length === 1 ? 'Datei' : 'Dateien'} · ${de(kb, kb < 100 ? 1 : 0)} KB · neueste ${liste[0].name}` : 'Noch keine Logs';
  });
}

// ---------- Ereignisse ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab],[data-filter],[data-ziel],[data-zweck]'); if (!t || t.disabled) return;
  if (t.tagName === 'SECTION' && e.target.closest('a,button,input,select')) return;   // Klicks in Bedienelementen einer klickbaren Karte
  const d = t.dataset;
  leseWheel();
  if (d.tab) {
    if (V.tab === 'sim' && d.tab !== 'sim') simBeenden();
    const vorher = V.tab; V.tab = d.tab; overlay('');
    if (d.tab === 'sim' && vorher !== 'sim') simStarten();
    render(); $('view').scrollTop = 0; return;
  }
  if (d.filter) { V.filter = d.filter; render(); return; }
  if (d.zweck) { t.parentElement.querySelectorAll('[data-zweck]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); return; }
  if (simAktion(d.act)) return;
  if (dialoge.veraltet(d.act, eigen.offen)) {   // Knopf aus einem Dialog von vor der Fahrt: nichts überschreiben
    devlog.log('fahrt', { schritt: 'knopf veraltet', aktion: d.act, offen: eigen.offen.status, km: eigen.offen.km });
    toast('Inzwischen wurde eine Fahrt erkannt'); pruefeOffen(); return;
  }
  switch (d.act) {
    case 'start': if (!eigen.offen && zielModus() === 'warten') wartenSheet(); else if (!eigen.offen) socSheet('Akkustand beim Start', socJetzt(), ['go', 'Losfahren'], 'Wert vom Microlino-Display übernehmen. Vorgeschlagen ist der letzte bekannte Stand.'); break;
    case 'go':
      if (!fahrtBeginnen({ startSoc: wheelWert, startQuelle: wheelHerkunft(), manuell: true })) break;
      fotoBestaetigt(wheelWert);
      if (V.fotoNeu) { eigen.offen.fotoStart = V.fotoNeu; V.fotoNeu = null; sichern(); }
      fahrtAnsicht(); break;
    case 'foto': fotoAufnehmen(); break;
    case 'fotoGross': sheet(`<img class="foto-gross" data-foto="${esc(d.foto)}" alt="Foto vom Display"><button class="btn primary block" data-act="close">Schließen</button>`); fotosZeigen($('overlay')); break;
    case 'zeigen': fahrtAnsicht(); break;
    case 'startsoc': startSocSheet(); break;
    case 'startok': {
      const o = eigen.offen; if (!o) break;
      o.startSoc = wheelWert; o.startQuelle = wheelHerkunft(); sichern();
      devlog.log('eingabe', { startSoc: wheelWert, quelle: o.startQuelle }); fotoBestaetigt(wheelWert);
      if (o.status === 'beendet') endeSheet(); else fahrtAnsicht();
      break;
    }
    case 'stop': fahrtBeenden(); break;
    case 'ende': endeSheet(); break;
    case 'save': if (plausibel()) fahrtSpeichern(); break;
    case 'discard': devlog.log('fahrt', { schritt: 'verworfen', km: eigen.offen?.km }); fahrtVerwerfen(); toast('Fahrt verworfen'); break;
    case 'close':
      V.loeschen = false; V.devLoeschen = false; foto.loeschen(V.fotoNeu); V.fotoNeu = null;
      if (V.nt && !V.nt.id) foto.loeschen(V.nt.fotoEnde);   // abgebrochener Nachtrag: Foto gehört zu keiner Fahrt
      V.nt = null; overlay(''); render(); break;
    case 'socMerken':
      eigen.soc = wheelWert; eigen.socT = Date.now(); sichern();
      devlog.log('eingabe', { soc: wheelWert, quelle: wheelHerkunft(), nurMerken: true }); fotoBestaetigt(wheelWert);
      foto.loeschen(V.fotoNeu); V.fotoNeu = null; overlay(''); render(); toast(`Akkustand ${wheelWert} % gemerkt`); break;
    case 'ntAusAkku': {
      const l = V.luecke;
      ntOeffnen({ ausAkku: true, vorgeschlagen: !!l, t0: l?.von ?? NaN, t1: Date.now(), start: socJetzt(), ende: wheelWert, endeQuelle: wheelHerkunft(), fotoEnde: V.fotoNeu });
      fotoBestaetigt(wheelWert); V.fotoNeu = null; break;
    }
    case 'ntNeu': ntOeffnen({ t0: NaN, t1: NaN, start: eigen.soc, ende: null }); break;
    case 'ntBearbeiten': {
      const f = fahrten().find(x => x.id === d.id); if (!f) break;
      const s = f.strecke || { quelle: 'hand' };
      ntOeffnen({ id: f.id, t0: f.t0, t1: f.t1, start: f.start, ende: f.ende, zweck: f.zweck, quelle: s.quelle, ziel: s.ziel, retour: s.retour ?? true,
        handKm: s.quelle === 'hand' ? String(f.km) : '', startQuelle: f.startQuelle, endeQuelle: f.endeQuelle, fotoEnde: f.fotoEnde });
      break;
    }
    case 'ntQuelle': V.nt.quelle = d.wert; ntSheet(); break;
    case 'ntZiel': V.nt.ziel = d.ziel; ntSheet(); break;
    case 'ntAlleZiele': V.nt.alle = true; ntSheet(); break;
    case 'ntSpeichern': ntSpeichern(); break;
    case 'ntLoeschen': if (V.nt.loeschen) ntLoeschen(); else { V.nt.loeschen = true; ntSheet(); } break;
    case 'rueckgaengig': { const f = V.rueckgaengig; V.rueckgaengig = null; $('toast').hidden = true; f?.(); break; }
    case 'charge': V.tab = 'laden'; render(); $('lVon')?.focus(); break;
    case 'settings': settingsSheet(); break;
    case 'standort': tracker.oeffneEinstellungen(); break;
    case 'appInfosAkku': case 'appInfosStandort': devlog.log('app', { appInfos: d.act }); sensoren.appInfos(); break;
    case 'rwListe': V.rwListe = d.wert; render(); break;
    case 'ladepunkt': ladepunktSheet(d.key); break;
    case 'markePunkt': markieren('punkt', d.key, d.wert); break;
    case 'markeBetreiber': markieren('betreiber', d.key, d.wert); break;
    case 'zielFavorit': zielPruefen(favoriten()[Number(d.i)]); break;
    case 'zielListe': V.zielwahl = null; V.zroute = null; V.retour = false; render(); break;
    case 'zielMerken': {
      const z = V.zielwahl; if (!z) break;
      const f = favorit(z.p);
      if (f) { eigen.favoriten = favoriten().filter(x => x !== f); toast(`${z.kurz} nicht mehr gemerkt`); }
      else {
        const neu = { kurz: z.kurz, p: z.p };
        const r = V.zroute;   // Route ab Zuhause gleich mitspeichern
        if (r && !r.fehler && r !== 'laedt' && eigen.zuhause && nahe(r.start.p, eigen.zuhause.p, ZUHAUSE_RADIUS)) neu.cache = r.ausCache ? { ...r } : cacheAus(r);
        eigen.favoriten = [...favoriten(), neu]; toast(`${z.kurz} gemerkt`);
        if (!neu.cache) cacheFuellen();
      }
      sichern(); render(); break;
    }
    case 'zuhauseHier':
      V.hier = null; hierAbfrage = 0;
      startpunkt().then(s => {
        if (!s || s.name !== 'aktueller Standort') { toast('Standort nicht verfügbar. Standort freigeben und nochmal versuchen.'); return; }
        eigen.zuhause = { name: 'Zuhause', p: s.p }; favoriten().forEach(f => { f.cache = null; }); sichern();
        settingsSheet(); toast('Zuhause gesetzt. Gemerkte Ziele werden neu berechnet.'); cacheFuellen();
      });
      break;
    case 'zuhauseWeg': eigen.zuhause = null; favoriten().forEach(f => { f.cache = null; }); sichern(); settingsSheet(); toast('Zuhause entfernt'); break;
    case 'zielTreffer': zielPruefen(V.treffer[Number(d.i)]); break;
    case 'zielZuletzt': zielPruefen(eigen.ziele[Number(d.i)]); break;
    case 'devTeilen':
      devlog.teilen()
        .then(r => { if (r === 'leer') toast('Noch keine Logs'); else if (r === 'heruntergeladen') toast('Log heruntergeladen'); })
        .catch(e => { console.warn(e); toast('Teilen nicht möglich'); });
      break;
    case 'devLoeschen': V.devLoeschen = true; settingsSheet(); break;
    case 'devLoeschenJa': V.devLoeschen = false; devlog.loeschen().then(() => { settingsSheet(); toast('Logs gelöscht'); }); break;
    case 'loeschen': V.loeschen = true; settingsSheet(); break;
    case 'loeschenNein': V.loeschen = false; settingsSheet(); break;
    case 'loeschenJa': {
      const { erfassung, parkplatzMerken, entwickler, zuhause, favoriten: fav, startlisteGesetzt, ladestrom: a, ladekarte: lk, ladeErfahrung, fotoExport } = eigen;   // Einstellungen, Ziele und Lade-Erfahrung bleiben
      eigen = { ...LEER, akku: eigen.akku, erfassung, parkplatzMerken, entwickler, zuhause, favoriten: fav, startlisteGesetzt, ladestrom: a, ladekarte: lk, ladeErfahrung, fotoExport }; foto.alleLoeschen(); V.loeschen = false; sichern(); tracker.setModus(zielModus());
      overlay(''); render(); toast('Alle Daten gelöscht'); break;
    }
    case 'csv':
      if (navigator.clipboard) navigator.clipboard.writeText(csvText(fahrten(), { fotos: eigen.fotoExport })).then(() => toast('Fahrtenbuch als Text kopiert')).catch(() => toast('Kopieren nicht möglich'));
      else toast('Kopieren nicht möglich');
      break;
    case 'csvTeilen':
      teilen(csvText(fahrten(), { fotos: eigen.fotoExport }), eigen.fotoExport ? fotosVon(fahrten()) : [])
        .then(r => { if (r === 'heruntergeladen') toast('CSV heruntergeladen'); })
        .catch(e => { console.warn(e); toast('Teilen nicht möglich'); });
      break;
    case 'csvSpeichern':
      csvSpeichern(csvText(fahrten(), { fotos: eigen.fotoExport }), eigen.fotoExport ? fotosVon(fahrten()) : [])
        .then(ort => toast(`Gespeichert: ${ort}${eigen.fotoExport && fotosVon(fahrten()).length ? ` und ${fotosVon(fahrten()).length} Fotos in fotos/` : ''}`))
        .catch(e => { console.warn(e); toast('Speichern nicht möglich. Über „Teilen“ geht es auch, z. B. nach OneDrive.'); });
      break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'zSuche') V.zsuche = e.target.value;
  if (V.nt && e.target.id?.startsWith('nt')) { ntLesen(); ntAnzeige(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'retour') { V.retour = e.target.checked; render(); }
  if (e.target.id === 'akku') { eigen.akku = Number(e.target.value); sichern(); render(); }
  if (e.target.id === 'lOrt') {   // ohne Neuzeichnen, damit die Akku-Eingaben stehen bleiben
    V.lOrt = e.target.value; $('lPreis').value = preisFuer(V.lOrt);
    const feld = $('lPunktFeld'), oeffentlich = V.lOrt === 'Öffentlich';
    feld.hidden = !oeffentlich;
    if (oeffentlich && !$('lPunkt')) feld.querySelector('label').insertAdjacentHTML('afterend', ladepunktAuswahl());
  }
  if (e.target.id === 'ladekarte') { eigen.ladekarte = e.target.value.trim() || 'Electroverse'; sichern(); }
  if (e.target.id === 'ladestrom') {
    const a = Number(e.target.value);
    if (a >= 6 && a <= 32) { eigen.ladestrom = a; sichern(); settingsSheet(); } else toast('Ladestrom zwischen 6 und 32 A');
  }
  if (e.target.id === 'entwickler') {
    eigen.entwickler = e.target.checked; V.devLoeschen = false; sichern();
    devlog.setAktiv(eigen.entwickler).then(() => {
      if (tracker.modus === 'warten' && !V.sandbox) { if (eigen.entwickler) sensoren.start('warten'); else sensoren.stopp(); }   // Messfenster beim Warten
      settingsSheet(); toast(eigen.entwickler ? 'Entwicklermodus an: Logs werden geschrieben' : 'Entwicklermodus aus'); });
  }
  if (e.target.id === 'fotoExport') { eigen.fotoExport = e.target.checked; sichern(); }
  if (e.target.id === 'parkplatzMerken') {
    eigen.parkplatzMerken = e.target.checked; if (!eigen.parkplatzMerken) eigen.parkplatz = null;
    sichern(); render(); toast(eigen.parkplatzMerken ? 'Abstellort wird ab der nächsten Fahrt gemerkt' : 'Abstellort gelöscht und aus');
  }
  if (e.target.id === 'erfassung') erfassungSetzen(e.target.checked).then(() => { render(); settingsSheet(); });
});
document.addEventListener('submit', e => {
  if (e.target.id === 'zielForm') {
    e.preventDefault();
    const text = $('zSuche').value.trim(); V.zsuche = text;
    if (text.length < 2) return;
    $('zSuche').blur();
    suchen(text).then(t => {
      // ein eindeutiger Treffer wird gleich geprüft
      if (t.length === 1) zielPruefen(t[0]); else { V.treffer = t; render(); }
    }).catch(err => { V.treffer = null; toast('Suche nicht möglich. Ohne Netz geht der Ziel-Check nicht.'); devlog.log('fehler', { quelle: 'suche', text: err.message }); });
    return;
  }
  if (e.target.id !== 'ladeForm') return; e.preventDefault();
  const von = Number($('lVon').value), bis = Number($('lBis').value), preis = Number($('lPreis').value), fehler = $('lFehler');
  if (!(von >= 0 && bis <= 100 && bis > von)) { fehler.hidden = false; fehler.textContent = 'Akku nachher muss größer sein als vorher (0 bis 100 %).'; fehler.className = 'small bad'; return; }
  const ort = $('lOrt').value, punkt = ort === 'Öffentlich' ? $('lPunkt')?.value || null : null, s = punkt && lade.finde(punkt);
  const eintrag = { id: 'l' + Date.now(), tag: datum(Date.now()), ort, von, bis, preis: preis >= 0 ? preis : 0 };
  if (s) Object.assign(eintrag, { ladepunkt: punkt, ladepunktName: s.b });
  eigen.laden.push(eintrag); eigen.soc = bis; eigen.socT = Date.now(); sichern();
  devlog.log('laden', { ort, von, bis, preis: eintrag.preis, ladepunkt: punkt });
  V.lOrt = ort; render(); toast(`Geladen: ${de((bis - von) / 100 * eigen.akku, 1)} kWh`);
  if (s) ladepunktSheet(punkt);   // gleich festhalten, ob die Ladekarte dort ging
});
document.addEventListener('visibilitychange', () => {
  devlog.log('app', { sichtbar: document.visibilityState === 'visible' });
  if (document.visibilityState !== 'visible') { sichern(); devlog.flush(); return; }   // beim Wegwechseln sofort sichern
  waechter();
  if (!sheetOffen()) { if (V.fahrtAnsicht) fahrtAnzeigeAktualisieren(); else render(); }
  pruefeOffen();
  systemPruefen().then(neu => { if (neu && V.tab === 'heute' && !sheetOffen() && !V.fahrtAnsicht) render(); });
});
setInterval(fahrtAnzeigeAktualisieren, 1000);

// ---------- Start ----------
(async () => {
  eigen = await laden();
  if (!eigen.startlisteGesetzt) {   // einmalig: Bexbach als Zuhause und die Ziele aus dem ersten Reichweiten-Check
    eigen.zuhause ??= { ...BEXBACH };
    eigen.favoriten = [...favoriten(), ...STARTLISTE.filter(s => !favorit(s.p)).map(s => ({ ...s }))];
    eigen.startlisteGesetzt = true; sichern();
  }
  if (eigen.entwickler) await devlog.setAktiv(true);
  devlog.log('app', { start: true, offen: eigen.offen?.status ?? null, erfassung: eigen.erfassung, fahrten: eigen.fahrten.length });
  render();
  if (NATIV) LocalNotifications.addListener('localNotificationActionPerformed', a => { devlog.log('meldung', { getippt: a?.notification?.id }); setTimeout(pruefeOffen, 300); }).catch(() => {});
  const gps = tracker.setModus(zielModus());
  waechter({ neuStarten: false });   // GPS startet gerade ohnehin; vor dem ersten neuen Punkt prüfen
  await gps;
  systemPruefen().then(neu => { if (neu && V.tab === 'heute' && !sheetOffen() && !V.fahrtAnsicht) render(); });
  setTimeout(cacheFuellen, 5000);   // fehlende Wege ab Zuhause im Hintergrund holen
  const ort = eigen.fahrten.at(-1)?.punkte?.at(-1);
  if (ort) temperaturHolen(ort);
  pruefeOffen();
})();
