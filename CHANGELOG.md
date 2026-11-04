# Änderungen je APK

Neueste oben. Die Versionsnummer steht in der App unter Einstellungen ganz unten.

## Unveröffentlicht
- **Weniger Akku im Wartemodus** (04.11.2026, `SPEC-akku.md`): Anlass war die Akkustatistik vom Fold6. Bubble Log
  hielt das Handy beim Warten ≈ 9,5 h am Tag wach (9054 `NetworkLocationScanner`-Wakelocks in 27 h), weil das
  GPS-Plugin fest jede Sekunde ortet. Neu: `patches/` (patch-package, läuft per `postinstall`) gibt
  `addWatcher` ein `interval`. Beim Warten in Ruhe ortet die App nur alle 30 s; sobald ein Punkt mit ≥ 3 m/s auffällt
  (Kandidat), sofort jede Sekunde, und nach dem Verwerfen des Kandidaten wieder alle 30 s. Der Fahrtmodus bleibt
  unverändert. Im Entwicklermodus gibt es den Schalter „Warten: volle GPS-Rate“ (das bisherige Verhalten) und die
  Auswahl „Ortung in Ruhe alle 15/30/60 s“; ohne Entwicklermodus gelten immer 30 s. Das Replay kann den Sparmodus
  nachstellen (`node tools/replay.mjs DATEI RUHE_TAKT=30000`). Alle Logs vom 27.10. bis 03.11. erkennen damit
  dieselben Fahrten (`tests/akku.test.js`). Befund: Bei Stop-and-go gleich nach dem Losfahren kann der Start mehr als
  30 s später kommen (29.10.: 90 s); er steht als `todo` im Test. Im Browser in Handygröße geprüft (Schalter und
  Auswahl bleiben nach Neuladen, ohne Entwicklermodus ausgeblendet). Das native GPS lässt sich nur auf dem Handy prüfen.
- **Wohlfühlreserve** (02.11.2026): Einstellungen → „Wohlfühlreserve bei Ankunft“ (10–40 %, Standard 15 %). Ziel-Check,
  Ampel der gemerkten Ziele und Ladehinweise rechnen damit statt mit festen 15 %: darüber grün, darunter gelb, unter
  5 % rot. Anlass: Ankunft mit 18 % ist technisch genug, Spaß macht es erst ab 30 %. Im Browser geprüft (30 %
  eingestellt, Texte ziehen mit, bleibt nach Neuladen). Bleibt beim Löschen aller Daten erhalten.
- **Ladesäulen auch für die Schweiz** (02.11.2026): `tools/ladepunkte-ch.mjs` mischt die BFE-Daten von
  ich-tanke-strom.ch (Open Data, 6963 Standorte mit Typ 2 oder Haushaltssteckdose, nur Punkte in CH/LI) in die Kacheln.
  Zusammen 80 Kacheln, 64 761 Standorte, 8,6 MB. Im Browser mit einem Zuhause in Zürich geprüft: 7167 Standorte.
- **Ladesäulen für jede Homebase** (`SPEC-ladepunkte.md`): `tools/ladepunkte.mjs --kacheln` schneidet das
  BNetzA-Register (Stand 01.09.2026, 57 797 Standorte mit Typ 2 oder Schuko) in 71 Kacheln zu 1° nach
  `docs/ladepunkte/` (GitHub Pages, 7,7 MB). Einstellungen → Zuhause → „Ladesäulen für dein Zuhause laden“ holt die
  Kacheln im Umkreis von 120 km (`src/ladecache.js`), speichert sie auf dem Handy und nutzt sie danach offline statt
  des eingebauten Bexbach-Auszugs. Im Browser mit einem Zuhause in Hamburg geprüft: 5474 Standorte, nach Neustart aktiv.
  Funktioniert in der App erst, wenn `docs/ladepunkte/` auf GitHub Pages liegt (Push).
- **Für andere Nutzer** (02.11.2026): Beim ersten Start kein vorgegebenes Zuhause (bisher Bexbach) und keine Startliste
  mit 18 Zielen aus dem Saarland mehr; wer sie schon hat, behält sie. Ohne Zuhause weist die Tagestour darauf hin, dass
  die Strecke an der Haustür sichtbar ist. Datenschutz-Satz in den Einstellungen ehrlich ergänzt (Open-Meteo,
  OpenStreetMap, OSRM). Im Browser mit leerem Speicher geprüft: alle Tabs ohne Fehler.
- **Visuelles Logbuch, Meilenstein 1** (`SPEC-logbuch.md`): Im Fahrten-Tab je Tag ein Knopf „🗺️ Tagestour“. Zeigt
  Kennzahlen (km, Akku, Fahrten, Höhenmeter, geladen, ❄️ Kaltstart, %/km), eine Karte mit allen Fahrten des Tages,
  das Höhenprofil über den Tag (Barometer) und den Akku-Verlauf mit Ladesprüngen und 15-%-Linie. Neu: `src/logbuch.js`
  (Tests in `tests/logbuch.test.js`).
- **Privacy:** Einstellung „Unschärfe im Logbuch“ (aus · 200 · 400 · 800 m, Standard 400). Zuhause und eigene Ladeorte
  werden nicht gezeichnet, sondern als gestrichelter Kreis mit fest versetzter Mitte. Im Browser in Handygröße geprüft.
- **Tag abschließen** (02.11.2026): Warten zwei oder mehr Fahrten auf den Akkustand, zeigt „Heute“ einen Knopf dafür.
  Einmal „Akku jetzt“ eintragen, optional bekannte Start- oder Endwerte (z. B. nach dem Laden); die App verteilt den
  Verbrauch nach Strecke, Höhe und Kaltstart (`src/tagesabschluss.js`, Tests in `tests/tagesabschluss.test.js`).
  Steigt der Akku zwischen zwei Fahrten ohne Angabe, kommt ein Hinweis statt erfundener Werte. Geschätzte Fahrten
  zählen nicht in den Verbrauch, nur Fahrten mit eingetragenem Start und Ende. Im Browser mit nachgebauten Fahrten
  geprüft (Muster vom 01./02.11.).
- **Frostnacht**: Startet eine Fahrt nach mehr als 3 h Stehen, holt die App den Tiefstwert seit dem Abstellen
  (Open-Meteo, Stundenwerte). Bis 3 °C gilt die Fahrt als Kaltstart (❄️, +2 % beim Verteilen) und zeigt
  „Davor X h gestanden · Tiefstwert Y °C“ im Ergebnis. Neu: `tiefstwert()` in `src/wetter.js`.
- Speichern einer Fahrt aufgeteilt in `fahrtAus()` und `fahrtEinsortieren()` (gemeinsam für Einzel- und Tagesabschluss).

## Bubble-Log-1234 (01.11.2026, Version 2026.11.01-1234)
- **Zwei Fahrten hintereinander** (Testfahrt 01.11.2026, `logs/AUSWERTUNG-2026-11-01.md`): Wartete die vorige Fahrt
  noch auf den Akkustand, wurde jeder neue Start still ignoriert (24 km gingen verloren). Jetzt wird sie zurückgestellt
  (`eigen.ohneAkku`), die neue Fahrt beginnt. Unter „Heute“ erscheint „Fahrt wartet auf den Akkustand“; der Dialog fragt
  den Akku am Ende dieser Fahrt. Ältere Fahrten werden nach Beginn einsortiert und überschreiben den neueren Akkustand
  nicht. Ignorierte Starts stehen im Log (`start ignoriert`). Im Browser mit SIM geprüft.

## Bubble-Log-1122 (01.11.2026, Version 2026.11.01-1122)
- **Eigene Ladeorte mit Namen** (01.11.2026, z. B. „Mami“): Tab Laden → „Eigene Ladeorte“ → Namen eingeben, „Hier als
  Ladeort merken“ speichert den aktuellen Standort. Der Ort erscheint in der Ort-Auswahl (nach Zuhause), wird in 200 m
  Umkreis von selbst vorgeschlagen und hat 0 € als Strompreis. Nur auf dem Handy gespeichert (`eigen.ladeorte`), bleibt
  beim Löschen aller Daten wie die gemerkten Ziele erhalten.
- **Mini-Navi** (Spielerei): Im Ziel-Check „Andere Wege vergleichen“ holt bis zu drei Wege von OSRM, je mit km, Minuten,
  Höhenmetern und Ankunfts-Akku. Antippen schaltet Karte und Rechnung um; dazu eine Abbiegeliste auf Deutsch
  (`anweisung()` in `src/route.js`). OSRM liefert oft nur einen Weg; eigene Lieblingsstrecken kennt es nicht.

## Bubble-Log-0816 (01.11.2026, Version 2026.11.01-0816)
- **Fix GPS weg nach Fahrtbeginn im Hintergrund** (Testfahrt 31.10.2026, `logs/AUSWERTUNG-2026-10-31.md`): Beim
  Wechsel warten↔fahrt wird erst der neue Watcher angelegt, dann der alte entfernt (`tracker.js`). Bisher beendete
  das Plugin mit dem letzten Watcher den Vordergrund-Dienst, und der aus dem Hintergrund neu gestartete Dienst bekam
  von Android keine Positionen mehr. Punkte des alten Watchers zählen in der Überlappung nicht. Nur mit APK prüfbar.
- **Kein stilles Verwerfen nach GPS-Ausfall:** Endet eine Fahrt über den Wächter (`stopp nach GPS-Ausfall`), wird sie
  nicht mehr als „zu kurz“ verworfen. Stattdessen „GPS unterwegs ausgefallen“: Akku jetzt, dann „Fahrt nachtragen“
  (Beginn und Start-Akku vorbelegt, das Bruchstück wird verworfen, Log `gps-ausfall, nachtragen`) oder verwerfen.
  Test in `tests/erkennung.test.js`.
- **Handy mit in den Laden** (bisher lag es bei den Testfahrten im Auto): Nach dem ersten Halt hinter einer Fahrt
  werden langsame Punkte (unter 7 km/h) zurückgehalten. Kommt wieder Fahrt oder geht es weiter als 150 m, zählen sie
  nachträglich zur Strecke (Stau, Rangieren). Endet die Fahrt, war es der Fußweg: Ende, Parkplatz und km bleiben am
  Auto. Die Fahrt endet 3 min nach dem Halt, auch wenn das GPS im Laden um mehr als 40 m springt (Log `stopp am Halt`,
  `park`, `fussweg`). Neue Schwellen `GEH_TEMPO`, `PARK_RADIUS` in `src/erkennung.js`, Tests in
  `tests/erkennung.test.js`. Noch nicht mit echtem Log geprüft.
- **12-V-Bordspannung mit dem BM6** (SPEC-12v.md, Meilenstein 1 fertig, Meilenstein 2 gebaut, aber ohne Gerät ungetestet):
  Einstellungen → „12-V-Wächter (BM6)“ (suchen, koppeln). Beim Fahren werden Minutenwerte mitgeschrieben, rund 2 min nach
  dem Abstellen ein Ruhewert; Bewertung ok/beobachten/verdächtig, Warnung bei Ruhe unter 12,4 V. Im Fahrtenbuch ein
  12-V-Punkt je Fahrt mit Kurve, Knopf „Springt nicht an?“ unter „Heute“ (Zeit, Ort, Temperatur, Spannung, Nachmessung,
  Foto, Notiz), Export „12-V-Beleg“ (`bordspannung-….csv`), Fahrtenbuch-CSV mit drei 12-V-Spalten. Sim-Tab: simulierter
  BM6 (normal, schwacher DC/DC, Batterie sackt ab). Neu: `src/bordspannung.js` (Tests), `src/bm6.js`, `src/bordnetz.js`,
  `Batteriewaechter.java`, Rechte BLUETOOTH_SCAN/CONNECT. Log `bordnetz`.
- **Fix Fahrt „von 17:00 bis 16:22“** (Fahrtenbuch 29.10., 0 km, 74 → 74 %): Das Fahrtende liegt nie mehr vor dem
  Beginn. Ursache laut Log: Start per Hand um 17:00:03, mit dem ersten GPS-Punkt endete die Fahrt in APK 1418 sofort als
  „stopp nach Lücke“ am Punkt aus dem Warten von 16:22 (behoben seit 1121, „alter Punkt verworfen“). Weil der Beginn
  die Uhr des Handys ist, das Ende aber die GPS-Zeit eines Punkts, konnte es trotzdem knapp davor liegen (erster Fix
  16 ms vor dem Start, danach GPS-Ausfall → Wächter). Jetzt gilt Ende = frühestens Beginn beim Beenden und beim
  Speichern (`fahrtEnde` in `src/erkennung.js`, Test). Log `fahrt`/`ende` zeigt zusätzlich `gemeldet`. Der alte Eintrag
  bleibt, bis Markus ihn löscht.

## Bubble-Log-1121 (30.10.2026, Version 2026.10.30-1121)
- **Fix Datenverlust (Testfahrt 30.10.):** Eine beendete, noch nicht gespeicherte Fahrt wird nie mehr überschrieben.
  Blieb „Akkustand jetzt“ offen, während im Hintergrund eine Fahrt erkannt und beendet wurde, weicht der alte Dialog
  beim Zurückkommen der Akku-Abfrage „Fahrt beendet“; „Fahrt jetzt starten“, „Nur Akkustand merken“ und „Fahrt
  nachtragen“ aus so einem Dialog öffnen stattdessen die wartende Fahrt (`src/dialoge.js`, Tests). Log: `beginn
  abgelehnt`, `dialog ersetzt`, `knopf veraltet`.
- Offline-Wege ab Zuhause: Wird Zuhause geändert, während die App noch Wege holt, wird der laufende Weg verworfen
  und alle Ziele kommen gleich ab dem neuen Zuhause dran (vorher blieb evtl. ein Weg vom alten Ort, der Rest kam erst
  beim nächsten Öffnen).
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
