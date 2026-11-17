// The ginning run: round modules in, lint bales and seed out, and the gin's invoice.
//
// Saved as an ordinary movement (modules out of the gin yard; lint and seed out to a storage or a contract) with the facts
// of the run on its `gin` record, so contracts, storages and the movement list all see it with no special cases. Lint is
// counted in standard 227 kg bales. The gin's invoice is saved as a bill, so what ginning cost is in the books (see ginning.js).

import { db } from '../storage.js?v=360';
import { num, money, esc, todayLocal } from '../fmt.js?v=360';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, notify } from '../ui.js?v=360';
import { activeSales } from '../paidsales.js?v=360';
import { STD_BALE_KG, cleanGin, stdBales, turnoutPct, seedTonnes, seedKgPerBale, ginInvoice } from '../ginning.js?v=360';

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The storages and contracts a run's lint or seed can go to, as one pick list. */
function targetOptions({ storages, sales, commodities }, unit) {
  const unitOf = (id) => commodities.find((c) => c.id === id)?.unit === 'bale' ? 'bale' : 't';
  const stores = storages.filter((s) => !s.deleted).map((s) => ({ value: `silo:${s.id}`, label: s.name }));
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
  // the lint leg is the one in bales (first to), the seed leg the second
  const lintLeg = existing?.tos?.[0];
  const seedLeg = existing?.tos?.[1];

  openSheet(existing ? 'Edit ginning run' : 'Log ginning', (root) => {
    if (!tally.length) {
      root.innerHTML = `<div class="empty">Add the gin yard first: in Storage, add a Tally storage (for example "Gin yard", counting modules). The modules are moved there from the paddock, then ginned from it.</div>`;
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
        ${field({ label: 'Bale from', id: 'g-bale-from', value: gin.baleFrom, placeholder: 'BG027234' })}
        ${field({ label: 'Bale to', id: 'g-bale-to', value: gin.baleTo, placeholder: 'BG027626' })}
      </div>
      <div class="field"><div class="hint" id="g-std-line"></div></div>
      ${field({ label: 'Lint goes to', id: 'g-lint-to', type: 'select', value: legValue(lintLeg), options: lintOpts, hint: 'A storage, or a bale contract it is delivered against' })}

      <h3 style="margin:14px 0 6px">Seed out</h3>
      ${field({ label: 'Seed weight (kg)', id: 'g-seed-kg', type: 'number', step: '1', value: gin.seedKg || '', hint: 'The gin\'s estimate is on its invoice' })}
      ${field({ label: 'Seed goes to', id: 'g-seed-to', type: 'select', value: legValue(seedLeg), options: seedOpts })}

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
      ${field({ label: 'Who pays the gin invoice', id: 'g-paid-by', type: 'select', value: existing ? gin.paidBy : (lintLeg?.type === 'sale' ? 'buyer' : 'us'), options: [{ value: 'us', label: 'We pay it (saved as a bill)' }, { value: 'buyer', label: 'The lint buyer pays it and takes it off the lint payment' }], hint: 'Cotton sold to a merchant is usually ginned on their account. Cotton not yet sold is on yours.' })}
      <div class="field"><div class="hint" id="g-paid-note"></div></div>
      ${field({ label: 'Notes', id: 'g-notes', value: existing?.notes || '' })}
      <button class="btn" id="g-save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn ghost-danger" id="g-del" style="margin-top:12px">Delete ginning run</button>` : ''}
    `;

    const read = () => cleanGin({
      ginName: getVal(root, 'g-gin'), invoiceNo: getVal(root, 'g-inv'),
      modules: getNum(root, 'g-modules'), moduleKg: getNum(root, 'g-module-kg'),
      physicalBales: getNum(root, 'g-bales'), lintKg: getNum(root, 'g-lint-kg'), seedKg: getNum(root, 'g-seed-kg'),
      stdBaleKg: gin.stdBaleKg,
      baleFrom: getVal(root, 'g-bale-from'), baleTo: getVal(root, 'g-bale-to'),
      ginRate: getNum(root, 'g-rate'), researchLevy: getNum(root, 'g-research'), voluntaryLevy: getNum(root, 'g-vol'),
      gstOnGin: root.querySelector('#g-gst').checked,
      paidBy: getVal(root, 'g-paid-by'),
      ...(gin.payableId ? { payableId: gin.payableId } : {}),
    });
    const paint = () => {
      const g = read();
      const bales = stdBales(g.lintKg, g.stdBaleKg);
      const bits = [];
      if (bales > 0) bits.push(`<strong>${num(bales, 2)} standard bales</strong> (${g.stdBaleKg} kg each)`);
      if (g.lintKg && g.moduleKg) bits.push(`turnout ${num(turnoutPct(g.lintKg, g.moduleKg), 1)}%`);
      if (g.seedKg && g.lintKg) bits.push(`${num(seedTonnes(g.seedKg), 2)} t seed, ${num(seedKgPerBale(g.lintKg, g.seedKg, g.stdBaleKg), 0)} kg a bale`);
      root.querySelector('#g-std-line').innerHTML = bits.join(' · ') || 'Standard bales are worked out from the lint weight.';
      const inv = ginInvoice(g);
      root.querySelector('#g-invoice-line').innerHTML = inv.bales > 0
        ? `Gin invoice: ginning ${money(inv.ginning, 2)}${inv.gst ? ` + GST ${money(inv.gst, 2)}` : ''}, levies ${money(inv.levies, 2)}. <strong>${money(inv.total, 2)}</strong> to pay.`
        : 'Enter the lint weight and the rates to see the gin invoice.';
      const buyerPays = getVal(root, 'g-paid-by') === 'buyer';
      const toContract = parseTarget(getVal(root, 'g-lint-to'))?.type === 'sale';
      root.querySelector('#g-paid-note').innerHTML = !buyerPays ? ''
        : toContract ? `Taken off the lint payment on that contract: ${money(inv.exGst, 2)} ex GST. No bill is saved.`
          : 'Choose the contract the lint goes to above, so the charges can be taken off its payment.';
    };
    let paidByChosen = !!existing;
    root.querySelector('#g-paid-by').addEventListener('change', () => { paidByChosen = true; });
    root.querySelector('#g-lint-to').addEventListener('change', () => {
      if (paidByChosen) return;
      root.querySelector('#g-paid-by').value = parseTarget(getVal(root, 'g-lint-to'))?.type === 'sale' ? 'buyer' : 'us';
    });
    root.addEventListener('input', paint);
    root.addEventListener('change', paint);
    paint();

    root.querySelector('#g-save').addEventListener('click', () => {
      const fromId = getVal(root, 'g-from');
      const g = read();
      if (!fromId) { root.querySelector('#g-from').focus(); return; }
      if (!g.modules) { root.querySelector('#g-modules').focus(); return; }
      const bales = round3(stdBales(g.lintKg, g.stdBaleKg));
      const seedT = round3(seedTonnes(g.seedKg));
      const lintTo = parseTarget(getVal(root, 'g-lint-to'));
      const seedTo = parseTarget(getVal(root, 'g-seed-to'));
      const tos = [];
      if (lintTo && bales > 0) tos.push({ ...lintTo, tons: bales });
      if (seedTo && seedT > 0) tos.push({ ...seedTo, tons: seedT });
      if (!tos.length && !(bales > 0)) { root.querySelector('#g-lint-kg').focus(); return; }

      // the gin's invoice, kept as a bill so what ginning cost is in the books
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
        tons: bales || g.modules,
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

