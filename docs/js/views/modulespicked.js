// Modules picked on a paddock: how many, their estimated weight and the turnout. The bales, the seed and the ginning follow.

import { db } from '../storage.js?v=389';
import { num, esc, todayLocal, shortDate } from '../fmt.js?v=389';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=389';
import { estimateBales, DEFAULT_TURNOUT } from '../ginning.js?v=389';
import { cleanPicked, moduleEstimate, describeEstimate } from '../modulespicked.js?v=389';
import { cleanCotton } from '../ginning.js?v=389';

const round3 = (n) => Math.round(n * 1000) / 1000;

export function openModulesPickedSheet(fieldId, existing = null) {
  const f = db.get().fields.find((x) => x.id === fieldId);
  if (!f) return;
  const commodity = db.get().commodities.find((c) => c.id === f.commodityId);
  const moduleKgDefault = cleanCotton(commodity?.cotton)?.moduleKg || 0;
  const turnoutDefault = Number(commodity?.cotton?.turnout) > 0 ? Number(commodity.cotton.turnout) : DEFAULT_TURNOUT;

  openSheet(existing ? 'Edit modules picked' : 'Modules picked', (root) => {
    root.innerHTML = `
      <div class="field"><div class="hint">${esc(f.name)}</div></div>
      ${field({ label: 'Date', id: 'mp-date', type: 'date', value: existing?.date || todayLocal() })}
      <div class="grid-2">
        ${field({ label: 'Modules', id: 'mp-count', type: 'number', step: '1', value: existing?.count || '' })}
        ${field({ label: 'Estimated weight (kg)', id: 'mp-kg', type: 'number', step: '1', value: existing?.kg || '', hint: moduleKgDefault > 0 ? `Starts at ${num(moduleKgDefault, 0)} kg a module` : 'Total of the modules' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Turnout (%)', id: 'mp-turnout', type: 'number', step: '0.1', value: existing?.turnoutPct || turnoutDefault, hint: 'Lint from the picked cotton' })}
        ${field({ label: 'Estimated bales', id: 'mp-bales', type: 'number', step: '0.1', value: existing?.estBales ? round3(existing.estBales) : '', hint: 'Standard 227 kg bales' })}
      </div>
      <div class="field"><div class="hint" id="mp-line"></div></div>
      <button class="btn" id="mp-save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn ghost-danger" id="mp-del" style="margin-top:12px">Delete</button>` : ''}
    `;

    let balesTyped = !!existing?.estBales;
    let kgTyped = !!existing?.kg;
    const sync = (source) => {
      if (source === 'kg') kgTyped = String(getVal(root, 'mp-kg') ?? '').trim() !== '';
      if (!kgTyped && moduleKgDefault > 0) {
        const n = getNum(root, 'mp-count');
        root.querySelector('#mp-kg').value = n > 0 ? Math.round(n * moduleKgDefault) : '';
      }
      if (source === 'bales') balesTyped = true;
      if (source === 'kg' || source === 'turnout' || source === 'count') balesTyped = false;
      if (!balesTyped) {
        const b = estimateBales(getNum(root, 'mp-kg'), getNum(root, 'mp-turnout'));
        root.querySelector('#mp-bales').value = b > 0 ? round3(b) : '';
      }
      const count = getNum(root, 'mp-count');
      const kg = getNum(root, 'mp-kg');
      const bits = [];
      if (count > 0 && kg > 0) bits.push(`${num(kg / count, 0)} kg a module`);
      const est = describeEstimate(moduleEstimate(commodity?.cotton, getNum(root, 'mp-bales')));
      if (est) bits.push(est);
      root.querySelector('#mp-line').textContent = bits.join(' · ');
    };
    ['mp-count', 'mp-kg', 'mp-turnout', 'mp-bales'].forEach((id) => {
      root.querySelector(`#${id}`).addEventListener('input', () => sync(id.slice(3)));
    });
    sync('start');

    const save = (list) => { db.upsertField({ id: f.id, modulesPicked: cleanPicked(list) }); };

    root.querySelector('#mp-save').addEventListener('click', () => {
      const count = getNum(root, 'mp-count');
      if (!(count > 0)) { root.querySelector('#mp-count').focus(); return; }
      const entry = {
        id: existing?.id || `mp${Date.now().toString(36)}`,
        date: getVal(root, 'mp-date'), count, kg: getNum(root, 'mp-kg'),
        turnoutPct: getNum(root, 'mp-turnout'), estBales: round3(getNum(root, 'mp-bales')),
      };
      const others = cleanPicked(db.get().fields.find((x) => x.id === f.id)?.modulesPicked).filter((p) => p.id !== entry.id);
      save([...others, entry].sort((a, b) => String(a.date).localeCompare(String(b.date))));
      closeSheet(); toast('Saved');
    });

    root.querySelector('#mp-del')?.addEventListener('click', () => {
      confirmDelete(`Delete the ${num(existing.count, 0)} modules picked on ${esc(shortDate(existing.date))}?`, () => {
        save(cleanPicked(db.get().fields.find((x) => x.id === f.id)?.modulesPicked).filter((p) => p.id !== existing.id));
        closeSheet(); toast('Deleted');
      });
    });
  });
}
