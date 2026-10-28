// Tag und Nacht für die 3D-Ansicht. „Echtzeit“ rechnet die Sonnenhöhe am Ort zur gespielten Uhrzeit aus; nachts
// werden Himmel und Boden dunkel, Lichtband und Rückleuchten hell, vor dem Auto liegt der Scheinwerfer-Fleck.
import * as THREE from 'three';
import { uhr } from '../fahrsim.js';
import { geo } from './geo.js';

const HIMMEL = 0xbfd8e6, NACHTHIMMEL = 0x0b1424, DAEMMERUNG = 0xd99a6c;
const MODI = ['echt', 'tag', 'nacht'];
const tagFarbe = new THREE.Color(HIMMEL), nachtFarbe = new THREE.Color(NACHTHIMMEL), daemmerFarbe = new THREE.Color(DAEMMERUNG);

let modus = 'echt', hell = 1, takt = 0, szene = null, hemi = null, sonne = null, teile = null;
const getoent = new Set();   // MeshBasic-Materialien am Boden, die nachts abgedunkelt werden

// Sonnenhöhe in Grad (vereinfachte Formel nach NOAA/Astronomical Almanac, auf etwa 1° genau)
function sonnenhoehe(ms, lat, lon) {
  const r = Math.PI / 180, d = ms / 864e5 - 10957.5;   // Tage seit J2000
  const g = (357.529 + 0.98560028 * d) * r, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r, e = (23.439 - 0.00000036 * d) * r;
  const dek = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const h = (gmst * 15 + lon) * r - ra;
  return Math.asin(Math.sin(lat * r) * Math.sin(dek) + Math.cos(lat * r) * Math.cos(dek) * Math.cos(h)) / r;
}
function zielHelligkeit() {
  if (modus === 'tag') return 1;
  if (modus === 'nacht') return 0;
  const [lat, lon] = geo(), s = sonnenhoehe(uhr(), lat, lon);
  const t = Math.max(0, Math.min(1, (s + 6) / 12));   // bürgerliche Dämmerung (-6°) bis 6° über dem Horizont
  return t * t * (3 - 2 * t);
}
function setzen(t) {
  hell = t;
  // Himmel: Nacht → Dämmerungsorange (um t = 0,4) → Tag
  const himmel = t < 0.4 ? nachtFarbe.clone().lerp(daemmerFarbe, t / 0.4 * 0.6) : daemmerFarbe.clone().lerp(tagFarbe, (t - 0.4) / 0.6);
  szene.background.copy(himmel); szene.fog.color.copy(himmel);
  szene.fog.near = 40 + 50 * t; szene.fog.far = 200 + 100 * t;
  hemi.intensity = 0.12 + 0.98 * t; sonne.intensity = 1.4 * t;
  const k = 0.16 + 0.84 * t;
  for (const m of getoent) m.color.copy(m.userData.basis).multiplyScalar(k);
  teile.hausMaterial.emissive.setRGB(0.09, 0.07, 0.04).multiplyScalar(1 - t);   // erleuchtete Fenster, grob
  teile.leuchten[0].emissiveIntensity = 0.7 + 2.5 * (1 - t); teile.leuchten[1].emissiveIntensity = 0.7 + 2 * (1 - t);
  teile.scheinwerfer.material.opacity = 0.85 * (1 - t);
}

// Boden-Material anmelden; basis = Farbe bei vollem Tageslicht
export function toenen(m, basis) {
  m.userData.basis = new THREE.Color(basis); getoent.add(m);
  m.color.copy(m.userData.basis).multiplyScalar(0.16 + 0.84 * hell);
  return m;
}
// teile: { hausMaterial, leuchten, scheinwerfer }
export function lichtStarten(s, t) {
  szene = s; teile = t; takt = 0;
  szene.background = new THREE.Color(HIMMEL); szene.fog = new THREE.Fog(HIMMEL, 90, 300);
  hemi = new THREE.HemisphereLight(0xffffff, 0x6b7568, 1.1); szene.add(hemi);
  sonne = new THREE.DirectionalLight(0xffffff, 1.4); sonne.position.set(-40, 80, 30); szene.add(sonne);
  setzen(zielHelligkeit());
}
// jedes Bild aufrufen; rechnet nur etwa jede Sekunde neu und blendet weich über
export function lichtNachfuehren() {
  if (++takt % 60) return;
  const ziel = zielHelligkeit(); if (Math.abs(ziel - hell) > 0.002) setzen(hell + (ziel - hell) * 0.5);
}
export function lichtStoppen() { szene = hemi = sonne = teile = null; getoent.clear(); }
export function lichtWechseln() {
  modus = MODI[(MODI.indexOf(modus) + 1) % MODI.length];
  if (szene) setzen(zielHelligkeit());
  return modus;
}
export const licht = () => modus;
