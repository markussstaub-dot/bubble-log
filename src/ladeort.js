// Ort fürs Ladeformular vorschlagen.
// 09.11.2026: Laden bei Mami (≈ 5 km von Zuhause) wurde als „Zuhause“ zu 0,35 €/kWh gespeichert, weil der Vorschlag
// ohne nahen eigenen Ladeort immer „Zuhause“ war. Jetzt: „Zuhause“ nur, wenn man dort steht (oder kein Standort bekannt
// ist). Steht man woanders, gibt es keinen Vorschlag ('') und das Formular verlangt eine Wahl.
export const LADEORT_RADIUS = 200;   // m: so nah an einem eigenen Ladeort wird er vorgeschlagen
export const HEIM_RADIUS = 300;   // m: so nah an Zuhause gilt „Zuhause“

// gewaehlt: Wahl im Formular (oder null), liste: alle Orte im Auswahlfeld, hier: [lat, lon] oder null,
// zuhause: [lat, lon] oder null, eigene: [{ name, p }], nahe(a, b, m): Abstand unter m Metern?
export function ortVorschlag({ gewaehlt, liste, hier, zuhause, eigene = [], nahe }) {
  if (gewaehlt && liste.includes(gewaehlt)) return gewaehlt;
  if (!hier) return 'Zuhause';
  const eigener = eigene.find(o => nahe(o.p, hier, LADEORT_RADIUS));
  if (eigener) return eigener.name;
  if (!zuhause || nahe(zuhause, hier, HEIM_RADIUS)) return 'Zuhause';
  return '';
}

// Doppelt gespeichert? 09.11.2026: Nach dem Speichern übers Drehrad (49 → 65) füllte sich das Formular gleich neu
// (65 → 100), ein Tipp auf „Ladevorgang speichern“ 1,6 s später legte ein erfundenes Laden auf 100 % an. Kommt ein
// Speichern kurz nach dem letzten, muss man es ein zweites Mal bestätigen.
export const DOPPEL_MS = 60000;      // so kurz nach dem letzten Ladevorgang wird nachgefragt
export const BESTAETIGEN_MS = 15000; // so lange gilt der zweite Tipp als Bestätigung
export function nachfragen({ letzter, jetzt, bestaetigtUm = 0 }) {
  const t = Number(String(letzter?.id ?? '').slice(1));
  if (!t || jetzt - t > DOPPEL_MS) return false;
  return !(bestaetigtUm && jetzt - bestaetigtUm <= BESTAETIGEN_MS);
}
