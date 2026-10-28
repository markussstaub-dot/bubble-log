# Entwicklung: von der Idee bis zur geprüften APK

Arbeitsweise für Bubble Log (seit 28.10.2026). Rollen: Markus entscheidet und testet auf dem Handy, Claude plant,
baut und prüft. Technik und Stolperfallen stehen in `ANLEITUNG.md`, Änderungen je APK in `CHANGELOG.md`.

## Ablauf

0. **Idee notieren**: in `ANLEITUNG.md` unter „Offen“ oder im passenden `SPEC-*.md`. Nichts bauen.
1. **Spec**: `SPEC-<thema>.md` mit **[fest]** / **[Vorschlag]** / **[offen]**. Claude schlägt Standardwerte vor, höchstens
   drei Fragen. Weiter erst, wenn kein [offen] die Umsetzung blockiert. Meilensteine, die je für sich lauffähig sind.
2. **Umsetzung**: je Meilenstein eine frische Session, das Specsheet ist der Auftrag. Echte Daten nicht anfassen,
   Schwellen nur nach Zustimmung ändern.
3. **Prüfen, bevor „fertig“ gesagt wird**:
   - `npm test` läuft durch; neue Logik bekommt Tests, Befunde laufen als `todo` mit.
   - `npm run build` ohne Fehler.
   - Im Browser (`.claude/launch.json` „bubble-log“) in Handygröße einmal durchgespielt, Konsole ohne Fehler.
   - Was nur auf dem Handy prüfbar ist (Hintergrund-GPS, Sensoren, Teilen), wird ausdrücklich so benannt.
4. **Runde abschließen**: `ANLEITUNG.md`/Spec nachziehen, Eintrag in `CHANGELOG.md` unter „Unveröffentlicht“,
   dann sichern: `git add -A` und `git commit -m "…"`.
5. **APK**: Handy anstecken und entsperren, dann `.\apk.ps1` (Tests → Build → Prüfen der APK → Kopie
   `Bubble-Log-HHMM.apk` in den Download-Ordner des Fold6). Die Versionsnummer (`2026.10.28-1415`) steht in der App
   unter Einstellungen ganz unten. „Unveröffentlicht“ im CHANGELOG bekommt diese Nummer.
6. **Testtag**: Checkliste aus dem Specsheet, Entwicklermodus an, danach Logs ans Zenbook teilen.
7. **Auswerten**: Logs einspielen, echte Fahrten werden Tests (`tests/fahrten/`), Befunde mit Zahlen, Schwellen erst
   nach Zustimmung ändern. Neue Ideen und Befunde zurück zu 0.

## git

- Lokal, ohne Upload. Das Repository liegt **außerhalb von OneDrive** in `%LOCALAPPDATA%\bubble-log-git`
  (im Projekt steht nur die Verweisdatei `.git`), weil OneDrive sonst Dateien darin sperrt oder doppelt.
- Nicht versioniert: `node_modules`, Build-Ausgaben und die **echten Fahrt-Logs** in `tests/fahrten/`
  (nur `sim-*` ist drin, siehe `.gitignore`).
- Jede APK aus einem gesicherten Stand bekommt den Tag `apk-<version>`. Zurück zu einem Stand:
  `git log --oneline`, `git diff <commit>`, einzelne Datei: `git restore --source <commit> <datei>`.
- Das Verzeichnis `%LOCALAPPDATA%\bubble-log-git` ist **nicht** in OneDrive gesichert. Für eine Sicherung bei Bedarf:
  `git bundle create Z:\sicherung\bubble-log.bundle --all` (Z: = NAS).

## Kosten im Blick (Pro-Tarif)

- Teuer sind Wortwechsel in langen Sessions, nicht Codezeilen. Vorher vorbereiten (Handy anstecken, Logs teilen),
  dann eine klare Ansage.
- Neue Meilensteine in frischen Sessions mit Specsheet statt in einer langen Session.
- `.\apk.ps1` selbst starten kostet nichts.
