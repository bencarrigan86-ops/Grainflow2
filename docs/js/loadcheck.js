// Do the loads in the app say what the weighbridge file says?
//
// Each load in the file is matched to the load in the app by the platform's
// movement number, and compared on the two things that put tonnes against a
// paddock and a silo: where it came from, and how much. Nothing here changes
// anything; it only reports, so a figure that does not match can be traced to
// the load that caused it instead of being argued about in totals.

import { refFromNotes, targetOf } from './loadimport.js';

const num = (v) => Number(v) || 0;
const sum = (legs) => legs.reduce((a, l) => a + num(l.tons), 0);
const isId = (v) => typeof v === 'string' && v !== '' && !v.startsWith('new:') && !v.startsWith('pending:');

/**
 * @param {object[]} loads      loads read from the file
 * @param {object[]} movements  the movements in the app
 * @param {{fields?: object, silos?: object}} maps  file name -> app id, as the import sheet resolves them
 * @returns {{
 *   matched: number, missing: object[], copies: object[], wrongField: object[],
 *   wrongSilo: object[], tonsDiffer: object[],
 *   byField: {id: string, fileTons: number, appTons: number, otherTons: number}[]
 * }}
 */
export function reconcileLoads(loads, movements, maps = {}) {
  const byRef = new Map();
  for (const m of movements) {
    const ref = m.sourceRef || refFromNotes(m.notes);
    if (!ref) continue;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(m);
  }

  const out = { matched: 0, missing: [], copies: [], wrongField: [], wrongSilo: [], tonsDiffer: [], byField: [] };
  const fileTons = new Map();       // app field id -> tonnes the file puts on it
  const inFile = new Set();         // refs the file covers

  for (const load of loads) {
    if (load.problems?.length || !load.ref) continue;
    inFile.add(load.ref);
    const fieldId = targetOf(maps.fields?.[load.field], load.date);
    const siloId = targetOf(maps.silos?.[load.silo], load.date);
    if (isId(fieldId)) fileTons.set(fieldId, (fileTons.get(fieldId) || 0) + num(load.deliveryTons));

    const found = byRef.get(load.ref);
    if (!found) { out.missing.push(load); continue; }
    out.matched += 1;
    if (found.length > 1) out.copies.push({ load, count: found.length });
    const m = found[0];

    const fromField = (m.froms || []).filter((l) => l.type === 'field');
    const toSilo = (m.tos || []).filter((l) => l.type === 'silo');
    if (isId(fieldId) && !(fromField.length === 1 && fromField[0].id === fieldId)) {
      out.wrongField.push({ load, expected: fieldId, actual: fromField.map((l) => ({ id: l.id, tons: num(l.tons) })) });
    }
    if (isId(siloId) && !(toSilo.length === 1 && toSilo[0].id === siloId)) {
      out.wrongSilo.push({ load, expected: siloId, actual: toSilo.map((l) => ({ id: l.id, tons: num(l.tons) })) });
    }
    if (Math.abs(num(m.tons) - num(load.deliveryTons)) > 0.01 || Math.abs(sum(fromField) - num(load.deliveryTons)) > 0.01) {
      out.tonsDiffer.push({ load, loadTons: num(m.tons), legTons: sum(fromField) });
    }
  }

  // What each paddock holds in the app, from every load, against what the file says.
  const appTons = new Map();
  const fromThisFile = new Map();
  for (const m of movements) {
    const ref = m.sourceRef || refFromNotes(m.notes);
    for (const l of m.froms || []) {
      if (l.type !== 'field') continue;
      appTons.set(l.id, (appTons.get(l.id) || 0) + num(l.tons));
      if (ref && inFile.has(ref)) fromThisFile.set(l.id, (fromThisFile.get(l.id) || 0) + num(l.tons));
    }
  }
  const ids = new Set([...fileTons.keys(), ...appTons.keys()]);
  out.byField = [...ids].map((id) => ({
    id,
    fileTons: fileTons.get(id) || 0,
    appTons: appTons.get(id) || 0,
    otherTons: (appTons.get(id) || 0) - (fromThisFile.get(id) || 0),
  })).sort((a, b) => Math.abs((b.appTons - b.fileTons)) - Math.abs((a.appTons - a.fileTons)));
  return out;
}
