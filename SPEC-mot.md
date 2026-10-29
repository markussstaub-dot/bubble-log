# Spec: Fahrzeugdaten über Microlino Open Telemetry (MOT)

Stand 29.10.2026. **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.
Noch nicht umgesetzt. Grundlage: Website https://www.microlino-open-telemetry.ch und das Repo
https://github.com/MM1834/microlino-open-telemetry (MIT-Lizenz), vor allem `docs/api/mqtt-topics.md` und
`docs/firmware/pioneer-standard-can.md`.

## Worum es geht
Ein MOT-Adapter liest passiv die CAN-Busse des Microlino und schickt Messwerte per MQTT. Bubble Log könnte damit
Akkustand, Kilometerstand und Laden **vom Fahrzeug** übernehmen statt sie per Drehrad, Foto oder GPS zu schätzen.

## Was MOT liefert (laut Doku, Stand 28.10.2026)
Alle Werte unter `mot/<vehicleId>/<suffix>`. Für Bubble Log relevant:

| Bubble Log braucht | MOT-Wert | Quelle | Status beim Pioneer |
|---|---|---|---|
| Akkustand Start/Ende | `bms/soc_display` | Standard-CAN `0x48D` | bestätigt: folgt exakt der Tacho-Anzeige |
| Akkustand (Hauptquelle laut MOT) | `display/soc` | Display-CAN | im Produkt die maßgebliche Quelle |
| Kilometerstand | `display/odometer_km` | Display-CAN | Name bestätigt, Inhalt zur Laufzeit ungeprüft |
| Fährt gerade | `display/speed_kmh`, `bms/is_discharging` | Display-/Standard-CAN | Entladung bestätigt |
| Stecker steckt / lädt | `charging/plugged`, `bms/status_byte` (`0x20`), `charging/is_charging` | beide | Steckerzustand bestätigt |
| Leistung, Energie | `bms/vehicle_power_w` (+ Verbrauch, − Laden/Rekuperation), `bms/pack_voltage`, `bms/pack_current` | Standard-CAN | bestätigt, Ladeleistung auf ±10 W genau geprüft |
| Ort (optional) | `location/latitude`, `location/longitude` | GPS am Adapter | nur mit GPS-Modul |
| Frische | `status/online`, `system/last_seen_utc` | Adapter | nur über AWS-Weg sicher vorhanden |

Hinweise aus der Doku, die Bubble Log beachten muss:
- Die meisten Werte sind **retained**: Ein Wert beim Verbinden kann alt sein. Frische nur über Empfangszeit und `last_seen` beurteilen.
- Ja/Nein kommt je nach Weg als `1`/`0` (lokales MQTT) oder `true`/`false` (AWS).
- `bms/soc_internal` liegt 6–8 Punkte unter der Anzeige und ist **nicht** der Akkustand.
- Die Namen der Werte sind im Code bestätigt, die Inhalte zur Laufzeit noch nicht durchgehend.

## Entscheidungen des Nutzers
- [fest] Grundsatz von Bubble Log bleibt: Daten bleiben beim Nutzer, keine fremde Cloud als Pflicht.
- [fest] Drehrad und Foto bleiben als Rückfallebene, für Fahrten ohne Adapter oder ohne Verbindung.

## Gemeinsame Logik für Mensch und Fahrzeug („Human OBD“)
Idee des Nutzers (29.10.2026): Den Weg ohne Adapter jetzt rund machen, so dass später dieselbe Logik greift, egal ob ein
Wert vom Menschen oder vom Fahrzeug kommt.
- [fest] Bubble Log behandelt Akkustand und Kilometer als **Messwert mit Herkunft**, nicht als nackte Zahl.
  Verbrauch, Reichweite, Plausibilitätsprüfung und Ladeerfassung lesen nur Wert und Herkunft; wo er herkommt, ist ihnen egal.
- [Vorschlag] Herkunft je Akkuwert (Start, Ende, später Laden vorher/nachher), gespeichert neben dem Wert:
  - `vorschlag`: der vorgeschlagene Wert (letzter Stand oder Schätzung) wurde unverändert bestätigt,
  - `drehrad`: am Drehrad eingestellt,
  - `foto`: per Foto erkannt und bestätigt,
  - später `fahrzeug`: vom CAN-Bus (MOT-Adapter oder Knopf).
- [fest] Erster Nutzen schon ohne Adapter: Fahrten, deren **Endwert** nur `vorschlag` ist, zählen nicht in den
  Verbrauchsschnitt. Der Vorschlag am Ende ist die Schätzung Start − km × Schnitt, eine solche Fahrt bestätigt also nur den
  eigenen Schnitt (gilt auch bei echtem Startwert). Ein unveränderter Startwert ist dagegen der letzte bekannte Stand und zählt.
  Wer das Drehrad anfasst, gilt als „abgelesen“, auch wenn der Wert gleich bleibt.
  *Umsetzung 29.10.2026:* `src/herkunft.js`, Felder `startQuelle`/`endeQuelle` an der Fahrt, Tests `tests/herkunft.test.js`.
- [Vorschlag] Alte Fahrten ohne Herkunft gelten als `drehrad` (bisheriges Verhalten bleibt).
- [Vorschlag] Der Entwicklerlog schreibt die Herkunft mit; die Auswertung kann dann Foto, Drehrad und später Fahrzeug
  gegeneinander vergleichen.
- [Vorschlag] Kommt später ein Fahrzeugwert dazu, ändert sich nur, **wer** den Wert liefert (`fahrzeug` statt `drehrad`),
  nicht die Rechnung dahinter.

## Hardware
- [offen] Welcher Adapter? Übersicht laut Website:
  - **MOT Lite** (fertige WiCAN-Hardware, ESP32-C3): „erhältlich“, aber **nur Standard-CAN**. Damit gäbe es beim Pioneer
    `bms/soc_display`, Leistung und Stecker, aber vermutlich **keinen Kilometerstand und keine Geschwindigkeit** (die kommen vom Display-CAN).
    Die Lite-Firmware liegt **nicht** im Repo.
  - **MOT Platform** (ESP32-C6 Dual-CAN, ESP32-WROOM oder LilyGO, optional GPS/LTE): beide Busse, aber kontrollierte Beta mit Claim-Code.
- [offen] Wo und wie wird der Adapter im Microlino angeschlossen, und was bedeutet das für Garantie und Versicherung?
  Vor dem Kauf beim Projekt nachfragen (support@microlino-open-telemetry.ch).
- [Vorschlag] Erst Antworten einholen, dann bestellen. Ohne Adapter wird nur der Simulationsteil gebaut (siehe Schritt 0).

## Weg der Daten zum Handy
- [Vorschlag] **Eigener MQTT-Server (Mosquitto) auf der Synology**, mit Benutzer, Passwort und TLS; Bubble Log verbindet sich
  per MQTT über WebSocket (`mqtt.js`, läuft im WebView). Begründung: keine fremde Cloud, MOT unterstützt „sicheres lokales MQTT“
  ausdrücklich.
- [Vorschlag] In Stufen, einfachste zuerst:
  1. **Zu Hause:** Adapter und Handy im Heim-WLAN. Bubble Log liest den Akkustand beim Losfahren und erfasst Laden in der
     Garage automatisch. Kein Zugang aus dem Internet nötig. Deckt die meisten Fahrtstarts und fast alle Ladevorgänge ab.
  2. **Unterwegs:** Adapter hängt am Hotspot des Fold6, der MQTT-Server muss dann aus dem Internet erreichbar sein
     (DynDNS + TLS + Portfreigabe auf der Synology). [offen] Will Markus die Synology dafür öffnen?
- [offen] Alternative ohne eigenen Server: MOT Cloud (AWS) und deren API. Bequemer, aber Fahrdaten liegen dann beim Projekt
  in der Cloud, und ob Endnutzer eine API bekommen, ist unklar.

## Was Bubble Log damit macht
- [Vorschlag] **Akku-Dialog:** Liegt ein frischer MOT-Wert vor (jünger als 2 Minuten), steht das Drehrad schon darauf und
  dreht sichtbar hin (`wheelSetze`). Darunter: „Vom Fahrzeug (MOT), vor 12 s“. Bestätigt wird wie bisher.
  Begründung: Anfangs vergleichen wir MOT mit der Tacho-Anzeige; erst wenn das über einige Fahrten stimmt, kann der Wert
  ohne Rückfrage übernommen werden. [offen] Ab wann automatisch?
- [Vorschlag] **Kilometer:** Gibt es `display/odometer_km` am Start und Ende, zählt deren Differenz; GPS-Kilometer werden
  daneben im Entwicklerlog festgehalten (Abgleich wie bei der Fahrterkennung).
- [Vorschlag] **Laden:** Steckt der Stecker (`plugged`) und fließt Leistung, legt Bubble Log einen Ladevorgang an:
  Beginn, Ende, Akkustand vorher/nachher, Energie aus der Leistung aufsummiert. Der Ladepunkt kommt wie heute aus dem Standort.
- [Vorschlag] **Fahrterkennung:** MOT-Werte (Geschwindigkeit, Entladung) ergänzen die GPS-Erkennung in `erkennung.js`
  als zusätzliches Signal, ersetzen sie aber nicht. Hilft vor allem in Tiefgaragen.
- [offen] **12-V-Batterie:** MOT kann einen BM2/BM6 einbinden (Pilot). Der Plan in `ANLEITUNG.md` war, den BM6 direkt
  anzubinden. Welcher Weg?

## Technik
- [Vorschlag] Neues Modul `src/mot.js`: Verbindung, Abo auf `mot/<vehicleId>/#`, Umwandlung der Werte (Zahlen, `1`/`0`
  und `true`/`false`), Zeitstempel je Wert. Reine Umwandlung ohne Netz, damit sie Tests bekommt (`tests/mot.test.js`).
- [Vorschlag] Einstellungen: Server-Adresse, Benutzer, Passwort, Fahrzeug-ID, Präfix (Standard `mot`), Schalter „MOT verwenden“.
  Zugangsdaten nur lokal in `@capacitor/preferences`.
- [Vorschlag] Entwicklermodus loggt `mot`-Ereignisse (Verbindung, Werte, Abweichung zur Eingabe), damit die Auswertung
  wie bei Foto und Fahrterkennung funktioniert.
- [Vorschlag] **Schritt 0 ohne Hardware:** Im Sim-Tab ein simulierter MOT-Strom (Akku sinkt beim Fahren, Laden erhöht ihn),
  damit alles im Browser getestet werden kann, bevor ein Adapter da ist. Optional ein kleiner Mosquitto auf der Synology
  mit einem Test-Skript, das MOT-Werte sendet.

## Aufwand (grob)
- Schritt 0 (Simulation, Modul, Einstellungen, Akku-Dialog): eine konzentrierte Runde.
- Stufe 1 (zu Hause, echte Hardware): Mosquitto auf der Synology einrichten, Adapter einbauen, eine Testfahrt.
- Stufe 2 (unterwegs): Synology von außen erreichbar machen; das ist eher eine Sicherheits- als eine Programmierfrage.

## Fragen an das MOT-Projekt (Mail)
1. Ist MOT Lite für einen Pioneer erhältlich, was kostet er, und liefert er Kilometerstand und Geschwindigkeit?
2. Wo wird der Adapter angeschlossen, und ist das rückbaubar?
3. Liegt die Firmware von MOT Lite irgendwo offen?
4. Ist der Weg „lokales MQTT ohne MOT Cloud“ für Endnutzer vorgesehen und dokumentiert?
