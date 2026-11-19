import { db } from '../storage.js?v=444';
import { esc } from '../fmt.js?v=444';
import { notify, askConfirm } from '../ui.js?v=444';
import { roleLabel } from '../invites.js?v=444';
import { getSession } from '../auth.js?v=444';

/**
 * Whether this device is up to date with the server, in words.
 *
 * Written after a phone sat seven changes behind for a day. Every push was
 * being refused, the only record of that was a console line nobody can reach on
 * a phone, and — because unsent work outranks the server — the device was also
 * silently ignoring everything done anywhere else. Three separate things were
 * wrong and the app's answer to all of them was to look completely normal.
 */
export async function paintSyncCard(root) {
  const card = root.querySelector('#sync-card');
  if (!card) return;

  let status = { pending: 0, lastError: null };
  try { status = await db.getSyncStatus(); } catch { /* leave it saying nothing */ }
  if (!card.isConnected) return;

  // Nothing owed and nothing wrong is the normal case, and it should not take
  // up a card telling you so.
  if (!status.pending && !status.lastError) {
    card.innerHTML = `
      <h2>Sync</h2>
      <div class="row"><span class="label">This device</span><span class="value">Up to date</span></div>`;
    return;
  }

  // Who this device is acting as. A refusal almost always comes down to this —
  // the wrong account, a farm that is not the one on the other device, or a
  // role the server will not let write — and none of it is visible from the
  // error text alone.
  const session = await getSession().catch(() => null);
  if (!card.isConnected) return;
  const who = esc(session?.user?.email || 'unknown');
  const farmName = esc(db.getBusinessDetails().farmName || 'unnamed farm');
  const farmShort = esc(String(db.getFarmId() || '').slice(0, 8));
  const roleName = esc(roleLabel(db.getRole()));

  const e = status.lastError;
  card.className = 'card warn';
  card.innerHTML = `
    <h2><span class="dot warn"></span>Not yet on the server</h2>
    <div class="row">
      <span class="label">Changes waiting</span>
      <span class="value">${status.pending}</span>
    </div>
    ${(() => {
      const part = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${esc(k.replace(/_/g, ' '))}`).join(', ');
      const up = part(status.uploads);
      const del = part(status.deletes);
      return (up ? `<div class="row"><span class="label">To upload</span><span class="value">${up}</span></div>` : '')
        + (del ? `<div class="row"><span class="label">To delete</span><span class="value">${del}</span></div>` : '');
    })()}
    <div class="row"><span class="label">Signed in as</span><span class="value">${who}</span></div>
    <div class="row"><span class="label">Farm</span><span class="value">${farmName} <span class="meta">(${farmShort}…)</span></span></div>
    <div class="row"><span class="label">Role</span><span class="value">${roleName}</span></div>
    <div class="field hint" style="margin-top:6px">While anything is waiting, this device keeps
      its own copy and does not take updates made on other devices &mdash; that is deliberate, so
      work cannot be overwritten before it has been saved. It sorts itself out once these
      go up.</div>
    ${e ? `
      <hr class="sep" />
      <div class="row"><span class="label">Refused at</span><span class="value">${esc(e.table || '?')}</span></div>
      <div class="field hint" style="color:var(--danger);margin-top:4px">
        ${esc(e.message || 'The server refused the change.')}${e.code ? ` (${esc(e.code)})` : ''}
      </div>
      ${e.hint ? `<div class="field hint">${esc(e.hint)}</div>` : ''}
      ${e.refused?.length ? `
        <div class="subhead" style="margin-top:8px">The server is refusing</div>
        ${e.refused.map((r) => `<div class="field hint"><strong>${esc(String(r.name || 'unnamed'))}</strong> <span class="meta">${esc(r.id)}</span>${r.clash ? ' &mdash; its number is already used by another record on the server' : r.hidden === true ? ' &mdash; already on the server but hidden from this account (deleted there, or in another farm)' : ''}</div>`).join('')}` : ''}` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn secondary small" id="sync-retry">Try sending now</button>
      ${status.pending > 0 ? `<button class="btn ghost-danger small" id="sync-reset">Use the server's copy&hellip;</button>` : ''}
    </div>
  `;

  card.querySelector('#sync-reset')?.addEventListener('click', async () => {
    const ok = await askConfirm(
      `Throw away this device's ${status.pending} unsent change(s) and take the copy on the server?\n\n` +
      'Use this on a device that has fallen behind, when another device holds the right version. ' +
      'What is thrown away is kept aside on this device, not deleted, but it will not be sent. ' +
      'Anything you entered only on this device that you want to keep would need entering again.',
      { confirmLabel: 'Use the server\'s copy', danger: true });
    if (!ok) return;
    try {
      await db.useServerCopy();
      location.reload();
    } catch (e) {
      notify('Could not reset this device: ' + (e?.message || e));
    }
  });

  card.querySelector('#sync-retry').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Sending…';
    db.pushNow();
    // The push is fire-and-forget; give it a moment, then report what is left.
    setTimeout(() => paintSyncCard(root), 2500);
  });
}
