// Orders: a buyer asks for grain to be delivered against a contract.
//
// An order belongs to a contract and takes everything about the sale from it: the buyer, the commodity, the grade,
// the price and where it goes. The order itself holds only what changes from one order to the next: how many
// tonnes, the window to deliver in, who is carting it, and the buyer's own order number.
//
// A load is matched to an order by choosing the order on the movement (movement.orderId). What has been delivered
// against an order is those loads' tonnes into its contract; what is left is the order's tonnes less that. An order
// is open until its tonnes are all delivered or someone closes it (the buyer cancelled it, or took less).
//
// Pure: the screens and the storage layer use it; it touches neither.

import { movementTonsToSale } from './derived.js?v=240';

export const STATUSES = ['open', 'closed'];

// An order whose window ends within this many days is flagged as due soon.
export const SOON_DAYS = 3;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round3 = (n) => Math.round(n * 1000) / 1000;
// Whole days from one 'YYYY-MM-DD' to another; null if either is not a date.
export function daysBetween(from, to) {
  const a = Date.parse(`${String(from || '').slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to || '').slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

/** Tonnes delivered against an order: the loads that name it, as what they put into its contract. */
export function deliveredAgainst(order, movements) {
  if (!order?.id) return 0;
  return round3((movements || [])
    .filter((m) => m.orderId === order.id)
    .reduce((s, m) => s + movementTonsToSale(order.saleId, [m]), 0));
}

/**
 * Where an order stands.
 *
 *   state  closed    someone closed it
 *          filled    all its tonnes are delivered
 *          overdue   still owed, and the window has ended
 *          soon      still owed, and the window ends within SOON_DAYS days
 *          upcoming  still owed, and the window has not opened
 *          open      still owed, inside its window (or with no window)
 *   active  true while it can still take loads (not closed, not filled)
 *
 * @param {string} today 'YYYY-MM-DD'
 */
export function orderState(order, movements, today) {
  const ordered = num(order?.tons);
  const delivered = deliveredAgainst(order, movements);
  const left = Math.max(0, round3(ordered - delivered));
  const filled = ordered > 0 && delivered >= ordered - 0.005;
  let state = 'open';
  if (order?.status === 'closed') state = 'closed';
  else if (filled) state = 'filled';
  else if (order?.deliverBy && String(order.deliverBy) < String(today)) state = 'overdue';
  else if (order?.deliverBy && daysBetween(today, order.deliverBy) <= SOON_DAYS) state = 'soon';
  else if (order?.deliverFrom && String(order.deliverFrom) > String(today)) state = 'upcoming';
  return {
    ordered, delivered, left,
    over: Math.max(0, round3(delivered - ordered)),
    pct: ordered > 0 ? Math.min(1, delivered / ordered) : 0,
    state,
    active: state !== 'closed' && state !== 'filled',
  };
}

export const STATE_LABEL = {
  open: 'Open', soon: 'Due soon', overdue: 'Overdue', upcoming: 'Not yet', filled: 'Filled', closed: 'Closed',
};

/** The orders that still have grain owed, gathered: how many, and how many tonnes are still to go. */
export function summarise(orders, movements, today) {
  const out = { open: { count: 0, left: 0 }, overdue: { count: 0, left: 0 }, soon: { count: 0, left: 0 } };
  for (const o of orders || []) {
    const s = orderState(o, movements, today);
    if (!s.active) continue;
    out.open.count += 1; out.open.left += s.left;
    if (s.state === 'overdue') { out.overdue.count += 1; out.overdue.left += s.left; }
    if (s.state === 'soon') { out.soon.count += 1; out.soon.left += s.left; }
  }
  for (const b of Object.values(out)) b.left = round3(b.left);
  return out;
}

/**
 * The orders a load into a contract can be put against: those still open, soonest deadline first, with no deadline
 * last. `keepId` is an order the load is already against, which stays on the list even if it has since filled or
 * closed, so editing an old ticket never loses it.
 */
export function ordersForLoad(saleId, orders, movements, today, keepId = null) {
  return (orders || [])
    .filter((o) => o.saleId === saleId && (o.id === keepId || orderState(o, movements, today).active))
    .sort((a, b) => String(a.deliverBy || '9999').localeCompare(String(b.deliverBy || '9999'))
      || String(a.deliverFrom || '').localeCompare(String(b.deliverFrom || '')));
}

/** "3 Dec to 20 Dec", "from 3 Dec", "by 20 Dec", or '' when the order has no window. `fmt` formats one date. */
export function windowText(order, fmt) {
  const from = order?.deliverFrom ? fmt(order.deliverFrom) : '';
  const by = order?.deliverBy ? fmt(order.deliverBy) : '';
  if (from && by) return `${from} to ${by}`;
  if (from) return `from ${from}`;
  if (by) return `by ${by}`;
  return '';
}

/** What to call an order in a list: the buyer's number if there is one, with its tonnes. */
export const orderTitle = (order) => [order?.orderNo ? `#${order.orderNo}` : 'Order', order?.tons ? `${num(order.tons)} t` : ''].filter(Boolean).join(' · ');
