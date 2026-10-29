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
