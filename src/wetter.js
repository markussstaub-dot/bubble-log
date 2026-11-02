// Aktuelle Temperatur am Standort von Open-Meteo (kostenlos, ohne Konto). Ohne Netz: null.
export async function temperatur([lat, lon]) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const t = (await r.json())?.current?.temperature_2m;
    return typeof t === 'number' ? Math.round(t) : null;
  } catch (e) { return null; }
}

// Tiefste Temperatur am Standort zwischen von und bis (ms), aus den Stundenwerten der letzten Tage. Für die Frostnacht
// vor einer Fahrt: kalter Akku und vereiste Kabine kosten auf den ersten Kilometern viel. Ohne Netz: null.
export async function tiefstwert([lat, lon], von, bis) {
  try {
    const tage = Math.min(7, Math.ceil((Date.now() - von) / 864e5) + 1);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=temperature_2m&past_days=${tage}&forecast_days=1&timeformat=unixtime`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const { time = [], temperature_2m: t = [] } = (await r.json())?.hourly || {};
    const werte = t.filter((x, i) => typeof x === 'number' && time[i] * 1000 >= von - 3600e3 && time[i] * 1000 <= bis);
    return werte.length ? Math.round(Math.min(...werte)) : null;
  } catch (e) { return null; }
}
