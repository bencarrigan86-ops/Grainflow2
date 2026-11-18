// The Modules report as a PDF: where the picked modules are, paddock by paddock. The report's own figures (modulesreport.js) go in;
// nothing is worked out again here. Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=379';

const n0 = (v) => fixed(v, 0);


/** The grower position, as the gin prints it, in two tables so each fits the page. */
export const GROWER_COLUMNS = [
  { head: 'Field', w: 0.3, left: true, cell: (r) => (r.field ? r.field.name + (r.variety ? ' (' + r.variety + ')' : '') : 'Total') },
  { head: 'Ha', w: 0.12, cell: (r) => n0(r.ha) },
  { head: 'Picked', w: 0.14, cell: (r) => n0(r.picked) },
  { head: 'Loads', w: 0.12, cell: (r) => n0(r.loads) },
  { head: 'To gin', w: 0.16, cell: (r) => n0(r.moved) },
  { head: 'Ginned', w: 0.16, cell: (r) => n0(r.ginnedModules) },
];
export const GROWER_COLUMNS_2 = [
  { head: 'Field', w: 0.3, left: true, cell: (r) => (r.field ? r.field.name : 'Total') },
  { head: 'Avg module kg', w: 0.22, cell: (r) => n0(r.avgKg) },
  { head: '227 kg bales', w: 0.22, cell: (r) => (r.bales > 0 ? fixed(r.bales, 1) : '-') },
  { head: 'Turnout', w: 0.13, cell: (r) => (r.turnoutPct > 0 ? fixed(r.turnoutPct, 1) + '%' : '-') },
  { head: 'Yield', w: 0.13, cell: (r) => (r.yieldBalesHa > 0 ? fixed(r.yieldBalesHa, 1) : '-') },
];

export const MODULES_COLUMNS = [
  { head: 'Field', w: 0.2, left: true, cell: (r) => `${r.field.name}` },
  { head: 'Picked', w: 0.1, cell: (r) => n0(r.picked) },
  { head: 'In field', w: 0.11, cell: (r) => n0(r.inField) },
  { head: 'To gin', w: 0.1, cell: (r) => n0(r.moved) },
  { head: 'Weight kg', w: 0.15, cell: (r) => n0(r.kg) },
  { head: 'Avg module kg', w: 0.14, cell: (r) => n0(r.avgKg) },
  { head: 'Weighed', w: 0.1, cell: (r) => `${Math.round((r.weighedPct || 0) * 100)}%` },
  { head: 'Bales', w: 0.1, cell: (r) => n0(r.estBales) },
];

/** @param {{report: object, business?: string, season?: string, today?: string}} p  report is from modulesReport() */
export function modulesPdf({ report, business = '', season = '', today = '' } = {}) {
  const pdf = createReport({
    title: 'Modules', business, season, today,
    footerNote: 'Weight is the weighbridge weight where a load has been weighed at the gin yard, and the estimate until then.',
  });
  if (!report || !report.rows.length) { pdf.message('Nothing to report yet: log the modules picked on a cotton paddock in Production.'); return pdf.bytes(); }
  const t = report.totals;
  pdf.heading('Where the modules are');
  pdf.table(MODULES_COLUMNS, report.rows, { total: { field: { name: 'Total' }, ...t }, name: 'Modules' });
  if (report.grower && report.grower.length) {
    pdf.heading('Grower position');
    pdf.table(GROWER_COLUMNS, report.grower, { total: { field: null, ...report.growerTotals }, name: 'Grower position' });
    pdf.gap(6);
    pdf.table(GROWER_COLUMNS_2, report.grower, { total: { field: null, ...report.growerTotals }, name: 'Grower position, bales' });
    pdf.note('Laid out as the grower position summary the gin prints. Yield is ginned standard bales a hectare. Modules are taken from the yard in the order they arrived, so a run that mixed paddocks is shared between them by module weight.');
  }
  if (report.yards.length) {
    pdf.heading('Gin yard');
    for (const y of report.yards) {
      pdf.pair(`${y.storage.name}: in the yard now`, `${n0(y.inYard)} modules`, { bold: true });
      pdf.pair(`${y.storage.name}: ginned`, `${n0(y.ginned)} modules`);
    }
  }
  if (report.pending.loads > 0) {
    pdf.gap(4);
    pdf.pair('Loads waiting for the weighbridge weight', `${report.pending.loads} (${n0(report.pending.modules)} modules)`);
  }
  return pdf.bytes();
}
