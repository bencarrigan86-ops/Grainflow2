import { db } from '../storage.js?v=366';
import { getTheme, setTheme } from '../theme.js?v=366';
import { num, money, esc, todayLocal } from '../fmt.js?v=366';
import { openSheet, closeSheet, openOver, field, getVal, getNum, confirmDelete, notify, askConfirm, toast } from '../ui.js?v=366';
import { planYieldUpdate } from '../yieldupdate.js?v=366';
import { openLoadImportSheet } from './importloads.js?v=366';
import { openDeliveryImportSheet } from './importdeliveries.js?v=366';
import { openPastSeasonsSheet } from './pastseasons.js?v=366';
import { openPastSalesSheet } from './pastsales.js?v=366';
import { openLineupSheet } from './lineup.js?v=366';
import { addressFields, readAddress, joinAddress, partsOf } from '../address.js?v=366';
import { downloadBackup, lastBackup, backupAgeText } from '../backup.js?v=366';
import { openDangerSheet } from './dangerconfirm.js?v=366';
import { sampleHistoryFrom, sampleHistoryOffered, sampleOrdersFrom, sampleOrdersOffered } from '../demo.js?v=366';
import { seasonContents, contentsText } from '../seasondelete.js?v=366';
import { openDeletedSheet } from './deleted.js?v=366';
import { APP_VERSION } from '../version.js?v=366';
import { checkNow } from '../updatecheck.js?v=366';
import { logoFromFile } from '../logo.js?v=366';
import { exportRowsAsCSV } from '../csv.js?v=366';
import { fieldTons, fieldUrea, ureaAppliedKgHaFor, fieldSeed, storageLedgerStock, saleEconomics, closingStock, position } from '../derived.js?v=366';
import { cleanCotton } from '../ginning.js?v=366';
import { orderedNames, moveName } from '../commodityorder.js?v=366';
import { listSeries, setMemberSeries } from '../outloadseries.js?v=366';
import { endpointLabel } from './movements.js?v=366';
import { openGradeStandardsSheet, openMyGradesSheet } from './gradestandards.js?v=366';
import { layersForStorage } from '../outload.js?v=366';
import { traceLoads, traceText } from '../trace.js?v=366';
import { holdings, totalHeld } from '../offfarm.js?v=366';
import { kindLabel, billTotal } from '../payables.js?v=366';
import { orderState, STATE_LABEL } from '../orders.js?v=366';
import { fieldHarvest } from '../harvest.js?v=366';
import { capacityFor } from '../storagecapacity.js?v=366';
import { autoSeasonText } from '../harvestseason.js?v=366';
import { totalFromPerHa, perHaFromTotal, commodityAreaHa } from '../gmcost.js?v=366';
import { openMySignatureSheet } from './signaturepad.js?v=366';
import { supportCardHtml, wireSupportCard, openReportProblemSheet } from './support.js?v=366';
import { trialFarmsSlotHtml, wireTrialFarms, trialOwnSlotHtml, wireTrialOwner } from './trialfarms.js?v=366';
import { qualityColumns, loadQuality, averageQuality, fieldQuality } from '../exportquality.js?v=366';
import { isAdjustment, noteLabel } from '../adjustment.js?v=366';
import {
  INVITABLE_ROLES, roleLabel, inviteLink, validateInvite, expiryText, canEditMember,
} from '../invites.js?v=366';
import {
  createInvitation, listMembers, listPendingInvitations, revokeInvitation, removeMember,
  changeMemberRole, getSession,
} from '../auth.js?v=366';

let unsub = null;

// Which groups on the page are open, kept while the page repaints (it repaints whenever the farm's data changes).
const openGroups = new Set();
/** One fold of the Settings page: a tinted panel whose closed header says what is inside. */
const group = (key, title, sub, inner) => `<details class="fold feature" data-group="${key}" ${openGroups.has(key) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>${title}</h2><div class="sub">${sub}</div></div></summary>${inner}</details>`;

/** The CSV imports, behind one button on the Data card. */
function openImportSheet() {
  openSheet('Import from CSV', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Pick what you are bringing in from a spreadsheet.</div>
      <button type="button" class="btn secondary" id="import-loads" style="margin-bottom:8px">Truck loads (CSV)&hellip;</button>
      <button type="button" class="btn secondary" id="import-deliveries" style="margin-bottom:8px">Site deliveries (CSV)&hellip;</button>
      <button type="button" class="btn secondary" id="import-past" style="margin-bottom:8px">Past seasons (CSV)&hellip;</button>
      <button type="button" class="btn secondary" id="import-past-sales" style="margin-bottom:8px">Past sales (CSV)&hellip;</button>
      <button type="button" class="btn secondary" id="line-up">Line up paddock names (CSV)&hellip;</button>`;
    root.querySelector('#import-loads').addEventListener('click', () => openOver(() => openLoadImportSheet()));
    root.querySelector('#import-deliveries').addEventListener('click', () => openOver(() => openDeliveryImportSheet()));
    root.querySelector('#import-past').addEventListener('click', () => openOver(() => openPastSeasonsSheet()));
    root.querySelector('#import-past-sales').addEventListener('click', () => openOver(() => openPastSalesSheet()));
    root.querySelector('#line-up').addEventListener('click', () => openOver(() => openLineupSheet()));
  });
}

export function renderSettings(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

/** The farm's commodity names in the automatic order (the most tonnes first), the way the Position screen has them. */
function commodityNamesAuto({ commodities, fields, sales, movements }) {
  try { return position(commodities, fields, sales, movements).map((r) => r.commodity.name); } catch (e) { return commodities.map((c) => c.name); }
}

/** Every commodity name in the order shown: the owner's list if there is one, else biggest first (any the position leaves out go last). */
function namesInOrder(data, business) {
  const auto = commodityNamesAuto(data);
  const all = [...auto, ...data.commodities.map((c) => c.name).filter((n) => !auto.includes(n))];
  return orderedNames(business.commodityOrder, all);
}

/**
 * The Commodities card: each commodity in the one list every screen uses (the biggest first until the owner moves one). The owner gets
 * up and down arrows on each row; everyone else just sees the order. A hint and "Back to biggest first" sit under the list.
 */
function commoditiesCard(data, business, canOrder) {
  const { commodities } = data;
  if (commodities.length === 0) return `<div class="card input"><h2><span class="dot input"></span>Commodities</h2><div class="empty">Tap + to add a commodity.</div></div>`;
  const custom = (business.commodityOrder || []).length > 0;
  const names = namesInOrder(data, business);
  const rank = (c) => { const i = names.indexOf(c.name); return i < 0 ? names.length : i; };
  const list = [...commodities].sort((x, y) => rank(x) - rank(y));
  const showArrows = canOrder && list.length > 1;
  const arrows = (c, i) => `<span style="display:flex;gap:4px;margin-left:6px">
    <button type="button" class="btn secondary small" data-order-move="${i}" data-by="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
    <button type="button" class="btn secondary small" data-order-move="${i}" data-by="1" aria-label="Move ${esc(c.name)} down" ${i === list.length - 1 ? 'disabled' : ''}>&darr;</button></span>`;
  const rows = list.map((c, i) => showArrows
    ? `<div style="display:flex;align-items:center"><div style="flex:1;min-width:0">${commodityRow(c)}</div>${arrows(c, i)}</div>`
    : commodityRow(c)).join('');
  const hint = list.length < 2 ? '' : custom
    ? 'In your order on Position, Production, Storage, Sales and the reports. A new commodity goes after these.'
    : 'Biggest tonnes first on every screen.' + (showArrows ? ' Use the arrows to set your own order.' : '');
  return `<div class="card input" id="order-card">
    <h2><span class="dot input"></span>Commodities</h2>
    ${hint ? `<div class="field hint" style="margin-bottom:6px">${hint}</div>` : ''}
    ${rows}
    ${showArrows && custom ? '<button type="button" class="btn secondary small" id="order-auto" style="margin-top:8px">Back to biggest first</button>' : ''}
  </div>`;
}

function paint(root) {
  const { commodities } = db.get();
  const years = db.getYears();
  const currentYear = db.getCurrentYear();
  const overheads = db.getOverheads();
  const business = db.getBusinessDetails();
  // Only the owner can change the business details (the server refuses anyone else), and a manager does not see the bank details.
  const canEditBusiness = db.getRole() === 'owner';
  const seesBank = ['owner', 'bookkeeper'].includes(db.getRole());

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Settings</h1>
        <div class="sub">Commodities, MTM prices &amp; data</div>
      </div>
    </div>
    <div class="view">
      <button type="button" class="btn secondary" id="open-help" style="margin-bottom:12px">How to use Commodity Mate, and who can do what</button>
      <div class="theme-line">
        <span class="label">Appearance</span>
        <div class="segmented" id="theme-seg">
          ${[['auto', 'Auto', 'Match my phone'], ['light', 'Light', 'Light'], ['dark', 'Dark', 'Dark']].map(([v, l, t]) => `<button type="button" data-theme-choice="${v}" title="${t}" class="${getTheme() === v ? 'active' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      ${group('season', 'Season and crops', `${esc(currentYear)} &middot; ${commodities.length} commodit${commodities.length === 1 ? 'y' : 'ies'}`, `
      <div class="card">
        <h2>Season</h2>
        ${field({ label: 'Viewing', id: 'year-select', type: 'select', value: currentYear, options: years.map((y) => ({ value: y, label: y })) })}
        <div class="swipe-actions">
          <button class="btn secondary small" id="rename-year">Rename "${esc(currentYear)}"&hellip;</button>
          <button class="btn secondary small" id="new-year">Start new year&hellip;</button>
        </div>
        ${sampleHistoryOffered(years, currentYear, db.getRole()) ?`<div class="hint" style="margin-top:8px">This is the sample farm, set up before it had earlier seasons. Add two, with rotated crops and contracts, so the history screens have something to show. Nothing else changes.</div>
        <button class="btn secondary small" id="add-sample-history" style="margin-top:6px">Add the sample history (2024 and 2025)</button>` : ''}
        ${sampleOrdersOffered(db.get().sales, db.getOrders(), db.getFreightOrders(), currentYear, db.getRole()) ? `<div class="hint" style="margin-top:8px">This sample farm has no grain orders or freight orders. Add one of each, against the Riverina Grain Traders wheat contract, to see how they look.</div>
        <button class="btn secondary small" id="add-sample-orders" style="margin-top:6px">Add a sample grain order and freight order</button>` : ''}
        ${years.length > 1 && db.getRole() === 'owner' ?`<button class="btn danger small" id="delete-year" style="margin-top:8px">Delete "${esc(currentYear)}" season&hellip;</button>` : ''}
      </div>

      ${commoditiesCard(db.get(), business, db.getRole() === 'owner')}

      <div class="card input">
        <h2><span class="dot input"></span>Grades</h2>
        <div class="hint" style="margin-bottom:8px">The grade lists in the contract, load and storage dropdowns, and the standards behind each grade.</div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary small" id="grade-standards" style="flex:1">Grade standards</button>
          <button class="btn secondary small" id="my-grades" style="flex:1">My grades</button>
        </div>
      </div>

      `)}
      ${group('business', 'Farm and business', esc(business.farmName || 'Farm name, business details, overheads, signature'), `
      <div class="card">
        <h2>Farm</h2>
        <div class="field hint" style="margin-bottom:6px">What this place is called in the app and in invitations. The entity on invoices is set under Business details.</div>
        ${field({ label: 'Farm / property name', id: 'bd-farm', value: business.farmName, placeholder: 'e.g. Sunnyridge' })}
        ${canEditBusiness ? '<button class="btn" id="save-farm">Save farm name</button>' : '<div class="hint">Only the owner can rename the farm.</div>'}
        ${db.getRole() === 'owner' ? `<hr class="sep" />
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0"><input type="checkbox" id="show-aircair" ${business.showAircair ? 'checked' : ''} style="width:18px;height:18px" /> Offer Aircair's form on spray requests</label>
        <div class="hint">Off for most farms: a spray request goes out on our own form. Switch on if you send Aircair's own form.</div>` : ''}
      </div>

      <div class="card" id="business-card">
        <details class="fold" style="border-top:none;margin-top:0">
          <summary><div><h2>Business details</h2><div class="sub">${seesBank ? 'ABN, contact and bank details shown on invoices' : 'ABN, contact and address shown on invoices'}</div></div></summary>
        ${canEditBusiness ? '' : '<div class="field hint" style="margin-bottom:6px">Only the owner can change these.</div>'}
        <div class="field hint" style="margin-bottom:6px">The entity that holds the ABN and the
          bank account. Used as the "Seller" on invoices you generate in Sales — not as the
          name of the farm, which is set above.</div>
        ${field({ label: 'Entity / business name', id: 'bd-entity', value: business.entityName, placeholder: 'e.g. Carrigan Agricultural Co Pty Ltd' })}
        <div class="field">
          <label>Company logo</label>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div id="bd-logo-box" style="min-width:96px;min-height:48px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:8px;padding:4px">${business.logo ? `<img src="${esc(business.logo)}" alt="Your logo" style="max-width:150px;max-height:64px;display:block" />` : '<span class="meta" style="color:#777">No logo yet</span>'}</div>
            ${canEditBusiness ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn secondary small" id="bd-logo-pick">${business.logo ? 'Change logo' : 'Add a logo'}</button>${business.logo ? '<button type="button" class="btn secondary small" id="bd-logo-remove">Remove</button>' : ''}</div>` : ''}
          </div>
          ${business.logo && canEditBusiness ? `<label class="row" style="cursor:pointer;margin:8px 0 0"><span class="label"><input type="checkbox" id="bd-logo-on" ${business.logoOff ? '' : 'checked'} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />Print the logo</span><span class="value">on PDFs and the confirmation</span></label>` : ''}
          <input type="file" id="bd-logo-file" accept="image/*" hidden />
          <div class="hint">Printed in the header of your PDFs and on the confirmation of sale. A PNG or JPG; it is shrunk to fit.</div>
        </div>
        <div class="grid-2">
          ${field({ label: 'ABN', id: 'bd-abn', value: business.abn })}
          ${field({ label: 'NGR', id: 'bd-ngr', value: business.ngr })}
        </div>
        ${field({ label: 'PIC (property identification code)', id: 'bd-pic', value: business.pic, hint: 'Named on the national vendor declaration.' })}
        ${field({ label: 'Contact name', id: 'bd-contact', value: business.contactName })}
        ${field({ label: 'People who sign for the business', id: 'bd-signers', type: 'textarea', rows: 3, value: business.signers, placeholder: 'One name to a line', hint: 'Offered as the printed name under a signature on confirmations, invoices and freight orders. The person signed in is always first.' })}
        <div class="grid-2">
          ${field({ label: 'Phone', id: 'bd-phone', type: 'tel', value: business.phone })}
          ${field({ label: 'Email', id: 'bd-email', type: 'email', value: business.email })}
        </div>
        ${addressFields('bd-addr', partsOf(business.address, business.addressParts))}
        ${field({ label: 'Payment terms (days)', id: 'bd-terms', type: 'number', step: '1', value: business.paymentTermsDays })}
        ${seesBank ? `<hr class="sep" />
        <div class="grid-2">
          ${field({ label: 'Bank name', id: 'bd-bank', value: business.bankName })}
          ${field({ label: 'Account name', id: 'bd-accname', value: business.accountName })}
        </div>
        <div class="grid-2">
          ${field({ label: 'BSB', id: 'bd-bsb', type: 'text', placeholder: '000-000', value: business.bsb })}
          ${field({ label: 'Account number', id: 'bd-accno', placeholder: 'Digits only', value: business.accountNumber })}
        </div>` : ''}
        ${canEditBusiness ? '<button class="btn" id="save-business">Save business details</button>' : ''}
        </details>
      </div>

      <div class="card">
        <details class="fold" style="border-top:none;margin-top:0">
          <summary><div><h2>Overheads</h2><div class="sub">Whole-farm costs used for profit on the Position tab</div></div></summary>
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
        </details>
      </div>

      <div class="card">
        <h2>My signature</h2>
        <div class="hint" style="margin-bottom:8px">Draw your signature once. It signs the documents you choose to sign, such as a vendor declaration. Only you can see or use it.</div>
        <button class="btn secondary" id="open-my-signature">My signature&hellip;</button>
      </div>

      `)}
      ${db.getRole() === 'owner' ? group('people', 'People', 'Members and invitations', '<div class="card" id="people-card"></div>') : ''}
      ${group('data', 'Data and backup', `<span id="last-backup">Last backup: ${backupAgeText(lastBackup())}</span>`, `
      <div class="card">
        <h2>Data</h2>
        <div class="field hint" style="margin-bottom:8px">Your farm is kept on this device and synced to the server when you have signal. A backup is your own copy, in case.</div>
        <div class="tile-grid">
          <button class="btn secondary small" id="export">Export backup</button>
          <button class="btn secondary small" id="import">Import backup</button>
          <button class="btn secondary small" id="export-csv">Export CSV (Excel)&hellip;</button>
          ${['owner', 'manager'].includes(db.getRole()) ? `<button class="btn secondary small" id="open-import">Import from CSV&hellip;</button>` : ''}
          ${['owner', 'manager'].includes(db.getRole()) ? `<button class="btn secondary small" id="open-deleted">Recently deleted&hellip;</button>` : ''}
        </div>
        ${db.getRole() === 'owner' ? '<button class="btn danger small" id="reset" style="margin-top:12px">Reset all data&hellip;</button>' : ''}
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>
      `)}

      <div class="card" id="sync-card"></div>

      ${trialFarmsSlotHtml()}
      ${db.getRole() === 'owner' ? trialOwnSlotHtml() : ''}

      <div class="tile-grid">
        <button type="button" class="btn secondary tool-tile" id="report-problem"><b>Report a problem</b><span>tell us what went wrong</span></button>
        <button type="button" class="btn secondary tool-tile" id="go-account"><b>Account</b><span>sign out, your role</span></button>
      </div>

      ${group('app', db.getRole() === 'owner' ? 'App and support' : 'App', `Version ${esc(APP_VERSION)}${db.getRole() === 'owner' ? ' &middot; support access' : ''}`, `
      <div class="card">
        <div class="row"><span class="label">Version</span><span class="value">${esc(APP_VERSION)}</span></div>
        <button class="btn secondary small" id="check-update" style="margin-top:8px">Check for a new version</button>
        <div class="field hint" style="margin-top:10px">If something looks out of date after an update, force the app to fetch the latest version.</div>
        <button class="btn secondary small" id="force-refresh" style="margin-top:6px">Force refresh app</button>
        <hr class="sep" />
        <div class="field hint" style="margin-bottom:6px">What this device has stored, and
          anything still waiting to reach the server. Useful when two devices disagree.</div>
        <!--
          A plain relative anchor, deliberately, and for the same reason as the
          recovery link on the login screen: on iOS a home-screen app has its
          own storage container, sealed off from Safari. Opening this page in
          Safari inspects Safari's storage and reports that nothing has ever
          been saved — which is true of Safari and says nothing at all about
          the app. Navigating within scope keeps it inside the home-screen app,
          looking at the container that actually holds the farm.
        -->
        <a href="./state.html" class="btn secondary small"
           style="display:block;text-align:center;text-decoration:none;margin-top:6px">Storage diagnostics</a>
      </div>
      ${db.getRole() === 'owner' ? supportCardHtml() : ''}

      `)}
    </div>
    <button class="fab" id="add-commodity" aria-label="Add a commodity" ${openGroups.has('season') ? '' : 'hidden'}>+</button>
  `;

  // Fenced off deliberately. Everything below this line in Settings — seasons,
  // commodities, overheads, the backup buttons — is the screen the farm
  // actually runs on, and it renders after this point. A fault in the newest
  // card on the page must not take the rest of it with it.
  paintSyncCard(root);
  wireSupportCard(root);
  wireTrialFarms(root);
  wireTrialOwner(root);
  root.querySelector('#report-problem')?.addEventListener('click', () => openReportProblemSheet());

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
  root.querySelector('#grade-standards').addEventListener('click', () => openGradeStandardsSheet());
  root.querySelector('#my-grades').addEventListener('click', () => openMyGradesSheet());

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

  root.querySelector('#save-farm')?.addEventListener('click', () => {
    db.updateBusinessDetails({ farmName: getVal(root, 'bd-farm')?.trim() });
  });
  // read-only for anyone but the owner
  if (!canEditBusiness) root.querySelectorAll('#business-card input, #business-card select, #bd-farm').forEach((el) => { el.disabled = true; });

  root.querySelector('#open-help')?.addEventListener('click', () => { location.hash = '#/help'; });
  // the order the commodities are listed in: one step up or down, or back to biggest first
  root.querySelectorAll('[data-order-move]').forEach((el) => el.addEventListener('click', () => {
    const list = namesInOrder(db.get(), business);
    db.updateBusinessDetails({ commodityOrder: moveName(list, Number(el.dataset.orderMove), Number(el.dataset.by)) });
  }));
  root.querySelector('#order-auto')?.addEventListener('click', () => db.updateBusinessDetails({ commodityOrder: [] }));
  root.querySelector('#show-aircair')?.addEventListener('change', (e) => db.updateBusinessDetails({ showAircair: e.target.checked }));

  // the logo is saved as soon as it is chosen, like the other switches on this screen
  root.querySelector('#bd-logo-pick')?.addEventListener('click', () => root.querySelector('#bd-logo-file').click());
  root.querySelector('#bd-logo-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      db.updateBusinessDetails({ logo: await logoFromFile(file), logoOff: false });
      toast('Logo saved. It is on your PDFs from now on.');
    } catch (err) { notify(err?.message || 'That picture could not be used.'); }
  });
  root.querySelector('#bd-logo-on')?.addEventListener('change', (e) => { db.updateBusinessDetails({ logoOff: !e.target.checked }); toast(e.target.checked ? 'The logo is on your documents.' : 'The logo is off your documents.'); });
  root.querySelector('#bd-logo-remove')?.addEventListener('click', () => {
    db.updateBusinessDetails({ logo: '' });
    toast('Logo removed.');
  });

  root.querySelector('#save-business')?.addEventListener('click', () => {
    const addr = readAddress(root, 'bd-addr');
    db.updateBusinessDetails({
      entityName: getVal(root, 'bd-entity')?.trim(),
      abn: getVal(root, 'bd-abn')?.trim(),
      ngr: getVal(root, 'bd-ngr')?.trim(),
      pic: getVal(root, 'bd-pic')?.trim(),
      contactName: getVal(root, 'bd-contact')?.trim(),
      signers: getVal(root, 'bd-signers')?.trim(),
      phone: getVal(root, 'bd-phone')?.trim(),
      email: getVal(root, 'bd-email')?.trim(),
      address: joinAddress(addr),   // the one line the documents print; the parts ride beside it
      addressParts: addr,
      paymentTermsDays: getNum(root, 'bd-terms'),
      bankName: getVal(root, 'bd-bank')?.trim(),
      accountName: getVal(root, 'bd-accname')?.trim(),
      bsb: getVal(root, 'bd-bsb')?.trim(),
      accountNumber: getVal(root, 'bd-accno')?.trim(),
    });
  });
  root.querySelectorAll('#theme-seg button').forEach((b) => b.addEventListener('click', () => {
    setTheme(b.dataset.themeChoice);
    root.querySelectorAll('#theme-seg button').forEach((x) => x.classList.toggle('active', x === b));
  }));
  root.querySelector('#rename-year').addEventListener('click', () => openRenameYearSheet(currentYear));
  root.querySelector('#new-year').addEventListener('click', () => openNewYearSheet(currentYear));
  root.querySelector('#add-sample-history')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch(`./demo/seed.json?v=${APP_VERSION}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The sample history could not be fetched (${res.status}).`);
      const added = db.addSampleSeasons(sampleHistoryFrom(await res.json(), db.getYears()));
      toast(added ? `Added ${added} earlier season${added === 1 ? '' : 's'}` : 'Those seasons are already here');
    } catch (err) { notify(err.message || 'The sample history could not be added.'); btn.disabled = false; }
  });
  root.querySelector('#add-sample-orders')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch(`./demo/seed.json?v=${APP_VERSION}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The sample orders could not be fetched (${res.status}).`);
      const made = sampleOrdersFrom(await res.json(), db.get().sales);
      if (!made) throw new Error('This farm does not have the sample contract the orders go against.');
      db.upsertOrder(made.order);
      db.upsertFreightOrder(made.freightOrder);
      toast('Added a grain order and a freight order');
      btn.hidden = true;
    } catch (err) { notify(err.message || 'The sample orders could not be added.'); btn.disabled = false; }
  });
  const deleteYearBtn = root.querySelector('#delete-year');
  if (deleteYearBtn) {
    deleteYearBtn.addEventListener('click', () => {
      openDangerSheet({
        title: 'Delete a season',
        warning: `You are about to delete the <strong>${esc(currentYear)}</strong> season. Other seasons are not touched.`,
        contents: contentsText(seasonContents(db.getYearData(currentYear))),
        name: currentYear,
        confirmLabel: `Delete ${currentYear} for good`,
        done: `Deleted ${currentYear}`,
        onConfirm: () => db.deleteYear(currentYear),
      });
    });
  }

  root.querySelector('#export').addEventListener('click', () => {
    downloadBackup(db.exportJSON());
    const line = root.querySelector('#last-backup');
    if (line) line.textContent = `Last backup: ${backupAgeText(lastBackup())}`;
  });
  root.querySelector('#export-csv').addEventListener('click', () => openExportCsvSheet());
  root.querySelector('#open-import')?.addEventListener('click', () => openImportSheet());
  // the + adds a commodity, so it is only there while Season and crops is open
  root.querySelectorAll('details[data-group]').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) openGroups.add(d.dataset.group); else openGroups.delete(d.dataset.group);
    root.querySelector('#add-commodity').hidden = !openGroups.has('season');
  }));
  root.querySelector('#open-deleted')?.addEventListener('click', () => openDeletedSheet());
  root.querySelector('#open-my-signature')?.addEventListener('click', () => openMySignatureSheet());
  const importFile = root.querySelector('#import-file');
  root.querySelector('#import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const f = importFile.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      const { remapped, filled, stats } = db.importJSON(text);
      notify(
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
      notify(`Import refused.\n\n${e.message}`);
    }
  });
  root.querySelector('#reset')?.addEventListener('click', () => {
    const seasons = db.getYears();
    openDangerSheet({
      title: 'Reset all data',
      warning: `This wipes the <strong>whole farm</strong>: every season (${seasons.length}), with everything in them.`,
      contents: contentsText(seasonContents(seasons.reduce((all, l) => {
        const y = db.getYearData(l);
        for (const k of Object.keys(y)) if (Array.isArray(y[k])) all[k] = [...(all[k] || []), ...y[k]];
        return all;
      }, {}))),
      name: 'reset',
      confirmLabel: 'Reset everything for good',
      done: 'Everything was reset',
      onConfirm: () => db.resetAll(),
    });
  });

  root.querySelector('#check-update').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Checking…';
    const res = await checkNow(APP_VERSION);
    btn.disabled = false; btn.textContent = 'Check for a new version';
    if (res.state === 'newer') toast('A new version is ready. Use the bar at the bottom.');
    else if (res.state === 'current') toast('You are on the latest version');
    else notify('Could not reach the server to check. Try again when you have signal.');
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

/**
 * Whether this device is up to date with the server, in words.
 *
 * Written after a phone sat seven changes behind for a day. Every push was
 * being refused, the only record of that was a console line nobody can reach on
 * a phone, and — because unsent work outranks the server — the device was also
 * silently ignoring everything done anywhere else. Three separate things were
 * wrong and the app's answer to all of them was to look completely normal.
 */
async function paintSyncCard(root) {
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
        ${e.refused.map((r) => `<div class="field hint"><strong>${esc(String(r.name || 'unnamed'))}</strong> <span class="meta">${esc(r.id)}</span>${r.hidden === true ? ' &mdash; already on the server but hidden from this account (deleted there, or in another farm)' : ''}</div>`).join('')}` : ''}` : ''}
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
      <button class="btn secondary" id="exp-invoices" style="margin-bottom:8px">Invoices</button>
      <button class="btn secondary" id="exp-payables" style="margin-bottom:8px">Payables (bills owed)</button>
      <button class="btn secondary" id="exp-orders">Orders</button>
    `;

    root.querySelector('#exp-fields').addEventListener('click', () => exportFieldsCSV(year, stamp));
    root.querySelector('#exp-sales').addEventListener('click', () => exportSalesCSV(year, stamp));
    root.querySelector('#exp-movements').addEventListener('click', () => exportMovementsCSV(year, stamp));
    root.querySelector('#exp-storage').addEventListener('click', () => exportStorageCSV(year, stamp));
    root.querySelector('#exp-invoices').addEventListener('click', () => exportInvoicesCSV(year, stamp));
    root.querySelector('#exp-payables').addEventListener('click', () => exportPayablesCSV(year, stamp));
    root.querySelector('#exp-orders').addEventListener('click', () => exportOrdersCSV(year, stamp));
  });
}

function exportFieldsCSV(year, stamp) {
  const { commodities, fields, movements } = db.get();
  exportRowsAsCSV(`grainflow-fields-${year}-${stamp}.csv`, fields, [
    { label: 'Name', get: (f) => f.name },
    { label: 'Commodity', get: (f) => commodityName(commodities, f.commodityId) },
    { label: 'Area (ha)', get: (f) => f.areaHa ?? '' },
    { label: 'Yield mode', get: (f) => (f.yieldMode === 'actual' ? 'Actual (from movements)' : f.yieldMode === 'recorded' ? 'Recorded (past season)' : 'Estimate') },
    { label: 'Yield (t/ha)', get: (f) => f.yieldTHa ?? '' },
    { label: 'Tonnes', get: (f) => num(fieldTons(f, movements), 2) },
    // Grade and measurements: the weighted average of the loads carted off the field
    ...qualityColumns((f) => fieldQuality(f, movements)),
    { label: 'Urea required (kg/ha)', get: (f) => f.ureaRequiredKgHa ?? '' },
    { label: 'Urea applied (kg/ha)', get: (f) => ureaAppliedKgHaFor(f) },
    { label: 'Urea left (t)', get: (f) => num(fieldUrea(f).leftTons, 2) },
    { label: 'Seed variety', get: (f) => f.seedVariety ?? '' },
    { label: 'Seed rate (kg/ha)', get: (f) => f.seedRateKgHa ?? '' },
    { label: 'Seed required (t)', get: (f) => num(fieldSeed(f).requiredTons, 2) },
    { label: 'Harvested so far (t)', get: (f) => num(fieldHarvest(f, movements).inT, 2) },
    { label: 'Still to harvest (t)', get: (f) => num(fieldHarvest(f, movements).toComeT, 2) },
    { label: 'Harvest finished', get: (f) => (f.harvestDone ? 'Yes' : 'No') },
    { label: 'Hectares still to harvest', get: (f) => (f.harvestHaLeft != null && !f.harvestDone ? num(f.harvestHaLeft, 2) : '') },
    { label: 'Yield for hectares left (t/ha)', get: (f) => (f.harvestHaLeft != null && !f.harvestDone && f.harvestLeftYield != null ? num(f.harvestLeftYield, 2) : '') },
    { label: 'Comments', get: (f) => f.notes ?? '' },
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
    { label: 'Comments', get: (s) => s.notes ?? '' },
    // The contract's own terms. On the end rather than interleaved, so anyone
    // with a spreadsheet built on the old column order keeps it.
    { label: 'Crop year', get: (s) => s.cropYear ?? '' },
    { label: 'Contract type', get: (s) => s.contractType ?? '' },
    { label: 'Pricing point', get: (s) => s.pricingPoint ?? '' },
    { label: 'Weights to govern', get: (s) => s.weightsToGovern ?? '' },
    { label: 'Delivery terms', get: (s) => s.deliveryTerms ?? '' },
    { label: 'Buyer contact', get: (s) => s.buyerContact ?? '' },
    { label: 'Broker', get: (s) => s.broker ?? '' },
    { label: 'Broker reference', get: (s) => s.brokerRef ?? '' },
    { label: 'Brokerage paid by', get: (s) => s.brokeragePaidBy ?? '' },
    { label: 'Payment terms (days)', get: (s) => s.paymentTermsDays ?? '' },
    { label: 'Payment counted from', get: (s) => s.paymentTermsBasis ?? '' },
    { label: 'Carry ($/t/month)', get: (s) => s.carryRate ?? '' },
    { label: 'Carry starts', get: (s) => s.carryFrom ?? '' },
    { label: 'Trade rules', get: (s) => s.tradeRules ?? '' },
    // The grades a contract lists, each with its $/t adjustment, and what the loads delivered so far have added
    { label: 'Grade premiums/discounts ($/t)', get: (s) => (s.gradeOptions || []).map((o) => `${o.grade} ${o.adjust >= 0 ? '+' : ''}${o.adjust}`).join('; ') },
    { label: 'Brokerage ($/t)', get: (s) => s.brokerageRate || '' },
    { label: 'Grade adjustment to date ($)', get: (s) => (s.gradeOptions?.length ? num(saleEconomics(s, movements).gradeAdjustment, 2) : '') },
    // Canola priced for oil: the base, the % of price per 1%, and what the loads delivered so far have added
    { label: 'Oil base (%)', get: (s) => (s.oilAdjustPct ? s.oilBasePct : '') },
    { label: 'Oil adjustment (% of price per 1%)', get: (s) => (s.oilAdjustPct ? s.oilAdjustPct : '') },
    { label: 'Oil adjustment to date ($)', get: (s) => (s.oilAdjustPct ? num(saleEconomics(s, movements).oilAdjustment, 2) : '') },
  ]);
}

function exportMovementsCSV(year, stamp) {
  const data = db.get();
  const { movements } = data;
  const traced = traceLoads(data.storages, movements);
  exportRowsAsCSV(`grainflow-movements-${year}-${stamp}.csv`, movements, [
    { label: 'Ticket No', get: (m) => m.ticketNo ?? '' },
    { label: 'Their ticket no.', get: (m) => m.externalTicketNo ?? '' },
    { label: "Buyer's order no.", get: (m) => (m.orderId ? (db.getOrders().find((o) => o.id === m.orderId)?.orderNo ?? '') : '') },
    { label: 'Date', get: (m) => m.date ?? '' },
    { label: 'From', get: (m) => endpointsLabel(m.froms, data) },
    { label: 'To', get: (m) => endpointsLabel(m.tos, data) },
    { label: 'Tons', get: (m) => m.tons ?? '' },
    { label: 'Truck rego', get: (m) => m.truckRego ?? '' },
    { label: 'Driver', get: (m) => m.driver ?? '' },
    { label: 'Gross weight (t)', get: (m) => m.grossWeight ?? '' },
    { label: 'Tare weight (t)', get: (m) => m.tareWeight ?? '' },
    { label: 'Weight status', get: (m) => m.weightStatus ?? '' },
    // Load by load: this ticket's own grade and measurements
    ...qualityColumns(loadQuality),
    // Which paddocks the grain on this load came from, worked back through the silos it passed through (a silo emptied last in, first out or the other way)
    { label: 'Paddocks it came from (t)', get: (m) => traceText(traced.get(m.id), data) },
    { label: 'Comments', get: (m) => m.notes ?? '' },
  ]);
}

function exportStorageCSV(year, stamp) {
  const data = db.get();
  const { commodities, storages, movements } = data;
  exportRowsAsCSV(`grainflow-storage-${year}-${stamp}.csv`, storages, [
    { label: 'Name', get: (s) => s.name },
    { label: 'Kind', get: (s) => (s.offFarm ? 'Off-farm' : s.kind === 'bunker' ? 'Bunker / shed' : 'Silo') },
    { label: 'Commodity', get: (s) => commodityName(commodities, s.commodityId) },
    { label: 'Opening stock (t)', get: (s) => s.openingStock ?? '' },
    // an off-farm location is held by grade: its tracked stock is what it holds, all grades
    { label: 'Tracked stock (t)', get: (s) => num(s.offFarm ? totalHeld(holdings(s, movements, { fields: data.fields, storages: data.storages, sales: data.sales })) : storageLedgerStock(s, movements), 2) },
    { label: 'Held by grade (off-farm)', get: (s) => (s.offFarm ? holdings(s, movements, { fields: data.fields, storages: data.storages, sales: data.sales }).map((h) => `${commodityName(commodities, h.commodityId) || 'Unknown'} ${h.grade || 'No grade'} ${num(h.tons, 2)} t`).join('; ') : '') },
    { label: 'Run by (off-farm)', get: (s) => s.offFarm?.operator ?? '' },
    { label: 'Crop year', get: (s) => s.cropYear ?? '' },
    // Grade and measurements: the weighted average of what is in the silo now, layer by layer
    ...qualityColumns((s) => averageQuality(s.offFarm ? [] : layersForStorage(s, movements).layers.map((l) => ({ tons: l.tons, spec: l.spec })))),
    { label: 'Volume (m³)', get: (s) => s.volumeM3 ?? '' },
    { label: 'Capacity (t)', get: (s) => { const t = capacityFor(s, commodities); return t > 0 ? num(t, 1) : (s.capacityTons ?? ''); } },
    { label: 'Radius / Width (m)', get: (s) => s.kind === 'bunker' ? (s.width ?? '') : (s.radius ?? '') },
    { label: 'Height / Length (m)', get: (s) => s.kind === 'bunker' ? (s.length ?? '') : (s.currentHeight ?? '') },
    { label: 'Angle of repose override (°)', get: (s) => s.angleOfRepose ?? '' },
    { label: 'Test weight override (t/m³)', get: (s) => s.testWeight ?? '' },
    { label: 'Comments', get: (s) => s.notes ?? '' },
  ]);
}

function exportPayablesCSV(year, stamp) {
  const { commodities, sales, storages } = db.get();
  const contract = (id) => { const s = sales.find((x) => x.id === id); return s ? [commodityName(commodities, s.commodityId), s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') : ''; };
  exportRowsAsCSV(`grainflow-payables-${year}-${stamp}.csv`, db.getPayables(), [
    { label: 'Type', get: (p) => kindLabel(p.kind) },
    { label: 'From', get: (p) => p.supplier ?? '' },
    { label: 'Their invoice no.', get: (p) => p.reference ?? '' },
    { label: 'Invoice date', get: (p) => p.invoiceDate ?? '' },
    { label: 'Due date', get: (p) => p.dueDate ?? '' },
    { label: 'Contract', get: (p) => contract(p.saleId) },
    { label: 'Storage location', get: (p) => storages.find((s) => s.id === p.storageId)?.name ?? '' },
    { label: 'Tonnes', get: (p) => p.tons ?? '' },
    { label: 'Rate ($/t)', get: (p) => p.rate ?? '' },
    { label: 'Amount ex GST ($)', get: (p) => num(p.amount, 2) },
    { label: 'GST ($)', get: (p) => num(p.gst, 2) },
    { label: 'Total ($)', get: (p) => num(billTotal(p), 2) },
    { label: 'Status', get: (p) => (p.status === 'paid' ? 'Paid' : 'Unpaid') },
    { label: 'Paid date', get: (p) => p.paidDate ?? '' },
    { label: 'Comments', get: (p) => p.notes ?? '' },
  ]);
}

function exportOrdersCSV(year, stamp) {
  const { commodities, sales, movements } = db.get();
  const today = todayLocal();
  const saleOf = (o) => sales.find((x) => x.id === o.saleId);
  exportRowsAsCSV(`grainflow-orders-${year}-${stamp}.csv`, db.getOrders(), [
    { label: 'Buyer', get: (o) => saleOf(o)?.buyer ?? '' },
    { label: 'Commodity', get: (o) => commodityName(commodities, saleOf(o)?.commodityId) },
    { label: 'Contract no.', get: (o) => saleOf(o)?.contractNo ?? '' },
    { label: "Buyer's order no.", get: (o) => o.orderNo ?? '' },
    { label: 'Deliver from', get: (o) => o.deliverFrom ?? '' },
    { label: 'Deliver by', get: (o) => o.deliverBy ?? '' },
    { label: 'Tonnes ordered', get: (o) => num(o.tons, 2) },
    { label: 'Tonnes delivered', get: (o) => num(orderState(o, movements, today).delivered, 2) },
    { label: 'Tonnes left', get: (o) => num(orderState(o, movements, today).left, 2) },
    { label: 'Freight company', get: (o) => o.freightCompany ?? '' },
    { label: 'Status', get: (o) => STATE_LABEL[orderState(o, movements, today).state] },
    { label: 'Comments', get: (o) => o.notes ?? '' },
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
    { label: 'Invoice No', get: (i) => (isAdjustment(i) ? '' : i.invoiceNo ?? '') },
    // an adjustment note has a number of its own and says which invoice it adjusts
    { label: 'Adjustment note', get: (i) => (isAdjustment(i) ? noteLabel(i) : '') },
    { label: 'Adjusts invoice', get: (i) => (isAdjustment(i) ? (i.adjustsInvoiceNo ?? '') : '') },
    { label: 'Reason', get: (i) => (isAdjustment(i) ? i.reason ?? '' : '') },
    { label: 'Already in the invoice total', get: (i) => (isAdjustment(i) && i.appliedToInvoice ? 'Yes' : '') },
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
    // Invoices have no notes of their own; this is the contract's
    { label: 'Comments', get: (i) => i.notes ?? sales.find((s) => s.id === i.saleId)?.notes ?? '' },
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
      if (!ok) { notify(`"${year}" is already in use.`); return; }
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
      if (!ok) { notify(`"${year}" already exists or is invalid.`); return; }
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

/**
 * "Use last season's closing": what last season was left holding of this
 * commodity, and what it was worth at that season's MTM, ready to put in as this
 * season's opening stock. A button, not automatic: the person reads the figures
 * and edits them before saving, because unsold tonnes are the uncontracted ones
 * and the silos may hold more (grain sold last season and not yet delivered).
 */
function offerLastSeasonsClosing(root) {
  const slot = root.querySelector('#carry-from-last');
  if (!slot) return;
  const current = db.getCurrentYear();
  const earlier = db.getYears().filter((y) => y < current);
  const last = earlier[earlier.length - 1];
  const name = getVal(root, 'name')?.trim();
  if (!last || !name) return;
  const closing = closingStock(db.getYearData(last), name);
  if (!closing || !(closing.tons > 0)) return;
  slot.innerHTML = `
    <div class="field hint" style="margin-bottom:6px">${esc(last)} closed holding ${num(closing.tons, 1)} t of unsold ${esc(name)}
      at ${money(closing.mtm, 2)}/t &mdash; ${money(closing.value, 0)}.</div>
    <button type="button" class="btn secondary small" id="use-closing">Use ${esc(last)} closing</button>`;
  slot.querySelector('#use-closing').addEventListener('click', () => {
    root.querySelector('#opening').value = Math.round(closing.tons * 100) / 100;
    root.querySelector('#openingValue').value = Math.round(closing.value);
    toast('Filled in from ' + last + ' — check, then Save');
  });
}

function openCommoditySheet(existing) {
  const { fields } = db.get();
  // the hectares sown to this commodity, to turn a cost per hectare into a total
  const gmArea = commodityAreaHa(fields, existing?.id);
  openSheet(existing ? 'Edit commodity' : 'Add commodity', (root) => {
    root.innerHTML = `
      ${field({ label: 'Name', id: 'name', value: existing?.name, placeholder: 'e.g. Wheat' })}
      ${field({ label: 'Sold &amp; measured in', id: 'unit', type: 'select', value: existing?.unit ?? 't', options: [{ value: 't', label: 'Tonnes' }, { value: 'bale', label: 'Bales' }], hint: 'Bales — for cotton lint. Changes the units shown in Production and Sales for this commodity.' })}
      <div id="bales-per-round-wrap" style="display:none">
        ${field({ label: 'Ginned bales per round bale', id: 'balesPerRound', type: 'number', step: '0.1', value: existing?.balesPerRoundBale ?? '', placeholder: 'e.g. 4.2', hint: 'Default ratio used when logging a ginning — editable per event' })}
        <div class="field"><div class="hint">Position shows cotton as lint, seed and ginning. These count from the first bale; logged ginning runs replace the estimates.</div></div>
        <div class="grid-2">
          ${field({ label: 'Seed price ($/t)', id: 'seedMtm', type: 'number', step: '0.01', value: existing?.cotton?.seedMtm || '' })}
          ${field({ label: 'Seed per bale (t)', id: 'seedFactor', type: 'number', step: '0.001', value: existing?.cotton?.seedFactor || '', placeholder: '0.245' })}
        </div>
        <div class="grid-2">
          ${field({ label: 'Ginning ($/bale)', id: 'ginRate', type: 'number', step: '0.01', value: existing?.cotton?.ginRate || '' })}
          ${field({ label: 'Levies ($/bale)', id: 'ginLevies', type: 'number', step: '0.01', value: existing?.cotton?.levies || '', hint: 'Research and voluntary' })}
        </div>
        ${field({ label: 'Turnout (%)', id: 'ginTurnout', type: 'number', step: '0.1', value: existing?.cotton?.turnout || '', placeholder: '40', hint: 'Lint from picked cotton, to estimate the bales in modules' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Angle of repose (°)', id: 'angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'For silo/bunker peak calc' })}
        ${field({ label: 'Test weight (t/m³)', id: 'tw', type: 'number', step: '0.01', value: existing?.testWeight })}
      </div>
      ${field({ label: 'Harvested in', id: 'harvestSeason', type: 'select', value: existing?.harvestSeason ?? '',
        options: [{ value: '', label: 'Automatic' }, { value: 'winter', label: 'Winter (wheat, barley, canola...)' }, { value: 'summer', label: 'Summer (sorghum, cotton, maize...)' }],
        hint: 'Harvest progress is read for winter and summer crops separately as well as for the whole farm. Automatic goes by the name.' })}
      ${field({ label: 'MTM price ($/t)', id: 'mtm', type: 'number', step: '0.01', value: existing?.mtmPrice ?? 0, hint: 'Used to value unsold position' })}
      <div class="grid-2">
        ${field({ label: 'Opening stock (t)', id: 'opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0 })}
        ${field({ label: 'Retained seed (t)', id: 'seed', type: 'number', step: '0.01', value: existing?.retainedSeed ?? 0 })}
      </div>
      ${field({ label: 'Opening stock value ($)', id: 'openingValue', type: 'number', step: '1', value: existing?.openingValue ?? 0,
        hint: "What the opening stock was worth at last season's closing (opening MTM) price. It shows on the Position tab as 'Less opening stock' and comes off this season's total, so grain already counted last year is not counted twice." })}
      <div id="carry-from-last"></div>
      ${field({ label: 'Default yield estimate (t/ha)', id: 'defaultYield', type: 'number', step: '0.1', value: existing?.defaultYieldTHa ?? 0, hint: 'Pre-fills new fields\' production yield estimate, in Production — separate from the fert target yield below' })}
      ${existing ? '<div id="yield-apply"></div>' : ''}
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Target yield (t/ha)', id: 'targetYield', type: 'number', step: '0.1', value: existing?.targetYieldTHa ?? 0, hint: 'Default fert planning target — separate from the production yield estimate above' })}
        ${field({ label: 'N required (kg/t)', id: 'nPerTonne', type: 'number', step: '1', value: existing?.nPerTonne ?? 0, hint: 'For the Fert calculator' })}
      </div>
      ${existing ? `
        <div class="row"><span class="label">Fields using this commodity</span><span class="value">${fields.filter((f) => f.commodityId === existing.id).length}</span></div>
      ` : ''}
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Gross margin cost ($/ha)', id: 'gmCostHa', type: 'number', step: '0.01', value: perHaFromTotal(existing?.grossMarginCost, gmArea) || '' })}
        ${field({ label: 'Gross margin cost ($)', id: 'gmCost', type: 'number', step: '1', value: existing?.grossMarginCost ?? 0 })}
      </div>
      <div class="field hint" id="gm-hint" style="margin-top:-6px"></div>
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete commodity</button>` : ''}
      <div class="save-bar solo"><button class="btn" id="save">Save</button></div>
    `;
    offerLastSeasonsClosing(root);
    // Paddocks still on an estimate can be moved to the default as typed, in one go (the ones with a real yield, or finished, are left alone)
    const applyBox = root.querySelector('#yield-apply');
    const paintYieldApply = () => {
      if (!applyBox) return;
      const typed = getNum(root, 'defaultYield');
      const plan = planYieldUpdate(db.get().fields, existing.id, typed);
      const waiting = plan.count + plan.same;
      if (waiting === 0 || !(typed > 0)) {
        applyBox.innerHTML = waiting === 0 ? '<div class="field hint">No paddocks of this commodity are on an estimate.</div>' : '';
        return;
      }
      applyBox.innerHTML = plan.count === 0
        ? `<div class="field hint">${plan.same === 1 ? 'The paddock still on an estimate is' : `All ${plan.same} paddocks still on an estimate are`} already at ${num(typed, 2)} t/ha.</div>`
        : `<div class="field hint" style="margin-bottom:6px">${plan.count} paddock${plan.count === 1 ? '' : 's'} still on an estimate (${num(plan.areaHa, 1)} ha): ${num(plan.tonsBefore, 0)} t now, ${num(plan.tonsAfter, 0)} t at ${num(typed, 2)} t/ha.${plan.finished ? ` ${plan.finished} with a real yield or a finished harvest ${plan.finished === 1 ? 'is' : 'are'} left alone.` : ''}</div>
           <button type="button" class="btn secondary" id="apply-yield">Set ${plan.count === 1 ? 'that paddock' : `those ${plan.count} paddocks`} to ${num(typed, 2)} t/ha</button>`;
      applyBox.querySelector('#apply-yield')?.addEventListener('click', async () => {
        const now = planYieldUpdate(db.get().fields, existing.id, getNum(root, 'defaultYield'));
        if (!now.count) return;
        const ok = await askConfirm(`Set ${now.count} paddock${now.count === 1 ? '' : 's'} of ${existing.name} to ${num(getNum(root, 'defaultYield'), 2)} t/ha? Paddocks with an actual or recorded yield, and finished harvests, are not changed. This also saves it as the default.`, { confirmLabel: 'Update' });
        if (!ok) return;
        now.changes.forEach((c) => db.upsertField({ id: c.id, yieldTHa: c.to }));
        db.upsertCommodity({ id: existing.id, defaultYieldTHa: getNum(root, 'defaultYield') });
        toast(`${now.count} paddock${now.count === 1 ? '' : 's'} updated`);
        paintYieldApply();
      });
    };
    root.querySelector('#defaultYield').addEventListener('input', paintYieldApply);
    paintYieldApply();
    // Cost: type $/ha and the total follows; type the total and $/ha follows. The total is what is kept.
    const gmHa = root.querySelector('#gmCostHa');
    const gmTotal = root.querySelector('#gmCost');
    const gmHint = root.querySelector('#gm-hint');
    gmHint.textContent = gmArea > 0
      ? `Over the ${num(gmArea, 1)} ha sown to ${existing?.name || 'this commodity'}: type either one and the other follows.`
      : 'No fields use this commodity yet, so $/ha has nothing to work from. Write the total.';
    if (!(gmArea > 0)) gmHa.disabled = true;
    gmHa.addEventListener('input', () => { gmTotal.value = totalFromPerHa(gmHa.value, gmArea) || ''; });
    gmTotal.addEventListener('input', () => { gmHa.value = perHaFromTotal(gmTotal.value, gmArea) || ''; });
    // the automatic choice says what it comes to for the name as typed
    const autoOpt = root.querySelector('#harvestSeason option[value=""]');
    const syncAuto = () => { if (autoOpt) autoOpt.textContent = `Automatic: ${autoSeasonText(getVal(root, 'name'))}`; };
    root.querySelector('#name').addEventListener('input', syncAuto);
    syncAuto();
    const balesWrap = root.querySelector('#bales-per-round-wrap');
    const mtmLabel = root.querySelector('#mtm')?.closest('.field')?.querySelector('label');
    const syncUnitFields = () => {
      const bales = getVal(root, 'unit') === 'bale';
      balesWrap.style.display = bales ? 'block' : 'none';
      if (mtmLabel) mtmLabel.textContent = bales ? 'Lint MTM price ($/bale)' : 'MTM price ($/t)';
    };
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
        harvestSeason: getVal(root, 'harvestSeason') || null,
        mtmPrice: getNum(root, 'mtm'),
        // cotton's seed and ginning settings; cleared when the commodity is not in bales
        cotton: getVal(root, 'unit') === 'bale' ? cleanCotton({ seedMtm: getNum(root, 'seedMtm'), seedFactor: getNum(root, 'seedFactor'), ginRate: getNum(root, 'ginRate'), levies: getNum(root, 'ginLevies'), turnout: getNum(root, 'ginTurnout') }) : null,
        openingStock: getNum(root, 'opening'),
        openingValue: getNum(root, 'openingValue'),
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
