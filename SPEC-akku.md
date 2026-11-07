# SPEC: Weniger Akkuverbrauch im Wartemodus (04.11.2026)

## Befund (Akkustatistik vom Fold6, 42 h seit der letzten Ladung)
- Bubble Log hat **467 mAh** verbraucht (Platz 2 nach dem System). Der Vordergrund-Dienst lief **≈ 27 h**.
- Davon entfallen **368 mAh auf Wakelocks**: `NetworkLocationScanner` hat sich **9.054-mal** gemeldet und das Gerät
  **9 h 26 min** wachgehalten, also im Schnitt alle ≈ 11 s ein WLAN- oder Funkzellen-Scan. GPS (GNSS) lief nur 1 h 15 min (86 mAh).
- Ursache: Das Plugin `@capacitor-community/background-geolocation` (1.3.1) setzt in
  `BackgroundGeolocationService.java` **fest** `setInterval(1000)`, `setMaxWaitTime(1000)` und `PRIORITY_HIGH_ACCURACY`.
  `distanceFilter: 30` im Wartemodus filtert nur die **Auslieferung** an die App, die Ortung selbst läuft weiter
  mit voller Rate. Wartemodus und Fahrtmodus kosten also bei der Ortung fast gleich viel.
- Kein Bug in `tracker.js`: Der Wartemodus muss laufen, sonst gibt es keine automatische Fahrterkennung.

## Ziel
Im Wartemodus deutlich weniger Wakeups (Richtwert: Bubble Log < 100 mAh pro Tag ohne Fahrt), Fahrterkennung so
zuverlässig wie heute.

## Fest
- Fahrtmodus bleibt unverändert (1 s, hohe Genauigkeit).
- Die Erkennungslogik in `erkennung.js` (Schwellen, Kandidat → Start → Stopp) bleibt, wie sie ist.
- Der Trick „erst neuen Watcher anlegen, dann alten entfernen“ (Dienst bleibt im Vordergrund) bleibt erhalten.

## Vorschlag
1. **Plugin patchen** (`patch-package`, Patch im Repo): `addWatcher` bekommt optional `interval` (ms); daraus
   `setInterval`, `setFastestInterval`, `setMaxWaitTime`. Ohne Angabe bleibt es bei 1000 (rückwärtskompatibel).
2. **Wartemodus in zwei Stufen** (`tracker.js`):
   - *Ruhe*: `interval` 30 s, `distanceFilter` 30. Hohe Genauigkeit bleibt, weil `MAX_UNGENAU` (40 m) sonst fast alle
     Punkte verwirft.
   - *Wach*: Sobald `erkennung` einen **Kandidaten** meldet (Tempo ≥ 3 m/s), sofort auf `interval` 1 s umschalten,
     damit Start nach 20 s / 150 m wie heute erkannt wird. Wird der Kandidat verworfen, zurück auf *Ruhe*.
   - Der Kandidat braucht eine Rückmeldung an den Tracker (z. B. `onKandidat(an)` aus `createErkennung`).
3. **Folge:** Der Fahrtbeginn wird bis zu ≈ 30 s später bemerkt. Die ersten paar hundert Meter fehlen dann eventuell
   in der Spur; Strecke und Start bleiben über den Kandidatenpunkt aber nahe dran. Bei Bedarf lässt sich das
   Ruhe-Intervall auf 15 s senken.
4. **Trennung Entwicklermodus / Normalbetrieb** (Idee Markus, 04.11.2026): Sparmodus ist **Standard im
   Normalbetrieb**. Im Entwicklermodus gibt es einen Schalter „Warten: volle GPS-Rate“ (heutiges Verhalten, 1 s),
   ähnlich wie der vorhandene Schalter für Sensoren beim Warten (`sensoren.auchBeimWarten()`). So bleiben dichte
   Logs zum Debuggen möglich, ohne dass der Alltag Akku kostet. Das Ruhe-Intervall (15/30/60 s) lässt sich im
   Entwicklermodus einstellen, um die offene Frage unten per Testfahrt zu klären.
5. **Messen:** Vorher/Nachher per `adb shell dumpsys batterystats` (Wakelock `NetworkLocationScanner` für
   `app.bubblelog.microlino`) nach je einem Tag ohne Fahrt.

## Umgesetzt (04.11.2026)
- `patches/@capacitor-community+background-geolocation+1.3.1.patch`, `gpsWahl()` und `onKandidat` in `erkennung.js`,
  Takt im `tracker.js`, Entwickler-Einstellungen in `main.js` (`eigen.gpsVoll`, `eigen.ruheTakt`), Replay mit
  `ruheTakt`, Tests in `tests/akku.test.js`.
- Befund aus dem Replay: Bei Stop-and-go direkt nach dem Losfahren trifft das 30-s-Raster mehrmals einen langsamen
  Moment (29.10.: Start 90 s später, 0,8 km fehlen am Anfang). Möglicher Ausweg, offen: schon ab `GEH_TEMPO` (2 m/s)
  wecken, ohne die Kandidaten-Schwelle zu ändern.

## Offen
- Ruhe-Intervall 30 s oder 15 s? (Vorschlag: mit 30 s starten, Testfahrt entscheidet)
- Später, nur bei Bedarf: Activity Recognition („im Fahrzeug“) als Weckruf statt Dauer-Ortung, oder Ortung pausieren,
  solange das Handy zu Hause im WLAN hängt. Beides ist größerer Umbau.

## Tests
- Unit-Test: Kandidat meldet `wach`, Verwerfen meldet `ruhe`; Replay der Logs vom 31.10./01.11. mit ausgedünnten
  Wartepunkten (alle 30 s) erkennt alle Fahrten.
- Auf dem Fold (APK nötig, Java-Patch): eine Testfahrt + ein Ruhetag, danach Batteriestatistik.

## Nebenbefund (nicht Bubble Log)
- „Link zu Windows“ (`com.microsoft.appmanager`): 433 mAh, Dienst ≈ 43 h aktiv. Markus kann die App in den
  Akku-Einstellungen auf „Optimiert“ stellen.

---

# Teil 2: Handy-Akku unterwegs, Normal- und Entwicklermodus (Entwurf 07.11.2026)

Anlass: Seit dem Tempolimit-Schild bleibt das Display während der Fahrt an (`SPEC-usability.md`). Damit ist das
Display der größte Verbraucher, nicht mehr das GPS. Außerdem zeigte der Display-Befund vom 07.11., dass man ohne
Entwicklermodus bei Fehlern nichts sieht und mit Entwicklermodus ein anderes Verhalten misst als im Alltag.

Markierung wie in `SPEC-usability.md`: **[fest]** = Markus, **[entschieden]** = Claude mit freier Hand
(Leitprinzip Grundfaulheit: die App regelt das selbst, nichts muss eingestellt werden), **[offen]**.

## Befunde
1. Im Entwicklermodus **ändert sich das Verhalten**: Die Sensoren laufen auch beim Warten (`sensoren.auchBeimWarten`
   = Entwicklermodus), dazu die Schalter „Warten: volle GPS-Rate“ und „Ortung in Ruhe alle 15/30/60 s“. Testlogs
   messen dadurch nicht den Alltag, und der Handy-Akku leidet gerade in der Testphase.
2. Ohne Entwicklermodus schreibt die App **gar kein Log**. Fehler wie „Display ging aus“ lassen sich dann nicht klären.
3. Wie viel Handy-Akku Bubble Log kostet, wissen wir nur aus der Android-Akkustatistik, nicht pro Fahrt.

## Use Cases
| Use Case | Heute | Ziel |
|---|---|---|
| UC-A Fahrt mit Display an, Handy ohne Kabel | ❓ Verbrauch unbekannt | Verbrauch pro Fahrt im Log, nachts dunkler |
| UC-B Fahrt mit Ladekabel in der Halterung | ✅ egal | egal, nichts drosseln |
| UC-C Handy-Akku wird knapp (< 20 %) | ❌ nichts | Halterung dimmt stärker, sonst alles gleich |
| UC-D Fehler im Alltag (ohne Entwicklermodus) | ❌ kein Log | kleines Ereignis-Log immer an |
| UC-E Testphase mit dichten Logs | ⚠️ ändert das Verhalten | nur mehr protokollieren |
| UC-F Messung mit voller GPS-Rate | ⚠️ bleibt an, bis man es merkt | schaltet sich nach 24 h selbst ab |

## User Stories

### US-A Verbrauch messen statt raten (UC-A, UC-B)
- **[entschieden]** Die App liest den Handy-Akku nativ (`BatteryManager` in `Fahrsensoren.java`: Prozent, lädt ja/nein,
  Temperatur) bei Fahrtbeginn, Fahrtende und stündlich. Log-Zeile `handyakku`.
- **[entschieden]** An der gespeicherten Fahrt stehen `handyStart`, `handyEnde`, `laedt`; in der Fahrtenliste nichts
  Neues (nur für die Auswertung).
- Akzeptanz: Nach einer Fahrt ohne Kabel steht im Log, wie viele Prozent sie gekostet hat und wie lange das Display
  an war (aus den `display`-Zeilen).

### US-B Nachts dunkler, knapp dunkler (UC-A, UC-C)
- **[entschieden]** Die Halterungs-Ansicht setzt die Helligkeit des eigenen Fensters
  (`WindowManager.LayoutParams.screenBrightness`, keine Berechtigung nötig): tagsüber die Systemhelligkeit, in der
  Dämmerung und nachts gedimmt (Sonnenstand wie in `src/sim3d/licht.js`, Grenzen −6°/+6°).
- **[entschieden]** Handy-Akku unter 20 % und kein Kabel: stärker gedimmt. Kein Hinweis, keine Frage.
- **[entschieden]** Mit Ladekabel wird nie gedrosselt.
- Akzeptanz: nachts im Log `display` mit `hell`-Wert; keine Einstellung nötig.

### US-C Kleines Ereignis-Log immer an (UC-D)
- **[entschieden]** Auch ohne Entwicklermodus schreibt die App Ereignisse: `fahrt`, `erkennung` (Start/Stopp),
  `display`, `tempolimit`, `fehler`, `handyakku`, `app`, `modus`. **Keine** rohen GPS-Punkte, keine Sensorwerte.
  Erwartet: wenige KB am Tag. Gleiche Datei, gleiche 14 Tage Aufbewahrung, gleicher Weg zum Teilen.
- **[entschieden]** Privat wie bisher: bleibt auf dem Handy, geht nur raus, wenn Markus teilt (bzw. per adb).
- Akzeptanz: Ohne Entwicklermodus steht nach einer Fahrt die Folge Start → Tempolimit-Wechsel → Display → Ende im Log.

### US-D Entwicklermodus protokolliert nur mehr (UC-E)
- **[entschieden]** Entwicklermodus = zusätzlich `gps` (roh), `sensor`, `vibration`, DEV-Zeile, Sim-Tab. Er ändert
  **nicht** mehr, wie oft geortet wird oder ob die Sensoren beim Warten laufen.
- **[entschieden]** Die Sensoren beim Warten (Messfenster für die Stillstandserkennung) wandern in den Messmodus (US-E).

### US-E Messmodus schaltet sich selbst ab (UC-F)
- **[entschieden]** Ein Schalter „Messmodus (24 h)“ im Entwicklerbereich bündelt alles Teure: volle GPS-Rate beim
  Warten, Sensoren beim Warten. Nach 24 h ist er von selbst aus (Zeitpunkt gespeichert, Log `modus`
  `messmodus: 'abgelaufen'`). Die heutigen Einzelschalter (volle GPS-Rate, 15/30/60 s) entfallen; der Ruhetakt bleibt
  fest bei 30 s.
- Akzeptanz: Messmodus an, App 25 h später öffnen → aus, Ruhetakt 30 s, Log-Zeile vorhanden.

## Offen
- **[offen]** Wie hell ist „gedimmt“ in der Halterung noch lesbar? Klärt sich bei einer Nachtfahrt; Startwert 25 %.
- Sonst nichts für Markus.

## Bau (nach der Halterungs-Reihe aus `SPEC-usability.md`, damit nicht zwei Sessions in `main.js` arbeiten)
1. US-C + US-D: Ereignis-Log immer an, Entwicklermodus ohne Verhaltensänderung (≈ ½ Session, `devlog.js`, `sensoren.js`, `main.js`)
2. US-E: Messmodus mit Ablauf (≈ ½ Session)
3. US-A: Handy-Akku messen (≈ ½ Session, Java)
4. US-B: Helligkeit nach Sonnenstand und Akku (≈ ½ Session, Java, braucht die Halterungs-Ansicht)
