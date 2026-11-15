// Konsole im Entwicklermodus: Devlog-Ereignisse live am Handy mitlesen (Einstellungen → Entwicklermodus → Konsole).
// Liegt als eigene Ebene über der App, Dialoge (Fahrt-Ende usw.) erscheinen weiter darüber.
import * as devlog from './devlog.js';

const MAX_ZEILEN = 500;   // so viele Zeilen höchstens im DOM
export const FILTER = [
  ['ohneGps', 'Ohne GPS'], ['alles', 'Alles'], ['notiz', 'Notizen'], ['fahrt', 'Fahrt'], ['gps', 'GPS'], ['fehler', 'Fehler'],
];
const FAHRT = new Set(['fahrt', 'eingabe', 'laden', 'ladeort', 'tempolimit', 'display', 'foto', 'bordnetz']);
const GPS = new Set(['gps', 'sensor', 'vibration', 'modus']);

export function passt(e, filter, suche = '') {
  const ok = filter === 'alles' ? true
    : filter === 'ohneGps' ? e.typ !== 'gps'
    : filter === 'notiz' ? e.typ === 'notiz'
    : filter === 'fahrt' ? FAHRT.has(e.typ) || e.typ === 'notiz'
    : filter === 'gps' ? GPS.has(e.typ)
    : filter === 'fehler' ? e.typ === 'fehler' || 'fehler' in e
    : true;
  if (!ok) return false;
  const s = suche.trim().toLowerCase();
  return !s || JSON.stringify(e).toLowerCase().includes(s);
}

const zahl = v => Number.isInteger(v) ? String(v) : String(Math.round(v * 1e5) / 1e5);
const wert = v => typeof v === 'number' ? zahl(v)
  : Array.isArray(v) && v.every(x => typeof x === 'number') ? `[${v.map(zahl).join(', ')}]`
  : typeof v === 'object' && v !== null ? JSON.stringify(v)
  : String(v);

// Eine Zeile: „schritt=beginn km=0.3 …“, die wichtigsten Felder zuerst
export function kurz(e, max = 220) {
  const { t, typ, empfangen, ...rest } = e;   // empfangen (Notizen) nur in der aufgeklappten Zeile
  const vorne = ['schritt', 'text', 'knopf', 'sorte', 'quelle', 'fehler'].filter(k => k in rest);
  const teile = [...vorne, ...Object.keys(rest).filter(k => !vorne.includes(k))].map(k => `${k}=${wert(rest[k])}`);
  const s = teile.join(' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

const p2 = n => String(n).padStart(2, '0');
export const uhr = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let el = null, abmelden = null, alle = [], filter = 'ohneGps', suche = '', pause = false, neuInPause = 0;

export const offen = () => !!el;

export async function oeffnen(app) {
  if (el) return;
  el = document.createElement('div');
  el.className = 'konsole'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Konsole');
  el.innerHTML = `<div class="k-kopf">
      <b>Konsole</b><span class="small muted mono" id="kZahl"></span>
      <button class="chip" id="kPause" aria-pressed="false">Pause</button>
      <button class="iconbtn" id="kZu" aria-label="Konsole schließen">✕</button></div>
    <div class="chips" id="kFilter">${FILTER.map(([k, n]) => `<button class="chip" data-kf="${k}" aria-pressed="${k === filter}">${n}</button>`).join('')}</div>
    <input class="k-suche" id="kSuche" type="search" placeholder="Suchen, z. B. beginn oder 12,4" value="${esc(suche)}" autocomplete="off">
    <div class="k-liste mono" id="kListe"><p class="small muted">Lade die Ereignisse von heute …</p></div>
    <button class="chip k-runter" id="kRunter" hidden>↓ Neueste</button>`;
  app.appendChild(el);

  el.addEventListener('click', ev => {
    const f = ev.target.closest('[data-kf]');
    if (f) { filter = f.dataset.kf; el.querySelectorAll('[data-kf]').forEach(b => b.setAttribute('aria-pressed', String(b === f))); zeichnen(); return; }
    if (ev.target.closest('#kZu')) { schliessen(); return; }
    if (ev.target.closest('#kPause')) { pause = !pause; if (!pause) { neuInPause = 0; zeichnen(); } kopf(); return; }
    if (ev.target.closest('#kRunter')) { runter(); return; }
    const z = ev.target.closest('.k-z');
    if (z) z.classList.toggle('auf');
  });
  el.querySelector('#kSuche').addEventListener('input', ev => { suche = ev.target.value; zeichnen(); });
  const liste = el.querySelector('#kListe');
  liste.addEventListener('scroll', () => { el.querySelector('#kRunter').hidden = amEnde(); });

  // Live zuerst abonnieren, dann die Datei von heute holen: Ereignisse dazwischen nicht verlieren
  const unterwegs = [];
  let geladen = false;
  abmelden = devlog.abonnieren(e => { if (!geladen) { unterwegs.push(e); return; } neu(e); });
  let alt = await devlog.heuteAusDatei().catch(() => []);
  if (!el) return;
  if (!alt.length) alt = devlog.letzteEreignisse();
  const bis = alt.length ? alt[alt.length - 1].t : 0;
  alle = alt.concat(unterwegs.filter(e => e.t > bis || !alt.length));
  geladen = true;
  zeichnen();
}

export function schliessen() {
  abmelden?.(); abmelden = null;
  el?.remove(); el = null; alle = []; pause = false; neuInPause = 0;
}

const amEnde = () => { const l = el.querySelector('#kListe'); return l.scrollHeight - l.scrollTop - l.clientHeight < 40; };
const runter = () => { const l = el.querySelector('#kListe'); l.scrollTop = l.scrollHeight; el.querySelector('#kRunter').hidden = true; };

const klasse = e => e.typ === 'notiz' ? 'notiz' : e.typ === 'fehler' || 'fehler' in e ? 'bad' : e.typ === 'gps' ? 'muted' : FAHRT.has(e.typ) ? 'akz' : '';
const zeile = e => `<div class="k-z ${klasse(e)}"><span class="k-t">${uhr(e.t)}</span> <span class="k-typ">${esc(e.typ)}</span> ${esc(kurz(e))}<pre>${esc(JSON.stringify(e, null, 1))}</pre></div>`;

function kopf() {
  if (!el) return;
  const n = alle.filter(e => passt(e, filter, suche)).length;
  el.querySelector('#kZahl').textContent = `${n} von ${alle.length}`;
  const b = el.querySelector('#kPause');
  b.setAttribute('aria-pressed', String(pause));
  b.textContent = pause ? (neuInPause ? `Weiter (+${neuInPause})` : 'Weiter') : 'Pause';
}

function zeichnen() {
  if (!el) return;
  const sicht = alle.filter(e => passt(e, filter, suche)).slice(-MAX_ZEILEN);
  el.querySelector('#kListe').innerHTML = sicht.length ? sicht.map(zeile).join('') : '<p class="small muted">Keine passenden Ereignisse.</p>';
  kopf(); runter();
}

function neu(e) {
  // Notizen tragen die Zeit vom Sticky und kommen manchmal verspätet: dann einsortieren und neu zeichnen
  const spaet = alle.length && e.t < alle[alle.length - 1].t;
  alle.push(e); if (spaet) alle.sort((a, b) => a.t - b.t);
  if (alle.length > 3000) alle = alle.slice(-2000);
  if (spaet && !pause) { zeichnen(); return; }
  if (pause) { neuInPause++; kopf(); return; }
  if (!passt(e, filter, suche)) { kopf(); return; }
  const l = el.querySelector('#kListe'), unten = amEnde();
  l.querySelector('p.muted')?.remove();
  l.insertAdjacentHTML('beforeend', zeile(e));
  while (l.children.length > MAX_ZEILEN) l.firstElementChild.remove();
  kopf();
  if (unten) runter(); else el.querySelector('#kRunter').hidden = false;
}
