// The gin invoices a lint buyer pays on the farm's behalf, and taking them off a lint invoice.
//
// A ginning run the lint buyer pays is kept as a bill in Payables (payer 'buyer'). Nothing is taken off any contract automatically:
// when a lint contract is invoiced, the gin invoices still open are listed there, and the person picks which to take off and how much
// of each, so the right amount comes off each contract. What is taken off is a line on the lint invoice (isGinPrepaid, with the
// bill's id), and a bill is open for whatever its invoices have not yet taken.

import { ginInvoice, hasGin, cleanGin, lotsForSale } from './ginning.js?v=469';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** What a gin bill comes to, GST included. */
export const ginBillTotal = (bill) => round2(num(bill?.amount) + num(bill?.gst));

/** The ginning run a bill was made from, if it can be found. */
export const runOfBill = (bill, movements) => (movements || []).find((m) => hasGin(m) && m.gin.payableId === bill?.id) || null;

/** The bill a gin line on an invoice is for: its own, or (an older line) the bill of the run it was made for. */
export const linePayableId = (line, movements) => line?.payableId || (line?.ginRunId ? (movements || []).find((m) => m.id === line.ginRunId)?.gin?.payableId : '') || '';

/**
 * The gin invoices to choose from on a lint invoice.
 *
 * @param {{payables: object[], invoices: object[], movements: object[], sale: object, existingInvoice?: object|null}} src
 * @returns {{payableId: string, label: string, date: string, total: number, takenElsewhere: number, outstanding: number, here: number, forThisContract: boolean}[]}
 *   `outstanding` is what is still open to take off (not counting this invoice); `here` is what this invoice already takes.
 */
export function ginOffsetOptions({ payables = [], invoices = [], movements = [], sale, existingInvoice = null } = {}) {
  const out = [];
  for (const p of payables) {
    if (p.payer !== 'buyer') continue;
    const total = ginBillTotal(p);
    let elsewhere = 0;
    let here = 0;
    for (const inv of invoices) {
      for (const l of inv.lines || []) {
        if (!l.isGinPrepaid || linePayableId(l, movements) !== p.id) continue;
        if (existingInvoice && inv.id === existingInvoice.id) here += num(l.amount); else elsewhere += num(l.amount);
      }
    }
    elsewhere = round2(elsewhere); here = round2(here);
    const outstanding = round2(Math.max(0, total - elsewhere));
    if (!(outstanding > 0.004) && !(here > 0)) continue;
    const run = runOfBill(p, movements);
    out.push({
      payableId: p.id,
      label: [p.supplier || 'Gin', p.reference ? `invoice ${p.reference}` : 'invoice'].join(' '),
      date: p.invoiceDate || '',
      total, takenElsewhere: elsewhere, outstanding, here,
      forThisContract: !!(run && sale && lotsForSale(run, sale.id).length),
    });
  }
  // the ones for this contract first, then oldest first
  return out.sort((a, b) => Number(b.forThisContract) - Number(a.forThisContract) || (a.date || '').localeCompare(b.date || ''));
}

/**
 * The line on a lint invoice that takes `amount` (GST included) off a gin bill: split into the ginning (with its GST), and the levies,
 * in the proportion of the bill, so the accounts can show them as the gin did.
 */
export function ginOffsetLine({ bill, amount, movements = [], sale = null, date = '' }) {
  const total = ginBillTotal(bill);
  const take = round2(Math.max(0, Math.min(num(amount), total)));
  const f = total > 0 ? take / total : 0;
  const gst = round2(num(bill.gst) * f);
  const exGst = round2(take - gst);
  const run = runOfBill(bill, movements);
  const inv = run ? ginInvoice(cleanGin(run.gin)) : null;
  const ginning = inv && inv.exGst > 0 ? round2(exGst * (inv.ginning / inv.exGst)) : exGst;
  return {
    date: bill.invoiceDate || date || sale?.date || '', rego: '—', tons: null, movementId: null, rate: null, subtotal: 0,
    isGinPrepaid: true, payableId: bill.id, ...(run ? { ginRunId: run.id } : {}),
    description: `${bill.supplier || 'Ginning'} invoice ${bill.reference || ''}`.trim(),
    ginning, levies: round2(exGst - ginning), gst, amount: take,
  };
}

/** What the gin lines on a contract's invoices take off, ex GST (what comes off the contract's value), and with GST. */
export function ginTakenOff(invoices = []) {
  let ex = 0;
  let incl = 0;
  let count = 0;
  for (const inv of invoices) {
    for (const l of inv.lines || []) {
      if (!l.isGinPrepaid) continue;
      ex += num(l.ginning) + num(l.levies);
      incl += num(l.amount);
      count += 1;
    }
  }
  return { total: round2(ex), totalInclGst: round2(incl), lines: count };
}

/** Has lint invoices taken the whole of a gin bill off? Then the farm owes the gin nothing, whether or not those invoices are paid yet. */
export function ginBillTakenOff(bill, invoices = [], movements = []) {
  if (bill?.payer !== 'buyer') return false;
  let taken = 0;
  for (const inv of invoices) for (const l of inv.lines || []) if (l.isGinPrepaid && linePayableId(l, movements) === bill.id) taken += num(l.amount);
  return taken > 0 && taken >= ginBillTotal(bill) - 0.05;
}
