// Import a receiving site's delivery file (GrainCorp or similar) and match it to the loads that went there.
//
// A guided sheet: choose the file, say which column is which (once: the owner can save the layout for next time), see how every row
// matched, then apply. Nothing is saved until the last step. The reading and the rules are in deliveryimport.js, where they are
// tested; this file is the screen.

import { db } from '../storage.js?v=469';
import { openSheet, closeSheet, notify, toast, field, getVal } from '../ui.js?v=469';
import { esc, num, shortDate, todayLocal, dmy } from '../fmt.js?v=469';
import {
  readTable, guessMapping, mappingProblems, extractRows, matchDeliveries, deliveryPatch, makeFormat, saveFormat, removeFormat, findFormat, DELIVERY_FIELDS,
} from '../deliveryimport.js?v=469';
import { seasonYY } from '../outloadno.js?v=469';

const isOwner = () => db.getRole() === 'owner';

export function openDeliveryImportSheet() {
  openSheet('Import site deliveries', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Choose the delivery file (CSV) from the receiving site. Each row is matched to a
        load by the ticket number the driver quoted, and the site's weight and quality are put on the load. You see how every row
        matched before anything is saved.</div>
      <input type="file" id="di-file" accept=".csv,.txt,text/csv" />
      <div id="di-body" style="margin-top:14px"></div>`;
    root.querySelector('#di-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      let text;
      try { text = await file.text(); } catch { notify('That file could not be read.'); return; }
      begin(root.querySelector('#di-body'), text);
    });
  });
}

/** A file arrives: a saved layout that fits it opens straight away; otherwise the person says which column is which. */
function begin(body, text) {
  const table = readTable(text);
  if (!table.headers.length || !table.rows.length) { body.innerHTML = '<div class="empty">That file has no deliveries in it.</div>'; return; }
  const saved = findFormat(db.getBusinessDetails().importFormats, table.headers);
  if (saved && !mappingProblems(saved.mapping, table.headers).length) {
    review(body, text, { mapping: saved.mapping, units: saved.units, dateOrder: saved.dateOrder, headerRow: saved.headerRow, layout: saved.name });
  } else {
    showMapping(body, text, { headerRow: 0, mapping: null, units: 'auto', dateOrder: 'dmy', name: saved?.name || '' });
  }
}

/** "Which column is which": the one screen a new kind of file needs. */
function showMapping(body, text, start) {
  const table = readTable(text, { headerRow: start.headerRow });
  const mapping = start.mapping || guessMapping(table.headers);
  const sample = (header) => {
    const at = table.headers.indexOf(header);
    if (at < 0) return '';
    const hit = table.rows.find((r) => String(r[at] ?? '').trim() !== '');
    return hit ? String(hit[at]).trim() : '';
  };
  const options = [{ value: '', label: '— not in this file —' }, ...table.headers.map((h) => ({ value: h, label: h }))];
  const row = (f) => field({
    label: `${f.label}${f.required ? ' *' : ''}`, id: `di-${f.key}`, type: 'select', value: mapping[f.key] || '', options,
    hint: mapping[f.key] && sample(mapping[f.key]) ? `For example: ${esc(sample(mapping[f.key]))}` : '',
  });
  const main = DELIVERY_FIELDS.filter((f) => ['outloadNo', 'netTons', 'grossTons', 'tareTons', 'date'].includes(f.key));
  const rest = DELIVERY_FIELDS.filter((f) => !main.includes(f));
  const formats = db.getBusinessDetails().importFormats || [];

  body.innerHTML = `
    <div class="card">
      <h2>Match this file's columns</h2>
      <div class="field hint" style="margin-bottom:8px">Say which column is which. It has been filled in from the headings; check it, and change what is wrong.
        The weights need a net weight, or a gross and a tare to work it out from.</div>
      ${field({ label: 'The column headings are on row', id: 'di-headerrow', type: 'number', step: '1', value: start.headerRow + 1, hint: 'Row 1 unless the file has lines above the table.' })}
      ${main.map(row).join('')}
      <details class="fold"><summary><div><h2>Grade, quality, truck and the rest</h2><div class="sub">What the site measured, and what checks the match</div></div></summary>
        ${rest.map(row).join('')}
      </details>
      <div class="grid-2">
        ${field({ label: 'Weights are in', id: 'di-units', type: 'select', value: start.units || 'auto', options: [
          { value: 'auto', label: 'Work it out' }, { value: 't', label: 'Tonnes' }, { value: 'kg', label: 'Kilograms' }] })}
        ${field({ label: 'Dates are written', id: 'di-order', type: 'select', value: start.dateOrder || 'dmy', options: [
          { value: 'dmy', label: 'Day / Month / Year' }, { value: 'mdy', label: 'Month / Day / Year' }, { value: 'ymd', label: 'Year / Month / Day' }] })}
      </div>
      ${isOwner() ? field({ label: 'Save this layout as (optional)', id: 'di-name', value: start.name || '', placeholder: 'e.g. GrainCorp receivals',
        hint: 'A saved layout opens straight away the next time a file with these headings comes, for everyone on the farm.' })
        : '<div class="field hint">Only the owner can save a layout for the farm.</div>'}
      <div id="di-problem"></div>
      <button class="btn" id="di-read">Read the file</button>
      ${isOwner() && formats.length ? `<hr class="sep" /><div class="field hint">Saved layouts:</div>
        ${formats.map((f) => `<div class="row"><span class="label">${esc(f.name)}</span><span class="value"><button type="button" class="btn secondary small" data-drop-format="${esc(f.name)}">Remove</button></span></div>`).join('')}` : ''}
    </div>`;

  // a different header row changes which headings there are: read again
  body.querySelector('#di-headerrow').addEventListener('change', (e) => {
    const at = Math.max(1, Math.round(Number(e.target.value) || 1)) - 1;
    showMapping(body, text, { ...start, headerRow: at, mapping: null, units: getVal(body, 'di-units'), dateOrder: getVal(body, 'di-order'), name: getVal(body, 'di-name') || '' });
  });
  body.querySelectorAll('[data-drop-format]').forEach((el) => el.addEventListener('click', () => {
    db.updateBusinessDetails({ importFormats: removeFormat(db.getBusinessDetails().importFormats, el.dataset.dropFormat) });
    showMapping(body, text, start);
  }));
  body.querySelector('#di-read').addEventListener('click', () => {
    const chosen = {};
    for (const f of DELIVERY_FIELDS) { const v = getVal(body, `di-${f.key}`); if (v) chosen[f.key] = v; }
    const problems = mappingProblems(chosen, table.headers);
    if (problems.length) { body.querySelector('#di-problem').innerHTML = `<div class="hint" style="color:var(--danger);margin-bottom:6px">${problems.map(esc).join('<br>')}</div>`; return; }
    const setup = { mapping: chosen, units: getVal(body, 'di-units'), dateOrder: getVal(body, 'di-order'), headerRow: table.headerRow };
    const name = isOwner() ? (getVal(body, 'di-name') || '').trim() : '';
    if (name) {
      try { db.updateBusinessDetails({ importFormats: saveFormat(db.getBusinessDetails().importFormats, makeFormat({ name, ...setup })) }); toast('Layout saved'); }
      catch (e) { notify(`The layout could not be saved.\n\n${e.message}`); }
    }
    review(body, text, { ...setup, layout: name || '' });
  });
}

const loadLine = (m, commodities) => {
  const c = commodities.find((x) => x.id === m.commodityId)?.name;
  return [`#${m.ticketNo ?? '?'}`, m.outloadNo ? `outload ${m.outloadNo}` : '', shortDate(m.date, { tight: true }), m.truckRego, c, `${num(m.tons, 2)} t`].filter(Boolean).join(' · ');
};

/** How every row matched, and the choice to apply. */
function review(body, text, setup) {
  const table = readTable(text, { headerRow: setup.headerRow });
  const { rows, warnings } = extractRows(table, setup.mapping, setup);
  if (!rows.length) { body.innerHTML = '<div class="empty">No deliveries could be read from that file. Check the columns.</div>'; return; }
  const { movements, commodities } = db.get();
  const items = matchDeliveries(rows, movements, { commodities, seasonYY: seasonYY(db.getCurrentYear(), todayLocal()) });

  // what will be done to each row: the load chosen, or nothing
  const pick = items.map((it) => (it.kind === 'match' ? it.load : null));
  const count = (kind) => items.filter((it) => it.kind === kind).length;
  const ready = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'match');
  const look = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'review' || it.kind === 'unmatched');
  const problems = [...warnings, ...new Set(rows.flatMap((r) => r.problems))];

  const change = (it, load) => {
    if (!load || it.row.net === null) return '';
    const was = Number(load.tons) || 0;
    const shared = (load.froms || []).length > 1 ? ` (shared over ${(load.froms || []).length} sources)` : '';
    return `${num(was, 2)} t &rarr; <strong>${num(it.row.net, 2)} t</strong>${shared}`;
  };
  const rowHead = (it) => `${esc(it.row.outloadText || 'no number')} &middot; ${esc(it.row.rego || 'no truck')} &middot; ${esc(it.row.date ? shortDate(it.row.date, { tight: true }) : 'no date')}`;

  body.innerHTML = `
    <div class="card">
      <h2>${rows.length} deliveries in the file</h2>
      ${setup.layout ? `<div class="field hint" style="margin-bottom:6px">Read with the layout &ldquo;${esc(setup.layout)}&rdquo;. <a href="#" id="di-edit">Change the columns</a></div>` : '<div class="field hint" style="margin-bottom:6px"><a href="#" id="di-edit">Change the columns</a></div>'}
      ${problems.length ? `<div class="field hint" style="color:var(--danger);margin-bottom:8px">${problems.map(esc).join('<br>')}</div>` : ''}
      <div class="row"><span class="label">Ready to apply</span><span class="value">${count('match')}</span></div>
      <div class="row"><span class="label">Need a look</span><span class="value">${count('review')}</span></div>
      <div class="row"><span class="label">No load found</span><span class="value">${count('unmatched')}</span></div>
      <div class="row"><span class="label">Already up to date</span><span class="value">${count('same')}</span></div>
      <div class="row"><span class="label">Rejected by the site (nothing changes)</span><span class="value">${count('rejected')}</span></div>
    </div>

    ${ready.length ? `<div class="card"><h2>Ready to apply</h2>
      <div class="field hint" style="margin-bottom:6px">The number, truck, date and commodity all fit. The site's weight replaces the estimate and the load becomes final.</div>
      ${ready.map(({ it, i }) => `<label class="row" style="align-items:flex-start;gap:8px;cursor:pointer"><input type="checkbox" data-ready="${i}" checked style="width:18px;height:18px;margin-top:3px" />
        <span class="label" style="flex:1">${rowHead(it)}<br><span class="meta">${esc(loadLine(it.load, commodities))}<br>${change(it, it.load)}${it.row.grade ? ` &middot; ${esc(it.row.grade)}` : ''}</span></span></label>`).join('')}
    </div>` : ''}

    ${look.length ? `<div class="card"><h2>Need a look</h2>
      <div class="field hint" style="margin-bottom:6px">Something does not fit, or no load has the number. Choose the load each one is, or leave it out.</div>
      ${look.map(({ it, i }) => `<div class="field" style="border-top:1px solid var(--border);padding-top:8px">
        <div class="main">${rowHead(it)} &middot; ${it.row.net !== null ? `${num(it.row.net, 2)} t` : 'no weight'}${it.row.grade ? ` &middot; ${esc(it.row.grade)}` : ''}</div>
        <div class="meta" style="margin:2px 0 6px">${it.reasons.map(esc).join('<br>')}</div>
        <select data-look="${i}"><option value="">Leave this one out</option>
          ${it.candidates.map((c) => `<option value="${esc(c.load.id)}">${esc(loadLine(c.load, commodities))}${c.why ? ` — ${esc(c.why)}` : ''}</option>`).join('')}
        </select></div>`).join('')}
    </div>` : ''}

    ${count('rejected') ? `<div class="card"><h2>Rejected by the site</h2>
      ${items.filter((it) => it.kind === 'rejected').map((it) => `<div class="row"><span class="label">${rowHead(it)}</span><span class="value meta">${it.reasons.map(esc).join(' ')}</span></div>`).join('')}
      <div class="field hint">Nothing is changed for these. If the grain came back, correct the load by hand.</div>
    </div>` : ''}

    <div class="card">
      <div id="di-apply-problem"></div>
      <button class="btn" id="di-apply">Apply</button>
      <div class="field hint" style="margin-top:6px">The estimate is kept in the load's notes. A load that came from more than one place shares the site's weight between them in proportion.</div>
    </div>`;

  const lookups = new Map(look.map(({ it, i }) => [i, it]));
  const chosen = () => {
    const out = new Map();   // row index -> load
    body.querySelectorAll('[data-ready]').forEach((el) => { if (el.checked) out.set(Number(el.dataset.ready), pick[Number(el.dataset.ready)]); });
    body.querySelectorAll('[data-look]').forEach((el) => {
      if (!el.value) return;
      const i = Number(el.dataset.look);
      const load = lookups.get(i).candidates.find((c) => c.load.id === el.value)?.load;
      if (load) out.set(i, load);
    });
    return out;
  };
  const applyBtn = body.querySelector('#di-apply');
  const refresh = () => { const n = chosen().size; applyBtn.textContent = n ? `Apply ${n} ${n === 1 ? 'delivery' : 'deliveries'}` : 'Nothing to apply'; applyBtn.disabled = n === 0; };
  body.querySelectorAll('[data-ready], [data-look]').forEach((el) => el.addEventListener('change', refresh));
  refresh();
  body.querySelector('#di-edit')?.addEventListener('click', (e) => {
    e.preventDefault();
    showMapping(body, text, { headerRow: setup.headerRow, mapping: setup.mapping, units: setup.units, dateOrder: setup.dateOrder, name: setup.layout || '' });
  });

  applyBtn.addEventListener('click', () => {
    const picks = chosen();
    // one load can take one row only
    const seen = new Map();
    for (const [i, load] of picks) {
      if (seen.has(load.id)) {
        body.querySelector('#di-apply-problem').innerHTML = `<div class="hint" style="color:var(--danger);margin-bottom:6px">Two rows are set to go to the same load (${esc(loadLine(load, commodities))}). Leave one of them out.</div>`;
        return;
      }
      seen.set(load.id, i);
    }
    const today = dmy(todayLocal());
    let done = 0;
    for (const [i, load] of picks) {
      db.upsertMovement(deliveryPatch(load, items[i].row, { today }));
      done += 1;
    }
    closeSheet();
    toast(`${done} ${done === 1 ? 'load' : 'loads'} updated`);
  });
}
