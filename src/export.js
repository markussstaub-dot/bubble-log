// Fahrtenbuch als CSV-Datei: über das Android-Teilen-Menü weitergeben oder in "Dokumente/Bubble Log" speichern.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const ORDNER = 'Bubble Log';

export function csvText(fahrten) {
  const zeilen = ['Datum;Start;Ende;km;Akku Start %;Akku Ende %;Temperatur °C;Zweck;Höhenmeter auf;Höhenmeter ab;starke Bremsungen;starke Beschleunigungen;raue Strecke %',
    ...fahrten.map(f => [f.tag, f.von, f.nach, String(f.km).replace('.', ','), f.start, f.ende, f.temp ?? '', f.zweck,
      f.hm ?? '', f.hmAb ?? '', f.brems ?? '', f.beschl ?? '', f.rau ?? ''].join(';'))];
  return zeilen.join('\r\n');
}

export function dateiname(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `fahrtenbuch-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
}

// Das BOM vorne sorgt dafür, dass Excel Umlaute und °C richtig liest
const mitBom = text => '﻿' + text;

function browserDownload(text, name) {
  const url = URL.createObjectURL(new Blob([mitBom(text)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Ergebnis: 'geteilt', 'abgebrochen' oder 'heruntergeladen' (Browser)
export async function teilen(text) {
  const name = dateiname();
  if (!Capacitor.isNativePlatform()) { browserDownload(text, name); return 'heruntergeladen'; }
  const { uri } = await Filesystem.writeFile({ path: name, data: mitBom(text), directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: 'Fahrtenbuch', files: [uri], dialogTitle: 'Fahrtenbuch teilen' });
    return 'geteilt';
  } catch (e) {
    if (/cancel/i.test(String(e?.message))) return 'abgebrochen';
    throw e;
  }
}

// Ergebnis: der Ort für die Anzeige, z. B. "Dokumente/Bubble Log/fahrtenbuch-2026-10-27.csv"
export async function speichern(text) {
  const name = dateiname();
  if (!Capacitor.isNativePlatform()) { browserDownload(text, name); return `Downloads/${name}`; }
  await Filesystem.writeFile({ path: `${ORDNER}/${name}`, data: mitBom(text), directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
  return `Dokumente/${ORDNER}/${name}`;
}
