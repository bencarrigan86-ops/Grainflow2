import { db } from '../storage.js?v=404';
import { esc } from '../fmt.js?v=404';
import { openSheet, closeSheet, field, getVal, confirmDelete, notify, askConfirm } from '../ui.js?v=404';
import { listSeries, setMemberSeries } from '../outloadseries.js?v=404';
import { INVITABLE_ROLES, roleLabel, inviteLink, validateInvite, expiryText, canEditMember } from '../invites.js?v=404';
import { createInvitation, listMembers, listPendingInvitations, revokeInvitation, removeMember, changeMemberRole, getSession } from '../auth.js?v=404';

// ---------------------------------------------------------------------------
// People
//
// The owner's roster: who is on the farm, who has been asked, and the way to
// ask somebody else. Owner only — every function behind it is restricted to
// owners on the server as well, so a manager who reaches this by other means
// gets an empty list rather than a leak.
//
// The list is cached at module level rather than re-fetched inside paint().
// paint() re-runs on every db change, and Settings is the screen where an owner
// saves overheads and commodities, so binding two round trips to the server to
// each of those would be a network request every time they touched Save.
// ---------------------------------------------------------------------------

let people = null;          // { members, pending } once fetched
let peopleLoading = false;
let peopleError = null;
let peopleNode = null;      // the live card, so an async load can repaint it

async function loadPeople() {
  if (peopleLoading) return;
  peopleLoading = true;
  const farmId = db.getFarmId();
  try {
    // Three calls, none depending on the others, and the screen needs all of
    // them. The session is in there because a farm can have several owners now,
    // so "the owner" is no longer a useful way to identify the person looking
    // at the screen — only their own user id is.
    // the digit each person has for outload numbers comes separately, so the card still loads if it cannot be had
    const [found, pending, session, digits] = await Promise.all([
      listMembers(farmId), listPendingInvitations(farmId), getSession(), listSeries(farmId).catch(() => new Map()),
    ]);
    const members = found.map((m) => ({ ...m, series: digits.get(m.userId) ?? null }));
    people = { members, pending, meId: session?.user?.id ?? null };
    peopleError = null;
  } catch (e) {
    peopleError = e.message;
  }
  peopleLoading = false;
  if (peopleNode?.isConnected) paintPeople(peopleNode);
}

function refreshPeople() {
  people = null;
  peopleError = null;
  if (peopleNode?.isConnected) paintPeople(peopleNode);
}

export function paintPeople(card) {
  peopleNode = card;

  if (peopleError) {
    card.innerHTML = `
      <h2>People and permissions</h2>
      <div class="field hint" style="color:var(--danger)">${esc(peopleError)}</div>
      <button class="btn secondary small" id="people-retry" style="margin-top:8px">Try again</button>`;
    card.querySelector('#people-retry').addEventListener('click', refreshPeople);
    return;
  }

  if (people === null) {
    card.innerHTML = '<h2>People and permissions</h2><div class="empty">Loading…</div>';
    loadPeople();
    return;
  }

  const { members, pending, meId } = people;
  card.innerHTML = `
    <h2>People and permissions</h2>
    <div class="field hint" style="margin-bottom:8px">Who can open this farm, and what they can do. Tap someone to change their access.</div>
    ${members.map((m) => memberRow(m, meId)).join('')}
    ${pending.length ? `
      <hr class="sep" />
      <h2 style="margin:0 0 4px">Waiting to join</h2>
      <div class="field hint" style="margin-bottom:8px">Send them the link again if they have not got to it.</div>
      ${pending.map(pendingRow).join('')}` : ''}
    <hr class="sep" />
    <button class="btn" id="invite-someone">Invite someone&hellip;</button>
  `;

  card.querySelector('#invite-someone').addEventListener('click', () => openInviteSheet());

  card.querySelectorAll('[data-edit-member]').forEach((el) => {
    el.addEventListener('click', () => {
      openMemberSheet(members.find((m) => m.userId === el.dataset.editMember));
    });
  });

  card.querySelectorAll('[data-copy-invite]').forEach((el) => {
    el.addEventListener('click', () => sendInviteLink(el.dataset.copyInvite, el));
  });

  card.querySelectorAll('[data-revoke-invite]').forEach((el) => {
    el.addEventListener('click', () => {
      const email = el.dataset.email;
      confirmDelete(`Withdraw the invitation to ${email}? Their link stops working immediately.`, async () => {
        try {
          await revokeInvitation(el.dataset.revokeInvite);
          refreshPeople();
        } catch (e) { notify(`Could not withdraw that invitation.\n\n${e.message}`); }
      });
    });
  });

}

/**
 * One person on the farm.
 *
 * Everybody except you is tappable. The rule used to be "not the owner", which
 * was only ever a proxy for "not you" — and it stops being even that once a
 * farm can have several owners, at which point it would have locked every one
 * of them out of editing each other.
 *
 * You cannot change or remove yourself, and that single rule is what guarantees
 * a farm always has at least one owner: the only person who could take the last
 * owner's access away is that owner, and they are the one person the screen
 * will not act on.
 */
function memberRow(m, meId) {
  const editable = canEditMember(m, meId);
  const extra = m.canWriteProduction && (m.role === 'farm_worker' || m.role === 'driver')
    ? ' · can record production' : '';
  const digit = m.series ? ` · outload digit ${m.series}` : '';
  return `
    <div class="list-item" ${editable ? `data-edit-member="${esc(m.userId)}"` : ''}>
      <div>
        <div class="main">${esc(m.email)}</div>
        <div class="meta">${esc(roleLabel(m.role))}${extra}${digit}</div>
      </div>
      <div class="right">
        <div class="meta">${m.userId === meId ? 'You' : (editable ? 'Change&hellip;' : '')}</div>
      </div>
    </div>`;
}

/**
 * Change what one person can do, or take their access away.
 *
 * Same sheet for both, because they are the same decision made at different
 * strengths, and splitting them across two screens is how an owner ends up
 * removing somebody they only meant to demote.
 */
function openMemberSheet(m) {
  if (!m) return;
  openSheet(m.email, (root) => {
    const isField = (r) => r === 'farm_worker' || r === 'driver';
    root.innerHTML = `
      ${field({ label: 'Access level', id: 'mem-role', type: 'select', value: m.role,
        options: INVITABLE_ROLES.map((r) => ({ value: r.value, label: r.label })) })}
      <div class="field hint" id="mem-blurb" style="margin-top:-6px"></div>
      <div id="mem-prod-wrap" style="display:none">
        ${field({ label: 'Can record production', id: 'mem-prod', type: 'select',
          value: m.canWriteProduction ? 'yes' : 'no',
          options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
          hint: 'Lets them enter yields and fertiliser as well as their own loads.' })}
      </div>
      <div id="mem-series-wrap">
        ${field({ label: 'Outload digit', id: 'mem-series', type: 'select', value: m.series ? String(m.series) : '',
          options: [{ value: '', label: 'None' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({ value: String(d), label: String(d) }))],
          hint: 'The digit in the middle of the outload numbers this person gives out (26 1 001). Nobody else on the farm can have the same one, so two phones without signal never give out the same number.' })}
      </div>
      <div class="field hint">Takes effect the next time they open the app.</div>
      <div id="mem-problem"></div>
      <button class="btn" id="mem-save">Save changes</button>
      <button class="btn danger" id="mem-remove" style="margin-top:8px">Remove from farm</button>
    `;

    const roleEl = root.querySelector('#mem-role');
    const blurbEl = root.querySelector('#mem-blurb');
    const prodWrap = root.querySelector('#mem-prod-wrap');
    const problemEl = root.querySelector('#mem-problem');
    const saveBtn = root.querySelector('#mem-save');

    const syncRole = () => {
      blurbEl.textContent = INVITABLE_ROLES.find((r) => r.value === roleEl.value)?.blurb ?? '';
      prodWrap.style.display = isField(roleEl.value) ? 'block' : 'none';
      // only people who write loads give out numbers
      root.querySelector('#mem-series-wrap').style.display = ['owner', 'manager', 'farm_worker', 'driver'].includes(roleEl.value) ? 'block' : 'none';
    };
    roleEl.addEventListener('change', syncRole);
    syncRole();

    let busy = false;
    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      const role = roleEl.value;
      // Promoting somebody to owner hands them the bank details and the ability
      // to remove you. Worth one deliberate pause; nothing else here is.
      if (role === 'owner' && m.role !== 'owner'
          && !await askConfirm(`Make ${m.email} an owner? They will be able to see the bank details and contract pricing, and to remove anyone from this farm — including you.`)) {
        return;
      }
      busy = true;
      saveBtn.textContent = 'Saving…';
      try {
        const digit = getVal(root, 'mem-series') || '';
        if (digit !== (m.series ? String(m.series) : '')) await setMemberSeries(db.getFarmId(), m.userId, digit ? Number(digit) : null);
        await changeMemberRole(db.getFarmId(), m.userId, role,
          isField(role) && getVal(root, 'mem-prod') === 'yes');
        refreshPeople();
        closeSheet();
      } catch (e) {
        busy = false;
        saveBtn.textContent = 'Save changes';
        problemEl.innerHTML = `<div class="hint" style="color:var(--danger);margin-bottom:4px">${esc(e.message)}</div>`;
      }
    });

    root.querySelector('#mem-remove').addEventListener('click', () => {
      confirmDelete(`Remove ${m.email} from this farm? They keep their account but lose access to the farm's data. Inviting them again brings them straight back.`, async () => {
        try {
          await removeMember(db.getFarmId(), m.userId);
          refreshPeople();
          closeSheet();
        } catch (e) { notify(`Could not remove them.\n\n${e.message}`); }
      });
    });
  });
}

function pendingRow(i) {
  return `
    <div class="list-item">
      <div>
        <div class="main">${esc(i.email)}</div>
        <div class="meta">${esc(roleLabel(i.role))} · ${esc(expiryText(i.expiresAt))}</div>
      </div>
      <div class="right swipe-actions">
        <button class="btn secondary small" data-copy-invite="${esc(i.token)}">Send link</button>
        <button class="btn danger small" data-revoke-invite="${esc(i.id)}" data-email="${esc(i.email)}">Revoke</button>
      </div>
    </div>`;
}

/**
 * Get the link to the person.
 *
 * The share sheet first, because on the phone this is going into a text message
 * and the share sheet is the shortest path to one. Clipboard second. Both can
 * fail — share is missing on desktop, clipboard needs a secure context and can
 * be refused outright — so the last resort shows the link in a box the owner
 * can select by hand, which always works.
 */
async function sendInviteLink(token, btn) {
  const link = inviteLink(token, location.origin, location.pathname);
  const said = (text) => {
    const was = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = was; }, 1600);
  };

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Commodity Mate', text: 'Join my farm on Commodity Mate:', url: link });
      return;
    }
  } catch (e) {
    // A cancelled share sheet throws. That is not a failure worth falling
    // through on — the owner changed their mind.
    if (e?.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(link);
    said('Copied');
    return;
  } catch { /* no clipboard — show it instead */ }

  showLinkSheet(link);
}

function showLinkSheet(link) {
  openSheet('Invitation link', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Send this to them however you normally would. It only works for the address it was issued to.</div>
      <div class="field">
        <input id="inv-link" type="text" value="${esc(link)}" readonly />
      </div>
      <button class="btn" id="inv-link-copy">Copy link</button>
    `;
    const input = root.querySelector('#inv-link');
    input.addEventListener('focus', () => input.select());
    root.querySelector('#inv-link-copy').addEventListener('click', async () => {
      input.select();
      try { await navigator.clipboard.writeText(link); } catch { /* the selection is the fallback */ }
    });
  });
}

function openInviteSheet() {
  openSheet('Invite someone', (root) => {
    root.innerHTML = `
      <div class="field">
        <label for="inv-email">Email address</label>
        <input id="inv-email" type="email" inputmode="email" autocomplete="off"
               autocapitalize="none" spellcheck="false" placeholder="them@example.com" />
        <div class="hint">The address they will sign in with. The invitation only works for
          this address, so a typo here is an invitation nobody can accept.</div>
      </div>
      ${field({ label: 'They will be a', id: 'inv-role', type: 'select', value: 'driver',
        options: INVITABLE_ROLES.map((r) => ({ value: r.value, label: r.label })) })}
      <div class="field hint" id="inv-blurb" style="margin-top:-6px"></div>
      <div id="inv-prod-wrap" style="display:none">
        ${field({ label: 'Can record production', id: 'inv-prod', type: 'select', value: 'no',
          options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
          hint: 'Lets them enter yields and fertiliser as well as their own loads.' })}
      </div>
      <div class="field hint">Nothing is emailed. You get a link to send them yourself.</div>
      <div id="inv-problems"></div>
      <button class="btn" id="inv-create">Create invitation</button>
    `;

    const roleEl = root.querySelector('#inv-role');
    const blurbEl = root.querySelector('#inv-blurb');
    const prodWrap = root.querySelector('#inv-prod-wrap');
    const problemsEl = root.querySelector('#inv-problems');
    const btn = root.querySelector('#inv-create');

    const syncRole = () => {
      const r = INVITABLE_ROLES.find((x) => x.value === roleEl.value);
      blurbEl.textContent = r?.blurb ?? '';
      // Only the two field roles have production withheld in the first place,
      // so the question is meaningless for the others.
      prodWrap.style.display = (roleEl.value === 'farm_worker' || roleEl.value === 'driver')
        ? 'block' : 'none';
    };
    roleEl.addEventListener('change', syncRole);
    syncRole();

    let busy = false;
    btn.addEventListener('click', async () => {
      if (busy) return;
      const email = getVal(root, 'inv-email');
      const role = roleEl.value;

      // Checked here against what is already on the screen, so the owner is
      // told "they are already on this farm" rather than watching a link they
      // send get refused a day later.
      const v = validateInvite({
        email, role,
        existingMembers: people?.members ?? [],
        pendingInvites: people?.pending ?? [],
      });
      if (!v.ok) {
        problemsEl.innerHTML = v.problems
          .map((p) => `<div class="hint" style="color:var(--danger);margin-bottom:4px">${esc(p)}</div>`)
          .join('');
        return;
      }
      problemsEl.innerHTML = '';

      // The same deliberate pause as promoting someone. Owner sits at the top
      // of the same dropdown as driver, so the only thing separating a family
      // partner from a mis-tap is being asked once.
      if (v.role === 'owner'
          && !await askConfirm(`Invite ${v.email} as an owner? They will be able to see the bank details and contract pricing, and to remove anyone from this farm — including you.`)) {
        return;
      }

      busy = true;
      btn.textContent = 'Creating…';
      try {
        const { token } = await createInvitation({
          farmId: db.getFarmId(),
          email: v.email,
          role: v.role,
          canWriteProduction: getVal(root, 'inv-prod') === 'yes',
        });
        refreshPeople();
        // Straight to the link. The invitation is worth nothing until it is
        // actually sent, and an owner who closes this sheet without sending it
        // has created a row and told nobody.
        showLinkSheet(inviteLink(token, location.origin, location.pathname));
      } catch (e) {
        busy = false;
        btn.textContent = 'Create invitation';
        problemsEl.innerHTML = `<div class="hint" style="color:var(--danger);margin-bottom:4px">${esc(e.message)}</div>`;
      }
    });
  });
}
