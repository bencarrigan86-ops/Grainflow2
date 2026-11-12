// Contracts that run across the turn of a season.
//
// A contract belongs to the season it was made in, and a truck ticket can only be
// delivered against a contract in the season the app is showing. So a 2025 contract
// with grain still to go cannot be delivered in 2026 unless it exists there too.
//
// Bringing it across makes a 2026 contract for the tonnes still to deliver, on the same
// price and terms. The 2025 contract is left exactly as it was: it was counted in full in
// 2025, which is what keeps the 2025 figures true. To stop 2026 counting the same income
// again, the tonnes still to deliver and their value can also be added to the opening
// stock — and the opening-stock line on the Position tab takes that value off.
//
// Pure: it works out what to offer and what the copy looks like. The screen asks the
// person which contracts to bring, and storage.js writes them.

import { saleEconomics } from './derived.js';

export const CARRY_MARK = 'Carried from';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** The season before the one being shown: the latest label that sorts earlier. */
export function previousYear(labels, current) {
  const earlier = [...(labels || [])].filter((y) => y < current).sort();
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/**
 * The previous season's contracts that still have grain to deliver, with what is
 * already known about whether they have been brought across.
 *
 * @param {{sales: object[], movements: object[], commodities: object[]}} prev
 * @param {{sales: object[], commodities: object[]}} cur
 * @param {string} prevLabel
 */
export function carryCandidates(prev, cur, prevLabel) {
  const out = [];
  for (const sale of prev?.sales || []) {
    const econ = saleEconomics(sale, prev.movements || []);
    const toGo = round3(econ.tonsDue);
    if (!(toGo > 0.05)) continue;

    const commodity = (prev.commodities || []).find((c) => c.id === sale.commodityId);
    const target = (cur?.commodities || []).find((c) => norm(c.name) === norm(commodity?.name));
    const alike = (cur?.sales || []).filter((s) => norm(s.buyer) === norm(sale.buyer)
      && norm(s.contractNo) === norm(sale.contractNo) && (s.commodityId === target?.id));
    const brought = alike.find((s) => String(s.notes ?? '').startsWith(`${CARRY_MARK} ${prevLabel}`));

    out.push({
      sale,
      commodityName: commodity?.name ?? 'No commodity',
      targetCommodityId: target?.id ?? null,
      contracted: Number(sale.tons) || 0,
      delivered: round3(econ.tonsDelivered),
      toGo,
      priceExFarm: econ.priceExFarm,
      value: toGo * econ.priceExFarm,
      // what the previous season marked this commodity at when it closed: the price its unsold
      // grain was valued at, and so what to compare the contract price with
      closingMtm: Number(commodity?.mtmPrice) || 0,
      alreadyBrought: !!brought,
      possibleDuplicate: !brought && alike.length > 0,
      problem: target ? null : `There is no ${commodity?.name ?? 'matching'} commodity in the new season to put it under.`,
    });
  }
  return out;
}

/** The note on the 2026 contract, then whatever the 2025 one already said. */
export function carriedNote(prevLabel, sale, tons) {
  const head = `${CARRY_MARK} ${prevLabel}: ${round3(tons)} t still to deliver of ${round3(sale.tons)} t contracted.`;
  return sale.notes ? `${head}\n${sale.notes}` : head;
}

/** What is added to the 2025 contract's notes, so it shows where its tonnes went. */
export function carriedIntoNote(curLabel, tons, date) {
  return `Carried into ${curLabel}: ${round3(tons)} t, on ${date}.`;
}

/**
 * The new season's copy of a contract: every term as it was, for the tonnes still to go,
 * with nothing yet delivered. Documents are not copied, and nothing that identifies the
 * old record is.
 */
export function buildCarriedSale(sale, { commodityId, tons, prevLabel }) {
  const copy = {};
  for (const [k, v] of Object.entries(sale)) {
    if (k === 'id' || k === 'documents' || k.startsWith('__')) continue;
    copy[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return {
    ...copy,
    commodityId,
    tons: round3(tons),
    tonsDelivered: 0,
    notes: carriedNote(prevLabel, sale, tons),
  };
}

/**
 * What bringing one contract across changes in the opening stock, depending on whether its
 * grain is already counted there.
 *
 * - 'value': the tonnes are already in the opening stock (it was a stocktake of what is in the
 *   silos, which includes grain committed to contracts). Nothing is added to the tonnes. The
 *   value changes by the difference between the contract price and the closing MTM the stock was
 *   valued at, on those tonnes — committed grain is worth the contract price, not the market.
 * - 'add': the tonnes are not in the opening stock (it was worked out as unsold grain only). The
 *   tonnes are added, with their value at the contract price.
 * - 'none': the opening stock is not touched.
 *
 * @param {{tons: number, priceExFarm: number, closingMtm: number}} p
 * @returns {{tons: number, value: number}}
 */
export function openingChange(p, mode) {
  const tons = Number(p.tons) || 0;
  if (mode === 'add') return { tons, value: tons * (Number(p.priceExFarm) || 0) };
  if (mode === 'value') return { tons: 0, value: tons * ((Number(p.priceExFarm) || 0) - (Number(p.closingMtm) || 0)) };
  return { tons: 0, value: 0 };
}

/** What bringing a set of contracts across adds to each commodity's opening stock. */
export function openingEffect(picks) {
  const by = new Map();
  for (const p of picks) {
    if (!p.commodityId) continue;
    const cur = by.get(p.commodityId) || { tons: 0, value: 0 };
    cur.tons += Number(p.tons) || 0;
    cur.value += Number(p.value) || 0;
    by.set(p.commodityId, cur);
  }
  return by;
}

/** Add a line to a note without losing what is there. */
export const appendNote = (existing, line) => (existing ? `${existing}\n${line}` : line);
