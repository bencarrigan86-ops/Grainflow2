// The cotton invoice, laid out like a cotton merchant's recipient created tax invoice: the bale range and count, what the
// bales come to at the price per 227 kg bale, any premiums and discounts, GST, the total due including tax, then the gin
// invoices the buyer prepaid (GST included) taken off, and the total due. Pure: it only reshapes a saved invoice.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

const parse = (no) => { const m = /^(.*?)([0-9]+)$/.exec(String(no ?? '').trim()); return m ? { prefix: m[1].toUpperCase(), n: Number(m[2]), width: m[2].length } : null; };

/**
 * The bale numbers delivered, as ranges: each load's lots put in order, with ranges that run on from each other joined
 * (BG026511 to BG027233 and BG027234 to BG027626 are one range BG026511 to BG027626).
 *
 * @param {{from: string, to: string, bales: number}[]} lots
 * @returns {{from: string, to: string, bales: number}[]}
 */
export function mergeBaleRanges(lots) {
  const list = (lots || [])
    .map((l) => ({ from: String(l.from ?? '').trim(), to: String(l.to ?? '').trim(), bales: num(l.bales), a: parse(l.from), b: parse(l.to) }))
    .filter((l) => l.a && l.b && l.a.prefix === l.b.prefix && l.b.n >= l.a.n)
    .sort((x, y) => x.a.prefix.localeCompare(y.a.prefix) || x.a.n - y.a.n);
  const out = [];
  for (const l of list) {
    const last = out[out.length - 1];
    if (last && last.b.prefix === l.a.prefix && l.a.n === last.b.n + 1) {
      last.b = l.b; last.to = l.to; last.bales += l.bales;
    } else out.push({ ...l });
  }
  return out.map((r) => ({ from: r.from, to: r.to, bales: r.bales }));
}

/** Everything the cotton invoice page shows, worked out from a saved invoice. */
export function cottonInvoiceModel(invoice) {
  const lines = invoice?.lines || [];
  const loads = lines.filter((l) => l.movementId && l.tons != null && l.rate != null);
  // the loads, one row to a price per bale (the bales at each price add up)
  const byRate = new Map();
  for (const l of loads) {
    const key = round2(num(l.rate));
    const row = byRate.get(key) || { rate: key, bales: 0, amount: 0 };
    row.bales += num(l.tons);
    row.amount += num(l.subtotal);
    byRate.set(key, row);
  }
  const rows = [...byRate.values()].map((r) => ({ ...r, amount: round2(r.amount) }));
  const lots = loads.flatMap((l) => (l.baleRanges || []).map((r) => ({ from: r.from, to: r.to, bales: r.bales })));
  const ranges = mergeBaleRanges(lots);
  const premiums = lines.filter((l) => l.isCustom && !l.isAdjustmentLine && num(l.subtotal) !== 0);
  const adjustments = lines.filter((l) => l.isAdjustmentLine);
  // premiums and discounts entered in US$: the US$ total and the rate it was converted at, as the merchant shows them
  const usdLines = premiums.filter((l) => l.foreign && num(l.foreign.rate) > 0);
  const usdTotal = usdLines.length ? round2(usdLines.reduce((s, l) => s + num(l.foreign.usd), 0)) : null;
  const fxRate = usdLines.length ? num(usdLines[0].foreign.rate) : null;
  const gin = lines.filter((l) => l.isGinPrepaid).map((l) => ({ description: l.description || 'Ginning invoice', amount: round2(num(l.amount)) }));
  const ginTotal = round2(gin.reduce((s, g) => s + g.amount, 0));
  const gross = round2(rows.reduce((s, r) => s + r.amount, 0));
  const premiumTotal = round2(premiums.reduce((s, l) => s + num(l.subtotal), 0));
  const adjustmentTotal = round2(adjustments.reduce((s, l) => s + num(l.subtotal), 0));
  const levies = round2(num(invoice?.levies));
  const freight = round2(num(invoice?.freightTotal));
  const dueIncludingTax = round2(num(invoice?.subtotalExGST) + num(invoice?.gst) - levies - freight);
  return {
    rows, gross, ranges, physicalBales: ranges.reduce((s, r) => s + r.bales, 0) || loads.reduce((s, l) => s + num(l.bales), 0),
    stdBales: round2(rows.reduce((s, r) => s + r.bales, 0)),
    premiums, premiumTotal, adjustments, adjustmentTotal, usdTotal, fxRate,
    valueNett: round2(num(invoice?.subtotalExGST)), levies, freight, gst: round2(num(invoice?.gst)),
    dueIncludingTax, gin, ginTotal, totalDue: round2(dueIncludingTax - ginTotal),
  };
}
