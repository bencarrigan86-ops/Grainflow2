// Xero export: the sales invoices and the bills as CSV files in Xero's own import layout.
//
// Xero imports an invoice as one row per line, repeating the invoice's details on each. A grain invoice becomes a line
// per load (tonnes at that load's rate), a line for any adjustment, and, where the buyer takes them off, a line each for
// the levies and the freight, as negative amounts that carry no GST: that is how the app works its total (GST on the grain
// only), so the invoice in Xero comes to what the app says is payable. A bill is one line at its amount before GST.
//
// Pure: the sheet (views/xero.js) supplies the data and downloads the files.

import { invoiceTotals } from './derived.js?v=242';
import { kindLabel } from './payables.js?v=242';
import { emailIn } from './vendordec.js?v=242';
import { toCSV } from './csv.js?v=242';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const clean = (v) => String(v ?? '').trim();

/** Xero's invoice import columns, in its order. */
export const XERO_COLUMNS = [
  '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry',
  '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount',
  '*AccountCode', '*TaxType', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme',
];

/** The account codes in a new Xero file (Xero's standard chart). Changed in the sheet to the farm's own. */
export const DEFAULT_CODES = { sales: '200', brokerage: '429', freight: '425', storage: '429', other: '429' };

const TAX = { income: 'GST on Income', free: 'BAS Excluded', expense: 'GST on Expenses', expenseFree: 'GST Free Expenses' };

/** 'YYYY-MM-DD' as Xero reads it: DD/MM/YYYY. */
export const xeroDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/** The first 1 July on or before `today`. */
export const financialYearStart = (today) => {
  const y = Number(String(today).slice(0, 4));
  return `${String(today).slice(5, 10) >= '07-01' ? y : y - 1}-07-01`;
};

const inRange = (date, from, to) => !date || ((!from || date >= from) && (!to || date <= to));

const blankRow = () => Object.fromEntries(XERO_COLUMNS.map((c) => [c, '']));

/**
 * The sales invoices dated from `from` to `to`, as Xero rows.
 * @returns {{rows: object[], count: number, warnings: string[]}}
 */
export function xeroInvoices({ invoices = [], sales = [], commodities = [], from = '', to = '', codes = DEFAULT_CODES }) {
  const rows = [];
  const warnings = [];
  let count = 0;
  const chosen = invoices.filter((i) => inRange(i.issueDate, from, to))
    .sort((a, b) => String(a.issueDate || '').localeCompare(String(b.issueDate || '')) || num(a.invoiceNo) - num(b.invoiceNo));
  for (const inv of chosen) {
    const sale = sales.find((s) => s.id === inv.saleId);
    const commodity = commodities.find((c) => c.id === sale?.commodityId)?.name || '';
    const lines = inv.lines || [];
    const totals = inv.subtotalExGST !== undefined && inv.levies !== undefined && inv.freightTotal !== undefined
      ? { levies: num(inv.levies), freightTotal: num(inv.freightTotal) }
      : invoiceTotals(sale || {}, lines);
    const buyer = clean(sale?.buyer);
    if (!buyer) warnings.push(`Invoice ${inv.invoiceNo ?? ''} has no buyer name`);
    if (!inv.issueDate) warnings.push(`Invoice ${inv.invoiceNo ?? ''} has no date; it is dated ${to || 'today'}`);
    const head = {
      '*ContactName': buyer || 'Unknown buyer',
      EmailAddress: emailIn(sale?.buyerContact),
      '*InvoiceNumber': inv.invoiceNo ?? '',
      Reference: clean(sale?.contractNo),
      '*InvoiceDate': xeroDate(inv.issueDate || to),
      '*DueDate': xeroDate(inv.dueDate || inv.issueDate || to),
      Currency: 'AUD',
    };
    const add = (description, qty, unit, account, tax) => rows.push({ ...blankRow(), ...head, '*Description': description, '*Quantity': qty, '*UnitAmount': unit, '*AccountCode': account, '*TaxType': tax });

    for (const l of lines) {
      const tons = num(l.tons);
      if (tons > 0 && l.rate !== null && l.rate !== undefined) {
        const bits = [commodity || 'Grain', l.ticketNo ? `ticket ${l.ticketNo}` : (l.rego && l.rego !== '—' ? l.rego : ''), l.date ? xeroDate(l.date) : '', clean(l.grade)].filter(Boolean);
        add(bits.join(' '), round4(tons), round4(num(l.rate)), codes.sales, TAX.income);
      } else if (num(l.subtotal) !== 0) {
        add(clean(l.description || l.rego) || 'Adjustment', 1, round2(num(l.subtotal)), codes.sales, TAX.income);
      }
    }
    if (num(totals.levies) > 0) add('Grain levies deducted', 1, -round2(totals.levies), codes.sales, TAX.free);
    if (num(totals.freightTotal) > 0) add('Freight deducted by buyer', 1, -round2(totals.freightTotal), codes.sales, TAX.free);
    count += 1;
  }
  return { rows, count, warnings };
}

/**
 * The bills dated from `from` to `to`, as Xero rows (one line each, at the amount before GST).
 * @returns {{rows: object[], count: number, warnings: string[]}}
 */
export function xeroBills({ payables = [], from = '', to = '', codes = DEFAULT_CODES }) {
  const rows = [];
  const warnings = [];
  const chosen = payables.filter((p) => inRange(p.invoiceDate, from, to))
    .sort((a, b) => String(a.invoiceDate || '').localeCompare(String(b.invoiceDate || '')));
  for (const p of chosen) {
    const amount = round2(num(p.amount));
    const gst = round2(num(p.gst));
    const supplier = clean(p.supplier);
    if (!supplier) warnings.push(`A ${kindLabel(p.kind).toLowerCase()} bill${p.reference ? ` (${p.reference})` : ''} has no supplier name`);
    if (!p.invoiceDate) warnings.push(`A ${kindLabel(p.kind).toLowerCase()} bill${supplier ? ` from ${supplier}` : ''} has no date; it is dated ${to || 'today'}`);
    if (gst > 0 && Math.abs(gst - round2(amount * 0.1)) > 0.02) warnings.push(`${supplier || 'A bill'}${p.reference ? ` ${p.reference}` : ''}: the GST is not 10% of the amount, and Xero works it out at 10%`);
    const date = p.invoiceDate || to;
    const code = codes[p.kind] || codes.other;
    rows.push({
      ...blankRow(),
      '*ContactName': supplier || 'Unknown supplier',
      '*InvoiceNumber': clean(p.reference) || `${kindLabel(p.kind)} ${xeroDate(date)}`,
      '*InvoiceDate': xeroDate(date),
      '*DueDate': xeroDate(p.dueDate || date),
      '*Description': [kindLabel(p.kind), clean(p.notes)].filter(Boolean).join(' - '),
      '*Quantity': 1, '*UnitAmount': amount,
      '*AccountCode': code, '*TaxType': gst > 0 ? TAX.expense : TAX.expenseFree,
      Currency: 'AUD',
    });
  }
  return { rows, count: rows.length, warnings };
}

/** Xero rows as the CSV text of a file Xero will import. */
export const xeroCsv = (rows) => toCSV(rows, XERO_COLUMNS.map((c) => ({ label: c, get: (r) => r[c] })));
