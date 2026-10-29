# Spec: GPS-Abbruch erkennen und Fahrten nicht verlieren

Stand 29.10.2026. **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.
Stufe 1 und 2 umgesetzt am 29.10.2026 (in Bubble-Log-1418.apk), Stufe 3 offen. Grundlage: Entwickler-Logs vom Fold6 (27.–29.10.2026, `tests/fahrten/handy-*.jsonl`, nur lokal)
und `adb shell dumpsys location / usagestats / activity exit-info` vom 29.10.2026, 13:50.

## Was passiert ist
- **29.10., Fahrt bleibt offen:** Start per Hand um 09:26:30 (Akku 99 %). Ab 09:29 steht der Microlino am Ziel, um 09:31:59
  beendet Android den Vordergrund-Dienst des GPS-Plugins (`FOREGROUND_SERVICE_STOP`). Die App läuft weiter, im Log steht aber
  nichts mehr. Ohne GPS-Punkte kommt die Erkennung nie zum Stopp (3 min Stillstand), die Fahrt bleibt im Modus `fahrt`.
  In derselben Sekunde öffnet sich in der Aufgabe von Bubble Log die Systemseite „Alarme und Erinnerungen“. Um 09:34 geht der
  Energiesparmodus an („GPS aus bei Bildschirm aus“). Absturz gab es keinen.
- **28.10., Heimfahrt fehlt vermutlich:** Fahrt 2 endet 12:58 am Ziel, um 14:27 ist das Handy zu Hause. Dazwischen nur ein
  GPS-Punkt (13:34). Im Modus `warten` kam also nichts an, die Heimfahrt wurde nicht erkannt.
- **Hintergrund:** Bubble Log steht nicht auf der Ausnahmeliste der Akku-Optimierung, Standort ist nur „während der Nutzung“
  erteilt. Das Plugin `@capacitor-community/background-geolocation` hält den Standort per Vordergrund-Dienst; den beendet
  One UI offenbar trotzdem.
- **Nebenbefund:** Die Vibrations-Messfenster kommen im Hintergrund nicht mehr ins Log, weil `sensoren.js` sie per
  `setInterval` (15 s) abholt und Android JavaScript-Timer im Hintergrund drosselt (29.10.: letzte Zeile 41 s nach
  Bildschirm aus, Fahrt lief weiter).

- **29.10., Testfahrt abends (16:22–17:00) fehlt ganz:** Auf dem Fold6 lief noch die APK vom 28.10. 17:14, die 1418 lag nur
  unter Downloads. Start vergessen; nach 16:22:42 (App im Hintergrund, Modus `warten`) kein GPS-Punkt und kein Sensor bis
  16:59. Zu Hause um 17:00 wollte der Nutzer den Akku am Ende eintragen; die App stand auf `warten`, die Eingabe (74 %)
  startete also eine Fahrt per Hand, die in derselben Sekunde als „stopp nach Lücke“ endete: der erste Punkt der Fahrt wurde
  mit dem alten Punkt von 16:22 verglichen (38 min, 8 m). **Behoben am 29.10.2026** in `erkennung.js` (Punkt aus dem Warten
  ist kein Bezug, Log `alter Punkt verworfen`), Tests in `tests/erkennung.test.js`, Log `tests/fahrten/handy-2026-10-29-testfahrt.jsonl`.
- **[fest, 29.10.2026] Fahrt nachtragen**, so bauen wie im Mockup https://claude.ai/artifact/SQzdUhe7JTw7SNr793dEvx
  (drei Screens, alle Vorschläge dort vom Nutzer bestätigt). Etwa 1–2 Stunden plus Tests, eine APK.
  - Akku-Eingabe im Modus `warten` bietet drei Wege: **Fahrt nachtragen**, „Fahrt jetzt starten“, „Nur Akkustand merken“.
    War die App länger als 10 min nicht sichtbar und gab es in der Zeit Bewegung (Vibrations-Fenster `ruhig: false` oder
    GPS-Punkte mit Tempo), steht „Nachtragen“ oben mit Hinweis auf die Lücke („Seit 16:22 war die App zu …“).
  - Formular: Zeitraum vorgeschlagen von „App zuletzt sichtbar“ bis jetzt, änderbar; Start-Akku = letzter bekannter Stand,
    Ende = eben eingegeben, Verbrauch daneben; Strecke über gemerktes Ziel (Route aus dem Cache) mit Schalter „hin und
    zurück“ (verdoppelt) oder km von Hand; Zweck wie bei normalen Fahrten.
  - Im Fahrtenbuch: Siegel „nachgetragen“, keine Spur, keine Höhenmeter; zählt bei km und Akku-Verbrauch, nicht bei Tempo,
    Bremsen, Rauheit. Antippen öffnet sie zum Ändern oder Löschen. Meldung „Fahrt nachgetragen · Rückgängig“.
  - Die drei offenen Fragen des Mockups entschieden (Vorgaben, der Nutzer hat alles durchgewunken): **eine** Fahrt je Lücke;
    zusätzlich Knopf **„+ Fahrt nachtragen“** im Fahrtenbuch (ohne Lücken-Vorschlag, Felder leer bzw. letzter Akku);
    Verbrauch nachgetragener Fahrten **fließt in die Reichweite** ein (echte Akkuwerte), km als geschätzt markiert.
  - Log: `fahrt` mit `schritt: 'nachgetragen'` und Quelle der Strecke (`ziel` / `hand`).

## Ziel
- [fest] Eine Fahrt darf nicht stillschweigend offen bleiben oder verloren gehen, wenn das GPS ausfällt.
- [Vorschlag] Ursache sichtbar machen (Log + Hinweis in der App), statt nur die Folgen zu reparieren.

## Stufe 0: Einstellungen am Handy (ohne Code, 2 Minuten)
- [Vorschlag] Zuerst: App-Infos → Akku → **„Nicht eingeschränkt“**, Standort → **„Immer zulassen“**; Bubble Log nicht in
  „Schlafende Apps“. Steht so schon in `ANLEITUNG.md` („Beim ersten Start“). Dann zwei, drei Fahrten mit Entwicklermodus.
- [fest] Erledigt 29.10.2026 ≈ 14:10: Akku „Nicht eingeschränkt“ (per adb geprüft: auf der Ausnahmeliste), Standort
  „Während der Nutzung“. „Immer zulassen“ bietet Android nicht an, weil die App `ACCESS_BACKGROUND_LOCATION` nicht anfordert;
  für den Vordergrund-Dienst reicht „Während der Nutzung“. [Vorschlag] Erst nachrüsten, wenn Stufe 3 (Geofence) kommt.
- [fest] Ob am 29.10. um 09:32 am Handy etwas bedient wurde, weiß der Nutzer nicht mehr. Ursache bleibt offen; deshalb
  Stufe 2 (Log von Dienst und Energiesparmodus), damit der nächste Ausfall sich selbst erklärt.

## Stufe 1: Fahrt nachträglich richtig beenden (etwa 1–2 Stunden)
- [Vorschlag] **Wächter beim Öffnen der App:** Kommt die App in den Vordergrund (`sichtbar: true` oder Start) und ist eine
  Fahrt offen, deren letzter GPS-Punkt älter als `STOPP_DAUER` (3 min) ist, endet die Fahrt am letzten bewegten Punkt
  (wie „stopp nach Lücke“ in `erkennung.js`). Dann die gewohnte Meldung „Fahrt beendet – Akkustand eintragen“.
  Log: `erkennung` mit `schritt: 'stopp nach GPS-Ausfall'` und der Länge der Lücke.
- [Vorschlag] **GPS neu anfordern:** Beim selben Anlass `beobachte()` neu aufrufen, auch wenn sich der Modus nicht ändert;
  heute tut `setModus` dann nichts, ein beendeter Dienst bleibt also aus.
- [Vorschlag] Der Wächter nimmt den Zeitpunkt des letzten Punkts, nicht `Date.now()`. Eine Fahrt, die wirklich noch läuft
  (Ampel, Stau), hat frische Punkte und bleibt unberührt.
- [Vorschlag] Tests in `tests/erkennung.test.js`: offene Fahrt + 10 min ohne Punkte → Ende am letzten bewegten Punkt;
  offene Fahrt mit frischen Punkten → bleibt offen. Dazu `handy-2026-10-29.jsonl` als echter Replay-Fall mit
  `erwartet.json` (eine Fahrt, Ende ≈ 09:29, km nach Replay).

## Stufe 2: Ausfall bemerken, während er passiert (etwa ein halber Tag, braucht APK)
- [Vorschlag] **Lebenszeichen nativ:** Ein kleines Java-Stück im Plugin `Fahrsensoren` (läuft schon nativ) prüft jede Minute,
  ob das GPS-Plugin noch Punkte liefert, und schreibt sonst `gps-ausfall` ins Log; JavaScript-Timer taugen dafür nicht
  (gedrosselt). Bei Ausfall während `fahrt`: Benachrichtigung „Fahrtaufzeichnung unterbrochen – tippen zum Fortsetzen“.
- [Vorschlag] **Zustand der Berechtigungen anzeigen:** In den Einstellungen eine Zeile „Akku: eingeschränkt / nicht
  eingeschränkt“ und „Standort: immer / nur bei Nutzung“, mit Knopf zur passenden Systemseite
  (`PowerManager.isIgnoringBatteryOptimizations`, ohne neue Berechtigung). Bei „eingeschränkt“ ein Hinweis im Tab „Heute“.
- [Vorschlag] **Log ergänzen:** Energiesparmodus an/aus (`PowerManager.isPowerSaveMode`) und Start/Stopp des Dienstes
  als `modus`-/`fehler`-Zeilen, damit der nächste Ausfall im Log selbst erklärt ist.
- [Vorschlag] **Vibrations-Fenster:** statt `setInterval` bei jedem GPS-Punkt abholen (GPS weckt JavaScript ohnehin).
  Etwa 15 Minuten, kann auch allein in die nächste APK.

## Stufe 3: Heimfahrt ohne laufendes GPS erkennen (später, eigene Spec)
- [Vorschlag] Erst nach Stufe 0–2 und neuen Logs entscheiden. Falls `warten` trotz „Nicht eingeschränkt“ ausfällt:
  **Geofence** um den Parkplatz (Play-Dienste, kaum Akku; meldet „Parkplatz verlassen“ und startet dann GPS) oder
  **Activity Recognition** („im Fahrzeug“, bisher verschoben). Beide brauchen „Standort immer“ bzw. eine neue Berechtigung.
- [fest] Die Heimfahrt am 28.10. gegen 13 Uhr gab es wirklich; sie wurde nicht erkannt. Stufe 3 bleibt also nötig, falls
  `warten` auch nach Stufe 0 ausfällt.

## Einfacherer Weg
- Nur Stufe 0 + Stufe 1 (Wächter beim Öffnen): kostet 1–2 Stunden, die Fahrt geht nicht mehr verloren, sobald du die App
  einmal öffnest. Was fehlt: Du merkst einen Ausfall erst beim nächsten Öffnen, Strecke nach dem Ausfall fehlt.

## Offen
- [fest] Die Fahrt vom 29.10. stand in der App noch auf „laufend“ (Befund 1 bestätigt).
- [fest] Entschieden 29.10.2026: Stufe 1 und 2 zusammen umsetzen (in einer frischen Sitzung), am Ende eine APK.
  Stufe 3 erst nach neuen Logs.
