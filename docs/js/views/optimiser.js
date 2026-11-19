// The outload optimiser screen. See ../optimiser.js for what it works out and how.
//
// Everything it needs is in one sheet: say what the load is (tonnes, truck, spec), and it lists the ways to fill it from
// the storages of that commodity. It saves nothing. To take the feature out, delete this file, ../optimiser.js and
// tests/optimiser.test.mjs, and remove the one chip and its import in storage.js.

import { db } from '../storage.js?v=439';
import { openSheet, field, getVal, getNum, notify } from '../ui.js?v=439';
import { num, esc, todayLocal, dmy } from '../fmt.js?v=439';
import { SPECS, extraSpecKey } from '../outload.js?v=439';
import { sourcesFor, optimise, limitsOf } from '../optimiser.js?v=439';

// what was asked last time, kept while the app is open
let last = { commodityId: '', tons: '', truck: 36, mode: 'every-truck', grades: [], min: {}, max: {} };

const labelOf = (key) => SPECS.find((s) => s.key === key) || { label: key, unit: '', dp: 1 };
const fmt = (key, v) => (v === null || v === undefined ? 'not recorded' : `${num(v, labelOf(key).dp)}${labelOf(key).unit ? ` ${labelOf(key).unit}` : ''}`);

/** The commodity with the most grain in storage, so the sheet opens on the one most likely wanted. */
function busiestCommodity(storages, movements, today) {
  let best = { id: '', tons: 0 };
  for (const c of db.get().commodities) {
    const { sources } = sourcesFor({ storages, movements, commodityId: c.id, today });
    const tons = sources.reduce((a, s) => a + s.total, 0);
    if (tons > best.tons) best = { id: c.id, tons };
  }
  return best.id;
}

export function openOptimiserSheet() {
  const { storages, movements, commodities } = db.get();
  const today = todayLocal();
  if (!commodities.length) { notify('Add a commodity and some storages first.'); return; }
  if (!last.commodityId || !commodities.some((c) => c.id === last.commodityId)) last.commodityId = busiestCommodity(storages, movements, today) || commodities[0].id;

  openSheet('Silo blending', (root) => {
    const commodity = () => commodities.find((c) => c.id === (getVal(root, 'op-commodity') || last.commodityId));
    const extra = () => extraSpecKey(commodity()?.name);
    const stored = () => sourcesFor({ storages, movements, commodityId: commodity()?.id, today });

    const paintForm = () => {
      last.commodityId = commodity()?.id || last.commodityId;
      const { sources, left } = stored();
      const grades = [...new Set(sources.flatMap((s) => s.out.map((l) => l.spec?.grade || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      last.grades = last.grades.filter((g) => grades.includes(g));
      const x = extra();
      const xMin = x === 'oilPct' ? 'oilPct' : 'retentionPct';
      root.innerHTML = `
        <div class="hint" style="margin-bottom:10px">Say what the load needs. It looks at what each storage would give up, in the order it empties (top first for a silo, the end chosen on a bunker), and suggests where to take it from.</div>
        <section class="form-section">
          <div class="subhead">The load</div>
          ${field({ label: 'Commodity', id: 'op-commodity', type: 'select', value: last.commodityId, options: commodities.map((c) => ({ value: c.id, label: c.name })) })}
          <div class="grid-2">
            ${field({ label: 'Tonnes needed', id: 'op-tons', type: 'number', step: '1', value: last.tons })}
            ${field({ label: 'Truck size (t)', id: 'op-truck', type: 'number', step: '1', value: last.truck })}
          </div>
          <div class="hint" style="margin:-4px 0 8px">${sources.length} storage${sources.length === 1 ? '' : 's'} with ${esc(commodity()?.name || 'this commodity')}: ${num(sources.reduce((a, s) => a + s.total, 0), 0)} t.${left.length ? ` ${left.length} left out (see below).` : ''}</div>
        </section>
        <section class="form-section alt">
          <div class="subhead">The spec <span class="meta">(leave blank for no limit)</span></div>
          ${grades.length ? `<div class="field"><label>Grades accepted</label>
            <div class="chips" id="op-grades">${grades.map((g) => `<button type="button" class="chip ${last.grades.includes(g) ? 'active' : ''}" data-grade="${esc(g)}">${esc(g)}</button>`).join('')}</div>
            <div class="hint">None picked means any grade.</div></div>` : ''}
          <div class="grid-2">
            ${field({ label: 'Protein at least (%)', id: 'op-min-proteinPct', type: 'number', step: '0.1', value: last.min.proteinPct ?? '' })}
            ${field({ label: 'Moisture at most (%)', id: 'op-max-moisturePct', type: 'number', step: '0.1', value: last.max.moisturePct ?? '' })}
          </div>
          <div class="grid-2">
            ${field({ label: 'Screenings at most (%)', id: 'op-max-screeningsPct', type: 'number', step: '0.1', value: last.max.screeningsPct ?? '' })}
            ${field({ label: 'Test weight at least', id: 'op-min-testWeightKgHl', type: 'number', step: '0.1', value: last.min.testWeightKgHl ?? '' })}
          </div>
          <div class="grid-2">
            ${field({ label: 'Falling no. at least', id: 'op-min-fallingNumber', type: 'number', step: '1', value: last.min.fallingNumber ?? '' })}
            ${x === 'oilPct'
              ? field({ label: 'Oil at least (%)', id: 'op-min-oilPct', type: 'number', step: '0.1', value: last.min.oilPct ?? '' })
              : field({ label: 'Retention at least (%)', id: 'op-min-retentionPct', type: 'number', step: '0.1', value: last.min[xMin] ?? '' })}
          </div>
          ${x === 'oilPct' ? field({ label: 'Free fatty acid at most (%)', id: 'op-max-ffaPct', type: 'number', step: '0.01', value: last.max.ffaPct ?? '' }) : ''}
          <div class="field">
            <label>The spec has to be met by</label>
            <div class="segmented" id="op-mode">
              <button type="button" data-mode="every-truck" class="${last.mode === 'every-truck' ? 'active' : ''}">Every truck</button>
              <button type="button" data-mode="average" class="${last.mode === 'average' ? 'active' : ''}">The whole outload</button>
            </div>
            <div class="hint">${last.mode === 'every-truck' ? 'Each truck is graded on its own, so each must meet it.' : 'Only the average of all the trucks has to meet it.'}</div>
          </div>
        </section>
        <button class="btn" id="op-go" style="margin-top:12px">Find options</button>
        <div id="op-out" style="margin-top:12px"></div>
        ${left.length ? `<details class="fold" id="op-left"><summary><div><h2>Left out</h2><div class="sub">${left.length} storage${left.length === 1 ? '' : 's'} not used</div></div></summary>
          ${left.map((l) => `<div class="row"><span class="label">${esc(l.name)}</span><span class="value" style="font-size:13px">${esc(l.withheldUntil ? `Withholding until ${dmy(l.withheldUntil)}` : l.why)}</span></div>`).join('')}</details>` : ''}`;
      wire();
    };

    const readForm = () => {
      last.tons = getVal(root, 'op-tons') ?? '';
      last.truck = getVal(root, 'op-truck') ?? 36;
      last.min = {}; last.max = {};
      for (const el of root.querySelectorAll('[id^="op-min-"], [id^="op-max-"]')) {
        const [, kind, key] = el.id.split('-');
        if (el.value !== '') (kind === 'min' ? last.min : last.max)[key] = Number(el.value);
      }
    };

    const wire = () => {
      root.querySelector('#op-commodity').addEventListener('change', () => { readForm(); last.grades = []; last.commodityId = getVal(root, 'op-commodity'); paintForm(); });
      root.querySelector('#op-grades')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-grade]');
        if (!b) return;
        const g = b.dataset.grade;
        last.grades = last.grades.includes(g) ? last.grades.filter((x) => x !== g) : [...last.grades, g];
        b.classList.toggle('active');
      });
      root.querySelector('#op-mode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        readForm(); last.mode = b.dataset.mode; paintForm();
      });
      root.querySelector('#op-go').addEventListener('click', run);
    };

    const verdict = (fails, kind) => (fails.length ? `<span style="color:var(--danger)">${kind}</span>` : '<span style="color:var(--accent-summary)">Meets it</span>');

    const optionHtml = (o, i, tag) => {
      const title = o.parts.length === 1 ? `${esc(o.parts[0].name)} alone`
        : o.parts.map((p) => `${Math.round(p.share * 100)}% ${esc(p.name)}`).join(' + ');
      const rows = limitsOf(last).map((l) => {
        const avg = o.avg[l.key];
        const worst = o.worst[l.key];
        const ok = (v) => v !== null && v !== undefined && (l.kind === 'min' ? v >= l.value - 1e-9 : v <= l.value + 1e-9);
        const good = last.mode === 'average' ? ok(avg) : ok(worst);
        return `<tr><td>${esc(labelOf(l.key).label)}</td><td>${l.kind === 'min' ? '&ge;' : '&le;'} ${esc(num(l.value, labelOf(l.key).dp))}</td><td>${esc(fmt(l.key, avg))}</td><td style="color:var(${good ? '--accent-summary' : '--danger'})">${esc(fmt(l.key, worst))}</td></tr>`;
      }).join('');
      const grades = Object.entries(o.grades).filter(([, t]) => t > 0.05).sort((a, b) => b[1] - a[1]).map(([g, t]) => `${esc(g || 'No grade')} ${num(t, 0)} t`).join(' · ');
      return `
        <div class="card opt-card">
          <div class="li-top"><div class="main">${title}</div>${tag ? `<span class="badge pos">${esc(tag)}</span>` : ''}</div>
          ${o.parts.map((p) => `<div class="row"><span class="label">${esc(p.name)}</span><span class="value">${num(p.tons, 0)} t · about ${num(p.trucks, 1)} truck${p.trucks === 1 ? '' : 's'}</span></div>`).join('')}
          ${grades ? `<div class="meta" style="margin:6px 0">${grades}</div>` : ''}
          ${rows ? `<div class="table-scroll"><table class="opt-table"><thead><tr><th></th><th>Need</th><th>Average</th><th>Worst truck</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
        </div>`;
    };

    const run = () => {
      readForm();
      const out = root.querySelector('#op-out');
      const tons = Number(last.tons);
      if (!(tons > 0)) { root.querySelector('#op-tons').focus(); out.innerHTML = '<div class="hint" style="color:var(--danger)">Enter the tonnes needed.</div>'; return; }
      const { sources } = stored();
      const res = optimise({ sources, tons, truck: Number(last.truck) || 36, mode: last.mode, rules: { grades: last.grades, min: last.min, max: last.max } });
      const header = `<div class="meta" style="margin-bottom:8px">${num(res.plan.total, 0)} t in ${res.plan.sizes.length} truck${res.plan.sizes.length === 1 ? '' : 's'} of up to ${num(res.plan.step, 0)} t. Each truck is loaded in the same proportions.</div>`;
      if (!sources.length) { out.innerHTML = '<div class="empty">No storage holds this commodity right now.</div>'; return; }
      if (res.stock + 1e-6 < res.plan.total) { out.innerHTML = `${header}<div class="empty">Only ${num(res.stock, 0)} t of this is in storage, short of the ${num(res.plan.total, 0)} t needed.</div>`; return; }
      if (res.options.length) {
        const tightest = [...res.options].sort((a, b) => a.giveaway - b.giveaway)[0];
        out.innerHTML = `${header}<h2 style="margin:6px 0">${res.options.length} way${res.options.length === 1 ? '' : 's'} to do it</h2>${res.options.map((o, i) => optionHtml(o, i, i === 0 ? 'Simplest' : (o === tightest ? 'Tightest to spec' : ''))).join('')}
          <div class="hint">Simplest uses the fewest storages. Tightest gives away the least above the spec, so the best grain stays in the silo.</div>`;
        return;
      }
      out.innerHTML = `${header}<div class="empty" style="padding:6px 0">Nothing meets that spec${last.mode === 'every-truck' ? ' on every truck' : ''}. The closest:</div>
        ${res.closest.map((o) => `${optionHtml(o, 0, '')}<div class="hint" style="margin:-4px 0 10px;color:var(--danger)">Misses: ${(last.mode === 'average' ? o.wholeFails : o.worstTruckFails).map((f) => `${f.key === 'grade' ? f.why : `${labelOf(f.key).label} ${f.why.toLowerCase()}${f.got !== null ? ` (${fmt(f.key, f.got)})` : ''}`}`).map(esc).join('; ')}</div>`).join('')}
        <div class="hint">${last.mode === 'every-truck' ? 'Try "The whole outload", or lower a limit.' : 'Try lowering a limit.'}</div>`;
    };

    paintForm();
  });
}
