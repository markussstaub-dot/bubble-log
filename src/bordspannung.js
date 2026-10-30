// 12-V-Bordspannung (SPEC-12v.md): Antworten des BM6 lesen, Minutenwerte bilden, bewerten, als Beleg exportieren.
// Reine Rechnung ohne Bluetooth, damit alles in Node prüfbar ist. Die Verbindung zum Gerät steckt in bm6.js.

// BM6-Protokoll (tarball.ca, github.com/jeffwdh/bm6-battery-monitor): AES-128-CBC, IV = 0, ohne Auffüllung.
// Schlüssel: „leagend“, FF FE, „0100009“. Entschlüsselt wird nativ (Batteriewaechter.java); hier nur zum Nachprüfen.
export const SCHLUESSEL = [108, 101, 97, 103, 101, 110, 100, 255, 254, 48, 49, 48, 48, 48, 48, 57];
export const BEFEHL = 'd1550700000000000000000000000000';            // „Messwerte senden“, Klartext
export const BEFEHL_VERSCHLUESSELT = '697ea0b5d54cf024e794772355554114';

// Schwellen aus microlino-12v-problem.md; ändern nur nach Zustimmung
export const RUHE_OK = 12.6;          // V, Auto aus: ab hier ok
export const RUHE_VERDACHT = 12.4;    // V, Auto aus: darunter verdächtig
export const FAHRT_OK = [13.4, 14.4]; // V, Mittelwert beim Fahren: ok
export const FAHRT_VERDACHT = 13.2;   // V, Mittelwert beim Fahren: darunter verdächtig
export const SCHWANKUNG_MAX = 0.5;    // V, größter − kleinster Minutenwert einer Fahrt

// Entschlüsselte Antwort als Hex-Text → { v, temp, soc } oder null.
// Zeichen 0–5 „d15507“, 6–7 „01“ = Temperatur negativ, 8–9 Temperatur, 12–13 Ladezustand, 15–17 Spannung in 1/100 V.
export function antwortLesen(hex) {
  const h = String(hex || '').toLowerCase();
  if (h.length < 18 || !h.startsWith('d15507')) return null;
  const v = parseInt(h.slice(15, 18), 16) / 100, t = parseInt(h.slice(8, 10), 16), soc = parseInt(h.slice(12, 14), 16);
  if (!Number.isFinite(v)) return null;
  return { v, temp: h.slice(6, 8) === '01' ? -t : t, soc };
}

const r2 = x => Math.round(x * 100) / 100;

// Einzelwerte [t, v] in Minutenwerte [Minutenbeginn, kleinster, Mittel, größter] einrechnen, laufend während der Fahrt,
// ohne alle Einzelwerte zu behalten. `summen` (Minutenbeginn → [Anzahl, Summe]) hält das Mittel genau.
export function einrechnen(minuten, summen, werte) {
  for (const [t, v] of werte) {
    const k = Math.floor(t / 60000) * 60000;
    let b = minuten.find(x => x[0] === k);
    if (!b) { b = [k, v, v, v]; minuten.push(b); minuten.sort((a, c) => a[0] - c[0]); }
    const s = summen[k] ||= [0, 0]; s[0]++; s[1] += v;
    b[1] = r2(Math.min(b[1], v)); b[3] = r2(Math.max(b[3], v)); b[2] = r2(s[1] / s[0]);
  }
  return minuten;
}

// 'ok' | 'beobachten' | 'verdaechtig'
export const ruheStufe = v => v >= RUHE_OK ? 'ok' : v >= RUHE_VERDACHT ? 'beobachten' : 'verdaechtig';

// Minutenwerte einer Fahrt → { mittel, min, max, schwankung, stufe } oder null (keine Werte).
// Die erste und letzte Minute zählen nicht, solange es mehr als drei gibt: Beim Einschalten und Abstellen
// springt die Spannung, das sagt nichts über den Laderegler.
export function fahrtBewerten(minuten) {
  if (!minuten?.length) return null;
  const kern = minuten.length > 3 ? minuten.slice(1, -1) : minuten;
  const mittel = r2(kern.reduce((s, m) => s + m[2], 0) / kern.length);
  const min = Math.min(...kern.map(m => m[1])), max = Math.max(...kern.map(m => m[3]));
  const schwankung = r2(max - min);
  const stufe = mittel < FAHRT_VERDACHT || schwankung > SCHWANKUNG_MAX ? 'verdaechtig'
    : mittel >= FAHRT_OK[0] && mittel <= FAHRT_OK[1] ? 'ok' : 'beobachten';
  return { mittel, min, max, schwankung, stufe };
}

export const STUFE_TEXT = { ok: 'ok', beobachten: 'beobachten', verdaechtig: 'verdächtig' };
export const STUFE_KLASSE = { ok: 'good', beobachten: 'warn', verdaechtig: 'bad' };
export const ANLASS_TEXT = { start: 'Fahrtbeginn', ruhe: 'Ruhe nach Fahrt', startproblem: 'Springt nicht an', nachher: 'Nach Trennen/Verbinden', messung: 'Messung' };

const zahl = v => v == null ? '' : String(v).replace('.', ',');
const p2 = n => String(n).padStart(2, '0');
const tag = t => { const d = new Date(t); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
const zeit = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

// Beleg für die Werkstatt: Zusammenfassung oben, darunter eine Zeile je Messung.
// messungen: [{ t, v, temp, anlass, stufe, fahrt, notiz }], fahrten: mit f.v12 = { minuten, bewertung }
export function belegCsv(messungen, fahrten) {
  const mitWerten = fahrten.filter(f => f.v12?.minuten?.length);
  const verdacht = mitWerten.filter(f => f.v12.bewertung?.stufe === 'verdaechtig');
  const probleme = messungen.filter(m => m.anlass === 'startproblem');
  const kopf = [
    '12-V-Bordspannung Microlino (Bubble Log, Messgerät BM6 an der 12-V-Batterie)',
    `Fahrten mit Messung;${mitWerten.length};davon verdächtig;${verdacht.length}`,
    `Startprobleme;${probleme.length}`,
    ...probleme.map(p => {
      const davor = messungen.filter(m => m.t < p.t && m.anlass !== 'startproblem').at(-1);
      return `Startproblem ${tag(p.t)} ${zeit(p.t)};${zahl(p.v)} V${davor ? `;zuvor ${zahl(davor.v)} V am ${tag(davor.t)} ${zeit(davor.t)} (${ANLASS_TEXT[davor.anlass] || davor.anlass})` : ''}`;
    }),
    `Schwellen;Auto aus ok ab ${zahl(RUHE_OK)} V, verdächtig unter ${zahl(RUHE_VERDACHT)} V;Fahrt ok ${zahl(FAHRT_OK[0])}–${zahl(FAHRT_OK[1])} V, verdächtig unter ${zahl(FAHRT_VERDACHT)} V oder Schwankung über ${zahl(SCHWANKUNG_MAX)} V`,
    '',
  ];
  const zeilen = [
    ...messungen.map(m => ({ t: m.t, z: [tag(m.t), zeit(m.t), zahl(m.v), '', '', m.temp ?? '', ANLASS_TEXT[m.anlass] || m.anlass, STUFE_TEXT[m.stufe] || '', m.notiz || ''] })),
    ...mitWerten.flatMap(f => f.v12.minuten.map(([t, min, mittel, max]) => ({ t, z: [tag(t), zeit(t), zahl(mittel), zahl(min), zahl(max), '', `Fahrt ${f.von}–${f.nach}`, STUFE_TEXT[f.v12.bewertung?.stufe] || '', ''] }))),
  ].sort((a, b) => a.t - b.t).map(x => x.z.join(';'));
  return [...kopf, 'Datum;Uhrzeit;Spannung V;kleinster V;größter V;Temperatur °C;Anlass;Bewertung;Notiz', ...zeilen].join('\r\n');
}

// Kleine Kurve (SVG) der Minutenwerte: Band kleinster–größter, Linie Mittel, gestrichelt die Schwellen
export function kurveSvg(minuten, { w = 300, h = 90 } = {}) {
  if (!minuten?.length) return '';
  const lo = Math.min(12, ...minuten.map(m => m[1])) - 0.1, hi = Math.max(14.5, ...minuten.map(m => m[3])) + 0.1;
  const t0 = minuten[0][0], t1 = Math.max(minuten.at(-1)[0], t0 + 60000);
  const x = t => ((t - t0) / (t1 - t0) * (w - 4) + 2).toFixed(1), y = v => ((hi - v) / (hi - lo) * h).toFixed(1);
  const band = 'M' + minuten.map(m => `${x(m[0])} ${y(m[3])}`).join(' L') + ' L' + minuten.slice().reverse().map(m => `${x(m[0])} ${y(m[1])}`).join(' L') + 'Z';
  const linie = 'M' + minuten.map(m => `${x(m[0])} ${y(m[2])}`).join(' L');
  const schwelle = (v, farbe) => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" stroke="var(--${farbe})" stroke-dasharray="4 4" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Spannungsverlauf">
    ${schwelle(FAHRT_VERDACHT, 'bad')}${schwelle(FAHRT_OK[0], 'good')}
    <path d="${band}" fill="var(--accent)" opacity=".2"/><path d="${linie}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
}
