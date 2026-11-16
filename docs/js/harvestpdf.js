// The Harvest report as a PDF: how much is in and how much is still to come, the room left in the silos, and each commodity's
// paddocks. A role that is not shown yields gets the version with no tonnes: hectares cut and left, paddocks finished and the
// room in the silos, as on the screen. The report's own figures (harvest.js) go in; nothing is worked out again here.
// Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=310';

const pct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
const haPct = (done, area) => (area > 0 ? `${Math.round((done / area) * 100)}%` : '-');
const t0 = (v) => fixed(v, 0);

/** Columns with yields: estimate, in, still to come, hectares left and how far through. */
export const HARVEST_COLUMNS = [
  { head: 'Field', w: 0.34, left: true, cell: (r) => `${r.field.name}` },
  { head: 'Est t', w: 0.13, cell: (r) => t0(r.estimateT) },
  { head: 'In t', w: 0.13, cell: (r) => t0(r.inT) },
  { head: 'To come t', w: 0.14, cell: (r) => t0(r.toComeT) },
  { head: 'To cut ha', w: 0.13, cell: (r) => (r.done ? '0' : (r.haLeft !== null ? t0(r.haLeft) : '-')) },
  { head: 'Done', w: 0.13, cell: (r) => (r.done ? 'Done' : (r.ahead ? 'Over' : pct(r.pct))) },
];

/** Columns with no tonnes at all. */
export const HARVEST_COLUMNS_NO_YIELD = [
  { head: 'Field', w: 0.4, left: true, cell: (r) => `${r.field.name}` },
  { head: 'Area ha', w: 0.2, cell: (r) => t0(r.areaHa) },
  { head: 'To cut ha', w: 0.2, cell: (r) => (r.done ? '0' : t0(r.haLeft !== null ? r.haLeft : r.areaHa)) },
  { head: 'Done', w: 0.2, cell: (r) => (r.done ? 'Done' : haPct(r.doneHa, r.areaHa)) },
];

/**
 * @param {{groups: object[], farm: object, space: object, minRoom?: number, nameOf: (id: string) => string, showYield?: boolean,
 *          business?: string, season?: string, today?: string}} p
 *   groups and farm are from harvestReport(), space from siloSpace()
 * @returns {Uint8Array} the PDF
 */
export function harvestPdf({ groups = [], farm = {}, space = {}, minRoom = 0, nameOf = () => '', showYield = true, business = '', season = '', today = '' } = {}) {
  const report = createReport({
    title: 'Harvest', business, season, today,
    footerNote: showYield
      ? 'In is the tonnes carted off the field; to come is its estimate less that, until the field is finished.'
      : 'Hectares cut and left, and the room in the silos. Third-party storage is not counted.',
  });
  if (!groups.length) { report.message('Nothing to report yet: add a paddock in Production.'); return report.bytes(); }

  // ---- the whole farm ----
  report.heading('Whole farm');
  if (showYield) {
    report.pair('Harvested', `${t0(farm.inT)} t`);
    report.pair('Still to come', `${t0(farm.toComeT)} t`);
    report.pair('Done', pct(farm.pct), { bold: true });
    report.pair('Left to harvest', `${t0(farm.toGoHa)} ha`);
  } else {
    report.pair('Cut', `${t0(farm.doneHa)} ha`);
    report.pair('Left to harvest', `${t0(farm.toGoHa)} ha`);
    report.pair('Of the area done', haPct(farm.doneHa, farm.areaHa), { bold: true });
  }
  report.pair('Paddocks finished', `${farm.doneFields} of ${farm.fields}${showYield ? ` · ${t0(farm.doneHa)} of ${t0(farm.areaHa)} ha` : ''}`);
  report.gap(8);

  // ---- the room in the silos ----
  const margin = (space.totalRoom || 0) - (farm.toComeT || 0);
  report.heading('Room in the silos');
  report.pair('In silos already holding a commodity', `${t0((space.totalRoom || 0) - (space.emptyRoom || 0))} t`);
  report.pair(`In empty silos (${space.emptyCount || 0}), for any grain`, `${t0(space.emptyRoom)} t`);
  report.pair('Room left', `${t0(space.totalRoom)} t`, { bold: true });
  if (showYield) {
    report.pair('Still to come', `${t0(farm.toComeT)} t`);
    report.pair(margin >= 0 ? 'Room to spare' : 'Short of room by', `${t0(Math.abs(margin))} t`, { bold: true });
  }
  if (minRoom > 0) report.note(`Silos with less than ${t0(minRoom)} t of room are left out.`);
  if ((space.silos || []).length) {
    report.table([
      { head: 'Silo', w: 0.3, left: true, cell: (s) => s.name },
      { head: 'Holds', w: 0.26, left: true, cell: (s) => (s.empty ? 'Empty, any grain' : nameOf(s.commodityId)) },
      { head: 'Stock t', w: 0.14, cell: (s) => t0(s.stock) },
      { head: 'Capacity t', w: 0.15, cell: (s) => t0(s.capacity) },
      { head: 'Room t', w: 0.15, cell: (s) => t0(s.room) },
    ], space.silos, { name: 'Silos' });
  }
  if ((space.notCounted || []).length) report.note(`Not counted: ${space.notCounted.join('; ')}.`);
  report.note('Third-party storage is not counted. An empty silo can take any grain, so it is counted once, in the empty silos, and not under each commodity.');
  report.gap(6);

  // ---- each commodity ----
  groups.forEach((g) => {
    const own = g.id && space.byCommodity ? space.byCommodity.get(g.id) : null;
    report.heading(showYield
      ? `${g.name}   ${pct(g.totals.pct)} in`
      : `${g.name}   ${haPct(g.totals.doneHa, g.totals.areaHa)} cut`);
    const total = showYield
      ? { name: 'Total', ...g.totals, field: { name: '' }, done: false, ahead: false, haLeft: g.totals.toGoHa }
      : { name: 'Total', ...g.totals, field: { name: '' }, done: false, haLeft: g.totals.toGoHa };
    report.table(showYield ? HARVEST_COLUMNS : HARVEST_COLUMNS_NO_YIELD, g.rows, { total, name: g.name });
    report.pair('Hectares finished', `${t0(g.totals.doneHa)} of ${t0(g.totals.areaHa)} ha`);
    if (g.id) report.pair(`Room in its silos (${own ? own.silos : 0})`, `${t0(own ? own.room : 0)} t`);
    report.gap(8);
  });
  return report.bytes();
}
