# Spec: Akkustand per Foto vom Tacho-Display

Stand 28.10.2026. **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.
**Umgesetzt am 28.10.2026** (Stand der Umsetzung in `ANLEITUNG.md` unter „Offen“); Abweichungen unten mit *Umsetzung:* markiert.

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
  *Umsetzung:* 1 Prozentpunkt über dem Start ist erlaubt (die Ansichten runden unterschiedlich). Mehrere verschiedene
  Prozentzahlen auf dem Foto gelten als „nicht erkannt“.
- [Vorschlag] Die Bestätigung aus der Benachrichtigung bei Fahrtende bleibt ohne Foto. Fotografieren geht nur in der geöffneten App.

## Technik
- [Vorschlag] Kamera über `@capacitor/camera` (offizielles Plugin, Kamera-App des Handys, keine Galerie-Berechtigung nötig).
  *Umsetzung:* einfacher über `<input type="file" accept="image/*" capture="environment">`: Capacitor startet damit selbst
  die Kamera-App (keine Kamera-Berechtigung, nur `<queries>` für IMAGE_CAPTURE im Manifest), kein weiteres Plugin.
  Das Originalfoto der Kamera-App löscht `Texterkennung.aufraeumen()` nach dem Verkleinern.
- [Vorschlag] Texterkennung mit **Google ML Kit Text Recognition (Latin, „bundled“)** als Erweiterung des eigenen
  Plugins neben `Fahrsensoren.java`. Das Modell steckt in der APK (plus etwa 4 MB), läuft offline und schickt nichts weg.
  *Umsetzung:* eigenes Plugin `Texterkennung.java`. ML Kit bringt je CPU-Architektur ≈ 11 MB mit; die APK enthält deshalb
  nur `arm64-v8a` (Fold6, Tab S10). Erkannt wird auf einer 1600-px-Kopie, gespeichert die 640-px-Fassung.
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
- [fest] **Fotos vom Display liegen vor** (28.10.2026, 19:16, abends, beide Ansichten, im Stand mit Ladekabel-Symbol):
  - *Ansicht „Rundinstrumente“*: links Tacho (Zahl + „km/h“, R/N/D), rechts Akku-Ring mit **„100%“** in einer Pille
    in der Mitte, darüber `trip km 0790,5` (Nachkommastelle rot), darunter `total km 007973` (6 Ziffern mit führenden
    Nullen, Ziffern in Kästchen). Uhrzeit unten links, Datum unten rechts.
  - *Ansicht „Straße“*: **„99 %“** oben links (mit Leerzeichen), große Tempozahl „00“ in der Mitte, Uhrzeit/Datum oben,
    `trip km` unten rechts klein, **`total km` nur als leere Kästchen**, also hier nicht lesbar.
  - Gleiche Minute, aber 100 % gegen 99 %: Die Ansichten runden offenbar unterschiedlich. Unterschiede von 1 Prozentpunkt
    sind normal; die Plausi-Rückfrage (ab 10 Punkten) bleibt davon unberührt.
  - Folgerung [Vorschlag]: Akkustand = einzige Zahl mit „%“ (mit oder ohne Leerzeichen), in beiden Ansichten eindeutig.
    Kilometerstand nur aus der Ansicht „Rundinstrumente“ (6-stellige Zahl unter „total km“); in der Ansicht „Straße“
    gibt es keinen. Ist ein Kilometerstand erkannt, prüfen: nicht kleiner als der letzte, Differenz passt grob zu den GPS-km.
  - Nachts gut lesbar (helles Display, wenig Spiegelung). [offen, nicht dringend] Ein Foto bei Tageslicht/Sonne,
    falls Spiegelungen Probleme machen; erst nötig, wenn die Erkennung am Tag versagt.
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
