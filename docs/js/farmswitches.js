// The switches an owner can turn on to change what a role can see or do on their farm.
//
// Every switch is off until the owner turns it on, and a farm with every switch off follows the standard rules. They are kept
// with the farm (the `switches` column of the farm row) and the database enforces the ones that matter, so a switch is not
// only a button the app hides: see supabase/migrations/20261209000000_farm_switches.sql. nav.js reads them for the tabs.
// Pure: no state, no screen.

/**
 * In the order they are shown. `role` is the heading, `key` is what is saved, `label` is the line on the screen and `hint` is the
 * short plain sentence under it.
 */
export const SWITCHES = [
  { key: 'managerSeesPrices', role: 'Managers', label: 'See contract prices',
    hint: 'What each contract pays, so their Position and Sales show money. Off, they see tonnes only.' },
  { key: 'managerSeesOverheads', role: 'Managers', label: "See overheads and the whole farm's profit",
    hint: 'The farm-wide costs set in Settings. Off, a manager sees margin per paddock but not the farm result.' },
  { key: 'workerSeesYields', role: 'Workers', label: 'See yields and tonnes per paddock',
    hint: 'What each paddock produced. Off, a worker sees the paddock list without yields.' },
  { key: 'workerSeesPosition', role: 'Workers', label: 'See the Position tab',
    hint: 'Tonnes produced, sold and unsold. Contract prices stay hidden.' },
  { key: 'driverOwnLoadsOnly', role: 'Drivers', label: 'See only the loads they entered',
    hint: 'Off, a driver sees every load on the farm, as the farm hands over loads between people.' },
];

/** The switches that are on, as a plain object of key -> true/false (anything not exactly true counts as off). */
export function readSwitches(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const s of SWITCHES) if (s.key in raw) out[s.key] = raw[s.key] === true;
  return out;
}

/** The saved switches with one changed. Off is kept as an explicit false, so turning a switch off again reaches the server. */
export function withSwitch(current, key, on) {
  if (!SWITCHES.some((s) => s.key === key)) return readSwitches(current);
  return { ...readSwitches(current), [key]: !!on };
}

/** The headings in order, each with its switches: [{ role, items: [...] }]. */
export function switchGroups() {
  const groups = [];
  for (const s of SWITCHES) {
    let g = groups.find((x) => x.role === s.role);
    if (!g) { g = { role: s.role, items: [] }; groups.push(g); }
    g.items.push(s);
  }
  return groups;
}
