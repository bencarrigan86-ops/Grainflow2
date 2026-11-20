// The how-to guide: who can do what, a short guide for each part of the app, and the getting-started checklist.
//
// Pure data and small functions, so the wording can be checked against the rules that really decide things: the tab bar in
// nav.js and the database policies in supabase/migrations (tests/help.test.mjs reads both). If a role's access changes,
// that test fails until this page says so too.

import { ROLES, canOpen } from './nav.js?v=496';
import { LEVEL_ROLES, levelNow, pricesShown, readSwitches, readLevels, SCREEN_NEEDS } from './farmswitches.js?v=496';

// --- who can do what -------------------------------------------------------------------------------------------

export const LEVELS = {
  full: { label: 'Add and change', short: 'Full' },
  view: { label: 'View only', short: 'View' },
  own: { label: 'Add loads, change open ones', short: 'Loads' },
  used: { label: 'See stock, record use and counts (no prices)', short: 'Use' },
  draft: { label: 'Write drafts for a manager to send', short: 'Draft' },
  tonnes: { label: 'See contracts and tonnes, no prices', short: 'No $' },
  none: { label: 'Not available', short: '—' },
};

export const ROLE_INFO = [
  {
    role: 'owner', label: 'Owner',
    summary: 'Runs the farm. Sees and changes everything, including contract prices, invoices, bills and the farm\'s business and bank details.',
    only: 'Only an owner can invite or remove people, change what each person can do, edit the business details, restore things from Recently deleted and switch on Aircair\'s spray form.',
  },
  {
    role: 'manager', label: 'Farm manager',
    summary: 'Runs the paddocks, silos and loads, sends spray requests, and handles orders, invoices and bills. Sees contracts and tonnes, but not contract prices, overheads or the bank details in Settings.',
    only: 'Can remove anyone\'s loads and records, bring in last season\'s contracts and start a new season.',
  },
  {
    role: 'bookkeeper', label: 'Bookkeeper',
    summary: 'The financial side: contracts and prices, invoices and bills. Can see paddocks, loads and reports, but not Position, Storage, overheads or grain orders, and does not record loads or change paddocks and stock.',
    only: 'Enters contracts and invoices alongside the owner.',
  },
  {
    role: 'farm_worker', label: 'Farm worker',
    summary: 'Paddocks, silos and loads, and the stock of seed, fertiliser, fuel and chemical with no prices. No contract prices, no invoices, no Position tab and no yields.',
    only: 'Can add loads and change loads that are still open. An owner can also let a worker record production (urea, seed and paddock details) when they are added under People.',
  },
  {
    role: 'driver', label: 'Driver',
    summary: 'Loads only: the loads they cart. They can pick the paddock, silo or contract a load comes from or goes to, but see nothing else.',
    only: 'Can add loads and change loads that are still open. Can remove only loads they made themselves.',
  },
  {
    role: 'advisor', label: 'Advisor',
    summary: 'Looks and changes nothing: an agronomist, accountant or bank. Sees paddocks, production, inputs used, storage and spray requests. Loads, contracts, prices and overheads only if the owner switches them on.',
    only: 'Read only. Invited by an owner, and the owner chooses what they can see under Who sees what in Settings.',
  },
];

/**
 * One row per area of the app, with what each role can do there. `tab` names the tab that holds it, where there is one,
 * so the test can check the row against the tab bar.
 */
export const ACCESS = [
  { key: 'position', area: 'Position', hint: 'Tonnes, unsold grain and profit', tab: 'position',
    owner: 'view', manager: 'view', bookkeeper: 'none', farm_worker: 'none', driver: 'none', advisor: 'none',
    note: 'A manager sees tonnes and margin per paddock, but not overheads or the whole farm\'s profit.' },
  { key: 'production', area: 'Production', hint: 'Paddocks, yields, urea, seed, farm map', tab: 'production',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'view', driver: 'none', advisor: 'view',
    note: 'A worker can change paddocks only if the owner has allowed them to record production. Workers do not see yields.' },
  { key: 'contracts', area: 'Contracts and prices', hint: 'Sales', tab: 'sales',
    owner: 'full', manager: 'view', bookkeeper: 'full', farm_worker: 'none', driver: 'none', advisor: 'none',
    note: 'A manager sees contracts and tonnes with the prices left out.' },
  { key: 'invoices', area: 'Invoices', hint: 'Invoices and the buyer\'s RCTI check',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none', advisor: 'none' },
  { key: 'bills', area: 'Bills', hint: 'Brokerage, freight, storage and other bills you owe',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none', advisor: 'none' },
  { key: 'overheads', area: 'Overheads', hint: 'Whole-farm costs, set in Settings',
    owner: 'full', manager: 'none', bookkeeper: 'none', farm_worker: 'none', driver: 'none', advisor: 'none',
    note: 'This is what keeps whole-farm profit from a manager.' },
  { key: 'grainorders', area: 'Grain orders', hint: 'Who is to deliver what, and when',
    owner: 'full', manager: 'full', bookkeeper: 'none', farm_worker: 'none', driver: 'none', advisor: 'none' },
  { key: 'freightorders', area: 'Freight orders', hint: 'Loads to cart, and the carrier',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none', advisor: 'none' },
  { key: 'loads', area: 'Loads and tickets', hint: 'Movement, load tickets, the load report', tab: 'movement',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'own', driver: 'own', advisor: 'none',
    note: 'Workers and drivers can change a load until it is closed, and can remove only their own.' },
  { key: 'storage', area: 'Storage', hint: 'Silos and bunkers', tab: 'storage',
    owner: 'full', manager: 'full', bookkeeper: 'none', farm_worker: 'view', driver: 'none', advisor: 'view',
    note: 'Drivers do not have the Storage tab, but can pick a silo when they record a load.' },
  { key: 'reports', area: 'Reports', hint: 'Reports and summaries', tab: 'reports',
    owner: 'view', manager: 'view', bookkeeper: 'view', farm_worker: 'view', driver: 'none', advisor: 'none' },
  { key: 'sprays', area: 'Spray requests', hint: 'Spray form and map for a contractor',
    owner: 'full', manager: 'full', bookkeeper: 'none', farm_worker: 'none', driver: 'none', advisor: 'view' },
  { key: 'inputs', area: 'Inputs and spraying', hint: 'Seed, fertiliser, fuel and chemical on hand',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'used', driver: 'none', advisor: 'used',
    note: 'A worker sees what is on hand and records what is used and counts. Prices are never sent to their phone.' },
  { key: 'settings', area: 'Settings', hint: 'Commodities, seasons, grades, business details',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'none', driver: 'none', advisor: 'none',
    note: 'Commodities are changed by the owner and manager; overheads by the owner; business and bank details by the owner only (the bookkeeper can see the bank details; a manager cannot). Workers and drivers have Account only, for signing out.' },
  { key: 'people', area: 'People', hint: 'Invite, change and remove people',
    owner: 'full', manager: 'none', bookkeeper: 'none', farm_worker: 'none', driver: 'none', advisor: 'none' },
];

/** The rows of the access table for one role: what they can do in each area. */
/**
 * The table as it stands on a farm with these switches on (see farmswitches.js): the standard rows, with the cells a switch
 * changes changed. A switch that narrows (delete, final weights, a driver's own loads) changes no cell: those are rules inside
 * an area. Returns new rows; ACCESS itself is the standard rules and is not touched.
 */
export function effectiveAccess(switches = {}, levels = {}) {
  const rows = ACCESS.map((r) => ({ ...r }));
  const set = (area, role, level) => { const r = rows.find((x) => x.area === area); if (r) r[role] = level; };
  const on = (k) => switches[k] === true;
  if (on('workerSeesPosition')) set('Position', 'farm_worker', 'view');
  if (on('managerSeesOverheads')) set('Overheads', 'manager', 'view');
  if (on('bookkeeperEditsLoads')) set('Loads and tickets', 'bookkeeper', 'full');
  if (on('workersRaiseSprays')) set('Spray requests', 'farm_worker', 'draft');
  if (on('driverSeesStorage')) set('Storage', 'driver', 'view');
  if (on('workerSeesSales')) set('Contracts and prices', 'farm_worker', 'view');
  if (on('managerHidesBills')) { set('Invoices', 'manager', 'none'); set('Bills', 'manager', 'none'); }
  if (on('advisorSeesLoads')) {
    for (const a of ['Position', 'Contracts and prices', 'Loads and tickets', 'Reports']) set(a, 'advisor', 'view');
    if (on('advisorSeesPrices')) for (const a of ['Invoices', 'Bills', 'Grain orders', 'Freight orders']) set(a, 'advisor', 'view');
    if (on('advisorSeesOverheads')) set('Overheads', 'advisor', 'view');
  }
  // a role that sees contracts but is not shown the prices has "no prices" in that cell (the table above says View, with a note)
  const contracts = rows.find((x) => x.key === 'contracts');
  if (contracts) for (const role of LEVEL_ROLES) if (contracts[role] === 'view' && !pricesShown(role, switches)) contracts[role] = 'tonnes';
  // and what the owner has picked on top of that (see farmswitches.js): the pick is the answer, more or less than the standard
  for (const r of rows) for (const role of LEVEL_ROLES) { const chosen = levels?.[r.key]?.[role]; if (chosen) r[role] = levelNow(r[role], chosen); }
  return rows;
}

/** The level this role has in an area on a farm with these saved switches (the raw farms.switches), or 'full' for a role not in the table. */
export function levelFor(role, key, raw) {
  const row = effectiveAccess(readSwitches(raw), readLevels(raw)).find((r) => r.key === key);
  return row?.[role] ?? 'full';
}

/** The names of the areas this screen is built from that this role cannot see (empty when the role cannot see the screen itself, or nothing is missing). */
export function missingAreas(role, screenKey, raw) {
  const need = SCREEN_NEEDS[screenKey] || [];
  if (!need.length || levelFor(role, screenKey, raw) === 'none') return [];
  return need.filter((k) => levelFor(role, k, raw) === 'none').map((k) => ACCESS.find((r) => r.key === k).area);
}

const joined = (names) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** The line on a screen made from areas its viewer cannot see, or '' when nothing is missing. */
export function missingLine(role, screenKey, raw) {
  const m = missingAreas(role, screenKey, raw);
  return m.length ? `Part of this is built from ${joined(m)}, which your login cannot see, so some tonnes and margins here are incomplete.` : '';
}

/** A warning for the owner picking a level: which screens this role sees would be left incomplete (or are already). */
export function pickWarning(role, key, raw) {
  const area = ACCESS.find((r) => r.key === key)?.area;
  if (SCREEN_NEEDS[key]) { const m = missingAreas(role, key, raw); return m.length ? `${area} is built from ${joined(m)}, which this login cannot see, so its numbers will be incomplete.` : ''; }
  const screens = Object.entries(SCREEN_NEEDS).filter(([s, need]) => need.includes(key) && levelFor(role, s, raw) !== 'none').map(([s]) => ACCESS.find((r) => r.key === s).area);
  return screens.length ? `${joined(screens)} is partly built from ${area}. If this login cannot see it, those numbers will be incomplete.` : '';
}

export function accessFor(role) {
  return ACCESS.map((r) => ({ area: r.area, hint: r.hint, level: r[role] || 'none', note: r.note || '' }));
}

// --- the guides ------------------------------------------------------------------------------------------------

const ALL = ROLES;
const OFFICE = ['owner', 'manager', 'bookkeeper'];

/**
 * A short guide per part of the app. `roles` is who is shown it; `open` is the tab or screen to jump to (shown only when
 * the reader can open it).
 */
export const GUIDES = [
  {
    id: 'start', title: 'Getting started', roles: OFFICE, open: 'position', openLabel: 'Open Position',
    shot: 'help/walk.jpg', shotAlt: 'A step of the setup walk-through asking what you grow',
    blurb: 'One walk-through sets the farm up.',
    steps: [
      'Tap Start setup on Position, or Open the walk-through at the top of this page.',
      'It asks one thing at a time: business, season, crops, paddocks, silos, a contract, a load and an invoice. Short answers sit side by side, and the Farm box appears only if you run more than one property.',
      'Skip what you do not have yet. Continue setup picks up where you stopped.',
    ],
    tips: [
      'The sample farm on a trial account is for looking around. Nothing in it is real.',
    ],
  },
  {
    id: 'install', title: 'Putting Commodity Mate on your phone', roles: ALL, open: 'account', openLabel: 'Open Account',
    blurb: 'Add it to the home screen so it opens like any other app.',
    steps: [
      'iPhone: Safari, Share, Add to Home Screen. Android: Chrome menu, Install app.',
      'Open it from the new icon. Sign in once; it is the same farm and login.',
    ],
    tips: [
      'On Account, This device says whether the phone will keep your saved data. If not, tap Keep my saved data.',
    ],
  },
  {
    id: 'offline', title: 'Working without signal', roles: ALL, open: '', openLabel: '',
    blurb: 'The app is built for the paddock.',
    steps: [
      'Everything you enter is saved on the device first, so it works with no signal.',
      'The dot beside the season is white when everything has been sent and amber when something is waiting. It sends when you are back in range.',
    ],
    tips: [
      'After an update, reload the app twice so the newest version is on screen.',
    ],
  },
  {
    id: 'paddocks', title: 'Paddocks and production', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker'], open: 'production', openLabel: 'Open Production',
    shot: 'help/field.jpg', shotAlt: 'The Add field form: name, farm, crop, area, yield and the folds below',
    blurb: 'Area, crop, yield, fertiliser and seed for each paddock.',
    steps: [
      'On Production, tap + to add a paddock: name, farm, hectares and crop. Tick Double crop if it was sown straight after another crop.',
      'Yield estimate sits beside the crop\'s default yield. Tap Use it to take the default.',
      'Drive tons from says where the tonnes come from. Estimate is hectares times the yield estimate. Actual (movements) is the loads recorded from the paddock.',
      'Harvest: mark it finished, or enter the hectares still to cut.',
      'Fertiliser planning: enter a target yield and the soil test N. It works out the N needed, and Use as Urea required fills in the urea to hit the target. Starter and seed has the sums for those.',
    ],
    tips: [
      'Rotation and Averages (Reports) compare seasons. A double crop shows its own yield beside the normal one. Yields are hidden from farm workers.',
      'Open a paddock and tap Add a movement to start a load already filled in. Merge two paddocks from the paddock sheet.',
    ],
  },
  {
    id: 'map', title: 'The farm map', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker'], open: 'production', openLabel: 'Open Production',
    blurb: 'Your paddock outlines, coloured by crop.',
    steps: [
      'Export your paddock boundaries as a shapefile from any mapping software. Any shapefile works, with its .dbf.',
      'Open the Farm map (Reports or Production) and choose the .shp and .dbf files together, or the zip.',
      'Paddocks match yours by name. Tick the ones that take their area from the map, then save.',
    ],
    tips: [
      'The map can be sent as a PDF. A new season carries the outlines over.',
    ],
  },
  {
    id: 'storage', title: 'Silos and bunkers', roles: ['owner', 'manager', 'farm_worker'], open: 'storage', openLabel: 'Open Storage',
    shot: 'help/storage-form.jpg', shotAlt: 'The Add storage form: silo, bunker, off farm or yard, with its name, commodity and opening stock',
    blurb: 'What is in each store and how full it is.',
    steps: [
      'On Storage, tap + to add a silo or a bunker.',
      'Enter its volume in cubic metres. The tonnes it holds come from the volume and the commodity\'s test weight. Or measure it instead.',
      'Set what is in it and its opening stock. Loads move the stock.',
      'Shrink: give the commodity a Shrink in silos % in Settings (normally 0.7). It comes off grain going from a paddock into a silo, and shows on Position as its own line.',
    ],
    tips: [
      'Search, Sort by and More (measured view, grouping, the Silo calculator) are at the top.',
      'Grain held by a third party is an off-farm store, with storage fees worked out for you.',
    ],
  },
  {
    id: 'inputs', title: 'Inputs and spraying', roles: [...OFFICE, 'farm_worker'], open: 'production', openLabel: 'Open Production',
    shot: 'help/inputs.jpg', shotAlt: 'The Bought form for seed, fertiliser, fuel and chemical',
    blurb: 'Seed, fertiliser, fuel and chemical on hand.',
    steps: [
      'On Production, open Inputs and spraying.',
      'Record what you buy and use, and counts that fix the stock. Say which shed or silo it is in.',
    ],
    tips: [
      'A farm worker records use and counts only. They never see prices or suppliers.',
    ],
  },
  {
    id: 'spray', title: 'Spray requests', roles: ['owner', 'manager'], open: 'production', openLabel: 'Open Production',
    shot: 'help/spray.jpg', shotAlt: 'The New spray request form: who and when, the paddocks by property, and the products',
    blurb: 'A spray form and a map for the contractor.',
    steps: [
      'On the farm map tick the paddocks, then Spray request. Or open Spray requests under Inputs and spraying on Production.',
      'Paddocks to spray lists your properties. Tap a property to open its paddocks, or tick the property to take them all.',
      'Add the products with a rate per hectare, and the water rate.',
      'Who and when: the contractor and their email, the form to send it on, and the date required. The job has the property, crop, purchase order and who supplies the chemical.',
      'Tap View to look at the PDF, then send it. The map is the last page.',
    ],
    tips: [
      'A different rate on some paddocks is under the product list, and is optional.',
      'The owner can switch on Aircair\'s own form in Settings, under Farm.',
    ],
  },
  {
    id: 'hay', title: 'Hay and straw: tonnes and bales', roles: ['owner', 'manager', 'farm_worker'], open: 'production', openLabel: 'Open Production',
    blurb: 'Sold by the tonne, with the bales counted as well.',
    steps: [
      'In Settings, add each kind (lucerne, oaten hay, barley straw...) as its own commodity, sold in Tonnes. Set Baled hay to Yes, then the bale type and an average bale weight.',
      'On the paddock, tap + Log bales baled for each cut or run. It shows baled, moved and still in the field.',
      'Straw or hay off a grain paddock: use Straw and hay baled off this paddock, and pick the kind.',
      'On a load, enter the Bales. The weight is the bales times the bale weight until you type in the weighbridge weight.',
      'Hay fed on the farm: on the load, choose Used on farm as the destination and say what it was used for. It comes out of the stock and goes on no contract.',
    ],
    tips: [
      'Contracts and invoices stay in tonnes and show the bale count as well.',
      'Storage shows the bales held, and Position takes hay used on the farm out of the unsold.',
    ],
  },
  {
    id: 'contracts', title: 'Contracts', roles: ['owner', 'manager', 'bookkeeper'], open: 'sales', openLabel: 'Open Sales',
    shot: 'help/contract.jpg', shotAlt: 'The Add sale form: buyer, date, commodity, tonnes and price',
    blurb: 'Each sale: buyer, tonnes, price and terms.',
    steps: [
      'On Sales, tap + (the owner or bookkeeper adds contracts). Enter the buyer, commodity, grade, tonnes and price.',
      'Delivery: the start and finish dates. Weights and quality says whose weights govern, and sits beside Delivery option, how it is delivered. Freight paid by sits beside the freight rate.',
      'Payment terms and brokerage: We invoice (you, or the buyer by RCTI), trade rules such as GTA 3, payment days, carry and the broker.',
      'Price adjustments, Multigrade and Oil (canola) are further down, closed until you need them.',
      'Confirmation of sale makes a printable confirmation, signed if you tick the box. Loads against the contract count as delivered, and its card shows what is still to go.',
    ],
    tips: [
      'More has Paid contracts and Bring in last season\'s contracts. Delivery option feeds Sales timeline and the cash forecast. Type the buyer\'s address in its parts so documents fill in.',
      'Carry (grain in tonnes) is added to the price of each load by the month it is delivered: the start month counts one month, then one more each month. Cotton has no carry: a lint sale has a Late delivery discount per bale, by month late.',
    ],
  },
  {
    id: 'orders', title: 'Orders, deliveries and bills', roles: OFFICE, open: 'sales', openLabel: 'Open Sales',
    shot: 'help/order.jpg', shotAlt: 'The Add a grain order form',
    blurb: 'What is still to deliver, and what is owed.',
    steps: [
      'Grain orders and Freight orders are on Sales. A freight order can be signed before it goes to the carrier.',
      'Sales timeline (Reports) shows tonnes still to deliver and how near each delivery period is to ending.',
      'Invoices (Reports) shows invoices owed to you and bills you owe. By month shows when the money lands, with a forecast in italics.',
    ],
    tips: [
      'The forecast uses each contract\'s delivery pattern. With none set, the grain shows as Not yet scheduled.',
    ],
  },
  {
    id: 'load', title: 'Recording a load', roles: ['owner', 'manager', 'farm_worker', 'driver'], open: 'movement', openLabel: 'Open Movement',
    shot: 'help/load.jpg', shotAlt: 'The Add movement form',
    blurb: 'Every truck, from a paddock or silo to a silo or a contract.',
    steps: [
      'On Movement, tap + Add load.',
      'Choose the commodity, where it came from and where it is going, with the tonnes.',
      'Add the truck and driver, and gross and tare if it was weighed. A truck carted before fills in its company, driver and phone.',
      'Save. The load gets the next ticket number.',
      'The driver can sign on the phone (Driver signature). Open the load and tap Send this load as a PDF to text or email the ticket, signature on it, as the load docket.',
    ],
    tips: [
      'It works with no signal. The dot beside the season shows what is still to send.',
      'A load from two paddocks or silos lists the tonnes from each. A driver or worker can remove only their own loads.',
    ],
  },
  {
    id: 'ticket', title: 'Load tickets and the load report', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver'], open: 'movement', openLabel: 'Open Movement',
    blurb: 'A PDF for one load, or a table of loads.',
    steps: [
      'One load: open it and tap Send this load as a PDF. The ticks choose what prints.',
      'Many loads: Load report (on Movement, or in Reports). Pick the dates, commodity or contract, then send or download.',
    ],
    tips: [
      'To see which paddocks a load came from, use Traceability.',
    ],
  },
  {
    id: 'trace', title: 'Traceability: where a load came from', roles: ['owner', 'manager', 'farm_worker'], open: 'reports', openLabel: 'Open Reports',
    shot: 'help/trace.jpg', shotAlt: 'The Traceability sheet, by sale',
    blurb: 'Which paddocks the grain on a load or contract came from.',
    steps: [
      'In Reports, tap Traceability. Choose the loads and, if you like, the dates and commodity.',
      'By load lists each load with its paddocks. By sale groups them under each contract.',
      'Tick Show the silo it came from to see ticket, silo, paddocks. A silo holding several paddocks shows as a blend.',
      'Download for Excel (CSV) for a table you can sort and total, or send it as a PDF.',
    ],
    tips: [
      'It follows the grain through the silos, so it is only as good as the loads recorded.',
    ],
  },
  {
    id: 'invoices', title: 'Invoices and the buyer\'s RCTI', roles: OFFICE, open: 'sales', openLabel: 'Open Sales',
    blurb: 'Invoice a contract, then check it against the buyer\'s paperwork.',
    steps: [
      'Open a contract, then Invoices and New invoice. Tick the loads, add any extra line, and create it.',
      'Print or save it as a PDF (tick the signing box to sign). Mark it paid when the money arrives.',
      'Enter the buyer\'s RCTI number and total. It says Agrees or shows the difference; if they differ, make an adjustment note.',
    ],
    tips: [
      'The invoice stays as sent. The note says what changed and counts in what the buyer owes.',
      'Payment details print only for the owner and the bookkeeper.',
    ],
  },
  {
    id: 'cotton', title: 'Cotton: modules to bales', roles: ['owner', 'manager', 'farm_worker'], open: 'movement', openLabel: 'Open Movement',
    blurb: 'From picking to lint bales and seed, step by step.',
    steps: [
      'Set up Cotton as a commodity sold in Bales, and Cottonseed as one sold in tonnes (Settings).',
      'As modules are picked, open the paddock and tap Modules picked: the count, estimated weight and turnout. Reports, Modules lists them by paddock.',
      'Truck them to the gin: Movement, More, Move modules, to a gin yard named after the gin. They come off the paddock.',
      'When the gin runs them: Movement, More, Log ginning. Enter the modules ginned, the bales pressed and their numbers, the lint kg and the seed kg, and the gin\'s rates.',
      'Say where each lot of bales goes (a store or a bale contract) and where the seed goes. The run makes the gin invoice.',
    ],
    tips: [
      'A standard bale is 227 kg. Contracts and gin charges count standard bales (lint kg divided by 227), not the bales pressed.',
      'Cotton on hand (Storage) adds up the modules in the field by paddock, in the gin yard, and the bales in the shed.',
    ],
  },
  {
    id: 'cottonsell', title: 'Cotton: selling and the gin invoice', roles: ['owner', 'manager', 'bookkeeper'], open: 'sales', openLabel: 'Open Sales',
    blurb: 'Lint, seed and ginning each have their own contract.',
    steps: [
      'Lint: an ordinary contract on Cotton, in bales. On Sales tap +, choose Lint sale as the contract type.',
      'Seed sold outright: a contract on Cottonseed, in tonnes.',
      'If the gin buys your seed, choose Gin for seed. The price is the seed value per bale and the ginning and levies come off it. Log ginning picks up its rates. Ginning only just records the gin\'s rates.',
      'In Log ginning, say who pays the gin invoice: you, or the lint buyer. If the lint buyer pays, the invoice waits in Payables.',
      'When you invoice the lint buyer, pick the gin invoices to take off. That line is how the gin is paid out of the lint payment.',
    ],
    tips: [
      'The gin invoice is taken off only when you pick it on a lint invoice, so the right amount comes off each contract.',
      'Invoices (Reports) shows gin bills still open, and the lint invoices that have taken them off.',
    ],
  },
  {
    id: 'position', title: 'Position', roles: OFFICE, open: 'position', openLabel: 'Open Position',
    shot: 'help/position.jpg', shotAlt: 'The Position screen',
    blurb: 'Where the season stands, crop by crop.',
    steps: [
      'The top boxes give the current crop value, what was produced, how much is sold and unsold, and the gross margin.',
      'Each crop has a tile with its value, margin and share sold. Tap one for the full breakdown.',
      'The PDF button saves the screen as a report.',
      'Display, above the tiles, picks the figures each tile shows: Everything, Short, or your own ticks. It is kept on this phone, and the crop detail still has every figure.',
    ],
    tips: [
      'Needs attention sits above the boxes when something needs you: overdue invoices or bills, contracts past their end, grain delivered but not invoiced. Tap a line to deal with it.',
      'Unsold grain is valued at the MTM price (Reports, Prices).',
    ],
  },
  {
    id: 'reports', title: 'Reports', roles: [...OFFICE, 'farm_worker'], open: 'reports', openLabel: 'Open Reports',
    shot: 'help/reports.jpg', shotAlt: 'The Reports screen showing every report as a tile',
    blurb: 'Every report in one place.',
    steps: [
      'Favourites shows the reports you use most. All shows every report, in groups.',
      'Tap a tile to open it. In All, tap a star to make a report a favourite.',
    ],
    tips: [
      'Invoices, Sales timeline, Available storage, Stock by location, Silo blending, the Silo calculator, Traceability and the exports are all here.',
    ],
  },
  {
    id: 'season', title: 'Starting a new season', roles: ['owner', 'manager'], open: 'settings', openLabel: 'Open Settings',
    blurb: 'Carry the farm over and keep the old season\'s records.',
    steps: [
      'Tap the season at the top right, then Start new year and enter the label, such as 2027.',
      'Paddocks, outlines, silos and commodities carry over, and a silo still holding grain opens with it. Yields, contracts, loads and overheads start empty.',
      'The old season stays: pick it in the Viewing box. On Sales, More, Bring in last season\'s contracts carries unfinished ones across.',
    ],
    tips: [
      'Past seasons and past sales can be imported from CSV in Settings, and Line up paddock names matches renamed paddocks. Rename a season with the button beside Viewing.',
    ],
  },
  {
    id: 'people', title: 'Inviting people', roles: ['owner'], open: 'settings', openLabel: 'Open Settings',
    blurb: 'Give someone their own login, with only what they need.',
    steps: [
      'In Settings, open People and permissions. Enter their email and choose their role.',
      'Send the invitation link. It lasts 14 days; you can resend or withdraw it.',
      'Tap a person to change what they can do.',
    ],
    tips: [
      'You cannot change or remove yourself, so there is always an owner. Bank details are never sent to a manager, worker or driver.',
      'Audit history in Settings lists who changed what, and when.',
    ],
  },
  {
    id: 'signing', title: 'Signing documents', roles: OFFICE, open: 'settings', openLabel: 'Open Settings',
    blurb: 'Your own signature on confirmations, invoices, freight orders and vendor declarations.',
    steps: [
      'In Settings, open My signature, draw it once and type the name to print under it.',
      'Tick the sign box on a confirmation, invoice or freight order.',
    ],
    tips: [
      'A signature belongs to the person. Nobody else can see or use yours, and it works offline.',
    ],
  },
  {
    id: 'safety', title: 'Backups and keeping data safe', roles: OFFICE, open: 'settings', openLabel: 'Open Settings',
    blurb: 'How to keep a copy, and who can see what.',
    steps: [
      'In Settings, Export backup saves the whole farm to a file. Keep it somewhere other than the phone.',
      'Import backup puts it back. Recently deleted (owner, manager) restores something removed by mistake.',
    ],
    tips: [
      'Position warns when a backup is due. Bank details can be read only by the owner and the bookkeeper.',
    ],
  },
  {
    id: 'help', title: 'Getting help', roles: ALL, open: 'account', openLabel: 'Open Account',
    blurb: 'Tell us what went wrong.',
    steps: [
      'On Account or Settings, tap Report a problem. Say what happened, then Send.',
      'The report carries the app build and the last few errors, never the farm\'s records. If it cannot send, tap Copy.',
      'The owner can let support look at the farm, read only, for 7 days (Settings, Support access).',
    ],
    tips: [
      'Support cannot change anything or see bank details.',
    ],
  },
];

/** The guides this role is shown. */
export function guidesForRole(role) {
  return GUIDES.filter((g) => g.roles.includes(role));
}

// --- getting started ------------------------------------------------------------------------------------------

/**
 * The checklist on Position. Each step is done when the farm has the thing, so it ticks itself. A step is only offered to
 * a role that can do it.
 */
export const START_STEPS = [
  { id: 'business', label: 'Fill in your business details', detail: 'Entity name, ABN and NGR go on invoices and tickets', route: 'settings', roles: ['owner'],
    done: (d) => !!(d.business?.entityName && (d.business?.abn || d.business?.ngr)) },
  { id: 'commodities', label: 'Add your commodities', detail: 'Wheat, barley, canola and so on', route: 'settings', roles: ['owner', 'manager'],
    done: (d) => (d.commodities || []).length > 0 },
  { id: 'paddocks', label: 'Add your paddocks', detail: 'Name, area and crop', route: 'production', roles: ['owner', 'manager'],
    done: (d) => (d.fields || []).length > 0 },
  { id: 'storage', label: 'Add your silos and bunkers', detail: 'And what is in them now', route: 'storage', roles: ['owner', 'manager'],
    done: (d) => (d.storages || []).length > 0 },
  { id: 'contract', label: 'Enter a contract', detail: 'Buyer, tonnes and price', route: 'sales', roles: ['owner', 'bookkeeper'],
    done: (d) => (d.sales || []).length > 0 },
  { id: 'load', label: 'Record a load', detail: 'From a paddock or silo to a silo or contract', route: 'movement', roles: ['owner', 'manager'],
    done: (d) => (d.movements || []).length > 0 },
  { id: 'invoice', label: 'Make an invoice', detail: 'From a contract with loads delivered', route: 'sales', roles: ['owner', 'manager', 'bookkeeper'],
    done: (d) => (d.invoices || []).length > 0 },
];

/** The steps for this role and farm, each with whether it is done, and whether the reader can open where it happens. */
export function startProgress(role, data) {
  const steps = START_STEPS.filter((s) => s.roles.includes(role))
    .map((s) => ({ id: s.id, label: s.label, detail: s.detail, route: s.route, done: !!s.done(data), canOpen: canOpen(role, s.route) }));
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: steps.length > 0 && done === steps.length };
}
