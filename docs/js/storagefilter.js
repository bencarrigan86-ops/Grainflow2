// Finding a silo in a long list.
//
// A farm can have forty-odd silos, bunkers and sheds, and the list on the Storage
// tab was something to scroll. This is the search behind the box at the top, and
// the commodity tabs: pure functions over the storage records, so what "13"
// finds can be stated and tested.
//
// The one rule worth knowing is how a number is read. Typing 13 should find silo
// 13, not silo 113 or 130, and typing 3 should find silo 03 and Kot 3 but not
// 13 or 43. So a query that is only digits matches a silo whose name HAS that
// number in it — leading zeros ignored — and only falls back to "the text
// appears somewhere" when no silo has the number.

export const NO_COMMODITY = '__none';

const digitRuns = (name) => String(name ?? '').match(/\d+/g) || [];

/** Natural order, so "2 silo" comes before "13 silo" and "Kot 2" before "Kot 10". */
export const naturalByName = (a, b) =>
  String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Every word typed must appear in the silo's name, commodity, grade or crop year
 * — so "wheat 25/26" finds the wheat silos carried over from last season.
 */
function matchesText(storage, commodityName, query) {
  const hay = [storage.name, commodityName, storage.grade, storage.cropYear].filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

/**
 * @param {object[]} storages
 * @param {{id: string, name: string}[]} commodities
 * @param {string} query
 * @returns {object[]} the storages that match, in their original order
 */
export function searchStorages(storages, commodities, query) {
  const q = String(query ?? '').trim();
  if (!q) return storages;
  const nameOf = (s) => commodities.find((c) => c.id === s.commodityId)?.name ?? '';

  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const byNumber = storages.filter((s) => digitRuns(s.name).some((d) => Number(d) === n));
    if (byNumber.length) return byNumber;
  }
  return storages.filter((s) => matchesText(s, nameOf(s), q));
}

/**
 * One tab per commodity that has silos in the list, with how many, and a last
 * one for silos with no commodity. In the order the commodities are set up.
 */
export function commodityTabs(storages, commodities) {
  const tabs = commodities
    .map((c) => ({ id: c.id, name: c.name, count: storages.filter((s) => s.commodityId === c.id).length }))
    .filter((t) => t.count > 0);
  const none = storages.filter((s) => !commodities.some((c) => c.id === s.commodityId)).length;
  if (none) tabs.push({ id: NO_COMMODITY, name: 'No commodity', count: none });
  return tabs;
}

/** The silos for one tab; an empty tab id means all of them. */
export function filterByTab(storages, commodities, tabId) {
  if (!tabId) return storages;
  if (tabId === NO_COMMODITY) return storages.filter((s) => !commodities.some((c) => c.id === s.commodityId));
  return storages.filter((s) => s.commodityId === tabId);
}

// ---- sorting -----------------------------------------------------------------

export const SORTS = [
  { id: 'newest', label: 'Newest added' },
  { id: 'name', label: 'Name' },
  { id: 'grade', label: 'Grade' },
  { id: 'crop', label: 'Crop year' },
];

const text = (v) => String(v ?? '').trim();
const natural = (a, b) => text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Order silos by newest, name, grade or crop year.
 *
 * Grade and crop year put the silos that have one first and the ones that do not
 * last — a list sorted by grade should start with APH1, not with forty silos
 * nobody has classed yet — and within one grade the silos run in number order.
 * Crop year runs newest season first, because that is the grain you are more
 * likely to be looking for.
 *
 * Returns a new array; the one passed in is not changed.
 */
export function sortStorages(list, mode = 'newest') {
  const byName = (a, b) => naturalByName(a, b);
  const blankLast = (field, dir) => (a, b) => {
    const x = text(a[field]); const y = text(b[field]);
    if (!x && !y) return byName(a, b);
    if (!x) return 1;
    if (!y) return -1;
    return dir * natural(x, y) || byName(a, b);
  };
  const copy = [...list];
  if (mode === 'name') return copy.sort(byName);
  if (mode === 'grade') return copy.sort(blankLast('grade', 1));
  if (mode === 'crop') return copy.sort(blankLast('cropYear', -1));
  return copy.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || byName(a, b));
}

/** The heading a silo sits under when the list is sorted by grade or crop year; null for the other sorts. */
export function sortGroupLabel(storage, mode) {
  if (mode === 'grade') return text(storage.grade) || 'No grade';
  if (mode === 'crop') return text(storage.cropYear) || 'No crop year';
  return null;
}
