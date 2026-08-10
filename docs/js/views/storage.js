import { db } from '../storage.js?v=9';
import { siloResult, bunkerResult } from '../calc.js?v=9';
import { storageLedgerStock, movementNetForStorage } from '../derived.js?v=9';
import { num, tons, esc } from '../fmt.js?v=9';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=9';

let unsub = null;
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
        <div class="sub">Silo &amp; bunker volume calculator</div>
      </div>
    </div>
    <div class="view">
      <div class="card">
        <h2>Quick calculator</h2>
        <div class="segmented" id="quick-kind">
          <button data-kind="silo" class="${quickKind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${quickKind === 'bunker' ? 'active' : ''}">Bunker</button>
        </div>
        <div id="quick-form" style="margin-top:12px"></div>
        <div id="quick-result"></div>
      </div>

      <div class="card">
        <h2>Saved silos &amp; bunkers</h2>
        ${storages.length === 0 ? `<div class="empty">Tap + to save a silo or bunker so you only enter today's level next time.</div>` : storages.map((s) => storageRow(s, commodities, movements)).join('')}
      </div>
    </div>
    <button class="fab" id="add-storage">+</button>
  `;

  root.querySelector('#quick-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    quickKind = btn.dataset.kind;
    paint(root);
  });
  buildQuickForm(root, commodities);

  root.querySelectorAll('[data-edit-storage]').forEach((el) => {
    el.addEventListener('click', () => openStorageSheet(storages.find((s) => s.id === el.dataset.editStorage)));
  });
  root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
}

function commodityOptions(commodities, includeNone = true) {
  const opts = commodities.map((c) => ({ value: c.id, label: c.name }));
  return includeNone ? [{ value: '', label: 'None / manual' }, ...opts] : opts;
}

function buildQuickForm(root, commodities) {
  const formEl = root.querySelector('#quick-form');
  const resultEl = root.querySelector('#quick-result');

  if (quickKind === 'silo') {
    formEl.innerHTML = `
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptions(commodities) })}
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
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptions(commodities) })}
      <div class="grid-2">
        ${field({ label: 'Width (m)', id: 'q-width', type: 'number', step: '0.01' })}
        ${field({ label: 'Length (m)', id: 'q-length', type: 'number', step: '0.01' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Peak angle (°)', id: 'q-angle', type: 'number', step: '1', hint: 'Grain angle of repose' })}
        ${field({ label: 'Test weight (t/m³)', id: 'q-tw', type: 'number', step: '0.01' })}
      </div>
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
      resultEl.innerHTML = quickResultHTML(r.tons, [
        ['Volume', `${num(r.volume, 1)} m³`],
        ['Peak height', `${num(r.height, 2)} m`],
      ]);
    }
    recompute();
  }
}

function quickResultHTML(tonsVal, extraRows) {
  return `
    <hr class="sep" />
    <div class="row"><span class="label"><strong>Tons</strong></span><span class="value" style="font-size:22px">${num(tonsVal, 1)} t</span></div>
    ${extraRows.map(([l, v]) => `<div class="row"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('')}
  `;
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
  return `
    <div class="list-item" data-edit-storage="${s.id}">
      <div>
        <div class="main">${esc(s.name)} <span class="badge ${s.kind === 'silo' ? 'pos' : 'neg'}" style="background:var(--surface-2);color:var(--text-dim)">${s.kind === 'silo' ? 'Silo' : 'Bunker'}</span></div>
        <div class="meta">${esc(c ? c.name : 'No commodity set')}${capPct !== null ? ` · ${num(capPct, 0)}% of ${num(s.capacityTons, 0)} t cap` : ''}</div>
        <div class="meta">Tracked stock: ${num(ledger, 1)} t</div>
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
