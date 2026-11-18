// Moving modules: picked cotton carted from the paddock to the gin yard.
//
// An ordinary movement (out of a paddock, into the gin yard, which counts modules) with the facts of the move on its
// `modules` record. The paddock leg is in estimated standard bales, from the weight and the turnout, so the paddock's
// production is in bales like everything else; the gin yard leg is in modules, which the ginning run takes out again.
//
// One move is one truck load. The driver gives the number of modules and the weight is estimated from what was picked on the
// paddock (its kilograms a module); when the load is weighed at the gin the weighbridge weight is typed over it and the load is final.

import { db } from '../storage.js?v=416';
import { num, esc, todayLocal } from '../fmt.js?v=416';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=416';
import { cleanModules, moduleLegs, shareLoad, estimateBales, describeModules, DEFAULT_TURNOUT } from '../ginning.js?v=416';
import { pickedTotals, moduleEstimate, describeEstimate, avgModuleKg } from '../modulespicked.js?v=416';

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The gin yard is an ordinary Tally storage counting modules. When the farm has none, say so and make it in one tap, then open
 * the sheet again.
 */
export function offerGinYard(root, text, reopen) {
  root.innerHTML = `<div class="empty">${text}</div>
    ${field({ label: 'Gin yard name', id: 'mk-name', value: '', placeholder: 'e.g. Brighann gin yard', hint: 'Named after the gin, so each gin you use has its own yard' })}
    <button class="btn" id="mk-yard" style="margin-top:12px">Create gin yard</button>`;
  root.querySelector('#mk-yard').addEventListener('click', () => {
    const name = getVal(root, 'mk-name')?.trim();
    if (!name) { root.querySelector('#mk-name').focus(); return; }
    const cotton = db.get().commodities.find((c) => c.unit === 'bale');
    db.upsertStorage({ name, kind: 'tally', unitLabel: 'modules', openingStock: 0, ...(cotton ? { commodityId: cotton.id } : {}) });
    closeSheet();
    reopen();
  });
}

export function openModuleMoveSheet(existing = null) {
  const { fields, storages, commodities } = db.get();
  const yards = storages.filter((s) => s.kind === 'tally' && !s.deleted);
  // cotton paddocks first; a farm that has not set cotton up as bales still gets all its paddocks
  const baleIds = new Set(commodities.filter((c) => c.unit === 'bale').map((c) => c.id));
  const cottonFields = fields.filter((f) => baleIds.has(f.commodityId));
  const paddocks = cottonFields.length ? cottonFields : fields;
  const mod = cleanModules(existing?.modules) || { count: 0, kg: 0, turnoutPct: 0, estBales: 0 };
  const toLeg = existing?.tos?.[0];
  // the paddocks it came from: each with its own number of modules, as grain is taken from more than one field
  const startRows = existing ? moduleLegs(existing).map((l) => ({ id: l.fieldId, count: l.count })) : [];
  if (!startRows.length) startRows.push({ id: '', count: '' });

  openSheet(existing ? `Edit module move${existing.ticketNo ? ` #${existing.ticketNo}` : ''}` : 'Move modules', (root) => {
    if (!yards.length || !paddocks.length) {
      if (!yards.length) { offerGinYard(root, 'The modules are counted in a gin yard between the paddock and the gin. Name it after the gin, or add a Tally storage in Storage.', () => openModuleMoveSheet(existing)); return; }
      root.innerHTML = `<div class="empty">Add the cotton paddocks first.</div>`;
      return;
    }
    const rowHtml = (r) => `<div class="mm-row" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px">
        <div class="field" style="flex:2;margin-bottom:0"><label>From paddock</label>
          <select class="mm-f"><option value="">Select…</option>${paddocks.map((f) => `<option value="${esc(f.id)}" ${f.id === r.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="field" style="flex:1;margin-bottom:0"><label>Modules</label>
          <input type="number" step="1" inputmode="numeric" class="mm-n" value="${r.count || ''}" /></div>
        <button type="button" class="btn ghost-danger small mm-x" style="width:auto;margin:0;padding:8px 12px" aria-label="Remove this paddock">&times;</button>
      </div>`;
    root.innerHTML = `
      ${field({ label: 'Date', id: 'mm-date', type: 'date', value: existing?.date || todayLocal() })}
      <div id="mm-rows">${startRows.map(rowHtml).join('')}</div>
      <button type="button" class="btn secondary small" id="mm-add">+ Add another paddock</button>
      <div class="field"><div class="hint" id="mm-field-note"></div></div>
      ${field({ label: 'To gin yard', id: 'mm-to', type: 'select', value: toLeg?.id || (yards.length === 1 ? yards[0].id : ''), options: [{ value: '', label: 'Select…' }, ...yards.map((s) => ({ value: s.id, label: s.name })), { value: '__new', label: '+ Add another gin yard…' }] })}
      <div class="grid-2">
        <div class="field"><label>Modules in the load</label><div class="readout" id="mm-total">—</div></div>
        ${field({ label: 'Weight (kg)', id: 'mm-kg', type: 'number', step: '1', value: mod.kg || '', hint: 'Weighbridge weight' })}
      </div>
      <div class="field"><div class="hint" id="mm-wstat"></div></div>
      <div class="grid-2">
        ${field({ label: 'Turnout (%)', id: 'mm-turnout', type: 'number', step: '0.1', value: mod.turnoutPct || '', hint: 'Lint from the picked cotton' })}
        ${field({ label: 'Estimated bales', id: 'mm-bales', type: 'number', step: '0.1', value: mod.estBales ? round3(mod.estBales) : '', hint: 'Standard 227 kg bales' })}
      </div>
      <div class="field"><div class="hint" id="mm-line"></div></div>
      <div class="grid-2">
        ${field({ label: 'Truck', id: 'mm-truck', value: existing?.truckRego || '' })}
        ${field({ label: 'Driver', id: 'mm-driver', value: existing?.driver || '' })}
      </div>
      ${field({ label: 'Notes', id: 'mm-notes', value: existing?.notes === 'Modules' ? '' : existing?.notes || '' })}
      <button class="btn" id="mm-save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn ghost-danger" id="mm-del" style="margin-top:12px">Delete module move</button>` : ''}
    `;
    const rowsEl = root.querySelector('#mm-rows');
    const readRows = () => [...rowsEl.querySelectorAll('.mm-row')].map((row) => ({ id: row.querySelector('.mm-f').value, count: Number(row.querySelector('.mm-n').value) || 0 })).filter((r) => r.id && r.count > 0);
    const tidyRemove = () => rowsEl.querySelectorAll('.mm-x').forEach((b) => { b.style.visibility = rowsEl.querySelectorAll('.mm-row').length > 1 ? 'visible' : 'hidden'; });

    // the turnout starts from the commodity's setting, and the bales follow the weight until they are typed over
    const turnoutFor = (fieldId) => {
      const f = fields.find((x) => x.id === fieldId);
      const c = commodities.find((x) => x.id === f?.commodityId);
      return Number(c?.cotton?.turnout) > 0 ? Number(c.cotton.turnout) : DEFAULT_TURNOUT;
    };
    // the weight is an estimate (a module's average weight on that paddock) until one is typed in from the weighbridge
    const avgKgFor = (fieldId) => {
      const f = fields.find((x) => x.id === fieldId);
      return f ? avgModuleKg(f, commodities.find((c) => c.id === f.commodityId)) : 0;
    };
    let kgTyped = existing?.weightStatus === 'final';
    let balesTyped = !!mod.estBales && !!existing;
    let turnoutTyped = !!mod.turnoutPct && !!existing;
    const sync = (source) => {
      if (source === 'bales') balesTyped = true;
      if (source === 'turnout') turnoutTyped = true;
      if (source === 'kg') kgTyped = String(getVal(root, 'mm-kg') ?? '').trim() !== '';
      const rows = readRows();
      const loadModules = rows.reduce((s, r) => s + r.count, 0);
      root.querySelector('#mm-total').textContent = loadModules > 0 ? num(loadModules, 0) : '—';
      const several = new Set(rows.map((r) => r.id)).size > 1;
      // the estimated weight of the load: each paddock's modules at that paddock's weight
      const estKg = rows.reduce((s, r) => s + r.count * avgKgFor(r.id), 0);
      if (!kgTyped && estKg > 0 && !(source === 'start' && existing)) root.querySelector('#mm-kg').value = Math.round(estKg);
      if (!kgTyped && !(estKg > 0) && !(source === 'start' && existing)) root.querySelector('#mm-kg').value = '';
      const loadKg = getNum(root, 'mm-kg');
      const loadAvg = loadModules > 0 && loadKg > 0 ? loadKg / loadModules : 0;
      const firstAvg = rows.length ? avgKgFor(rows[0].id) : 0;
      root.querySelector('#mm-wstat').textContent = kgTyped
        ? `Weighed: this is the weighbridge weight.${loadAvg > 0 ? ` Average ${num(loadAvg, 0)} kg a module${!several && firstAvg > 0 ? ` (the paddock averages ${num(firstAvg, 0)} kg)` : ''}. ${several ? 'It is shared between the paddocks by their module weights.' : ''}` : ''}`
        : (estKg > 0 ? `Estimated from ${several ? 'each paddock\'s' : `${num(firstAvg, 0)} kg a`} module weight. Type the weighbridge weight over it when the load is weighed.`
          : 'Type the weighbridge weight when the load is weighed. Log the modules picked on the paddock to have it estimated.');
      if (!turnoutTyped) root.querySelector('#mm-turnout').value = rows.length ? turnoutFor(rows[0].id) : '';
      if (!balesTyped || source === 'kg' || source === 'turnout' || source === 'count' || source === 'from') {
        const b = estimateBales(getNum(root, 'mm-kg'), getNum(root, 'mm-turnout'));
        if (source !== 'bales') root.querySelector('#mm-bales').value = b > 0 ? round3(b) : '';
        if (source === 'kg' || source === 'turnout' || source === 'count' || source === 'from') balesTyped = false;
      }
      const notes = [];
      const estimated = [];
      const others = db.get().movements.filter((m) => m.id !== existing?.id);
      for (const id of [...new Set(rows.map((r) => r.id))]) {
        const f = fields.find((x) => x.id === id);
        if (!f) continue;
        const pk = pickedTotals(f, others);
        if (pk.picked > 0) notes.push(`${num(pk.inField, 0)} of ${num(pk.picked, 0)} modules picked are still in ${f.name}${pk.inFieldKg ? ` (about ${num(pk.inFieldKg, 0)} kg)` : ''}.`);
        if (f.yieldMode !== 'actual') estimated.push(f.name);
      }
      if (estimated.length) notes.push(`${estimated.join(' and ')} ${estimated.length > 1 ? 'are' : 'is'} on an estimated yield, so these modules do not change ${estimated.length > 1 ? 'their' : 'its'} production yet. Set ${estimated.length > 1 ? 'them' : 'it'} to an actual yield when picking is finished.`);
      root.querySelector('#mm-field-note').textContent = notes.join(' ');
      root.querySelector('#mm-line').textContent = describeModules({ count: loadModules, kg: getNum(root, 'mm-kg'), estBales: getNum(root, 'mm-bales') });
      const f0 = fields.find((x) => x.id === rows[0]?.id);
      const cotton = commodities.find((c) => c.id === f0?.commodityId)?.cotton;
      const est = describeEstimate(moduleEstimate(cotton, getNum(root, 'mm-bales')));
      if (est) root.querySelector('#mm-line').textContent += `${root.querySelector('#mm-line').textContent ? ' · ' : ''}${est.split(' · ').slice(1).join(' · ')}`;
      const to = yards.find((s) => s.id === getVal(root, 'mm-to'));
      if (to && !existing) {
        const stock = db.get().movements.reduce((s, m) => s + (m.tos || []).filter((t) => t.type === 'silo' && t.id === to.id).reduce((a, t) => a + (Number(t.tons) || 0), 0)
          - (m.froms || []).filter((t) => t.type === 'silo' && t.id === to.id).reduce((a, t) => a + (Number(t.tons) || 0), 0), Number(to.openingStock) || 0);
        if (stock > 0) root.querySelector('#mm-line').textContent += `${root.querySelector('#mm-line').textContent ? ' · ' : ''}${num(stock, 0)} already in ${to.name}`;
      }
    };
    rowsEl.addEventListener('change', (e) => { if (e.target.classList.contains('mm-f')) sync('from'); });
    rowsEl.addEventListener('input', (e) => { if (e.target.classList.contains('mm-n')) sync('count'); });
    rowsEl.addEventListener('click', (e) => {
      if (!e.target.closest('.mm-x') || rowsEl.querySelectorAll('.mm-row').length <= 1) return;
      e.target.closest('.mm-row').remove();
      tidyRemove(); sync('count');
    });
    root.querySelector('#mm-add').addEventListener('click', () => {
      rowsEl.insertAdjacentHTML('beforeend', rowHtml({ id: '', count: '' }));
      tidyRemove();
      rowsEl.lastElementChild.querySelector('.mm-f').focus();
    });
    root.querySelector('#mm-to').addEventListener('change', () => {
      if (getVal(root, 'mm-to') === '__new') { offerGinYard(root, 'Name the gin yard for the other gin.', () => openModuleMoveSheet(existing)); return; }
      sync('to');
    });
    root.querySelector('#mm-kg').addEventListener('input', () => sync('kg'));
    root.querySelector('#mm-turnout').addEventListener('input', () => sync('turnout'));
    root.querySelector('#mm-bales').addEventListener('input', () => sync('bales'));
    tidyRemove();
    sync('start');

    root.querySelector('#mm-save').addEventListener('click', () => {
      const toId = getVal(root, 'mm-to');
      const rows = readRows();
      if (!rows.length) { (rowsEl.querySelector('.mm-f').value ? rowsEl.querySelector('.mm-n') : [...rowsEl.querySelectorAll('.mm-f')].find((s) => !s.value) || rowsEl.querySelector('.mm-f')).focus(); return; }
      if (!toId) { root.querySelector('#mm-to').focus(); return; }
      const count = rows.reduce((s, r) => s + r.count, 0);
      const estBales = round3(getNum(root, 'mm-bales'));
      const totalKg = getNum(root, 'mm-kg');
      const legs = shareLoad(rows, totalKg, estBales, avgKgFor);
      const f = fields.find((x) => x.id === legs[0].id);
      db.upsertMovement({
        id: existing?.id,
        date: getVal(root, 'mm-date'),
        froms: legs.map((l) => ({ type: 'field', id: l.id, tons: l.bales })),
        tos: [{ type: 'silo', id: toId, tons: count }],
        ...(moveCommodityId(f, toId) ? { commodityId: moveCommodityId(f, toId) } : {}),
        tons: estBales,
        weightStatus: kgTyped ? 'final' : 'estimate',
        truckRego: getVal(root, 'mm-truck')?.trim() || '',
        driver: getVal(root, 'mm-driver')?.trim() || '',
        notes: getVal(root, 'mm-notes')?.trim() || 'Modules',
        modules: cleanModules({ count, kg: totalKg, turnoutPct: getNum(root, 'mm-turnout'), estBales, fields: legs.map((l) => ({ id: l.id, count: l.count, kg: l.kg, bales: l.bales })) }),
      });
      closeSheet(); toast('Saved');
    });

    // a module move is cotton: the paddock's own commodity when it is a bale one, otherwise cotton, otherwise the gin yard's
    const moveCommodityId = (f, toId) => {
      const cotton = commodities.find((c) => c.unit === 'bale');
      if (f?.commodityId && baleIds.has(f.commodityId)) return f.commodityId;
      return cotton?.id || yards.find((y) => y.id === toId)?.commodityId || f?.commodityId || '';
    };

    root.querySelector('#mm-del')?.addEventListener('click', () => {
      confirmDelete(`Delete this move of ${esc(describeModules(mod) || 'modules')}?`, () => {
        db.deleteMovement(existing.id);
        closeSheet(); toast('Deleted');
      });
    });
  });
}
