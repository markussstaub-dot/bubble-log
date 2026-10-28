// Foto vom Tacho-Display: aus dem erkannten Text Akkustand und Kilometerstand heraussuchen (SPEC-foto.md).
// Reine Funktionen ohne Capacitor, damit sie mit `npm test` laufen. Die Texterkennung selbst steckt in foto.js.
//
// Ansicht „Rundinstrumente“: „100%“ im Akku-Ring, trip km „0790,5“, total km „007973“ (6 Ziffern), Tempo „0 km/h“,
//   Uhrzeit „19:16“, Datum „28.10.2026“.
// Ansicht „Straße“: „99 %“ oben links, Tempo „00“, Uhrzeit/Datum, trip km; total km nur leere Kästchen.

export const SOC_TOLERANZ = 1;   // Prozentpunkte: die beiden Ansichten runden unterschiedlich (100 % gegen 99 % in derselben Minute)

// Zahl direkt vor „%“ (mit oder ohne Leerzeichen, auch über einen Zeilenumbruch, falls die Erkennung „%“ abtrennt).
// Davor darf keine Ziffer, kein Punkt, Komma oder Doppelpunkt stehen: das wären Datum, Uhrzeit oder Kommazahl.
const PROZENT = /(?<![\d.,:])(\d{1,3})\s*[%％]/g;
// 6 Ziffern unter bzw. hinter „total km“, die Kästchen trennt die Erkennung manchmal mit Leerzeichen
const TOTAL_KM = /total\s*km\D{0,3}?((?:[\dO]\s?){5}[\dO])(?![\d,.])/i;
const SECHS_ZIFFERN = /(?<![\d.,:])\d{6}(?![\d.,:])/g;

// Ergebnis: { soc: 0–100 oder null, km: Kilometerstand oder null, kandidaten: alle Prozentzahlen in Lesereihenfolge }
export function leseDisplay(text = '') {
  const kandidaten = [...String(text).matchAll(PROZENT)].map(m => Number(m[1])).filter(n => n <= 100);
  const verschieden = [...new Set(kandidaten)];
  return { soc: verschieden.length === 1 ? verschieden[0] : null, km: leseKm(text), kandidaten };
}

function leseKm(text) {
  const t = String(text);
  const m = t.match(TOTAL_KM);
  if (m) return Number(m[1].replace(/\s/g, '').replace(/O/g, '0'));
  const sechs = [...new Set(t.match(SECHS_ZIFFERN) || [])];
  return sechs.length === 1 ? Number(sechs[0]) : null;
}

// Erkannter Akkuwert für den Dialog: null, wenn keiner oder unplausibel (beim Ende höher als beim Start; ohne Laden
// kann der Akku unterwegs nicht steigen, 1 Punkt Rundungsunterschied zwischen den Ansichten ist erlaubt).
export function socPlausibel(soc, { start = null } = {}) {
  if (soc == null || !(soc >= 0 && soc <= 100)) return false;
  return start == null || soc <= start + SOC_TOLERANZ;
}

// Browser beim Entwickeln: Platzhalter statt Texterkennung, die Zahl steckt im Dateinamen („akku-48.jpg“,
// optional „akku-48-km-007973.jpg“). Liefert Text im Format der Display-Erkennung.
export function textAusDateiname(name = '') {
  const soc = String(name).match(/akku[-_ ]?(\d{1,3})/i), km = String(name).match(/km[-_ ]?(\d{6})/i);
  return [soc ? `${soc[1]} %` : '', km ? `total km\n${km[1]}` : ''].filter(Boolean).join('\n');
}
