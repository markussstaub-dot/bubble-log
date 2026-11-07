// Langer Druck (SPEC-usability.md, US4): „Fahrt beenden“ löst erst nach ≈ 1 s Halten aus, damit Zurechtrücken des
// Handys in der Halterung nichts beendet. Der Fortschrittsring läuft per CSS (Klasse „haelt“, Variable --halten).
export const HALTEN_MS = 1000;

// el: Knopf; onFertig: wird nach dauer ms Halten einmal aufgerufen. Gibt eine Abbruchfunktion zurück.
export function langerDruck(el, onFertig, { dauer = HALTEN_MS, onLos = () => {} } = {}) {
  let id = null;
  const ab = () => {
    if (id == null) return;
    clearTimeout(id); id = null; el.classList.remove('haelt'); onLos(false);
  };
  const an = e => {
    if (id != null) return;
    if (e.type === 'keydown' && (e.repeat || (e.key !== 'Enter' && e.key !== ' '))) return;
    if (e.type === 'pointerdown' && e.button > 0) return;
    e.preventDefault?.();
    el.style?.setProperty?.('--halten', `${dauer}ms`);
    el.classList.add('haelt');
    id = setTimeout(() => { id = null; el.classList.remove('haelt'); onLos(true); onFertig(); }, dauer);
  };
  el.addEventListener('pointerdown', an);
  el.addEventListener('keydown', an);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur']) el.addEventListener(ev, ab);
  el.addEventListener('contextmenu', e => e.preventDefault?.());   // Android: langes Drücken öffnet sonst ein Menü
  return ab;
}
