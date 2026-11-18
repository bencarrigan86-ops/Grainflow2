// Support: the owner's read-only support access (Settings), and "Report a problem" (anyone).
//
// Support access is the database's doing: a membership that expires by itself (see the migration). This screen asks
// whether it is on, turns it on for 7 days or off early, and shows the log of what happened. A report sends the build,
// the role, the sync state and the last few errors, with a message; the words are in supportinfo.js.

import { supabase } from '../supabase.js?v=379';
import { db } from '../storage.js?v=379';
import { APP_VERSION } from '../version.js?v=379';
import { openSheet, closeSheet, toast, notify, askConfirm } from '../ui.js?v=379';
import { esc } from '../fmt.js?v=379';
import { buildReport, reportText, recentErrors, supportStatusText, standingStatus, logLine } from '../supportinfo.js?v=379';
import { trialWatched, standingText } from '../trials.js?v=379';

const UNAVAILABLE = 'Support access is not available yet. Ask whoever looks after Commodity Mate to finish setting it up.';

async function status(farmId) {
  const { data, error } = await supabase.rpc('support_access_until', { p_farm_id: farmId });
  if (error) throw new Error(UNAVAILABLE);
  // a trial farm: support was given standing access when it was made, with no end date
  if (await trialWatched(farmId)) return standingStatus(standingText());
  return supportStatusText(data);
}

async function logRows(farmId) {
  const { data, error } = await supabase.from('support_access_log').select('action, at').eq('farm_id', farmId).order('at', { ascending: false }).limit(8);
  return error ? [] : (data || []);
}

/** The card for Settings. Owner only: the caller decides. */
export const supportCardHtml = () => `
  <div class="card" id="support-card">
    <h2>Support access</h2>
    <div class="hint">If something is wrong and you want help, you can let the person who looks after Commodity Mate see your farm, read only, for 7 days. They cannot change anything and cannot see your bank details. It switches itself off, or you can take it away sooner.</div>
    <div id="support-body"><div class="meta">Checking…</div></div>
  </div>`;

export async function wireSupportCard(root) {
  const body = root.querySelector('#support-body');
  if (!body) return;
  const farmId = db.getFarmId();
  const paint = async () => {
    let st;
    try { st = await status(farmId); } catch (e) { body.innerHTML = `<div class="hint">${esc(e.message)}</div>`; return; }
    const rows = await logRows(farmId);
    if (!body.isConnected) return;
    body.innerHTML = `
      <div class="row"><span class="label">${esc(st.text)}</span></div>
      ${st.on
        ? '<button type="button" class="btn secondary" id="support-off">Take support access away</button>'
        : '<button type="button" class="btn secondary" id="support-on">Give support access for 7 days</button>'}
      ${rows.length ? `<div class="subhead" style="margin-top:12px">What has happened</div>${rows.map((r) => `<div class="meta">${esc(logLine(r))}</div>`).join('')}` : ''}`;
    body.querySelector('#support-on')?.addEventListener('click', async () => {
      if (!await askConfirm('Let support see your farm, read only, for 7 days? That includes contracts, prices and invoices, but not your bank details.', { confirmLabel: 'Give access' })) return;
      const { error } = await supabase.rpc('grant_support_access', { p_farm_id: farmId, p_days: 7 });
      if (error) { notify(/not been set up/.test(error.message) ? UNAVAILABLE : `Could not do that: ${error.message}`); return; }
      toast('Support access is on for 7 days');
      paint();
    });
    body.querySelector('#support-off')?.addEventListener('click', async () => {
      const { error } = await supabase.rpc('revoke_support_access', { p_farm_id: farmId });
      if (error) { notify(`Could not do that: ${error.message}`); return; }
      toast('Support access taken away');
      paint();
    });
  };
  paint();
}

/** "Report a problem": what will be sent is shown, then sent; if it cannot be sent the text can be copied. */
export async function openReportProblemSheet() {
  let sync = { pending: 0, lastError: null };
  try { sync = await db.getSyncStatus(); } catch { /* the report says nothing about it */ }
  const make = (message) => buildReport({
    message, build: APP_VERSION, role: db.getRole(), online: navigator.onLine, sync, errors: recentErrors(),
    screen: location.hash, userAgent: navigator.userAgent,
  });
  openSheet('Report a problem', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:8px">Say what went wrong and what you were doing. This is sent with the build, your role, whether you are online, what is waiting to send and the last few errors. None of your farm's records are sent.</div>
      <div class="field"><label for="rp-msg">What happened</label><textarea id="rp-msg" rows="5" style="width:100%"></textarea></div>
      <div class="meta" id="rp-details" style="white-space:pre-wrap;margin:8px 0"></div>
      <div id="rp-problem" class="hint" style="color:var(--danger)"></div>
      <button type="button" class="btn" id="rp-send">Send</button>
      <button type="button" class="btn secondary" id="rp-copy" style="margin-top:8px">Copy instead</button>`;
    const msg = () => root.querySelector('#rp-msg').value;
    const show = () => { root.querySelector('#rp-details').textContent = reportText(make('')).split('\n').slice(2).join('\n'); };
    show();
    root.querySelector('#rp-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(reportText(make(msg()))); toast('Copied'); } catch { root.querySelector('#rp-problem').textContent = 'Could not copy. Select the text above instead.'; }
    });
    root.querySelector('#rp-send').addEventListener('click', async (e) => {
      const problem = root.querySelector('#rp-problem');
      if (!msg().trim()) { problem.textContent = 'Say what went wrong first.'; return; }
      e.target.disabled = true;
      const r = make(msg());
      const { error } = await supabase.from('problem_reports').insert({ farm_id: db.getFarmId(), role: r.role, build: r.build, message: r.message, details: r.details });
      if (error) { e.target.disabled = false; problem.textContent = 'Could not send it just now. Check your signal and try again, or use Copy instead and send it another way.'; return; }
      toast('Sent. Thank you');
      closeSheet();
    });
  });
}
