// Inputs and stock: seed, fertiliser, fuel and chemical. What came in, what went out, what is left.
//
// Opened from the top of Production. The list is each product with its stock on hand; a product opens to its history,
// and Bought, Used and Count record an entry. Seed and fertiliser also show what this season's paddocks call for
// against what is in the shed. The arithmetic is in inputs.js.

import { db } from '../storage.js?v=244';
import { openSheet, field, getVal, getNum, confirmDelete, toast, notify } from '../ui.js?v=244';
import { num, money, esc, todayLocal, dmy } from '../fmt.js?v=244';
import { fieldSeed, fieldUrea, fieldStarter } from '../derived.js?v=244';
import {
  KINDS, UNITS, MOVE_TYPES, kindLabel, defaultUnit, productKey, stockLevels, productMoves, stockValue,
  plannedNeeds, planVsStock, inputProblems, adjustmentFor, moveDelta, qtyText,
} from '../inputs.js?v=244';

const TYPE_LABEL = { buy: 'Bought', use: 'Used', adjust: 'Count' };
const TYPE_BADGE = { buy: 'pos', use: 'warn', adjust: 'muted' };

const levelsNow = () => stockLevels(db.getInputMoves());

/** The stock screen: every product with what is on hand. */
export function openInputsSheet() {
  openSheet('Inputs and stock', (root) => {
    const moves = db.getInputMoves();
    const levels = stockLevels(moves);
    const { fields } = db.get();
    const plan = planVsStock(
      plannedNeeds(fields, { seedTons: (f) => fieldSeed(f).bufferedTons, ureaTons: (f) => fieldUrea(f).requiredTons, starterTons: (f) => fieldStarter(f).requiredTons }),
      levels,
    );
    const value = stockValue(levels);

    root.innerHTML = `
      ${levels.length ? `<div class="stat-grid">
        <div class="stat"><div class="n">${levels.length}</div><div class="l">Product${levels.length === 1 ? '' : 's'} in stock</div></div>
        <div class="stat"><div class="n">${value > 0 ? money(value, 0) : '-'}</div><div class="l">Stock value${value > 0 ? '' : ' (add prices to see it)'}</div></div>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0">
        <button type="button" class="btn" data-new="buy">+ Bought</button>
        <button type="button" class="btn secondary" data-new="use">Used</button>
        <button type="button" class="btn secondary" data-new="adjust">Count</button>
      </div>
      ${levels.length === 0 ? `<div class="empty" style="padding:10px 0">No stock yet. Tap Bought when a delivery arrives: seed, fertiliser, fuel or chemical.</div>` : KINDS.map((k) => {
        const mine = levels.filter((l) => l.kind === k.key);
        if (!mine.length) return '';
        return `<div class="group-label"><span>${esc(k.plural)}</span></div>${mine.map((l) => `
          <div class="list-item stack" data-product="${esc(l.key)}">
            <div class="li-top"><div class="main">${esc(l.product)}</div><div class="main" ${l.onHand < 0 ? 'style="color:var(--danger)"' : ''}>${qtyText(l.onHand, l.unit)}</div></div>
            <div class="li-foot"><span class="meta">Bought ${qtyText(l.bought, l.unit)} &middot; used ${qtyText(l.used, l.unit)}${l.avgCost > 0 ? ` &middot; ${money(l.avgCost, 2)} /${esc(l.unit)}` : ''}</span>
              <span class="badges">${l.onHand < 0 ? '<span class="badge neg">Check count</span>' : l.onHand === 0 ? '<span class="badge muted">None left</span>' : ''}</span></div>
          </div>`).join('')}`;
      }).join('')}
      ${plan.length ? `
      <div class="card" style="margin-top:12px">
        <h2>This season's plan</h2>
        <div style="margin:0 0 6px;font-size:13px;opacity:.7">What the paddocks call for (seed with its buffer), against the stock of the same name.</div>
        ${plan.map((p) => `
          <div class="row"><span class="label">${esc(p.product)}<span class="meta" style="display:block">${p.bought ? `${qtyText(p.onHandT, 't')} on hand` : 'None bought yet'}</span></span>
            <span class="value">${qtyText(p.tons, 't')}${p.shortT > 0 ? ` <span class="badge neg">${qtyText(p.shortT, 't')} short</span>` : ' <span class="badge pos">Covered</span>'}</span></div>`).join('')}
      </div>` : ''}`;

    root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openMoveSheet(null, { type: b.dataset.new })));
    root.querySelectorAll('[data-product]').forEach((el) => el.addEventListener('click', () => {
      const l = levels.find((x) => x.key === el.dataset.product);
      if (l) openProductSheet(l);
    }));
  });
}

/** One product: what is on hand and every entry against it, newest first. */
function openProductSheet(level) {
  openSheet(level.product, (root) => {
    const moves = productMoves(db.getInputMoves(), level.kind, level.product);
    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="n" ${level.onHand < 0 ? 'style="color:var(--danger)"' : ''}>${qtyText(level.onHand, level.unit)}</div><div class="l">On hand (${esc(kindLabel(level.kind))})</div></div>
        <div class="stat"><div class="n">${level.avgCost > 0 ? `${money(level.avgCost, 2)}` : '-'}</div><div class="l">Average cost per ${esc(level.unit)}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0">
        <button type="button" class="btn" data-new="buy">+ Bought</button>
        <button type="button" class="btn secondary" data-new="use">Used</button>
        <button type="button" class="btn secondary" data-new="adjust">Count</button>
      </div>
      <div class="card" style="margin-top:12px">
        <h2>History</h2>
        ${moves.map((m) => `
          <div class="list-item stack" data-edit-move="${esc(m.id)}">
            <div class="li-top"><div class="main">${esc(dmy(m.date) || 'No date')}</div><div class="main">${moveDelta(m) >= 0 ? '+' : '&minus;'}${qtyText(Math.abs(moveDelta(m)), m.unit)}</div></div>
            <div class="li-foot"><span class="meta">${[m.supplier, m.reference ? `Ref ${m.reference}` : '', Number(m.unitCost) > 0 ? `${money(m.unitCost, 2)} /${m.unit}` : '', m.notes].filter(Boolean).map(esc).join(' &middot; ')}</span>
              <span class="badges"><span class="badge ${TYPE_BADGE[m.type]}">${TYPE_LABEL[m.type]}</span></span></div>
          </div>`).join('')}
      </div>
      <button type="button" class="btn secondary" id="in-back" style="margin-top:10px">All stock</button>`;
    root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openMoveSheet(null, { type: b.dataset.new, kind: level.kind, product: level.product })));
    root.querySelectorAll('[data-edit-move]').forEach((el) => el.addEventListener('click', () => openMoveSheet(moves.find((m) => m.id === el.dataset.editMove))));
    root.querySelector('#in-back').addEventListener('click', () => openInputsSheet());
  });
}

/**
 * One entry: add it, change it, delete it. `start` ({type, kind, product}) says what a new one begins as.
 * A count is typed as what was counted; what is saved is the correction against the book.
 */
export function openMoveSheet(existing, start = {}) {
  const all = db.getInputMoves();
  const others = existing ? all.filter((m) => m.id !== existing.id) : all;
  const otherLevels = stockLevels(others);
  let d = existing ? { ...existing } : {
    type: start.type || 'buy', kind: start.kind || 'fert', product: start.product || '',
    unit: '', qty: '', unitCost: '', date: todayLocal(), supplier: '', reference: '', notes: '', counted: '',
  };
  if (!d.unit) d.unit = defaultUnit(d.kind);
  const known = () => otherLevels.find((l) => l.key === productKey(d.kind, d.product));

  openSheet(existing ? 'Change an entry' : ({ buy: 'Bought', use: 'Used', adjust: 'Count' })[d.type] || 'Entry', (root) => {
    const paint = () => {
      const lvl = known();
      if (lvl) d.unit = lvl.unit;
      const names = otherLevels.filter((l) => l.kind === d.kind).map((l) => l.product);
      const isNewCount = d.type === 'adjust' && !existing;
      root.innerHTML = `
        <datalist id="dl-products">${names.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        ${existing ? '' : `<div class="segmented" id="in-type" style="margin-bottom:10px">
          ${MOVE_TYPES.map((t) => `<button data-type="${t.key}" class="${d.type === t.key ? 'active' : ''}">${t.label}</button>`).join('')}
        </div>`}
        ${field({ label: 'What is it', id: 'in-kind', type: 'select', value: d.kind, options: KINDS.map((k) => ({ value: k.key, label: k.label })) })}
        ${field({ label: 'Product', id: 'in-product', value: d.product, list: 'dl-products', placeholder: KINDS.find((k) => k.key === d.kind)?.hint || '' })}
        ${lvl
          ? `<div class="row"><span class="label">On hand now</span><span class="value">${qtyText(lvl.onHand, lvl.unit)}</span></div>`
          : (d.product.trim() ? '<div class="hint" style="margin:0 0 8px">A new product. Choose its unit below; it stays the same from here on.</div>' : '')}
        <div class="grid-2">
          ${isNewCount
            ? field({ label: lvl ? `Counted on hand (${lvl.unit})` : 'Counted on hand', id: 'in-counted', type: 'number', step: '0.001', value: d.counted ?? '' })
            : field({ label: d.type === 'adjust' ? 'Correction (+ or -)' : 'How much', id: 'in-qty', type: 'number', step: '0.001', value: d.qty ?? '', allowNegative: d.type === 'adjust' })}
          ${lvl ? `<div class="field"><label>Unit</label><div class="meta" style="padding:10px 0">${esc(lvl.unit)}</div></div>`
            : field({ label: 'Unit', id: 'in-unit', type: 'select', value: d.unit, options: UNITS.map((u) => ({ value: u, label: u })) })}
        </div>
        ${field({ label: 'Date', id: 'in-date', type: 'date', value: d.date })}
        ${d.type === 'buy' ? `
        <div class="grid-2">
          ${field({ label: `Price per ${d.unit || 'unit'} ($)`, id: 'in-cost', type: 'number', step: '0.01', value: d.unitCost ?? '' })}
          ${field({ label: 'Invoice no.', id: 'in-ref', value: d.reference })}
        </div>
        ${field({ label: 'Supplier', id: 'in-supplier', value: d.supplier, list: 'dl-suppliers' })}
        <datalist id="dl-suppliers">${[...new Set(all.map((m) => String(m.supplier || '').trim()).filter(Boolean))].sort().map((s) => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}
        ${field({ label: 'Notes', id: 'in-notes', value: d.notes, placeholder: d.type === 'use' ? 'e.g. sown to SR1-3, sprayed pre-emergent' : '' })}
        <div class="row"><span class="label">Stock after this</span><span class="value" id="in-after">-</span></div>
        <div id="in-problems" class="hint" style="color:var(--danger);margin:8px 0"></div>
        ${existing ? '<button class="btn ghost-danger" id="in-del" style="margin-top:4px">Delete this entry</button>' : ''}
        <div class="save-bar solo"><button class="btn" id="in-save">Save</button></div>`;
      wire();
      calc();
    };

    const collect = () => {
      const val = (id) => getVal(root, id);
      if (val('in-kind') != null) d.kind = val('in-kind');
      if (val('in-product') != null) d.product = val('in-product').trim();
      if (root.querySelector('#in-unit')) d.unit = val('in-unit');
      if (root.querySelector('#in-qty')) d.qty = val('in-qty') === '' ? '' : getNum(root, 'in-qty');
      if (root.querySelector('#in-counted')) d.counted = val('in-counted') === '' ? '' : getNum(root, 'in-counted');
      if (val('in-date') != null) d.date = val('in-date');
      if (root.querySelector('#in-cost')) d.unitCost = val('in-cost') === '' ? '' : getNum(root, 'in-cost');
      if (root.querySelector('#in-ref')) d.reference = val('in-ref').trim();
      if (root.querySelector('#in-supplier')) d.supplier = val('in-supplier').trim();
      if (val('in-notes') != null) d.notes = val('in-notes').trim();
    };

    // what is saved: a count becomes the correction against the book
    const entry = () => {
      const lvl = known();
      if (d.type === 'adjust' && !existing) {
        return { ...d, qty: d.counted === '' ? 0 : adjustmentFor(lvl?.onHand || 0, d.counted) };
      }
      return { ...d, qty: d.qty === '' ? 0 : d.qty };
    };

    const calc = () => {
      collect();
      const e = entry();
      const lvl = known();
      const after = (lvl?.onHand || 0) + moveDelta(e);
      const el = root.querySelector('#in-after');
      if (el) {
        el.textContent = qtyText(after, d.unit);
        el.style.color = after < -0.0005 ? 'var(--danger)' : '';
      }
      const note = root.querySelector('#in-problems');
      if (note) note.textContent = d.type === 'use' && after < -0.0005 ? 'That is more than the book says is on hand. Check the count, or record the delivery first.' : '';
    };

    const wire = () => {
      root.querySelector('#in-type')?.addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) { collect(); d.type = b.dataset.type; paint(); } });
      root.querySelector('#in-kind').addEventListener('change', () => { collect(); if (!known()) d.unit = defaultUnit(d.kind); paint(); });
      root.querySelector('#in-product').addEventListener('change', () => { collect(); if (!known()) d.unit = d.unit || defaultUnit(d.kind); paint(); });
      ['in-qty', 'in-counted', 'in-unit'].forEach((id) => root.querySelector(`#${id}`)?.addEventListener('input', calc));
      root.querySelector('#in-unit')?.addEventListener('change', () => { collect(); paint(); });
      root.querySelector('#in-del')?.addEventListener('click', () => {
        confirmDelete('Delete this entry? The stock goes back to what it was before it.', () => { db.deleteInputMove(existing.id); toast('Deleted'); openInputsSheet(); });
      });
      root.querySelector('#in-save').addEventListener('click', () => {
        collect();
        const e = entry();
        const problems = inputProblems(e);
        if (problems.length) { notify(problems[0]); return; }
        const { counted, ...clean } = e;
        db.upsertInputMove(clean);
        toast('Saved');
        openInputsSheet();
      });
    };

    paint();
  });
}

