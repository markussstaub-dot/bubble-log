// Herkunft eines Akkuwerts (SPEC-mot.md, „Gemeinsame Logik für Mensch und Fahrzeug“).
// Verbrauch und Reichweite fragen nur Wert und Herkunft ab; später kommt 'fahrzeug' (CAN-Bus) als weitere Quelle dazu.
//   'vorschlag' – der vorgeschlagene Wert wurde unverändert bestätigt, das Drehrad nicht angefasst
//   'drehrad'   – am Drehrad eingestellt oder bewusst angefasst
//   'foto'      – per Foto erkannt und so bestätigt
export function herkunft({ wert, vorschlag, foto = null, beruehrt = false }) {
  if (foto != null && foto === wert) return 'foto';
  if (beruehrt || wert !== vorschlag) return 'drehrad';
  return 'vorschlag';
}

// Ist der Endwert nur die unverändert bestätigte Schätzung (Start − km × Schnitt), bestätigt die Fahrt bloß den
// eigenen Schnitt. Sie zählt dann nicht mit, sonst füttert sich der Verbrauch mit sich selbst.
// Alte Fahrten ohne Angabe gelten als am Drehrad eingestellt.
export const nurSchaetzung = f => f.endeQuelle === 'vorschlag';

// Startwert ohne Frage (SPEC-usability.md, US1): Beim Losfahren gilt der letzte bekannte Stand.
//   'stand'      – der letzte bekannte Stand selbst (Ladeende, Fahrtende, Tagesabschluss, gemerkt): belastbar
//   'schaetzung' – daraus geschätzt (wartende Fahrten dazwischen, Stand war selbst nur eine Schätzung, gar kein Stand)
// stand: letzter bekannter Akkustand oder null; wartendDanach: seitdem Fahrten ohne Akkustand;
// standGeschaetzt: der Stand ist das unveränderte Schätz-Ende einer Fahrt
export function startQuelleAuto({ stand, wartendDanach = false, standGeschaetzt = false }) {
  return stand != null && !wartendDanach && !standGeschaetzt ? 'stand' : 'schaetzung';
}
// Automatisch gesetzter Startwert (kein Mensch hat ihn angesehen)?
export const startAutomatisch = q => q === 'stand' || q === 'schaetzung';
// Lernt der Verbrauch aus dieser Fahrt? Weder Ende noch Start dürfen bloß geschätzt sein.
export const startGeschaetzt = f => f.startQuelle === 'schaetzung';
export const belastbar = f => !nurSchaetzung(f) && !startGeschaetzt(f);
