// Fahrt nachtragen (SPEC-gps-abbruch.md, „[fest, 29.10.2026] Fahrt nachtragen“): reine Logik ohne Oberfläche.
// Die App merkt sich eine kleine Spur aus den Log-Zeilen (App sichtbar/verborgen, Bewegung) – auch ohne Entwicklermodus –
// und schlägt daraus beim Akku-Eintragen eine verpasste Fahrt vor.

export const LUECKE_MIN = 10 * 60e3;     // ms: so lange muss die App zu gewesen sein
export const BEWEGT_TEMPO = 2;           // m/s GPS-Tempo (≈ 7 km/h): darüber hat sich das Handy bewegt
const SPUR_TAGE = 2;                     // ältere Einträge fallen weg
const SPUR_MAX = 400;
const BEWEGT_ABSTAND = 60e3;             // ms: höchstens ein „bewegt“ pro Minute

// Eine Log-Zeile (typ, daten wie in devlog.js) als Spur-Eintrag { t, e }, oder null, wenn sie nichts zur Lücke beiträgt
export function spurZeile(typ, daten, t) {
  if (typ === 'app' && daten.start) return { t, e: 'start' };
  if (typ === 'app' && 'sichtbar' in daten) return { t, e: daten.sichtbar ? 'sichtbar' : 'verborgen' };
  if (typ === 'vibration' && daten.ruhig === false) return { t, e: 'bewegt' };
  if (typ === 'gps' && !daten.verworfen && (daten.tempoBerechnet ?? daten.tempo ?? 0) >= BEWEGT_TEMPO) return { t, e: 'bewegt' };
  return null;
}
// Hängt an und kürzt; true, wenn sich die Spur geändert hat
export function spurAnhaengen(spur, eintrag) {
  if (!eintrag) return false;
  if (eintrag.e === 'bewegt' && spur.findLast(z => z.e === 'bewegt')?.t > eintrag.t - BEWEGT_ABSTAND) return false;
  spur.push(eintrag);
  const grenze = eintrag.t - SPUR_TAGE * 864e5;
  let weg = 0; while (weg < spur.length && (spur[weg].t < grenze || spur.length - weg > SPUR_MAX)) weg++;
  if (weg) spur.splice(0, weg);
  return true;
}

// Zeit, in der die App zu war, nach dem letzten bekannten Akkustand (seit): { von, bis, bewegt } oder null.
// Bevorzugt die jüngste Lücke mit Bewegung. Wurde die App beendet, ohne dass „verborgen“ ankam, zählt ab dem letzten Eintrag.
export function lueckeFinden(spur, { seit = 0, jetzt }) {
  const luecken = [];
  let zu = null, letzte = null;
  for (const z of spur) {
    if (z.e === 'verborgen') zu ??= z.t;
    else if (z.e === 'sichtbar' || z.e === 'start') {
      const von = zu ?? (z.e === 'start' ? letzte : null);
      if (von != null) luecken.push({ von, bis: z.t });
      zu = null;
    }
    letzte = z.t;
  }
  if (zu != null) luecken.push({ von: zu, bis: jetzt });
  const passend = luecken
    .map(l => ({ von: Math.max(l.von, seit), bis: l.bis }))
    .filter(l => l.bis - l.von >= LUECKE_MIN)
    .map(l => ({ ...l, bewegt: spur.some(z => z.e === 'bewegt' && z.t >= l.von && z.t <= l.bis) }));
  return passend.findLast(l => l.bewegt) ?? passend.at(-1) ?? null;
}

// Gemerkte Ziele ({ kurz, km } einfache Strecke) nach Passung zum Akku-Verbrauch: zuerst das Ziel, dessen Strecke
// mit dem eigenen Schnitt (proKm, %/km) am ehesten den Verbrauch erklärt. Ohne Verbrauch nach Entfernung.
export function zielVorschlaege(ziele, { verbrauch, proKm, retour = true }) {
  const faktor = retour ? 2 : 1;
  const abstand = z => verbrauch > 0 && proKm > 0 ? Math.abs(z.km * faktor * proKm - verbrauch) : z.km;
  return ziele.slice().sort((a, b) => abstand(a) - abstand(b) || a.km - b.km);
}

// Strecke in km (eine Nachkommastelle) oder null, wenn nichts Brauchbares angegeben ist
export function strecke({ quelle, zielKm, retour, handKm }) {
  const v = quelle === 'ziel' ? (zielKm ?? NaN) * (retour ? 2 : 1) : Number(String(handKm ?? '').replace(',', '.'));
  return v > 0 && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

// Fehlertext für das Formular oder null
export function pruefen({ t0, t1, start, ende, km, jetzt }) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 'Bitte Beginn und Ende der Fahrt angeben.';
  if (t1 <= t0) return 'Das Ende muss nach dem Beginn liegen.';
  if (t1 > jetzt + 60e3) return 'Die Fahrt kann nicht in der Zukunft enden.';
  if (!(start >= 0 && start <= 100 && ende >= 0 && ende <= 100)) return 'Akkustände zwischen 0 und 100 %.';
  if (ende > start) return 'Der Akku am Ende kann nicht voller sein als am Start.';
  if (km == null) return 'Bitte ein Ziel wählen oder die km eingeben.';
  if (km > 500) return 'Mehr als 500 km in einer Fahrt? Bitte die km prüfen.';
  return null;
}

const p2 = n => String(n).padStart(2, '0');
// Für <input type="datetime-local"> (Ortszeit) und zurück
export const alsEingabe = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const ausEingabe = s => s ? new Date(s).getTime() : NaN;

// Fahrt fürs Fahrtenbuch: wie eine aufgezeichnete, aber ohne Spur, Höhenmeter, Temperatur und Fahrstil
export function nachtragFahrt({ id, t0, t1, start, ende, km, zweck, quelle, ziel, retour, startQuelle, endeQuelle, fotoEnde }) {
  const d = new Date(t0), uhr = t => { const x = new Date(t); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const f = { id: id || 'n' + t0, tag: `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`, t0, t1, von: uhr(t0), nach: uhr(t1), km, start, ende,
    temp: null, zweck, punkte: [], nachgetragen: true, strecke: quelle === 'ziel' ? { quelle, ziel, retour: !!retour } : { quelle: 'hand' },
    startQuelle, endeQuelle };
  if (fotoEnde) f.fotoEnde = fotoEnde;
  return f;
}
