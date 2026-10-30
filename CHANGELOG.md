# Änderungen je APK

Neueste oben. Die Versionsnummer steht in der App unter Einstellungen ganz unten.

## Unveröffentlicht
- **Fix Datenverlust (Testfahrt 30.10.):** Eine beendete, noch nicht gespeicherte Fahrt wird nie mehr überschrieben.
  Blieb „Akkustand jetzt“ offen, während im Hintergrund eine Fahrt erkannt und beendet wurde, weicht der alte Dialog
  beim Zurückkommen der Akku-Abfrage „Fahrt beendet“; „Fahrt jetzt starten“, „Nur Akkustand merken“ und „Fahrt
  nachtragen“ aus so einem Dialog öffnen stattdessen die wartende Fahrt (`src/dialoge.js`, Tests). Log: `beginn
  abgelehnt`, `dialog ersetzt`, `knopf veraltet`.
- Knopf „📷 Display fotografieren“ im Akku-Dialog größer (Wunsch Markus, 30.10.).
- **Fix Foto vom Display am Fold6** („The source image could not be decoded.“): Das Foto wird jetzt nativ in
  `Texterkennung.java` gelesen und verkleinert (JPEG und HEIF), nicht mehr im WebView. Log `foto` mit Bildangaben
  (`bild`) bzw. Fehlercode.
- **Fahrt nachtragen** (`SPEC-gps-abbruch.md`, Mockup „Fahrt nachtragen“): „Fahrt starten“ bei laufender
  Fahrterkennung öffnet „Akkustand jetzt“ mit drei Wegen: Fahrt nachtragen, Fahrt jetzt starten, Nur Akkustand merken.
  War die App über 10 min zu und hat sich das Handy bewegt (GPS mit Tempo oder Vibration), steht „Nachtragen“ oben mit
  Hinweis „Seit 16:22 war die App zu …“. Dafür merkt sich die App eine kleine Spur (sichtbar/verborgen/bewegt, 2 Tage),
  auch ohne Entwicklermodus (`src/nachtragen.js`, Tests in `tests/nachtragen.test.js`).
- Formular: Zeitraum aus der Lücke vorgeschlagen, Start-Akku = letzter Stand, Ende = eben eingegeben, Strecke über
  gemerktes Ziel (Weg ab Zuhause, passendstes Ziel zum Verbrauch vorausgewählt, „hin und zurück“) oder km von Hand, Zweck.
- Fahrtenbuch: Siegel „nachgetragen“, Stift statt Spur, km mit „≈“; zählt für km, Verbrauch und Reichweite. Antippen
  öffnet sie zum Ändern oder Löschen, Knopf „+ Fahrt nachtragen“, Meldung mit „Rückgängig“. Log: `fahrt` mit
  `schritt: 'nachgetragen'` und `strecke.quelle` (`ziel`/`hand`). Akkustand merkt sich jetzt auch die Uhrzeit (`socT`).

## Bubble-Log-1418 (29.10.2026, Version 2026.10.29-1418)
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
- GPS-Abbruch (`SPEC-gps-abbruch.md`, Stufe 1 und 2): **Wächter** beim Start und Sichtbarwerden der App: Ist eine Fahrt
  offen und der letzte GPS-Punkt älter als 3 min, endet sie am letzten bewegten Punkt (Log `stopp nach GPS-Ausfall`),
  danach die gewohnte Akku-Abfrage; sonst wird das GPS neu angefordert, auch ohne Moduswechsel. **Lebenszeichen nativ**
  in `Fahrsensoren.java`: prüft jede Minute, ob der GPS-Dienst noch Punkte liefert; während einer Fahrt nach 90 s ohne
  Punkt Benachrichtigung „Fahrtaufzeichnung unterbrochen – Tippen zum Fortsetzen“. Einstellungen zeigen Akku
  (eingeschränkt/nicht eingeschränkt), Standort und Energiesparmodus mit Knopf zu den App-Infos, unter „Heute“ ein
  Hinweis bei Akku-Optimierung. Entwicklermodus loggt Start/Stopp des GPS-Dienstes, GPS-Ausfall, Energiesparmodus und
  Doze. Vibrations-Messfenster kommen jetzt mit den GPS-Punkten statt per `setInterval` (lief im Hintergrund nicht).

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
