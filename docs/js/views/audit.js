// Audit history: who changed what, and when. Newest first, a heading for each day, a chip for the kind of record.
//
// The log is written by the database (see audit.js and supabase/migrations/20261207000000_audit_log.sql); this reads it. It needs
// signal, as the log lives on the server. Owners, managers and bookkeepers can open it.

import { db } from '../storage.js?v=496';
import { supabase } from '../supabase.js?v=496';
import { openSheet, openOver } from '../ui.js?v=496';
import { esc } from '../fmt.js?v=496';
import { AUDIT_KINDS, auditTitle, changeLines, changeSummary, whoText, timeText, filterAudit, groupByDay, whenFull } from '../audit.js?v=496';

const PAGE = 50;
let filterKind = '';   // kept while the app is open

export function openAuditSheet() {
  openSheet('Audit history', (root) => {
    let rows = [];
    let more = false;       // true when the server has older entries than the ones loaded
    let loaded = false;
    let loading = false;
    let problem = '';

    const draw = () => {
      if (problem) {
        root.innerHTML = `<div class="empty" style="padding:10px 0">${esc(problem)}</div><button type="button" class="btn secondary" id="aud-retry">Try again</button>`;
        root.querySelector('#aud-retry').addEventListener('click', () => load(true));
        return;
      }
      if (!loaded) { root.innerHTML = '<div class="empty" style="padding:10px 0">Looking&hellip;</div>'; return; }
      const shown = filterAudit(rows, filterKind);
      const days = groupByDay(shown);
      root.innerHTML = `
        <div class="field hint" style="margin-bottom:8px">Who changed what, newest first. Tap a line for the before and after.</div>
        <div class="chips" style="margin-bottom:10px">
          <button type="button" class="chip ${filterKind ? '' : 'active'}" data-kind="">All</button>
          ${AUDIT_KINDS.map((k) => `<button type="button" class="chip ${filterKind === k.id ? 'active' : ''}" data-kind="${k.id}">${esc(k.label)}</button>`).join('')}
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${rows.length ? 'Nothing of that kind yet.' : 'Nothing has been recorded yet. Changes made from now on are listed here.'}</div>` : days.map((d) => `
          <div class="day-label"><span>${esc(d.heading)}</span></div>
          ${d.rows.map((r) => entryHtml(r)).join('')}`).join('')}
        ${more ? `<button type="button" class="btn secondary more-row" id="aud-more">${loading ? 'Looking&hellip;' : 'Show older changes'}</button>` : ''}`;
      root.querySelectorAll('.chips [data-kind]').forEach((b) => b.addEventListener('click', () => { filterKind = b.dataset.kind; draw(); }));
      root.querySelectorAll('[data-aud]').forEach((el) => el.addEventListener('click', () => {
        const r = rows.find((x) => String(x.id) === el.dataset.aud);
        if (r) openOver(() => openEntrySheet(r));
      }));
      root.querySelector('#aud-more')?.addEventListener('click', () => load(false));
    };

    async function load(fresh) {
      if (loading) return;
      loading = true;
      problem = '';
      if (fresh) { rows = []; loaded = false; }
      draw();
      if (!navigator.onLine) { problem = 'You need signal to see the audit history. Try again when you have some.'; loading = false; draw(); return; }
      const from = rows.length;
      const { data, error } = await supabase.from('audit_log')
        .select('id, at, user_email, user_role, table_name, row_id, action, label, changes')
        .eq('farm_id', db.getFarmId())
        .order('at', { ascending: false })
        .range(from, from + PAGE - 1);
      loading = false;
      if (error) {
        problem = /does not exist|schema cache|relation/i.test(error.message || '')
          ? 'The audit history is not switched on for this farm yet.'
          : 'Could not look just now. Check your signal and try again.';
      } else {
        rows = rows.concat(data || []);
        more = (data || []).length === PAGE;
        loaded = true;
      }
      draw();
    }

    load(true);
  });
}

/** One line of the list: what happened, who did it, when, and the first of what changed. */
function entryHtml(r) {
  const sum = changeSummary(r);
  return `<div class="list-item stack" data-aud="${esc(r.id)}" style="cursor:pointer">
    <div class="li-top"><div class="main">${esc(auditTitle(r))}</div></div>
    <div class="meta">${esc(whoText(r))} &middot; ${esc(timeText(r.at))}</div>
    ${sum ? `<div class="meta">${esc(sum)}</div>` : ''}
  </div>`;
}

/** The full before and after of one entry. */
function openEntrySheet(r) {
  openSheet(auditTitle(r), (root) => {
    const lines = changeLines(r);
    root.innerHTML = `
      <div class="meta" style="margin-bottom:10px">${esc(whoText(r))} &middot; ${esc(whenFull(r.at))}</div>
      ${lines.length ? `<div class="table-scroll"><table class="tight">
        <thead><tr><th>What</th><th>Was</th><th>Now</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(l.from)}</td><td><strong>${esc(l.to)}</strong></td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty" style="padding:10px 0">${r.action === 'added' ? 'It was added.' : r.action === 'deleted' ? 'It was deleted. Owners and managers can bring it back from Settings, Recently deleted.' : r.action === 'restored' ? 'It was brought back.' : 'No detail was kept for this one.'}</div>`}`;
  });
}
