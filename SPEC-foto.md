# Spec: Akkustand per Foto vom Tacho-Display

Stand 28.10.2026. **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.
Umsetzung erst nach der nächsten APK (die mit Replay-Tests und Log-Teilen).

## Entscheidungen des Nutzers
- [fest] Die Erkennung läuft **offline** auf dem Handy, ohne Netz und ohne Cloud-Dienst.
- [fest] Das Foto wird bei **Fahrtbeginn und Fahrtende** angeboten und ist **freiwillig**. Das Drehrad bleibt gleichwertige Alternative.
- [fest] Das Foto wird in **niedriger Auflösung behalten** und gehört zur Fahrt.

## Ablauf
- [Vorschlag] Im bestehenden Akku-Dialog (Start und Ende) gibt es neben dem Drehrad einen Knopf „📷 Display fotografieren“.
  Danach öffnet sich die Kamera, die Zahl wird erkannt, das Drehrad springt auf den erkannten Wert und du bestätigst wie bisher.
  Es wird nichts übernommen, ohne dass du bestätigst.
- [Vorschlag] Erkennt die App keinen oder einen unplausiblen Wert (nicht 0–100, beim Ende höher als beim Start ohne Laden),
  bleibt das Drehrad auf dem alten Wert und zeigt „nicht erkannt“. Das Foto wird trotzdem behalten.
- [Vorschlag] Die Bestätigung aus der Benachrichtigung bei Fahrtende bleibt ohne Foto. Fotografieren geht nur in der geöffneten App.

## Technik
- [Vorschlag] Kamera über `@capacitor/camera` (offizielles Plugin, Kamera-App des Handys, keine Galerie-Berechtigung nötig).
- [Vorschlag] Texterkennung mit **Google ML Kit Text Recognition (Latin, „bundled“)** als Erweiterung des eigenen
  Plugins neben `Fahrsensoren.java`. Das Modell steckt in der APK (plus etwa 4 MB), läuft offline und schickt nichts weg.
  Aus dem erkannten Text wird die Prozentzahl gesucht (Zahl mit „%“, sonst die passende Zahl in der Nähe des Akkusymbols).
  Verworfen: Tesseract.js in der WebView (langsam, Sprachdaten 10+ MB, bei Display-Schrift schwächer).
- [Vorschlag] Speichern als JPEG mit 640 px Kantenlänge und Qualität 0,6 (etwa 40–60 KB) in `Directory.Data/fotos/`.
  Die Fahrt merkt sich nur den Dateinamen (`fotoStart`, `fotoEnde`). Bei 2 Fotos pro Fahrt und 500 Fahrten sind das etwa 50 MB.
- [Vorschlag] Löscht man eine Fahrt, werden auch ihre Fotos gelöscht. In der Fahrtansicht erscheinen sie als kleine Vorschaubilder.
- [Vorschlag] Browser beim Entwickeln: Dateiauswahl statt Kamera. Die Erkennung ist dort ein Platzhalter (Zahl aus dem
  Dateinamen, z. B. `akku-48.jpg`), damit der Ablauf ohne APK testbar ist. Die echte Erkennung gibt es nur in der APK.
- [Vorschlag] Entwicklermodus loggt `foto`-Zeilen: erkannter Text, gewählte Zahl, Wert nach Bestätigung, Dauer der Erkennung.
  Damit lässt sich die Trefferquote an echten Fotos messen.

## Webrecherche (28.10.2026)
- Kleines Digitaldisplay hinter dem Lenkrad: Akkustand, Tempo, Rekuperation, laut Testberichten auch gefahrene Strecke,
  Uhrzeit, Datum und Fahrstufe. Akkustand als **Prozentzahl**; eine Restreichweite in km zeigt es laut einem Alltagstest nicht.
  Pioneer-Edition zusätzlich mit zentralem Touch-Display.
- Folgerung [Vorschlag]: Gesucht wird die Zahl direkt vor „%“. Tempo, km, Uhrzeit und Datum werden über ihr Format
  ausgeschlossen (km/h, Doppelpunkt, Punkt, Kommastelle).
- [fest] Laut Nutzer kann das Display zwischen zwei Ansichten umschalten, die auch Gesamt-km und Tageskilometer zeigen.
  Die Erkennung muss in beiden Ansichten die Prozentzahl finden; Fotos beider Ansichten nötig.
- Idee für später [offen]: Gesamt-km mitlesen (Fahrtenbuch mit echtem Kilometerstand, GPS-km gegenprüfen). Den
  Tageszähler eher nicht, weil er sich nur von Hand zurücksetzt.

## Offen
- [fest] Beim Laden zeigt das Display eine Lade-Animation statt einer lesbaren Zahl (Nutzer, 28.10.2026). Foto beim Laden
  bleibt deshalb draußen; Fotos nur bei Fahrtbeginn und -ende, Fotos vom Display folgen bei einer Fahrt.
- [offen] **Foto vom Display:** Bitte beim nächsten Mal im Auto das Tacho-Display mit Akkustand fotografieren, am besten
  einmal bei Tag und einmal bei Dunkelheit/Spiegelung. Davon hängt ab, wie die Zahl gesucht wird (mit „%“? Balken? mehrere Zahlen wie Reichweite/km?).
- [fest] Fotoexport ist **optional, als Schalter in den Einstellungen** (Standard: aus).
- [Vorschlag] Ist er an, bekommt die CSV die Spalten `Foto Start`/`Foto Ende` (Dateinamen), und beim Teilen bzw. Speichern
  unter Dokumente/Bubble Log werden die Fotos der exportierten Fahrten mitgegeben. Ist er aus, ändert sich der Export nicht.

## Verworfen: steuerlich prüffestes Fahrtenbuch
- [fest] Der Microlino wird nur privat genutzt (Nutzer, 28.10.2026), ein Fahrtenbuch nach R 8.1 Abs. 9 LStR
  (Tachostand lückenlos, unveränderbar, PDF) ist also nicht nötig. Fotos und Kilometerstand bleiben reiner Komfort.

## Idee für später: Fehlermeldungen des Microlino
- [offen] Zeigt das Display eine Fehlermeldung oder Warnleuchte: Foto aufnehmen, Text/Code offline erkennen (gleiche
  Erkennung), mit Zeit, Ort, Akkustand, Temperatur und letzter Fahrt in ein Meldungs-Logbuch speichern. Recherche
  (Bedeutung, was tun, Werkstatt nötig?) macht Claude, wenn der Nutzer das Foto oder den Eintrag teilt. Später evtl.
  eine eigene Liste bekannter Codes in der App.

## Nicht in diesem Umfang
Akkustand beim Laden per Foto (ginge später genauso) · automatische Erkennung ohne Bestätigung · Reichweite/km vom Display.
