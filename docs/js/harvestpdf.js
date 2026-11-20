// The Harvest report as a PDF: how much is in and how much is still to come, the room left in the silos, and each commodity's
// paddocks. A role that is not shown yields gets the version with no tonnes: hectares cut and left, paddocks finished and the
// room in the silos, as on the screen. The report's own figures (harvest.js) go in; nothing is worked out again here.
// Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=479';
import { roomSummary } from './harvest.js?v=479';

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
 * @param {{groups: object[], farm: object, seasons?: object[], space: object, minRoom?: number, nameOf: (id: string) => string, showYield?: boolean,
 *          business?: string, season?: string, today?: string}} p
 *   groups and farm are from harvestReport(), space from siloSpace()
 * @returns {Uint8Array} the PDF
 */
export function harvestPdf({ groups = [], farm = {}, seasons = [], scopeLabel = '', split = null, space = {}, minRoom = 0, nameOf = () => '', showYield = true, business = '', season = '', today = '' } = {}) {
  const report = createReport({
    title: 'Harvest', business, season, today,
    footerNote: showYield
      ? 'In is the tonnes carted off the field; to come is its estimate less that, until the field is finished.'
      : 'Hectares cut and left, and the available storage. Third-party storage is not counted.',
  });
  if (!groups.length) { report.message('Nothing to report yet: add a paddock in Production.'); return report.bytes(); }

  // ---- the whole farm ----
  report.heading(scopeLabel || 'Whole farm');
  if (showYield) {
    report.pair('Harvested', `${t0(farm.inT)} t`);
    report.pair('Still to harvest', `${t0(farm.toComeT)} t`);
    report.pair('Done', pct(farm.pct), { bold: true });
    report.pair('Left to harvest', `${t0(farm.toGoHa)} ha`);
  } else {
    report.pair('Cut', `${t0(farm.doneHa)} ha`);
    report.pair('Left to harvest', `${t0(farm.toGoHa)} ha`);
    report.pair('Of the area done', haPct(farm.doneHa, farm.areaHa), { bold: true });
  }
  report.pair('Paddocks finished', `${farm.doneFields} of ${farm.fields}${showYield ? ` · ${t0(farm.doneHa)} of ${t0(farm.areaHa)} ha` : ''}`);
  // by when the crops are cut, so a summer crop still standing does not hide how far through the winter crops are
  if (seasons.length > 1) {
    report.gap(4);
    for (const s of seasons) {
      const t = s.totals;
      const done = showYield ? pct(t.pct) : haPct(t.doneHa, t.areaHa);
      report.pair(`${s.label} (${s.names.join(', ')})`, `${done} ${showYield ? 'in' : 'cut'} · ${t0(t.doneHa)} of ${t0(t.areaHa)} ha`);
    }
  }
  report.gap(8);

  // ---- the room in the silos ----
  report.heading('Available storage');
  if (minRoom > 0) report.note(`Silos with less than ${t0(minRoom)} t of room are left out.`);
  // crop by crop, so room in a silo of a crop with nothing left to cut is not read as room for what is coming
  if (split && split.rows.length) {
    report.table([
      { head: 'Commodity', w: 0.28, left: true, cell: (r) => r.name },
      { head: 'Silos', w: 0.1, cell: (r) => String(r.silos) },
      { head: 'Room t', w: 0.16, cell: (r) => t0(r.room) },
      { head: showYield ? 'To come t' : 'To cut ha', w: 0.18, cell: (r) => (r.finished ? 'All cut' : t0(showYield ? r.toComeT : r.toGoHa)) },
      { head: showYield ? 'Space t' : '', w: 0.28, cell: (r) => (showYield ? `${r.space > 0.5 ? '+' : (r.space < -0.5 ? '-' : '')}${t0(Math.abs(r.space))}${r.nothingToCome && r.room > 0.5 ? ' (none to come)' : ''}` : (r.finished && r.room > 0.5 ? 'No use now' : '')) },
    ], split.rows, { name: 'By crop' });
  }
  // what is still to harvest, then the room that can take it, then the answer; the room that cannot help is a note
  const sum = roomSummary(split, space, showYield);
  if (showYield) report.pair('Still to harvest', `${t0(sum.stillT)} t`, { bold: true });
  report.pair(`In silos of crops still to ${showYield ? 'harvest' : 'cut'}${sum.cropSilos ? ` (${sum.cropSilos})` : ''}`, `${t0(sum.cropUsable)} t`);
  report.pair(`In empty silos (${sum.emptyCount}), for any grain`, `${t0(sum.emptyRoom)} t`);
  report.pair('Available storage space', `${t0(sum.canTake)} t`, { bold: true });
  if (showYield) report.pair(sum.margin >= 0 ? 'Room to spare' : 'Short of room by', `${t0(Math.abs(sum.margin))} t`, { bold: true });
  if (sum.unusable > 0.5) report.note(`Another ${t0(sum.unusable)} t of room is in silos of crops with ${showYield ? 'little or nothing left to harvest' : 'every hectare already cut'}, so it can't take what is left unless a silo is emptied.`);
  if ((space.silos || []).length) {
    report.table([
      { head: 'Silo', w: 0.26, left: true, cell: (s) => s.name },
      { head: 'Commodity', w: 0.3, left: true, cell: (s) => (s.empty ? (s.assumed ? `Empty, as ${space.assumeName}` : 'Empty, any grain') : nameOf(s.commodityId)) },
      { head: 'Stock t', w: 0.14, cell: (s) => t0(s.stock) },
      { head: 'Capacity t', w: 0.15, cell: (s) => t0(s.capacity) },
      { head: 'Room t', w: 0.15, cell: (s) => t0(s.room) },
    ], split ? [...split.rows.flatMap((c) => c.list), ...split.empty] : space.silos, { name: 'Silos' });
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
