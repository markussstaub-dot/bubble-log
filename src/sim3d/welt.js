// Endliche Sim-Welt rund um Bexbach aus mitgelieferten Vektor-Kacheln (public/simwelt, erzeugt mit
// tools/simwelt.mjs; OpenMapTiles-Schema von OpenFreeMap, Zoom 14 ≈ 1,6 km pro Kachel). Kein Netz nötig.
// Daraus: Boden (Wiese, Feld, Wald, Wohngebiet, Wasser …), Straßen mit Mittellinie, Häuser in ihrer Höhe,
// Bäume in Wald und Parks; dazu die Kollision mit Häusern, Bäumen und dem Weltrand.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { auto } from '../fahrsim.js';
import { lokal, geo, kachelX, kachelY, kachelLon, kachelLat } from './geo.js';
import { toenen } from './licht.js';

const V3 = THREE.Vector3;
const QUELLE = './simwelt/';
const LADE_RAND = 400;   // Kacheln laden, die näher als so viele Meter am Auto liegen
// Fahrbahnbreite in Metern je OpenMapTiles-Klasse; Pfade, Bahn und Fähren bleiben weg
const STRASSE = { motorway: 12, trunk: 10, primary: 8.5, secondary: 7.5, tertiary: 7, minor: 5.5, service: 3.5, track: 2.8 };
const MITTELLINIE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const BAUM_DICHTE = { wood: 1 / 45, park: 1 / 250 };   // Bäume pro m² im Wald und in Parks
const MAX_BAEUME = 6000;                               // je Kachel, große Wälder werden ausgedünnt
// Bodenfarben bei Tag je Ebene und Klasse; Reihenfolge = Zeichenreihenfolge (später liegt oben)
const BODEN = [
  ['landuse', { residential: 0xe0dbd2, commercial: 0xe8d6d4, retail: 0xe8d6d4, industrial: 0xddd3e0, cemetery: 0xb3ceb2, school: 0xe9e2c8, hospital: 0xeed9d9, railway: 0xd9d4d0, quarry: 0xd2ccc0 }],
  ['landcover', { farmland: 0xebe4bf, grass: 0xc3dba6, wood: 0x9bbf88, wetland: 0xb4d0c2, sand: 0xeee0b5, rock: 0xd6d4cc }],
  ['park', { park: 0xbde0a3, nature_reserve: 0xb6d79e, protected_area: 0xb6d79e }],
  ['water', { _: 0x93c1e3 }],
];
const GRUND = 0xcbd8b9;   // Wiese außerhalb aller Flächen

let szene = null, wurzel = null, meldung = () => {}, welt = null, inWelt = new Set(), grenzen = null;
let kacheln = new Map(), grundrisse = new Map(), baumListen = new Map(), nahe = [], naheBaeume = [], naheBei = null;
let aufStrasse = false, bodenMats = new Map();

export const hausMaterial = new THREE.MeshLambertMaterial({ color: 0xe8e1d6, flatShading: true });
const asphalt = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const markierung = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const stammGeo = new THREE.CylinderGeometry(0.14, 0.2, 2.2, 6).translate(0, 1.1, 0);
const kroneGeo = new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.6, 0);
const stammMat = new THREE.MeshLambertMaterial({ color: 0x6b4f37 });
const kroneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

// ---------- Start, Nachladen, Ende ----------
// s: Szene; melde(text): kurzer Hinweis im Schild oben links
export async function weltStarten(s, melde) {
  szene = s; meldung = melde;
  wurzel = new THREE.Group(); szene.add(wurzel);
  toenen(asphalt, 0x74797e); toenen(markierung, 0xf2f2ea);
  const grund = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), toenen(new THREE.MeshBasicMaterial(), GRUND));
  grund.rotation.x = -Math.PI / 2; grund.position.y = -0.05; wurzel.add(grund);
  try {
    welt = await (await fetch(QUELLE + 'welt.json')).json();
  } catch (e) { console.warn('Sim-Welt fehlt', e); meldung('Sim-Welt fehlt (node tools/simwelt.mjs)'); return; }
  if (!szene) return;
  inWelt = new Set(welt.kacheln.map(([x, y]) => x + '/' + y));
  // Weltgrenzen in Metern aus den äußersten Kacheln
  const xs = welt.kacheln.map(k => k[0]), ys = welt.kacheln.map(k => k[1]), z = welt.zoom;
  const nw = lokal(kachelLat(Math.min(...ys), z), kachelLon(Math.min(...xs), z));
  const so = lokal(kachelLat(Math.max(...ys) + 1, z), kachelLon(Math.max(...xs) + 1, z));
  grenzen = { x0: nw.x + 3, x1: so.x - 3, z0: nw.z + 3, z1: so.z - 3 };
  randBauen();
  // außerhalb der Welt gestartet (Parkplatz woanders): zurück in die Mitte, dann auf die nächste Straße
  const c = auto();
  if (!innen(c.e, -c.n)) {
    const m = lokal(welt.mitte[0], welt.mitte[1]); c.e = m.x; c.n = -m.z; c.v = 0;
    meldung('Start außerhalb der Sim-Welt, zurück nach Bexbach');
  }
}
export function weltStoppen() {
  szene = wurzel = welt = grenzen = null;
  kacheln = new Map(); grundrisse = new Map(); baumListen = new Map(); nahe = []; naheBaeume = []; naheBei = null;
  inWelt = new Set(); aufStrasse = false; bodenMats = new Map();
}
// jedes Bild aufrufen: Kacheln in der Nähe laden, weit entfernte freigeben
export function weltNachfuehren() {
  if (!welt) return;
  const [lat, lon] = geo(), z = welt.zoom, dLat = LADE_RAND / 111320, dLon = LADE_RAND / (111320 * Math.cos(lat * Math.PI / 180));
  const x0 = Math.floor(kachelX(lon - dLon, z)), x1 = Math.floor(kachelX(lon + dLon, z));
  const y0 = Math.floor(kachelY(lat + dLat, z)), y1 = Math.floor(kachelY(lat - dLat, z));
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
    const key = tx + '/' + ty;
    if (inWelt.has(key) && !kacheln.has(key)) kachelLaden(tx, ty, key);
  }
  for (const [key, v] of kacheln) {
    const [tx, ty] = key.split('/').map(Number);
    if (tx < x0 - 1 || tx > x1 + 1 || ty < y0 - 1 || ty > y1 + 1) {
      if (typeof v === 'object') { wurzel.remove(v); entsorgen(v); }
      kacheln.delete(key); grundrisse.delete(key); baumListen.delete(key); naheBei = null;
    }
  }
}

async function kachelLaden(tx, ty, key) {
  kacheln.set(key, 'laedt');
  try {
    const r = await fetch(`${QUELLE}${welt.zoom}/${tx}/${ty}.pbf`); if (!r.ok) throw new Error('HTTP ' + r.status);
    const kachel = new VectorTile(new Pbf(await r.arrayBuffer()));
    if (!szene || kacheln.get(key) !== 'laedt') return;
    const gruppe = new THREE.Group(), fahrbahnen = [];
    bodenBauen(kachel, tx, ty, gruppe);
    strassenBauen(kachel.layers.transportation, tx, ty, gruppe, fahrbahnen);
    const grund = haeuserBauen(kachel.layers.building, tx, ty, gruppe);
    const baeume = baeumeSetzen(kachel, tx, ty, gruppe, fahrbahnen);
    kacheln.set(key, gruppe); grundrisse.set(key, grund); baumListen.set(key, baeume); naheBei = null; wurzel.add(gruppe);
    const [lat, lon] = geo();   // nur die Kachel zählt, in der das Auto steht
    if (!aufStrasse && Math.floor(kachelX(lon, welt.zoom)) === tx && Math.floor(kachelY(lat, welt.zoom)) === ty) aufStrasse = aufStrasseSetzen(fahrbahnen);
  } catch (e) {
    console.warn('Kachel nicht geladen', key, e); meldung('Kachel fehlt');
  }
}

// Geometrien einer Kachel freigeben (Materialien und Baumformen sind geteilt und bleiben)
const entsorgen = obj => obj.traverse(o => { if (!o.userData.geteilt) o.geometry?.dispose(); });
const linien = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
const polygone = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
// Ring aus [lon, lat] (geschlossen) → Vector2(Osten, Norden) ohne doppelten Endpunkt
const ring = pkte => pkte.slice(0, -1).map(([lon, lat]) => { const l = lokal(lat, lon); return new THREE.Vector2(l.x, -l.z); });

// ---------- Boden ----------
function bodenBauen(kachel, tx, ty, gruppe) {
  BODEN.forEach(([name, farben], stufe) => {
    const ebene = kachel.layers[name]; if (!ebene) return;
    const jeFarbe = new Map();
    for (let i = 0; i < ebene.length; i++) {
      const f = ebene.feature(i), farbe = farben[f.properties.class] ?? farben._; if (farbe === undefined) continue;
      for (const poly of polygone(f.toGeoJSON(tx, ty, welt.zoom).geometry)) {
        const form = new THREE.Shape(ring(poly[0])); form.holes = poly.slice(1).map(h => new THREE.Path(ring(h)));
        const g = new THREE.ShapeGeometry(form); g.rotateX(-Math.PI / 2);
        if (!jeFarbe.has(farbe)) jeFarbe.set(farbe, []); jeFarbe.get(farbe).push(g);
      }
    }
    for (const [farbe, geos] of jeFarbe) {
      const g = mergeGeometries(geos, false); geos.forEach(x => x.dispose()); if (!g) continue;
      if (!bodenMats.has(farbe)) bodenMats.set(farbe, toenen(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), farbe));
      const m = new THREE.Mesh(g, bodenMats.get(farbe)); m.position.y = 0.004 * (stufe + 1); gruppe.add(m);
    }
  });
}

// ---------- Straßen ----------
// Flache Bänder auf dem Boden: je Abschnitt ein Viereck, an jedem Knick eine Scheibe gegen Lücken
function flaeche(pos, hoehe, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, mat); m.position.y = hoehe; return m;
}
function band(pos, pkte, breite) {
  const h = breite / 2;
  for (let i = 0; i < pkte.length - 1; i++) {
    const a = pkte[i], b = pkte[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const nx = -dz / l * h, nz = dx / l * h;
    pos.push(a.x + nx, 0, a.z + nz, a.x - nx, 0, a.z - nz, b.x - nx, 0, b.z - nz, a.x + nx, 0, a.z + nz, b.x - nx, 0, b.z - nz, b.x + nx, 0, b.z + nz);
  }
  for (const c of pkte) for (let k = 0; k < 8; k++) {
    const w0 = k / 8 * Math.PI * 2, w1 = (k + 1) / 8 * Math.PI * 2;
    pos.push(c.x, 0, c.z, c.x + Math.cos(w0) * h, 0, c.z + Math.sin(w0) * h, c.x + Math.cos(w1) * h, 0, c.z + Math.sin(w1) * h);
  }
}
// gestrichelte Mittellinie: 3 m Strich, 6 m Lücke, über Knicke hinweg fortlaufend
function striche(pos, pkte, breite = 0.15, strich = 3, luecke = 6) {
  let rest = 0;   // wo der nächste Strich im aktuellen Abschnitt beginnt
  for (let i = 0; i < pkte.length - 1; i++) {
    const a = pkte[i], b = pkte[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < 0.01) continue;
    const ux = dx / l, uz = dz / l, nx = -uz * breite / 2, nz = ux * breite / 2;
    let d = rest;
    for (; d < l; d += strich + luecke) {
      const e = Math.min(l, d + strich), p0x = a.x + ux * d, p0z = a.z + uz * d, p1x = a.x + ux * e, p1z = a.z + uz * e;
      pos.push(p0x + nx, 0, p0z + nz, p0x - nx, 0, p0z - nz, p1x - nx, 0, p1z - nz, p0x + nx, 0, p0z + nz, p1x - nx, 0, p1z - nz, p1x + nx, 0, p1z + nz);
    }
    rest = d - l;
  }
}
function strassenBauen(ebene, tx, ty, gruppe, fahrbahnen) {
  const fahrbahn = [], linie = [];
  for (let i = 0; i < (ebene?.length ?? 0); i++) {
    const f = ebene.feature(i), breite = STRASSE[f.properties.class];
    if (!breite || f.properties.brunnel === 'tunnel') continue;
    for (const l of linien(f.toGeoJSON(tx, ty, welt.zoom).geometry)) {
      const pkte = l.map(([lon, lat]) => lokal(lat, lon));
      band(fahrbahn, pkte, breite); fahrbahnen.push({ pkte, breite });
      if (MITTELLINIE.has(f.properties.class)) striche(linie, pkte);
    }
  }
  if (fahrbahn.length) gruppe.add(flaeche(fahrbahn, 0.03, asphalt));
  if (linie.length) gruppe.add(flaeche(linie, 0.04, markierung));
}
// Beim Einschalten von 3D: steht der Microlino abseits jeder Fahrbahn (Hof, Fußgängerzone, Haus), setzt er sich
// auf die nächste Straße in deren Richtung. Liefert true, sobald nichts mehr zu tun ist.
function aufStrasseSetzen(fahrbahnen) {
  const c = auto(); if (Math.abs(c.v) > 0.3) return true;
  const px = c.e, pz = -c.n; let best = null;
  for (const { pkte, breite } of fahrbahnen) for (let i = 0; i < pkte.length - 1; i++) {
    const a = pkte[i], b = pkte[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz; if (l2 < 1e-4) continue;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2)), x = a.x + dx * t, z = a.z + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { d, x, z, breite, yaw: Math.atan2(-dz, dx) };
  }
  if (!best) return false;   // in dieser Kachel keine Straße, auf die nächste warten
  if (best.d > best.breite / 2 && best.d < 300) { c.e = best.x; c.n = -best.z; c.yaw = best.yaw; c.v = 0; }
  return true;
}

// ---------- Häuser ----------
// liefert die Grundrisse für die Kollision: [{ aussen, loecher, hoch, x0, x1, y0, y1 }] mit y = Norden
function haeuserBauen(ebene, tx, ty, gruppe) {
  const geos = [], grund = [];
  for (let i = 0; i < (ebene?.length ?? 0); i++) {
    const f = ebene.feature(i); if (f.properties.hide_3d) continue;
    const hoch = +f.properties.render_height || 6, unten = +f.properties.render_min_height || 0;
    for (const poly of polygone(f.toGeoJSON(tx, ty, welt.zoom).geometry)) {
      const aussen = ring(poly[0]), loecher = poly.slice(1).map(h => ring(h));
      const form = new THREE.Shape(aussen); form.holes = loecher.map(h => new THREE.Path(h));
      if (unten < 2) grund.push({ aussen, loecher, hoch, x0: Math.min(...aussen.map(v => v.x)), x1: Math.max(...aussen.map(v => v.x)), y0: Math.min(...aussen.map(v => v.y)), y1: Math.max(...aussen.map(v => v.y)) });
      const geo = new THREE.ExtrudeGeometry(form, { depth: Math.max(1, hoch - unten), bevelEnabled: false });
      geo.rotateX(-Math.PI / 2); geo.translate(0, unten, 0);   // Grundriss in x/z, Höhe nach oben
      geos.push(geo);
    }
  }
  const g = geos.length ? mergeGeometries(geos, false) : null; geos.forEach(x => x.dispose());
  if (g) gruppe.add(new THREE.Mesh(g, hausMaterial));
  return grund;
}

// ---------- Bäume ----------
// zufällig, aber je Kachel immer gleich (Startwert aus der Kachelnummer)
function zufall(saat) {
  return () => { saat = saat + 0x6D2B79F5 | 0; let t = Math.imul(saat ^ saat >>> 15, 1 | saat); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Fahrbahn-Abschnitte in ein 25-m-Raster sortieren, damit „steht dieser Baum auf einer Straße?“ schnell geht
function strassenRaster(fahrbahnen) {
  const raster = new Map(), Z = 25;
  for (const { pkte, breite } of fahrbahnen) for (let i = 0; i < pkte.length - 1; i++) {
    const a = pkte[i], b = pkte[i + 1], r = breite / 2 + 1.5, s = { a, b, r };
    for (let gx = Math.floor((Math.min(a.x, b.x) - r) / Z); gx <= Math.floor((Math.max(a.x, b.x) + r) / Z); gx++)
      for (let gz = Math.floor((Math.min(a.z, b.z) - r) / Z); gz <= Math.floor((Math.max(a.z, b.z) + r) / Z); gz++) {
        const k = gx + ',' + gz; if (!raster.has(k)) raster.set(k, []); raster.get(k).push(s);
      }
  }
  return (x, z) => (raster.get(Math.floor(x / Z) + ',' + Math.floor(z / Z)) || []).some(({ a, b, r }) => {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < r;
  });
}
// liefert die Stämme für die Kollision: [{ e, n, r }]
function baeumeSetzen(kachel, tx, ty, gruppe, fahrbahnen) {
  const rnd = zufall(tx * 73856093 ^ ty * 19349663), orte = [], strasseBei = strassenRaster(fahrbahnen);
  const quellen = [[kachel.layers.landcover, f => f.properties.class === 'wood' ? BAUM_DICHTE.wood : 0],
    [kachel.layers.park, () => BAUM_DICHTE.park]];
  for (const [ebene, dichte] of quellen) for (let i = 0; i < (ebene?.length ?? 0) && orte.length < MAX_BAEUME; i++) {
    const f = ebene.feature(i), d = dichte(f); if (!d) continue;
    for (const poly of polygone(f.toGeoJSON(tx, ty, welt.zoom).geometry)) {
      // hier in three-Koordinaten (y-Feld = z = Süden), passend zu den Straßen
      const ringe = poly.map(r => r.map(([lon, lat]) => { const l = lokal(lat, lon); return { x: l.x, y: l.z }; }));
      const a = ringe[0], x0 = Math.min(...a.map(v => v.x)), x1 = Math.max(...a.map(v => v.x)), y0 = Math.min(...a.map(v => v.y)), y1 = Math.max(...a.map(v => v.y));
      let qm = 0; for (let k = 0, j = a.length - 1; k < a.length; j = k++) qm += (a[j].x + a[k].x) * (a[j].y - a[k].y) / 2;
      const soll = Math.min(Math.round(Math.abs(qm) * d), MAX_BAEUME - orte.length);
      for (let n = 0, versuche = 0; n < soll && versuche < soll * 4; versuche++) {
        const x = x0 + rnd() * (x1 - x0), z = y0 + rnd() * (y1 - y0);
        const s = 0.7 + rnd() * 0.7, w = rnd() * 6.3, f = rnd();   // immer ziehen, damit die Verteilung stabil bleibt
        if (imRing(x, z, a) && !ringe.slice(1).some(l => imRing(x, z, l)) && !strasseBei(x, z)) { orte.push([x, z, s, w, f]); n++; }
      }
    }
  }
  if (!orte.length) return [];
  const stamm = new THREE.InstancedMesh(stammGeo, stammMat, orte.length), krone = new THREE.InstancedMesh(kroneGeo, kroneMat, orte.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), farbe = new THREE.Color(), hoch = new V3(0, 1, 0);
  orte.forEach(([x, z, s, w, f], i) => {
    m.compose(new V3(x, 0, z), q.setFromAxisAngle(hoch, w), new V3(s, s, s));
    stamm.setMatrixAt(i, m); krone.setMatrixAt(i, m);
    krone.setColorAt(i, farbe.setHSL(0.27 + f * 0.08, 0.45, 0.26 + f * 0.1));
  });
  stamm.userData.geteilt = krone.userData.geteilt = true;
  gruppe.add(stamm, krone);
  return orte.map(([x, z, s]) => ({ e: x, n: -z, r: 0.25 * s }));   // Stamm etwas dicker als gezeichnet
}

// ---------- Weltrand ----------
// rot-weiße Schranke rundum, damit man sieht, wo die Welt aufhört
function randBauen() {
  const { x0, x1, z0, z1 } = grenzen, c = document.createElement('canvas'); c.width = 64; c.height = 8;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#d6453d'; ctx.fillRect(0, 0, 64, 8); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 32, 8);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  const seite = (laenge, x, z, quer) => {
    const t = tex.clone(); t.repeat.set(laenge / 4, 1); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(quer ? 0.3 : laenge, 1.1, quer ? laenge : 0.3), new THREE.MeshLambertMaterial({ map: t }));
    m.position.set(x, 0.55, z); wurzel.add(m);
  };
  seite(x1 - x0, (x0 + x1) / 2, z0 - 0.5, false); seite(x1 - x0, (x0 + x1) / 2, z1 + 0.5, false);
  seite(z1 - z0, x0 - 0.5, (z0 + z1) / 2, true); seite(z1 - z0, x1 + 0.5, (z0 + z1) / 2, true);
}
const innen = (x, z) => !grenzen || (x > grenzen.x0 && x < grenzen.x1 && z > grenzen.z0 && z < grenzen.z1);

// ---------- Kollision: Grundrisse als Polygone in Metern (x = Osten, y = Norden) ----------
export function imRing(x, y, r) {
  let drin = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i].y > y) !== (r[j].y > y) && x < (r[j].x - r[i].x) * (y - r[i].y) / (r[j].y - r[i].y) + r[i].x) drin = !drin;
  return drin;
}
// Haus an dieser Stelle (Innenhöfe zählen als frei); nur Häuser, die höher als mindestens sind
export function haus(x, y, mindestens = 0) {
  return nahe.some(h => h.hoch > mindestens && x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && imRing(x, y, h.aussen) && !h.loecher.some(l => imRing(x, y, l)));
}
function naheAktualisieren(e, n) {
  if (naheBei && Math.hypot(e - naheBei.e, n - naheBei.n) < 8) return;
  naheBei = { e, n }; const R = 40;
  nahe = [...grundrisse.values()].flat().filter(h => h.x1 > e - R && h.x0 < e + R && h.y1 > n - R && h.y0 < n + R);
  naheBaeume = [...baumListen.values()].flat().filter(b => Math.abs(b.e - e) < R && Math.abs(b.n - n) < R);
}
// Ecken und Frontmitte des Microlino (2,52 × 1,47 m) gegen Häuser und Weltrand, dazu den ganzen Umriss gegen die
// Baumstämme (Kreis gegen Rechteck im Auto-System); fahrsim.js setzt dann zurück
export function blockiert({ e, n, yaw }) {
  naheAktualisieren(e, n);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ecken = [[1.2, 0.68], [1.2, -0.68], [-1.2, 0.68], [-1.2, -0.68], [1.26, 0]].map(([l, q]) => [e + c * l - s * q, n + s * l + c * q]);
  if (ecken.some(([x, y]) => !innen(x, -y) || haus(x, y))) return true;
  return naheBaeume.some(b => {
    const dx = b.e - e, dn = b.n - n, laengs = dx * c + dn * s, quer = -dx * s + dn * c;
    return Math.abs(laengs) < 1.26 + b.r && Math.abs(quer) < 0.73 + b.r;
  });
}
