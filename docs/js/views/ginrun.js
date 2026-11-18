// The ginning run: round modules in, lint bales and seed out, and the gin's invoice.
//
// Saved as an ordinary movement (modules out of the gin yard; lint and seed out to a storage or a contract) with the facts
// of the run on its `gin` record, so contracts, storages and the movement list all see it with no special cases. Lint is
// counted in standard 227 kg bales and is allocated by bale range: the first and last bale number of each lot sent to a
// contract or a storage, which should add up to the bales pressed. The gin's invoice is saved as a bill when we pay it
// (see ginning.js).

import { db } from '../storage.js?v=369';
import { num, money, esc, todayLocal, dmy } from '../fmt.js?v=369';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, notify, askConfirm } from '../ui.js?v=369';
import { activeSales } from '../paidsales.js?v=369';
import { storageLedgerStock } from '../derived.js?v=369';
import { offerGinYard } from './modulemove.js?v=369';
import {
  STD_BALE_KG, cleanGin, stdBales, turnoutPct, seedTonnes, seedKgPerBale, ginInvoice,
  baleRangeCount, allocateLint, allocationProblems, padOffBy,
} from '../ginning.js?v=369';

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The storages and contracts a run's lint or seed can go to, as one pick list. */
function targetOptions({ storages, sales, commodities }, unit) {
  const unitOf = (id) => commodities.find((c) => c.id === id)?.unit === 'bale' ? 'bale' : 't';
  const stores = storages.filter((s) => !s.deleted && s.kind !== 'tally').map((s) => ({ value: `silo:${s.id}`, label: s.name }));
  const contracts = activeSales(sales)
    .filter((s) => unitOf(s.commodityId) === unit)
    .map((s) => ({ value: `sale:${s.id}`, label: `Contract: ${s.buyer || 'No buyer'}${s.contractNo ? ` #${s.contractNo}` : ''}` }));
  return [{ value: '', label: 'Not allocated yet' }, ...stores, ...contracts];
}

const legValue = (leg) => (leg ? `${leg.type}:${leg.id}` : '');
const parseTarget = (v) => {
  const [type, ...rest] = String(v || '').split(':');
  return type && rest.length ? { type, id: rest.join(':') } : null;
};

export function openGinRunSheet(existing = null) {
  const data = db.get();
  const { storages, commodities } = data;
  const tally = storages.filter((s) => s.kind === 'tally');
  const gin = cleanGin(existing?.gin) || cleanGin({ ginName: '', stdBaleKg: STD_BALE_KG, gstOnGin: true });
  const lintCommodity = commodities.find((c) => c.unit === 'bale');
  const seedOpts = targetOptions(data, 't');
  const lintOpts = targetOptions(data, 'bale');
  const yardLeg = existing?.froms?.[0];
  // a run saved with allocations has them; an older one had its lint leg first and its seed leg second
  const startAllocs = gin.allocations.length ? gin.allocations : [{ to: legValue(existing?.tos?.[0]), baleFrom: '', baleTo: '', bales: 0, location: '', kg: 0 }];
  const seedStart = gin.seedTo || legValue(existing?.tos?.[1]);

  const kindOf = (to) => (String(to).startsWith('sale:') ? 'sale' : String(to).startsWith('silo:') ? 'silo' : '');
  const optionsFor = (kind, to) => {
    const list = kind === 'sale' ? lintOpts.filter((o) => o.value.startsWith('sale:'))
      : kind === 'silo' ? lintOpts.filter((o) => o.value.startsWith('silo:'))
        : [];
    const head = kind === 'sale' ? 'Choose a contract…' : 'Choose a storage…';
    return [{ value: '', label: head }, ...list].map((o) => `<option value="${esc(o.value)}" ${o.value === to ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
  };
  const allocRow = (a) => {
    const kind = kindOf(a.to);
    return `
    <div class="field al-row">
      <select class="al-kind" aria-label="Lint goes to a contract or a storage">
        <option value="" ${kind === '' ? 'selected' : ''}>Not allocated yet</option>
        <option value="silo" ${kind === 'silo' ? 'selected' : ''}>To a storage</option>
        <option value="sale" ${kind === 'sale' ? 'selected' : ''}>To a contract</option>
      </select>
      <select class="al-to" aria-label="Which one" style="${kind ? '' : 'display:none'}">${optionsFor(kind, a.to)}</select>
      <input class="al-loc" type="text" value="${esc(a.location || '')}" placeholder="Location in the storage, e.g. Bay 3" aria-label="Location in the storage" style="${kind === 'silo' ? '' : 'display:none'}" />
      <div class="al-range">
        <input class="al-from" type="text" value="${esc(a.baleFrom)}" placeholder="First bale" aria-label="First bale number" autocapitalize="characters" />
        <input class="al-last" type="text" value="${esc(a.baleTo)}" placeholder="Last bale" aria-label="Last bale number" autocapitalize="characters" />
        <button type="button" class="btn ghost-danger small al-del" aria-label="Remove this lot">&times;</button>
      </div>
      <label class="al-lab" style="display:block;font-size:12px;color:var(--text-dim);margin:0 0 4px">Weight of these bales (kg)</label>
      <input class="al-kg" type="number" step="1" inputmode="decimal" value="${a.kg ? esc(String(a.kg)) : ''}" placeholder="Weight of these bales (kg)" aria-label="Weight of these bales in kg" />
      <div class="meta al-count"></div>
    </div>`;
  };

  openSheet(existing ? 'Edit ginning run' : 'Log ginning', (root) => {
    if (!tally.length) {
      offerGinYard(root, 'The modules are moved to a gin yard from the paddock, then ginned from it. Name it after the gin, or add a Tally storage in Storage.', () => openGinRunSheet(existing));
      return;
    }
    root.innerHTML = `
      ${field({ label: 'Date', id: 'g-date', type: 'date', value: existing?.date || todayLocal() })}
      <div class="grid-2">
        ${field({ label: 'Gin', id: 'g-gin', value: gin.ginName, placeholder: 'e.g. Brighann Ginning' })}
        ${field({ label: 'Gin invoice no.', id: 'g-inv', value: gin.invoiceNo, placeholder: 'e.g. I053/23' })}
      </div>

      <h3 style="margin:14px 0 6px">Modules in</h3>
      ${field({ label: 'Gin yard', id: 'g-from', type: 'select', value: yardLeg?.id || '', options: [{ value: '', label: 'Select…' }, ...tally.map((s) => ({ value: s.id, label: s.name }))], hint: 'Where the modules being ginned are counted' })}
      <div class="field" style="margin-top:-6px"><div class="hint" id="g-yard-note"></div></div>
      <div class="grid-2">
        ${field({ label: 'Modules ginned', id: 'g-modules', type: 'number', step: '1', value: gin.modules || '' })}
        ${field({ label: 'Module weight (kg)', id: 'g-module-kg', type: 'number', step: '1', value: gin.moduleKg || '', hint: 'Total of all modules' })}
      </div>

      <h3 style="margin:14px 0 6px">Lint out</h3>
      <div class="grid-2">
        ${field({ label: 'Bales pressed', id: 'g-bales', type: 'number', step: '1', value: gin.physicalBales || '', hint: 'The count on the pad' })}
        ${field({ label: 'Lint weight (kg)', id: 'g-lint-kg', type: 'number', step: '1', value: gin.lintKg || '', hint: 'Total of all bales' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'First bale', id: 'g-bale-from', value: gin.baleFrom, placeholder: 'BG027234' })}
        ${field({ label: 'Last bale', id: 'g-bale-to', value: gin.baleTo, placeholder: 'BG027626' })}
      </div>
      <div class="field"><div class="hint" id="g-std-line"></div></div>

      <h3 style="margin:14px 0 6px">Lint goes to</h3>
      <div class="field" style="margin-bottom:8px"><div class="hint">Each lot goes to a storage (say where in it) or to a bale contract. Give its bale numbers and its weight. To split the run, add a lot for each place.</div></div>
      <div class="field" style="margin:-2px 0 8px"><div class="hint" id="g-pad-note"></div></div>
      <div id="g-allocs">${startAllocs.map(allocRow).join('')}</div>
      <button type="button" class="btn secondary small" id="g-al-add" style="width:auto">+ Split to another lot</button>
      <div class="hint" id="g-al-problems" style="color:var(--danger);margin-top:8px"></div>

      <h3 style="margin:14px 0 6px">Seed out</h3>
      ${field({ label: 'Seed weight (kg)', id: 'g-seed-kg', type: 'number', step: '1', value: gin.seedKg || '', hint: 'The gin\'s estimate is on its invoice' })}
      ${field({ label: 'Seed goes to', id: 'g-seed-to', type: 'select', value: seedStart, options: seedOpts })}

      <h3 style="margin:14px 0 6px">Gin charges (per standard bale)</h3>
      <div class="grid-2">
        ${field({ label: 'Ginning ($/bale)', id: 'g-rate', type: 'number', step: '0.01', value: gin.ginRate || '' })}
        ${field({ label: 'Research levy ($/bale)', id: 'g-research', type: 'number', step: '0.01', value: gin.researchLevy || '' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Voluntary levy ($/bale)', id: 'g-vol', type: 'number', step: '0.01', value: gin.voluntaryLevy || '', hint: 'Cotton Australia, often about $1.50' })}
        <div class="field"><label>&nbsp;</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="g-gst" ${gin.gstOnGin ? 'checked' : ''} style="width:18px;height:18px" /> GST on ginning</label></div>
      </div>
      <div class="card" style="margin:0 0 10px;padding:10px 12px"><div id="g-invoice-line" class="meta"></div></div>
      ${field({ label: 'Who pays the gin invoice', id: 'g-paid-by', type: 'select', value: existing ? gin.paidBy : (parseTarget(startAllocs[0].to)?.type === 'sale' ? 'buyer' : 'us'), options: [{ value: 'us', label: 'We pay it (saved as a bill)' }, { value: 'buyer', label: 'The lint buyer pays it and takes it off the lint payment' }], hint: 'Cotton sold to a merchant is usually ginned on their account. Cotton not yet sold is on yours.' })}
      <div class="field"><div class="hint" id="g-paid-note"></div></div>
      ${field({ label: 'Notes', id: 'g-notes', value: existing?.notes || '' })}
      <button class="btn" id="g-save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn ghost-danger" id="g-del" style="margin-top:12px">Delete ginning run</button>` : ''}
    `;

    const allocsEl = root.querySelector('#g-allocs');
    const readAllocs = () => Array.from(allocsEl.querySelectorAll('.al-row')).map((row) => ({
      to: row.querySelector('.al-kind').value ? row.querySelector('.al-to').value : '',
      location: row.querySelector('.al-kind').value === 'silo' ? row.querySelector('.al-loc').value : '',
      kg: Number(row.querySelector('.al-kg').value) || 0,
      baleFrom: row.querySelector('.al-from').value, baleTo: row.querySelector('.al-last').value,
      bales: baleRangeCount(row.querySelector('.al-from').value, row.querySelector('.al-last').value) ?? 0,
    }));
    const read = () => cleanGin({
      ginName: getVal(root, 'g-gin'), invoiceNo: getVal(root, 'g-inv'),
      modules: getNum(root, 'g-modules'), moduleKg: getNum(root, 'g-module-kg'),
      physicalBales: getNum(root, 'g-bales'), lintKg: getNum(root, 'g-lint-kg'), seedKg: getNum(root, 'g-seed-kg'),
      stdBaleKg: gin.stdBaleKg,
      baleFrom: getVal(root, 'g-bale-from'), baleTo: getVal(root, 'g-bale-to'),
      ginRate: getNum(root, 'g-rate'), researchLevy: getNum(root, 'g-research'), voluntaryLevy: getNum(root, 'g-vol'),
      gstOnGin: root.querySelector('#g-gst').checked,
      paidBy: getVal(root, 'g-paid-by'),
      allocations: readAllocs(),
      seedTo: getVal(root, 'g-seed-to'),
      ...(gin.payableId ? { payableId: gin.payableId } : {}),
    });

    const paint = () => {
      const g = read();
      const yard = tally.find((s) => s.id === getVal(root, 'g-from'));
      root.querySelector('#g-yard-note').textContent = yard ? `${num(storageLedgerStock(yard, db.get().movements), 0)} modules in ${yard.name} now` : '';
      const bales = stdBales(g.lintKg, g.stdBaleKg);
      const bits = [];
      if (bales > 0) bits.push(`<strong>${num(bales, 2)} standard bales</strong> (${g.stdBaleKg} kg each)`);
      if (g.lintKg && g.moduleKg) bits.push(`turnout ${num(turnoutPct(g.lintKg, g.moduleKg), 1)}%`);
      if (g.seedKg && g.lintKg) bits.push(`${num(seedTonnes(g.seedKg), 2)} t seed, ${num(seedKgPerBale(g.lintKg, g.seedKg, g.stdBaleKg), 0)} kg a bale`);
      const range = baleRangeCount(g.baleFrom, g.baleTo);
      if (range !== null) bits.push(`range is ${range} bales`);
      root.querySelector('#g-std-line').innerHTML = bits.join(' · ') || 'Standard bales are worked out from the lint weight.';

      // each lot: its bales and its standard bales
      const rows = allocsEl.querySelectorAll('.al-row');
      const split = allocateLint(g);
      let k = 0;
      rows.forEach((row) => {
        // blank lots are dropped when saved, so they have no share to show
        const blank = !row.querySelector('.al-to').value && !row.querySelector('.al-from').value && !row.querySelector('.al-last').value && !row.querySelector('.al-kg').value;
        const a = blank && rows.length > 1 ? null : split[Math.min(k++, split.length - 1)];
        row.querySelector('.al-count').textContent = a && (a.bales || a.kg) ? [a.bales ? `${a.bales} bales` : '', a.kg ? `${num(a.kg, 0)} kg${a.weighed ? '' : ' (share of the run)'}` : '', `${num(a.std, 2)} × 227 kg bales`].filter(Boolean).join(' · ') : '';
        row.querySelector('.al-kg').placeholder = rows.length === 1 && g.lintKg ? `${num(g.lintKg, 0)} kg (the whole run)` : 'Weight of these bales (kg)';
        row.querySelector('.al-from').placeholder = rows.length === 1 && g.baleFrom ? g.baleFrom : 'First bale';
        row.querySelector('.al-last').placeholder = rows.length === 1 && g.baleTo ? g.baleTo : 'Last bale';
        row.querySelector('.al-del').style.display = rows.length > 1 ? '' : 'none';
      });
      root.querySelector('#g-al-problems').textContent = allocationProblems(g).join(' ');
      const off = padOffBy(getVal(root, 'g-date'), 7);
      root.querySelector('#g-pad-note').textContent = off ? `Cotton should be off the gin pad by ${dmy(off)}, seven days after ginning.` : '';

      const inv = ginInvoice(g);
      root.querySelector('#g-invoice-line').innerHTML = inv.bales > 0
        ? `Gin invoice: ginning ${money(inv.ginning, 2)}${inv.gst ? ` + GST ${money(inv.gst, 2)}` : ''}, levies ${money(inv.levies, 2)}. <strong>${money(inv.total, 2)}</strong> to pay.`
        : 'Enter the lint weight and the rates to see the gin invoice.';
      const buyerPays = g.paidBy === 'buyer';
      const toContract = readAllocs().some((a) => parseTarget(a.to)?.type === 'sale');
      root.querySelector('#g-paid-note').innerHTML = !buyerPays ? ''
        : toContract ? `Taken off the lint payment on the contract, for the bales that go there. Ex GST ${money(inv.exGst, 2)} for the whole run. No bill is saved.`
          : 'Choose the contract the lint goes to above, so the charges can be taken off its payment.';
    };

    let paidByChosen = !!existing;
    root.querySelector('#g-paid-by').addEventListener('change', () => { paidByChosen = true; });
    root.addEventListener('change', (e) => {
      if (e.target.classList?.contains('al-kind')) {
        const row = e.target.closest('.al-row');
        const kind = e.target.value;
        const to = row.querySelector('.al-to');
        to.innerHTML = optionsFor(kind, '');
        to.style.display = kind ? '' : 'none';
        row.querySelector('.al-loc').style.display = kind === 'silo' ? '' : 'none';
        // a contract is the likely place when there is only one
        if (kind === 'sale' && to.options.length === 2) to.selectedIndex = 1;
      }
      if (!paidByChosen && (e.target.classList?.contains('al-to') || e.target.classList?.contains('al-kind'))) {
        root.querySelector('#g-paid-by').value = readAllocs().some((a) => parseTarget(a.to)?.type === 'sale') ? 'buyer' : 'us';
      }
      paint();
    });
    root.addEventListener('input', paint);
    root.querySelector('#g-al-add').addEventListener('click', () => {
      allocsEl.insertAdjacentHTML('beforeend', allocRow({ to: '', baleFrom: '', baleTo: '', location: '', kg: 0 }));
      paint();
      allocsEl.lastElementChild.querySelector('.al-from').focus();
    });
    allocsEl.addEventListener('click', (e) => {
      if (!e.target.closest('.al-del')) return;
      e.target.closest('.al-row').remove();
      paint();
    });
    paint();

    root.querySelector('#g-save').addEventListener('click', async () => {
      const fromId = getVal(root, 'g-from');
      const g = read();
      if (!fromId) { root.querySelector('#g-from').focus(); return; }
      if (!g.modules) { root.querySelector('#g-modules').focus(); return; }
      const bales = round3(stdBales(g.lintKg, g.stdBaleKg));
      if (!(bales > 0)) { root.querySelector('#g-lint-kg').focus(); return; }
      const problems = allocationProblems(g);
      if (problems.length && !(await askConfirm(`${problems.join(' ')} Save it anyway?`, { confirmLabel: 'Save anyway' }))) return;

      const seedT = round3(seedTonnes(g.seedKg));
      const seedTo = parseTarget(g.seedTo);
      const tos = [];
      for (const a of allocateLint(g)) {
        const target = parseTarget(a.to);
        if (target && a.std > 0) tos.push({ ...target, tons: round3(a.std) });
      }
      if (seedTo && seedT > 0) tos.push({ ...seedTo, tons: seedT });

      // the gin's invoice, kept as a bill when we pay it, so what ginning cost is in the books
      const inv = ginInvoice(g);
      let payableId = g.payableId;
      if (g.paidBy === 'us' && inv.bales > 0) {
        const bill = {
          kind: 'other', supplier: g.ginName || 'Gin', reference: g.invoiceNo, invoiceDate: getVal(root, 'g-date'),
          amount: inv.exGst, gst: inv.gst, tons: round3(inv.bales), rate: g.ginRate,
          notes: `Ginning run: ${num(inv.bales, 2)} standard bales. Ginning ${money(inv.ginning, 2)}, levies ${money(inv.levies, 2)}.`,
        };
        const same = payableId && db.getPayables().find((p) => p.id === payableId);
        payableId = db.upsertPayable(same ? { ...bill, id: payableId } : bill);
      }

      if (g.paidBy === 'buyer' && payableId) notify('This run was saved as a bill before. The bill is still in Payables: delete it there so the gin is not counted twice.');
      db.upsertMovement({
        id: existing?.id,
        date: getVal(root, 'g-date'),
        froms: [{ type: 'silo', id: fromId, tons: g.modules }],
        tos,
        ...(lintCommodity ? { commodityId: tally.find((s) => s.id === fromId)?.commodityId || lintCommodity.id } : {}),
        tons: bales,
        weightStatus: 'final',
        notes: getVal(root, 'g-notes')?.trim() || 'Ginning',
        gin: { ...g, ...(payableId ? { payableId } : {}) },
      });
      closeSheet(); toast('Saved');
    });

    root.querySelector('#g-del')?.addEventListener('click', () => {
      confirmDelete('Delete this ginning run?', () => {
        db.deleteMovement(existing.id);
        closeSheet(); toast('Deleted');
        if (gin.payableId) notify('The gin invoice saved as a bill is still in Payables. Delete it there if it is not wanted.');
      });
    });
  });
}
