// The rules for the two things that cannot be taken back: deleting a whole season, and resetting everything.
//
// One tap and a "Delete" button in a dialog was too easy for either. They now ask the person to read what will go, to
// have a backup in hand, and to type the name of what they are deleting. This file is the rules; views/dangerconfirm.js
// is the sheet. Pure: it counts and compares and touches nothing else.

const HOUR = 60 * 60 * 1000;

/** How recently a backup must have been downloaded on this device for the delete to count as backed up. */
export const BACKUP_FRESH_MS = HOUR;

const LISTS = [
  ['fields', 'paddock', 'paddocks'],
  ['storages', 'silo or bunker', 'silos and bunkers'],
  ['sales', 'contract', 'contracts'],
  ['movements', 'load', 'loads'],
  ['invoices', 'invoice', 'invoices'],
  ['payables', 'bill', 'bills'],
  ['orders', 'grain order', 'grain orders'],
  ['freightOrders', 'freight order', 'freight orders'],
  ['inputStock', 'stock entry', 'stock entries'],
  ['sprayJobs', 'spray request', 'spray requests'],
];

/**
 * What a season holds, as lines to read before it goes: "12 paddocks", "6 contracts" ... Only what is there.
 * @param {object} year one season, data.years[label]
 * @returns {{label: string, count: number}[]}
 */
export function seasonContents(year) {
  const y = year || {};
  return LISTS
    .map(([key, one, many]) => {
      const n = Array.isArray(y[key]) ? y[key].length : 0;
      return { label: n === 1 ? one : many, count: n };
    })
    .filter((r) => r.count > 0);
}

/** The contents as one sentence ("12 paddocks, 6 contracts and 39 loads"), or "nothing in it". */
export function contentsText(contents) {
  const parts = (contents || []).map((r) => `${r.count} ${r.label}`);
  if (!parts.length) return 'nothing in it';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Has a backup been downloaded on this device lately enough? */
export function backedUpRecently(last, now = Date.now()) {
  return !!last && now - last >= 0 && now - last <= BACKUP_FRESH_MS;
}

/** Did they type the name? Ignores capitals and the spaces at either end; nothing else. */
export function typedName(typed, name) {
  const t = String(typed ?? '').trim().toLowerCase();
  return t.length > 0 && t === String(name ?? '').trim().toLowerCase();
}

/** May the delete button be pressed: the name is typed, and a backup is in hand. */
export function mayDelete({ typed, name, backedUp }) {
  return !!backedUp && typedName(typed, name);
}
