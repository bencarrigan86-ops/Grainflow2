// Recently deleted: what was deleted in the last 60 days, and a way to bring it back.
//
// Deleting in the app only marks a record deleted; it stays on the server. The list and the restore are server
// functions (list_deleted, restore_row), because the app's ordinary reads never see deleted records. Restoring a
// contract, paddock or load brings back what was deleted along with it. Only owners and managers can open this, and
// only owners see contracts, invoices and bills.

import { db } from '../storage.js?v=240';
import { supabase } from '../supabase.js?v=240';
import { openSheet, toast, notify } from '../ui.js?v=240';
import { esc } from '../fmt.js?v=240';
import { typeLabel, TYPES, whenText, restoreMessage, visibleDeleted } from '../deleted.js?v=240';

const DAYS = 60;
let filterKind = '';   // kept while the app is open

export function openDeletedSheet() {
  openSheet('Recently deleted', (root) => {
    let rows = null;       // null until the server has answered
    let problem = '';

    const draw = () => {
      if (problem) {
        root.innerHTML = `<div class="empty" style="padding:10px 0">${esc(problem)}</div><button type="button" class="btn secondary" id="del-retry">Try again</button>`;
        root.querySelector('#del-retry').addEventListener('click', load);
        return;
      }
      if (rows === null) { root.innerHTML = '<div class="empty" style="padding:10px 0">Looking&hellip;</div>'; return; }
      const kinds = TYPES.filter((t) => rows.some((r) => r.tbl === t));
      const shown = visibleDeleted(rows, filterKind);
      root.innerHTML = `
        <div class="field hint" style="margin-bottom:8px">Everything deleted in the last ${DAYS} days. Restoring brings back what was deleted with it: a contract's terms and orders, a paddock's agronomy, a load's photo.</div>
        ${kinds.length > 1 ? `<div class="chips" style="margin-bottom:10px">
          <button type="button" class="chip ${filterKind ? '' : 'active'}" data-kind="">All</button>
          ${kinds.map((k) => `<button type="button" class="chip ${filterKind === k ? 'active' : ''}" data-kind="${k}">${esc(typeLabel(k))}</button>`).join('')}
        </div>` : ''}
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${rows.length ? 'Nothing of that kind.' : 'Nothing has been deleted in the last 60 days.'}</div>` : shown.map((r) => `
          <div class="list-item stack">
            <div class="li-top"><div class="main">${esc(r.label || typeLabel(r.tbl))}</div><div class="meta">${esc(typeLabel(r.tbl))}</div></div>
            <div class="meta">${[r.detail, r.season].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="li-foot"><span class="meta">Deleted ${esc(whenText(r.deleted_at))}</span>
              <button type="button" class="btn secondary small" data-restore="${esc(r.tbl)}:${esc(r.id)}" style="width:auto">Restore</button></div>
          </div>`).join('')}`;
      root.querySelectorAll('.chips [data-kind]').forEach((b) => b.addEventListener('click', () => { filterKind = b.dataset.kind; draw(); }));
      root.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restore(b)));
    };

    async function load() {
      problem = '';
      rows = null;
      draw();
      if (!navigator.onLine) { problem = 'You need signal to look at what was deleted. Try again when you have some.'; draw(); return; }
      const { data, error } = await supabase.rpc('list_deleted', { p_farm: db.getFarmId(), p_days: DAYS });
      if (error) {
        problem = /not allowed/i.test(error.message) ? 'Only the owner and managers can see what was deleted.' : 'Could not look just now. Check your signal and try again.';
      } else {
        rows = data || [];
      }
      draw();
    }

    async function restore(btn) {
      const [tbl, ...rest] = btn.dataset.restore.split(':');
      const id = rest.join(':');
      btn.disabled = true;
      btn.textContent = 'Restoring…';
      const { error } = await supabase.rpc('restore_row', { p_table: tbl, p_id: id });
      if (error) {
        btn.disabled = false;
        btn.textContent = 'Restore';
        notify(restoreMessage(error.message));
        return;
      }
      // bring it back into the app: a refresh declines while this device still has unsent changes
      const result = await db.refreshFromServer().catch(() => ({ refreshed: false }));
      if (result.refreshed) toast('Restored');
      else {
        db.pushNow();
        toast('Restored on the server. It shows here once this device has finished syncing.', 4000);
      }
      load();
    }

    load();
  });
}
