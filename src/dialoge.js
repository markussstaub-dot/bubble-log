// Veraltete Dialoge (Testfahrt 30.10.2026): Ein Dialog bleibt offen, die App geht in den Hintergrund, dort wird eine
// Fahrt erkannt und beendet. Beim Zurückkommen gilt der alte Dialog nicht mehr und darf nicht gegen die neue Lage handeln.

// Dialoge, die nur ohne offene Fahrt Sinn haben: „Akkustand jetzt“, „Akkustand beim Start“ vor „Losfahren“ und das
// Ergebnis einer schon gespeicherten Fahrt, Akku vor/nach dem Laden. Sie weichen, sobald eine Fahrt offen ist.
export const OHNE_FAHRT = ['warten', 'losfahren', 'ergebnis', 'laden'];
// Knöpfe aus diesen Dialogen, die eine offene Fahrt überschreiben, doppelt zählen oder ihren Akkustand verfälschen würden
export const AKTIONEN_OHNE_FAHRT = ['go', 'socMerken', 'ntAusAkku'];

// Beim Sichtbarwerden der App, Antippen der Meldung oder Erkennen einer Fahrt. art: offener Dialog (null = keiner,
// 'anderes' = ohne Art). Ergebnis: 'ende' (Akku-Abfrage zum Fahrtende), 'fahrt' (Fahrtansicht) oder null.
// Während der Fahrt nie eine Frage (SPEC-usability.md, US1): den Startwert setzt die App selbst, gefragt wird erst am
// Ende. Die Fahrtansicht kommt, wenn ein Dialog von vor der Fahrt weichen muss oder sie noch nie zu sehen war
// (Fahrt im Hintergrund erkannt); hat man sie danach ausgeblendet, bleibt sie zu.
export function beimOeffnen(offen, art) {
  if (!offen) return null;
  if (art && !OHNE_FAHRT.includes(art)) return null;   // Dialog zur Fahrt oder z. B. Einstellungen: nicht stören
  if (offen.status === 'beendet') return 'ende';
  return art || !offen.gesehen ? 'fahrt' : null;
}

// Knopf aus einem Dialog ohne Fahrt, während inzwischen eine Fahrt offen ist?
export const veraltet = (akt, offen) => !!offen && AKTIONEN_OHNE_FAHRT.includes(akt);
