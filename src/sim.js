// Simulation fürs Testen im Browser (nur `npm run dev`, nie in der APK):
// ersetzt navigator.geolocation durch eine gespielte Position und fährt auf Wunsch eine gespeicherte Route ab.
// Die gespielte Uhr läuft schneller (TEMPO), damit Fahrterkennung und 3-Minuten-Stopp in Sekunden durchlaufen.

const SPEICHER = 'CapacitorStorage.bubble-log.v2';
const TAKT = 100;            // ms echte Zeit pro gespielter Sekunde → zehnfache Geschwindigkeit
const KMH = 50;              // Fahrtempo der Simulation
const STEHEN = 240;          // gespielte Sekunden Stillstand am Ziel (die App beendet nach 180 s)

const daten = () => { try { return JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch { return {}; } };
const distanz = (a, b) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

let pos = daten().zuhause?.p || [49.3466, 7.2561], tempo = 0, uhr = Date.now(), laeuft = null;
const beobachter = new Map(); let naechsteId = 1;
const melden = () => {
  const p = { coords: { latitude: pos[0], longitude: pos[1], accuracy: 8, speed: tempo, altitude: null }, timestamp: uhr };
  for (const f of beobachter.values()) f(p);
  posAnzeigen();
};
function posText() {
  const z = daten().zuhause, ort = z && distanz(pos, z.p) < 300 ? z.name : `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}`;
  return `Position: ${ort} · Tempo ${Math.round(tempo * 3.6)} km/h · Uhr ${new Date(uhr).toLocaleTimeString('de-DE')}`;
}
function posAnzeigen() { const el = document.getElementById('simPos'); if (el) el.textContent = posText(); }
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition: ok => setTimeout(() => ok({ coords: { latitude: pos[0], longitude: pos[1], accuracy: 8, speed: tempo }, timestamp: uhr }), 50),
  watchPosition: f => { const id = naechsteId++; beobachter.set(id, f); return id; },
  clearWatch: id => beobachter.delete(id),
} });
// im Stand alle paar echten Sekunden eine Position, wie ein GPS, das nichts Neues hat
setInterval(() => { if (!laeuft) { uhr += 3000; melden(); } }, 3000);

// Punkte im Abstand einer gespielten Sekunde entlang der Route
function abtasten(coords, mps) {
  const out = [coords[0]];
  let rest = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], d = distanz(a, b);
    let s = mps - rest;
    while (s <= d) { const k = s / d; out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); s += mps; }
    rest = d - (s - mps);
  }
  out.push(coords.at(-1));
  return out;
}

function fahren(ziel, info) {
  stoppen();
  const coords = ziel.cache.coords, mps = KMH / 3.6, punkte = abtasten(coords, mps);
  pos = coords[0]; let i = 0, stand = 0;
  laeuft = setInterval(() => {
    uhr += 1000;
    if (i < punkte.length) { pos = punkte[i++]; tempo = mps; info(`unterwegs nach ${ziel.kurz}: ${Math.round(i / punkte.length * 100)} %`); }
    else if (stand++ < STEHEN) { tempo = 0; info(`angekommen in ${ziel.kurz}, stehe ${stand} s (Fahrtende nach 180 s)`); }
    else { stoppen(); info(`fertig, Microlino steht in ${ziel.kurz}`); return; }
    melden();
  }, TAKT);
}
function stoppen() { if (laeuft) clearInterval(laeuft); laeuft = null; tempo = 0; }

// ---------- Panel ----------
const knopf = document.createElement('button');
knopf.textContent = 'SIM';
knopf.title = 'Simulation (nur im Browser)';
knopf.style.cssText = 'position:fixed;left:10px;bottom:84px;z-index:60;border-radius:999px;padding:8px 12px;border:0;background:#b7791f;color:#fff;font:600 12px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.25)';
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:10px;right:10px;bottom:128px;z-index:60;background:#fff;color:#15201e;border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:13px system-ui;display:none;flex-direction:column;gap:8px;max-width:360px';
document.body.append(knopf, panel);
knopf.onclick = () => { const zu = panel.style.display === 'none'; panel.style.display = zu ? 'flex' : 'none'; if (zu) zeichnen(); };

let status = 'steht';
const info = t => { status = t; const el = panel.querySelector('#simStatus'); if (el) el.textContent = t; };
function zeichnen() {
  const d = daten(), ziele = (d.favoriten || []).filter(f => f.cache?.coords?.length > 1);
  panel.innerHTML = `<b>Simulation</b>
    <div id="simPos">${posText()}</div>
    <div id="simStatus" style="color:#5b6865">${status}</div>
    <label>Fahrt zu <select id="simZiel" style="font:inherit">${ziele.map((f, i) => `<option value="${i}">${f.kurz} (${f.cache.km.toFixed(0)} km)</option>`).join('')}</select></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button id="simFahren">▶ Fahren (10×)</button><button id="simStopp">■ Anhalten</button><button id="simHeim">⌂ Nach Hause beamen</button>
    </div>
    <div style="color:#5b6865">Für automatische Erkennung: Einstellungen → Fahrterkennung an. Sonst „Fahrt starten“ und dann fahren.</div>`;
  panel.querySelector('#simFahren').onclick = () => { const z = ziele[Number(panel.querySelector('#simZiel').value)]; if (z) fahren(z, info); };
  panel.querySelector('#simStopp').onclick = () => { stoppen(); info('angehalten'); };
  panel.querySelector('#simHeim').onclick = () => { stoppen(); pos = daten().zuhause?.p || pos; uhr += 1000; melden(); info('zu Hause'); };
}
