// Microlino als 3D-Modell, Karosserie wie im „Button-Planer“: Kugel zum Superellipsoid verformt, Frontscheibe
// geneigt, Heck leicht eingezogen. Maße in Metern, x = nach vorn, y = hoch, z = nach rechts; 2,52 × 1,47 × 1,50 m.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const RAEDER = [[0.72, 0.6], [0.72, -0.6], [-0.78, 0.55], [-0.78, -0.55]];   // Radmitten x, z
const RAD_Y = 0.23, RADHAUS_R = 0.31, RADHAUS_Z = 0.4;   // Radhaus: Radius um die Radmitte, ab |z| > RADHAUS_Z ausgeschnitten
const AUGE = new V3(-0.41, 1.22, -0.3);                  // Fahrerauge, wie die Cockpit-Kamera in index.js

// Karosserie-Material mit ausgeschnittenen Radhäusern: Fragmente in einem Zylinder um jede Radachse fallen weg
// (Clipping-Ebenen können nur Halbräume abschneiden, darum ein kleiner Zusatz im Shader)
function radhaeuser(mat) {
  mat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKarosse;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKarosse = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKarosse;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (abs(vKarosse.z) > ${RADHAUS_Z.toFixed(2)} && (length(vKarosse.xy - vec2(${RAEDER[0][0].toFixed(2)}, ${RAD_Y.toFixed(2)})) < ${RADHAUS_R.toFixed(2)}
        || length(vKarosse.xy - vec2(${RAEDER[2][0].toFixed(2)}, ${RAD_Y.toFixed(2)})) < ${RADHAUS_R.toFixed(2)})) discard;`);
  };
  mat.customProgramCacheKey = () => 'radhaeuser';
  return mat;
}

// Cockpit wie im Button-Planer: Armaturenbrett an der Fronttür mit Tacho-Display hinter dem Lenkrad und Mitteldisplay,
// Lenkrad mit drei Speichen auf der Lenksäule, links die Konsole mit Drehknopf D/N/R und Turbo-Taste.
// Liefert anzeigen(daten), das Displays, Lenkrad, Knopf und Turbo-Taste nachführt.
function baueCockpit(root, kiste, m, dunkel) {
  // Armaturenbrett: dunkler Träger, heller Stoffbezug oben, schmale Messingleiste
  kiste(0.14, 0.14, 1.1, 0.76, 0.86, 0, dunkel);
  kiste(0.14, 0.025, 1.1, 0.76, 0.945, 0, m(0xb9b2a6));
  kiste(0.006, 0.012, 1.1, 0.688, 0.952, 0, new THREE.MeshStandardMaterial({ color: 0xb0832f, metalness: 0.6, roughness: 0.35 }));

  // Displays als Canvas-Texturen mit Rahmen dahinter, zum Fahrer geneigt
  const display = (b, h, x, y, z, pxB, pxH) => {
    const canvas = document.createElement('canvas'); canvas.width = pxB; canvas.height = pxH;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const halter = new THREE.Group(); halter.position.set(x, y, z); halter.lookAt(AUGE); root.add(halter);
    halter.add(new THREE.Mesh(new THREE.PlaneGeometry(b, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    kiste(b + 0.016, h + 0.016, 0.015, 0, 0, -0.009, m(0x111315), halter);   // Rahmen, knapp hinter der Anzeige
    return { ctx: canvas.getContext('2d'), tex, b: pxB, h: pxH, text: '' };
  };
  // Tacho in der oberen Öffnung des Lenkrads (vom Fahrerauge aus zwischen Kranz und Nabe), Mitteldisplay vorm Brett
  const tacho = display(0.17, 0.076, 0.6, 0.925, -0.3, 512, 230);
  const mitte = display(0.15, 0.085, 0.64, 0.93, 0.08, 384, 218);

  // Lenksäule und Lenkrad (Gruppe zeigt zum Fahrer; gedreht wird das Rad um seine Achse)
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 16), m(0x1d2023));   // vom Lenkrad schräg nach vorn unten
  column.position.set(0.415, 0.69, -0.3); column.rotation.z = Math.atan2(0.27, 0.48); root.add(column);
  const halter = new THREE.Group(); halter.position.set(0.28, 0.93, -0.3); halter.lookAt(-0.4, 1.35, -0.3); root.add(halter);
  const lenkrad = new THREE.Group(); halter.add(lenkrad);
  const schwarz = new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.55 });
  lenkrad.add(new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.019, 12, 48), schwarz));
  const nabe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 24), schwarz); nabe.rotation.x = Math.PI / 2; lenkrad.add(nabe);
  for (const w of [0, Math.PI, -Math.PI / 2]) {   // Speichen links, rechts, unten
    const speiche = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.026, 0.016), schwarz);
    speiche.position.set(Math.cos(w) * 0.1, Math.sin(w) * 0.1, 0); speiche.rotation.z = w; lenkrad.add(speiche);
  }
  const marke = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xb0832f })); // Mittelmarke oben
  marke.position.set(0, 0.165, 0); lenkrad.add(marke);

  // Konsole links mit Drehknopf D/N/R und Turbo-Taste
  kiste(0.2, 0.5, 0.15, 0.5, 0.52, -0.6, dunkel);
  const oben = new THREE.Group(); oben.position.set(0.5, 0.78, -0.6); oben.rotation.z = 0.35; root.add(oben);
  kiste(0.22, 0.025, 0.16, 0, 0, 0, m(0x30353a), oben);
  const knopf = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.03, 36), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.6 }));
  knopf.position.set(0.01, 0.027, 0.025); oben.add(knopf);
  kiste(0.028, 0.004, 0.006, 0.014, 0.017, 0, m(0xc9c5bd), knopf);   // Zeiger auf dem Knopf
  const turboMat = new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0x7a3a00, roughness: 0.4 });
  const turbo = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 24), turboMat); turbo.position.set(0, 0.017, -0.045); oben.add(turbo);
  for (const z of [-0.4, -0.22]) kiste(0.03, 0.09, 0.06, 0.5, 0.32, z, dunkel).rotation.z = 0.5;   // Pedale

  const zeichneTacho = d => {
    const { ctx: c, b, h } = tacho;
    c.fillStyle = '#0b0f10'; c.fillRect(0, 0, b, h);
    c.fillStyle = '#e8f1ee'; c.font = '600 120px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(String(Math.round(d.kmh)), 250, 140);
    c.fillStyle = '#8fa39d'; c.font = '28px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText('km/h', 262, 140);
    ['R', 'N', 'D'].forEach((g, i) => {   // Fahrstufe wie auf dem Drehknopf
      const an = g === d.stufe; c.font = `${an ? 700 : 500} 46px system-ui, sans-serif`;
      c.fillStyle = an ? '#7fd6b8' : '#3f4d49'; c.fillText(g, 372 + i * 44, 92);
    });
    if (d.turbo) { c.fillStyle = '#ff8a00'; c.beginPath(); c.roundRect(372, 112, 124, 40, 8); c.fill(); c.fillStyle = '#1b1200'; c.font = '700 24px system-ui, sans-serif'; c.fillText('TURBO', 392, 141); }
    // Akkubalken
    const akku = Math.max(0, Math.min(100, d.akku ?? 0));
    c.strokeStyle = '#3f4d49'; c.lineWidth = 3; c.strokeRect(24, 176, 380, 30);
    c.fillStyle = akku < 20 ? '#e5735f' : '#7fd6b8'; c.fillRect(28, 180, 372 * akku / 100, 22);
    c.fillStyle = '#e8f1ee'; c.font = '600 30px system-ui, sans-serif'; c.fillText(`${Math.round(akku)} %`, 420, 203);
  };
  const zeichneMitte = d => {
    const { ctx: c, b, h } = mitte;
    c.fillStyle = '#0f1513'; c.fillRect(0, 0, b, h);
    c.fillStyle = '#7fd6b8'; c.font = '600 26px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText('Bubble Log', 22, 42);
    c.fillStyle = '#e8f1ee'; c.font = '600 64px system-ui, sans-serif'; c.fillText(d.uhrzeit, 22, 120);
    c.fillStyle = '#8fa39d'; c.font = '26px system-ui, sans-serif';
    c.fillText(d.fahrtKm != null ? `Fahrt ${d.fahrtKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : 'Bereit zur Fahrt', 22, 176);
  };

  // daten: { kmh, stufe: 'R'|'N'|'D', turbo, steer (rad), akku (%), fahrtKm (oder null), uhrzeit 'HH:MM' }
  return function anzeigen(d) {
    lenkrad.rotation.z = d.steer * 6;   // Lenkübersetzung grob 1:6, damit man es sieht
    knopf.rotation.y = { R: 0.6, N: 0, D: -0.6 }[d.stufe];
    turboMat.emissiveIntensity = d.turbo ? 3 : 1;
    const t = `${Math.round(d.kmh)}|${d.stufe}|${d.turbo}|${Math.round(d.akku ?? 0)}`;
    if (t !== tacho.text) { tacho.text = t; zeichneTacho(d); tacho.tex.needsUpdate = true; }
    const t2 = `${d.uhrzeit}|${d.fahrtKm?.toFixed(1)}`;
    if (t2 !== mitte.text) { mitte.text = t2; zeichneMitte(d); mitte.tex.needsUpdate = true; }
  };
}

function karosserie() {
  const g = new THREE.SphereGeometry(1, 96, 56), p = g.attributes.position;
  const se = (t, e) => Math.sign(t) * Math.pow(Math.abs(t), e);
  for (let i = 0; i < p.count; i++) {
    let x = se(p.getX(i), 0.55), y = se(p.getY(i), 0.45), z = se(p.getZ(i), 0.4);
    if (x > 0 && y > -0.1) x -= x * 0.3 * Math.pow((y + 0.1) / 1.1, 1.5);
    if (x < 0 && y > 0.2) x -= x * 0.12 * Math.pow((y - 0.2) / 0.8, 2);
    z *= 1 - 0.13 * Math.max(0, y);
    p.setXYZ(i, x * 1.26, Math.max(0.22, 0.8 + y * 0.7), z * 0.72);
  }
  g.computeVertexNormals();
  return g;
}

// Liefert root (Gruppe), raeder (zum Drehen/Lenken), ebenen (Schnittebenen [Auto-System, Welt], die nach jeder
// Bewegung umgerechnet werden müssen), leuchten ([Lichtband, Rücklicht]), scheinwerfer (Lichtfleck vor dem Auto)
// und cockpit(daten) für Displays, Lenkrad und Drehknopf
export function baueMicrolino() {
  const root = new THREE.Group(), koerper = karosserie(), raeder = [], ebenen = [];
  const XD = 0.62, BELT = 0.95, ROOF = 1.36, SILL = 0.34, RW = 0.45;
  // Schnittebenen im Auto-Koordinatensystem; renderer-Clipping braucht Weltkoordinaten, darum jedes Bild umrechnen
  const ebene = (x, y, z, c) => { const l = new THREE.Plane(new V3(x, y, z), c), w = l.clone(); ebenen.push([l, w]); return w; };
  const E = {
    unterGurt: ebene(0, -1, 0, BELT), ueberGurt: ebene(0, 1, 0, -BELT), unterDach: ebene(0, -1, 0, ROOF), ueberDach: ebene(0, 1, 0, -ROOF),
    unterSchweller: ebene(0, -1, 0, SILL), ueberSchweller: ebene(0, 1, 0, -SILL), gurtLeiste: ebene(0, 1, 0, -(BELT - 0.018)),
    vorTuer: ebene(-1, 0, 0, XD), fuge: ebene(1, 0, 0, -(XD - 0.018)),
    lichtX: ebene(1, 0, 0, -0.98), lichtUnten: ebene(0, 1, 0, -0.75), lichtOben: ebene(0, -1, 0, 0.79),
    heckX: ebene(-1, 0, 0, -1.08), heckUnten: ebene(0, 1, 0, -0.82), heckOben: ebene(0, -1, 0, 0.86),
    dachVorn: ebene(1, 0, 0, 0.5), stoff: ebene(-1, 0, 0, 0.45), innenR: ebene(0, 0, -1, RW), innenL: ebene(0, 0, 1, RW),
  };
  const lack = new THREE.MeshStandardMaterial({ color: 0x8fbac6, roughness: 0.4, metalness: 0.15, side: THREE.DoubleSide });
  const zier = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const leuchte = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const glas = new THREE.MeshStandardMaterial({ color: 0x9cc3d4, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.2, depthWrite: false });
  const schale = (m, planes) => { m = radhaeuser(m.clone()); m.clippingPlanes = planes; const mesh = new THREE.Mesh(koerper, m); root.add(mesh); return mesh; };
  const DUNKEL = 0x2a2e31;
  schale(lack, [E.ueberSchweller, E.unterGurt]);
  schale(zier(DUNKEL), [E.unterSchweller]);
  schale(zier(DUNKEL), [E.gurtLeiste, E.unterGurt]);
  schale(zier(DUNKEL), [E.vorTuer, E.fuge]);
  schale(glas, [E.ueberGurt, E.unterDach]).renderOrder = 2;
  schale(lack, [E.ueberDach]);
  schale(zier(0x34383c), [E.ueberDach, E.dachVorn, E.stoff, E.innenR, E.innenL]);
  const leuchten = [schale(leuchte(0xfff4dc), [E.lichtX, E.lichtUnten, E.lichtOben]).material,
    schale(leuchte(0xd0302a), [E.heckX, E.heckUnten, E.heckOben]).material];

  // Innenraum, damit man durch die Scheiben und aus dem Cockpit etwas sieht
  const m = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const kiste = (w, h, d, x, y, z, mat, eltern = root) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); eltern.add(b); return b; };
  const DUNKELGRAU = m(0x2b2f33), STOFF = m(0x3b4045);
  kiste(1.5, 0.03, 1.12, -0.15, 0.235, 0, m(0x4b5157));
  kiste(0.45, 0.2, 1.1, -0.4, 0.35, 0, DUNKELGRAU);
  kiste(0.52, 0.13, 1.1, -0.36, 0.515, 0, STOFF);
  kiste(0.12, 0.62, 1.1, -0.68, 0.88, 0, STOFF).rotation.z = 0.18;
  for (const s of [-1, 1]) {   // Außenspiegel
    kiste(0.1, 0.07, 0.035, 0.5, 1.0, s * 0.83, m(0x1d2023));
    kiste(0.02, 0.015, 0.15, 0.5, 0.99, s * 0.75, m(0x1d2023));
  }
  const cockpit = baueCockpit(root, kiste, m, DUNKELGRAU);

  // Räder in Radhäusern: die Karosserie ist dort ausgeschnitten (radhaeuser), innen deckt ein dunkler Radkasten ab,
  // damit man weder von außen in den Innenraum noch aus dem Cockpit auf die Reifen schaut
  const reifen = m(0x1a1c1e), felge = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.35, metalness: 0.5 });
  const kastenMat = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.9, side: THREE.DoubleSide });
  for (const [x, z] of RAEDER) {
    const s = Math.sign(z);
    const kasten = new THREE.Mesh(new THREE.CylinderGeometry(RADHAUS_R, RADHAUS_R, 0.36, 24, 1, true, Math.PI / 2, Math.PI), kastenMat);
    kasten.rotation.x = Math.PI / 2; kasten.position.set(x, RAD_Y, s * 0.58); root.add(kasten);
    const deckel = new THREE.Mesh(new THREE.CircleGeometry(RADHAUS_R, 24, 0, Math.PI), kastenMat);
    deckel.position.set(x, RAD_Y, s * RADHAUS_Z); root.add(deckel);
    const pivot = new THREE.Group(); pivot.position.set(x, RAD_Y, z); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 32), reifen); t.rotation.x = Math.PI / 2; spin.add(t);
    const scheibe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.165, 24), felge); scheibe.rotation.x = Math.PI / 2; spin.add(scheibe);
    for (let k = 0; k < 5; k++) {   // fünf dunkle Schlitze, damit man das Drehen sieht
      const w = k / 5 * Math.PI * 2, schlitz = kiste(0.07, 0.03, 0.17, Math.cos(w) * 0.09, Math.sin(w) * 0.09, 0, reifen, spin);
      schlitz.rotation.z = w;
    }
    raeder.push({ pivot, spin, vorn: x > 0 });
  }
  // Schatten als dunkle Ellipse am Boden
  const schatten = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  schatten.rotation.x = -Math.PI / 2; schatten.scale.set(1.35, 0.8, 1); schatten.position.y = 0.05; root.add(schatten);

  // Lichtkegel der Scheinwerfer als heller Fleck auf der Straße (billiger als echte Spotlights, sieht auf dem
  // abgedunkelten Boden genauso aus); nur nachts sichtbar
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'), verlauf = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  verlauf.addColorStop(0, 'rgba(255,240,200,1)'); verlauf.addColorStop(0.6, 'rgba(255,230,180,.45)'); verlauf.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = verlauf; ctx.fillRect(0, 0, 128, 128);
  const scheinwerfer = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  scheinwerfer.rotation.x = -Math.PI / 2; scheinwerfer.position.set(8, 0.06, 0); root.add(scheinwerfer);
  return { root, raeder, ebenen, leuchten, scheinwerfer, cockpit };
}
