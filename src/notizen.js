// Testnotizen der Sticky-App (Knöpfe, Diktate) ins Entwickler-Log übernehmen, damit sie in der Konsole und den
// Logs neben den Fahrt-Ereignissen stehen. Übergabe per Broadcast, Empfänger in Notizen.java (15.11.2026).
// Die Zeit t der Notiz bleibt erhalten (Zeitpunkt am Sticky, nicht der Empfang).
import { Capacitor, registerPlugin } from '@capacitor/core';
import * as devlog from './devlog.js';

const NATIV = Capacitor.isNativePlatform();
const Notizen = registerPlugin('Notizen');

// Nur bei aktivem Entwicklermodus abholen: sonst bleiben sie im Eingang liegen (höchstens 2 MB)
export function uebernehmen(n) {
  if (!n || typeof n !== 'object') return false;
  const { typ, ...rest } = n;
  devlog.log('notiz', { quelle: 'sticky', ...rest, t: n.t ?? Date.now(), empfangen: Date.now() });
  return true;
}

let laeuft = false;
export async function abholen() {
  if (!NATIV || !devlog.aktiv() || laeuft) return 0;
  laeuft = true;
  try {
    const { zeilen = [] } = await Notizen.abholen();
    let n = 0;
    for (const z of zeilen) { try { if (uebernehmen(JSON.parse(z))) n++; } catch { /* kaputte Zeile */ } }
    return n;
  } catch (e) { devlog.log('fehler', { quelle: 'notizen', text: e.message }); return 0; }
  finally { laeuft = false; }
}

export function starten() {
  if (NATIV) {
    Notizen.addListener('notiz', () => abholen()).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) abholen(); });
    abholen();
  } else {
    // Browser: zum Ausprobieren in der Konsole des Browsers, z. B. bubbleNotiz({ art: 'diktat', text: 'Schild falsch' })
    window.bubbleNotiz = (n = {}) => uebernehmen({ t: Date.now(), art: 'diktat', sorte: 'fahrt', ...n });
  }
}
