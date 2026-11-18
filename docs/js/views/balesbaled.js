// Bales baled on a hay paddock: the date, which cut or run, how many bales and their approximate weight.
// The weight starts at the bales times the average bale weight (the commodity's hay setting) until it is typed over.

import { db } from '../storage.js?v=369';
import { num, esc, todayLocal, shortDate } from '../fmt.js?v=369';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=369';
import { cleanBaled, describeBales, describeBaleSetting } from '../hay.js?v=369';

export function openBalesBaledSheet(fieldId, existing = null) {
  const f = db.get().fields.find((x) => x.id === fieldId);
  if (!f) return;
  const commodity = db.get().commodities.find((c) => c.id === f.commodityId);
  const baleKg = Number(commodity?.hay?.baleKg) > 0 ? Number(commodity.hay.baleKg) : 0;

  openSheet(existing ? 'Edit bales baled' : 'Bales baled', (root) => {
    root.innerHTML = `
      <div class="field"><div class="hint">${esc(f.name)}${commodity ? ` · ${esc(commodity.name)}` : ''}${describeBaleSetting(commodity?.hay) ? ` · ${esc(describeBaleSetting(commodity.hay))}` : ''}</div></div>
      ${field({ label: 'Date', id: 'bb-date', type: 'date', value: existing?.date || todayLocal() })}
      ${field({ label: 'Cut or run', id: 'bb-label', value: existing?.label || '', placeholder: 'e.g. Cut 2', hint: 'Optional' })}
      <div class="grid-2">
        ${field({ label: 'Bales', id: 'bb-bales', type: 'number', step: '1', value: existing?.bales || '' })}
        ${field({ label: 'Weight (kg)', id: 'bb-kg', type: 'number', step: '1', value: existing?.kg || '', hint: baleKg > 0 ? `Starts at ${num(baleKg, 0)} kg a bale` : 'Total of the bales, approximate' })}
      </div>
      <div class="field"><div class="hint" id="bb-line"></div></div>
      <button class="btn" id="bb-save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn ghost-danger" id="bb-del" style="margin-top:12px">Delete</button>` : ''}
    `;

    let kgTyped = !!existing?.kg;
    const sync = (source) => {
      if (source === 'kg') kgTyped = String(getVal(root, 'bb-kg') ?? '').trim() !== '';
      if (!kgTyped && baleKg > 0) {
        const n = getNum(root, 'bb-bales');
        root.querySelector('#bb-kg').value = n > 0 ? Math.round(n * baleKg) : '';
      }
      const bales = getNum(root, 'bb-bales');
      const kg = getNum(root, 'bb-kg');
      const bits = [describeBales(bales, kg)];
      if (bales > 0 && kg > 0) bits.push(`${num(kg / bales, 0)} kg a bale`);
      root.querySelector('#bb-line').textContent = bits.filter(Boolean).join(' · ');
    };
    root.querySelector('#bb-bales').addEventListener('input', () => sync('bales'));
    root.querySelector('#bb-kg').addEventListener('input', () => sync('kg'));
    sync('start');

    const save = (list) => { db.upsertField({ id: f.id, balesBaled: cleanBaled(list) }); };
    const current = () => cleanBaled(db.get().fields.find((x) => x.id === f.id)?.balesBaled);

    root.querySelector('#bb-save').addEventListener('click', () => {
      const bales = getNum(root, 'bb-bales');
      if (!(bales > 0)) { root.querySelector('#bb-bales').focus(); return; }
      const entry = {
        id: existing?.id || `bb${Date.now().toString(36)}`,
        date: getVal(root, 'bb-date'), label: getVal(root, 'bb-label')?.trim() || '', bales, kg: getNum(root, 'bb-kg'),
      };
      save([...current().filter((b) => b.id !== entry.id), entry].sort((a, b) => String(a.date).localeCompare(String(b.date))));
      closeSheet(); toast('Saved');
    });

    root.querySelector('#bb-del')?.addEventListener('click', () => {
      confirmDelete(`Delete the ${num(existing.bales, 0)} bales baled on ${esc(shortDate(existing.date))}?`, () => {
        save(current().filter((b) => b.id !== existing.id));
        closeSheet(); toast('Deleted');
      });
    });
  });
}

