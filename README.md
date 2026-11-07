# Bubble Log

Der zweitbeste Bordcomputer der Welt – für den Microlino, mit einem Menschen als OBD.

Der Microlino der ersten Generation hat keinen Bordcomputer. Bubble Log ersetzt ihn auf dem Handy:
Du liest den Akkustand am Display ab (Foto oder Drehrad), die App zeichnet die Fahrt per GPS auf und lernt
daraus deinen Verbrauch.

- **Fahrtenbuch:** Start, Ziel, Kilometer und Akkustand je Fahrt, Fahrtende automatisch nach 3 Minuten Stillstand.
- **Ziel-Check „Komm ich hin?“:** Route, Höhenmeter, eigener Verbrauch und Kälte ergeben, ob hin und zurück reicht.
- **Laden:** Ladepunkte im Umkreis (Ladesäulenregister der Bundesnetzagentur, CC BY 4.0), Ladevorgänge protokollieren.
- **12-V-Bordspannung:** mit einem BM6-Batteriewächter, inklusive Beleg für die Werkstatt.
- **Tempolimit-Schild:** zeigt während der Fahrt das Limit der Straße groß an, offline aus OpenStreetMap
  (© OpenStreetMap-Mitwirkende, ODbL; bisher Saarland und Rheinland-Pfalz).
  **Nur zur Orientierung: Es gelten immer die Schilder an der Straße.** Die Daten können veraltet oder falsch sein,
  Baustellen, Wechselschilder und zeitliche Limits fehlen. Korrekturen gehören in OpenStreetMap.

Fahrten bleiben auf dem Handy, es gibt kein Konto und keinen Server.

**Die ganze Geschichte in knapp drei Minuten:** [Bubble Log Gesamtstory](https://markussstaub-dot.github.io/bubble-log/)
(gezeichnet und animiert, im Browser; Quelle: [`docs/index.html`](docs/index.html)).

## Stand

Privates Experiment, entstanden im Oktober 2026 zusammen mit Claude (KI). Android-App mit Capacitor, getestet auf
einem Galaxy Z Fold6.

## Ausprobieren

Die neueste APK liegt unter [Releases](https://github.com/markussstaub-dot/bubble-log/releases) (Vorabversion,
Android 7 oder neuer). Auf dem Handy die `.apk` herunterladen und öffnen; Android fragt einmal, ob der Browser bzw.
„Eigene Dateien“ Apps installieren darf. Das erlauben, installieren, fertig. Updates installiert man genauso drüber,
die Fahrten bleiben erhalten.

Bauen und Technik: [ANLEITUNG.md](ANLEITUNG.md), Arbeitsweise: [ENTWICKLUNG.md](ENTWICKLUNG.md),
Änderungen: [CHANGELOG.md](CHANGELOG.md).

## Selbst weiterbauen

Ich baue Bubble Log für meinen eigenen Microlino. Wer etwas anderes braucht, nimmt den Code und baut seine eigene
Version: forken, ändern, veröffentlichen, alles erlaubt. Naheliegende Ideen: echte Fahrzeugdaten (CAN-Bus, z. B.
[Microlino Open Telemetry](https://www.microlino-open-telemetry.ch)), iPhone, weitere Sprachen.

Zuschauen ist ausdrücklich erwünscht: Jede Änderung steht im [CHANGELOG](CHANGELOG.md) und in der Git-Historie.
Ich schaue gelegentlich in Issues und Pull Requests, aber ohne Support, ohne Wunschliste und ohne Zusage.
Nutzung auf eigenes Risiko; die App ersetzt keinen Blick auf die Akkuanzeige des Fahrzeugs.

## Ökobilanz (grob)

Überschlag, kein Messwert (Stand November 2026): Die Entwicklung hat etwa **20–110 kWh** gekostet, so viel wie
**250 bis 1.400 km Microlino** (bei ≈ 8 kWh/100 km). Den größten und unsichersten Teil machen die KI-Sessions aus
(geschätzt 10–100 kWh, Anthropic veröffentlicht keinen Verbrauch pro Anfrage), dazu ≈ 10 kWh Laptop. Im Betrieb
kostet die App fast nichts: GPS am Handy ≈ 1 Wh pro Fahrt, kein Server.

## Lizenz

Der Code steht unter der [MIT-Lizenz](LICENSE). Die Ladesäulendaten behalten ihre eigenen Lizenzen
(Bundesnetzagentur: CC BY 4.0, BFE/ich-tanke-strom.ch: Open Data mit Quellenangabe) und sind beim Weitergeben
mit Quelle zu nennen.
Microlino ist eine Marke der Microlino AG; Bubble Log ist ein unabhängiges Projekt.
