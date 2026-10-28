// Fahrterkennung per GPS. Die Entscheidung (Kandidat, Start, Stopp) steckt in erkennung.js, hier hängt sie am GPS.
// Modus "warten": GPS sparsam (alle 30 m), erkennt den Fahrtbeginn am Tempo.
// Modus "fahrt":  GPS jede Sekunde, zählt Strecke, erkennt das Ende am Stillstand.
// Auf Android läuft das als Vordergrund-Dienst mit Dauer-Benachrichtigung weiter, auch wenn die App im Hintergrund ist.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as sensoren from './sensoren.js';
import { createErkennung, distanz, SCHWELLEN } from './erkennung.js';

export { distanz, SCHWELLEN };
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

// onLog(typ, daten) bekommt jede rohe Position und jeden Zustandswechsel (für den Entwicklermodus)
export function createTracker({ onStart, onPunkt, onStopp, onFehler, onLog = () => {} }) {
  let watcherId = null, webId = null;
  const erkennung = createErkennung({ onStart, onPunkt, onStopp, onLog });
  const verarbeite = erkennung.verarbeite, modusJetzt = () => erkennung.modus;

  let simQuelle = false;   // Fahrsimulator: Positionen kommen über einspeisen(), echtes GPS ist aus
  async function beobachte(abstand) {
    await stoppeWatcher();
    if (simQuelle) return;
    if (Capacitor.isNativePlatform()) {
      watcherId = await BackgroundGeolocation.addWatcher({
        backgroundTitle: 'Bubble Log',
        backgroundMessage: modusJetzt() === 'fahrt' ? 'Fahrt wird aufgezeichnet' : 'Wartet auf die nächste Fahrt',
        requestPermissions: true, stale: false, distanceFilter: abstand,
      }, (loc, err) => {
        if (err) { onLog('fehler', { quelle: 'gps', code: err.code, text: err.message }); onFehler?.(err.code === 'NOT_AUTHORIZED' ? 'standort' : err.message); return; }
        verarbeite(loc);
      });
    } else if (navigator.geolocation) {   // Browser zum Ausprobieren: nur solange die Seite offen ist
      webId = navigator.geolocation.watchPosition(
        pos => verarbeite({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, altitude: pos.coords.altitude, time: pos.timestamp }),
        e => onFehler?.(e.code === 1 ? 'standort' : e.message), { enableHighAccuracy: true });
    }
  }
  async function stoppeWatcher() {
    if (watcherId) { const id = watcherId; watcherId = null; await BackgroundGeolocation.removeWatcher({ id }).catch(() => {}); }
    if (webId != null) { navigator.geolocation.clearWatch(webId); webId = null; }
  }

  return {
    get modus() { return erkennung.modus; },
    async setModus(neu) {
      if (!erkennung.setModus(neu)) return;
      if (!simQuelle && (neu === 'fahrt' || (neu === 'warten' && sensoren.auchBeimWarten()))) sensoren.start(neu); else sensoren.stopp();   // Barometer und Beschleunigung nur bei echter Fahrt (Entwicklermodus: auch beim Warten)
      if (neu === 'aus') return stoppeWatcher();
      return beobachte(neu === 'fahrt' ? 0 : 30);
    },
    oeffneEinstellungen() { if (Capacitor.isNativePlatform()) BackgroundGeolocation.openSettings(); },
    // Fahrsimulator an/aus: echtes GPS stoppen bzw. wieder starten; der Modus bleibt, die Erkennung beginnt frisch
    async setSim(an) {
      if (an === simQuelle) return;
      simQuelle = an; erkennung.zuruecksetzen();
      if (an) { sensoren.stopp(); await stoppeWatcher(); }
      else if (modusJetzt() !== 'aus') { if (modusJetzt() === 'fahrt' || sensoren.auchBeimWarten()) sensoren.start(modusJetzt()); await beobachte(modusJetzt() === 'fahrt' ? 0 : 30); }
    },
    einspeisen(loc) { if (simQuelle) verarbeite(loc); },
  };
}
