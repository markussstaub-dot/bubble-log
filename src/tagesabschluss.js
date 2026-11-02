// Tagesabschluss (02.11.2026): Mehrere Fahrten ohne Akkustand auf einmal speichern. Wenige bekannte Stände (Anker:
// letzter gespeicherter Stand, vom Nutzer eingetragene Start- oder Endwerte, Akku jetzt) spannen Abschnitte auf; der
// Verbrauch dazwischen wird nach einem Gewicht (Strecke, Höhe, Kaltstart) auf die Fahrten verteilt.
// Ohne Capacitor und DOM, damit es sich testen lässt.

// fahrten: [{ t0, t1 }] chronologisch, gewichte: Verbrauch je Fahrt in Prozentpunkten (Schätzung, nur das Verhältnis zählt),
// anker: [{ t, soc }]. Ergebnis je Fahrt { start, ende } (ganze Prozent) oder { fehler } für Fahrten, die sich nicht
// eindeutig verteilen lassen.
export function verteilen(fahrten, gewichte, anker) {
  const a = [...anker].sort((x, y) => x.t - y.t);
  const out = fahrten.map(() => ({ fehler: 'Kein bekannter Akkustand davor oder danach: Akku jetzt oder einen Start-Wert eintragen' }));
  for (let k = 0; k < a.length - 1; k++) {
    const von = a[k], bis = a[k + 1];
    const idx = fahrten.map((f, i) => i).filter(i => fahrten[i].t0 >= von.t && fahrten[i].t1 <= bis.t);
    if (!idx.length) continue;   // ohne Fahrt dazwischen darf der Akku auch steigen (geladen)
    const fall = von.soc - bis.soc;
    if (fall < 0) { for (const i of idx) out[i] = { fehler: 'Akku ist hier gestiegen: geladen? Start-Akku nach dem Laden eintragen' }; continue; }
    const w = idx.map(i => Math.max(0, gewichte[i] || 0)), summe = w.reduce((s, x) => s + x, 0);
    let schon = 0, stand = von.soc;
    idx.forEach((i, n) => {
      schon += summe > 0 ? w[n] / summe : 1 / idx.length;
      const ende = Math.round(von.soc - fall * schon);   // kumuliert gerundet: die letzte Fahrt endet genau beim Anker
      out[i] = { start: stand, ende };
      stand = ende;
    });
  }
  return out;
}
