import { db } from '../storage.js';
import { salesByCommodity, saleEconomics, contractTolerance, DEFAULT_TOLERANCE_PCT, DEFAULT_TOLERANCE_CAP_TONS } from '../derived.js';
import { num, tons, money, esc } from '../fmt.js';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js';

let unsub = null;

export function renderSales(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, sales } = db.get();
  const rollup = salesByCommodity(commodities, sales).filter((r) => r.contractCount > 0);
  const groups = groupSalesByCommodity(commodities, sales);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Sales</h1>
        <div class="sub">Contracts, rolled up by commodity</div>
      </div>
    </div>
    <div class="view">
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        ${rollup.length === 0 ? `<div class="empty">No sales entered yet.</div>` : `
        <div class="table-scroll">
          <table>
            <thead><tr><th>Commodity</th><th>Tons</th><th>Avg $/t</th><th>Total $</th></tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr>
                  <td>${esc(r.commodity.name)}</td>
                  <td>${num(r.tons, 1)}</td>
                  <td>${num(r.avgPrice, 2)}</td>
                  <td>${num(r.totalValue, 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Contracts</h2>
        ${groups.length === 0 ? `<div class="empty">Tap + to add your first sale.</div>` : groups.map((g) => `
          <div class="group-label"><span>${esc(g.name)}</span><span class="n">${money(g.totalValue, 0)}</span></div>
          ${g.sales.map((s) => saleRow(s)).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-sale">+</button>
  `;

  root.querySelectorAll('[data-edit-sale]').forEach((el) => {
    el.addEventListener('click', () => openSaleSheet(sales.find((s) => s.id === el.dataset.editSale)));
  });
  root.querySelector('#add-sale').addEventListener('click', () => openSaleSheet(null));
}

function groupSalesByCommodity(commodities, sales) {
  const groups = commodities
    .map((c) => {
      const rows = sales.filter((s) => s.commodityId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return { id: c.id, name: c.name, sales: rows, totalValue: rows.reduce((sum, s) => sum + saleEconomics(s).totalValue, 0) };
    })
    .filter((g) => g.sales.length > 0);

  const noCommodity = sales.filter((s) => !commodities.some((c) => c.id === s.commodityId))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (noCommodity.length > 0) {
    groups.push({ id: null, name: 'No commodity', sales: noCommodity, totalValue: noCommodity.reduce((sum, s) => sum + saleEconomics(s).totalValue, 0) });
  }
  return groups;
}

function fillBadge(s, econ) {
  if (econ.isOverDelivered) {
    const overBy = (Number(s.tonsDelivered) || 0) - econ.maxTons;
    return `<span class="badge neg">Over by ${num(overBy, 1)} t</span>`;
  }
  if (econ.isFull) return `<span class="badge pos">Contract full</span>`;
  return `<span class="badge neg">${num(econ.tonsToFill, 1)} t to fill</span>`;
}

function saleRow(s) {
  const econ = saleEconomics(s);
  return `
    <div class="list-item" data-edit-sale="${s.id}">
      <div>
        <div class="main">${s.buyer ? esc(s.buyer) : 'No buyer'}${s.grade ? ` · ${esc(s.grade)}` : ''}</div>
        <div class="meta">${esc(s.date || 'No date')} · ${tons(s.tons || 0)} @ ${money(econ.priceExFarm, 2)}/t</div>
      </div>
      <div class="right">
        <div class="main">${money(econ.totalValue, 0)}</div>
        <div class="meta">${fillBadge(s, econ)}</div>
      </div>
    </div>
  `;
}

function openSaleSheet(existing) {
  const { commodities } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));

  openSheet(existing ? 'Edit sale' : 'Add sale', (root) => {
    root.innerHTML = `
      ${field({ label: 'Date', id: 'date', type: 'date', value: existing?.date })}
      <div class="grid-2">
        ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
        ${field({ label: 'Grade', id: 'grade', value: existing?.grade, placeholder: 'e.g. APW1, H2' })}
      </div>
      ${field({ label: 'Buyer', id: 'buyer', value: existing?.buyer, placeholder: 'e.g. CBH, Cargill' })}
      <div class="grid-2">
        ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
        ${field({ label: 'Tons delivered', id: 'tonsDelivered', type: 'number', step: '0.01', value: existing?.tonsDelivered ?? 0 })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Price ($/t)', id: 'price', type: 'number', step: '0.01', value: existing?.price })}
        ${field({ label: 'Freight ($/t)', id: 'freight', type: 'number', step: '0.01', value: existing?.freight ?? 0 })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Premium/discount ($/t)', id: 'premium', type: 'number', step: '0.01', value: existing?.premiumDiscount ?? 0 })}
        ${field({ label: 'Levies (%)', id: 'levies', type: 'number', step: '0.01', value: existing ? existing.leviesPct * 100 : 1.02, hint: 'e.g. GRDC + state levy' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Tolerance (%)', id: 'tolPct', type: 'number', step: '0.1', value: existing?.tolerancePct ?? DEFAULT_TOLERANCE_PCT })}
        ${field({ label: 'Tolerance cap (t)', id: 'tolCap', type: 'number', step: '0.1', value: existing?.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS, hint: 'Lesser of the two applies' })}
      </div>
      <div class="row"><span class="label">Delivery range</span><span class="value" id="tol-preview">—</span></div>
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete sale</button>` : ''}
    `;

    const tolPreview = root.querySelector('#tol-preview');
    const recomputeTolerance = () => {
      const { minTons, maxTons } = contractTolerance(getNum(root, 'tons'), getNum(root, 'tolPct'), getNum(root, 'tolCap'));
      tolPreview.textContent = `${num(minTons, 1)} – ${num(maxTons, 1)} t`;
    };
    ['tons', 'tolPct', 'tolCap'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeTolerance));
    recomputeTolerance();

    root.querySelector('#save').addEventListener('click', () => {
      db.upsertSale({
        id: existing?.id,
        date: getVal(root, 'date'),
        commodityId: getVal(root, 'commodity'),
        grade: getVal(root, 'grade')?.trim(),
        buyer: getVal(root, 'buyer')?.trim(),
        tons: getNum(root, 'tons'),
        tonsDelivered: getNum(root, 'tonsDelivered'),
        price: getNum(root, 'price'),
        freight: getNum(root, 'freight'),
        premiumDiscount: getNum(root, 'premium'),
        leviesPct: getNum(root, 'levies') / 100,
        tolerancePct: getNum(root, 'tolPct'),
        toleranceCapTons: getNum(root, 'tolCap'),
        notes: getVal(root, 'notes')?.trim(),
      });
      closeSheet();
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete('Delete this sale?', () => {
          db.deleteSale(existing.id);
          closeSheet();
        });
      });
    }
  });
}
