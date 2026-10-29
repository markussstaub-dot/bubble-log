# Bubble Log als Android-App

Die Oberfläche kommt aus dem Prototyp (`knopf-display/handy-prototyp.html`), dazu:

- **Fahrterkennung per GPS**, auch wenn die App im Hintergrund ist (Android zeigt dann eine
  Dauer-Benachrichtigung „Bubble Log – Wartet auf die nächste Fahrt“).
- **Dauerhafte Speicherung auf dem Handy** (Capacitor Preferences). Es gibt keinen Server und keine Cloud.
- **Temperatur pro Fahrt** von Open-Meteo, für den Kältezuschlag.

## So erkennt die App Fahrten

| Schritt | Regel |
|---|---|
| Fahrt beginnt | mindestens 20 s lang schneller als 11 km/h und dabei mindestens 150 m weit |
| Strecke | alle 25 m ein Punkt; kleinere Sprünge (GPS-Zittern) zählen nicht |
| Fahrt endet | 3 Minuten innerhalb von 40 m stehen; als Endzeit zählt die letzte echte Bewegung |

Bei Beginn und Ende kommt eine Benachrichtigung. Ein Tipp darauf öffnet die App mit dem Drehrad
für den Akkustand. Wurde der Start-Akku nicht eingetragen, fragt die App ihn beim Ende zuerst ab.
Fahrten mit Velo, Bus oder Zug lassen sich beim Ende mit **Fahrt verwerfen** löschen.

Mit einer simulierten Fahrt geprüft: Gehen löst nichts aus, eine Ampel mit 60 s Halt beendet die
Fahrt nicht, und die Endzeit stimmt auf die Sekunde. **Auf einem echten Handy noch nicht getestet.**

## Was gegenüber dem Prototyp fehlt

- **Beispieldaten** sind raus. Bis drei eigene Fahrten da sind, rechnet die App mit 0,80 %/km.
- **Foto vom Display**: Im Prototyp war die Erkennung nur gespielt, deshalb ist der Knopf vorerst entfernt.
- **Widget**: Ein echtes Android-Widget braucht nativen Code und kommt später.
- **Karte**: Die Strecke wird als Linie ohne Kartenhintergrund gezeigt.

## Ziel-Check (Tab „Reichweite“)

Ziel suchen (OpenStreetMap/Nominatim) → Straßenroute ab dem aktuellen Standort, sonst ab dem Abstellort (OSRM) →
Höhenmeter alle etwa 300 m entlang der Route (Open-Meteo, Schwelle 3 m) → Ankunfts-Akku mit gelerntem Verbrauch,
Kältezuschlag und Steigung (bergab 50 % zurückgewonnen, wie bei den Fahrten). Hin und zurück rechnet die Abfahrten
als Steigungen. Die letzten 6 Ziele bleiben als Knöpfe. Die Karte zeigt Route und einen groben Reichweiten-Ring
(Reichweite ÷ 1,3 als Luftlinie). Ohne Netz geht der Ziel-Check nicht; Abfragen gibt es nur beim Prüfen eines Ziels.

**Ladepunkte:** Aus dem Ladesäulenregister der Bundesnetzagentur (CC BY 4.0) nur Standorte in Betrieb mit AC Typ 2
(Steckdose oder festes Kabel) oder Schuko im Umkreis von 120 km um Bexbach, fest in der App (`src/ladepunkte.json`,
offline). Aktualisieren: CSV von https://www.bundesnetzagentur.de/ladeinfrastruktur laden, dann
`node tools/ladepunkte.mjs <datei.csv> 120` und APK neu bauen. Keine Belegung, keine Preise, Frankreich fehlt.
Ladezeiten rechnet die App mit dem Ladestrom aus den Einstellungen (Standard 8 A ≈ 1,65 kW im Akku bei 230 V und
90 % Wirkungsgrad). Im Ziel-Check: Laden am Ziel für den Rückweg, „Knapp“ (10–15 % bei Ankunft, Laden am Ziel
möglich) oder Laden unterwegs mit Säulen bis 1 km neben der Route, die mit mindestens 10 % erreichbar sind.
Die Ampel kennt dazu Blau = zurück nach Laden am Ziel. Unter der Ampel stehen die 5 nächsten Ladepunkte.

**Eigene Erfahrung mit der Ladekarte** (Standard „Electroverse“, in den Einstellungen änderbar): Tipp auf einen
Ladepunkt (Liste oder Karte) → „✓ Klappt“ / „✗ Ging nicht“ für die Säule oder für alle Säulen des Betreibers.
Die Säule gilt vor dem Betreiber. Bewährte Säulen stehen in allen Listen oben und sind auf der Karte grün,
„ging nicht“ steht unten, ausgegraut, grau auf der Karte und zählt nicht für „Laden am Ziel“.

**Zuhause und gemerkte Ziele:** Zuhause ist anfangs Bexbach (Einstellungen → „Hier ist Zuhause“ zum Ändern).
Gemerkte Ziele (☆ Merken; Startliste mit 18 Orten um Bexbach) speichern Strecke, Fahrzeit, Höhenmeter und
Routenlinie ab Zuhause. Startet man im Umkreis von 1 km um Zuhause, rechnet der Ziel-Check damit ohne Netz.
Der Rückweg gilt als dieselbe Strecke rückwärts. Fehlende Wege holt die App im Hintergrund, alle 12 s einen
(Open-Meteo erlaubt etwa 600 Höhenpunkte pro Minute); ohne Höhenmeter wird nach einer Stunde neu versucht,
sonst alle 90 Tage. Ohne gewähltes Ziel zeigt „Reichweite“ alle gemerkten Ziele als Ampel mit dem aktuellen
Akku: grün hin und zurück, gelb nur hin, rot laden, jeweils mit 15 % Reserve.

## Sensoren während einer Fahrt

Ein eigenes kleines Plugin (`android/app/src/main/java/app/bubblelog/microlino/Fahrsensoren.java`, angemeldet in
`MainActivity.java`) liest Barometer und Beschleunigungssensor direkt in Android. Der WebView bekommt im Hintergrund
keine Bewegungsdaten. Die Sensoren laufen nur, solange eine Fahrt aufgezeichnet wird. Damit Android die Werte bei
dunklem Bildschirm nicht verwirft, hält ein Wake-Lock die CPU so lange wach. Bei jedem 25-m-Punkt holt die App eine
Zusammenfassung ab; Rohdaten werden nicht gespeichert. Ein Streckenpunkt ist dann `[lat, lon, Höhe m, Rütteln m/s²]`.

| Wert | So entsteht er |
|---|---|
| Höhenmeter ↑/↓ (`hm`, `hmAb`) | Barometer-Höhe pro Punkt; Schwankungen unter 2 m zählen nicht |
| Verbrauch | der gelernte %/km-Wert gilt für flache Strecken: pro Fahrt wird abgezogen, was die Steigung gekostet hat (bergab 50 % zurück) |
| Straße (`rau`, % der Abschnitte) | Effektivwert des senkrechten Rüttelns: ab 1,2 m/s² rau, ab 2,5 m/s² sehr rau |
| Starkes Bremsen/Beschleunigen (`brems`, `beschl`) | waagrechter Ausschlag ab 0,3 g; ob Bremsen, Anfahren oder Kurve, entscheidet die GPS-Geschwindigkeit 2 s davor und danach |

Oben und unten trennt die Schwerkraft, die Android selbst herausrechnet. Deshalb ist egal, wie das Handy im Halter
sitzt. Die Schwellen stehen oben in `src/sensoren.js` und `Fahrsensoren.java` und sind noch nicht an echten Fahrten
abgeglichen. Ältere Fahrten haben keine Sensorwerte; ihre Felder bleiben leer.

## Entwicklermodus

Einstellungen → **Entwicklermodus**. Solange er an ist, schreibt die App eine Datei pro Tag
(`bubble-log-JJJJ-MM-TT.jsonl`, privater App-Speicher, nach 14 Tagen gelöscht). Jede Zeile ist ein JSON-Objekt
mit `t` (Zeit in ms) und `typ`:

| `typ` | Inhalt |
|---|---|
| `gps` | jede rohe Position: `lat`, `lon`, `gen` (Genauigkeit m), `tempo` (m/s vom GPS), `tempoBerechnet`, `hoehe`, `kurs`, `zeit`, `modus`; verworfene mit `verworfen: "ungenau"` oder `"sprung"` |
| `erkennung` | Schritte der Fahrterkennung: `kandidat`, `kandidat verworfen`, `start`, `stopp` |
| `modus` | GPS-Modus wechselt (`aus`, `warten`, `fahrt`) |
| `sensor` | Barometer und Beschleunigung pro 25-m-Punkt (Rohwerte aus dem Fahrsensoren-Plugin) |
| `fahrt` | `beginn`, `ende` (von Hand oder im Hintergrund), `gespeichert` (Zusammenfassung), `verworfen` |
| `eingabe`, `meldung`, `app`, `fehler` | Akku-Eingaben, Benachrichtigungen, App sichtbar/unsichtbar, GPS-Fehler |
| `modus` (Zusatz) | `gpsDienst`: `start`/`stopp`/`neu anfordern`; `energiesparen`/`doze`: an/aus; `gps: 'zurück'` nach einem Ausfall |
| `fehler` (Zusatz) | `quelle: 'gps-ausfall'` (Fahrt, 90 s kein Punkt; `luecke`, `dienst` läuft noch?), `quelle: 'gps-dienst'` (Dienst weg) |
| `app` (Zusatz) | `system`: Akku eingeschränkt, Energiesparmodus, Standortrecht (bei Änderung) |

Auswerten zum Beispiel mit Python: `pandas.read_json("bubble-log-2026-10-27.jsonl", lines=True)`.
In der Fahrt-Ansicht zeigt eine DEV-Zeile live Genauigkeit, Tempo, Alter der letzten Position und den Modus.

## Bauen

Auf diesem PC eingerichtet (27.10.2026):

- **Microsoft OpenJDK 21** unter `C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot`. Die Capacitor-Plugins
  verlangen genau Java 21; das Java 25 von Android Studio reicht nicht.
- **Android SDK** unter `%LOCALAPPDATA%\Android\Sdk` (Android 16 / API 36, Build-Tools 35, Platform-Tools),
  eingetragen in `android/local.properties`.
- **Android Studio** 2026.2.1.8, nur nötig zum Ausführen per USB.

**Einfachster Weg:** Handy anstecken und entsperren, dann `.\apk.ps1` im Projektordner (Tests, Build, Prüfen,
Kopie aufs Fold6; Ablauf in `ENTWICKLUNG.md`). Von Hand geht es so:

APK bauen (PowerShell). `npm run apk` findet `gradlew.bat` aus manchen Shells nicht; so klappt es zuverlässig,
und die Web-Dateien werden direkt vor Gradle kopiert, bevor OneDrive sie sperrt:

```
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
npm run build
Remove-Item -Recurse -Force android\app\src\main\assets\public
npx cap sync android
cd android; .\gradlew.bat assembleDebug --console=plain
```

Aufs Handy: APK unter einem neuen Namen (z. B. `Bubble-Log-HHMM.apk`) per Explorer/MTP in den Ordner
**Download** des Z Fold6 kopieren; das Überschreiben einer gleichnamigen Datei schlägt per MTP manchmal still fehl.
Nach dem Anstecken muss am Handy „Dateien übertragen“ gewählt und der Zugriff erlaubt werden.

Die APK liegt danach unter `%LOCALAPPDATA%\bubble-log-build\app\outputs\apk\debug\app-debug.apk` (Debug-Build,
etwa 4,8 MB). Die Build-Ausgaben liegen absichtlich außerhalb von OneDrive (eingestellt in `android/build.gradle`),
weil OneDrive sonst während des Builds Dateien sperrt.
Aufs Handy kopieren und dort öffnen; Android fragt einmal, ob Installationen aus dieser Quelle erlaubt sind.
Alternativ `android` in Android Studio öffnen und mit **Run** direkt aufs Handy spielen (USB-Debugging an).

## Im Browser entwickeln und simulieren

Arbeitsweise: Änderungen zuerst im Browser bauen und testen (`npm run dev`, Port 5173; in Claude Code über
`.claude/launch.json` „bubble-log“ im Browser-Fenster), mehrere sammeln, APK erst am Ende einer Runde.
Hintergrund-GPS, Benachrichtigungen, Sensor-Plugin und Teilen/Speichern gehen nur in der APK.

- **SIM-Knopf** (unten links, `src/sim.js`, nur `npm run dev`, nie in der APK): ersetzt das GPS, fährt eine
  gespeicherte Route zu einem gemerkten Ziel mit 50 km/h im zehnfachen Tempo ab, „Nach Hause beamen“.
- **Sim-Tab** (`src/fahrsim.js`, auch in der APK, aber nur mit Entwicklermodus): Mini-Fahrsimulator auf der
  OpenStreetMap-Karte, Mini-Microlino von oben, Karte dreht mit (umschaltbar), Gas/Bremse/Lenken/Turbo/Rückwärts
  per Touch oder W/A/S/D, Leertaste, T. Physik aus der Probefahrt im „Microlino Button-Planer“ (Radstand 1,47 m,
  50/90 km/h), Lenkung auf 3,5 m/s² Querbeschleunigung begrenzt. Positionen gehen jede Sekunde in die echte
  Fahrterkennung (`tracker.setSim`, `tracker.einspeisen`); „3 min stehen“ beendet die Fahrt im Zeitraffer.
  **Sandkasten:** Im Sim-Tab arbeitet die App auf einer Kopie, speichert nichts, Benachrichtigungen werden zu
  Hinweisen, Sensoren sind aus; beim Verlassen des Tabs sind die echten Daten unverändert.
- **3D-Ansicht im Sim-Tab** (`src/sim3d/`, Knopf „🧊 3D-Ansicht“, three.js wird erst dann nachgeladen):
  Microlino als 3D-Modell aus dem Button-Planer (`microlino.js`) in einer **endlichen Sim-Welt** rund um Bexbach
  (`welt.js`): 7 × 7 Vektor-Kacheln (Zoom 14, OpenMapTiles-Schema von OpenFreeMap), zusammen rund 11 × 11 km und
  2,1 MB, liegen in `public/simwelt/` und kommen mit in die APK; **die 3D-Sim braucht kein Netz.** Neu erzeugen
  (z. B. für einen anderen Ausschnitt oder neueren Stand): `npm run simwelt` bzw. `node tools/simwelt.mjs [Radius in
  Kacheln]`, Mitte steht oben im Skript. Daraus: **Boden** (Wohn-/Gewerbegebiet, Wiese, Feld, Wald, Park,
  Wasser), **Straßen** als Asphaltbänder je Klasse (Breiten in `STRASSE`) mit Mittellinie ab Kreisstraße,
  **Häuser** in ihrer Höhe (`render_height`), **Bäume** zufällig, aber stabil in Wald und Parks, nie auf
  Fahrbahnen. Hindernisse (`fahrsim.setHindernis`): Häuser, Baumstämme und der rot-weiße **Weltrand**.
  Startet die Sim außerhalb der Welt, geht es zurück zur Mitte; steht der Microlino abseits jeder Fahrbahn
  (Hof, Fußgängerzone), setzt er sich auf die nächste Straße. Die 2D-Karte im Sim-Tab bleibt die OSM-Karte (online).
  Kameras Verfolger/Cockpit/Vogel (aufs Bild tippen oder C); die Verfolgerkamera rückt vor Wänden näher.
  **Cockpit** (`microlino.js`, `baueCockpit`): Armaturenbrett wie im Button-Planer, Tacho-Display in der oberen
  Lenkrad-Öffnung (km/h, Fahrstufe R/N/D, Turbo, Akkubalken aus dem Sandkasten) und Mitteldisplay (Uhrzeit der
  Simulation, laufende Fahrt in km) als Canvas-Texturen; Lenkrad mit drei Speichen dreht mit (Übersetzung grob
  1:6), Drehknopf D/N/R und Turbo-Taste in der Konsole links folgen dem Zustand. **Radhäuser:** die Karosserie
  ist um die Radachsen ausgeschnitten (kleiner Shader-Zusatz `radhaeuser`), dunkle Radkästen decken innen ab;
  Felgen mit fünf Schlitzen, damit man das Drehen sieht.
  **Gemerkte Ziele der Ampel-Liste** (`ziele.js`) stehen als Leuchtsäulen in Ampelfarbe mit Name, Luftlinie
  und Ampeltext; weiter als 260 m entfernte Ziele in ihrer Richtung am Rand.
  **Licht** (`licht.js`, Knopf 🕒/☀️/🌙): „Echtzeit“ rechnet die Sonnenhöhe am Ort zur gespielten Uhrzeit
  (`fahrsim.uhr`), Dämmerung zwischen −6° und +6°; nachts dunkler Himmel und Boden, Lichtband und Rückleuchten
  hell, Scheinwerfer als heller Fleck vor dem Auto.
  Verworfen: Overpass als Häuserquelle (502/hängt), OSM-Kartenbilder als Boden (online, Nutzungsrichtlinie),
  unbegrenzte Online-Welt.
- **Joystick** im Sim-Tab (Standard, umschaltbar auf Tasten): stufenlos, vorn Gas bis zur passenden
  Höchstgeschwindigkeit, zurück bremsen und im Stand rückwärts, seitlich lenken (`fahrsim.setJoystick`).

## Offen (Stand 28.10.2026)

- **Als `Bubble-Log-1415.apk` gebaut (28.10.2026, 6,8 MB), Installation auf dem Fold6 und Live-Test stehen aus.** Enthalten: Ladepunkt im Tab „Laden“,
  Fahrterkennung setzt nach 3 GPS-Sprüngen neu auf, Sim-Tab mit Mini-Microlino, 3D-Ansicht
  mit Sim-Welt, Joystick, Log-Teilen repariert (`file_paths.xml` gibt `devlog/` frei; bis 1903 kamen
  geteilte Logs nie an).
  Außerdem (28.10.2026): Verbrauchsschnitt nur aus Fahrten ab 1 km und bis 5 %/km (`MAX_VERBRAUCH`), Rückfrage beim
  Speichern, wenn der Akkuwert stark von der Schätzung abweicht, automatisch erkannte Fahrten unter 0,3 km (`MIN_KM`)
  werden ohne Rückfrage verworfen.
  Entwicklermodus schreibt Messfenster: alle 5 s eine Zeile `vibration` (`rau`/`waag` = Effektivwert senkrecht/waagrecht
  in m/s², `waagMax` = stärkster geglätteter Ausschlag in g, `stoss`, `modus`, `ruhig` = unter `RUHE_VIBRATION`), auch im
  Stand; die Sensoren laufen dann auch beim Warten (etwas mehr Akku). Entscheidet noch nichts, nur zum Abstimmen.
- 3D-Sim: Leistung auf dem Fold6 prüfen (erst mit APK). Ideen: Straßenlaternen, echte
  Verkehrsampeln (bräuchten Overpass oder eine eigene Liste).
- **Replay und Tests der Fahrterkennung** (`SPEC-replay.md`): Meilenstein 1 fertig (Kern `erkennung.js`, `replay.js`,
  `npm test`, erste Datei `tests/fahrten/sim-2026-10-28-stadt.jsonl`). Echte Logs unverändert als
  `tests/fahrten/NAME.jsonl` ablegen (nur lokal), mit `npm run replay -- DATEI` ansehen und daraus
  `NAME.erwartet.json` machen (`{ "fahrten": [{ "start": "HH:MM:SS", "ende": "…", "toleranz_s": 60, "km": 3.2 }] }`,
  Leerfahrt `[]`; `"geoeffnet": "HH:MM:SS"`, wenn die App danach geöffnet wurde, ohne dass es im Log steht). Befunde 1 und 3 am 28.10.2026 behoben (Punkt nach Neuaufsetzen zählt nicht in die km; GPS-Lücke ≥ 3 min fast ohne Ortswechsel beendet die Fahrt vor der Lücke, Log `stopp nach Lücke`). Befund 2 (Ampel endet nach ≈ 175 s) bleibt todo, bis echte Logs da sind. Weiter mit Meilenstein 2 (Replay im Sim-Tab).
- **GPS-Abbruch (29.10.2026, `SPEC-gps-abbruch.md`):** Logs vom 27.–29.10. per adb geholt
  (`tests/fahrten/handy-*.jsonl`). Am 29.10. hat Android den GPS-Dienst mitten in der Fahrt beendet, die Fahrt blieb offen;
  am 28.10. fehlt die Heimfahrt. Stufe 0 erledigt (Akku „Nicht eingeschränkt“). **Stufe 1 und 2 gebaut (29.10.2026),
  im Browser geprüft, in `Bubble-Log-1418.apk` (Live-Test steht aus):** Wächter beim Start/Sichtbarwerden (`pruefeAusfall` in `erkennung.js`,
  Tests in `tests/erkennung.test.js`, Replay-Fall `handy-2026-10-29` mit `"geoeffnet"`), GPS neu anfordern
  (`tracker.neuStarten`), Lebenszeichen und Benachrichtigung nativ in `Fahrsensoren.java`, Anzeige „Akku und Standort“ in
  den Einstellungen, Log von GPS-Dienst und Energiesparmodus, Vibrationsfenster pro GPS-Punkt.
  **Nur am Handy prüfbar:** ob der Broadcast des GPS-Plugins ankommt (Lebenszeichen), die Benachrichtigung nach 90 s,
  `status()` (Akku/Standort), die Energiespar-/Doze-Zeilen. Stufe 3 (Heimfahrt ohne laufendes GPS) erst nach neuen Logs.
- Logs aus dem Entwicklermodus von echten Fahrten auswerten und Schwellen abstimmen (Erkennung, Höhenmeter,
  Rauheit, Bremsen), sobald der Nutzer sie schickt.
- **Akkustand per Foto vom Tacho-Display** (`SPEC-foto.md`, gebaut 28.10.2026, im Browser durchgespielt):
  Knopf „📷 Display fotografieren“ im Akku-Dialog bei Start und Ende. Kamera über `<input type="file" capture>`
  (Capacitor startet damit die Kamera-App, keine Kamera-Berechtigung, nur `<queries>` im Manifest; deshalb kein
  `@capacitor/camera`). Erkennung offline mit ML Kit (`Texterkennung.java`), Prozentzahl in `fototext.js`; das
  Drehrad springt auf den Wert, übernommen wird erst mit dem Knopf. Foto 640 px/JPEG 0,6 in `Directory.Data/fotos`,
  an der Fahrt `fotoStart`/`fotoEnde`, Vorschaubild in der Fahrtenliste (antippen = groß), wird beim Verwerfen und bei
  „Alle Daten löschen“ mitgelöscht. Einstellung „Fotos beim Export mitgeben“ (Standard aus). Entwicklermodus:
  `foto`-Zeilen (`erkannt` mit Text, Zahl, km, Dauer; `bestätigt` mit `richtig`). Gesamt-km wird nur geloggt.
  Im Browser: Dateiauswahl, Zahl aus dem Dateinamen (`akku-48.jpg`, `akku-48-km-007973.jpg`).
  **Nur am Handy prüfbar:** Start der Kamera-App aus dem WebView, Treffer von ML Kit am echten Display (beide
  Ansichten), Dauer der Erkennung, Teilen/Speichern mit Fotos. Die APK enthält nur noch `arm64-v8a` (ML Kit ≈ 11 MB
  je Architektur; für den Emulator `x86_64` in `android/app/build.gradle` ergänzen).
- **Idee (28.10.2026): Stillstand/Fahrt per Beschleunigungssensor** statt nur GPS. Der Microlino vibriert im Stand
  kaum, fahrend rauscht die Straße (misst Fahrsensoren schon für die Rauheit). Damit: Fahrtende früher bestätigen,
  Tiefgarage sicher als Parken erkennen; Alternative Android Activity Recognition (bisher verschoben). Erst an echten
  Logs prüfen, wie klar sich Stand und Fahrt trennen. Reine Trägheitsnavigation verworfen (Drift nach Sekunden;
  Tunnel-Überbrückung mit Kreisel + GPS-Tempo + Karte ginge, lohnt hier kaum).
- **Erledigt 29.10.2026 anders als geplant:** Haptik kommt jetzt über `navigator.vibrate` im neuen Scrollrad
  (`src/scrollrad.js`), ohne `@capacitor/haptics`. Am Fold6 prüfen, ob es spürbar ist; sonst doch das Plugin.
- ~~**Idee (28.10.2026): Haptik-Feedback fürs Drehrad.**~~ Bei jedem Wechsel auf eine neue Zahl ein kurzes Tick,
  am Rand (0/100) etwas kräftiger. Weg: `@capacitor/haptics` (`selectionChanged()`), ≈ 5 Zeilen in `wheelInit`
  (`src/main.js`), dann `npx cap sync`. Nur am Handy spürbar; prüfen, ob One UI es auch bei ausgeschalteter
  „Vibration bei Berührung“ spielt. Aufwand etwa eine halbe Stunde.
- **Idee (29.10.2026): Fahrzeugdaten über Microlino Open Telemetry (MOT).** Akkustand, Kilometerstand und Laden
  direkt vom CAN-Bus per MQTT statt Drehrad/Foto/GPS. Spec: `SPEC-mot.md` (noch offen: Adapter, Weg zum Handy).
- 12-V-Batteriewächter (BM6/BM2) anbinden, sobald er da ist.
- Später: Frankreich-Ladepunkte, Display-Firmware
  für den Knopf.

## Beim ersten Start auf dem Handy

1. Einstellungen (Zahnrad) → **Fahrterkennung** einschalten.
2. Benachrichtigungen erlauben.
3. Standort erlauben, am besten **„Immer zulassen“**. Mit „Nur während der Nutzung“ läuft die
   Erkennung trotzdem weiter, solange die Dauer-Benachrichtigung zu sehen ist.
4. Falls Android den Akku spart: in den App-Infos von Bubble Log den Akku auf **„Nicht eingeschränkt“** stellen.
   Sonst beendet Android die Erkennung nach einiger Zeit.

Nach einem Neustart des Handys die App einmal öffnen, damit die Erkennung wieder läuft.
Den Zustand von Akku und Standort zeigt Einstellungen → „Akku und Standort“; die Knöpfe öffnen die App-Infos.
Beendet Android das GPS während einer Fahrt, kommt nach etwa 1,5 Minuten die Benachrichtigung „Fahrtaufzeichnung
unterbrochen“. Tippen öffnet die App und fordert das GPS neu an; liegt der letzte Punkt mehr als 3 Minuten zurück, endet
die Fahrt dort und die App fragt den Akkustand ab.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/main.js` | Oberfläche, Fahrtablauf, Benachrichtigungen |
| `src/erkennung.js` | Kern der Fahrterkennung ohne GPS: Kandidat, Start, Stopp, Sprünge (Schwellwerte `SCHWELLEN` oben in der Datei) |
| `src/tracker.js` | hängt die Erkennung ans GPS (Hintergrund-Plugin, Browser, Sim-Tab) |
| `src/replay.js` | spielt ein Entwickler-Log (JSONL) durch die Erkennung, Ergebnis und damals Geloggtes zum Vergleich |
| `tests/` | `npm test` (node --test): synthetische Fälle (`erkennung.test.js`) und Fahrten aus `tests/fahrten/` |
| `tools/replay.mjs` | Log abspielen und anzeigen: `npm run replay -- DATEI.jsonl [STOPP_DAUER=120000 …]`, mit Vorlage für die Erwartung |
| `src/store.js` | Speichern und Laden; übernimmt einmalig eigene Einträge aus dem Browser-Prototyp |
| `src/sensoren.js` | Anbindung an das Plugin Fahrsensoren, Höhenmeter, Straßenrauheit |
| `src/wetter.js` | Temperatur von Open-Meteo |
| `src/export.js` | Fahrtenbuch als CSV-Datei teilen oder unter Dokumente/Bubble Log speichern, auf Wunsch mit Display-Fotos |
| `src/foto.js` | Foto vom Tacho-Display: Kamera, verkleinert speichern (`Directory.Data/fotos`), Erkennung aufrufen |
| `src/fototext.js` | aus dem erkannten Text Akkustand („99 %“) und Gesamt-km heraussuchen, Plausibilität (Tests: `tests/fototext.test.js`) |
| `android/…/Texterkennung.java` | eigenes Plugin: Google ML Kit Text Recognition (Latin, bundled, offline); löscht das Kamera-Original |
| `src/devlog.js` | Entwicklermodus: Logs schreiben, teilen, löschen, nach 14 Tagen aufräumen |
| `src/route.js` | Ziel-Check: Ortssuche, Straßenroute, Höhenmeter entlang der Route |
| `src/laden.js`, `src/ladepunkte.json` | Ladepunkte offline: Umkreis, entlang der Route, Ladezeit |
| `tools/ladepunkte.mjs` | erzeugt `ladepunkte.json` aus dem Ladesäulenregister |
| `src/fahrsim.js` | Sim-Tab: Fahrphysik (auch Joystick), 2D-Karte, Mini-Microlino |
| `src/simtab.js` | Sim-Tab: Oberfläche, Anzeige, Joystick/Tasten, Umschalten auf 3D |
| `src/sim3d/` | 3D-Ansicht: `index.js` (Bild, Kameras), `microlino.js`, `welt.js` (Sim-Welt, Kollision), `licht.js`, `ziele.js`, `geo.js` |
| `tools/simwelt.mjs`, `public/simwelt/` | erzeugt die Sim-Welt (Vektor-Kacheln um Bexbach) |
| `src/sim.js` | SIM-Knopf, nur im Browser beim Entwickeln |
| `capacitor.config.json` | App-ID `app.bubblelog.microlino`, `useLegacyBridge` gegen GPS-Abbrüche nach 5 min im Hintergrund |

Versionen: Capacitor 8.5, `@capacitor-community/background-geolocation` 1.3.1 (offiziell bis
Capacitor 7 angegeben; ob es mit 8 sauber baut, zeigt der erste Build), Vite 8.
