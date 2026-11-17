// The how-to guide: who can do what, a short guide for each part of the app, and the getting-started checklist.
//
// Pure data and small functions, so the wording can be checked against the rules that really decide things: the tab bar in
// nav.js and the database policies in supabase/migrations (tests/help.test.mjs reads both). If a role's access changes,
// that test fails until this page says so too.

import { ROLES, canOpen } from './nav.js?v=367';

// --- who can do what -------------------------------------------------------------------------------------------

export const LEVELS = {
  full: { label: 'Add and change', short: 'Full' },
  view: { label: 'See only', short: 'See' },
  own: { label: 'Add loads, change open ones', short: 'Loads' },
  used: { label: 'See stock, record use and counts (no prices)', short: 'Use' },
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
    summary: 'The financial side: contracts and prices, invoices, bills, overheads, orders and inputs. Can see paddocks, loads, storage and the Position tab, but does not record loads or change paddocks and silos.',
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
];

/**
 * One row per area of the app, with what each role can do there. `tab` names the tab that holds it, where there is one,
 * so the test can check the row against the tab bar.
 */
export const ACCESS = [
  { area: 'Position', hint: 'Tonnes, unsold grain and profit', tab: 'position',
    owner: 'view', manager: 'view', bookkeeper: 'view', farm_worker: 'none', driver: 'none',
    note: 'A manager sees tonnes and margin per paddock, but not overheads or the whole farm\'s profit.' },
  { area: 'Production', hint: 'Paddocks, yields, urea, seed, farm map', tab: 'production',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'view', driver: 'none',
    note: 'A worker can change paddocks only if the owner has allowed them to record production. Workers do not see yields.' },
  { area: 'Contracts and prices', hint: 'Sales', tab: 'sales',
    owner: 'full', manager: 'view', bookkeeper: 'full', farm_worker: 'none', driver: 'none',
    note: 'A manager sees contracts and tonnes with the prices left out.' },
  { area: 'Invoices', hint: 'Invoices and the buyer\'s RCTI check',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none' },
  { area: 'Bills', hint: 'Brokerage, freight, storage and other bills you owe',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none' },
  { area: 'Overheads', hint: 'Whole-farm costs, set in Settings',
    owner: 'full', manager: 'none', bookkeeper: 'full', farm_worker: 'none', driver: 'none',
    note: 'This is what keeps whole-farm profit from a manager.' },
  { area: 'Grain orders and freight orders', hint: 'Orders and deliveries to go',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'none', driver: 'none' },
  { area: 'Loads and tickets', hint: 'Movement, load tickets, the load report', tab: 'movement',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'own', driver: 'own',
    note: 'Workers and drivers can change a load until it is closed, and can remove only their own.' },
  { area: 'Storage', hint: 'Silos and bunkers', tab: 'storage',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'view', driver: 'none',
    note: 'Drivers do not have the Storage tab, but can pick a silo when they record a load.' },
  { area: 'Reports', hint: 'Reports and summaries', tab: 'reports',
    owner: 'view', manager: 'view', bookkeeper: 'view', farm_worker: 'view', driver: 'none' },
  { area: 'Spray requests', hint: 'Spray form and map for a contractor',
    owner: 'full', manager: 'full', bookkeeper: 'none', farm_worker: 'none', driver: 'none' },
  { area: 'Inputs and stock', hint: 'Seed, fertiliser, fuel and chemical on hand',
    owner: 'full', manager: 'full', bookkeeper: 'full', farm_worker: 'used', driver: 'none',
    note: 'A worker sees what is on hand and records what is used and counts. Prices are never sent to their phone.' },
  { area: 'Settings', hint: 'Commodities, seasons, grades, business details',
    owner: 'full', manager: 'full', bookkeeper: 'view', farm_worker: 'none', driver: 'none',
    note: 'Commodities are changed by the owner and manager; overheads by the owner and bookkeeper; business and bank details by the owner only (the bookkeeper can see the bank details; a manager cannot). Workers and drivers have Account only, for signing out.' },
  { area: 'People', hint: 'Invite, change and remove people',
    owner: 'full', manager: 'none', bookkeeper: 'none', farm_worker: 'none', driver: 'none' },
];

/** The rows of the access table for one role: what they can do in each area. */
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
    id: 'start', title: 'Getting started', roles: OFFICE, open: 'settings', openLabel: 'Open Settings',
    blurb: 'The order that sets a farm up quickly.',
    steps: [
      'Settings: set the farm name and fill in the business details (entity name, ABN, NGR). They are printed on invoices, confirmations and load tickets.',
      'Settings: add the commodities you grow, such as Wheat, Barley and Canola.',
      'Production: add your paddocks with their areas and crops, or draw them from a map (see the Farm map guide).',
      'Storage: add your silos and bunkers, and what is in them now.',
      'Sales: enter a contract for each sale (the owner or bookkeeper does this).',
      'Movement: record each load as it goes. Loads come off paddocks or silos and go to a silo or a contract.',
      'Sales: when a load has been delivered, make the invoice from the contract.',
    ],
    tips: [
      'The sample farm on a trial account is there to look around. Nothing in it is real.',
      'The Getting started list on Position ticks itself off as you add things.',
      'Once you are going, the Needs attention list at the top of Position says what to look at today (see Needs attention).',
    ],
  },
  {
    id: 'load', title: 'Recording a load', roles: ['owner', 'manager', 'farm_worker', 'driver'], open: 'movement', openLabel: 'Open Movement',
    blurb: 'Every truck, from a paddock or silo to a silo or a contract.',
    steps: [
      'Open Movement and tap +.',
      'Check the date and time, then enter the truck and driver.',
      'Say where it came from (a paddock or a silo) and where it is going (a silo or a contract), with the tonnes for each.',
      'If the truck was weighed, enter gross and tare. The net is worked out, and you can mark it as an estimate or the final weight.',
      'Add the grade and any quality results if the load was tested (protein, moisture, screenings, test weight, falling number, oil or retention).',
      'Type a destination if the load is going somewhere that is not named on the contract.',
      'Tap Save. The load gets its next ticket number.',
    ],
    tips: [
      'It works with no signal. Loads are kept on the phone and sent when you are back in range; the dot beside the season shows whether anything is still waiting.',
      'You can change a load until it is closed. A driver or worker can remove only their own loads; a manager or owner can remove any.',
      'A load from two paddocks or silos lists the tonnes from each.',
    ],
  },
  {
    id: 'ticket', title: 'Load tickets and the load report', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver'], open: 'movement', openLabel: 'Open Movement',
    blurb: 'A PDF for one load, or a table of loads for a period.',
    steps: [
      'One load: open the saved load and use "Send this load as a PDF" at the bottom of the sheet. It shows the ticket number, trading name and NGR, the truck and driver, from and to, the weights and the net.',
      'The ticks above the button choose what is printed: where it came from, the tonnes from each source, the destination, a comments box, and any quality results.',
      'Many loads: on Movement tap Load report, pick the dates, and filter by commodity or contract. Send it or download it as a PDF.',
    ],
    tips: [
      'The ticket uses what is on the screen, so you can send it before saving; save to keep the changes.',
      'Quality results appear only when they were recorded on that load.',
    ],
  },
  {
    id: 'paddocks', title: 'Paddocks and production', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker'], open: 'production', openLabel: 'Open Production',
    blurb: 'Area, crop, yield, urea and seed for each paddock.',
    steps: [
      'Open Production and tap + to add a paddock: its name, area in hectares and its crop.',
      'Tap a paddock to enter its yield, urea and starter fertiliser, and seed variety and rate.',
      'Production shows what each paddock produced and what it is worth against its costs.',
    ],
    tips: [
      'Once the farm has more than one season, Rotation and yield history (top of Production) shows every paddock against every season: the crop, its yield, and an outline where the same crop was grown two seasons running. Its PDF button (portrait or landscape, laid out like the load report) and Excel (CSV) button save what is on the sheet. Open a paddock and its History fold says the same for that paddock alone.',
      'The paddock list has a % of area column: how much of the farm each commodity covers.',
      'Open a paddock or a contract and tap Add a movement to start a load already filled in with that paddock or contract.',
      'Yields are hidden from farm workers. A worker can change paddocks only if the owner has allowed it under People.',
      'Merge two paddocks into one from the paddock sheet if you have combined them.',
    ],
  },
  {
    id: 'map', title: 'The farm map', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker'], open: 'production', openLabel: 'Open Production',
    blurb: 'Your paddock outlines, coloured by crop.',
    steps: [
      'In John Deere Operations Center, export your boundaries as a shapefile.',
      'On Production, open the farm map and choose the .shp and .dbf files together (or the zip).',
      'Paddocks are matched to yours by name. Tick the ones that should take their area from the map, then save.',
      'The map colours each paddock by its crop, groups paddocks by farm, and can be sent as a PDF showing what is on screen.',
    ],
    tips: [
      'On the sample farm, the map screen has an Add the sample map button.',
      'Starting a new season carries each paddock\'s outline into it.',
    ],
  },
  {
    id: 'storage', title: 'Silos and bunkers', roles: ['owner', 'manager', 'bookkeeper', 'farm_worker'], open: 'storage', openLabel: 'Open Storage',
    blurb: 'What is in each store and how full it is.',
    steps: [
      'Open Storage and tap + to add a silo (its radius and cone) or a bunker (its width and length).',
      'Set what is in it, its height and its opening stock. The tonnes are worked out from the shape.',
      'Loads into and out of a store move its stock. The quality of the grain in a silo can be recorded on its sheet.',
    ],
    tips: [
      'Grain held by a third party can be set up as an off-farm store. The owner, manager and bookkeeper can also enter how the site charges, and the app estimates the storage fee month by month and sets it beside the site\'s bills.',
      'In Settings, Export CSV for movements has a Paddocks it came from column: the paddocks behind each load, worked out through the silos it passed through.',
    ],
  },
  {
    id: 'contracts', title: 'Contracts', roles: ['owner', 'manager', 'bookkeeper'], open: 'sales', openLabel: 'Open Sales',
    blurb: 'Each sale: buyer, tonnes, price and terms.',
    steps: [
      'Open Sales and tap + (the owner or bookkeeper adds contracts; a manager sees them without prices).',
      'Enter the buyer, commodity, grade, tonnes and price, then the delivery period and payment terms.',
      'Open the Advanced folds for tolerance, carry and Multigrade (a premium or discount for each grade the buyer takes).',
      'Say how it is delivered: the buyer calls it, or it is spread evenly over the delivery period. An evenly spread contract shows the tonnes a week or a month on Deliveries to go, and feeds the forecast in the cash flow.',
      'Type the buyer\'s address in its parts (line 1, line 2, town, state and postcode). Documents print it a line each, and the Xero export fills its postal address.',
      'Use the Confirmation of sale button for a printable confirmation. Tick the signing box to put your own signature on it as the seller, then print or save it as a PDF to send.',
      'Loads recorded against the contract count as delivered. The Sales tab shows what is still to go.',
    ],
    tips: [
      'At a new season, use Bring in contracts on Sales to carry unfinished contracts across.',
    ],
  },
  {
    id: 'invoices', title: 'Invoices and the buyer\'s RCTI', roles: OFFICE, open: 'sales', openLabel: 'Open Sales',
    blurb: 'Invoice a contract, then check it against the buyer\'s own paperwork.',
    steps: [
      'Open a contract and tap Invoices, then New invoice.',
      'Tick the loads to include. Add a manual tonnage line or custom items (a premium or a deduction) if needed.',
      'The totals are worked out and can be adjusted to match a broker\'s rounding. Create the invoice, then Print / Save as PDF. Tick the signing box first if you want it signed.',
      'Mark it paid when the money arrives.',
      'Under the invoice, enter the buyer\'s RCTI number and total. It says Agrees, or shows how far apart the two are; the list flags a difference.',
      'If they differ, tap Make an adjustment note for the difference. The invoice stays as it was sent; the note (AN-1, AN-2 and so on) says what changed and why, names the invoice, and prints on its own page.',
    ],
    tips: [
      'The RCTI check is for you and is not printed on the invoice.',
      'An adjustment note counts in what the buyer owes: a credit takes its amount off, an extra charge adds it. Mark the note settled when the books are squared, for instance when the buyer pays the invoice less the credit.',
      'Untick "GST applies" on a note for a levy or freight difference, which carry no GST.',
      'Editing an invoice changes it in place and keeps its number.',
      'The payment details on an invoice are only printed for the owner and the bookkeeper. A manager prints an invoice without them.',
    ],
  },
  {
    id: 'orders', title: 'Orders, deliveries and bills', roles: OFFICE, open: 'sales', openLabel: 'Open Sales',
    blurb: 'What is still to deliver, and what is owed.',
    steps: [
      'Grain orders: the buyer\'s orders against a contract, with a date to deliver by and what is left.',
      'Delivery timeline: contracts with tonnes still to deliver and how close their delivery period is to ending.',
      'Receivables and payables: invoices you are owed and the bills you owe. Bills (brokerage, freight, storage) are entered by the owner, manager or bookkeeper.',
      'On Receivables and payables, By month shows when the money lands: what is invoiced, what is expected from grain not yet invoiced (a forecast, in italics), and the bills going out, with a running balance. MTM lists each buyer: what they owe now (with anything overdue), invoices due by week, grain delivered but not invoiced, the grain still to go and how the contracts sit against your MTM prices, with a PDF of it and a Send statement button for each buyer.',
      'Freight orders: the trucks booked to move a contract\'s grain. A freight order can be signed with your own signature before it is sent to the carrier.',
    ],
    tips: [
      'The forecast is only as good as the delivery pattern on each contract. A contract with none set is treated as called by the buyer, so its grain shows as Not yet scheduled.',
    ],
  },
  {
    id: 'spray', title: 'Spray requests', roles: ['owner', 'manager'], open: 'production', openLabel: 'Open Production',
    blurb: 'A spray form and a map for the contractor.',
    steps: [
      'On the farm map, tick the paddocks to spray, then choose Spray request. Or start one from Production.',
      'Fill in the product and rate, dates and conditions, and the contact and access notes.',
      'Choose the form to send it on and send it as a PDF. The map showing the paddocks is the last page.',
    ],
    tips: [
      'The owner can switch on Aircair\'s own form in Settings, under Farm.',
    ],
  },
  {
    id: 'inputs', title: 'Inputs and stock', roles: [...OFFICE, 'farm_worker'], open: 'production', openLabel: 'Open Production',
    blurb: 'Seed, fertiliser, fuel and chemical on hand.',
    steps: [
      'On Production, open Inputs and stock.',
      'Record what you buy, what you use, and counts that adjust the stock. Say which shed or silo it is in.',
      'Stock is added up across all seasons, and compared with what the paddock plans need.',
    ],
    tips: [
      'A farm worker sees what is on hand and records what is used and counts. They are never sent prices, suppliers or invoice numbers, and cannot record a delivery.',
    ],
  },
  {
    id: 'attention', title: 'Needs attention', roles: OFFICE, open: 'position', openLabel: 'Open Position',
    blurb: 'The short list at the top of Position: what to look at today.',
    steps: [
      'Open Position. If anything needs you, a Needs attention card sits at the top, worst first.',
      'Each line says what and how much: invoices or bills overdue, contracts past their end with grain still to go, orders that missed their date, and grain delivered but not yet invoiced.',
      'Tap a line to open the screen that deals with it (Receivables and payables, Delivery timeline, or Settings).',
      'A line goes when the thing is fixed. With nothing to do, the card is not shown.',
    ],
    tips: [
      'It reads what the app already knows. Nothing is entered here.',
    ],
  },
  {
    id: 'signing', title: 'Signing documents', roles: OFFICE, open: 'settings', openLabel: 'Open Settings',
    blurb: 'Your own signature on confirmations, invoices, freight orders and vendor declarations.',
    steps: [
      'In Settings, open My signature and draw it with a finger or a pen. Type the name to print under it.',
      'On a confirmation of sale, an invoice or a freight order, tick the box that signs it. Your signature goes on it with the date.',
      'Print or send the document as usual.',
    ],
    tips: [
      'A signature belongs to the person. Nobody else on the farm can see or use yours, and it works on any farm you work on.',
      'It is kept on the phone too, so you can sign without signal.',
    ],
  },
  {
    id: 'safety', title: 'Backups and keeping data safe', roles: OFFICE, open: 'settings', openLabel: 'Open Settings',
    blurb: 'How to keep a copy, and who can see what.',
    steps: [
      'In Settings, Export backup saves the whole farm to a file. Do it now and then, and keep the file somewhere other than the phone.',
      'Settings shows when the last backup was made, and Position adds a line to Needs attention when one is due.',
      'Import backup puts a backup back. Export CSV gives spreadsheets.',
      'Recently deleted (owner and manager) brings back something removed by mistake.',
    ],
    tips: [
      'Bank details are held apart from the rest of the farm. Only the owner and the bookkeeper can read them, and only the owner can change them.',
    ],
  },
  {
    id: 'help', title: 'Getting help', roles: ALL, open: 'account', openLabel: 'Open Account',
    blurb: 'Tell us what went wrong, and let support look if it needs it.',
    steps: [
      'On Account (or Settings), tap Report a problem. Say what happened and what you were doing, then Send.',
      'The report carries the app build, your role, whether you are online, what is waiting to send and the last few errors. None of the farm\'s records are sent.',
      'If it cannot be sent, tap Copy instead and send the text another way.',
      'The owner can also let support look at the farm for 7 days, read only, from Support access in Settings. It switches itself off, the owner can take it away sooner, and the log shows when support looked.',
    ],
    tips: [
      'Support cannot change anything and cannot see the bank details.',
    ],
  },
  {
    id: 'season', title: 'Starting a new season', roles: ['owner', 'manager'], open: 'settings', openLabel: 'Open Settings',
    blurb: 'Carry the farm over and keep the old season\'s records.',
    steps: [
      'In Settings, tap Start new year and enter the label, such as 2027.',
      'Paddocks (with their outlines), silos and commodities carry over. Yields, contracts, loads and overheads start empty.',
      'The old season is kept and can be viewed from the Viewing box in Settings.',
      'On Sales, use Bring in contracts to carry across contracts that still have grain to deliver.',
    ],
    tips: [
      'A paddock you will not farm this season can be removed from the new one. The old season keeps it.',
      'Records from before the app can be brought in as past seasons: in Settings, Import past seasons (CSV). Each row is a paddock in a season with its crop, hectares and yield. Paddocks are matched to your current names so the rotation and yield history lines up.',
      'Past contracts can come in the same way: Settings, Import past sales (CSV), with a row for each contract (season, crop, tonnes, price, and optionally buyer, contract number, freight, levies and tonnes delivered). Import the season\'s paddocks first, then its contracts, and switching to that season shows what was grown, what was sold and what was left unsold. A season that already has contracts is left alone.',
      'Averages by commodity (Production, owners, managers and bookkeepers) shows the average yield and average sale price of each crop over the seasons you tick, with the season-by-season figures underneath and an Excel download. Yield is total tonnes over total hectares, so bigger paddocks count for more; price is weighted by tonnes sold, as the contract price and as what is left after freight and levies.',
      'When earlier seasons name a paddock differently from now, Settings, Line up paddock names (CSV) lines them up: a row for each change (old name, new name, and optionally the farm, a share for a split, and which seasons). A paddock that is now several is split by area, several that are now one are joined, and a paddock with loads is never split. Back up first. The same sheet can then copy the farm map to the earlier seasons, so a past season shows its map coloured by that year’s crops.',
    ],
  },
  {
    id: 'people', title: 'Inviting people', roles: ['owner'], open: 'settings', openLabel: 'Open Settings',
    blurb: 'Give someone their own login, with only what they need.',
    steps: [
      'In Settings, find People and enter their email address.',
      'Choose what they can do: owner, farm manager, bookkeeper, farm worker or driver (see Who can do what, below).',
      'Send them the invitation link. It stops working after 14 days, and you can send it again or withdraw it.',
      'For a worker or driver you can also allow them to record production.',
    ],
    tips: [
      'You cannot change or remove yourself, so there is always an owner.',
      'Bank details are kept in a table that only the owner and the bookkeeper can read, so a manager, worker or driver is never sent them.',
    ],
  },
  {
    id: 'install', title: 'Putting Commodity Mate on your phone', roles: ALL, open: 'account', openLabel: 'Open Account',
    blurb: 'Add it to the home screen so it opens like any other app.',
    steps: [
      'iPhone: open Commodity Mate in Safari, tap the Share button, then Add to Home Screen, then Add.',
      'Android: open Commodity Mate in Chrome, tap the menu (three dots), then Install app or Add to Home screen.',
      'Open it from the new icon. It fills the screen, opens faster and works the same with no signal.',
      'On Account, This device says whether it is installed and whether the phone has promised to keep what is saved on it. If it has not, tap Keep my saved data.',
    ],
    tips: [
      'Everything you enter is saved on the phone first and sent when there is signal. A phone that runs short of space can clear a website\'s saved data, and an app on the home screen is much less likely to be cleared.',
      'Sign in once on the installed copy. It is the same farm and the same login.',
    ],
  },
  {
    id: 'offline', title: 'Working without signal', roles: ALL, open: '', openLabel: '',
    blurb: 'The app is built for the paddock.',
    steps: [
      'Everything you enter is saved on the device first. It works without signal.',
      'The dot beside the season is white when everything has been sent, and amber when you are offline or changes are waiting.',
      'When you are back in range, or open the app again, the waiting changes are sent. Nothing is lost by closing the app.',
    ],
    tips: [
      'After an update, reload the app twice so the newest version is the one on the screen.',
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
