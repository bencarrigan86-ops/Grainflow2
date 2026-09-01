import { db } from '../storage.js?v=85';
import { num, money, esc } from '../fmt.js?v=85';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=85';
import { APP_VERSION } from '../version.js?v=85';
import { exportRowsAsCSV } from '../csv.js?v=85';
import { fieldTons, fieldUrea, ureaAppliedKgHaFor, fieldSeed, storageLedgerStock, saleEconomics, fieldUreaForTarget, nitrogenCalc } from '../derived.js?v=85';
import { endpointLabel } from './movements.js?v=85';
import {
  INVITABLE_ROLES, roleLabel, inviteLink, validateInvite, expiryText, canEditMember,
} from '../invites.js?v=85';
import {
  createInvitation, listMembers, listPendingInvitations, revokeInvitation, removeMember,
  changeMemberRole, getSession,
} from '../auth.js?v=85';

let unsub = null;

export function renderSettings(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities } = db.get();
  const years = db.getYears();
  const currentYear = db.getCurrentYear();
  const overheads = db.getOverheads();
  const business = db.getBusinessDetails();

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Settings</h1>
        <div class="sub">Commodities, MTM prices &amp; data</div>
      </div>
    </div>
    <div class="view">
      <div class="card">
        <h2>Account</h2>
        <div class="field hint" style="margin-bottom:8px">Who you are signed in as, your role on this farm, and the way out.</div>
        <button class="btn secondary" id="go-account">Account &amp; sign out</button>
      </div>

      ${db.getRole() === 'owner' ? '<div class="card" id="people-card"></div>' : ''}

      <div class="card">
        <h2>Farm</h2>
        <div class="field hint" style="margin-bottom:6px">The property. This is what the app
          calls this place, what someone is told they are joining when you invite them, and
          what shows on the Account screen. The trading entity that appears on invoices is
          separate — that's Business details, below.</div>
        ${field({ label: 'Farm / property name', id: 'bd-farm', value: business.farmName, placeholder: 'e.g. Sunnyridge' })}
        <button class="btn" id="save-farm">Save farm name</button>
      </div>

      <div class="card">
        <h2>Season</h2>
        ${field({ label: 'Viewing', id: 'year-select', type: 'select', value: currentYear, options: years.map((y) => ({ value: y, label: y })) })}
        <div class="swipe-actions">
          <button class="btn secondary small" id="rename-year">Rename "${esc(currentYear)}"&hellip;</button>
          <button class="btn secondary small" id="new-year">Start new year&hellip;</button>
        </div>
        ${years.length > 1 ? `<button class="btn danger small" id="delete-year" style="margin-top:8px">Delete "${esc(currentYear)}" season</button>` : ''}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Commodities</h2>
        ${commodities.length === 0 ? `<div class="empty">Tap + to add a commodity.</div>` : commodities.map((c) => commodityRow(c)).join('')}
      </div>

      <div class="card">
        <h2>Overheads</h2>
        <div class="field hint" style="margin-bottom:6px">Whole-farm costs, subtracted from total gross margin in the Position tab.</div>
        ${field({ label: 'Finance ($)', id: 'oh-finance', type: 'number', step: '1', value: overheads.finance })}
        ${field({ label: 'Equipment repayments ($)', id: 'oh-equipment', type: 'number', step: '1', value: overheads.equipmentRepayments })}
        ${field({ label: 'Depreciation ($)', id: 'oh-depreciation', type: 'number', step: '1', value: overheads.depreciation })}
        ${field({ label: 'Wages ($)', id: 'oh-wages', type: 'number', step: '1', value: overheads.wages })}
        ${field({ label: 'Drawings ($)', id: 'oh-drawings', type: 'number', step: '1', value: overheads.drawings })}
        ${field({ label: 'Admin ($)', id: 'oh-admin', type: 'number', step: '1', value: overheads.admin })}
        ${field({ label: 'Energy ($)', id: 'oh-energy', type: 'number', step: '1', value: overheads.energy })}
        ${field({ label: 'Insurance ($)', id: 'oh-insurance', type: 'number', step: '1', value: overheads.insurance })}
        ${field({ label: 'R&amp;M ($)', id: 'oh-rm', type: 'number', step: '1', value: overheads.repairsMaintenance })}
        ${field({ label: 'Other ($)', id: 'oh-other', type: 'number', step: '1', value: overheads.other })}
        <button class="btn" id="save-overheads">Save overheads</button>
      </div>

      <div class="card">
        <h2>Business details</h2>
        <div class="field hint" style="margin-bottom:6px">The entity that holds the ABN and the
          bank account. Used as the "Seller" on invoices you generate in Sales — not as the
          name of the farm, which is set above.</div>
        ${field({ label: 'Entity / business name', id: 'bd-entity', value: business.entityName, placeholder: 'e.g. Carrigan Agricultural Co Pty Ltd' })}
        <div class="grid-2">
          ${field({ label: 'ABN', id: 'bd-abn', value: business.abn })}
          ${field({ label: 'NGR', id: 'bd-ngr', value: business.ngr })}
        </div>
        ${field({ label: 'Contact name', id: 'bd-contact', value: business.contactName })}
        <div class="grid-2">
          ${field({ label: 'Phone', id: 'bd-phone', value: business.phone })}
          ${field({ label: 'Email', id: 'bd-email', value: business.email })}
        </div>
        ${field({ label: 'Address', id: 'bd-address', value: business.address })}
        ${field({ label: 'Payment terms (days)', id: 'bd-terms', type: 'number', step: '1', value: business.paymentTermsDays })}
        <hr class="sep" />
        <div class="grid-2">
          ${field({ label: 'Bank name', id: 'bd-bank', value: business.bankName })}
          ${field({ label: 'Account name', id: 'bd-accname', value: business.accountName })}
        </div>
        <div class="grid-2">
          ${field({ label: 'BSB', id: 'bd-bsb', value: business.bsb })}
          ${field({ label: 'Account number', id: 'bd-accno', value: business.accountNumber })}
        </div>
        <button class="btn" id="save-business">Save business details</button>
      </div>

      <div class="card">
        <h2>Data</h2>
        <div class="row"><span class="label">Everything is stored on this device only.</span></div>
        <div class="swipe-actions">
          <button class="btn secondary small" id="export">Export backup</button>
          <button class="btn secondary small" id="import">Import backup</button>
        </div>
        <button class="btn secondary small" id="export-csv" style="margin-top:8px">Export CSV (Excel)&hellip;</button>
        <button class="btn danger small" id="reset" style="margin-top:10px">Reset all data</button>
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>

      <div class="card">
        <h2>App</h2>
        <div class="row"><span class="label">Version</span><span class="value">${esc(APP_VERSION)}</span></div>
        <div class="field hint" style="margin-top:6px">If something looks out of date after an update, tap this to force the app to fetch the latest version.</div>
        <button class="btn secondary small" id="force-refresh" style="margin-top:6px">Force refresh app</button>
      </div>
    </div>
    <button class="fab" id="add-commodity">+</button>
  `;

  // Fenced off deliberately. Everything below this line in Settings — seasons,
  // commodities, overheads, the backup buttons — is the screen the farm
  // actually runs on, and it renders after this point. A fault in the newest
  // card on the page must not take the rest of it with it.
  const peopleCard = root.querySelector('#people-card');
  if (peopleCard) {
    try {
      paintPeople(peopleCard);
    } catch (e) {
      console.error('The People card failed to render', e);
      peopleCard.innerHTML = `<h2>People</h2>
        <div class="field hint" style="color:var(--danger)">This card failed to load:
        ${esc(e.message)}</div>`;
    }
  }

  root.querySelectorAll('[data-edit-commodity]').forEach((el) => {
    el.addEventListener('click', () => openCommoditySheet(commodities.find((c) => c.id === el.dataset.editCommodity)));
  });
  root.querySelector('#add-commodity').addEventListener('click', () => openCommoditySheet(null));

  root.querySelector('#go-account').addEventListener('click', () => {
    location.hash = '#/account';
  });

  root.querySelector('#year-select').addEventListener('change', (e) => {
    db.setCurrentYear(e.target.value);
  });

  root.querySelector('#save-overheads').addEventListener('click', () => {
    db.updateOverheads({
      finance: getNum(root, 'oh-finance'),
      equipmentRepayments: getNum(root, 'oh-equipment'),
      depreciation: getNum(root, 'oh-depreciation'),
      wages: getNum(root, 'oh-wages'),
      drawings: getNum(root, 'oh-drawings'),
      admin: getNum(root, 'oh-admin'),
      energy: getNum(root, 'oh-energy'),
      insurance: getNum(root, 'oh-insurance'),
      repairsMaintenance: getNum(root, 'oh-rm'),
      other: getNum(root, 'oh-other'),
    });
  });

  root.querySelector('#save-farm').addEventListener('click', () => {
    db.updateBusinessDetails({ farmName: getVal(root, 'bd-farm')?.trim() });
  });

  root.querySelector('#save-business').addEventListener('click', () => {
    db.updateBusinessDetails({
      entityName: getVal(root, 'bd-entity')?.trim(),
      abn: getVal(root, 'bd-abn')?.trim(),
      ngr: getVal(root, 'bd-ngr')?.trim(),
      contactName: getVal(root, 'bd-contact')?.trim(),
      phone: getVal(root, 'bd-phone')?.trim(),
      email: getVal(root, 'bd-email')?.trim(),
      address: getVal(root, 'bd-address')?.trim(),
      paymentTermsDays: getNum(root, 'bd-terms'),
      bankName: getVal(root, 'bd-bank')?.trim(),
      accountName: getVal(root, 'bd-accname')?.trim(),
      bsb: getVal(root, 'bd-bsb')?.trim(),
      accountNumber: getVal(root, 'bd-accno')?.trim(),
    });
  });
  root.querySelector('#rename-year').addEventListener('click', () => openRenameYearSheet(currentYear));
  root.querySelector('#new-year').addEventListener('click', () => openNewYearSheet(currentYear));
  const deleteYearBtn = root.querySelector('#delete-year');
  if (deleteYearBtn) {
    deleteYearBtn.addEventListener('click', () => {
      confirmDelete(`Delete the "${currentYear}" season? Its fields, silos, sales and movements will be gone for good. Other seasons aren't affected.`, () => {
        db.deleteYear(currentYear);
      });
    });
  }

  root.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([db.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grainflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  root.querySelector('#export-csv').addEventListener('click', () => openExportCsvSheet());
  const importFile = root.querySelector('#import-file');
  root.querySelector('#import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const f = importFile.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      const { remapped, filled, stats } = db.importJSON(text);
      alert(
        `Imported.\n\n` +
        `${stats.seasons} season(s), ${stats.paddocks} paddock(s), ` +
        `${stats.storages} storage(s), ${stats.movements} movement(s), ` +
        `${stats.sales} sale(s).\n` +
        (remapped ? `\n${remapped} id(s) were reissued for the new database.` : '') +
        // Say so rather than reshaping someone's records quietly. A season
        // saved before overheads existed gains an empty overheads section, and
        // the owner should hear that from the app, not discover it later.
        (filled?.length
          ? `\n\nAdded empty sections this season predates:\n  ${filled.join('\n  ')}`
          : '') +
        (stats.photos ? `\n${stats.photos} photo(s) will upload in the background.` : '')
      );
    } catch (e) {
      // The old message was "Could not read that file", which was true of a
      // corrupt file and misleading about every other failure. Say what is
      // actually wrong — the file is usually fine and one value is not.
      alert(`Import refused.\n\n${e.message}`);
    }
  });
  root.querySelector('#reset').addEventListener('click', () => {
    confirmDelete('Reset all data? This cannot be undone.', () => db.resetAll());
  });

  root.querySelector('#force-refresh').addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    location.reload();
  });
}

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
    const [members, pending, session] = await Promise.all([
      listMembers(farmId), listPendingInvitations(farmId), getSession(),
    ]);
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

function paintPeople(card) {
  peopleNode = card;

  if (peopleError) {
    card.innerHTML = `
      <h2>People</h2>
      <div class="field hint" style="color:var(--danger)">${esc(peopleError)}</div>
      <button class="btn secondary small" id="people-retry" style="margin-top:8px">Try again</button>`;
    card.querySelector('#people-retry').addEventListener('click', refreshPeople);
    return;
  }

  if (people === null) {
    card.innerHTML = '<h2>People</h2><div class="empty">Loading…</div>';
    loadPeople();
    return;
  }

  const { members, pending, meId } = people;
  card.innerHTML = `
    <h2>People</h2>
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
        } catch (e) { alert(`Could not withdraw that invitation.\n\n${e.message}`); }
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
  return `
    <div class="list-item" ${editable ? `data-edit-member="${esc(m.userId)}"` : ''}>
      <div>
        <div class="main">${esc(m.email)}</div>
        <div class="meta">${esc(roleLabel(m.role))}${extra}</div>
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
          && !window.confirm(`Make ${m.email} an owner? They will be able to see the bank details and contract pricing, and to remove anyone from this farm — including you.`)) {
        return;
      }
      busy = true;
      saveBtn.textContent = 'Saving…';
      try {
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
        } catch (e) { alert(`Could not remove them.\n\n${e.message}`); }
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
      await navigator.share({ title: 'Grainflow', text: 'Join my farm on Grainflow:', url: link });
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
          && !window.confirm(`Invite ${v.email} as an owner? They will be able to see the bank details and contract pricing, and to remove anyone from this farm — including you.`)) {
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

function commodityName(commodities, id) {
  return commodities.find((c) => c.id === id)?.name || '';
}

function endpointsLabel(entries, ctx) {
  return (entries || [])
    .map((e) => `${endpointLabel(e.type, e.id, ctx)} (${num(e.tons, 2)}t)`)
    .join('; ');
}

function openExportCsvSheet() {
  const year = db.getCurrentYear();
  const stamp = new Date().toISOString().slice(0, 10);

  openSheet('Export CSV', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:12px">Each downloads as a .csv file for the "${esc(year)}" season — opens straight into Excel, Numbers or Google Sheets.</div>
      <button class="btn secondary" id="exp-fields" style="margin-bottom:8px">Fields (Production)</button>
      <button class="btn secondary" id="exp-sales" style="margin-bottom:8px">Sales</button>
      <button class="btn secondary" id="exp-movements" style="margin-bottom:8px">Movements</button>
      <button class="btn secondary" id="exp-storage" style="margin-bottom:8px">Storage (silos &amp; bunkers)</button>
      <button class="btn secondary" id="exp-invoices">Invoices</button>
    `;

    root.querySelector('#exp-fields').addEventListener('click', () => exportFieldsCSV(year, stamp));
    root.querySelector('#exp-sales').addEventListener('click', () => exportSalesCSV(year, stamp));
    root.querySelector('#exp-movements').addEventListener('click', () => exportMovementsCSV(year, stamp));
    root.querySelector('#exp-storage').addEventListener('click', () => exportStorageCSV(year, stamp));
    root.querySelector('#exp-invoices').addEventListener('click', () => exportInvoicesCSV(year, stamp));
  });
}

function exportFieldsCSV(year, stamp) {
  const { commodities, fields, movements } = db.get();
  exportRowsAsCSV(`grainflow-fields-${year}-${stamp}.csv`, fields, [
    { label: 'Name', get: (f) => f.name },
    { label: 'Commodity', get: (f) => commodityName(commodities, f.commodityId) },
    { label: 'Area (ha)', get: (f) => f.areaHa ?? '' },
    { label: 'Yield mode', get: (f) => f.yieldMode === 'actual' ? 'Actual (from movements)' : 'Estimate' },
    { label: 'Yield (t/ha)', get: (f) => f.yieldTHa ?? '' },
    { label: 'Tonnes', get: (f) => num(fieldTons(f, movements), 2) },
    { label: 'Urea required (kg/ha)', get: (f) => f.ureaRequiredKgHa ?? '' },
    { label: 'Urea applied (kg/ha)', get: (f) => ureaAppliedKgHaFor(f) },
    { label: 'Urea left (t)', get: (f) => num(fieldUrea(f).leftTons, 2) },
    { label: 'Seed variety', get: (f) => f.seedVariety ?? '' },
    { label: 'Seed rate (kg/ha)', get: (f) => f.seedRateKgHa ?? '' },
    { label: 'Seed required (t)', get: (f) => num(fieldSeed(f).requiredTons, 2) },
  ]);
}

function exportSalesCSV(year, stamp) {
  const { commodities, sales, movements } = db.get();
  exportRowsAsCSV(`grainflow-sales-${year}-${stamp}.csv`, sales, [
    { label: 'Date', get: (s) => s.date ?? '' },
    { label: 'Commodity', get: (s) => commodityName(commodities, s.commodityId) },
    { label: 'Grade', get: (s) => s.grade ?? '' },
    { label: 'Buyer', get: (s) => s.buyer ?? '' },
    { label: 'Contract No', get: (s) => s.contractNo ?? '' },
    { label: 'Location', get: (s) => s.location ?? '' },
    { label: 'Delivery start', get: (s) => s.deliveryStart ?? '' },
    { label: 'Delivery end', get: (s) => s.deliveryEnd ?? '' },
    { label: 'Tons contracted', get: (s) => s.tons ?? '' },
    { label: 'Tons delivered', get: (s) => num(saleEconomics(s, movements).tonsDelivered, 2) },
    { label: 'Tons due', get: (s) => num(saleEconomics(s, movements).tonsDue, 2) },
    { label: 'Price ($/t)', get: (s) => s.price ?? '' },
    { label: 'Freight ($/t)', get: (s) => s.freight ?? '' },
    { label: 'Premium/Discount ($/t)', get: (s) => s.premiumDiscount ?? '' },
    { label: 'Levies (%)', get: (s) => num((s.leviesPct ?? 0) * 100, 2) },
    { label: 'Net price ex-farm ($/t)', get: (s) => num(saleEconomics(s, movements).priceExFarm, 2) },
    { label: 'Total value ($)', get: (s) => num(saleEconomics(s, movements).totalValue, 2) },
    { label: 'Broker note', get: (s) => s.brokerNote ?? '' },
    { label: 'Notes', get: (s) => s.notes ?? '' },
  ]);
}

function exportMovementsCSV(year, stamp) {
  const data = db.get();
  const { movements } = data;
  exportRowsAsCSV(`grainflow-movements-${year}-${stamp}.csv`, movements, [
    { label: 'Ticket No', get: (m) => m.ticketNo ?? '' },
    { label: 'Date', get: (m) => m.date ?? '' },
    { label: 'From', get: (m) => endpointsLabel(m.froms, data) },
    { label: 'To', get: (m) => endpointsLabel(m.tos, data) },
    { label: 'Tons', get: (m) => m.tons ?? '' },
    { label: 'Truck rego', get: (m) => m.truckRego ?? '' },
    { label: 'Driver', get: (m) => m.driver ?? '' },
    { label: 'Gross weight (t)', get: (m) => m.grossWeight ?? '' },
    { label: 'Tare weight (t)', get: (m) => m.tareWeight ?? '' },
    { label: 'Weight status', get: (m) => m.weightStatus ?? '' },
    { label: 'Notes', get: (m) => m.notes ?? '' },
  ]);
}

function exportStorageCSV(year, stamp) {
  const { commodities, storages, movements } = db.get();
  exportRowsAsCSV(`grainflow-storage-${year}-${stamp}.csv`, storages, [
    { label: 'Name', get: (s) => s.name },
    { label: 'Kind', get: (s) => s.kind === 'bunker' ? 'Bunker' : 'Silo' },
    { label: 'Commodity', get: (s) => commodityName(commodities, s.commodityId) },
    { label: 'Opening stock (t)', get: (s) => s.openingStock ?? '' },
    { label: 'Tracked stock (t)', get: (s) => num(storageLedgerStock(s, movements), 2) },
    { label: 'Capacity (t)', get: (s) => s.capacityTons ?? '' },
    { label: 'Radius / Width (m)', get: (s) => s.kind === 'bunker' ? (s.width ?? '') : (s.radius ?? '') },
    { label: 'Height / Length (m)', get: (s) => s.kind === 'bunker' ? (s.length ?? '') : (s.currentHeight ?? '') },
    { label: 'Angle of repose override (°)', get: (s) => s.angleOfRepose ?? '' },
    { label: 'Test weight override (t/m³)', get: (s) => s.testWeight ?? '' },
  ]);
}

function exportInvoicesCSV(year, stamp) {
  const { commodities, sales, invoices } = db.get();
  const saleLabel = (saleId) => {
    const s = sales.find((ss) => ss.id === saleId);
    if (!s) return 'Unknown contract';
    return [commodityName(commodities, s.commodityId), s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ');
  };
  exportRowsAsCSV(`grainflow-invoices-${year}-${stamp}.csv`, invoices, [
    { label: 'Invoice No', get: (i) => i.invoiceNo ?? '' },
    { label: 'Issue date', get: (i) => i.issueDate ?? '' },
    { label: 'Due date', get: (i) => i.dueDate ?? '' },
    { label: 'Sale', get: (i) => saleLabel(i.saleId) },
    { label: 'Total tons', get: (i) => num(i.totalTons, 2) },
    { label: 'Subtotal ex GST ($)', get: (i) => num(i.subtotalExGST, 2) },
    { label: 'Freight total ($)', get: (i) => num(i.freightTotal, 2) },
    { label: 'Levies ($)', get: (i) => num(i.levies, 2) },
    { label: 'GST ($)', get: (i) => num(i.gst, 2) },
    { label: 'Total payable ($)', get: (i) => num(i.totalPayable, 2) },
    { label: 'Status', get: (i) => i.status ?? '' },
    { label: 'Paid date', get: (i) => i.paidDate ?? '' },
  ]);
}

function openRenameYearSheet(currentYear) {
  openSheet('Rename season', (root) => {
    root.innerHTML = `
      ${field({ label: 'New label', id: 'year', value: currentYear, placeholder: 'e.g. 2025' })}
      <button class="btn" id="rename">Rename</button>
    `;
    root.querySelector('#rename').addEventListener('click', () => {
      const year = getVal(root, 'year')?.trim();
      if (!year) { root.querySelector('#year').focus(); return; }
      const ok = db.renameYear(currentYear, year);
      if (!ok) { alert(`"${year}" is already in use.`); return; }
      closeSheet();
    });
  });
}

function openNewYearSheet(currentYear) {
  const guess = /^\d+$/.test(currentYear) ? String(Number(currentYear) + 1) : '';
  openSheet('Start new year', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:12px">
        Carries over: field names/areas, silo/bunker names &amp; geometry, and commodities (angle of repose, test weight, N required) — with their commodity assignments kept.<br/><br/>
        Resets to empty: yield, urea, seed data on fields; grain level, opening stock on silos/bunkers; MTM price, opening stock, retained seed, gross margin cost on commodities; overheads.<br/><br/>
        Cleared entirely: sales contracts and truck movements.
      </div>
      ${field({ label: 'New year label', id: 'year', value: guess, placeholder: 'e.g. 2027' })}
      <button class="btn" id="create">Create &amp; switch</button>
    `;
    root.querySelector('#create').addEventListener('click', () => {
      const year = getVal(root, 'year')?.trim();
      if (!year) { root.querySelector('#year').focus(); return; }
      const ok = db.createYear(year);
      if (!ok) { alert(`"${year}" already exists or is invalid.`); return; }
      closeSheet();
    });
  });
}

function commodityRow(c) {
  return `
    <div class="list-item" data-edit-commodity="${c.id}">
      <div>
        <div class="main">${esc(c.name)}</div>
        <div class="meta">Angle ${num(c.angleOfRepose, 0)}° · TW ${num(c.testWeight, 2)} t/m³</div>
      </div>
      <div class="right">
        <div class="main">${money(c.mtmPrice, 0)}/t</div>
        <div class="meta">MTM price</div>
      </div>
    </div>
  `;
}

function openCommoditySheet(existing) {
  const { fields } = db.get();
  openSheet(existing ? 'Edit commodity' : 'Add commodity', (root) => {
    root.innerHTML = `
      ${field({ label: 'Name', id: 'name', value: existing?.name, placeholder: 'e.g. Wheat' })}
      ${field({ label: 'Sold &amp; measured in', id: 'unit', type: 'select', value: existing?.unit ?? 't', options: [{ value: 't', label: 'Tonnes' }, { value: 'bale', label: 'Bales' }], hint: 'Bales — for cotton lint. Changes the units shown in Production and Sales for this commodity.' })}
      <div id="bales-per-round-wrap" style="display:none">
        ${field({ label: 'Ginned bales per round bale', id: 'balesPerRound', type: 'number', step: '0.1', value: existing?.balesPerRoundBale ?? '', placeholder: 'e.g. 4.2', hint: 'Default ratio used when logging a ginning — editable per event' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Angle of repose (°)', id: 'angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'For silo/bunker peak calc' })}
        ${field({ label: 'Test weight (t/m³)', id: 'tw', type: 'number', step: '0.01', value: existing?.testWeight })}
      </div>
      ${field({ label: 'MTM price ($/t)', id: 'mtm', type: 'number', step: '0.01', value: existing?.mtmPrice ?? 0, hint: 'Used to value unsold position' })}
      <div class="grid-2">
        ${field({ label: 'Opening stock (t)', id: 'opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0 })}
        ${field({ label: 'Retained seed (t)', id: 'seed', type: 'number', step: '0.01', value: existing?.retainedSeed ?? 0 })}
      </div>
      ${field({ label: 'Default yield estimate (t/ha)', id: 'defaultYield', type: 'number', step: '0.1', value: existing?.defaultYieldTHa ?? 0, hint: 'Pre-fills new fields\' production yield estimate, in Production — separate from the fert target yield below' })}
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Target yield (t/ha)', id: 'targetYield', type: 'number', step: '0.1', value: existing?.targetYieldTHa ?? 0, hint: 'Default fert planning target — separate from the production yield estimate above' })}
        ${field({ label: 'N required (kg/t)', id: 'nPerTonne', type: 'number', step: '1', value: existing?.nPerTonne ?? 0, hint: 'For the Fert calculator' })}
      </div>
      ${existing ? `
        <div class="row"><span class="label">Fields using this commodity</span><span class="value">${fields.filter((f) => f.commodityId === existing.id).length}</span></div>
        <hr class="sep" />
        <h2 style="margin:0 0 4px">Fert sensitivity</h2>
        <div class="field hint" style="margin-bottom:10px">See how urea requirement across this commodity's fields changes as the target yield above moves — overridden fields scale from their own override, not this default. Doesn't change any saved data.</div>
        <div id="commodity-sens-form"></div>
        <div id="commodity-sens-table"></div>
      ` : ''}
      <hr class="sep" />
      ${field({ label: 'Gross margin cost ($)', id: 'gmCost', type: 'number', step: '1', value: existing?.grossMarginCost ?? 0, hint: 'Total input cost for this commodity, for the Position tab' })}
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      <button class="btn" id="save">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete commodity</button>` : ''}
    `;
    if (existing) buildCommoditySensitivity(root, existing.id);
    const balesWrap = root.querySelector('#bales-per-round-wrap');
    const syncUnitFields = () => { balesWrap.style.display = getVal(root, 'unit') === 'bale' ? 'block' : 'none'; };
    root.querySelector('#unit').addEventListener('change', syncUnitFields);
    syncUnitFields();
    root.querySelector('#save').addEventListener('click', () => {
      const name = getVal(root, 'name')?.trim();
      if (!name) { root.querySelector('#name').focus(); return; }
      db.upsertCommodity({
        id: existing?.id,
        name,
        unit: getVal(root, 'unit') || 't',
        balesPerRoundBale: getNum(root, 'balesPerRound'),
        angleOfRepose: getNum(root, 'angle'),
        testWeight: getNum(root, 'tw'),
        mtmPrice: getNum(root, 'mtm'),
        openingStock: getNum(root, 'opening'),
        retainedSeed: getNum(root, 'seed'),
        defaultYieldTHa: getNum(root, 'defaultYield'),
        targetYieldTHa: getNum(root, 'targetYield'),
        nPerTonne: getNum(root, 'nPerTonne'),
        grossMarginCost: getNum(root, 'gmCost'),
        notes: getVal(root, 'notes')?.trim(),
      });
      closeSheet();
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete(`Delete "${existing.name}"? Fields/sales using it will keep showing it as missing.`, () => {
          db.deleteCommodity(existing.id);
          closeSheet();
        });
      });
    }
  });
}

/**
 * Live "what-if" for one commodity: flexes its target yield (or, per
 * field, that field's own override) by an adjustment % and recomputes
 * urea required across every field using it — reading the target yield
 * and N/tonne straight off the form above, so it stays in sync as those
 * are edited, before anything is saved.
 */
function buildCommoditySensitivity(root, commodityId) {
  const { fields } = db.get();
  const commodityFields = fields.filter((f) => f.commodityId === commodityId);
  const formEl = root.querySelector('#commodity-sens-form');
  const tableEl = root.querySelector('#commodity-sens-table');

  formEl.innerHTML = `
    ${field({ label: 'Sensitivity adjustment (%)', id: 'csens-pct', type: 'number', step: '5', value: 0, allowNegative: true, hint: "Applied on top of the target yield (or each field's own override)" })}
  `;

  const recompute = () => {
    if (commodityFields.length === 0) {
      tableEl.innerHTML = `<div class="empty">No fields use this commodity yet.</div>`;
      return;
    }
    const liveCommodity = { targetYieldTHa: getNum(root, 'targetYield'), nPerTonne: getNum(root, 'nPerTonne') };
    const factor = 1 + getNum(root, 'csens-pct') / 100;

    const rows = commodityFields.map((f) => {
      const base = fieldUreaForTarget(f, liveCommodity);
      const scenarioYieldTHa = base.targetYieldTHa * factor;
      const { additionalUreaRequired } = nitrogenCalc({ nPerTonne: liveCommodity.nPerTonne, targetYieldTHa: scenarioYieldTHa, soilTestN: f.soilTestNKgHa });
      const area = Number(f.areaHa) || 0;
      return { f, scenarioYieldTHa, kgHa: additionalUreaRequired, reqT: (area * additionalUreaRequired) / 1000, currentReqT: fieldUrea(f).requiredTons };
    });
    const totalArea = rows.reduce((s, r) => s + (Number(r.f.areaHa) || 0), 0);
    const totalReqT = rows.reduce((s, r) => s + r.reqT, 0);
    const totalCurrentT = rows.reduce((s, r) => s + r.currentReqT, 0);
    const delta = totalReqT - totalCurrentT;

    tableEl.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Field</th><th>Area</th><th>Scenario yield t/ha</th><th>Urea req kg/ha</th><th>Urea req t</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.f.name)}</td>
                <td>${num(r.f.areaHa, 1)}</td>
                <td>${num(r.scenarioYieldTHa, 2)}</td>
                <td>${num(r.kgHa, 0)}</td>
                <td>${num(r.reqT, 2)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td>
            <td>${num(totalArea, 1)}</td>
            <td></td>
            <td></td>
            <td>${num(totalReqT, 2)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="row" style="margin-top:6px"><span class="label">Vs currently recorded "required"</span><span class="value">${num(totalCurrentT, 2)} t &nbsp; <span class="badge ${delta >= 0 ? 'neg' : 'pos'}">${delta >= 0 ? '+' : ''}${num(delta, 2)} t</span></span></div>
    `;
  };

  formEl.querySelector('#csens-pct').addEventListener('input', recompute);
  root.querySelector('#targetYield').addEventListener('input', recompute);
  root.querySelector('#nPerTonne').addEventListener('input', recompute);
  recompute();
}
