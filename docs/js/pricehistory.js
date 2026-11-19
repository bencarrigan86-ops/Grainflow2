// Price history: the weekly price of a commodity, and optional grade spreads (protein spreads on wheat, for example).
//
// Kept on the commodity as a list, one entry a week: { week: '2026-11-16', price: 335, spreads: [{ grade: 'H1', adjust: 40 }] }.
// The week is the Monday it starts on. A spread is a $ a tonne on top of the commodity's price for that grade (negative below it),
// the same shape a contract's grade list uses. Pure, with no imports but the grade list cleaner.

import { cleanGradeOptions } from './gradeprice.js?v=433';

const p2 = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(n * 100) / 100;

/** The Monday of the week a date (YYYY-MM-DD) is in, as YYYY-MM-DD; '' if it is not a date. */
export function weekStart(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return '';
  const back = (d.getUTCDay() + 6) % 7;   // Monday is 0
  d.setUTCDate(d.getUTCDate() - back);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** The list as it is saved: a week and a price on each, one entry a week (the last one wins), oldest first. */
export function cleanHistory(list) {
  const byWeek = new Map();
  for (const e of Array.isArray(list) ? list : []) {
    const week = weekStart(e?.week);
    const price = Number(e?.price);
    if (!week || !Number.isFinite(price) || price < 0) continue;
    const spreads = cleanGradeOptions(e?.spreads);
    byWeek.set(week, { week, price: round2(price), ...(spreads.length ? { spreads } : {}) });
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export const hasHistory = (list) => cleanHistory(list).length > 0;

/** The list with this date's week set to the price (and spreads), replacing the week if it is already there. */
export function recordPrice(list, { date, price, spreads } = {}) {
  const week = weekStart(date);
  const p = Number(price);
  if (!week || !Number.isFinite(p) || p < 0) return cleanHistory(list);
  return cleanHistory([...cleanHistory(list).filter((e) => e.week !== week), { week, price: p, spreads }]);
}

/** The spreads of the latest week that had any: they carry over until they are changed. */
export function latestSpreads(list) {
  const rows = cleanHistory(list).filter((e) => e.spreads?.length);
  return rows.length ? rows[rows.length - 1].spreads : [];
}

/** The last entry, or null. */
export function latestEntry(list) {
  const rows = cleanHistory(list);
  return rows.length ? rows[rows.length - 1] : null;
}

/**
 * One series from several lists (a commodity's list in each season it appears in): a week in two lists takes the later list's.
 * Oldest first.
 */
export function mergedSeries(lists) {
  const all = [];
  for (const l of lists || []) all.push(...cleanHistory(l));
  return cleanHistory(all);
}

/** The commodities that have a history, merged across seasons by name (ignoring case): [{ name, series }], in the order first met. */
export function seriesByCommodity(years) {
  const byName = new Map();
  for (const y of years || []) {
    for (const c of y?.commodities || []) {
      const name = String(c.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name, lists: [] });
      byName.get(key).lists.push(c.priceHistory);
    }
  }
  return [...byName.values()]
    .map((x) => ({ name: x.name, series: mergedSeries(x.lists) }))
    .filter((x) => x.series.length > 0);
}

/** The rows for the table, newest first: the price, and the change from the entry before it (null for the first). */
export function weekRows(series, n = 8) {
  const rows = cleanHistory(series);
  return rows.map((e, i) => ({ ...e, change: i > 0 ? round2(e.price - rows[i - 1].price) : null })).reverse().slice(0, n);
}

/** The change from n weeks back to the latest entry: { change, weeks } using the oldest entry inside that stretch; null with fewer than two. */
export function changeOver(series, weeks = 4) {
  const rows = cleanHistory(series);
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const cutoff = new Date(`${last.week}T00:00:00Z`).getTime() - weeks * 7 * 86400000;
  const from = rows.find((e) => new Date(`${e.week}T00:00:00Z`).getTime() >= cutoff && e !== last) || rows[rows.length - 2];
  const span = Math.round((new Date(`${last.week}T00:00:00Z`).getTime() - new Date(`${from.week}T00:00:00Z`).getTime()) / (7 * 86400000));
  return { change: round2(last.price - from.price), weeks: span };
}

/**
 * The points of the line for the chart, the last `n` entries spread across the width: [{ x, y, week, price }].
 * A flat series is drawn in the middle. The vertical range has a little room above and below.
 */
export function chartPoints(series, { n = 12, width = 220, height = 90, pad = 8 } = {}) {
  const rows = cleanHistory(series).slice(-n);
  if (rows.length === 0) return [];
  const prices = rows.map((r) => r.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo;
  return rows.map((r, i) => ({
    week: r.week,
    price: r.price,
    x: rows.length === 1 ? width / 2 : round2(pad + (i * (width - 2 * pad)) / (rows.length - 1)),
    y: span === 0 ? height / 2 : round2(pad + ((hi - r.price) * (height - 2 * pad)) / span),
  }));
}

/** Who may set a week's prices (it also sets the price unsold grain is valued at). */
export const canSetPrices = (role) => ['owner', 'manager'].includes(role);

/** Grade names to offer on wheat when it has none yet. */
export const WHEAT_GRADES = ['H1', 'APW1', 'ASW1'];
export const isWheat = (name) => /wheat/i.test(String(name || ''));
