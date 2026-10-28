// Umrechnung Karte ↔ Meter für die 3D-Ansicht (gleiche flache Näherung wie fahrsim.js).
// Koordinaten in three.js: x = Osten, y = hoch, z = Süden (also z = -Norden), Meter ab Startpunkt.
import { auto, herkunft } from '../fahrsim.js';

export function lokal(lat, lon) {
  const [lat0, lon0] = herkunft();
  return { x: (lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), z: -(lat - lat0) * 111320 };
}
export const kachelX = (lon, z) => (lon + 180) / 360 * 2 ** z;
export const kachelY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
export const kachelLon = (x, z) => x / 2 ** z * 360 - 180;
export const kachelLat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
// aktuelle Position des Autos als [lat, lon]
export function geo() {
  const [lat0, lon0] = herkunft(), c = auto();
  return [lat0 + c.n / 111320, lon0 + c.e / (111320 * Math.cos(lat0 * Math.PI / 180))];
}
