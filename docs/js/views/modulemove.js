// Moving modules: picked cotton carted from the paddock to the gin yard.
//
// An ordinary movement (out of a paddock, into the gin yard, which counts modules) with the facts of the move on its
// `modules` record. The paddock leg is in estimated standard bales, from the weight and the turnout, so the paddock's
// production is in bales like everything else; the gin yard leg is in modules, which the ginning run takes out again.
//
// One move is one truck load. The driver gives the number of modules and the weight is estimated from what was picked on the
// paddock (its kilograms a module); when the load is weighed at the gin the weighbridge weight is typed over it and the load is final.

import { db } from '../storage.js?v=367';
import { num, esc, todayLocal } from '../fmt.js?v=367';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=367';
import { cleanModules, estimateBales, describeModules, DEFAULT_TURNOUT } from '../ginning.js?v=367';
import { pickedTotals, moduleEstimate, describeEstimate, avgModuleKg } from '../modulespicked.js?v=367';

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The gin yard is an ordinary Tally storage counting modules. When the farm has none, say so and make it in one tap, then open
 * the sheet again.
 */
export function offerGinYard(root, text, reopen) {
  root.innerHTML = `<div class="empty">${text}</div><button class="btn" id="mk-yard" style="margin-top:12px">Create "Gin yard"</button>`;
  root.querySelector('#mk-yard').addEventListener('click', () => {
    const cotton = db.get().commodities.find((c) => c.unit === 'bale');
    db.upsertStorage({ name: 'Gin yard', kind: 'tally', unitLabel: 'modules', openingStock: 0, ...(cotton ? { commodityId: cotton.id } : {}) });
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
  const fromLeg = existing?.froms?.[0];
  const toLeg = existing?.tos?.[0];

  openSheet(existing ? 'Edit module move' : 'Move modules', (root) => {
    if (!yards.length || !paddocks.length) {
      if (!yards.length) { offerGinYard(root, 'The modules are counted in a gin yard between the paddock and the gin. Create it here, or add a Tally storage in Storage.', () => openModuleMoveSheet(existing)); return; }
      root.innerHTML = `<div class="empty">Add the cotton paddocks first.</div>`;
      return;
    }
    root.innerHTML = `
      ${field({ label: 'Date', id: 'mm-date', type: 'date', value: existing?.date || todayLocal() })}
      ${field({ label: 'From paddock', id: 'mm-from', type: 'select', value: fromLeg?.id || '', options: [{ value: '', label: 'Select…' }, ...paddocks.map((f) => ({ value: f.id, label: f.name }))] })}
      <div class="field"><div class="hint" id="mm-field-note"></div></div>
      ${field({ label: 'To gin yard', id: 'mm-to', type: 'select', value: toLeg?.id || (yards.length === 1 ? yards[0].id : ''), options: [{ value: '', label: 'Select…' }, ...yards.map((s) => ({ value: s.id, label: s.name }))] })}
      <div class="grid-2">
        ${field({ label: 'Modules', id: 'mm-count', type: 'number', step: '1', value: mod.count || '' })}
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
      const fromId = getVal(root, 'mm-from');
      if (source === 'kg') kgTyped = String(getVal(root, 'mm-kg') ?? '').trim() !== '';
      const avgKg = avgKgFor(fromId);
      if (!kgTyped && avgKg > 0 && !(source === 'start' && existing)) {
        const n = getNum(root, 'mm-count');
        root.querySelector('#mm-kg').value = n > 0 ? Math.round(n * avgKg) : '';
      }
      root.querySelector('#mm-wstat').textContent = kgTyped
        ? 'Weighed: this is the weighbridge weight.'
        : (avgKg > 0 ? `Estimated from ${num(avgKg, 0)} kg a module. Type the weighbridge weight over it when the load is weighed.`
          : 'Type the weighbridge weight when the load is weighed. Log the modules picked on the paddock to have it estimated.');      if (!turnoutTyped) root.querySelector('#mm-turnout').value = fromId ? turnoutFor(fromId) : '';
      if (!balesTyped || source === 'kg' || source === 'turnout' || source === 'count' || source === 'from') {
        const b = estimateBales(getNum(root, 'mm-kg'), getNum(root, 'mm-turnout'));
        if (source !== 'bales') root.querySelector('#mm-bales').value = b > 0 ? round3(b) : '';
        if (source === 'kg' || source === 'turnout' || source === 'count' || source === 'from') balesTyped = false;
      }
      const f = fields.find((x) => x.id === fromId);
      const notes = [];
      if (f) {
        const pk = pickedTotals(f, db.get().movements.filter((m) => m.id !== existing?.id));
        if (pk.picked > 0) notes.push(`${num(pk.inField, 0)} of ${num(pk.picked, 0)} modules picked are still in ${f.name}${pk.inFieldKg ? ` (about ${num(pk.inFieldKg, 0)} kg)` : ''}.`);
        if (f.yieldMode !== 'actual') notes.push('This paddock is on an estimated yield, so these modules do not change its production yet. Set it to an actual yield when picking is finished.');
      }
      root.querySelector('#mm-field-note').textContent = notes.join(' ');
      const modules = getNum(root, 'mm-count');
      root.querySelector('#mm-line').textContent = describeModules({ count: modules, kg: getNum(root, 'mm-kg'), estBales: getNum(root, 'mm-bales') });
      const cotton = commodities.find((c) => c.id === f?.commodityId)?.cotton;
      const est = describeEstimate(moduleEstimate(cotton, getNum(root, 'mm-bales')));
      if (est) root.querySelector('#mm-line').textContent += `${root.querySelector('#mm-line').textContent ? ' · ' : ''}${est.split(' · ').slice(1).join(' · ')}`;
      const to = yards.find((s) => s.id === getVal(root, 'mm-to'));
      if (to && !existing) {
        const stock = db.get().movements.reduce((s, m) => s + (m.tos || []).filter((t) => t.type === 'silo' && t.id === to.id).reduce((a, t) => a + (Number(t.tons) || 0), 0)
          - (m.froms || []).filter((t) => t.type === 'silo' && t.id === to.id).reduce((a, t) => a + (Number(t.tons) || 0), 0), Number(to.openingStock) || 0);
        if (stock > 0) root.querySelector('#mm-line').textContent += `${root.querySelector('#mm-line').textContent ? ' · ' : ''}${num(stock, 0)} already in ${to.name}`;
      }
    };
    root.querySelector('#mm-from').addEventListener('change', () => sync('from'));
    root.querySelector('#mm-to').addEventListener('change', () => sync('to'));
    root.querySelector('#mm-count').addEventListener('input', () => sync('count'));
    root.querySelector('#mm-kg').addEventListener('input', () => sync('kg'));
    root.querySelector('#mm-turnout').addEventListener('input', () => sync('turnout'));
    root.querySelector('#mm-bales').addEventListener('input', () => sync('bales'));
    sync('start');

    root.querySelector('#mm-save').addEventListener('click', () => {
      const fromId = getVal(root, 'mm-from');
      const toId = getVal(root, 'mm-to');
      const count = getNum(root, 'mm-count');
      if (!fromId) { root.querySelector('#mm-from').focus(); return; }
      if (!toId) { root.querySelector('#mm-to').focus(); return; }
      if (!(count > 0)) { root.querySelector('#mm-count').focus(); return; }
      const estBales = round3(getNum(root, 'mm-bales'));
      const f = fields.find((x) => x.id === fromId);
      db.upsertMovement({
        id: existing?.id,
        date: getVal(root, 'mm-date'),
        froms: [{ type: 'field', id: fromId, tons: estBales }],
        tos: [{ type: 'silo', id: toId, tons: count }],
        ...(f?.commodityId ? { commodityId: f.commodityId } : {}),
        tons: estBales,
        weightStatus: kgTyped ? 'final' : 'estimate',
        truckRego: getVal(root, 'mm-truck')?.trim() || '',
        driver: getVal(root, 'mm-driver')?.trim() || '',
        notes: getVal(root, 'mm-notes')?.trim() || 'Modules',
        modules: cleanModules({ count, kg: getNum(root, 'mm-kg'), turnoutPct: getNum(root, 'mm-turnout'), estBales }),
      });
      closeSheet(); toast('Saved');
    });

    root.querySelector('#mm-del')?.addEventListener('click', () => {
      confirmDelete(`Delete this move of ${esc(describeModules(mod) || 'modules')}?`, () => {
        db.deleteMovement(existing.id);
        closeSheet(); toast('Deleted');
      });
    });
  });
}
