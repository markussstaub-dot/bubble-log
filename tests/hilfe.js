// Synthetische Logs für die Tests: gps-Zeilen wie aus devlog.js, entlang einer Geraden nach Osten ab Bexbach.
export const BEXBACH = [49.3466, 7.2577];
export const T0 = new Date(2026, 9, 28, 12, 0, 0).getTime();   // 28.10.2026 12:00:00 Ortszeit

// schritte: { s: Sekunden, v: m/s, gen: Genauigkeit m, takt: s zwischen Punkten, luecke: keine Punkte (Funkloch),
//             sprung: m nach Norden versetzt für n Punkte (GPS-Fehler, die echte Spur läuft weiter) }
export function fahrplan(schritte, { start = BEXBACH, t0 = T0 } = {}) {
  const zeilen = [], mProGradLon = 111320 * Math.cos(start[0] * Math.PI / 180);
  let t = t0, ost = 0;
  const punkt = (v, gen, nord = 0) => zeilen.push({
    t, typ: 'gps', modus: 'warten', lat: start[0] + nord / 111320, lon: start[1] + ost / mProGradLon,
    gen, tempo: v, hoehe: null, kurs: 90, zeit: t,
  });
  for (const { s = 0, v = 0, gen = 5, takt = 1, luecke = false, sprung = 0, n = 1 } of schritte) {
    if (sprung) { for (let i = 0; i < n; i++) { t += 1000; ost += v; punkt(v, gen, sprung); } continue; }
    for (let i = 0; i < s; i += takt) {
      t += takt * 1000; ost += v * takt;
      if (!luecke) punkt(v, gen);
    }
  }
  return zeilen;
}
