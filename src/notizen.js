// Notizen empfangen (SPEC-konsole.md, 15.11.2026): von der Sticky-App per Broadcast (nur Apps mit gleichem Schlüssel)
// und von jeder App über Android-„Teilen“ (Text). Beides legt Notizen.java in files/notizen-eingang.jsonl ab; hier
// werden sie abgeholt, zu Notizen gemacht (src/notizbuch.js) und an main.js übergeben, das sie in eigen.notizen
// speichert. Läuft ohne Entwicklermodus. Im Devlog stehen sie zusätzlich als Typ „notiz“, wenn der Modus an ist.
// Die Zeit t einer Sticky-Notiz bleibt erhalten (Zeitpunkt am Sticky); beim Teilen ist t der Empfang.
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as devlog from './devlog.js';
import { notizAus } from './notizbuch.js';

const NATIV = Capacitor.isNativePlatform();
const Notizen = registerPlugin('Notizen');

let app = { ort: () => null, neu: () => {} };

// Eine Rohzeile übernehmen; true, wenn daraus eine Notiz wurde
export function uebernehmen(roh, standard = 'sticky') {
  if (!roh || typeof roh !== 'object') return false;
  const { typ, ...rest } = roh;
  const n = notizAus({ quelle: standard, ...rest }, { ort: app.ort() });
  if (!n) return false;
  devlog.log('notiz', { ...rest, ...n, empfangen: Date.now() });
  app.neu(n);
  return true;
}

let laeuft = false;
export async function abholen() {
  if (!NATIV || laeuft) return 0;
  laeuft = true;
  try {
    const { zeilen = [] } = await Notizen.abholen();
    let n = 0;
    for (const z of zeilen) { try { if (uebernehmen(JSON.parse(z))) n++; } catch { /* kaputte Zeile */ } }
    return n;
  } catch (e) { devlog.log('fehler', { quelle: 'notizen', text: e.message }); return 0; }
  finally { laeuft = false; }
}

// ort(): { lat, lon, t } letzter GPS-Punkt oder null; neu(notiz): speichern und anzeigen
export function starten(mit) {
  app = { ...app, ...mit };
  if (NATIV) {
    Notizen.addListener('notiz', () => abholen()).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) abholen(); });
    abholen();
  } else {
    // Browser zum Ausprobieren, in der Konsole des Browsers:
    //   bubbleNotiz({ art: 'diktat', text: 'Schild falsch' })   wie von der Sticky-App
    //   bubbleTeilen('Stau an der Ampel')                        wie „Teilen“ aus einer anderen App
    window.bubbleNotiz = (n = {}) => uebernehmen({ t: Date.now(), art: 'diktat', sorte: 'fahrt', ...n });
    window.bubbleTeilen = (text, betreff = '') => uebernehmen({ quelle: 'teilen', art: 'text', text: betreff ? `${betreff}: ${text}` : text }, 'teilen');
  }
}
