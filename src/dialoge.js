// Veraltete Dialoge (Testfahrt 30.10.2026): Ein Dialog bleibt offen, die App geht in den Hintergrund, dort wird eine
// Fahrt erkannt und beendet. Beim Zurückkommen gilt der alte Dialog nicht mehr und darf nicht gegen die neue Lage handeln.

// Dialoge, die nur ohne offene Fahrt Sinn haben: „Akkustand jetzt“, „Akkustand beim Start“ vor „Losfahren“ und das
// Ergebnis einer schon gespeicherten Fahrt. Sie weichen, sobald eine Fahrt offen ist.
export const OHNE_FAHRT = ['warten', 'losfahren', 'ergebnis'];
// Knöpfe aus diesen Dialogen, die eine offene Fahrt überschreiben, doppelt zählen oder ihren Akkustand verfälschen würden
export const AKTIONEN_OHNE_FAHRT = ['go', 'socMerken', 'ntAusAkku'];

// Beim Sichtbarwerden der App oder Antippen der Meldung. art: offener Dialog (null = keiner, 'anderes' = ohne Art).
// Ergebnis: 'ende' (Akku-Abfrage zum Fahrtende), 'start' (Fahrtansicht + Start-Akku), 'fahrt' (Fahrtansicht) oder null.
export function beimOeffnen(offen, art) {
  if (!offen) return null;
  if (art && !OHNE_FAHRT.includes(art)) return null;   // Dialog zur Fahrt oder z. B. Einstellungen: nicht stören
  if (offen.status === 'beendet') return 'ende';
  if (offen.startSoc == null) return 'start';
  return art ? 'fahrt' : null;
}

// Knopf aus einem Dialog ohne Fahrt, während inzwischen eine Fahrt offen ist?
export const veraltet = (akt, offen) => !!offen && AKTIONEN_OHNE_FAHRT.includes(akt);
