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
