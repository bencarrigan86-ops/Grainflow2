// Season set-up for silos.
//
// Paste the list of silos that still hold last season's grain, check what the
// screen has made of it, and apply: those carry over with their crop year and
// every other silo is emptied. Nothing changes until the last button, and the
// last button says what it is about to do — including how much recorded stock it
// is about to zero.
//
// The reading and the rules are in silosetup.js, where they are tested.

import { db } from '../storage.js?v=165';
import { openSheet, closeSheet, toast, askConfirm, notify } from '../ui.js?v=165';
import { esc, num } from '../fmt.js?v=165';
import { isTransit } from '../transit.js?v=165';
import { parseCarryOver, decisionsFromList, summarise, patchesFor } from '../silosetup.js?v=165';

const natural = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

export function openSiloSetupSheet() {
  const { storages, commodities } = db.get();
  const silos = storages.filter((x) => !isTransit(x)).sort(natural);
  const decisions = Object.fromEntries(silos.map((s) => [s.id, { action: 'leave' }]));

  openSheet('Season set-up for silos', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">For the turn of the season. Say which silos still hold last
        season's grain and they keep it, with the crop year you give. Every other silo is emptied: stock figure and grain
        height back to nothing, and its quality notes cleared. Nothing changes until you tap Apply at the bottom.</div>
      <div class="field"><label for="ss-year">Crop year of the carried-over grain</label>
        <input id="ss-year" type="text" value="25/26" /></div>
      <div class="field"><label for="ss-list">Which silos still have grain in them?</label>
        <textarea id="ss-list" rows="5" placeholder="Wheat: Kot03, Kot04, Kot05&#10;Barley: Kot01&#10;Faba Beans: 43, 42, 13"></textarea>
        <div class="hint">One commodity per line. A silo can be written as it is named or by its number.</div></div>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="ss-others" checked style="width:auto" />
        <span class="label" style="flex:1">Clear every silo that is not on the list</span></label>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="ss-commodity" checked style="width:auto" />
        <span class="label" style="flex:1">Cleared silos also lose their commodity</span></label>
      <button type="button" class="btn secondary small" id="ss-read" style="margin:10px 0">Read this list</button>
      <div id="ss-read-result"></div>
      <div class="subhead">Every silo</div>
      <div id="ss-table"></div>
      <div class="card" id="ss-summary" style="margin-top:12px"></div>
      <div class="save-bar solo"><button class="btn" id="ss-apply" disabled>Apply</button></div>`;

    const options = () => ({
      cropYear: root.querySelector('#ss-year').value,
      clearCommodity: root.querySelector('#ss-commodity').checked,
    });

    const commodityOptions = (selected) => `<option value="">No commodity</option>${commodities
      .map((c) => `<option value="${esc(c.id)}" ${selected === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;

    const paintTable = () => {
      root.querySelector('#ss-table').innerHTML = silos.map((s) => {
        const d = decisions[s.id];
        const here = commodities.find((c) => c.id === s.commodityId)?.name;
        return `<div class="row" style="align-items:flex-start;gap:8px">
          <span class="label" style="flex:1"><strong>${esc(s.name)}</strong>
            <div class="meta">${esc(here || 'no commodity')} · stock ${num(s.openingStock || 0, 1)} t${s.cropYear ? ` · ${esc(s.cropYear)}` : ''}</div></span>
          <span style="display:flex;flex-direction:column;gap:6px;min-width:130px">
            <select data-sid="${esc(s.id)}" data-role="action" aria-label="What to do with ${esc(s.name)}">
              <option value="leave" ${d.action === 'leave' ? 'selected' : ''}>Leave alone</option>
              <option value="carry" ${d.action === 'carry' ? 'selected' : ''}>Carry over</option>
              <option value="clear" ${d.action === 'clear' ? 'selected' : ''}>Clear</option>
            </select>
            <select data-sid="${esc(s.id)}" data-role="commodity" aria-label="Commodity in ${esc(s.name)}" style="${d.action === 'carry' ? '' : 'display:none'}">
              ${commodityOptions(d.commodityId ?? s.commodityId)}
            </select>
          </span>
        </div>`;
      }).join('');
    };

    const paintSummary = () => {
      const s = summarise(silos, decisions, options());
      const lost = s.stockCleared.filter((x) => x.openingStock > 0);
      root.querySelector('#ss-summary').innerHTML = `
        <div class="row"><span class="label">Carry over</span><span class="value">${s.carry}</span></div>
        <div class="row"><span class="label">Clear</span><span class="value">${s.clear}</span></div>
        <div class="row"><span class="label">Leave alone</span><span class="value">${s.leave}</span></div>
        ${lost.length ? `<div class="field hint" style="margin-top:6px;color:var(--danger)">Recorded stock that will be set to zero:
          ${lost.slice(0, 8).map((x) => `${esc(x.name)} ${num(x.openingStock, 1)} t`).join(', ')}${lost.length > 8 ? ` and ${lost.length - 8} more` : ''}.</div>` : ''}`;
      root.querySelector('#ss-apply').disabled = s.changes === 0;
      root.querySelector('#ss-apply').textContent = s.changes ? `Apply to ${s.changes} silo${s.changes === 1 ? '' : 's'}` : 'Nothing to apply';
    };

    root.querySelector('#ss-read').addEventListener('click', () => {
      const text = root.querySelector('#ss-list').value;
      const { entries, unmatched, unknownLines } = parseCarryOver(text, commodities, silos);
      const next = decisionsFromList(silos, entries, { clearOthers: root.querySelector('#ss-others').checked });
      for (const s of silos) decisions[s.id] = next[s.id];
      const problems = [
        ...unmatched.map((t) => `“${esc(t)}” is not a silo in the app`),
        ...unknownLines.map((l) => `“${esc(l)}” does not start with one of your commodities`),
      ];
      root.querySelector('#ss-read-result').innerHTML = `
        <div class="field hint">${entries.length} silo${entries.length === 1 ? '' : 's'} found on the list.</div>
        ${problems.length ? `<div class="field hint" style="color:var(--danger)">${problems.join('<br/>')}<br/>Fix the list or choose them below. Any silo you meant that is not found will be treated as one to clear.</div>` : ''}`;
      paintTable(); paintSummary();
    });

    root.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-sid]');
      if (sel) {
        const d = decisions[sel.dataset.sid];
        if (sel.dataset.role === 'action') {
          d.action = sel.value;
          const s = silos.find((x) => x.id === sel.dataset.sid);
          if (d.action === 'carry' && d.commodityId === undefined) d.commodityId = s.commodityId || '';
          const box = root.querySelector(`select[data-sid="${CSS.escape(sel.dataset.sid)}"][data-role="commodity"]`);
          if (box) box.style.display = d.action === 'carry' ? '' : 'none';
        } else d.commodityId = sel.value;
      }
      paintSummary();
    });
    root.querySelector('#ss-year').addEventListener('input', paintSummary);

    root.querySelector('#ss-apply').addEventListener('click', async () => {
      const opts = options();
      const s = summarise(silos, decisions, opts);
      if (s.carry > 0 && !opts.cropYear.trim()) { root.querySelector('#ss-year').focus(); notify('Give the crop year of the carried-over grain first, for example 25/26.'); return; }
      const lost = s.stockCleared.length;
      const ok = await askConfirm(
        `Carry over ${s.carry} silo${s.carry === 1 ? '' : 's'} as ${opts.cropYear.trim() || 'no crop year'} and clear ${s.clear}?` +
        (lost ? `\n\n${lost} cleared silo${lost === 1 ? ' has' : 's have'} recorded stock that will be set to zero.` : '') +
        '\n\nThere is no undo for this. Export a backup from Settings first if you have not.',
        { confirmLabel: 'Apply', danger: s.clear > 0 });
      if (!ok) return;
      let changed = 0;
      for (const { storage, patch } of patchesFor(silos, decisions, opts)) {
        db.upsertStorage({ id: storage.id, ...patch });
        changed += 1;
      }
      closeSheet();
      toast(`Updated ${changed} silo${changed === 1 ? '' : 's'}`);
    });

    paintTable();
    paintSummary();
  });
}
