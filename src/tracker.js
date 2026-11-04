// Fahrterkennung per GPS. Die Entscheidung (Kandidat, Start, Stopp) steckt in erkennung.js, hier hängt sie am GPS.
// Modus "warten": GPS sparsam (alle 30 m), erkennt den Fahrtbeginn am Tempo. Zwei Stufen (SPEC-akku.md): in Ruhe
//                 ortet das GPS nur alle 30 s (RUHE_TAKT), sonst hielt es das Handy jede Sekunde wach (Akkustatistik
//                 04.11.2026: 9 h Wakelocks in 27 h). Meldet die Erkennung einen Kandidaten, geht es sofort auf 1 s
//                 (wach), damit der Start so schnell erkannt wird wie früher; wird er verworfen, zurück in Ruhe.
// Modus "fahrt":  GPS jede Sekunde, zählt Strecke, erkennt das Ende am Stillstand.
// Auf Android läuft das als Vordergrund-Dienst mit Dauer-Benachrichtigung weiter, auch wenn die App im Hintergrund ist.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as sensoren from './sensoren.js';
import { createErkennung, distanz, fahrtEnde, gpsStand, gpsWahl, SCHWELLEN, RUHE_TAKT, RUHE_TAKTE, VOLL_TAKT } from './erkennung.js';

export { distanz, fahrtEnde, gpsStand, SCHWELLEN, RUHE_TAKT, RUHE_TAKTE, VOLL_TAKT };
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

// onLog(typ, daten) bekommt jede rohe Position und jeden Zustandswechsel (für den Entwicklermodus).
// ruheTakt(): ms zwischen den Ortungen beim Warten ohne Kandidat (main.js: Einstellung im Entwicklermodus).
export function createTracker({ onStart, onPunkt, onStopp, onFehler, onLog = () => {}, ruheTakt = () => RUHE_TAKT }) {
  let watcherId = null, webId = null;
  let wach = false;   // Warten mit Kandidat: GPS auf voller Rate
  const erkennung = createErkennung({ onStart, onPunkt, onStopp, onLog, onKandidat });
  const verarbeite = erkennung.verarbeite, modusJetzt = () => erkennung.modus;
  const wahl = () => gpsWahl(modusJetzt(), wach, ruheTakt());
  function onKandidat(an) {
    if (simQuelle || modusJetzt() !== 'warten' || an === wach) return;
    const vorher = wahl().takt; wach = an;
    const jetzt = wahl();
    onLog('modus', { gpsTakt: wach ? 'wach' : 'ruhe', takt: jetzt.takt });
    if (jetzt.takt !== vorher) beobachte();   // bei voller Rate auch in Ruhe (Entwicklermodus) bleibt der Watcher
  }

  let simQuelle = false;   // Fahrsimulator: Positionen kommen über einspeisen(), echtes GPS ist aus
  // Starten und Stoppen nacheinander, sonst legen zwei schnelle Aufrufe (Wächter + Moduswechsel) zwei Watcher an
  let kette = Promise.resolve();
  const nacheinander = f => (kette = kette.catch(() => {}).then(f));
  const beobachte = () => { const w = wahl(); return nacheinander(() => watcherStarten(w)); };
  const stoppeWatcher = () => nacheinander(watcherStoppen);
  let generation = 0;   // nur der neueste Watcher zählt; der alte kann bis zum Entfernen noch Punkte liefern
  async function watcherStarten({ abstand, takt }) {
    if (simQuelle) return watcherStoppen();
    if (Capacitor.isNativePlatform()) {
      // Erst den neuen Watcher anlegen, dann den alten entfernen (Testfahrt 31.10.2026): Entfernt man den letzten
      // Watcher, beendet das Plugin den Vordergrund-Dienst. Startet er aus dem Hintergrund neu, gibt Android ihm
      // ohne „Standort immer erlauben“ keine Positionen mehr („Foreground service started from background can not
      // have location access“). So bleibt der Dienst beim Moduswechsel durchgehend im Vordergrund.
      const alt = watcherId, gen = ++generation;
      try {
        watcherId = await BackgroundGeolocation.addWatcher({
          backgroundTitle: 'Bubble Log',
          backgroundMessage: modusJetzt() === 'fahrt' ? 'Fahrt wird aufgezeichnet' : 'Wartet auf die nächste Fahrt',
          requestPermissions: true, stale: false, distanceFilter: abstand, interval: takt,   // interval: patches/ (patch-package)
        }, (loc, err) => {
          if (gen !== generation) return;
          if (err) { onLog('fehler', { quelle: 'gps', code: err.code, text: err.message }); onFehler?.(err.code === 'NOT_AUTHORIZED' ? 'standort' : err.message); return; }
          verarbeite(loc); sensoren.beiGpsPunkt();
        });
      } catch (e) {   // neuer Watcher kam nicht zustande: der alte läuft weiter und zählt wieder
        generation--; onLog('fehler', { quelle: 'gps', text: `addWatcher: ${e.message}` }); return;
      }
      onLog('modus', { gpsDienst: 'start', modus: modusJetzt(), abstand, takt });
      if (alt) await watcherEntfernen(alt);
    } else if (navigator.geolocation) {   // Browser zum Ausprobieren: nur solange die Seite offen ist
      await watcherStoppen();
      webId = navigator.geolocation.watchPosition(
        pos => verarbeite({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, altitude: pos.coords.altitude, time: pos.timestamp }),
        e => onFehler?.(e.code === 1 ? 'standort' : e.message), { enableHighAccuracy: true });
    }
  }
  async function watcherEntfernen(id) {
    await BackgroundGeolocation.removeWatcher({ id }).catch(e => onLog('fehler', { quelle: 'gps', text: `removeWatcher: ${e.message}` }));
    onLog('modus', { gpsDienst: 'stopp', modus: modusJetzt() });
  }
  async function watcherStoppen() {
    generation++;
    if (watcherId) { const id = watcherId; watcherId = null; await watcherEntfernen(id); }
    if (webId != null) { navigator.geolocation.clearWatch(webId); webId = null; }
  }

  return {
    get modus() { return erkennung.modus; },
    async setModus(neu) {
      if (!erkennung.setModus(neu)) return;
      wach = false;
      sensoren.lebenszeichen(simQuelle ? 'aus' : neu);
      if (!simQuelle && (neu === 'fahrt' || (neu === 'warten' && sensoren.auchBeimWarten()))) sensoren.start(neu); else sensoren.stopp();   // Barometer und Beschleunigung nur bei echter Fahrt (Entwicklermodus: auch beim Warten)
      if (neu === 'aus') return stoppeWatcher();
      return beobachte();
    },
    get wach() { return wach; },
    // Wächter beim Start und Sichtbarwerden (SPEC-gps-abbruch.md); stand: gpsStand() der offenen Fahrt
    pruefeAusfall(jetztT, stand) { return !simQuelle && erkennung.pruefeAusfall(jetztT, stand); },
    // GPS neu anfordern, auch wenn der Modus gleich bleibt: ein von Android beendeter Dienst käme sonst nicht wieder
    neuStarten() {
      if (simQuelle || modusJetzt() === 'aus') return;
      onLog('modus', { gpsDienst: 'neu anfordern', modus: modusJetzt() });
      return beobachte();
    },
    oeffneEinstellungen() { if (Capacitor.isNativePlatform()) BackgroundGeolocation.openSettings(); },
    // Fahrsimulator an/aus: echtes GPS stoppen bzw. wieder starten; der Modus bleibt, die Erkennung beginnt frisch
    async setSim(an) {
      if (an === simQuelle) return;
      simQuelle = an; erkennung.zuruecksetzen(); wach = false;
      sensoren.lebenszeichen(an ? 'aus' : modusJetzt());
      if (an) { sensoren.stopp(); await stoppeWatcher(); }
      else if (modusJetzt() !== 'aus') { if (modusJetzt() === 'fahrt' || sensoren.auchBeimWarten()) sensoren.start(modusJetzt()); await beobachte(); }
    },
    einspeisen(loc) { if (simQuelle) verarbeite(loc); },
  };
}
