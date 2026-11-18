// The Modules report as a PDF: where the picked modules are, paddock by paddock. The report's own figures (modulesreport.js) go in;
// nothing is worked out again here. Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=369';

const n0 = (v) => fixed(v, 0);

const fieldName = (r) => (r.field ? r.field.name : 'Not from a recorded move');

export const GINNED_COLUMNS = [
  { head: 'Field', w: 0.3, left: true, cell: (r) => fieldName(r) },
  { head: 'Modules', w: 0.14, cell: (r) => n0(r.modules) },
  { head: 'Bales', w: 0.14, cell: (r) => n0(r.bales) },
  { head: 'Avg module kg', w: 0.24, cell: (r) => n0(r.avgKg) },
  { head: 'Turnout', w: 0.18, cell: (r) => (r.turnoutPct > 0 ? fixed(r.turnoutPct, 1) + '%' : '-') },
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
  if (report.ginned && report.ginned.rows.length) {
    pdf.heading('Already ginned');
    pdf.table(GINNED_COLUMNS, report.ginned.rows, { total: { field: { name: 'Total' }, ...report.ginned.totals }, name: 'Ginned' });
    pdf.note('Modules are taken from the yard in the order they arrived, so a run that mixed paddocks is shared between them by module weight.');
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
