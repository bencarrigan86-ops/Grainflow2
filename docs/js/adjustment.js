// Adjustment notes: a correction to an invoice already issued, with a number of its own.
//
// When the buyer's recipient created tax invoice (RCTI) comes to a different total than ours, the invoice is not rewritten
// (it has been sent, and may be in the buyer's books). An adjustment note records the difference instead: it names the
// invoice it adjusts, says why, and carries a signed amount. Negative means the buyer owes less (a credit); positive means
// they owe more. A note is kept as a record in the invoices list, marked kind 'adjustment', so it is saved, synced, backed
// up and deleted the same way and needs nothing new in the database. It has no invoice number (those stay a plain
// unbroken run for tax invoices); it has a note number of its own, AN-1, AN-2, and so on.
//
// A note can also be applied to its invoice (the usual choice): the invoice then carries a line for the adjustment and its
// totals come to the corrected amount, so the invoice itself agrees with the RCTI. The note is then marked as applied, and
// is settled from the start: its amount is already in the invoice total, so it must not be counted a second time in what
// the buyer owes.
//
// Pure: the views read and write the data.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

/** Is this record an adjustment note and not a tax invoice? */
export const isAdjustment = (inv) => inv?.kind === 'adjustment';

/** 'AN-3', the note's own number. */
export const noteLabel = (inv) => `AN-${inv?.noteNo ?? ''}`;

/** What to call a record in a list: 'Invoice #12' or 'Adjustment note AN-3'. */
export const invoiceLabel = (inv) => (isAdjustment(inv) ? `Adjustment note ${noteLabel(inv)}` : `Invoice #${inv?.invoiceNo ?? ''}`);

/** The short reference: '#12' or 'AN-3'. */
export const refLabel = (inv) => (isAdjustment(inv) ? noteLabel(inv) : (inv?.invoiceNo != null && inv.invoiceNo !== '' ? `#${inv.invoiceNo}` : ''));

/** The notes made against one invoice, oldest first. */
export const adjustmentsFor = (invoices, invoiceId) => (invoices || [])
  .filter((i) => isAdjustment(i) && i.adjustsInvoiceId === invoiceId)
  .sort((a, b) => num(a.noteNo) - num(b.noteNo));

/**
 * The invoice as first issued, what its notes add or take off, and what that makes. A note that was applied to the invoice
 * is already inside the invoice's total, so it is taken back out to find the total as first issued.
 */
export function netPayable(invoice, invoices) {
  const notes = adjustmentsFor(invoices, invoice?.id);
  const adjustments = round2(notes.reduce((s, n) => s + num(n.totalPayable), 0));
  const applied = round2(notes.filter((n) => n.appliedToInvoice).reduce((s, n) => s + num(n.totalPayable), 0));
  const invoiceTotal = round2(num(invoice?.totalPayable) - applied);
  return { invoiceTotal, adjustments, net: round2(invoiceTotal + adjustments), notes };
}

/** The next note number: one past the highest used by any note in the lists given (every season's invoices). */
export function nextNoteNo(invoices) {
  return (invoices || []).reduce((m, i) => (isAdjustment(i) ? Math.max(m, num(i.noteNo)) : m), 0) + 1;
}

/**
 * The adjustment that would make our invoice agree with the buyer's RCTI, or null when no RCTI total is on file or the two
 * agree. The amount is theirs less ours, so an RCTI that is less gives a negative (credit) amount.
 */
export function rctiAdjustment(invoice) {
  const raw = invoice?.rctiTotal;
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))) return null;
  const amount = round2(round2(Number(raw)) - round2(num(invoice.totalPayable)));
  if (amount === 0) return null;
  const no = String(invoice.rctiNo || '').trim();
  return { amount, reason: `Difference against the buyer's RCTI${no ? ` ${no}` : ''}` };
}

const addDays = (iso, days) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days)).toISOString().slice(0, 10);
};

/**
 * A new adjustment note, ready to be saved (the data layer gives it its id and its note number).
 * @param {{original: object, amount: number, gstApplies?: boolean, reason?: string, issueDate: string, paymentTermsDays?: number}} p
 *   amount is the whole adjustment, GST included; negative takes money off what the buyer owes.
 * @returns {object|null} null when the amount is nothing
 */
export function buildAdjustment({ original, amount, gstApplies = true, reason = '', issueDate, paymentTermsDays = 0, applyToInvoice = false }) {
  const total = round2(num(amount));
  if (!total || !original) return null;
  // GST is a tenth of the price, so it is one eleventh of an amount that has the GST in it
  const gst = gstApplies ? round2(total / 11) : 0;
  const subtotalExGST = round2(total - gst);
  const why = String(reason || '').trim() || (total < 0 ? 'Credit' : 'Additional charge');
  return {
    kind: 'adjustment',
    saleId: original.saleId,
    adjustsInvoiceId: original.id,
    adjustsInvoiceNo: original.invoiceNo ?? null,
    reason: why,
    issueDate,
    // applied to the invoice, the amount is in the invoice's own total already, so the note has nothing left to be paid
    ...(applyToInvoice ? { appliedToInvoice: true } : {}),
    // a credit is nothing to be paid, so it has no due date; money the buyer owes is due on the usual terms
    dueDate: total > 0 && !applyToInvoice ? addDays(issueDate, num(paymentTermsDays)) : null,
    lines: [{ date: issueDate, rego: why, description: why, tons: null, movementId: null, rate: null, subtotal: subtotalExGST, isCustom: true }],
    totalTons: 0, subtotalExGST, freightTotal: 0, levies: 0, gst, totalPayable: total,
  };
}

/**
 * What to change on an invoice so it carries a note: a line for the adjustment, and the note's amounts added to its totals.
 * The totals are added to, not worked out again from the lines, because levies are a share of the grain and a difference
 * in levies or freight is no share of anything: the amount typed is the amount the invoice moves by.
 * @returns {{lines: object[], subtotalExGST: number, gst: number, totalPayable: number}} fields to put on the invoice
 */
export function applyAdjustment(invoice, note) {
  const line = {
    date: note.issueDate, rego: noteLabel(note), description: `Adjustment ${noteLabel(note)}: ${note.reason || ''}`.trim(),
    tons: null, movementId: null, rate: null, subtotal: num(note.subtotalExGST), gst: num(note.gst),
    isAdjustmentLine: true, noteId: note.id, noteNo: note.noteNo,
  };
  return {
    lines: [...(invoice.lines || []).filter((l) => l.noteId !== note.id), line],
    subtotalExGST: round2(num(invoice.subtotalExGST) + num(note.subtotalExGST)),
    gst: round2(num(invoice.gst) + num(note.gst)),
    totalPayable: round2(num(invoice.totalPayable) + num(note.totalPayable)),
  };
}

/** The reverse of applyAdjustment: what to change on an invoice when a note that was applied to it is deleted. */
export function withoutAdjustment(invoice, note) {
  const had = (invoice.lines || []).some((l) => l.noteId === note.id);
  if (!had) return {};   // the line is gone already (the invoice was rebuilt), so there is nothing to take back
  return {
    lines: (invoice.lines || []).filter((l) => l.noteId !== note.id),
    subtotalExGST: round2(num(invoice.subtotalExGST) - num(note.subtotalExGST)),
    gst: round2(num(invoice.gst) - num(note.gst)),
    totalPayable: round2(num(invoice.totalPayable) - num(note.totalPayable)),
  };
}
