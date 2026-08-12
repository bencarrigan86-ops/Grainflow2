import { db } from '../storage.js?v=35';
import { num, money, esc } from '../fmt.js?v=35';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=35';
import { APP_VERSION } from '../version.js?v=35';

let unsub = null;

export function renderSettings(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities } = db.get();
  const years = db.getYears();
  const currentYear = db.getCurrentYear();
  const overheads = db.getOverheads();
  const business = db.getBusinessDetails();

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Settings</h1>
        <div class="sub">Commodities, MTM prices &amp; data</div>
      </div>
    </div>
    <div class="view">
      <div class="card">
        <h2>Season</h2>
        ${field({ label: 'Viewing', id: 'year-select', type: 'select', value: currentYear, options: years.map((y) => ({ value: y, label: y })) })}
        <div class="swipe-actions">
          <button class="btn secondary small" id="rename-year">Rename "${esc(currentYear)}"&hellip;</button>
          <button class="btn secondary small" id="new-year">Start new year&hellip;</button>
        </div>
        ${years.length > 1 ? `<button class="btn danger small" id="delete-year" style="margin-top:8px">Delete "${esc(currentYear)}" season</button>` : ''}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Commodities</h2>
        ${commodities.length === 0 ? `<div class="empty">Tap + to add a commodity.</div>` : commodities.map((c) => commodityRow(c)).join('')}
      </div>

      <div class="card">
        <h2>Overheads</h2>
        <div class="field hint" style="margin-bottom:6px">Whole-farm costs, subtracted from total gross margin in the Position tab.</div>
        ${field({ label: 'Finance ($)', id: 'oh-finance', type: 'number', step: '1', value: overheads.finance })}
        ${field({ label: 'Equipment repayments ($)', id: 'oh-equipment', type: 'number', step: '1', value: overheads.equipmentRepayments })}
        ${field({ label: 'Depreciation ($)', id: 'oh-depreciation', type: 'number', step: '1', value: overheads.depreciation })}
        ${field({ label: 'Wages ($)', id: 'oh-wages', type: 'number', step: '1', value: overheads.wages })}
        ${field({ label: 'Drawings ($)', id: 'oh-drawings', type: 'number', step: '1', value: overheads.drawings })}
        ${field({ label: 'Admin ($)', id: 'oh-admin', type: 'number', step: '1', value: overheads.admin })}
        ${field({ label: 'Energy ($)', id: 'oh-energy', type: 'number', step: '1', value: overheads.energy })}
        ${field({ label: 'Insurance ($)', id: 'oh-insurance', type: 'number', step: '1', value: overheads.insurance })}
        ${field({ label: 'R&amp;M ($)', id: 'oh-rm', type: 'number', step: '1', value: overheads.repairsMaintenance })}
        ${field({ label: 'Other ($)', id: 'oh-other', type: 'number', step: '1', value: overheads.other })}
        <button class="btn" id="save-overheads">Save overheads</button>
      </div>

      <div class="card">
        <h2>Business details</h2>
        <div class="field hint" style="margin-bottom:6px">Used as the "Seller" on invoices you generate in Sales.</div>
        ${field({ label: 'Entity / business name', id: 'bd-entity', value: business.entityName, placeholder: 'e.g. Carrigan Agricultural Co Pty Ltd' })}
        <div class="grid-2">
          ${field({ label: 'ABN', id: 'bd-abn', value: business.abn })}
          ${field({ label: 'NGR', id: 'bd-ngr', value: business.ngr })}
        </div>
        ${field({ label: 'Contact name', id: 'bd-contact', value: business.contactName })}
        <div class="grid-2">
          ${field({ label: 'Phone', id: 'bd-phone', value: business.phone })}
          ${field({ label: 'Email', id: 'bd-email', value: business.email })}
        </div>
        ${field({ label: 'Address', id: 'bd-address', value: business.address })}
        ${field({ label: 'Payment terms (days)', id: 'bd-terms', type: 'number', step: '1', value: business.paymentTermsDays })}
        <hr class="sep" />
        <div class="grid-2">
          ${field({ label: 'Bank name', id: 'bd-bank', value: business.bankName })}
          ${field({ label: 'Account name', id: 'bd-accname', value: business.accountName })}
        </div>
        <div class="grid-2">
          ${field({ label: 'BSB', id: 'bd-bsb', value: business.bsb })}
          ${field({ label: 'Account number', id: 'bd-accno', value: business.accountNumber })}
        </div>
        <button class="btn" id="save-business">Save business details</button>
      </div>

      <div class="card">
        <h2>Data</h2>
        <div class="row"><span class="label">Everything is stored on this device only.</span></div>
        <div class="swipe-actions">
          <button class="btn secondary small" id="export">Export backup</button>
          <button class="btn secondary small" id="import">Import backup</button>
        </div>
        <button class="btn danger small" id="reset" style="margin-top:10px">Reset all data</button>
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>

      <div class="card">
        <h2>App</h2>
        <div class="row"><span class="label">Version</span><span class="value">${esc(APP_VERSION)}</span></div>
        <div class="field hint" style="margin-top:6px">If something looks out of date after an update, tap this to force the app to fetch the latest version.</div>
        <button class="btn secondary small" id="force-refresh" style="margin-top:6px">Force refresh app</button>
      </div>
    </div>
    <button class="fab" id="add-commodity">+</button>
  `;

  root.querySelectorAll('[data-edit-commodity]').forEach((el) => {
    el.addEventListener('click', () => openCommoditySheet(commodities.find((c) => c.id === el.dataset.editCommodity)));
  });
  root.querySelector('#add-commodity').addEventListener('click', () => openCommoditySheet(null));

  root.querySelector('#year-select').addEventListener('change', (e) => {
    db.setCurrentYear(e.target.value);
  });

  root.querySelector('#save-overheads').addEventListener('click', () => {
    db.updateOverheads({
      finance: getNum(root, 'oh-finance'),
      equipmentRepayments: getNum(root, 'oh-equipment'),
      depreciation: getNum(root, 'oh-depreciation'),
      wages: getNum(root, 'oh-wages'),
      drawings: getNum(root, 'oh-drawings'),
      admin: getNum(root, 'oh-admin'),
      energy: getNum(root, 'oh-energy'),
      insurance: getNum(root, 'oh-insurance'),
      repairsMaintenance: getNum(root, 'oh-rm'),
      other: getNum(root, 'oh-other'),
    });
  });

  root.querySelector('#save-business').addEventListener('click', () => {
    db.updateBusinessDetails({
      entityName: getVal(root, 'bd-entity')?.trim(),
      abn: getVal(root, 'bd-abn')?.trim(),
      ngr: getVal(root, 'bd-ngr')?.trim(),
      contactName: getVal(root, 'bd-contact')?.trim(),
      phone: getVal(root, 'bd-phone')?.trim(),
      email: getVal(root, 'bd-email')?.trim(),
      address: getVal(root, 'bd-address')?.trim(),
      paymentTermsDays: getNum(root, 'bd-terms'),
      bankName: getVal(root, 'bd-bank')?.trim(),
      accountName: getVal(root, 'bd-accname')?.trim(),
      bsb: getVal(root, 'bd-bsb')?.trim(),
      accountNumber: getVal(root, 'bd-accno')?.trim(),
    });
  });
  root.querySelector('#rename-year').addEventListener('click', () => openRenameYearSheet(currentYear));
  root.querySelector('#new-year').addEventListener('click', () => openNewYearSheet(currentYear));
  const deleteYearBtn = root.querySelector('#delete-year');
  if (deleteYearBtn) {
    deleteYearBtn.addEventListener('click', () => {
      confirmDelete(`Delete the "${currentYear}" season? Its fields, silos, sales and movements will be gone for good. Other seasons aren't affected.`, () => {
        db.deleteYear(currentYear);
      });
    });
  }

  root.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([db.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grainflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  const importFile = root.querySelector('#import-file');
  root.querySelector('#import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const f = importFile.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      db.importJSON(text);
    } catch (e) {
      alert('Could not read that file.');
    }
  });
  root.querySelector('#reset').addEventListener('click', () => {
    confirmDelete('Reset all data? This cannot be undone.', () => db.resetAll());
  });

  root.querySelector('#force-refresh').addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    location.reload();
  });
}

function openRenameYearSheet(currentYear) {
  openSheet('Rename season', (root) => {
    root.innerHTML = `
      ${field({ label: 'New label', id: 'year', value: currentYear, placeholder: 'e.g. 2025' })}
      <button class="btn" id="rename">Rename</button>
    `;
    root.querySelector('#rename').addEventListener('click', () => {
      const year = getVal(root, 'year')?.trim();
      if (!year) { root.querySelector('#year').focus(); return; }
      const ok = db.renameYear(currentYear, year);
      if (!ok) { alert(`"${year}" is already in use.`); return; }
      closeSheet();
    });
  });
}

function openNewYearSheet(currentYear) {
  const guess = /^\d+$/.test(currentYear) ? String(Number(currentYear) + 1) : '';
  openSheet('Start new year', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:12px">
        Carries over: field names/areas, silo/bunker names &amp; geometry, and commodities (angle of repose, test weight, N required) — with their commodity assignments kept.<br/><br/>
        Resets to empty: yield, urea, seed data on fields; grain level, opening stock on silos/bunkers; MTM price, opening stock, retained seed, gross margin cost on commodities; overheads.<br/><br/>
        Cleared entirely: sales contracts and truck movements.
      </div>
      ${field({ label: 'New year label', id: 'year', value: guess, placeholder: 'e.g. 2027' })}
      <button class="btn" id="create">Create &amp; switch</button>
    `;
    root.querySelector('#create').addEventListener('click', () => {
      const year = getVal(root, 'year')?.trim();
      if (!year) { root.querySelector('#year').focus(); return; }
      const ok = db.createYear(year);
      if (!ok) { alert(`"${year}" already exists or is invalid.`); return; }
      closeSheet();
    });
  });
}

function commodityRow(c) {
  return `
    <div class="list-item" data-edit-commodity="${c.id}">
      <div>
        <div class="main">${esc(c.name)}</div>
        <div class="meta">Angle ${num(c.angleOfRepose, 0)}° · TW ${num(c.testWeight, 2)} t/m³</div>
      </div>
      <div class="right">
        <div class="main">${money(c.mtmPrice, 0)}/t</div>
        <div class="meta">MTM price</div>
      </div>
    </div>
  `;
}

function openCommoditySheet(existing) {
  openSheet(existing ? 'Edit commodity' : 'Add commodity', (root) => {
    root.innerHTML = `
      ${field({ label: 'Name', id: 'name', value: existing?.name, placeholder: 'e.g. Wheat' })}
      <div class="grid-2">
        ${field({ label: 'Angle of repose (°)', id: 'angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'For silo/bunker peak calc' })}
        ${field({ label: 'Test weight (t/m³)', id: 'tw', type: 'number', step: '0.01', value: existing?.testWeight })}
      </div>
      ${field({ label: 'MTM price ($/t)', id: 'mtm', type: 'number', step: '0.01', value: existing?.mtmPrice ?? 0, hint: 'Used to value unsold position' })}
      <div class="grid-2">
        ${field({ label: 'Opening stock (t)', id: 'opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0 })}
        ${field({ label: 'Retained seed (t)', id: 'seed', type: 'number', step: '0.01', value: existing?.retainedSeed ?? 0 })}
      </div>
      ${field({ label: 'N required (kg/t)', id: 'nPerTonne', type: 'number', step: '1', value: existing?.nPerTonne ?? 0, hint: 'Nitrogen per tonne of grain, for the Fert calculator' })}
      ${field({ label: 'Gross margin cost ($)', id: 'gmCost', type: 'number', step: '1', value: existing?.grossMarginCost ?? 0, hint: 'Total input cost for this commodity, for the Position tab' })}
      <button class="btn" id="save">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete commodity</button>` : ''}
    `;
    root.querySelector('#save').addEventListener('click', () => {
      const name = getVal(root, 'name')?.trim();
      if (!name) { root.querySelector('#name').focus(); return; }
      db.upsertCommodity({
        id: existing?.id,
        name,
        angleOfRepose: getNum(root, 'angle'),
        testWeight: getNum(root, 'tw'),
        mtmPrice: getNum(root, 'mtm'),
        openingStock: getNum(root, 'opening'),
        retainedSeed: getNum(root, 'seed'),
        nPerTonne: getNum(root, 'nPerTonne'),
        grossMarginCost: getNum(root, 'gmCost'),
      });
      closeSheet();
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete(`Delete "${existing.name}"? Fields/sales using it will keep showing it as missing.`, () => {
          db.deleteCommodity(existing.id);
          closeSheet();
        });
      });
    }
  });
}
