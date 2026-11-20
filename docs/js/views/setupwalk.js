// The setup walk-through: a sheet that asks one thing at a time, in the order a farm gets set up, and saves as it goes.
// Skip for now is always there; Continue setup on Position comes back to the first step not done.

import { db } from '../storage.js?v=456';
import { openSheet, closeSheet, openOver, field, getVal, getNum, toast, notify } from '../ui.js?v=456';
import { esc, todayLocal } from '../fmt.js?v=456';
import { walkSteps, seasonLabel, businessPatch, commodityRecord, fieldRecord, storageRecord, saleRecord, loadRecord, invoiceable } from '../setupwalk.js?v=456';
import { openInvoiceListSheet } from './invoice.js?v=456';
import { openMapSheet } from './farmmap.js?v=456';
import { openLoadImportSheet } from './importloads.js?v=456';

const QUESTIONS = {
  business: { q: 'What is the business called?', hint: 'These go on invoices, tickets and contracts.' },
  season: { q: 'Which season is this?', hint: 'Everything you add now goes into this season. A short label, such as 2026. Cotton farms often use 2026/27.' },
  commodities: { q: 'What do you grow?', hint: 'Wheat, barley, canola and the usual crops are already here. Add any that are missing.' },
  paddocks: { q: 'Add your paddocks', hint: 'A name, the hectares and this season’s crop. Yields come later.' },
  storage: { q: 'Add your silos and bunkers', hint: 'And what is in each now. Leave it empty if it is.' },
  contract: { q: 'Enter a contract', hint: 'Who is buying, how much and the price. The rest can be filled in later.' },
  load: { q: 'Record a load', hint: 'Grain going from a paddock or silo to a silo or a contract.' },
  invoice: { q: 'Make an invoice', hint: 'From a contract that has loads delivered.' },
};

const snapshot = () => ({ business: db.getBusinessDetails(), ...db.get() });
const names = (list) => list.map((x) => `<span class="sw-chip">${esc(x.name)}</span>`).join('');
const options = (list, blank) => [...(blank ? [{ value: '', label: blank }] : []), ...list.map((x) => ({ value: x.id, label: x.name }))];

/** Opens the walk-through at the first step the farm has not done (or the one asked for). */
export function openSetupWalk({ at } = {}) {
  const { steps, first } = walkSteps(db.getRole(), snapshot());
  if (!steps.length) return;
  const ids = steps.map((s) => s.id);
  let idx = at != null ? at : first;
  openSheet('Setting up', (root) => paint(root, ids, () => idx, (n) => { idx = n; }), { askBeforeClose: false });
}

function bars(count, at) {
  return `<div class="sw-bars" aria-hidden="true">${Array.from({ length: count }, (_, i) => `<span class="${i < at ? 'done' : i === at ? 'now' : ''}"></span>`).join('')}</div>`;
}

function paint(root, ids, getIdx, setIdx) {
  const idx = getIdx();
  if (idx >= ids.length) { paintFinish(root, ids, setIdx); return; }
  const id = ids[idx];
  const data = snapshot();
  const q = QUESTIONS[id];
  const go = (n) => { setIdx(n); paint(root, ids, getIdx, setIdx); };
  const body = BODIES[id](data);
  root.innerHTML = `
    <div class="sw">
      ${bars(ids.length, idx)}
      <div class="sw-step">Step ${idx + 1} of ${ids.length}</div>
      <h3 class="sw-q">${q.q}</h3>
      <div class="sw-hint">${q.hint}</div>
      ${body.html}
      <div class="sw-actions">
        <button type="button" class="btn secondary" id="sw-back" ${idx === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="btn secondary" id="sw-skip">Skip for now</button>
        <button type="button" class="btn" id="sw-next">${idx === ids.length - 1 ? 'Finish' : 'Next'}</button>
      </div>
    </div>`;
  const again = () => paint(root, ids, getIdx, setIdx);
  body.wire?.(root, again);
  root.querySelector('#sw-back').addEventListener('click', () => go(idx - 1));
  root.querySelector('#sw-skip').addEventListener('click', () => go(idx + 1));
  root.querySelector('#sw-next').addEventListener('click', () => {
    if (body.save && body.save(root) === false) return;
    go(idx + 1);
  });
}

function paintFinish(root, ids, setIdx) {
  const setsUp = db.getRole() === 'owner' || db.getRole() === 'manager';
  root.innerHTML = `
    <div class="sw">
      ${bars(ids.length, ids.length)}
      <div class="sw-done-mark" aria-hidden="true">&#10003;</div>
      <h3 class="sw-q">You’re set up</h3>
      <div class="sw-hint">Anything you skipped is still on the Getting started card on Position. The How-to guide, in Settings, has a short guide for each job and brings this walk-through back any time.</div>
      <div class="sw-note"><b>Seasons</b><span>The season shows at the top right. Tap it to switch to an earlier season, or to start a new one.</span></div>
      ${setsUp ? `<div class="sw-note"><b>When you’re ready</b><span>Import your farm map to outline the paddocks, or bring in past loads from a spreadsheet.</span>
        <div class="sw-links"><button type="button" class="btn secondary small" id="sw-map">Import farm map</button><button type="button" class="btn secondary small" id="sw-import">Import loads</button></div></div>` : ''}
      <div class="sw-actions sw-actions-col">
        <button type="button" class="btn" id="sw-position">Go to Position</button>
        <button type="button" class="btn secondary" id="sw-season">Open season settings</button>
        <button type="button" class="btn secondary" id="sw-help">How-to guide</button>
        <button type="button" class="btn secondary" id="sw-back">Back</button>
      </div>
    </div>`;
  root.querySelector('#sw-position').addEventListener('click', () => { closeSheet(); location.hash = '#/position'; });
  root.querySelector('#sw-map')?.addEventListener('click', () => openOver(() => openMapSheet()));
  root.querySelector('#sw-import')?.addEventListener('click', () => openOver(() => openLoadImportSheet()));
  root.querySelector('#sw-help').addEventListener('click', () => { closeSheet(); location.hash = '#/help'; });
  root.querySelector('#sw-season').addEventListener('click', () => { closeSheet(); location.hash = '#/settings'; });
  root.querySelector('#sw-back').addEventListener('click', () => { setIdx(ids.length - 1); paint(root, ids, () => ids.length - 1, setIdx); });
}

const BODIES = {
  business: (data) => {
    const b = data.business || {};
    return {
      html: `${field({ label: 'Business name', id: 'sw-name', value: b.entityName, placeholder: 'e.g. Smith Farming Pty Ltd' })}
        ${field({ label: 'ABN', id: 'sw-abn', value: b.abn })}
        ${field({ label: 'NGR', id: 'sw-ngr', value: b.ngr, hint: 'Your National Grower Registration number' })}`,
      save: (root) => {
        const patch = businessPatch({ entityName: getVal(root, 'sw-name'), abn: getVal(root, 'sw-abn'), ngr: getVal(root, 'sw-ngr') });
        if (Object.keys(patch).length) db.updateBusinessDetails(patch);
      },
    };
  },

  season: () => ({
    html: field({ label: 'Season', id: 'sw-season', value: db.getCurrentYear(), placeholder: 'e.g. 2026', hint: 'You can start a new season later: tap the season at the top right, then Start new year.' }),
    save: (root) => {
      const label = seasonLabel(getVal(root, 'sw-season'), db.getCurrentYear());
      if (!label) return true;
      if (!db.renameYear(db.getCurrentYear(), label)) { notify('"' + label + '" is already in use.'); return false; }
      return true;
    },
  }),

  commodities: (data) => ({
    html: `<div class="sw-chips">${names(data.commodities) || '<span class="sw-none">None yet</span>'}</div>
      ${field({ label: 'Add another', id: 'sw-cname', placeholder: 'e.g. Lupins' })}
      ${field({ label: 'Sold in', id: 'sw-cunit', type: 'select', value: 't', options: [{ value: 't', label: 'Tonnes' }, { value: 'bale', label: 'Bales (cotton)' }] })}
      <button type="button" class="btn secondary" id="sw-add">Add commodity</button>`,
    wire: (root, again) => root.querySelector('#sw-add').addEventListener('click', () => {
      const rec = commodityRecord({ name: getVal(root, 'sw-cname'), unit: getVal(root, 'sw-cunit') });
      if (!rec) { root.querySelector('#sw-cname').focus(); return; }
      db.upsertCommodity(rec);
      again();
    }),
    save: (root) => {
      const rec = commodityRecord({ name: getVal(root, 'sw-cname'), unit: getVal(root, 'sw-cunit') });
      if (rec) db.upsertCommodity(rec);
    },
  }),

  paddocks: (data) => ({
    html: `<div class="sw-chips">${names(data.fields) || '<span class="sw-none">None yet</span>'}</div>
      ${field({ label: 'Paddock name', id: 'sw-fname' })}
      ${field({ label: 'Hectares', id: 'sw-farea', type: 'number', step: '0.1' })}
      ${field({ label: 'Crop', id: 'sw-fcom', type: 'select', value: '', options: options(data.commodities, 'Not sown / not decided') })}
      <button type="button" class="btn secondary" id="sw-add">Add paddock</button>`,
    wire: (root, again) => root.querySelector('#sw-add').addEventListener('click', () => {
      const rec = fieldRecord({ name: getVal(root, 'sw-fname'), areaHa: getVal(root, 'sw-farea'), commodityId: getVal(root, 'sw-fcom') });
      if (!rec) { root.querySelector('#sw-fname').focus(); return; }
      db.upsertField(rec);
      again();
    }),
    save: (root) => {
      const rec = fieldRecord({ name: getVal(root, 'sw-fname'), areaHa: getVal(root, 'sw-farea'), commodityId: getVal(root, 'sw-fcom') });
      if (rec) db.upsertField(rec);
    },
  }),

  storage: (data) => {
    const read = (root) => storageRecord({ name: getVal(root, 'sw-sname'), kind: getVal(root, 'sw-skind'), volumeM3: getVal(root, 'sw-scap'), commodityId: getVal(root, 'sw-scom'), openingStock: getVal(root, 'sw-sstock') });
    return {
      html: `<div class="sw-chips">${names(data.storages) || '<span class="sw-none">None yet</span>'}</div>
        ${field({ label: 'Name', id: 'sw-sname', placeholder: 'e.g. Silo 1' })}
        ${field({ label: 'Type', id: 'sw-skind', type: 'select', value: 'silo', options: [{ value: 'silo', label: 'Silo' }, { value: 'bunker', label: 'Bunker / shed' }] })}
        ${field({ label: 'Volume (m³)', id: 'sw-scap', type: 'number', step: '1', hint: 'Optional. The commodity’s test weight sets the most tonnes it holds. Measure it properly later in Storage.' })}
        ${field({ label: 'Holding now', id: 'sw-scom', type: 'select', value: '', options: options(data.commodities, 'Empty') })}
        ${field({ label: 'Tonnes in it now', id: 'sw-sstock', type: 'number', step: '0.1' })}
        <button type="button" class="btn secondary" id="sw-add">Add silo or bunker</button>`,
      wire: (root, again) => root.querySelector('#sw-add').addEventListener('click', () => {
        const rec = read(root);
        if (!rec) { root.querySelector('#sw-sname').focus(); return; }
        db.upsertStorage(rec);
        again();
      }),
      save: (root) => { const rec = read(root); if (rec) db.upsertStorage(rec); },
    };
  },

  contract: (data) => {
    if (!data.commodities.length) return { html: '<div class="sw-none">Add a commodity first, then come back to this.</div>', save: () => {} };
    return {
      html: `<div class="sw-chips">${data.sales.map((s) => `<span class="sw-chip">${esc(s.buyer || 'Contract')}</span>`).join('') || '<span class="sw-none">None yet</span>'}</div>
        ${field({ label: 'Buyer', id: 'sw-buyer' })}
        ${field({ label: 'Commodity', id: 'sw-com', type: 'select', value: data.commodities[0].id, options: options(data.commodities) })}
        ${field({ label: 'Tonnes', id: 'sw-tons', type: 'number', step: '1' })}
        ${field({ label: 'Price ($/t)', id: 'sw-price', type: 'number', step: '0.01' })}
        ${field({ label: 'Deliver by', id: 'sw-by', type: 'date' })}`,
      save: (root) => {
        const rec = saleRecord({ buyer: getVal(root, 'sw-buyer'), commodityId: getVal(root, 'sw-com'), tons: getNum(root, 'sw-tons'), price: getNum(root, 'sw-price'), date: todayLocal(), deliveryEnd: getVal(root, 'sw-by') });
        if (!rec) {
          if ((getVal(root, 'sw-buyer') || getVal(root, 'sw-tons'))) { toast('A contract needs a buyer and the tonnes'); return false; }
          return true;
        }
        db.upsertSale(rec);
        return true;
      },
    };
  },

  load: (data) => {
    const froms = [...data.fields.map((f) => ({ value: `field:${f.id}`, label: `${f.name} (paddock)` })), ...data.storages.map((s) => ({ value: `silo:${s.id}`, label: s.name }))];
    const tos = [...data.storages.map((s) => ({ value: `silo:${s.id}`, label: s.name })), ...data.sales.map((s) => ({ value: `sale:${s.id}`, label: `${s.buyer || 'Contract'} (contract)` }))];
    if (!froms.length || !tos.length) return { html: '<div class="sw-none">A load needs somewhere to come from and somewhere to go. Add a paddock or silo, and a silo or contract, then come back.</div>', save: () => {} };
    const end = (v) => { const [type, id] = String(v).split(':'); return { type, id }; };
    return {
      html: `${field({ label: 'Date', id: 'sw-date', type: 'date', value: todayLocal() })}
        ${field({ label: 'From', id: 'sw-from', type: 'select', value: froms[0].value, options: froms })}
        ${field({ label: 'To', id: 'sw-to', type: 'select', value: tos[0].value, options: tos })}
        ${field({ label: 'Tonnes', id: 'sw-ltons', type: 'number', step: '0.01' })}`,
      save: (root) => {
        if (!getNum(root, 'sw-ltons')) return true;
        const rec = loadRecord({ date: getVal(root, 'sw-date'), tons: getNum(root, 'sw-ltons'), from: end(getVal(root, 'sw-from')), to: end(getVal(root, 'sw-to')), data });
        if (!rec) { toast('Choose where it came from and where it went'); return false; }
        if (rec.froms[0].type === rec.tos[0].type && rec.froms[0].id === rec.tos[0].id) { toast('It cannot go to where it came from'); return false; }
        db.upsertMovement(rec);
        return true;
      },
    };
  },

  invoice: (data) => {
    const ready = invoiceable(data);
    if (!ready.length) return { html: '<div class="sw-none">No contract has loads delivered yet. Skip this for now; Make an invoice stays on the Getting started card.</div>', save: () => {} };
    return {
      html: `<div class="sw-pick">${ready.map((s) => `<button type="button" class="btn secondary sw-sale" data-sale="${esc(s.id)}">${esc(s.buyer || 'Contract')} &middot; ${esc(data.commodities.find((c) => c.id === s.commodityId)?.name || '')}</button>`).join('')}</div>`,
      wire: (root, again) => root.querySelectorAll('[data-sale]').forEach((el) => el.addEventListener('click', () => {
        const sale = db.get().sales.find((s) => s.id === el.dataset.sale);
        if (sale) openOver(() => openInvoiceListSheet(sale), again);
      })),
      save: () => {},
    };
  },
};
