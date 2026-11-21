// The Modules report as a PDF: where the picked modules are, paddock by paddock. The report's own figures (modulesreport.js) go in;
// nothing is worked out again here. Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=500';

const n0 = (v) => fixed(v, 0);


/** The grower position, as the gin prints it (without the variety, irrigated and loads columns), with the modules still in the field and those at the gin not yet ginned. */
export const GROWER_COLUMNS = [
  { head: 'Field', w: 0.17, left: true, cell: (r) => (r.field ? r.field.name : 'Total') },
  { head: 'Ha', w: 0.06, cell: (r) => n0(r.ha) },
  { head: 'Picked', w: 0.08, cell: (r) => n0(r.picked) },
  { head: 'In field', w: 0.08, cell: (r) => n0(r.inField) },
  { head: 'Delivered', w: 0.09, cell: (r) => n0(r.moved) },
  { head: 'At gin', w: 0.07, cell: (r) => n0(r.inYard) },
  { head: 'Avg kg', w: 0.075, cell: (r) => n0(r.avgKg) },
  { head: 'Ginned', w: 0.075, cell: (r) => n0(r.ginnedModules) },
  { head: '227 kg bales', w: 0.11, cell: (r) => (r.bales > 0 ? fixed(r.bales, 1) : '-') },
  { head: 'Turnout %', w: 0.09, cell: (r) => (r.turnoutPct > 0 ? fixed(r.turnoutPct, 1) : '-') },
  { head: 'Yield', w: 0.07, cell: (r) => (r.yieldBalesHa > 0 ? fixed(r.yieldBalesHa, 1) : '-') },
];

/** @param {{report: object, business?: string, season?: string, today?: string}} p  report is from modulesReport() */
export function modulesPdf({ report, business = '', season = '', today = '' } = {}) {
  const pdf = createReport({
    title: 'Modules', business, season, today,
    footerNote: 'Weights are the weighbridge weight where a load has been weighed at the gin yard, and an estimate until then.',
  });
  if (!report || !report.rows.length) { pdf.message('Nothing to report yet: log the modules picked on a cotton paddock in Production.'); return pdf.bytes(); }
  const s = report.summary;
  pdf.heading('Summary');
  pdf.pair('Modules picked', n0(s.picked));
  pdf.pair('Still in the field', n0(s.inField));
  pdf.pair('At the gin, not yet ginned', n0(s.inYard));
  pdf.pair('Ginned', n0(s.ginnedModules));
  pdf.pair('Bales ginned (227 kg)', fixed(s.ginnedBales, 1));
  pdf.pair('Turnout', s.turnoutPct > 0 ? fixed(s.turnoutPct, 1) + '%' : '-');
  pdf.pair('Total expected bales', n0(s.expectedBales), { bold: true });
  pdf.gap(6);
  pdf.heading('Grower position');
  pdf.table(GROWER_COLUMNS, report.grower, { total: { field: null, ...report.growerTotals }, name: 'Grower position' });
  pdf.note('Laid out as the grower position summary the gin prints. Yield is ginned standard bales a hectare. Modules are taken from the yard in the order they arrived, so a run that mixed paddocks is shared between them by module weight. Total expected bales is the bales ginned plus the modules still in the field and the yard, at their average weight and turnout.');
  if (report.pending.loads > 0) pdf.pair('Loads waiting for the weighbridge weight', `${report.pending.loads} (${n0(report.pending.modules)} modules)`);
  return pdf.bytes();
}
