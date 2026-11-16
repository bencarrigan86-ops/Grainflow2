// Which part of the year a commodity is harvested in, so harvest progress can be read for winter crops and summer crops apart.
//
// Sorghum is cut months after wheat, so "80% of everything" can be 95% of the winter crops with the summer crops still standing. The
// commodity's name says which it is; a commodity the list does not know is left out of both (shown as "Other") rather than guessed.

const WINTER = [
  'wheat', 'barley', 'canola', 'chickpea', 'faba', 'field pea', 'lentil', 'lupin', 'oat', 'vetch', 'durum', 'triticale', 'rye',
  'linseed', 'mustard', 'peas',
];
const SUMMER = [
  'sorghum', 'cotton', 'maize', 'corn', 'mungbean', 'mung bean', 'soybean', 'soy bean', 'sunflower', 'millet', 'rice', 'peanut',
  'navy bean', 'cowpea', 'lablab', 'panicum', 'sesame',
];

/** The seasons in the order the report shows them. */
export const HARVEST_SEASONS = [
  { key: 'winter', label: 'Winter crops' },
  { key: 'summer', label: 'Summer crops' },
  { key: 'other', label: 'Other' },
];

const has = (name, words) => words.some((w) => name.includes(w));

/**
 * 'winter', 'summer', or 'other' for a commodity (or a name). A season chosen on the commodity itself (`harvestSeason`) wins; otherwise
 * its name decides, and a name with a word from both lists is not guessed.
 * @param {{name?: string, harvestSeason?: string}|string|null|undefined} commodity
 */
export function harvestSeasonOf(commodity) {
  const chosen = typeof commodity === 'string' ? '' : String(commodity?.harvestSeason ?? '');
  if (chosen === 'winter' || chosen === 'summer') return chosen;
  const name = String((typeof commodity === 'string' ? commodity : commodity?.name) ?? '').toLowerCase();
  if (!name) return 'other';
  if (name.includes('fallow')) return 'fallow';   // no crop to harvest: in none of the seasons
  const w = has(name, WINTER);
  const s = has(name, SUMMER);
  if (w && !s) return 'winter';
  if (s && !w) return 'summer';
  return 'other';
}

/** What the automatic choice comes to for a name, in words for the commodity form. */
export function autoSeasonText(name) {
  const s = harvestSeasonOf(String(name ?? ''));
  if (!String(name ?? '').trim()) return 'from its name';
  return s === 'winter' ? 'winter crop' : s === 'summer' ? 'summer crop' : s === 'fallow' ? 'left out, nothing to cut' : 'not sorted: shown as Other';
}
