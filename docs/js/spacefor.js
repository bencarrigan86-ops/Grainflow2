// The commodity the person picks for working out the room in empty silos that have no commodity set: remembered on this phone only,
// by name. It is a way of looking at the silos, not something saved on them.

const KEY = 'grainflow.spaceAs';

export function loadSpaceAs() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function saveSpaceAs(name) {
  try { localStorage.setItem(KEY, String(name || '')); } catch { /* private mode: it just resets */ }
}
