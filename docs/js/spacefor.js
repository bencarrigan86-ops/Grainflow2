// What the person has picked on this phone for the harvest report and the storage list: the commodity empty silos with no commodity are
// worked out as (by name, one for each season being looked at), and whether the harvest report is looking at winter crops, summer crops
// or both. These are ways of looking, not something saved on the silos or the farm.

const KEY = 'grainflow.spaceAs';
const VIEW_KEY = 'grainflow.harvestView';

const keyFor = (season) => (season === 'winter' || season === 'summer' ? `${KEY}.${season}` : KEY);

export function loadSpaceAs(season = null) {
  try { return localStorage.getItem(keyFor(season)) || ''; } catch { return ''; }
}

export function saveSpaceAs(name, season = null) {
  try { localStorage.setItem(keyFor(season), String(name || '')); } catch { /* private mode: it just resets */ }
}

/** 'winter', 'summer' or 'both' (the default). */
export function loadHarvestView() {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'winter' || v === 'summer' ? v : 'both'; } catch { return 'both'; }
}

export function saveHarvestView(v) {
  try { localStorage.setItem(VIEW_KEY, v === 'winter' || v === 'summer' ? v : 'both'); } catch { /* it just resets */ }
}
