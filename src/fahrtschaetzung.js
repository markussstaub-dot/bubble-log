// Akku-Schätzung während der Fahrt (SPEC-usability.md, US2, Wunsch Markus 08.11.2026): nicht nur „≈ 78 %“, sondern
// auch, womit die App rechnet und warum, damit man unterwegs mit der Anzeige im Micro vergleichen kann.
// Gleiche Rechnung wie der Ziel-Check (zielRechnung in main.js): gelernter Verbrauch je km, Winterzuschlag nach Temperatur,
// Steigung aus den Höhenmetern. Kein Messwert, der Micro verrät seinen Verbrauch nicht.

// Winterzuschlag (15.11.2026, Wunsch Markus: erst simpel und pauschal, über den Winter Daten sammeln, dann präziser).
// Deckt Heizen und kalten Akku zusammen ab, ohne Eingabe. Stufen nach Außentemperatur, je Stufe [unter °C, Anteil].
// Der gelernte Verbrauch wird je Fahrt um diesen Zuschlag bereinigt (main.js avg), damit Kälte nicht doppelt zählt.
export const WINTER_STUFEN = [[0, 0.30], [5, 0.20], [10, 0.10]];
export const winterZuschlag = temp => temp == null ? 0 : (WINTER_STUFEN.find(([unter]) => temp < unter)?.[1] ?? 0);
const BERGAUF_AB = 0.05;             // %/km aus Steigung, ab hier steht „bergauf“ dabei (≈ 3 Hm je km bei 10,5 kWh)

// start: Akku beim Losfahren (%), km: bisher gefahren, proKm: gelernter Verbrauch auf flacher Strecke (%/km),
// temp: °C oder null (dann ohne Winterzuschlag), steig: % Akku, die die Höhenmeter bisher gekostet haben,
// hm: { auf, ab } oder null
export function fahrtSchaetzung({ start, km, proKm, temp = null, steig = 0, hm = null }) {
  const kalt = winterZuschlag(temp);
  const basis = km * proKm, verbrauch = basis * (1 + kalt) + steig;
  const soc = Math.max(0, Math.round(start - verbrauch));
  // Ganz am Anfang sagt der Schnitt der Fahrt nichts, dann gilt der Wert für flache Strecke bei dieser Temperatur
  const jeKm = km >= 0.5 ? verbrauch / km : proKm * (1 + kalt);
  const gruende = [];
  if (temp != null) gruende.push(kalt > 0 ? `${temp} °C, Winter +${Math.round(kalt * 100)} %` : `${temp} °C`);
  if (km >= 0.5 && steig / km >= BERGAUF_AB) gruende.push(`bergauf${hm ? ` ↑ ${hm.auf} Hm` : ''}`);
  else if (hm && km >= 0.5 && hm.ab > hm.auf + 20) gruende.push(`bergab ↓ ${hm.ab} Hm`);
  if (!gruende.length) gruende.push('flach gerechnet');
  return { soc, jeKm, gruende };
}

// „≈ 1,3 %/km · 5 °C · bergauf ↑ 40 Hm“
export const grundText = s => `≈ ${s.jeKm.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %/km · ${s.gruende.join(' · ')}`;
