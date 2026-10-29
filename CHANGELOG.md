# Änderungen je APK

Neueste oben. Die Versionsnummer steht in der App unter Einstellungen ganz unten.

## Unveröffentlicht
- Versionsnummer in den Einstellungen, `apk.ps1` (bauen, prüfen, aufs Handy kopieren), lokales git.
- Akkustand per Foto vom Tacho-Display (`SPEC-foto.md`): Knopf „📷 Display fotografieren“ bei Start und Ende, Erkennung
  offline mit ML Kit, Drehrad springt auf den Wert, Bestätigen wie bisher. Foto bleibt klein an der Fahrt, Vorschaubild
  in der Fahrtenliste, Einstellung „Fotos beim Export mitgeben“, Entwicklermodus loggt `foto`.
- APK nur noch für `arm64-v8a` (sonst 47 MB wegen ML Kit).
- Herkunft der Akkuwerte (`src/herkunft.js`, `SPEC-mot.md`): Fahrten speichern `startQuelle`/`endeQuelle`
  (`vorschlag`, `drehrad`, `foto`). Ist der Endwert nur die unverändert bestätigte Schätzung, zählt die Fahrt nicht in den
  Verbrauchsschnitt, mit Hinweis im Ergebnis. Vorbereitung für Fahrzeugdaten (MOT) als weitere Quelle.
- Akku-Drehrad neu nach dem Standard Scrollrad MK IV (`src/scrollrad.js`, aus `../gods-own-ui/`): Trommel mit Physik
  (Schwung, Rastung, Gummi-Anschlag), Klick und kurzer Vibration je Zahl (Berechtigung `VIBRATE`). Nach der
  Foto-Erkennung dreht das Rad sichtbar auf den Wert. Tests in `tests/scrollrad.test.js`.

## Bubble-Log-1415 (28.10.2026, noch ohne Versionsnummer in der App)
- Log-Teilen repariert (bis 1903 kamen geteilte Logs nie an).
- Fahrterkennung: Kern in `erkennung.js` mit Tests; nach GPS-Sprüngen kein doppelter Umweg in den km; lange GPS-Lücke
  fast ohne Ortswechsel (Tiefgarage) beendet die Fahrt.
- Verbrauchsschnitt nur aus Fahrten ab 1 km und bis 5 %/km; Rückfrage bei unplausiblem Akkuwert; automatisch erkannte
  Fahrten unter 0,3 km werden verworfen.
- Entwicklermodus: Messfenster `vibration` alle 5 s, Sensoren auch beim Warten.
- Seit 1903 außerdem: Ladepunkt im Tab „Laden“, Sim-Tab mit 2D/3D, Sim-Welt, Joystick, Cockpit.

## Bubble-Log-1903 (27.10.2026)
- Erste Testfahrten auf dem Fold6: Fahrterkennung, Akku per Drehrad, Ziel-Check, Ladepunkte, Sensoren, Entwicklermodus.
