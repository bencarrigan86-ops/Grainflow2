import { db } from '../storage.js?v=427';
import { tileIcon } from '../tileicon.js?v=427';
import { getTheme, setTheme } from '../theme.js?v=427';
import { num, money, esc } from '../fmt.js?v=427';
import {
  openSheet, closeSheet, openOver, field, getVal, getNum, confirmDelete, notify, askConfirm, toast,
} from '../ui.js?v=427';
import { planYieldUpdate } from '../yieldupdate.js?v=427';
import { openLoadImportSheet } from './importloads.js?v=427';
import { openDeliveryImportSheet } from './importdeliveries.js?v=427';
import { openPastSeasonsSheet } from './pastseasons.js?v=427';
import { openPastSalesSheet } from './pastsales.js?v=427';
import { openLineupSheet } from './lineup.js?v=427';
import { addressFields, readAddress, joinAddress, partsOf } from '../address.js?v=427';
import { downloadBackup, lastBackup, backupAgeText } from '../backup.js?v=427';
import { openDangerSheet } from './dangerconfirm.js?v=427';
import {
  sampleHistoryFrom, sampleHistoryOffered, sampleOrdersFrom, sampleOrdersOffered, sampleCottonHayFrom, sampleCottonHayOffered, sampleRefreshOffered, sampleStateFor,
} from '../demo.js?v=427';
import { seasonContents, contentsText } from '../seasondelete.js?v=427';
import { openDeletedSheet } from './deleted.js?v=427';
import { openAuditSheet } from './audit.js?v=427';
import { canSeeAudit } from '../audit.js?v=427';
import { canSeeOverheads } from '../nav.js?v=427';
import { APP_VERSION } from '../version.js?v=427';
import { checkNow } from '../updatecheck.js?v=427';
import { logoFromFile } from '../logo.js?v=427';

import { closingStock, position } from '../derived.js?v=427';
import { cleanCotton } from '../ginning.js?v=427';
import { cleanHay, hasHay, BALE_TYPES } from '../hay.js?v=427';
import { orderedNames, moveName } from '../commodityorder.js?v=427';
import { openGradeStandardsSheet, openMyGradesSheet } from './gradestandards.js?v=427';
import { autoSeasonText } from '../harvestseason.js?v=427';
import { totalFromPerHa, perHaFromTotal, commodityAreaHa } from '../gmcost.js?v=427';
import { openMySignatureSheet } from './signaturepad.js?v=427';
import { supportCardHtml, wireSupportCard, openReportProblemSheet } from './support.js?v=427';
import { trialFarmsSlotHtml, wireTrialFarms, trialOwnSlotHtml, wireTrialOwner } from './trialfarms.js?v=427';
import { paintPeople } from './settingspeople.js?v=427';
import { paintSyncCard } from './settingssync.js?v=427';
import { openExportCsvSheet } from './settingsexport.js?v=427';

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
        ${sampleCottonHayOffered(db.get().sales, db.get().fields, currentYear, db.getRole()) ? `<div class="hint" style="margin-top:8px">This sample farm has no sample cotton or hay. Add two cotton paddocks, modules to a gin yard and a ginning run, lucerne and straw with their bales, sheds, contracts and invoices, so those screens have something to show.</div>
        <button class="btn secondary small" id="add-sample-cotton-hay" style="margin-top:6px">Add sample cotton and hay</button>` : ''}
        ${sampleRefreshOffered(currentYear, db.getRole()) ? `<div class="hint" style="margin-top:8px">Sample farm: replace everything on it with the latest sample (new contracts, silos and bills). Anything you added here goes. A backup is kept first.</div>
        <button class="btn danger small" id="refresh-sample" style="margin-top:6px">Refresh the sample&hellip;</button>` : ''}
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

${canSeeOverheads(db.getRole()) ? `      <div class="card">
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
      </div>` : ''}

      <div class="card">
        <h2>My signature</h2>
        <div class="hint" style="margin-bottom:8px">Draw your signature once. It signs the documents you choose to sign, such as a vendor declaration. Only you can see or use it.</div>
        <button class="btn secondary" id="open-my-signature">My signature&hellip;</button>
      </div>

      `)}
      ${db.getRole() === 'owner' ? group('people', 'People and permissions', 'Members, invitations and what each can do', '<div class="card" id="people-card"></div>') : ''}
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
          ${canSeeAudit(db.getRole()) ? `<button class="btn secondary small" id="open-audit">Audit history&hellip;</button>` : ''}
        </div>
        ${db.getRole() === 'owner' ? '<button class="btn danger small" id="reset" style="margin-top:12px">Reset all data&hellip;</button>' : ''}
        <input type="file" id="import-file" accept="application/json" style="display:none" />
      </div>
      `)}

      <div class="card" id="sync-card"></div>

      ${trialFarmsSlotHtml()}
      ${db.getRole() === 'owner' ? trialOwnSlotHtml() : ''}

      <div class="tile-grid">
        <button type="button" class="btn secondary tool-tile" id="report-problem">${tileIcon('problem')}<span class="tt-text"><b>Report a problem</b><span>tell us what went wrong</span></span></button>
        <button type="button" class="btn secondary tool-tile" id="go-account">${tileIcon('account')}<span class="tt-text"><b>Account</b><span>sign out, your role</span></span></button>
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
      peopleCard.innerHTML = `<h2>People and permissions</h2>
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

  root.querySelector('#save-overheads')?.addEventListener('click', () => {
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
  root.querySelector('#add-sample-cotton-hay')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch(`./demo/seed.json?v=${APP_VERSION}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The sample cotton and hay could not be fetched (${res.status}).`);
      const pack = sampleCottonHayFrom(await res.json(), { commodities: db.get().commodities, fields: db.get().fields, payables: db.getPayables(), inputStock: db.getInputMoves(), sprayJobs: db.getSprayJobs() });
      const made = pack && db.addSampleCottonHay(pack);
      if (!made) throw new Error('This farm already has cotton or hay.');
      toast(`Added cotton and hay: ${made.paddocks} paddocks, ${made.loads} loads, ${made.invoices} invoices`);
      btn.hidden = true;
    } catch (err) { notify(err.message || 'The sample cotton and hay could not be added.'); btn.disabled = false; }
  });
  root.querySelector('#refresh-sample')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch(`./demo/seed.json?v=${APP_VERSION}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The latest sample could not be fetched (${res.status}).`);
      // the farm keeps its own name and business details: only the farm's data is replaced
      const state = sampleStateFor(await res.text(), db.getBusinessDetails()?.farmName || "");
      state.businessDetails = { ...state.businessDetails, ...(db.getBusinessDetails() || {}) };
      const seasons = db.getYears();
      openDangerSheet({
        title: 'Refresh the sample',
        warning: `This replaces the <strong>whole sample farm</strong> (${seasons.length} season${seasons.length === 1 ? '' : 's'}) with the latest sample. Whatever you added to it is lost.`,
        contents: contentsText(seasonContents(seasons.reduce((all, l) => {
          const y = db.getYearData(l);
          for (const k of Object.keys(y)) if (Array.isArray(y[k])) all[k] = [...(all[k] || []), ...y[k]];
          return all;
        }, {}))),
        name: 'refresh',
        confirmLabel: 'Replace with the latest sample',
        done: 'The sample was refreshed',
        onConfirm: () => {
          try { db.importJSON(JSON.stringify(state)); } catch (err) { notify(`The sample could not be refreshed.

${err.message}`); }
        },
      });
    } catch (err) { notify(err.message || 'The latest sample could not be fetched.'); }
    btn.disabled = false;
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
  root.querySelector('#open-audit')?.addEventListener('click', () => openAuditSheet());
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
      <div id="hay-wrap" style="display:none">
        ${field({ label: 'Baled hay', id: 'isHay', type: 'select', value: hasHay(existing?.hay) ? 'yes' : 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes, count the bales as well' }], hint: 'Sold in tonnes. The bales are counted as well, with an approximate weight for each.' })}
        <div id="hay-fields" style="display:none" class="grid-2">
          ${field({ label: 'Bale type', id: 'baleType', type: 'select', value: existing?.hay?.baleType || 'round', options: BALE_TYPES.map((b) => ({ value: b.value, label: b.label })) })}
          ${field({ label: 'Bale weight (kg)', id: 'baleKg', type: 'number', step: '1', value: existing?.hay?.baleKg || '', placeholder: '500', hint: 'Average, for every paddock' })}
        </div>
      </div>
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
        <div class="grid-2">
          ${field({ label: 'Turnout (%)', id: 'ginTurnout', type: 'number', step: '0.1', value: existing?.cotton?.turnout || '', placeholder: '40', hint: 'Lint from picked cotton' })}
          ${field({ label: 'Module weight (kg)', id: 'ginModuleKg', type: 'number', step: '1', value: existing?.cotton?.moduleKg || '', placeholder: '12000', hint: 'Average, for every paddock' })}
        </div>
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
      root.querySelector('#hay-wrap').style.display = bales ? 'none' : 'block';
      root.querySelector('#hay-fields').style.display = !bales && getVal(root, 'isHay') === 'yes' ? '' : 'none';
      if (mtmLabel) mtmLabel.textContent = bales ? 'Lint MTM price ($/bale)' : 'MTM price ($/t)';
    };
    root.querySelector('#unit').addEventListener('change', syncUnitFields);
    root.querySelector('#isHay').addEventListener('change', syncUnitFields);
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
        cotton: getVal(root, 'unit') === 'bale' ? cleanCotton({ seedMtm: getNum(root, 'seedMtm'), seedFactor: getNum(root, 'seedFactor'), ginRate: getNum(root, 'ginRate'), levies: getNum(root, 'ginLevies'), turnout: getNum(root, 'ginTurnout'), moduleKg: getNum(root, 'ginModuleKg') }) : null,
        // hay: the kind of bale and its average weight, for a commodity sold in tonnes that is baled
        hay: getVal(root, 'unit') !== 'bale' && getVal(root, 'isHay') === 'yes' ? cleanHay({ baleType: getVal(root, 'baleType') || 'round', baleKg: getNum(root, 'baleKg') }) : null,
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
