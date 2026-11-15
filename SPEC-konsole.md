# SPEC: Konsole und Notizen für alle (15.11.2026, abgestimmt)

## Ausgangslage
- Die **Konsole** gibt es seit APK 1122: Einstellungen → Entwicklermodus → „Konsole“. Sie zeigt das Devlog live mit
  Filtern, Suche und Pause (`src/konsole.js`).
- **Notizen** kommen bisher nur von der Sticky-App (Broadcast, Signatur-Berechtigung, `Notizen.java`,
  `src/notizen.js`). Sie landen als Typ `notiz` im Devlog, und zwar nur bei aktivem Entwicklermodus.
- Nutzen für Markus: Testnotizen beim Fahren neben den Logs sehen.
- **Ziel:** Konsole und Notizen kommen mit ins Release für die Forumsnutzer. Dafür muss beides generisch werden, also
  nicht mehr an den Sticky, Markus' Schlüssel und den Entwicklermodus gebunden.

## Fest
- Notizen bleiben auf dem Handy, kein Server.
- Während der Fahrt keine Eingabe in Bubble Log selbst. Notizen kommen von außen (Sprache, Sticky, andere Apps).
- Der Sticky-Weg (Broadcast mit Signatur-Berechtigung) bleibt und funktioniert weiter.
- Das Devlog bleibt ein Entwicklerwerkzeug (rohe GPS-Punkte, 14 Tage).

## Vorschlag
1. **Notizen werden eigene Daten, nicht nur Devlog-Zeilen.** Ein eigener Speicher in `eigen.notizen`:
   `{ t, quelle, art, text, lat?, lon?, fahrtId? }`. Er funktioniert ohne Entwicklermodus. Jede Notiz wird über
   die Zeit der passenden Fahrt zugeordnet. Im Devlog stehen sie weiterhin, wenn der Modus an ist.
2. **Notizen bei der Fahrt zeigen.** In Fahrtdetail und Tagestour steht „🗒 2 Notizen“, aufklappbar mit Uhrzeit und
   Ort auf der Karte. Das ist der eigentliche Nutzen für andere: „Was war da noch mal?“
3. **Jede App kann Notizen schicken, über „Teilen“.** Bubble Log wird Teilen-Ziel für Text (`ACTION_SEND`
   text/plain). Damit gehen ein Diktat aus Google Recorder oder Samsung-Sprachmemo, eine Notiz aus Keep oder ein
   Kurzbefehl aus Tasker. Android zeigt dabei die Auswahl, ein Fremder kann also nichts unbemerkt einspielen. Zeit
   ist der Empfang, der Ort der letzte GPS-Punkt.
4. **Konsole für alle, zweistufig:**
   - *Für alle:* „Verlauf“ als ruhige Liste der wichtigen Ereignisse: Fahrt begonnen und beendet, Laden, Notizen,
     Fehler, Tempolimit-Wechsel. Ohne GPS-Rohdaten, in Klartext („09:38 Fahrt erkannt“ statt
     `schritt=beginn km=0.3`). Hilft beim Selbsthelfen („Warum wurde meine Fahrt verworfen?“).
   - *Entwicklermodus:* die heutige Konsole mit allem.
   Technisch dieselbe Ansicht mit einer Übersetzungstabelle Typ → Klartext. Die Filter-Chips entstehen aus den
   vorhandenen Typen und Quellen statt aus einer festen Liste.
5. **Offenes Notiz-Format dokumentieren.** Ein kurzer Abschnitt im README beschreibt Felder, Teilen und Broadcast,
   damit andere eigene Absender bauen können.

## Entschieden (Markus, 15.11.2026: alle Vorschläge so)
1. Broadcast bleibt zu (Signatur), fremde Apps nur über „Teilen“
2. „Verlauf“ oben im Fahrten-Tab
3. Notizen als Spalte in der Fahrtenbuch-CSV
4. Einzeln wischen mit Rückgängig; „Alle Daten löschen“ nimmt sie mit
5. Für andere Nutzer reicht zum Start „Teilen“

## Nicht in diesem Schritt
- Fotos oder Audio als Notiz: nur Text. Die Sticky-App behält ihre Audios selbst.
- Sprache direkt in Bubble Log aufnehmen: widerspricht „keine Eingabe während der Fahrt“ und gibt es über Teilen
  schon.
- Notizen an OpenStreetMap weiterreichen, etwa „Schild falsch“: Das gehört zu den Tempolimit-Korrekturen (STAND.md),
  später.

## Fertig, wenn
- Eine Notiz per Teilen aus einer beliebigen App landet ohne Entwicklermodus bei der richtigen Fahrt.
- Sticky-Notizen kommen weiter an, auch ohne Entwicklermodus.
- Der „Verlauf“ zeigt die wichtigen Ereignisse in Klartext, die Entwickler-Konsole ist unverändert.
- Tests für Zuordnung Notiz → Fahrt und Klartext-Übersetzung, `npm test` grün, im Browser geprüft.

## Umgesetzt (15.11.2026, noch nicht in einer APK)
- Notizen: `src/notizbuch.js` (Format, Zuordnung 2 Min. vor dem Start bis 10 Min. nach dem Ende, Ort, CSV),
  Empfang `src/notizen.js`, Teilen-Ziel in `Notizen.java` + `AndroidManifest.xml`. Ohne eigenen Ort wird er
  anteilig entlang der Fahrt geschätzt („Ort ungefähr“). Orte im Unschärfe-Kreis um Zuhause/Ladeorte zeigt die Karte nicht.
- Verlauf, Quelle der Daten (im Vorschlag offen): ein eigener kleiner Speicher (`src/verlauf.js`, Schlüssel
  `bubble-log.verlauf`, 14 Tage, höchstens 1000 Einträge, Klartext statt Rohzeile). Gefüllt über `devlog.mitlesen`,
  das jede Log-Zeile auch ohne Entwicklermodus sieht. Warum nicht das Devlog: Es schreibt nur im Entwicklermodus und
  enthält GPS-Rohdaten. Warum nicht in `eigen`: Das wird während der Fahrt alle 15 s geschrieben und ist das
  eigentliche Fahrtenbuch; der Verlauf soll es weder aufblähen noch gefährden.
- Ansicht: `src/konsole.js` mit zwei Arten („konsole“ unverändert, „verlauf“ mit Übersetzungstabelle `KLARTEXT`).
