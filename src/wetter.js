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
