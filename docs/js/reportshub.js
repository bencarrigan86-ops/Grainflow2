/**
 * The Reports screen is a grid of tiles in groups. Simple shows the reports most people open; Full adds the rest.
 * This holds what each tile is and who sees it, so the screen only draws it.
 *
 * A tile is one of three kinds:
 *   view   a report drawn on the Reports screen itself (it comes back here with the back button)
 *   sheet  a report that opens over the screen, and is already used from another screen
 *   go     another screen (a tab)
 */

export const MODE_KEY = 'grainflow.reports.mode';

export const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'full' ? 'full' : 'simple'; } catch { return 'simple'; } };
export const saveMode = (mode) => { try { localStorage.setItem(MODE_KEY, mode === 'full' ? 'full' : 'simple'); } catch { /* shown as Simple next time */ } };

export const FAVS_KEY = 'grainflow.reports.favs';
/** The reports this person starred, kept on this device; null until they star or un-star one (then the standard Simple set applies). */
export const readFavs = () => { try { const v = JSON.parse(localStorage.getItem(FAVS_KEY) || 'null'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null; } catch { return null; } };
export const saveFavs = (ids) => { try { localStorage.setItem(FAVS_KEY, JSON.stringify(ids)); } catch { /* the stars do not stick */ } };

/** The starred ids after a tap on one: starts from the standard Simple set when nothing has been starred yet. */
export function toggledFavs(groups, favs, id) {
  const base = favs || groups.flatMap((g) => g.tiles).filter((x) => x.simple).map((x) => x.id);
  return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
}

const BOOKS = ['owner', 'manager', 'bookkeeper'];

/**
 * The groups of tiles for this person, in order, leaving out a group with nothing in it.
 * `can(tab)` says whether their role may open that tab; the report behind a tile needs the same.
 * Simple shows the starred tiles (the standard Simple ones, until the person stars their own); Full shows all of them, each marked starred or not.
 */
export function hubGroups({ mode = 'simple', role = '', showYield = true, hasCotton = false, hasFields = true, can = () => true, favs = null } = {}) {
  const full = mode === 'full';
  const tile = (id, label, kind, extra = {}) => ({ id, label, kind, ...extra });
  const groups = [
    {
      title: 'Paddocks and crops',
      tiles: [
        showYield && tile('yield', 'Yield', 'view', { simple: true }),
        tile('harvest', 'Harvest progress', 'view', { simple: true }),
        tile('fert', 'Fert', 'view', { simple: true }),
        tile('seed', 'Seed', 'view', { simple: true }),
        hasFields && can('production') && tile('map', 'Farm map', 'sheet', { simple: true }),
        hasCotton && tile('modules', 'Modules', 'view', { simple: true }),
        hasFields && can('production') && tile('rotation', 'Rotation', 'sheet'),
        showYield && can('production') && tile('averages', 'Averages', 'sheet'),
      ],
    },
    {
      title: 'Money',
      tiles: [
        can('position') && tile('position', 'Position', 'go', { simple: true, tab: 'position' }),
        can('sales') && tile('owed', 'Invoices', 'sheet', { simple: true }),
        can('sales') && tile('mtm', 'MTM', 'sheet'),
        BOOKS.includes(role) && tile('deliveries', 'Delivery timeline', 'sheet'),
        can('position') && tile('prices', 'Prices', 'sheet'),
        can('position') && tile('eofy', 'End of year', 'sheet'),
      ],
    },
    {
      title: 'Loads and storage',
      tiles: [
        tile('room', 'Silo room', 'view', { simple: true, view: 'harvest' }),
        can('movement') && tile('loads', 'Load report', 'sheet', { simple: true }),
        can('movement') && tile('trace', 'Traceability', 'sheet'),
        can('storage') && tile('optimiser', 'Silo blending', 'sheet'),
        can('storage') && tile('calculator', 'Silo calculator', 'sheet'),
      ],
    },
    {
      title: 'Exports',
      tiles: [
        can('settings') && tile('excel', 'Excel exports', 'sheet'),
        BOOKS.includes(role) && tile('xero', 'Xero', 'sheet'),
      ],
    },
  ];
  return groups
    .map((g) => ({ title: g.title, tiles: g.tiles.filter(Boolean).map((t) => ({ ...t, fav: favs ? favs.includes(t.id) : !!t.simple })).filter((t) => full || t.fav) }))
    .filter((g) => g.tiles.length > 0);
}

/** The name of a report, for the line under the title when it is open. */
export function reportTitle(view) {
  return ({ yield: 'Yield', harvest: 'Harvest progress', fert: 'Fert', seed: 'Seed', modules: 'Modules' })[view] || '';
}

/** A line picture for each tile (24 by 24, drawn in the tile's colour). From the Tabler icon set (MIT licence, tabler.io/icons). */
export const TILE_ICONS = {
  yield: '<path d="M2 9a10 10 0 1 0 20 0"/><path d="M12 19a10 10 0 0 1 10 -10"/><path d="M2 9a10 10 0 0 1 10 10"/><path d="M12 4a9.7 9.7 0 0 1 2.99 7.5"/><path d="M9.01 11.5a9.7 9.7 0 0 1 2.99 -7.5"/>',
  harvest: '<path d="M7 15m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M7 15l0 .01"/><path d="M19 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M10.5 17l6.5 0"/><path d="M20 15.2v-4.2a1 1 0 0 0 -1 -1h-6l-2 -5h-6v6.5"/><path d="M18 5h-1a1 1 0 0 0 -1 1v4"/>',
  fert: '<path d="M9 3l6 0"/><path d="M10 9l4 0"/><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"/>',
  seed: '<path d="M12 10a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3"/><path d="M12 14a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3"/><path d="M12 20l0 -10"/>',
  map: '<path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13"/><path d="M9 4v13"/><path d="M15 7v13"/>',
  modules: '<path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/><path d="M16 5.25l-8 4.5"/>',
  rotation: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  averages: '<path d="M4 19l16 0"/><path d="M4 15l4 -6l4 2l4 -5l4 4"/>',
  prices: '<path d="M3 17l6 -6l4 4l8 -8"/><path d="M14 7l7 0l0 7"/>',
  deliveries: '<path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M16 3l0 4"/><path d="M8 3l0 4"/><path d="M4 11l16 0"/><path d="M8 15h2v2h-2z"/>',
  calculator: '<path d="M4 3m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M8 7m0 1a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v1a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1z"/><path d="M8 14l0 .01"/><path d="M12 14l0 .01"/><path d="M16 14l0 .01"/><path d="M8 17l0 .01"/><path d="M12 17l0 .01"/><path d="M16 17l0 .01"/>',
  optimiser: '<path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4z"/><path d="M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5"/>',
  position: '<path d="M3 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 8m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20l14 0"/>',
  mtm: '<path d="M4 19l16 0"/><path d="M4 15l4 -6l4 2l4 -5l4 4"/><path d="M4 11l16 0" stroke-dasharray="2 2"/>',
  owed: '<path d="M7 9m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M14 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 9v-2a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h2"/>',
  eofy: '<path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4"/><path d="M18 14v4h4"/><path d="M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M15 3v4"/><path d="M7 3v4"/><path d="M3 11h16"/>',
  room: '<path d="M3 21v-13l9 -4l9 4v13"/><path d="M13 13h4v8h-10v-6h6"/><path d="M13 21v-9a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v3"/>',
  loads: '<path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5"/>',
  trace: '<path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M7 8l0 8"/><path d="M9 18h6a2 2 0 0 0 2 -2v-5"/><path d="M14 14l3 -3l3 3"/>',
  excel: '<path d="M12.5 21h-7.5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v7.5"/><path d="M3 10h18"/><path d="M10 3v18"/><path d="M16 19h6"/><path d="M19 16l3 3l-3 3"/>',
  xero: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M11.5 21h-4.5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v5m-5 6h7m-3 -3l3 3l-3 3"/>',
};
