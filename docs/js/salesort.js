// How the contracts on the Sales tab are ordered within each commodity. Pure apart from the remembered choice, which is a
// per-device convenience and never needed (the list works without it).

import { saleEconomics } from './derived.js?v=425';

export const SALE_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'delivery', label: 'Delivery due soonest' },
  { value: 'togo', label: 'Most tonnes to go' },
  { value: 'buyer', label: 'Buyer A to Z' },
  { value: 'value', label: 'Biggest value' },
];

export const DEFAULT_SALE_SORT = 'newest';
const KEY = 'gf.saleSort';

export const isSaleSort = (v) => SALE_SORTS.some((s) => s.value === v);

const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');

/** The date a contract is next due to be delivered by: the end of its window, else the start; '' when it has neither. */
const dueDate = (s) => s.deliveryEnd || s.deliveryStart || '';

/** A copy of the contracts in the order asked for; contracts with nothing to order by go last, newest first among themselves. */
export function sortSales(sales, sort, movements = []) {
  const list = [...sales];
  if (sort === 'delivery') {
    return list.sort((a, b) => {
      const x = dueDate(a);
      const y = dueDate(b);
      if (x && y) return x.localeCompare(y) || byDateDesc(a, b);
      if (x) return -1;
      if (y) return 1;
      return byDateDesc(a, b);
    });
  }
  if (sort === 'buyer') {
    return list.sort((a, b) => {
      const x = (a.buyer || '').trim();
      const y = (b.buyer || '').trim();
      if (x && y) return x.localeCompare(y, undefined, { sensitivity: 'base' }) || byDateDesc(a, b);
      if (x) return -1;
      if (y) return 1;
      return byDateDesc(a, b);
    });
  }
  if (sort === 'togo') {
    const due = new Map(list.map((s) => [s.id, Math.max(0, saleEconomics(s, movements).tonsDue)]));
    return list.sort((a, b) => due.get(b.id) - due.get(a.id) || byDateDesc(a, b));
  }
  if (sort === 'value') {
    const value = new Map(list.map((s) => [s.id, saleEconomics(s, movements).totalValue]));
    return list.sort((a, b) => value.get(b.id) - value.get(a.id) || byDateDesc(a, b));
  }
  return list.sort(byDateDesc);
}

export function readSaleSort() {
  try {
    const v = localStorage.getItem(KEY);
    return isSaleSort(v) ? v : DEFAULT_SALE_SORT;
  } catch { return DEFAULT_SALE_SORT; }
}

export function saveSaleSort(value) {
  try { localStorage.setItem(KEY, value); } catch { /* the choice just is not remembered */ }
}
