// Kern der Fahrterkennung ohne GPS und Capacitor: bekommt Positionen (loc wie vom Plugin) und entscheidet
// Kandidat → Start → Stopp. tracker.js hängt ihn ans echte GPS, replay.js und die Tests füttern ihn mit Logs.
// Modus "warten": erkennt den Fahrtbeginn am Tempo. Modus "fahrt": erkennt das Ende am Stillstand.

export const SCHWELLEN = {
  START_TEMPO: 3,          // m/s ≈ 11 km/h: schneller als Gehen
  START_DAUER: 20000,      // so lange schneller als START_TEMPO …
  START_WEG: 150,          // … und mindestens so weit vom ersten schnellen Punkt
  KANDIDAT_MAX: 60000,     // ms ohne Tempo, dann wird der Kandidat verworfen
  STOPP_RADIUS: 40,        // m: Bewegung darunter zählt als Stillstand
  STOPP_DAUER: 180000,     // 3 min Stillstand beendet die Fahrt
  BEWEGT_TEMPO: 1,         // m/s: ab hier gilt ein Punkt als bewegt (Fahrtende = letzter bewegter Punkt)
  MAX_UNGENAU: 40,         // m: ungenauere Punkte werden verworfen
  MAX_TEMPO: 40,           // m/s: Sprünge darüber sind GPS-Fehler
  SPRUNG_NEU: 3,           // so viele Sprünge in Folge: dann gilt die neue Position
};

export function distanz(a, b) {        // Meter zwischen zwei [lat, lon]
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// schwellen: einzelne Werte aus SCHWELLEN überschreiben (Tests, Replay); jetzt: Uhr für Punkte ohne Zeit
export function createErkennung({ onStart = () => {}, onPunkt = () => {}, onStopp = () => {}, onLog = () => {}, schwellen = {}, jetzt = Date.now } = {}) {
  const S = { ...SCHWELLEN, ...schwellen };
  let modus = 'aus';
  let kandidat = null, letzter = null, ruhe = null, bewegt = null;   // bewegt: letzter Punkt mit echtem Tempo = Fahrtende
  let spruenge = 0;   // verworfene Sprünge in Folge; ab SPRUNG_NEU gilt die neue Position (der alte Punkt war wohl der Fehler)
  let vorModus = null;   // letzter Punkt beim Moduswechsel: stammt er aus dem Warten, ist er für die Fahrt kein Bezug

  function verarbeite(loc) {
    if (!loc) return;
    const roh = { modus, lat: loc.latitude, lon: loc.longitude, gen: loc.accuracy, tempo: loc.speed, hoehe: loc.altitude, kurs: loc.bearing, zeit: loc.time };
    if (loc.accuracy > S.MAX_UNGENAU) { onLog('gps', { ...roh, verworfen: 'ungenau' }); return; }
    const p = [loc.latitude, loc.longitude], t = loc.time || jetzt();
    let tempo = loc.speed, neuAufgesetzt = false;
    if ((tempo == null || tempo < 0) && letzter) tempo = distanz(letzter.p, p) / Math.max(1, (t - letzter.t) / 1000);
    if (letzter && distanz(letzter.p, p) / Math.max(1, (t - letzter.t) / 1000) > S.MAX_TEMPO) {
      if (++spruenge < S.SPRUNG_NEU) { onLog('gps', { ...roh, verworfen: 'sprung' }); return; }
      onLog('erkennung', { schritt: 'neu aufgesetzt nach Sprüngen', spruenge });
      letzter = null; kandidat = null; tempo = loc.speed; neuAufgesetzt = true;
    }
    spruenge = 0;
    const punkt = { p, t, tempo: tempo ?? 0, hoehe: loc.altitude ?? null };
    onLog('gps', { ...roh, tempoBerechnet: punkt.tempo });

    if (modus === 'warten') {
      if (punkt.tempo >= S.START_TEMPO) {
        if (!kandidat) { kandidat = punkt; onLog('erkennung', { schritt: 'kandidat' }); }
        else if (t - kandidat.t >= S.START_DAUER && distanz(kandidat.p, p) >= S.START_WEG) {
          const start = kandidat; kandidat = null; letzter = punkt; ruhe = { p, t };
          onLog('erkennung', { schritt: 'start', seit: start.t, weg: Math.round(distanz(start.p, p)) });
          onStart(start, punkt);
          return;
        }
      } else if (kandidat && t - kandidat.t > S.KANDIDAT_MAX) { kandidat = null; onLog('erkennung', { schritt: 'kandidat verworfen' }); }
    } else if (modus === 'fahrt') {
      // Start per Hand nach langer Pause (29.10.2026): der alte Punkt aus dem Warten ist kein Bezug, sonst endet die
      // Fahrt mit dem ersten Punkt gleich wieder als „stopp nach Lücke“
      if (letzter && letzter === vorModus && t - letzter.t >= S.STOPP_DAUER) {
        onLog('erkennung', { schritt: 'alter Punkt verworfen', alter: t - letzter.t });
        letzter = null;
      }
      // Lange Lücke ohne GPS (Tiefgarage, Handy aus) und dabei kaum vom Fleck: hat gestanden, Fahrt endet vor der Lücke
      const luecke = letzter ? t - letzter.t : 0;
      if (luecke >= S.STOPP_DAUER && distanz(letzter.p, p) / (luecke / 1000) < S.BEWEGT_TEMPO) {
        const ende = bewegt ?? letzter;
        onLog('erkennung', { schritt: 'stopp nach Lücke', luecke, ende: ende.t });
        onStopp(ende); ruhe = { p, t }; letzter = punkt;
        return;
      }
      // Punkt nach dem Neuaufsetzen nicht an die Strecke hängen: war der alte Punkt doch richtig, käme der Umweg
      // sonst zweimal in die km (hin und zurück); war der neue richtig, zählt der nächste Punkt den Weg einmal.
      if (!neuAufgesetzt) onPunkt(punkt, letzter);
      if (punkt.tempo >= S.BEWEGT_TEMPO || !bewegt) bewegt = { p, t };
      if (!ruhe || distanz(ruhe.p, p) > S.STOPP_RADIUS) ruhe = { p, t };
      else if (t - ruhe.t >= S.STOPP_DAUER) {
        const ende = bewegt.t <= ruhe.t ? bewegt : ruhe;
        onLog('erkennung', { schritt: 'stopp', ruheSeit: ruhe.t, ende: ende.t });
        onStopp(ende); ruhe = { p, t };
      }
    }
    letzter = punkt;
  }

  return {
    get modus() { return modus; },
    schwellen: S,
    verarbeite,
    // false, wenn der Modus schon so war; sonst beginnen Kandidat und Stillstand frisch
    setModus(neu) {
      if (neu === modus) return false;
      onLog('modus', { von: modus, nach: neu });
      modus = neu; kandidat = null; ruhe = null; bewegt = null; vorModus = letzter;
      return true;
    },
    // Wächter beim Öffnen der App (SPEC-gps-abbruch.md): Beendet Android den GPS-Dienst, kommen keine Punkte mehr und
    // der Stopp oben greift nie. Ist der letzte Punkt älter als STOPP_DAUER, endet die Fahrt am letzten bewegten Punkt.
    // stand: gpsStand() der offenen Fahrt; die Fahrt merkt ihn sich selbst, damit er auch nach einem Neustart der App
    // gilt und kein alter Punkt aus dem Warten zählt. true, wenn die Fahrt dabei endete.
    pruefeAusfall(jetztT, stand) {
      if (modus !== 'fahrt' || !stand) return false;
      const ende = gpsAusfall(stand, jetztT, S);
      if (!ende) return false;
      onLog('erkennung', { schritt: 'stopp nach GPS-Ausfall', luecke: ende.luecke, ende: ende.t });
      ruhe = null; bewegt = null;
      onStopp(ende);
      return true;
    },
    // alles vergessen, auch den letzten Punkt (Wechsel zwischen echtem GPS und Simulator)
    zuruecksetzen() { kandidat = null; letzter = null; ruhe = null; bewegt = null; spruenge = 0; },
  };
}

// Stand für den Wächter, bei jedem Punkt der Fahrt fortgeschrieben: { letzter, bewegt } je { p, t }
export function gpsStand(alt, punkt, S = SCHWELLEN) {
  const jetzt = { p: punkt.p, t: punkt.t };
  return { letzter: jetzt, bewegt: !alt?.bewegt || (punkt.tempo ?? 0) >= S.BEWEGT_TEMPO ? jetzt : alt.bewegt };
}
// Fahrtende nach GPS-Ausfall: letzter bewegter Punkt ({ p, t, luecke }), oder null, solange der letzte Punkt frisch ist
export function gpsAusfall({ letzter, bewegt }, jetztT, S = SCHWELLEN) {
  if (!letzter || jetztT - letzter.t < S.STOPP_DAUER) return null;
  const ende = bewegt && bewegt.t <= letzter.t ? bewegt : letzter;
  return { p: ende.p, t: ende.t, luecke: jetztT - letzter.t };
}
// Fahrtende nie vor dem Fahrtbeginn (Fahrtenbuch 29.10.2026: von 17:00 bis 16:22). Der Beginn t0 ist die Uhr des Handys,
// das Ende kommt aus der GPS-Zeit eines Punktes: ein zwischengespeicherter Fix nach dem Start oder ein Punkt, der vor
// t0 gemessen und erst danach geliefert wurde, liegt sonst davor.
export const fahrtEnde = (t0, t) => Math.max(t0, t);
