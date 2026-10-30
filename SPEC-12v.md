# Spec: 12-V-Bordspannung mit dem BM6 aufzeichnen

Stand 30.10.2026. **[fest]** entschieden · **[Vorschlag]** Default, gilt, wenn niemand widerspricht · **[offen]** Frage an den Nutzer.
Umgesetzt am 30.10.2026 (Markus: „so umsetzen“): Meilenstein 1 vollständig, Meilenstein 2 gebaut, mit Gerät noch ungetestet. Hintergrund: `../microlino-12v-problem.md` (Startproblem, Gewährleistung bis Juni 2027).

## Worum es geht
Der Microlino springt immer wieder nicht an. Bubble Log soll die Spannung der 12-V-Batterie mitschreiben, damit sich
gegenüber Werkstatt und Hersteller belegen lässt, ob die Spannung vor einem Ausfall absackt oder beim Fahren nicht sauber
geladen wird (Verdacht: DC/DC-Wandler, Kontakte am Drehschalter). Messgerät: BM6-Batteriewächter (bestellt), an die
12-V-Batterie geklemmt, funkt per Bluetooth LE.

## Was es schon gibt
- Bubble Log hat **keine** Bluetooth- oder OBD-Anbindung. Native Plugins nach dem Muster `Fahrsensoren.java`
  (puffern im Hintergrund, JavaScript holt ab) sind erprobt.
- `SPEC-mot.md`: MOT-Adapter (CAN-Bus) ist noch nicht bestellt; dort steht die 12-V-Frage als [offen]. Diese Spec beantwortet sie:
  BM6 direkt an Bubble Log, ohne MOT.
- **12 V über OBD?** Technisch ja: Ein ELM327-Dongle liest mit `AT RV` die Spannung an Pin 16 der OBD-Buchse, ganz ohne
  Fahrzeugprotokoll. Nachteil: Der Dongle hängt dauerhaft an der 12-V-Batterie und kann sie selbst leersaugen, genau das
  Problem, das wir belegen wollen. Ob Pin 16 beim Microlino Dauerplus hat, ist ungeprüft. [Vorschlag] Nicht verfolgen, BM6 genügt.

## BM6-Protokoll (Recherche 30.10.2026)
- Gerät meldet sich als `BM6`, Dienst `FFF0`, Befehle schreiben auf `FFF3`, Antworten als Notification auf `FFF4`.
- Alles ist AES-128-CBC verschlüsselt, IV = 16 Nullbytes, keine Auffüllung. Schlüssel (öffentlich, aus der Hersteller-App):
  ASCII `leagend`, dann `FF FE`, dann ASCII `0100009` (16 Bytes: `6c 65 61 67 65 6e 64 ff fe 30 31 30 30 30 30 39`).
  Mit Node geprüft: Der Befehl unten verschlüsselt sich damit genau zum angegebenen Wert.
- Befehl „Messwerte senden“: Klartext `d1550700000000000000000000000000`, verschlüsselt `697ea0b5d54cf024e794772355554114`.
- Antwort, entschlüsselt als Hex-Text (Zeichenpositionen): beginnt mit `d15507`; Zeichen 6–7 = `01` heißt Temperatur negativ;
  8–9 Temperatur °C (hex); 12–13 Ladezustand % (hex); 15–17 Spannung in 1/100 V (hex), z. B. `4ab` = 11,95 V.
- Nur **eine** Verbindung gleichzeitig: Ist die Hersteller-App (BM6/„Battery Monitor“) verbunden, kommt Bubble Log nicht dran.
- Der BM6 speichert selbst einen Verlauf (Hersteller-App zeigt 1/3/5 Tage). Wie man ihn per Bluetooth abholt, ist nirgends
  dokumentiert. Deshalb nicht Teil dieser Spec.
- Quellen: tarball.ca „Reverse Engineering the BM6 BLE Battery Monitor“, github.com/jeffwdh/bm6-battery-monitor,
  github.com/bsrotten/BM6 (Home Assistant), haxrob.net (BM2, gleiches Verfahren).

## Wann gemessen wird
Bluetooth reicht etwa 10 m. Bubble Log misst also nur, wenn das Handy beim Auto ist.
- [Vorschlag] **Beim Fahren:** Ab Fahrtbeginn verbindet sich Bubble Log mit dem BM6 und schreibt mit, bis die Fahrt endet.
  Gespeichert wird je Minute kleinster, mittlerer und größter Wert; im Entwicklermodus jeder Einzelwert.
- [Vorschlag] **Rund um die Fahrt:** erster Wert nach dem Verbinden (Fahrtbeginn) und ein Ruhewert etwa 2 Minuten nach Fahrtende,
  falls das Handy dann noch in Reichweite ist (Garage, Parkplatz).
- [Vorschlag] **Knopf „Springt nicht an“:** Ein Tipp hält sofort Zeit, Ort, Temperatur und die aktuelle Spannung fest, dazu
  optional ein Foto vom Display. Nach dem Trennen/Verbinden am Drehschalter noch ein Wert. Das ist der wichtigste Beleg.
- [Vorschlag] **Beim Parken** misst der BM6 selbst; diesen Verlauf zeigt vorerst die Hersteller-App (Bildschirmfoto als Beleg).

## Bewertung und Warnung
Schwellen aus der Hintergrundnotiz, zum Start so übernommen, Anpassung nur nach Zustimmung:
- [Vorschlag] Auto aus (Ruhewert): ab 12,6 V **ok**, 12,4–12,6 V **beobachten**, unter 12,4 V **verdächtig**.
- [Vorschlag] Beim Fahren: Mittelwert 13,4–14,4 V und Schwankung (größter − kleinster Minutenwert) höchstens 0,5 V **ok**;
  Mittelwert unter 13,2 V oder Schwankung über 0,5 V **verdächtig**; dazwischen **beobachten**.
- [Vorschlag] Warnung als Benachrichtigung bei einem verdächtigen Ruhewert („12-V-Batterie 12,3 V, bitte im Blick behalten“)
  und am Fahrtende, wenn die Fahrt verdächtig war. Nicht während der Fahrt.

## Anzeige
- [Vorschlag] Im Fahrtenbuch bei jeder Fahrt ein kleiner 12-V-Punkt (grün/gelb/rot), beim Antippen die Werte und eine Kurve.
- [Vorschlag] In den Einstellungen: „12-V-Wächter (BM6)“ mit Schalter, Knopf „Suchen und koppeln“, letzter Wert mit Uhrzeit.

## Beleg für die Werkstatt
- [Vorschlag] Eigener Export `bordspannung-JJJJ-MM-TT.csv`: eine Zeile je Messung (Datum, Uhrzeit, Spannung, Temperatur,
  Anlass: Fahrt/Ruhe/Startproblem, Bewertung). Dazu eine kurze Zusammenfassung oben: Anzahl Fahrten, wie viele verdächtig,
  alle Startprobleme mit der Spannung davor.
- [Vorschlag] Im Fahrtenbuch-CSV zusätzlich die Spalten „12 V Start“, „12 V Fahrt Ø“, „12 V Ruhe“.

## Technik
- [Vorschlag] Natives Plugin `Batteriewaechter.java` (Suchen, Verbinden, Befehl, Entschlüsseln mit `AES/CBC/NoPadding`,
  Puffer wie bei `Fahrsensoren`). Keine neue npm-Abhängigkeit. Rechte: `BLUETOOTH_SCAN` (ohne Standortnutzung) und
  `BLUETOOTH_CONNECT`. Während der Fahrt hält der vorhandene Vordergrunddienst der Standortaufzeichnung die App wach.
- [Vorschlag] `src/bordspannung.js`: Entschlüsseln/Auslesen (auch in Node prüfbar), Minutenwerte, Bewertung, Export.
  Tests `tests/bordspannung.test.js` mit den bekannten Testvektoren oben.
- [Vorschlag] **Ohne Gerät:** Simulierter BM6 im Sim-Tab (Ruhe 12,7 V, Fahren 13,7 V; Schalter für „schwacher DC/DC“
  mit 13,0 V und Schwankung, „Batterie sackt ab“ mit 12,2 V), damit Bewertung, Warnung, Anzeige und Export im Browser
  durchgespielt werden können, bevor der BM6 da ist.

## Meilensteine
1. Ohne Gerät: `bordspannung.js` mit Tests, Simulation, Bewertung, Anzeige, Export, Knopf „Springt nicht an“.
2. Mit Gerät: natives Plugin, Koppeln in den Einstellungen, eine Testfahrt mit Entwicklermodus, Werte mit der Hersteller-App vergleichen.

## Fragen an Markus
- [fest] Plan so umsetzen (30.10.2026).
- [fest] Knopf „Springt nicht an?“ steht unter „Heute“ (Startbildschirm).
