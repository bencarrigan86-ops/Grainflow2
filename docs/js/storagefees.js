// What a third-party store charges to hold the farm's grain, worked out month by month.
//
// Every site bills differently, so the terms are set per location: a $/t per month rate on the tonnes held (counted at
// each month end, or averaged over the days of the month), an optional date up to which storage is free, and optional
// flat $/t charges for grain received and grain taken out. The tonnes held on any day come from the same records that
// give the location's balance (the opening holdings and the loads in and out), so nothing is typed twice.
//
// It is an estimate to plan with and to check the site's bill against: where a storage bill has been recorded in
// Payables against the location it is shown beside the month's estimate. Amounts are ex GST. Pure.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOr = (v) => (DATE.test(String(v ?? '').trim()) ? String(v).trim() : '');

export const BASES = [
  { value: 'month_end', label: 'Tonnes held at the end of each month' },
  { value: 'average', label: 'Average tonnes held through the month' },
];

/**
 * The fee terms as they are saved, or null when no charge is set.
 * @returns {{monthlyRate: number, basis: 'month_end'|'average', freeUntil: string, from: string, receivalRate: number, outturnRate: number}|null}
 */
export function cleanFee(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {
    monthlyRate: round4(Math.max(0, num(v.monthlyRate))),
    basis: v.basis === 'average' ? 'average' : 'month_end',
    freeUntil: dateOr(v.freeUntil),
    from: dateOr(v.from),
    receivalRate: round4(Math.max(0, num(v.receivalRate))),
    outturnRate: round4(Math.max(0, num(v.outturnRate))),
  };
  return out.monthlyRate > 0 || out.receivalRate > 0 || out.outturnRate > 0 ? out : null;
}

/** The terms in a line: "$1.50/t a month on the tonnes at month end, free until 30-04-2027; $2.00/t in, $1.00/t out". */
export function feeTermsText(fee, showDate = (d) => d) {
  const f = cleanFee(fee);
  if (!f) return 'No storage charge set';
  const money = (n) => `$${n.toFixed(2)}`;
  const parts = [];
  if (f.monthlyRate > 0) parts.push(`${money(f.monthlyRate)}/t a month on the tonnes ${f.basis === 'average' ? 'averaged through the month' : 'at month end'}${f.freeUntil ? `, free until ${showDate(f.freeUntil)}` : ''}`);
  if (f.receivalRate > 0) parts.push(`${money(f.receivalRate)}/t in`);
  if (f.outturnRate > 0) parts.push(`${money(f.outturnRate)}/t out`);
  return `${parts.join('; ')}${f.from ? `. Counted from ${showDate(f.from)}` : ''}`;
}

const legTons = (legs, id) => (legs || []).filter((l) => l.type === 'silo' && l.id === id).reduce((a, l) => a + num(l.tons), 0);
const monthOf = (d) => d.slice(0, 7);
const daysIn = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const nextMonth = (month) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const dayOf = (month, d) => `${month}-${String(d).padStart(2, '0')}`;
const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};

/**
 * The estimated storage charge for each month.
 *
 * @param {object} location  an off-farm storage: `offFarm.opening` (what it held at the start) and `offFarm.fee`
 * @param {object[]} movements
 * @param {object[]} payables  bills; a storage bill with this location's id is set beside its month (by invoice date)
 * @param {{today: string}} opts  'YYYY-MM-DD'; the current month is estimated for the whole month at today's tonnes
 * @returns {{terms: object|null, months: {month: string, label: string, current: boolean, heldEnd: number, avgHeld: number,
 *            storage: number, receival: number, outturn: number, estimate: number, billed: number|null, difference: number|null}[],
 *            totals: {estimate: number, billed: number}}}
 */
export function storageFeesByMonth(location, movements, payables, { today = '' } = {}) {
  const terms = cleanFee(location?.offFarm?.fee);
  const empty = { terms, months: [], totals: { estimate: 0, billed: 0 } };
  const now = dateOr(today);
  if (!location || !now) return empty;

  // the tonnes in and out of the location, by day
  const events = new Map();
  for (const m of movements || []) {
    const d = dateOr(m.date);
    if (!d) continue;
    const into = legTons(m.tos, location.id);
    const out = legTons(m.froms, location.id);
    if (!into && !out) continue;
    const e = events.get(d) || { into: 0, out: 0 };
    e.into += into; e.out += out;
    events.set(d, e);
  }
  const opening = (location.offFarm?.opening || []).reduce((a, o) => a + num(o.tons), 0);

  const bills = (payables || []).filter((p) => p.kind === 'storage' && p.storageId === location.id && dateOr(p.invoiceDate));
  const billedBy = new Map();
  for (const p of bills) billedBy.set(monthOf(p.invoiceDate), round2((billedBy.get(monthOf(p.invoiceDate)) || 0) + num(p.amount)));

  const firstEvent = [...events.keys()].sort()[0] || '';
  const start = terms?.from || firstEvent;
  const months = new Set(billedBy.keys());
  if (terms && start) { for (let m = monthOf(start); m <= monthOf(now); m = nextMonth(m)) months.add(m); }
  if (!months.size) return empty;

  const list = [...months].sort();
  // walk day by day from the earliest day that matters, carrying the balance
  const firstDay = [firstEvent, `${list[0]}-01`].filter(Boolean).sort()[0];
  let held = opening;
  const rows = [];
  const dayHeld = new Map();     // 'YYYY-MM-DD' -> tonnes held at the end of that day, only for days in the listed months
  const flows = new Map();       // month -> { into, out } counted from the start of charging
  let day = firstDay;
  const lastMonth = list[list.length - 1];
  const endDay = dayOf(lastMonth, daysIn(lastMonth));
  const wanted = new Set(list);
  while (day <= endDay) {
    const e = events.get(day);
    if (e) held += e.into - e.out;
    const mon = monthOf(day);
    if (wanted.has(mon)) {
      // days after today carry today's balance, which is the best guess; loads dated in the future are still counted
      dayHeld.set(day, held);
      if (e && (!start || day >= start)) {
        const f = flows.get(mon) || { into: 0, out: 0 };
        f.into += e.into; f.out += e.out;
        flows.set(mon, f);
      }
    }
    const [y, m, d] = day.split('-').map(Number);
    const nx = new Date(Date.UTC(y, m - 1, d + 1));
    day = `${nx.getUTCFullYear()}-${String(nx.getUTCMonth() + 1).padStart(2, '0')}-${String(nx.getUTCDate()).padStart(2, '0')}`;
  }

  let totalEst = 0;
  let totalBilled = 0;
  for (const month of list) {
    const n = daysIn(month);
    const monthEnd = dayOf(month, n);
    const chargedDays = [];
    for (let d = 1; d <= n; d += 1) {
      const k = dayOf(month, d);
      if ((!start || k >= start) && (!terms?.freeUntil || k > terms.freeUntil)) chargedDays.push(k);
    }
    const bal = (k) => Math.max(0, dayHeld.get(k) ?? 0);
    const heldEnd = bal(monthEnd);
    const avgHeld = [...Array(n)].reduce((a, _, i) => a + bal(dayOf(month, i + 1)), 0) / n;
    let storage = 0;
    if (terms && terms.monthlyRate > 0) {
      if (terms.basis === 'average') storage = terms.monthlyRate * (chargedDays.reduce((a, k) => a + bal(k), 0) / n);
      else if (chargedDays.includes(monthEnd)) storage = terms.monthlyRate * heldEnd;
    }
    const f = flows.get(month) || { into: 0, out: 0 };
    const receival = terms ? terms.receivalRate * f.into : 0;
    const outturn = terms ? terms.outturnRate * f.out : 0;
    const inRange = !!terms && !!start && month >= monthOf(start);
    const estimate = inRange ? round2(storage + receival + outturn) : 0;
    const billed = billedBy.has(month) ? billedBy.get(month) : null;
    rows.push({
      month, label: monthLabel(month), current: month === monthOf(now),
      heldEnd: round2(heldEnd), avgHeld: round2(avgHeld),
      storage: inRange ? round2(storage) : 0, receival: inRange ? round2(receival) : 0, outturn: inRange ? round2(outturn) : 0,
      estimate, billed, difference: billed === null ? null : round2(billed - estimate),
    });
    totalEst += estimate;
    totalBilled += billed || 0;
  }
  return { terms, months: rows, totals: { estimate: round2(totalEst), billed: round2(totalBilled) } };
}

/** The month's estimate for a location, now: what the card shows. 0 when no charge is set. */
export function thisMonthFee(location, movements, payables, today) {
  const r = storageFeesByMonth(location, movements, payables, { today });
  return r.months.find((m) => m.current)?.estimate ?? 0;
}
