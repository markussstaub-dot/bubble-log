# Spec: Fahrt-Replay im Sim-Tab + Tests für die Fahrterkennung

Stand 28.10.2026. Markierungen: **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.

## Ziel
Echte Fahrten aus den Entwickler-Logs noch einmal durch die Fahrterkennung (`src/tracker.js`) schicken: sichtbar im
Sim-Tab und automatisch als Tests. Dann lässt sich jede Schwellen-Änderung gegen echte Fahrten prüfen, bevor sie in die APK kommt.

## Datengrundlage
- [fest] Quelle sind die `gps`-Zeilen aus `devlog.js` (JSONL): `t, modus, lat, lon, gen, tempo, hoehe, kurs, zeit`,
  auch verworfene Punkte (`verworfen: 'ungenau' | 'sprung'`). Daraus wird das `loc`-Objekt des Plugins wieder aufgebaut
  (`latitude, longitude, accuracy, speed, altitude, bearing, time`).
- [fest] Zum Vergleich dienen die Zeilen `erkennung` (kandidat/start/stopp/neu aufgesetzt) und `fahrt` (beginn/ende/gespeichert)
  aus demselben Log, also das, was das Handy damals entschieden hat.
- [Vorschlag] Vorher gibt es Sim-Logs: Im Browser eine Fahrt im Sim-Tab fahren, Log herunterladen und als erste Testdatei nehmen.
  Echte Logs kommen erst mit der nächsten APK (Log-Teilen repariert, siehe ANLEITUNG „Offen“).
- [Vorschlag] Auf dem Handy liest das Replay die Tagesdateien direkt aus dem eigenen Log-Speicher (`devlog.dateien()`),
  ohne Teilen. Im Browser lädt man eine Datei über die Dateiauswahl.

## Teil A: Tracker testbar machen
- [Vorschlag] `tracker.js` bekommt einen reinen Kern ohne Capacitor/GPS, z. B. `createErkennung({ onStart, onPunkt, onStopp, onLog })`
  mit `verarbeite(loc)` und `setModus()`. `createTracker` nutzt ihn unverändert weiter. Das Verhalten der App ändert sich nicht.
- [Vorschlag] Die Schwellen lassen sich je Aufruf überschreiben (`createErkennung({ ..., schwellen: { STOPP_DAUER: 120000 } })`),
  damit Tests und Replay andere Werte ausprobieren können, ohne die Datei zu ändern.
- [Vorschlag] `src/replay.js` liest eine JSONL-Datei, sucht die `gps`-Zeilen heraus und schickt sie zeitgetreu oder im
  Sofortlauf durch den Kern. Ergebnis: Liste der Ereignisse (Start/Stopp/Sprung-Neuaufsetzen) mit Zeit und Ort.

## Teil B: Automatische Tests
- [Vorschlag] Mit `node --test` (eingebaut, kein neues Paket), Skript `npm test`. Testdateien liegen in `tests/`.
- [Vorschlag] Fahrten liegen in `tests/fahrten/*.jsonl`, je mit einer kleinen Erwartungsdatei `*.erwartet.json`:
  `{ "fahrten": [{ "start": "12:37:10", "ende": "12:42:30", "toleranz_s": 60, "km": 3.2 }] }`.
- [Vorschlag] Die Erwartung entsteht so: Das Replay zeigt, was erkannt wurde, du sagst „stimmt“ oder „Start war eigentlich hier“,
  daraus wird die Erwartungsdatei. Leerfahrten (wie die 0-km-Fahrt vom 27.10.) erwarten `"fahrten": []`.
- [Vorschlag] Dazu synthetische Grundfälle: Stadtfahrt mit Ampelstopps unter 3 min, Parken über 3 min, einzelner GPS-Sprung,
  drei Sprünge in Folge, Schritttempo (Gehen) darf keine Fahrt starten, Tunnel/Funkloch.
- [fest] Echte Logs liegen unverändert in `tests/fahrten/` (nur lokal/OneDrive, kein Git, nichts geht raus), damit die Spur zu Karte und Sim-Welt passt.

## Teil C: Replay im Sim-Tab
- [fest] Läuft im Sandkasten des Sim-Tabs: speichert nichts und lässt echte Fahrten und Daten unverändert.
- [Vorschlag] Knopf „▶ Log abspielen“ im Sim-Tab → Tag/Datei wählen → erkannte Fahrten des Tages als Liste → eine antippen.
- [Vorschlag] 2D-Karte (OSM, online): ganze GPS-Spur als Linie, eingefärbt nach Tempo; verworfene Punkte grau (ungenau)
  bzw. rot (Sprung); Fähnchen für Kandidat, Start, Stopp, Neuaufsetzen. Daneben zum Vergleich, was das Handy damals erkannt hat.
- [Vorschlag] Abspielen mit Zeitraffer 1× / 10× / 60×, Pause und Schieberegler. Der Mini-Microlino fährt die Spur ab und zeigt
  Tempo, Genauigkeit und den Zustand der Erkennung (warten / Kandidat seit … s / Fahrt / Stillstand seit … s).
- [Vorschlag] 3D: Der Microlino folgt der Spur in der Sim-Welt (Kurs aus der Spur, keine Physik), aber nur, solange
  die Spur in der Sim-Welt (11 × 11 km um Bexbach) liegt. Außerhalb gibt es nur 2D mit Hinweis.
- [Vorschlag] Regler „Schwellen ausprobieren“ (Start-Tempo, Stopp-Dauer, Stopp-Radius, max. Ungenauigkeit): Die Erkennung
  wird sofort neu gerechnet, und die neuen Fähnchen erscheinen neben den alten. Übernommen wird nur durch eine Änderung im Code.
- [fest] Sensor-Zeilen (Höhenmeter, Rauheit, Bremsen) kommen erst in einer späteren Runde ins Replay.

## Nicht in diesem Umfang
Schwellen ändern (erst mit echten Logs und deiner Zustimmung) · APK bauen · Akku-/Verbrauchsauswertung · Ladevorgang.

## Meilensteine (je eine frische Session)
1. Teil A + B mit Sim-Log und synthetischen Fällen, `npm test` grün.
2. Teil C in 2D, dann 3D, im Browser in Handygröße getestet.
3. Sobald echte Logs da sind: einspielen, Erwartungen mit dir festlegen, Schwellen vorschlagen.
