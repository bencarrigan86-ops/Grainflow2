import { db } from '../storage.js?v=20';
import { siloResult, bunkerResult, bunkerTarpRequirement } from '../calc.js?v=20';
import { num } from '../fmt.js?v=20';
import { field, getVal, getNum } from '../ui.js?v=20';

let unsub = null;
let quickKind = 'silo';

export function renderCalculator(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities } = db.get();

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Calculator</h1>
        <div class="sub">Quick one-off silo &amp; bunker volume calc</div>
      </div>
    </div>
    <div class="view">
      <div class="card">
        <div class="segmented" id="quick-kind">
          <button data-kind="silo" class="${quickKind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${quickKind === 'bunker' ? 'active' : ''}">Bunker</button>
        </div>
        <div id="quick-form" style="margin-top:12px"></div>
        <div id="quick-result"></div>
      </div>
      <div class="field hint" style="padding:0 4px">Want to save this silo or bunker so you only enter today's level next time? Do that in the Storage tab instead.</div>
    </div>
  `;

  root.querySelector('#quick-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    quickKind = btn.dataset.kind;
    paint(root);
  });
  buildQuickForm(root, commodities);
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
