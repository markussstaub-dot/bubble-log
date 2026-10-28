// Gemerkte Ziele aus der Ampel-Liste als Leuchtsäulen in Ampelfarbe mit Name, Luftlinie und Ampeltext.
// Weiter entfernte Ziele stehen in ihrer Richtung am Rand, damit der Nebel sie nicht schluckt.
import * as THREE from 'three';
import { auto } from '../fahrsim.js';
import { lokal } from './geo.js';

const ZIEL_ABSTAND = 260;   // m
const AMPEL_FARBE = { good: '#2f9e44', warn: '#e0a800', bad: '#d6453d', lade: '#3b82c4', muted: '#8a9599' };

let ziele = [], gruppe = null, szene = null, takt = 0;

// liste: [{ p: [lat, lon], name, klasse: 'good'|'warn'|'bad'|'lade'|'muted', text }]
export function setZiele(liste) { ziele = liste || []; if (szene) bauen(); }
export function zieleStarten(s) { szene = s; bauen(); }
export function zieleStoppen() { szene = gruppe = null; }

function bauen() {
  if (gruppe) { szene.remove(gruppe); gruppe.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
  gruppe = new THREE.Group(); szene.add(gruppe);
  ziele.forEach((z, i) => {
    // Höhen gestaffelt, damit sich Schilder von Zielen in ähnlicher Richtung nicht verdecken
    const farbe = AMPEL_FARBE[z.klasse] || AMPEL_FARBE.muted, g = new THREE.Group(), hoehe = 10 + (i % 5) * 12;
    const saeule = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, hoehe, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.5, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    saeule.position.y = hoehe / 2; g.add(saeule);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const tafel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthTest: false, sizeAttenuation: false }));
    tafel.scale.set(0.3, 0.075, 1); tafel.position.y = hoehe + 1; tafel.renderOrder = 10; g.add(tafel);
    const ort = lokal(z.p[0], z.p[1]);
    gruppe.add(g);
    z.obj = { g, canvas, tex, farbe, x: ort.x, z: ort.z, text: '' };
  });
  takt = 0;
}
function tafelZeichnen(z, meter) {
  const o = z.obj, km = meter < 1000 ? `${Math.round(meter / 10) * 10} m` : `${(meter / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
  const zeile = `${km} Luftlinie · ${z.text}`;
  if (zeile === o.text) return; o.text = zeile;
  const c = o.canvas.getContext('2d');
  c.clearRect(0, 0, 512, 128);
  c.fillStyle = 'rgba(20,26,25,.82)'; c.beginPath(); c.roundRect(4, 4, 504, 120, 22); c.fill();
  c.fillStyle = o.farbe; c.beginPath(); c.arc(52, 64, 26, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.font = '600 44px system-ui, sans-serif'; c.fillText(z.name.slice(0, 18), 96, 58);
  c.fillStyle = '#c9d2cf'; c.font = '30px system-ui, sans-serif'; c.fillText(zeile.slice(0, 30), 96, 100);
  o.tex.needsUpdate = true;
}
export function zieleNachfuehren() {
  if (!gruppe) return;
  const c = auto(), x = c.e, z = -c.n, tafeln = takt++ % 30 === 0;
  for (const ziel of ziele) {
    const o = ziel.obj, dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz), r = Math.min(d, ZIEL_ABSTAND);
    o.g.position.set(x + (d ? dx / d * r : 0), 0, z + (d ? dz / d * r : 0));
    if (tafeln) tafelZeichnen(ziel, d);
  }
}
