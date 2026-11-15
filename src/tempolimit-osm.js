// OSM-Wege → Tempolimit-Kacheln (SPEC-tempolimit.md). Gemeinsam für die App (Overpass, src/tempolimit.js) und das
// Prüfwerkzeug (Geofabrik-Extrakt, tools/tempolimit.mjs). Keine Abhängigkeiten, läuft im Browser und in Node.
//
// Kachel „493_72“ = südwestliche Ecke 49,3° N / 7,2° O. Eintrag: [wegId, vor, rück, [lat0, lon0, dLat, dLon, …]]
//   vor/rück: Limit in Wegrichtung bzw. dagegen (maxspeed:forward/backward vor maxspeed): km/h, 0 = keine Begrenzung
//   („none“), -1 = Schrittgeschwindigkeit („walk“), -2 = Einbahnstraße, diese Richtung gibt es nicht, null = unbekannt.
//   Koordinaten in 1e-5 Grad, ab dem 2. Punkt als Differenz. Straßen ohne Limit sind mit null dabei, damit die App dort
//   „?“ zeigt statt die Nachbarstraße zu nehmen. Geometrie vereinfacht (Douglas-Peucker, 5 m), geteilt an Kachelgrenzen.

export const KACHEL = 10;     // Kacheln pro Grad (0,1°)
export const TOLERANZ = 5;    // m, Vereinfachung

// Straßen, auf denen ein Auto fährt. service/track nur, wenn ein Limit dran steht (sonst Parkplätze und Einfahrten en masse).
export const STRASSEN = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'road'];
export const NUR_MIT_LIMIT = ['service', 'track'];
const STRASSEN_SET = new Set(STRASSEN), NUR_MIT_LIMIT_SET = new Set(NUR_MIT_LIMIT);

// Implizite Werte je Land (OSM-Wiki „Key:maxspeed“ / „Default speed limits“, geprüft 15.11.2026). 0 = keine Begrenzung, -1 = Schritt.
// living_street gilt auch ohne maxspeed-Tag (verkehrsberuhigter Bereich DE/AT = Schritt, Begegnungszone CH/FR = 20).
export const LAENDER = {
  DE: { urban: 50, rural: 100, motorway: 0, living_street: -1, bicycle_road: 30 },
  CH: { urban: 50, rural: 80, trunk: 100, motorway: 120, living_street: 20 },
  AT: { urban: 50, rural: 100, trunk: 100, motorway: 130, living_street: -1, bicycle_road: 30 },
  IT: { urban: 50, rural: 90, trunk: 110, motorway: 130 },
  FR: { urban: 50, rural: 80, trunk: 110, motorway: 130, living_street: 20 },
};

// maxspeed-Wert → km/h | 0 (none) | -1 (walk) | null (unbekannt, z. B. signals, variable, „50;30“, fremdes Land ohne Tabelle)
export function limit(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (v === 'none') return 0;
  if (v === 'walk') return -1;
  const m = /^(\d{1,3})(\s*mph)?$/.exec(v);
  if (m) return m[2] ? Math.round(Number(m[1]) * 1.609) : Number(m[1]);
  const l = /^([A-Z]{2}):(.+)$/.exec(v);
  if (!l) return null;
  const typ = l[2], z = /^zone:?(\d{1,3})$/.exec(typ);   // DE:zone30, DE:zone:30, FR:zone30
  if (z) return Number(z[1]);
  return LAENDER[l[1]]?.[typ] ?? null;
}
// zone:maxspeed=DE:30 bzw. source:maxspeed=DE:zone30 als Ersatz, wenn maxspeed fehlt
export function zoneLimit(t) {
  const z = t['zone:maxspeed'];
  const a = z == null ? null : limit(/^[A-Z]{2}:\d{1,3}$/.test(z) ? z.slice(3) : z);
  return a ?? limit(t['source:maxspeed']) ?? limit(t['maxspeed:type']);
}
// Länderkürzel aus den Tags eines Wegs (maxspeed=CH:urban, source:maxspeed=DE:zone30 …) oder null
export function landAusTags(t) {
  for (const k of ['maxspeed', 'source:maxspeed', 'maxspeed:type', 'zone:maxspeed', 'zone:traffic']) {
    const m = /^([A-Z]{2}):/.exec(t[k] ?? ''); if (m) return m[1];
  }
  return null;
}

// Tags → { f, b, klasse } oder null (Weg gehört nicht in die Kacheln). land: für living_street ohne Limit.
export function wegLimits(t, land = null) {
  const hw = t.highway; if (!hw || t.area === 'yes') return null;
  const allg = limit(t.maxspeed) ?? zoneLimit(t) ?? (hw === 'living_street' ? LAENDER[land]?.living_street ?? null : null);
  let f = limit(t['maxspeed:forward']) ?? allg, b = limit(t['maxspeed:backward']) ?? allg;
  // Einbahnstraße: Gegenrichtung gibt es nicht (-2), sonst nähme die App auf der Autobahn die Gegenfahrbahn
  const ow = t.oneway, einbahn = ['yes', 'true', '1'].includes(ow) || (ow !== 'no' && (hw === 'motorway' || ['roundabout', 'circular'].includes(t.junction)));
  if (einbahn) b = -2; else if (ow === '-1') f = -2;
  if (!STRASSEN_SET.has(hw) && !(NUR_MIT_LIMIT_SET.has(hw) && (f != null || b != null))) return null;
  return { f, b, klasse: hw.replace('_link', '') };
}

// ---------- Geometrie ----------
const R = 6371000, RAD = Math.PI / 180;
export function douglasPeucker(pkt, toleranz = TOLERANZ) {   // pkt: [[lat, lon]], Toleranz in Metern (lokal eben)
  if (pkt.length < 3) return pkt;
  const k = Math.cos(pkt[0][0] * RAD), xy = pkt.map(([a, b]) => [b * RAD * R * k, a * RAD * R]);
  const behalten = new Uint8Array(pkt.length); behalten[0] = behalten[pkt.length - 1] = 1;
  const stapel = [[0, pkt.length - 1]];
  while (stapel.length) {
    const [s, e] = stapel.pop(); let max = 0, idx = -1;
    const [x1, y1] = xy[s], [x2, y2] = xy[e], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i]; let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > max) { max = d; idx = i; }
    }
    if (max > toleranz) { behalten[idx] = 1; stapel.push([s, idx], [idx, e]); }
  }
  return pkt.filter((_, i) => behalten[i]);
}
export const kachelVon = (a, b) => `${Math.floor(a * KACHEL)}_${Math.floor(b * KACHEL)}`;
export const strecke = p => { let s = 0; for (let i = 1; i < p.length; i++) { const k = Math.cos(p[i][0] * RAD); s += R * RAD * Math.hypot(p[i][0] - p[i - 1][0], (p[i][1] - p[i - 1][1]) * k); } return s; };

// Weg vereinfachen und an Kachelgrenzen teilen: jedes Teilstück gehört zur Kachel seiner Mitte. abgeben(kachel, eintrag)
export function teilen(id, f, b, roh, abgeben) {
  const p = douglasPeucker(roh);
  let stueck = [p[0]], kachel = null;
  const fertig = () => {
    if (stueck.length < 2) return;
    const c = []; let la0 = 0, lo0 = 0;
    for (const [a, o] of stueck) { const A = Math.round(a * 1e5), B = Math.round(o * 1e5); c.push(A - la0, B - lo0); la0 = A; lo0 = B; }
    abgeben(kachel, [id, f, b, c]);
  };
  for (let i = 1; i < p.length; i++) {
    const k = kachelVon((p[i - 1][0] + p[i][0]) / 2, (p[i - 1][1] + p[i][1]) / 2);
    if (kachel && k !== kachel) { fertig(); stueck = [p[i - 1]]; }
    kachel = k; stueck.push(p[i]);
  }
  fertig();
}

// ---------- Overpass ----------
export function kachelBox(key) {   // „493_72“ → [S, W, N, O]
  const [a, b] = key.split('_').map(Number);
  return [a / KACHEL, b / KACHEL, (a + 1) / KACHEL, (b + 1) / KACHEL].map(x => +x.toFixed(4));
}
export function overpassAbfrage(key, timeout = 90) {
  const box = kachelBox(key).join(',');
  return `[out:json][timeout:${timeout}];(way["highway"~"^(${STRASSEN.join('|')})$"](${box});`
    + `way["highway"~"^(${NUR_MIT_LIMIT.join('|')})$"]["maxspeed"](${box});`
    + `way["highway"~"^(${NUR_MIT_LIMIT.join('|')})$"]["maxspeed:forward"](${box});`
    + `way["highway"~"^(${NUR_MIT_LIMIT.join('|')})$"]["maxspeed:backward"](${box}););out tags geom;`;
}
// Overpass-Antwort (out tags geom) → { w: Einträge dieser Kachel, land, stand }. Ganze Wege kommen zurück; behalten
// wird nur, was nach dem Teilen in dieser Kachel liegt, damit das Ergebnis dem Geofabrik-Weg entspricht.
export function ausOverpass(antwort, key) {
  const wege = (antwort.elements ?? []).filter(e => e.type === 'way' && e.tags && e.geometry?.length >= 2);
  const zaehl = {};
  for (const e of wege) { const l = landAusTags(e.tags); if (l) zaehl[l] = (zaehl[l] ?? 0) + 1; }
  const land = Object.entries(zaehl).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const w = [];
  for (const e of wege) {
    const l = wegLimits(e.tags, land); if (!l) continue;
    const roh = e.geometry.filter(Boolean).map(g => [g.lat, g.lon]);
    if (roh.length < 2) continue;
    teilen(e.id, l.f, l.b, roh, (k, eintrag) => { if (k === key) w.push(eintrag); });
  }
  return { w, land, stand: antwort.osm3s?.timestamp_osm_base?.slice(0, 10) ?? null };
}
