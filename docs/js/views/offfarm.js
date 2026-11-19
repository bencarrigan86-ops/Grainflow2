// Off-farm storage: grain held by a third party such as GrainCorp, tracked by commodity and grade.
//
// A card on the Storage screen lists the locations with what each holds, and a sheet sets one up. Loads
// into and out of a location are ordinary movements (see the movement form); what a location holds is
// worked out from them (offfarm.js).

import { db } from '../storage.js?v=427';
import { openSheet, closeSheet, openOver, field, getVal, confirmDelete, toast } from '../ui.js?v=427';
import { num, esc, money, dmy, todayLocal } from '../fmt.js?v=427';
import { storageFeesByMonth, feeTermsText, BASES, cleanFee } from '../storagefees.js?v=427';
import { downloadCSV } from '../csv.js?v=427';
import { safeFileName } from '../sharefile.js?v=427';
import { isOffFarm, holdings, totalHeld, cleanOffFarm } from '../offfarm.js?v=427';
import { gradeFieldHtml, wireGradeField } from '../gradepick.js?v=427';
import { renderRelatedMovements } from './movements.js?v=427';

const OPERATORS = ['GrainCorp', 'Viterra', 'Cargill', 'Emerald Grain', 'Louis Dreyfus', 'Olam', 'Bunge', 'CBH'];

const dollars = (n) => money(n, 2);

// the fees are money: the roles that see bills see them
const canSeeFees = () => ['owner', 'manager', 'bookkeeper'].includes(db.getRole());

const context = () => { const d = db.get(); return { fields: d.fields, storages: d.storages, sales: d.sales }; };

/** What a location holds, as lines grouped by commodity: "Wheat: APH1 450.0 t · H2 120.0 t". */
function holdingsLines(rows, commodities) {
  const names = new Map(commodities.map((c) => [c.id, c.name]));
  const byCommodity = new Map();
  for (const h of rows) {
    if (!byCommodity.has(h.commodityId)) byCommodity.set(h.commodityId, []);
    byCommodity.get(h.commodityId).push(h);
  }
  return [...byCommodity.entries()].map(([id, list]) => {
    const parts = list.map((h) => `${esc(h.grade || 'No grade')} ${num(h.tons, 1)} t${h.tons < 0 ? ' (over-drawn)' : ''}`);
    return `<div class="meta"><strong>${esc(names.get(id) || 'Unknown commodity')}</strong>: ${parts.join(' · ')}</div>`;
  }).join('');
}

/** The Off-farm storage card on the Storage screen. `box` is an empty element to fill. */
export function paintOffFarmCard(box) {
  const { commodities, storages, movements } = db.get();
  const locations = storages.filter(isOffFarm).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const ctx = context();
  const canEdit = ['owner', 'manager'].includes(db.getRole());
  const payables = canSeeFees() ? db.getPayables() : [];
  const today = todayLocal();
  box.innerHTML = `
    <div class="card input">
      <h2><span class="dot input"></span>Off-farm storage</h2>
      <div class="hint" style="margin-bottom:8px">Grain held by a third party such as GrainCorp, kept by grade.</div>
      ${locations.length === 0
        ? '<div class="empty" style="padding:8px 0">No off-farm locations yet.</div>'
        : locations.map((loc) => {
          const rows = holdings(loc, movements, ctx);
          return `
            <div class="list-item stack" data-edit-offfarm="${esc(loc.id)}">
              <div class="li-top">
                <div class="main">${esc(loc.name)}</div>
                <div class="main">${num(totalHeld(rows), 1)} t</div>
              </div>
              ${loc.offFarm.operator ? `<div class="meta">${esc(loc.offFarm.operator)}</div>` : ''}
              ${canSeeFees() && cleanFee(loc.offFarm.fee) ? `<div class="meta">Storage fee this month, estimated: ${dollars(storageFeesByMonth(loc, movements, payables, { today }).months.find((m) => m.current)?.estimate || 0)} ex GST</div>` : ''}
              ${rows.length ? holdingsLines(rows, commodities) : '<div class="meta">Nothing held</div>'}
            </div>`;
        }).join('')}
      ${canEdit ? '<button type="button" class="btn secondary small" id="add-offfarm" style="margin-top:8px">+ Add a location</button>' : ''}
    </div>`;
  box.querySelectorAll('[data-edit-offfarm]').forEach((el) => {
    el.addEventListener('click', () => openOffFarmSheet(db.get().storages.find((s) => s.id === el.dataset.editOfffarm)));
  });
  box.querySelector('#add-offfarm')?.addEventListener('click', () => openOffFarmSheet(null));
}

/** Set up a location, or edit one: its name, who runs it, and what it held at the start of the season. */
export function openOffFarmSheet(existing) {
  const { commodities, storages } = db.get();
  const usedOperators = [...new Set(storages.filter(isOffFarm).map((s) => s.offFarm.operator).filter(Boolean))];
  const operators = [...new Set([...usedOperators, ...OPERATORS])];
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));
  const fee0 = existing?.offFarm?.fee || {};
  const rows = [];   // one { row, commodity select, grade control, tonnes box } per opening holding
  let count = 0;

  openSheet(existing ? 'Edit off-farm location' : 'Add off-farm location', (root) => {
    root.innerHTML = `
      <datalist id="dl-operators">${operators.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
      ${field({ label: 'Location', id: 'of-name', value: existing?.name, placeholder: 'e.g. GrainCorp Gunnedah' })}
      ${field({ label: 'Run by', id: 'of-operator', value: existing?.offFarm?.operator, placeholder: 'e.g. GrainCorp', list: 'dl-operators' })}
      ${canSeeFees() ? `
      <div class="subhead">Storage charges</div>
      <div class="field hint" style="margin-bottom:8px">How this site charges you, so the app can estimate each month's fee. Leave the rates blank if there is no charge. Amounts are ex GST.</div>
      <div class="grid-2">
        ${field({ label: 'Storage ($/t a month)', id: 'of-fee-rate', type: 'number', step: '0.01', value: fee0.monthlyRate || '' })}
        ${field({ label: 'Counted on', id: 'of-fee-basis', type: 'select', value: fee0.basis || 'month_end', options: BASES })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Free until', id: 'of-fee-free', type: 'date', value: fee0.freeUntil || '' })}
        ${field({ label: 'Count from', id: 'of-fee-from', type: 'date', value: fee0.from || '' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Receival ($/t in)', id: 'of-fee-in', type: 'number', step: '0.01', value: fee0.receivalRate || '' })}
        ${field({ label: 'Outturn ($/t out)', id: 'of-fee-out', type: 'number', step: '0.01', value: fee0.outturnRate || '' })}
      </div>
      ${existing && cleanFee(existing.offFarm?.fee) ? '<button type="button" class="btn secondary small" id="of-fees" style="margin-bottom:10px">Storage fees month by month</button>' : ''}` : ''}
      <div class="subhead">Held at the start of the season</div>
      <div class="field hint" style="margin-bottom:8px">What this location already held, by grade. Loads delivered to it and
        drawn from it after that adjust each grade.</div>
      <div id="of-rows"></div>
      <button type="button" class="btn secondary small" id="of-add">+ Add a holding</button>
      ${field({ label: 'Notes', id: 'of-notes', type: 'textarea', value: existing?.notes, placeholder: 'Account number, contact, anything worth keeping' })}
      ${existing ? `<div class="subhead">Held now</div><div id="of-now"></div><div id="of-moves" style="margin:12px 0"></div>` : ''}
      ${existing ? '<button class="btn ghost-danger" id="of-del" style="margin-top:8px">Delete location</button>' : ''}
      <div class="save-bar solo"><button class="btn" id="save">Save</button></div>`;

    const rowsEl = root.querySelector('#of-rows');
    const commodityOf = (select) => commodities.find((c) => c.id === select.value);

    const addRow = (h = {}) => {
      const n = (count += 1);
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:10px';
      const firstCommodity = h.commodityId || commodities[0]?.id;
      row.innerHTML = `
        <div class="grid-2">
          ${field({ label: 'Commodity', id: `of-c-${n}`, type: 'select', value: firstCommodity, options: commodityOptions })}
          ${gradeFieldHtml({ id: `of-g-${n}`, commodity: commodities.find((c) => c.id === firstCommodity), value: h.grade })}
        </div>
        <div class="grid-2">
          ${field({ label: 'Tonnes', id: `of-t-${n}`, type: 'number', step: '0.01', value: h.tons ?? '' })}
          <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn danger small of-remove" style="width:auto">Remove</button></div>
        </div>`;
      rowsEl.appendChild(row);
      const select = row.querySelector(`#of-c-${n}`);
      const entry = { row, select, ctl: wireGradeField(row, `of-g-${n}`, () => commodityOf(select)), tons: row.querySelector(`#of-t-${n}`) };
      select.addEventListener('change', () => entry.ctl.refresh());
      row.querySelector('.of-remove').addEventListener('click', () => { rows.splice(rows.indexOf(entry), 1); row.remove(); });
      rows.push(entry);
    };
    (existing?.offFarm?.opening || []).forEach(addRow);
    root.querySelector('#of-add').addEventListener('click', () => addRow());

    root.querySelector('#of-fees')?.addEventListener('click', () => openOver(() => openStorageFeesSheet(existing)));

    if (existing) {
      const { movements } = db.get();
      const now = holdings(existing, movements, context());
      root.querySelector('#of-now').innerHTML = now.length
        ? `${holdingsLines(now, commodities)}<div class="row" style="margin-top:6px"><span class="label"><strong>Total</strong></span><span class="value"><strong>${num(totalHeld(now), 1)} t</strong></span></div>`
        : '<div class="hint">Nothing held now.</div>';
      renderRelatedMovements(root.querySelector('#of-moves'), 'silo', existing.id, { collapsed: true });
      root.querySelector('#of-del').addEventListener('click', () => {
        confirmDelete(`Delete "${existing.name}"? Loads to and from it keep showing it as missing.`, () => {
          db.deleteStorage(existing.id);
          closeSheet();
        });
      });
    }

    root.querySelector('#save').addEventListener('click', () => {
      const name = getVal(root, 'of-name')?.trim();
      if (!name) { root.querySelector('#of-name').focus(); return; }
      const offFarm = cleanOffFarm({
        operator: getVal(root, 'of-operator'),
        opening: rows.map((r) => ({ commodityId: r.select.value, grade: r.ctl.read(), tons: parseFloat(r.tons.value) })),
        // a role that is not shown the fees leaves them as they were
        fee: canSeeFees() ? {
          monthlyRate: parseFloat(getVal(root, 'of-fee-rate')), basis: getVal(root, 'of-fee-basis'), freeUntil: getVal(root, 'of-fee-free'), from: getVal(root, 'of-fee-from'),
          receivalRate: parseFloat(getVal(root, 'of-fee-in')), outturnRate: parseFloat(getVal(root, 'of-fee-out')),
        } : existing?.offFarm?.fee,
      });
      db.upsertStorage({
        id: existing?.id,
        kind: existing?.kind || 'silo',
        name,
        offFarm,
        notes: getVal(root, 'of-notes')?.trim(),
      });
      closeSheet();
      toast('Saved');
    });
  });
}

/** The month-by-month estimate for one location, beside what the site has billed, with a CSV for Excel. */
export function openStorageFeesSheet(location) {
  const { movements } = db.get();
  const today = todayLocal();
  const r = storageFeesByMonth(location, movements, db.getPayables(), { today });
  openSheet(`Storage fees: ${location.name}`, (root) => {
    if (!r.terms) { root.innerHTML = '<div class="empty">No storage charge set for this location.</div>'; return; }
    const diffCell = (m) => (m.difference === null ? '&ndash;' : `<span style="color:var(--${m.difference > 0.005 ? 'warn' : 'text'})">${m.difference > 0 ? '+' : ''}${dollars(m.difference)}</span>`);
    const body = r.months.map((m) => `<tr><td style="text-align:left">${esc(m.label)}${m.current ? ' <span class="meta">(this month)</span>' : ''}</td><td>${num(m.heldEnd, 1)}</td><td>${dollars(m.estimate)}</td><td>${m.billed === null ? '&ndash;' : dollars(m.billed)}</td><td>${diffCell(m)}</td></tr>`).join('');
    root.innerHTML = `
      <div class="hint" style="margin-bottom:8px">${esc(feeTermsText(r.terms, dmy))}. Estimated from the loads in and out; amounts are ex GST. A storage bill recorded in Receivables &amp; payables against this location shows beside its month (by invoice date), with how far it is above or below the estimate.</div>
      <div class="table-scroll"><table>
        <thead><tr><th style="text-align:left">Month</th><th>Held at month end (t)</th><th>Estimate</th><th>Billed</th><th>Billed less estimate</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td style="text-align:left"><strong>Total</strong></td><td></td><td><strong>${dollars(r.totals.estimate)}</strong></td><td><strong>${dollars(r.totals.billed)}</strong></td><td></td></tr></tfoot>
      </table></div>
      <div class="hint" style="margin-top:8px">The current month is estimated for the whole month at today's tonnes. Grain held before the first load is counted from the date in Count from.</div>
      <button type="button" class="btn secondary" id="fees-csv" style="margin-top:8px">Excel (CSV)</button>`;
    root.querySelector('#fees-csv').addEventListener('click', () => {
      const head = ['Month', 'Held at month end (t)', 'Average held (t)', 'Storage ($)', 'Receival ($)', 'Outturn ($)', 'Estimate ($)', 'Billed ($)', 'Billed less estimate ($)'];
      const lines = [head, ...r.months.map((m) => [m.label, m.heldEnd, m.avgHeld, m.storage, m.receival, m.outturn, m.estimate, m.billed ?? '', m.difference ?? ''])];
      lines.push(['Total', '', '', '', '', '', r.totals.estimate, r.totals.billed, '']);
      const cell = (v) => { const t = String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      downloadCSV(safeFileName(`grainflow-storage-fees-${location.name}-${today}`, 'csv'), lines.map((l) => l.map(cell).join(',')).join('\r\n'));
      toast('Downloaded. It opens in Excel.');
    });
  });
}
