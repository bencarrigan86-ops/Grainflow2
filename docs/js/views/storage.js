import { db } from '../storage.js?v=26';
import { siloResult, bunkerResult, bunkerTarpRequirement } from '../calc.js?v=26';
import { storageLedgerStock, movementNetForStorage } from '../derived.js?v=26';
import { num, tons, esc } from '../fmt.js?v=26';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=26';

let unsub = null;
let listMode = 'chronological';
let view = 'saved';
let quickKind = 'silo';

export function renderStorage(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, storages, movements } = db.get();

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Storage</h1>
        <div class="sub">Saved silos &amp; bunkers, plus a quick calculator</div>
      </div>
    </div>
    <div class="view">
      <div class="segmented" id="storage-view">
        <button data-view="saved" class="${view === 'saved' ? 'active' : ''}">Saved</button>
        <button data-view="calculator" class="${view === 'calculator' ? 'active' : ''}">Calculator</button>
      </div>
      <div id="storage-body" style="margin-top:12px"></div>
    </div>
    ${view === 'saved' ? `<button class="fab" id="add-storage">+</button>` : ''}
  `;

  root.querySelector('#storage-view').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    paint(root);
  });

  if (view === 'calculator') {
    paintCalculator(root);
    return;
  }

  const commodityRollup = storageTonsByCommodity(commodities, storages, movements);
  const storageTotals = commodityRollup.reduce((acc, r) => ({
    measuredTons: acc.measuredTons + r.measuredTons,
    trackedTons: acc.trackedTons + r.trackedTons,
  }), { measuredTons: 0, trackedTons: 0 });

  const body = root.querySelector('#storage-body');
  body.innerHTML = `
    ${storages.length > 0 ? `
    <div class="card report">
      <h2><span class="dot report"></span>By commodity</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Commodity</th><th>Measured</th><th>Tracked</th></tr></thead>
          <tbody>
            ${commodityRollup.map((r) => `
              <tr>
                <td>${esc(r.name)}</td>
                <td>${num(r.measuredTons, 1)}</td>
                <td>${num(r.trackedTons, 1)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td>
            <td>${num(storageTotals.measuredTons, 1)}</td>
            <td>${num(storageTotals.trackedTons, 1)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>` : ''}

    <div class="card">
      <h2>Saved silos &amp; bunkers</h2>
      ${storages.length > 0 ? `
      <div class="segmented" id="list-mode">
        <button data-mode="chronological" class="${listMode === 'chronological' ? 'active' : ''}">Chronological</button>
        <button data-mode="commodity" class="${listMode === 'commodity' ? 'active' : ''}">By commodity</button>
      </div>
      <div style="margin-top:10px">` : ''}
      ${storages.length === 0 ? `<div class="empty">Tap + to save a silo or bunker so you only enter today's level next time.</div>` : renderStorageList(storages, commodities, movements)}
      ${storages.length > 0 ? `</div>` : ''}
    </div>
  `;

  const listModeEl = body.querySelector('#list-mode');
  if (listModeEl) {
    listModeEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      listMode = btn.dataset.mode;
      paint(root);
    });
  }

  body.querySelectorAll('[data-edit-storage]').forEach((el) => {
    el.addEventListener('click', () => openStorageSheet(storages.find((s) => s.id === el.dataset.editStorage)));
  });
  root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
}

function paintCalculator(root) {
  const { commodities } = db.get();
  const body = root.querySelector('#storage-body');
  body.innerHTML = `
    <div class="card">
      <div class="segmented" id="quick-kind">
        <button data-kind="silo" class="${quickKind === 'silo' ? 'active' : ''}">Silo</button>
        <button data-kind="bunker" class="${quickKind === 'bunker' ? 'active' : ''}">Bunker</button>
      </div>
      <div id="quick-form" style="margin-top:12px"></div>
      <div id="quick-result"></div>
    </div>
    <div class="field hint" style="padding:0 4px">Quick one-off calc — save it below under Saved if you want to track it day to day.</div>
  `;
  body.querySelector('#quick-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    quickKind = btn.dataset.kind;
    paintCalculator(root);
  });
  buildQuickForm(body, commodities);
}

function commodityOptionsQuick(commodities) {
  return [{ value: '', label: 'None / manual' }, ...commodities.map((c) => ({ value: c.id, label: c.name }))];
}

function buildQuickForm(root, commodities) {
  const formEl = root.querySelector('#quick-form');
  const resultEl = root.querySelector('#quick-result');

  if (quickKind === 'silo') {
    formEl.innerHTML = `
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptionsQuick(commodities) })}
      <div class="grid-2">
        ${field({ label: 'Radius (m)', id: 'q-radius', type: 'number', step: '0.01' })}
        ${field({ label: 'Grain height (m)', id: 'q-height', type: 'number', step: '0.01' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Cone angle (°)', id: 'q-cone', type: 'number', step: '1', value: 0, hint: '0 = flat bottom' })}
        ${field({ label: 'Angle of repose (°)', id: 'q-angle', type: 'number', step: '1' })}
      </div>
      ${field({ label: 'Test weight (t/m³)', id: 'q-tw', type: 'number', step: '0.01' })}
      <div class="segmented" id="q-fill">
        <button data-fill="peak" class="active">Peaked</button>
        <button data-fill="flat">Flat</button>
        <button data-fill="decline">Declined</button>
      </div>
    `;
    let fillState = 'peak';
    formEl.querySelector('#q-fill').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-fill]');
      if (!btn) return;
      fillState = btn.dataset.fill;
      formEl.querySelectorAll('#q-fill button').forEach((b) => b.classList.toggle('active', b === btn));
      recompute();
    });
    formEl.querySelector('#q-commodity').addEventListener('change', () => {
      const c = commodities.find((c) => c.id === getVal(formEl, 'q-commodity'));
      if (c) {
        formEl.querySelector('#q-angle').value = c.angleOfRepose ?? '';
        formEl.querySelector('#q-tw').value = c.testWeight ?? '';
      }
      recompute();
    });
    formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

    function recompute() {
      const r = siloResult({
        radius: getNum(formEl, 'q-radius'),
        height: getNum(formEl, 'q-height'),
        coneAngle: getNum(formEl, 'q-cone'),
        angleOfRepose: getNum(formEl, 'q-angle'),
        testWeight: getNum(formEl, 'q-tw'),
        fillState,
      });
      resultEl.innerHTML = quickResultHTML(r.tons, [
        ['Volume', `${num(r.totalVol, 1)} m³`],
        ['Cone height', `${num(r.coneHeight, 2)} m`],
        ['Peak/decline height', `${num(r.peakHeight, 2)} m`],
      ]);
    }
    recompute();
  } else {
    formEl.innerHTML = `
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptionsQuick(commodities) })}
      <div class="grid-2">
        ${field({ label: 'Width (m)', id: 'q-width', type: 'number', step: '0.01' })}
        ${field({ label: 'Length (m)', id: 'q-length', type: 'number', step: '0.01' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Peak angle (°)', id: 'q-angle', type: 'number', step: '1', hint: 'Grain angle of repose' })}
        ${field({ label: 'Test weight (t/m³)', id: 'q-tw', type: 'number', step: '0.01' })}
      </div>
      ${field({ label: 'Tarp overhang per side (m)', id: 'q-overhang', type: 'number', step: '0.1', value: 1.5 })}
    `;
    formEl.querySelector('#q-commodity').addEventListener('change', () => {
      const c = commodities.find((c) => c.id === getVal(formEl, 'q-commodity'));
      if (c) {
        formEl.querySelector('#q-angle').value = c.angleOfRepose ?? '';
        formEl.querySelector('#q-tw').value = c.testWeight ?? '';
      }
      recompute();
    });
    formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

    function recompute() {
      const r = bunkerResult({
        width: getNum(formEl, 'q-width'),
        length: getNum(formEl, 'q-length'),
        angleDeg: getNum(formEl, 'q-angle'),
        testWeight: getNum(formEl, 'q-tw'),
      });
      const t = bunkerTarpRequirement({
        width: getNum(formEl, 'q-width'),
        length: getNum(formEl, 'q-length'),
        angleDeg: getNum(formEl, 'q-angle'),
        overhangM: getNum(formEl, 'q-overhang'),
      });
      resultEl.innerHTML = quickResultHTML(r.tons, [
        ['Volume', `${num(r.volume, 1)} m³`],
        ['Peak height', `${num(r.height, 2)} m`],
      ]) + tarpResultHTML(t);
    }
    recompute();
  }
}

function tarpResultHTML(t) {
  return `
    <hr class="sep" />
    <div class="row"><span class="label"><strong>Tarp needed</strong></span></div>
    <div class="row"><span class="label">Width</span><span class="value">${num(t.tarpWidthNeeded, 1)} m</span></div>
    <div class="row"><span class="label">Length</span><span class="value">${num(t.tarpLengthNeeded, 1)} m</span></div>
    <div class="row"><span class="label">Bare minimum to reach ground</span><span class="value">${num(t.slantWidth, 1)} x ${num(t.slantLength, 1)} m</span></div>
  `;
}

function quickResultHTML(tonsVal, extraRows) {
  return `
    <hr class="sep" />
    <div class="row"><span class="label"><strong>Tons</strong></span><span class="value" style="font-size:22px">${num(tonsVal, 1)} t</span></div>
    ${extraRows.map(([l, v]) => `<div class="row"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('')}
  `;
}

function storageTonsByCommodity(commodities, storages, movements) {
  return commodities
    .map((c) => {
      const rows = storages.filter((s) => s.commodityId === c.id);
      const measuredTons = rows.reduce((sum, s) => sum + computeStorageTons(s, commodities).tons, 0);
      const trackedTons = rows.reduce((sum, s) => sum + storageLedgerStock(s, movements), 0);
      return { name: c.name, measuredTons, trackedTons, count: rows.length };
    })
    .filter((r) => r.count > 0);
}

function renderStorageList(storages, commodities, movements) {
  if (listMode === 'commodity') {
    const groups = commodities
      .map((c) => ({
        name: c.name,
        rows: storages.filter((s) => s.commodityId === c.id).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      }))
      .filter((g) => g.rows.length > 0);
    const noCommodity = storages.filter((s) => !commodities.some((c) => c.id === s.commodityId));
    if (noCommodity.length > 0) groups.push({ name: 'No commodity', rows: noCommodity });

    return groups.map((g) => `
      <div class="group-label"><span>${esc(g.name)}</span></div>
      ${g.rows.map((s) => storageRow(s, commodities, movements)).join('')}
    `).join('');
  }

  const sorted = [...storages].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return sorted.map((s) => storageRow(s, commodities, movements)).join('');
}

function commodityOptions(commodities, includeNone = true) {
  const opts = commodities.map((c) => ({ value: c.id, label: c.name }));
  return includeNone ? [{ value: '', label: 'None / manual' }, ...opts] : opts;
}

function computeStorageTons(s, commodities) {
  const c = commodities.find((c) => c.id === s.commodityId);
  const angleOfRepose = s.angleOfRepose ?? c?.angleOfRepose ?? 0;
  const testWeight = s.testWeight ?? c?.testWeight ?? 0;
  if (s.kind === 'bunker') {
    return bunkerResult({ width: s.width, length: s.length, angleDeg: angleOfRepose, testWeight });
  }
  return siloResult({
    radius: s.radius, height: s.currentHeight, coneAngle: s.coneAngle,
    angleOfRepose, testWeight, fillState: s.fillState || 'peak',
  });
}

function storageRow(s, commodities, movements) {
  const c = commodities.find((c) => c.id === s.commodityId);
  const r = computeStorageTons(s, commodities);
  const capPct = s.capacityTons ? Math.min(100, (r.tons / s.capacityTons) * 100) : null;
  const ledger = storageLedgerStock(s, movements);
  const angleOfRepose = s.angleOfRepose ?? c?.angleOfRepose ?? 0;
  const tarp = s.kind === 'bunker'
    ? bunkerTarpRequirement({ width: s.width, length: s.length, angleDeg: angleOfRepose, overhangM: s.tarpOverhangM ?? 1.5 })
    : null;
  return `
    <div class="list-item" data-edit-storage="${s.id}">
      <div>
        <div class="main">${esc(s.name)} <span class="badge ${s.kind === 'silo' ? 'pos' : 'neg'}" style="background:var(--surface-2);color:var(--text-dim)">${s.kind === 'silo' ? 'Silo' : 'Bunker'}</span></div>
        <div class="meta">${esc(c ? c.name : 'No commodity set')}${capPct !== null ? ` · ${num(capPct, 0)}% of ${num(s.capacityTons, 0)} t cap` : ''}</div>
        <div class="meta">Tracked stock: ${num(ledger, 1)} t</div>
        ${tarp ? `<div class="meta">Tarp needed: ${num(tarp.tarpWidthNeeded, 1)} x ${num(tarp.tarpLengthNeeded, 1)} m</div>` : ''}
      </div>
      <div class="right">
        <div class="main">${tons(r.tons)}</div>
        <div class="meta">measured</div>
      </div>
    </div>
  `;
}

function openStorageSheet(existing) {
  const { commodities, movements } = db.get();
  const fixedMovementNet = existing ? movementNetForStorage(existing.id, movements) : 0;
  let kind = existing?.kind || 'silo';

  const body = openSheet(existing ? 'Edit storage' : 'Add storage', (root) => {
    build();

    function build() {
      root.innerHTML = `
        ${!existing ? `
        <div class="segmented" id="s-kind">
          <button data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${kind === 'bunker' ? 'active' : ''}">Bunker</button>
        </div>` : ''}
        ${field({ label: 'Name', id: 's-name', value: existing?.name, placeholder: existing?.kind === 'bunker' || kind === 'bunker' ? 'e.g. Bunker 1' : 'e.g. Silo 12 (155t)' })}
        ${field({ label: 'Commodity currently stored', id: 's-commodity', type: 'select', value: existing?.commodityId, options: commodityOptions(commodities) })}
        ${field({ label: 'Opening / current stock (t)', id: 's-opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0, hint: 'A stocktake baseline — movements adjust from here' })}
        <div class="row"><span class="label"><strong>Tracked stock</strong></span><span class="value" id="s-ledger-preview" style="font-size:20px">—</span></div>
        <hr class="sep" />
        ${kind === 'silo' ? `
          <div class="grid-2">
            ${field({ label: 'Radius (m)', id: 's-radius', type: 'number', step: '0.01', value: existing?.radius })}
            ${field({ label: 'Cone angle (°)', id: 's-cone', type: 'number', step: '1', value: existing?.coneAngle ?? 0, hint: '0 = flat bottom' })}
          </div>
          ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          <hr class="sep" />
          ${field({ label: 'Current grain height (m)', id: 's-height', type: 'number', step: '0.01', value: existing?.currentHeight })}
        ` : `
          <div class="grid-2">
            ${field({ label: 'Width (m)', id: 's-width', type: 'number', step: '0.01', value: existing?.width })}
            ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          </div>
          <hr class="sep" />
          ${field({ label: 'Current filled length (m)', id: 's-length', type: 'number', step: '0.01', value: existing?.length, hint: 'How much of the bunker currently has grain in it' })}
        `}
        ${field({ label: 'Angle of repose override (°, optional)', id: 's-angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'Leave blank to use the commodity default' })}
        ${field({ label: 'Test weight override (t/m³, optional)', id: 's-tw', type: 'number', step: '0.01', value: existing?.testWeight, hint: 'Leave blank to use the commodity default' })}
        ${kind === 'silo' ? `
        <div class="field">
          <label>Grain surface</label>
          <div class="segmented" id="s-fill">
            <button data-fill="peak" class="${(existing?.fillState || 'peak') === 'peak' ? 'active' : ''}">Peaked</button>
            <button data-fill="flat" class="${existing?.fillState === 'flat' ? 'active' : ''}">Flat</button>
            <button data-fill="decline" class="${existing?.fillState === 'decline' ? 'active' : ''}">Declined</button>
          </div>
        </div>` : ''}
        <div class="row"><span class="label"><strong>Estimated total (measured)</strong></span><span class="value" id="s-total-preview" style="font-size:20px">—</span></div>
        <div class="field hint">Set the level above after physically dipping the ${kind}. Tracked stock is separate: it's your opening/current stock figure plus movements in/out, and doesn't need to match the measured estimate exactly.</div>
        ${kind === 'bunker' ? `
        <hr class="sep" />
        ${field({ label: 'Tarp overhang per side (m)', id: 's-overhang', type: 'number', step: '0.1', value: existing?.tarpOverhangM ?? 1.5 })}
        <div class="row"><span class="label">Tarp width needed</span><span class="value" id="s-tarp-width">—</span></div>
        <div class="row"><span class="label">Tarp length needed</span><span class="value" id="s-tarp-length">—</span></div>
        ` : ''}
        <button class="btn" id="save" style="margin-top:8px">Save</button>
        ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete</button>` : ''}
      `;

      const kindSel = root.querySelector('#s-kind');
      if (kindSel) {
        kindSel.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-kind]');
          if (!btn) return;
          kind = btn.dataset.kind;
          build();
        });
      }

      let fillState = existing?.fillState || 'peak';
      const fillSel = root.querySelector('#s-fill');
      if (fillSel) {
        fillSel.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-fill]');
          if (!btn) return;
          fillState = btn.dataset.fill;
          fillSel.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
          recomputePreview();
        });
      }

      const ledgerPreview = root.querySelector('#s-ledger-preview');
      function recomputeLedger() {
        ledgerPreview.textContent = `${num(getNum(root, 's-opening') + fixedMovementNet, 1)} t`;
      }
      root.querySelector('#s-opening').addEventListener('input', recomputeLedger);
      recomputeLedger();

      const preview = root.querySelector('#s-total-preview');
      const tarpWidthEl = root.querySelector('#s-tarp-width');
      const tarpLengthEl = root.querySelector('#s-tarp-length');
      function recomputePreview() {
        const c = commodities.find((cc) => cc.id === getVal(root, 's-commodity'));
        const angleOverride = getVal(root, 's-angle');
        const twOverride = getVal(root, 's-tw');
        const angleOfRepose = angleOverride ? parseFloat(angleOverride) : (c?.angleOfRepose ?? 0);
        const testWeight = twOverride ? parseFloat(twOverride) : (c?.testWeight ?? 0);
        const r = kind === 'bunker'
          ? bunkerResult({ width: getNum(root, 's-width'), length: getNum(root, 's-length'), angleDeg: angleOfRepose, testWeight })
          : siloResult({ radius: getNum(root, 's-radius'), height: getNum(root, 's-height'), coneAngle: getNum(root, 's-cone'), angleOfRepose, testWeight, fillState });
        preview.textContent = `${num(r.tons, 1)} t`;
        if (kind === 'bunker' && tarpWidthEl) {
          const t = bunkerTarpRequirement({
            width: getNum(root, 's-width'), length: getNum(root, 's-length'),
            angleDeg: angleOfRepose, overhangM: getNum(root, 's-overhang'),
          });
          tarpWidthEl.textContent = `${num(t.tarpWidthNeeded, 1)} m`;
          tarpLengthEl.textContent = `${num(t.tarpLengthNeeded, 1)} m`;
        }
      }
      root.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', recomputePreview));
      recomputePreview();

      root.querySelector('#save').addEventListener('click', () => {
        const name = getVal(root, 's-name')?.trim();
        if (!name) { root.querySelector('#s-name').focus(); return; }
        const angleOverride = getVal(root, 's-angle');
        const twOverride = getVal(root, 's-tw');
        const payload = {
          id: existing?.id,
          kind,
          name,
          commodityId: getVal(root, 's-commodity') || null,
          openingStock: getNum(root, 's-opening'),
          capacityTons: getNum(root, 's-capacity') || null,
          angleOfRepose: angleOverride ? parseFloat(angleOverride) : null,
          testWeight: twOverride ? parseFloat(twOverride) : null,
        };
        if (kind === 'silo') {
          payload.radius = getNum(root, 's-radius');
          payload.coneAngle = getNum(root, 's-cone');
          payload.currentHeight = getNum(root, 's-height');
          payload.fillState = fillState;
        } else {
          payload.width = getNum(root, 's-width');
          payload.length = getNum(root, 's-length');
          payload.tarpOverhangM = getNum(root, 's-overhang');
        }
        db.upsertStorage(payload);
        closeSheet();
      });
      const del = root.querySelector('#del');
      if (del) {
        del.addEventListener('click', () => {
          confirmDelete(`Delete "${existing.name}"?`, () => {
            db.deleteStorage(existing.id);
            closeSheet();
          });
        });
      }
    }
  });
  return body;
}
