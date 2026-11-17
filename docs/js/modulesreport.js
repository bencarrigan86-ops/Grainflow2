// Where the modules are: picked on each paddock, still in the field, carted to the gin yard, and ginned.
//
// Pure functions over the farm's records. The screen (views/reports.js) and the PDF (modulespdf.js) both draw from this.

import { hasGin, hasModules, cleanGin, stdBales } from './ginning.js?v=367';
import { pickedTotals } from './modulespicked.js?v=367';
import { storageLedgerStock } from './derived.js?v=367';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * One row for each paddock with modules picked or carted, and the farm's totals, the gin yards, and the loads still waiting for
 * the gin's weighbridge weight.
 *
 * `kg` and `bales` are the best weight and bales known for the paddock's modules: the weighbridge weight of the loads weighed at the
 * gin yard, the estimate for loads not yet weighed, and the estimate entered at picking for the modules still in the field.
 * `weighedKg` is the part of `kg` that has been weighed.
 */
export function modulesReport({ fields = [], movements = [], storages = [] } = {}) {
  const rows = [];
  for (const f of fields) {
    if (f.deleted) continue;
    const t = pickedTotals(f, movements);
    if (!(t.picked > 0) && !(t.moved > 0)) continue;
    let weighedKg = 0;
    let loadKg = 0;
    let loadBales = 0;
    for (const m of movements) {
      if (!hasModules(m) || !(m.froms || []).some((l) => l.type === 'field' && l.id === f.id)) continue;
      if (m.weightStatus === 'final') weighedKg += num(m.modules.kg); else loadKg += num(m.modules.kg);
      loadBales += num(m.modules.estBales);
    }
    const avgKg = t.picked > 0 ? t.kg / t.picked : 0;
    const kg = weighedKg + loadKg + avgKg * t.inField;
    rows.push({
      field: f, picked: t.picked, inField: t.inField, moved: t.moved,
      kg, weighedKg, weighedPct: kg > 0 ? weighedKg / kg : 0, pickedKg: t.kg,
      avgKg: t.inField + t.moved > 0 ? kg / (t.inField + t.moved) : 0,
      estBales: loadBales + t.inFieldBales, inFieldBales: t.inFieldBales,
    });
  }
  rows.sort((a, b) => String(a.field.name).localeCompare(String(b.field.name), 'en', { numeric: true }));
  const totals = rows.reduce((s, r) => ({
    picked: s.picked + r.picked, inField: s.inField + r.inField, moved: s.moved + r.moved, kg: s.kg + r.kg, estBales: s.estBales + r.estBales,
    inFieldBales: s.inFieldBales + r.inFieldBales, weighedKg: s.weighedKg + r.weighedKg,
  }), { picked: 0, inField: 0, moved: 0, kg: 0, estBales: 0, inFieldBales: 0, weighedKg: 0 });
  totals.weighedPct = totals.kg > 0 ? totals.weighedKg / totals.kg : 0;
  totals.avgKg = totals.inField + totals.moved > 0 ? totals.kg / (totals.inField + totals.moved) : 0;

  // the gin yards: tally storages that modules were carted into or ginned out of
  const ids = new Set();
  for (const m of movements) {
    if (hasModules(m)) (m.tos || []).forEach((l) => l.type === 'silo' && ids.add(l.id));
    if (hasGin(m)) (m.froms || []).forEach((l) => l.type === 'silo' && ids.add(l.id));
  }
  const yards = storages.filter((s) => ids.has(s.id) && s.kind === 'tally' && !s.deleted).map((s) => {
    let ginned = 0;
    for (const m of movements) {
      if (!hasGin(m)) continue;
      const out = (m.froms || []).filter((l) => l.type === 'silo' && l.id === s.id).reduce((a, l) => a + num(l.tons), 0);
      ginned += out;
    }
    return { storage: s, inYard: storageLedgerStock(s, movements), ginned };
  });

  const ginned = ginnedByField({ fields, movements });
  const waiting = movements.filter((m) => hasModules(m) && m.weightStatus !== 'final');
  const pending = { loads: waiting.length, modules: waiting.reduce((s, m) => s + num(m.modules.count), 0), ids: waiting.map((m) => m.id) };
  return { rows, totals, yards, pending, ginned };
}

/**
 * What has been ginned, paddock by paddock: modules, standard bales, the average module weight and the turnout.
 *
 * A ginning run takes its modules from the yard, which holds modules from more than one paddock, and the run does not say which.
 * So they are taken in the order they reached the yard (first in, first ginned). A run's weight and bales are shared between
 * the paddocks it took modules from by the weight of the modules taken. Modules ginned beyond what was carted in are listed as
 * "Not from a recorded move".
 *
 * @returns {{rows: object[], totals: object}} rows have field (null for the unrecorded), modules, kg, lintKg, bales, avgKg, turnoutPct
 */
export function ginnedByField({ fields = [], movements = [] } = {}) {
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
  const loads = movements.map((m, i) => ({ m, i })).filter((x) => hasModules(x.m)).sort((a, b) => byDate(a.m, b.m) || a.i - b.i);
  const runs = movements.map((m, i) => ({ m, i })).filter((x) => hasGin(x.m)).sort((a, b) => byDate(a.m, b.m) || a.i - b.i);
  const queues = new Map();   // yard id -> [{ fieldId, left, kgEach }]
  for (const { m } of loads) {
    const yard = (m.tos || []).find((l) => l.type === 'silo')?.id;
    const from = (m.froms || []).find((l) => l.type === 'field')?.id || null;
    const count = num(m.modules.count);
    if (!yard || !(count > 0)) continue;
    if (!queues.has(yard)) queues.set(yard, []);
    queues.get(yard).push({ fieldId: from, left: count, kgEach: num(m.modules.kg) / count });
  }
  const acc = new Map();   // field id (or '') -> totals
  const add = (fieldId, d) => {
    const k = fieldId || '';
    const a = acc.get(k) || { modules: 0, kg: 0, lintKg: 0, bales: 0 };
    a.modules += d.modules; a.kg += d.kg; a.lintKg += d.lintKg; a.bales += d.bales;
    acc.set(k, a);
  };
  for (const { m } of runs) {
    const g = cleanGin(m.gin);
    const yard = (m.froms || []).find((l) => l.type === 'silo')?.id;
    const n = num(g.modules) || (m.froms || []).filter((l) => l.type === 'silo').reduce((s, l) => s + num(l.tons), 0);
    if (!(n > 0)) continue;
    const q = queues.get(yard) || [];
    const taken = [];   // [{ fieldId, n, estKg }]
    let need = n;
    while (need > 0 && q.length) {
      const head = q[0];
      const take = Math.min(need, head.left);
      taken.push({ fieldId: head.fieldId, n: take, estKg: take * head.kgEach });
      head.left -= take; need -= take;
      if (head.left <= 1e-9) q.shift();
    }
    if (need > 0) taken.push({ fieldId: null, n: need, estKg: 0 });
    const estTotal = taken.reduce((s, t) => s + t.estKg, 0);
    const bales = stdBales(g.lintKg, g.stdBaleKg);
    const runKg = num(g.moduleKg) || estTotal;   // the gin's module weight, or what the loads were estimated at
    for (const t of taken) {
      // a share of the run by the weight of the modules taken; by count when no module weights are known
      const share = estTotal > 0 ? t.estKg / estTotal : t.n / n;
      add(t.fieldId, { modules: t.n, kg: runKg * share, lintKg: num(g.lintKg) * share, bales: bales * share });
    }
  }
  const rows = [...acc.entries()].map(([id, a]) => ({
    field: id ? (fields.find((f) => f.id === id) || { id, name: 'Deleted paddock' }) : null,
    ...a, avgKg: a.modules > 0 ? a.kg / a.modules : 0, turnoutPct: a.kg > 0 ? (a.lintKg / a.kg) * 100 : 0,
  })).sort((a, b) => (a.field ? 0 : 1) - (b.field ? 0 : 1) || String(a.field?.name || '').localeCompare(String(b.field?.name || ''), 'en', { numeric: true }));
  const sum = rows.reduce((s, r) => ({ modules: s.modules + r.modules, kg: s.kg + r.kg, lintKg: s.lintKg + r.lintKg, bales: s.bales + r.bales }), { modules: 0, kg: 0, lintKg: 0, bales: 0 });
  return { rows, totals: { ...sum, avgKg: sum.modules > 0 ? sum.kg / sum.modules : 0, turnoutPct: sum.kg > 0 ? (sum.lintKg / sum.kg) * 100 : 0 } };
}
