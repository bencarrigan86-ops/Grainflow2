// Import truck loads from a weighbridge CSV.
//
// A guided sheet, not a button that does something: choose the file, see what
// it holds, say what each paddock and silo name in it is in this app, check the
// loads whose weights do not agree, then import. Nothing is saved until the
// last step, and the last step says exactly what it is about to do.
//
// The reading and the rules live in loadimport.js, where they are tested. This
// file is the screen: it holds the person's choices and hands them over.

import { db } from '../storage.js?v=236';
import { openSheet, closeSheet, notify, askConfirm, toast, field } from '../ui.js?v=236';
import { esc, num, shortDate } from '../fmt.js?v=236';
import { commodityFills } from '../commodityfill.js?v=236';
import { isTransit } from '../transit.js?v=236';
import { reconcileLoads } from '../loadcheck.js?v=236';
import {
  FIELD_SPECS, REQUIRED_KEYS, chooseSetup, recallSetups, rememberSetup, setupProblems, peekFile, distinctOf, likelyFinished,
} from '../loadmap.js?v=236';
import {
  readFreightExport, planNames, distinctNames, matchCommodity, matchSiloByNumber, suggestCutoff, buildMovements, COMPLETED,
} from '../loadimport.js?v=236';

const MEMORY_KEY = 'grainflow.loadImportChoices';
const NEW = '__new';
const SKIP = '__skip';
const NONE = '__none';
const SPLIT = '__split';

// What the person chose last time, so the second import of the season is a
// matter of choosing the file. Only choices that named an existing record are
// kept — remembering "skip" would quietly drop loads next time.
function recall() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}'); } catch { return {}; }
}
function remember(choices) {
  const keep = { field: {}, silo: {}, commodity: {} };
  for (const kind of Object.keys(keep)) {
    for (const [name, v] of Object.entries(choices[kind])) {
      if (v && ![NEW, SKIP, NONE, SPLIT].includes(v)) keep[kind][name] = v;
    }
  }
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(keep)); } catch { /* private mode: it just asks again */ }
}

// A bunker is a bunker and a shed holds tonnes without a geometry; anything else
// is a silo. The person can change it afterwards on the Storage screen.
const storageKindFor = (name) => (/bunker/i.test(name) ? 'bunker' : /shed|store/i.test(name) ? 'tally' : 'silo');

export function openLoadImportSheet() {
  openSheet('Import truck loads', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Choose the truck loads CSV exported from your
        weighbridge. You will see what it holds and match its paddocks and silos to yours before
        anything is saved.</div>
      <input type="file" id="li-file" accept=".csv,text/csv" />
      <div id="li-body" style="margin-top:14px"></div>`;
    root.querySelector('#li-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      let text;
      try { text = await file.text(); } catch { notify('That file could not be read.'); return; }
      begin(root.querySelector('#li-body'), text);
    });
  });
}

// Remembered column choices live on this device, like the paddock and silo choices.
const store = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just asks again */ } },
};

/**
 * A file arrives. If its columns are ones already known — the weighbridge platform's
 * own export, or a layout matched before — it simply opens. Only a file with columns
 * nobody has matched, or one that has stopped fitting what was matched, asks the
 * person which column is which.
 */
function begin(body, text) {
  const { headers, rows } = peekFile(text);
  if (headers.length === 0 || rows.length === 0) { body.innerHTML = '<div class="empty">That file has no loads in it.</div>'; return; }
  const choice = chooseSetup(headers, recallSetups(store));
  const accept = (setup, source) => review(body, text, setup, source, headers, rows);
  if (choice.confirm) {
    showMapping(body, text, headers, rows, choice, (setup) => {
      rememberSetup(store, headers, setup);
      accept(setup, 'matched');
    });
  } else {
    accept(choice.setup, choice.source);
  }
}

const READ_WITH = {
  platform: 'Read as a weighbridge platform export.',
  saved: 'Read with the columns you matched before.',
  last: 'Read with the columns you matched before.',
  matched: 'Read with the columns you just matched.',
};

/** "Which column is which" — the one screen a new kind of file needs. */
function showMapping(body, text, headers, rows, choice, done) {
  const sample = (header) => {
    const at = headers.findIndex((h) => h.trim().toLowerCase() === String(header ?? '').trim().toLowerCase());
    if (at < 0) return '';
    const hit = rows.find((r) => String(r[at] ?? '').trim() !== '');
    return hit ? String(hit[at]).trim() : '';
  };
  const headerOptions = [{ value: '', label: '— not in this file —' }, ...headers.map((h) => ({ value: h, label: h }))];
  const start = choice.setup;
  const row = (spec) => field({
    label: `${spec.label}${spec.required ? ' *' : ''}`, id: `lm-${spec.key}`, type: 'select',
    value: start.columns?.[spec.key] ?? '', options: headerOptions,
  });
  const required = FIELD_SPECS.filter((f) => f.required);
  const optional = FIELD_SPECS.filter((f) => !f.required);
  const isIt = !choice.problems?.length;

  body.innerHTML = `
    <div class="card">
      <h2>Match this file's columns</h2>
      <div class="field hint" style="margin-bottom:8px">${isIt
        ? 'These are columns the app has not seen before. Say which column is which, once; the same layout opens straight away next time.'
        : 'This file no longer fits the columns you matched before, so check them. What still fits is filled in.'}</div>
      ${choice.problems?.length ? `<div class="field hint" style="color:var(--danger);margin-bottom:8px">${choice.problems.map(esc).join('<br>')}</div>` : ''}
      <div id="lm-required">${required.map(row).join('')}</div>
      <div class="grid-2">
        ${field({ label: 'Dates are written', id: 'lm-order', type: 'select', value: start.dateOrder || 'dmy', options: [
          { value: 'dmy', label: 'Day / Month / Year' }, { value: 'mdy', label: 'Month / Day / Year' }, { value: 'ymd', label: 'Year / Month / Day' }] })}
        ${field({ label: 'Weights are in', id: 'lm-unit', type: 'select', value: start.unit || 't', options: [
          { value: 't', label: 'Tonnes' }, { value: 'kg', label: 'Kilograms' }] })}
      </div>
      <details class="fold" ${optional.some((f) => start.columns?.[f.key]) ? 'open' : ''}>
        <summary><div><h2>More columns (optional)</h2><div class="sub">Truck, grade, quality results, load number, status</div></div></summary>
        <div id="lm-optional">${optional.map(row).join('')}</div>
      </details>
      <div id="lm-status-slot"></div>
      <div class="subhead" style="margin-top:10px">What this reads as</div>
      <div id="lm-preview"></div>
      <button class="btn" id="lm-go" style="margin-top:10px">Use these columns</button>
    </div>`;

  // a sample value under each column, so the person can see they picked the right one
  const showSamples = () => {
    for (const spec of FIELD_SPECS) {
      const select = body.querySelector(`#lm-${spec.key}`);
      if (!select) continue;
      const holder = select.closest('.field');
      let hint = holder.querySelector('.lm-sample');
      if (!hint) { hint = document.createElement('div'); hint.className = 'field hint lm-sample'; holder.appendChild(hint); }
      const v = sample(select.value);
      hint.textContent = select.value ? (v ? `e.g. ${v}` : 'that column is empty in the first rows') : '';
    }
  };

  // Which statuses mean a load happened: the file's own words, with the likely ones ticked.
  const doneValues = new Set((start.completed || []).map((v) => String(v).toLowerCase()));
  const paintStatuses = () => {
    const slot = body.querySelector('#lm-status-slot');
    const column = body.querySelector('#lm-status')?.value;
    if (!slot) return;
    if (!column) { slot.innerHTML = ''; return; }
    const values = distinctOf(rows, headers, column);
    const had = slot.querySelectorAll('input[data-done]');
    const ticked = new Set([...slot.querySelectorAll('input[data-done]:checked')].map((i) => i.dataset.done.toLowerCase()));
    slot.innerHTML = `<div class="subhead" style="margin-top:8px">Which statuses mean the load happened?</div>
      ${values.map((v) => {
        const key = v.value.toLowerCase();
        const on = had.length ? ticked.has(key) : (doneValues.size ? doneValues.has(key) : likelyFinished(v.value));
        return `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" data-done="${esc(v.value)}" ${on ? 'checked' : ''} style="width:auto"> ${esc(v.value)} <span class="meta">(${v.n})</span></label>`;
      }).join('')}`;
  };

  const gather = () => {
    const columns = {};
    for (const spec of FIELD_SPECS) {
      const v = body.querySelector(`#lm-${spec.key}`)?.value;
      if (v) columns[spec.key] = v;
    }
    const ticked = [...body.querySelectorAll('input[data-done]:checked')].map((i) => i.dataset.done);
    return {
      columns,
      dateOrder: body.querySelector('#lm-order').value,
      unit: body.querySelector('#lm-unit').value,
      completed: columns.status ? ticked : [],
    };
  };

  const preview = () => {
    const setup = gather();
    const problems = setupProblems(setup, headers);
    const out = body.querySelector('#lm-preview');
    const go = body.querySelector('#lm-go');
    const unmet = REQUIRED_KEYS.filter((k) => !setup.columns[k]);
    if (unmet.length) {
      out.innerHTML = `<div class="field hint" style="color:var(--danger)">Still to match: ${unmet.map((k) => esc(FIELD_SPECS.find((f) => f.key === k).label)).join(', ')}.</div>`;
      go.disabled = true;
      return;
    }
    const { loads, missingColumns } = readFreightExport(text, setup);
    if (missingColumns.length) {
      out.innerHTML = `<div class="field hint" style="color:var(--danger)">Missing: ${missingColumns.map(esc).join(', ')}.</div>`;
      go.disabled = true;
      return;
    }
    const clean = loads.filter((l) => !l.problems.length);
    const line = (l) => `${esc(l.date ? shortDate(l.date) : 'no date')} · ${esc(l.field || '?')} → ${esc(l.silo || '?')} · ${esc(l.commodity || '?')} · ${l.deliveryTons != null ? num(l.deliveryTons, 2) + ' t' : 'no weight'}`;
    out.innerHTML = `
      <div class="row"><span class="label">Rows read cleanly</span><span class="value">${clean.length} of ${loads.length}</span></div>
      ${clean.slice(0, 3).map((l) => `<div class="field hint">${line(l)}</div>`).join('') || '<div class="field hint" style="color:var(--danger)">No row could be read with these choices. Check the date order and the columns.</div>'}
      ${loads.length - clean.length ? `<div class="field hint">${loads.length - clean.length} row(s) can't be used with these choices, and will be listed on the next screen.</div>` : ''}`;
    go.disabled = problems.length > 0 || clean.length === 0;
  };

  const refresh = () => { showSamples(); paintStatuses(); preview(); };
  body.querySelector('.card').addEventListener('change', refresh);
  body.querySelector('#lm-go').addEventListener('click', () => done(gather()));
  refresh();
}

/** The file with a layout chosen: show what it holds and carry on to the paddock/silo steps. */
function review(body, text, setup, source, headers, rows) {
  const { loads, missingColumns } = readFreightExport(text, setup);
  const rematch = () => showMapping(body, text, headers, rows, { setup, problems: [] }, (next) => {
    rememberSetup(store, headers, next);
    review(body, text, next, 'matched', headers, rows);
  });
  if (missingColumns.length) {
    body.innerHTML = `<div class="card"><h2>Some columns are missing</h2>
      <div class="field hint" style="color:var(--danger)">Missing: ${missingColumns.map(esc).join(', ')}.</div>
      <button class="btn secondary small" id="li-rematch" style="margin-top:8px">Match the columns</button></div>`;
    body.querySelector('#li-rematch').addEventListener('click', rematch);
    return;
  }
  if (loads.length === 0) { body.innerHTML = '<div class="empty">That file has no loads in it.</div>'; return; }

  const { fields, storages, commodities, movements } = db.get();
  const fieldOpts = fields.map((f) => ({ id: f.id, name: f.name }));
  const siloOpts = storages.filter((s) => !isTransit(s) && !s.offFarm).map((s) => ({ id: s.id, name: s.name }));
  const commodityOpts = commodities.map((c) => ({ id: c.id, name: c.name }));

  const plans = {
    field: planNames(loads, 'field', fieldOpts),
    silo: planNames(loads, 'silo', siloOpts, { match: matchSiloByNumber }),
    commodity: distinctNames(loads, 'commodity').map((d) => ({ ...d, match: matchCommodity(d.name, commodityOpts), suggestions: [] })),
  };
  const options = { field: fieldOpts, silo: siloOpts, commodity: commodityOpts };

  // Starting choices: a certain match, else what was chosen last time, else nothing yet.
  const memory = recall();
  const stillThere = (kind, id) => options[kind].some((o) => o.id === id);
  const choices = { field: {}, silo: {}, commodity: {} };
  for (const kind of Object.keys(plans)) {
    for (const p of plans[kind]) {
      const remembered = memory[kind]?.[p.name];
      choices[kind][p.name] = p.match?.id ?? (remembered && stillThere(kind, remembered) ? remembered : '');
    }
  }
  // A storage the app has never heard of is almost always a new silo, bunker or shed
  // that the weighbridge knows about first, so it starts as "add as new" — visible
  // in its dropdown and in the confirmation, and changeable. Paddocks are not
  // treated the same way: a new paddock has no area, and getting one wrong moves a yield.
  for (const p of plans.silo) {
    if (!p.match && choices.silo[p.name] === '') choices.silo[p.name] = NEW;
  }
  const include = new Set();

  // A name that stands for two paddocks at different times (SR Dam is SR Dam Sth
  // early and SR Dam Nth later) starts as a split at the natural break in the
  // dates, earliest paddock first. It is only a starting point; every part of it
  // can be changed before anything is saved.
  const splits = {};
  for (const p of plans.field) {
    if (p.match || p.suggestions.length < 2 || p.name.includes('|')) continue;
    const cutoff = suggestCutoff(loads, 'field', p.name);
    if (!cutoff) continue;
    choices.field[p.name] = SPLIT;
    splits[p.name] = { cutoff, before: p.suggestions[0].id, from: p.suggestions[1].id };
  }

  // Loads that completed but whose weights do not agree, or cannot be checked.
  const heldCandidates = loads.filter((l) => !l.problems.length && l.finished !== false && l.check !== 'ok');

  const resolved = () => {
    const maps = { fields: {}, silos: {}, commodities: {} };
    const put = (target, kind) => {
      for (const [name, v] of Object.entries(choices[kind])) {
        // A name not yet chosen counts as if it will be matched, so the totals show what
        // the import is heading for; the Import button stays off until every name is settled.
        target[name] = v === SKIP || v === NONE ? null : v === NEW ? `new:${name}` : v === '' ? `pending:${name}` : v === SPLIT ? splitMapping(name) : v;
      }
    };
    put(maps.fields, 'field'); put(maps.silos, 'silo'); put(maps.commodities, 'commodity');
    return maps;
  };
  const splitReady = (name) => { const x = splits[name]; return !!(x && x.cutoff && x.before && x.from); };
  const splitMapping = (name) => (splitReady(name) ? { ...splits[name] } : `pending:${name}`);
  const unresolved = () => Object.entries(choices).reduce((n, [, c]) => n + Object.entries(c)
    .filter(([name, v]) => v === '' || (v === SPLIT && !splitReady(name))).length, 0);

  const select = (kind, p) => {
    const cur = choices[kind][p.name];
    const existing = options[kind].map((o) => `<option value="${esc(o.id)}" ${cur === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    const sug = p.suggestions.length && !p.match
      ? `<optgroup label="Suggested">${p.suggestions.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</optgroup>` : '';
    const extra = kind === 'commodity'
      ? `<option value="${NONE}" ${cur === NONE ? 'selected' : ''}>Leave the commodity blank</option>`
      : `<option value="${SKIP}" ${cur === SKIP ? 'selected' : ''}>Skip these loads</option>`;
    return `<select data-kind="${kind}" data-name="${esc(p.name)}">
      <option value="" ${cur === '' ? 'selected' : ''}>Choose…</option>
      ${sug}<optgroup label="${kind === 'commodity' ? 'Your commodities' : kind === 'field' ? 'Your paddocks' : 'Your storages'}">${existing}</optgroup>
      <option value="${NEW}" ${cur === NEW ? 'selected' : ''}>+ Add as new ${kind === 'field' ? 'paddock' : kind === 'silo' ? storageKindFor(p.name) : 'commodity'}</option>
      ${kind === 'field' ? `<option value="${SPLIT}" ${cur === SPLIT ? 'selected' : ''}>Split between two paddocks by date…</option>` : ''}
      ${extra}</select>${kind === 'field' ? splitPanel(p, cur === SPLIT) : ''}`;
  };
  const fieldSelect = (cls, name, selected) => `<select ${cls}="${esc(name)}">
    <option value="">Choose…</option>${fieldOpts.map((o) => `<option value="${esc(o.id)}" ${selected === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  const splitPanel = (p, shown) => {
    const x = splits[p.name] || { cutoff: '', before: '', from: '' };
    return `<div class="card" data-split-panel="${esc(p.name)}" style="margin:8px 0 0;${shown ? '' : 'display:none'}">
      <div class="field" style="margin-bottom:8px"><label>Loads before this day go to</label>${fieldSelect('data-split-before', p.name, x.before)}</div>
      <div class="field" style="margin-bottom:8px"><label>Switch over on</label><input type="date" data-split-cutoff="${esc(p.name)}" value="${esc(x.cutoff)}" /></div>
      <div class="field" style="margin-bottom:0"><label>That day and later go to</label>${fieldSelect('data-split-from', p.name, x.from)}</div>
    </div>`;
  };
  const mapCard = (kind, title, hint) => `
    <div class="card">
      <h2>${title}</h2>
      <div class="field hint" style="margin-bottom:8px">${hint}</div>
      ${/* names that need a decision first, matched ones after */ [...plans[kind]].sort((x, y) => (x.match ? 1 : 0) - (y.match ? 1 : 0)).map((p) => `
        <div class="field" style="margin-bottom:10px">
          <label>${esc(p.name)} <span class="meta" style="font-weight:400">· ${p.loads} load${p.loads === 1 ? '' : 's'} · ${num(p.tons, 0)} t${p.match ? ' · matched' : ''}</span></label>
          ${select(kind, p)}
        </div>`).join('')}
    </div>`;

  const dates = loads.map((l) => l.date).filter(Boolean).sort();
  const totalTons = loads.reduce((a, l) => a + (l.deliveryTons > 0 ? l.deliveryTons : 0), 0);
  const heldRow = (l) => `
    <label class="row" style="align-items:flex-start;gap:10px;cursor:pointer">
      <input type="checkbox" data-include="${esc(l.ref)}" style="margin-top:3px;width:auto" />
      <span class="label" style="flex:1"><strong>${esc(l.field)} → ${esc(l.silo)}</strong>
        <div class="meta">${esc(shortDate(l.date))} · ${esc(l.rego || 'no truck')} · ${esc(l.ref)}</div>
        <div class="meta" style="color:var(--danger)">${l.check === 'differs'
    ? `Outload ${num(l.pickupTons, 1)} t, delivered ${num(l.deliveryTons, 1)} t`
    : `No outload weight to check against; delivered ${num(l.deliveryTons, 1)} t`}</div></span>
    </label>`;

  body.innerHTML = `
    <div class="field hint" style="margin-bottom:8px">${READ_WITH[source] || ''}
      <button type="button" class="link-btn" id="li-columns" style="min-height:0;padding:0 4px">Change columns</button></div>
    <div class="card" id="li-summary"></div>
    ${heldCandidates.length ? `
    <div class="card">
      <h2>Check these loads</h2>
      <div class="field hint" style="margin-bottom:6px">The tonnes imported are the delivered weight, and the outload
        weight is the check on it. These loads failed the check, so they are held back. Tick the ones to bring in anyway,
        at the delivered weight.</div>
      ${heldCandidates.map(heldRow).join('')}
    </div>` : ''}
    ${mapCard('field', 'Paddocks', 'The "Pickup Storage" column. Matched where the name is the same apart from case, spaces and leading zeros (A07 is A7).')}
    ${mapCard('silo', 'Silos and storages', 'The "Delivery Storage" column. New bunkers and sheds are added with no dimensions, and count tonnes from the loads.')}
    ${mapCard('commodity', 'Commodities', 'The "Commodity" column.')}
    <div class="card" id="li-compare-card">
      <h2>Compare with what is in the app</h2>
      <div class="field hint" style="margin-bottom:6px">Matches each load in this file to the load in the app by its movement number,
        and shows, paddock by paddock, what the file says against what the app holds. Changes nothing.</div>
      <button class="btn secondary small" id="li-compare" type="button">Compare</button>
      <div id="li-compare-out"></div>
    </div>
    <div class="card"><h2>First few loads</h2><div id="li-preview"></div></div>
    <button class="btn" id="li-go" style="margin-top:8px">Import</button>`;

  body.querySelector('#li-columns').addEventListener('click', rematch);
  const summary = body.querySelector('#li-summary');
  const preview = body.querySelector('#li-preview');
  const go = body.querySelector('#li-go');

  body.querySelector('#li-compare').addEventListener('click', () => {
    const { fields: appFields, storages: appStorages, movements } = db.get();
    const r = reconcileLoads(loads, movements, resolved());
    const fname = (id) => appFields.find((f) => f.id === id)?.name ?? '(unknown paddock)';
    const sname = (id) => appStorages.find((x) => x.id === id)?.name ?? '(unknown silo)';
    const t = (v) => num(v, 1);
    const list = (items, line, more = 8) => items.length
      ? items.slice(0, more).map((x) => `<div class="field hint">${line(x)}</div>`).join('')
        + (items.length > more ? `<div class="field hint">…and ${items.length - more} more.</div>` : '')
      : '';
    const issue = (label, items, line) => `<div class="row"><span class="label">${label}</span><span class="value" style="${items.length ? 'color:var(--danger)' : ''}">${items.length}</span></div>${list(items, line)}`;
    const fileTotal = r.byField.reduce((a, f) => a + f.fileTons, 0);
    const appTotal = r.byField.reduce((a, f) => a + f.appTons, 0);
    const rows = r.byField.filter((f) => Math.abs(f.appTons - f.fileTons) > 0.05 || f.otherTons > 0.05);
    body.querySelector('#li-compare-out').innerHTML = `
      <div class="row" style="margin-top:8px"><span class="label">Loads in the file</span><span class="value">${loads.length}</span></div>
      <div class="row"><span class="label">Found in the app</span><span class="value">${r.matched}</span></div>
      ${issue('Not in the app', r.missing, (x) => `${esc(x.ref)} · ${esc(shortDate(x.date))} · ${esc(x.field)} · ${t(x.deliveryTons)} t`)}
      ${issue('In the app more than once', r.copies, (x) => `${esc(x.load.ref)} · ${x.count} copies`)}
      ${issue('In a different paddock from the file', r.wrongField, (x) => `${esc(x.load.ref)} · file says ${esc(x.load.field)} (${esc(fname(x.expected))}), app has ${x.actual.length ? x.actual.map((a) => `${esc(fname(a.id))} ${t(a.tons)} t`).join(' + ') : 'no paddock'}`)}
      ${issue('In a different silo from the file', r.wrongSilo, (x) => `${esc(x.load.ref)} · file says ${esc(x.load.silo)} (${esc(sname(x.expected))}), app has ${x.actual.length ? x.actual.map((a) => `${esc(sname(a.id))} ${t(a.tons)} t`).join(' + ') : 'no silo'}`)}
      ${issue('Weight differs from the file', r.tonsDiffer, (x) => `${esc(x.load.ref)} · file ${t(x.load.deliveryTons)} t, app load ${t(x.loadTons)} t, paddock leg ${t(x.legTons)} t`)}
      <div class="subhead" style="margin-top:8px">Paddocks that differ &mdash; file against app</div>
      <div class="field hint">The file totals ${t(fileTotal)} t; the app holds ${t(appTotal)} t from paddocks. &ldquo;Other&rdquo; is tonnes in the app that are not loads from this file.</div>
      ${rows.length ? rows.map((f) => `<div class="row"><span class="label">${esc(fname(f.id))}<div class="meta">file ${t(f.fileTons)} · app ${t(f.appTons)}${f.otherTons > 0.05 ? ` · other ${t(f.otherTons)}` : ''}</div></span><span class="value">${f.appTons - f.fileTons > 0 ? '+' : ''}${t(f.appTons - f.fileTons)} t</span></div>`).join('') : '<div class="field hint">Every paddock agrees with the file.</div>'}`;
  });

  const refresh = () => {
    const r = buildMovements(loads, resolved(), { existing: db.get().movements, include });
    const tons = r.movements.reduce((a, m) => a + m.tons, 0);
    const open = unresolved();
    const ok = loads.filter((l) => l.check === 'ok').length;
    summary.innerHTML = `
      <h2>${loads.length} loads · ${esc(shortDate(dates[0]))} to ${esc(shortDate(dates[dates.length - 1]))}</h2>
      <div class="row"><span class="label">Delivered weight in the file</span><span class="value">${num(totalTons, 1)} t</span></div>
      <div class="row"><span class="label">Weights agree</span><span class="value">${ok}</span></div>
      <div class="row"><span class="label">Held for checking</span><span class="value">${r.held.length}</span></div>
      <div class="row"><span class="label">Already in the app</span><span class="value">${r.duplicates}</span></div>
      <div class="row"><span class="label">Cannot be imported</span><span class="value">${r.skipped.length}</span></div>
      <div class="row"><span class="label">…of which with moisture, protein etc.</span><span class="value">${r.movements.filter((m) => m.moisturePct != null || m.proteinPct != null || m.testWeightKgHl != null || m.screeningsPct != null || m.fallingNumber != null).length}</span></div>
      <div class="row"><span class="label"><strong>Will be added</strong></span><span class="value"><strong>${r.movements.length} loads · ${num(tons, 1)} t</strong></span></div>
      <div class="field hint" style="margin-top:6px">Into the season shown at the top of the app: <strong>${esc(db.getCurrentYear())}</strong>.</div>
      ${r.skipped.length ? `<details class="fold"><summary><div><h2>Why ${r.skipped.length} cannot be imported</h2></div></summary>
        ${r.skipped.slice(0, 40).map((s) => `<div class="field hint">${esc(s.load.ref || 'row ' + s.load.line)} — ${esc(s.why)}</div>`).join('')}
        ${r.skipped.length > 40 ? `<div class="field hint">…and ${r.skipped.length - 40} more</div>` : ''}</details>` : ''}`;
    preview.innerHTML = r.movements.slice(0, 5).map((m) => `
      <div class="row"><span class="label">${esc(shortDate(m.date))} · ${esc(m.truckRego || 'no truck')}
        <div class="meta">${esc(m.notes)}</div></span><span class="value">${num(m.tons, 1)} t</span></div>`).join('')
      || '<div class="empty" style="padding:10px">Nothing to add yet.</div>';
    go.disabled = open > 0 || r.movements.length === 0;
    go.textContent = open > 0 ? `Choose ${open} more match${open === 1 ? '' : 'es'} above`
      : r.movements.length === 0 ? 'Nothing to import' : `Import ${r.movements.length} loads`;
  };

  body.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-kind]');
    if (sel) {
      choices[sel.dataset.kind][sel.dataset.name] = sel.value;
      if (sel.dataset.kind === 'field') {
        const panel = body.querySelector(`[data-split-panel="${CSS.escape(sel.dataset.name)}"]`);
        if (panel) panel.style.display = sel.value === SPLIT ? '' : 'none';
        if (sel.value === SPLIT && !splits[sel.dataset.name]) splits[sel.dataset.name] = { cutoff: suggestCutoff(loads, 'field', sel.dataset.name) || '', before: '', from: '' };
      }
      refresh(); return;
    }
    const part = e.target.closest('[data-split-before],[data-split-from],[data-split-cutoff]');
    if (part) {
      const name = part.dataset.splitBefore ?? part.dataset.splitFrom ?? part.dataset.splitCutoff;
      const x = splits[name] || (splits[name] = { cutoff: '', before: '', from: '' });
      if (part.dataset.splitBefore !== undefined) x.before = part.value;
      else if (part.dataset.splitFrom !== undefined) x.from = part.value;
      else x.cutoff = part.value;
      refresh(); return;
    }
    const box = e.target.closest('input[data-include]');
    if (box) { if (box.checked) include.add(box.dataset.include); else include.delete(box.dataset.include); refresh(); }
  });

  go.addEventListener('click', async () => {
    const preflight = buildMovements(loads, resolved(), { existing: db.get().movements, include });
    const made = [];
    for (const kind of ['commodity', 'field', 'silo']) {
      for (const [name, v] of Object.entries(choices[kind])) if (v === NEW) made.push(`${kind === 'field' ? 'paddock' : kind === 'silo' ? storageKindFor(name) : 'commodity'} “${name}”`);
    }
    const tons = preflight.movements.reduce((a, m) => a + m.tons, 0);
    const ok = await askConfirm(
      `Add ${preflight.movements.length} loads (${num(tons, 1)} t) to ${db.getCurrentYear()}?` +
      (made.length ? `\n\nThis also adds: ${made.join(', ')}.` : '') +
      '\n\nYou can delete loads afterwards, one at a time.',
      { confirmLabel: 'Import' });
    if (!ok) return;

    // New records first, so the loads have something to point at.
    const idFor = { field: {}, silo: {}, commodity: {} };
    const firstCommodityFor = (key, name) => {
      const l = loads.find((x) => x[key] === name);
      const v = l ? choices.commodity[l.commodity] : '';
      return idFor.commodity[l?.commodity] ?? (v && ![NEW, SKIP, NONE, ''].includes(v) ? v : undefined);
    };
    for (const [name, v] of Object.entries(choices.commodity)) {
      if (v === NEW) idFor.commodity[name] = db.upsertCommodity({ name: name.replace(/\s*\(.*\)\s*$/, '') });
    }
    for (const [name, v] of Object.entries(choices.field)) {
      if (v === NEW) idFor.field[name] = db.upsertField({ name, areaHa: 0, commodityId: firstCommodityFor('field', name), yieldMode: 'actual', yieldTHa: 0 });
    }
    for (const [name, v] of Object.entries(choices.silo)) {
      if (v === NEW) idFor.silo[name] = db.upsertStorage({ kind: storageKindFor(name), name, commodityId: firstCommodityFor('silo', name), openingStock: 0 });
    }
    const final = { fields: {}, silos: {}, commodities: {} };
    const resolve = (target, kind) => {
      for (const [name, v] of Object.entries(choices[kind])) {
        target[name] = v === NEW ? idFor[kind][name] : v === SPLIT ? { ...splits[name] } : (v === SKIP || v === NONE || v === '') ? null : v;
      }
    };
    resolve(final.fields, 'field'); resolve(final.silos, 'silo'); resolve(final.commodities, 'commodity');

    const result = buildMovements(loads, final, { existing: db.get().movements, include });
    const added = db.addMovements(result.movements);
    remember(choices);
    // A silo with no commodity that has just been filled with wheat is a wheat silo.
    const now = db.get();
    const { fills } = commodityFills(now.storages, now.movements, now.fields);
    for (const f of fills) db.upsertStorage({ id: f.storage.id, commodityId: f.commodityId });
    closeSheet();
    toast(`Imported ${added} loads${fills.length ? ` · ${fills.length} silo${fills.length === 1 ? '' : 's'} given a commodity` : ''}`);
    if (result.held.length || result.skipped.length) {
      notify(`${added} loads imported.\n\n${result.held.length} held back and ${result.skipped.length} that could not be imported were not added. `
        + 'Run the import again and tick the held loads to bring them in; loads already in the app are recognised and not added twice.');
    }
  });

  refresh();
}
