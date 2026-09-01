#!/usr/bin/env node
//
// Build the sample farm a trial account starts with.
//
//   node tools/make-demo-seed.mjs        # writes docs/demo/seed.json
//
// A generator rather than a hand-written JSON file, for two reasons. The
// tonnages have to agree with each other — what came off a paddock has to be
// what went into a silo has to be what left against a contract — and keeping
// thirty movements consistent by hand through one edit is not realistic. And
// the whole thing is deterministic, so regenerating produces a byte-identical
// file and the repo does not churn on every run.
//
// EVERY VALUE HERE IS INVENTED. Not one figure, buyer, price or paddock name
// comes from a real farm, and there are no bank details at all — a prospect
// opening a trial must never be looking at somebody else's business, and the
// person handing the link out should not have to think about it. tests/demo
// .test.mjs enforces that rather than trusting this paragraph.
//
// The ids are deliberately short and readable — 'wheat', 'fld-boundary' — not
// UUIDs. remapIds() reissues every one of them on import and rewrites the
// references, so each trial farm gets its own set. Baking UUIDs in here would
// mean the second trial account collided with the first on the primary key.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A small deterministic PRNG, so "a bit of variation" does not mean "a
// different file every time anybody runs this".
let seed = 20260901;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const jitter = (base, pct) => round(base * (1 + (rnd() * 2 - 1) * pct), 2);
const round = (v, dp = 2) => Number(v.toFixed(dp));

// ---------------------------------------------------------------------------
// Commodities. The agronomy constants are ordinary industry figures — angle of
// repose, test weight, nitrogen per tonne — not anybody's settings.
// ---------------------------------------------------------------------------

const commodities = [
  { id: 'wheat', name: 'Wheat', angleOfRepose: 24, testWeight: 0.82, nPerTonne: 44,
    mtmPrice: 372, targetYieldTHa: 4.0, defaultYieldTHa: 3.8, grossMarginCost: 412000 },
  { id: 'barley', name: 'Barley', angleOfRepose: 27, testWeight: 0.69, nPerTonne: 34,
    mtmPrice: 318, targetYieldTHa: 4.4, defaultYieldTHa: 4.2, grossMarginCost: 168000 },
  { id: 'chickpeas', name: 'Chickpeas', angleOfRepose: 28, testWeight: 0.76, nPerTonne: 35,
    mtmPrice: 754, targetYieldTHa: 2.0, defaultYieldTHa: 1.9, grossMarginCost: 149000 },
  { id: 'canola', name: 'Canola', angleOfRepose: 26, testWeight: 0.67, nPerTonne: 0,
    mtmPrice: 812, targetYieldTHa: 2.2, defaultYieldTHa: 2.1, grossMarginCost: 141000 },
].map((c) => ({
  unit: 't', balesPerRoundBale: 0, openingStock: 0, retainedSeed: 0, notes: '', ...c,
}));

// ---------------------------------------------------------------------------
// Paddocks. Twelve, about 1,700 ha — a real farm's worth of country, and few
// enough to take in on a phone. A hundred rows is impressive and unreadable.
// ---------------------------------------------------------------------------

const FIELDS = [
  ['fld-boundary',   'Boundary',      210, 'wheat',     4.1],
  ['fld-river',      'River Block',   178, 'wheat',     4.4],
  ['fld-long',       'Long Paddock',  165, 'wheat',     3.7],
  ['fld-airstrip',   'Airstrip',      142, 'wheat',     3.9],
  ['fld-stony',      'Stony Rise',    118, 'wheat',     3.2],
  ['fld-woolshed',   'Woolshed',      155, 'barley',    4.6],
  ['fld-backcreek',  'Back Creek',    132, 'barley',    4.3],
  ['fld-dam',        'Dam Paddock',    96, 'barley',    4.0],
  ['fld-ironbark',   'Ironbark',      148, 'chickpeas', 2.1],
  ['fld-bore',       'Bore Paddock',  121, 'chickpeas', 1.8],
  ['fld-homestead',  'Homestead',     134, 'canola',    2.3],
  ['fld-siloblock',  'Silo Block',    108, 'canola',    2.0],
];

// Soil tests on some paddocks and not others, because that is what a farm
// actually looks like in September and it gives the Fert report something to
// show as well as something to be missing.
const fields = FIELDS.map(([id, name, areaHa, commodityId, yieldTHa], i) => {
  const hasSoilTest = i % 3 !== 2;
  const soilTestNKgHa = hasSoilTest ? Math.round(28 + rnd() * 26) : 0;
  const commodity = commodities.find((c) => c.id === commodityId);
  // Urea to make up the gap between what the soil carries and what the target
  // needs, at 46% N. The same arithmetic derived.js does, so the numbers on
  // screen agree with the ones in the file.
  const needed = commodity.nPerTonne * commodity.targetYieldTHa;
  const ureaRequiredKgHa = commodity.nPerTonne
    ? Math.max(0, Math.round((needed - soilTestNKgHa) / 0.46)) : 0;
  const applied = hasSoilTest ? Math.round(ureaRequiredKgHa * (i % 2 ? 1 : 0.85)) : 0;

  return {
    id, name, areaHa, commodityId,
    yieldTHa, yieldMode: 'actual',
    soilTestNKgHa,
    ureaRequiredKgHa,
    ureaApplications: applied
      ? [{ date: i % 2 ? '2026-05-18' : '2026-06-02', rateKgHa: applied, product: 'Urea' }]
      : [],
    seedVariety: { wheat: 'Scepter', barley: 'Compass', chickpeas: 'Seamer', canola: 'Hyola 410XX' }[commodityId],
    seedRateKgHa: { wheat: 70, barley: 65, chickpeas: 90, canola: 3 }[commodityId],
    starterRequiredKgHa: 60, starterAppliedKgHa: 60,
    targetYieldOverrideTHa: 0,
    notes: '',
  };
});

const tonsOf = (f) => round(f.areaHa * f.yieldTHa, 2);

// ---------------------------------------------------------------------------
// Storage. Four silos and two bunkers, deliberately at different fill states so
// the Storage screen shows all three volume formulas rather than one.
// ---------------------------------------------------------------------------

const storages = [
  { id: 'silo-a', kind: 'silo',   name: 'Silo A',      commodityId: 'wheat',
    radius: 4.6, coneAngle: 35, currentHeight: 9.2, fillState: 'peak',   capacityTons: 620 },
  { id: 'silo-b', kind: 'silo',   name: 'Silo B',      commodityId: 'wheat',
    radius: 4.6, coneAngle: 35, currentHeight: 6.1, fillState: 'flat',   capacityTons: 620 },
  { id: 'silo-c', kind: 'silo',   name: 'Silo C',      commodityId: 'barley',
    radius: 3.8, coneAngle: 35, currentHeight: 7.4, fillState: 'decline', capacityTons: 410 },
  { id: 'silo-d', kind: 'silo',   name: 'Silo D',      commodityId: 'canola',
    radius: 3.2, coneAngle: 35, currentHeight: 5.8, fillState: 'peak',   capacityTons: 265 },
  { id: 'bunker-1', kind: 'bunker', name: 'Bunker 1',  commodityId: 'wheat',
    width: 24, length: 62, currentHeight: 4.1, fillState: 'peak', capacityTons: 2400, tarpOverhangM: 1.5 },
  { id: 'bunker-2', kind: 'bunker', name: 'Bunker 2',  commodityId: 'barley',
    width: 20, length: 48, currentHeight: 3.4, fillState: 'flat', capacityTons: 1500, tarpOverhangM: 1.5 },
].map((s) => ({ openingStock: 0, unitLabel: 't', ...s }));

// ---------------------------------------------------------------------------
// Contracts. Invented buyers — no real trader's name appears anywhere. A mix of
// delivered, part-delivered and untouched, so Position has both a sold and an
// unsold side and Sales is not a wall of identical rows.
// ---------------------------------------------------------------------------

const sales = [
  { id: 'sale-1', commodityId: 'wheat', buyer: 'Riverina Grain Traders', contractNo: 'RGT-4471',
    grade: 'APW1', tons: 1200, price: 379, date: '2026-06-14', location: 'Delivered Newbridge',
    deliveryStart: '2026-11-01', deliveryEnd: '2026-12-20', freight: 21.5, leviesPct: 0.011 },
  { id: 'sale-2', commodityId: 'wheat', buyer: 'Kurrajong Milling Co', contractNo: 'KM-2208',
    grade: 'H2', tons: 800, price: 402, date: '2026-07-02', location: 'Delivered Millgate',
    deliveryStart: '2026-11-15', deliveryEnd: '2027-01-31', freight: 18.0, leviesPct: 0.011 },
  { id: 'sale-3', commodityId: 'barley', buyer: 'Coastal Feeds Pty Ltd', contractNo: 'CF-1094',
    grade: 'BAR1', tons: 900, price: 324, date: '2026-06-28', location: 'Ex farm',
    deliveryStart: '2026-11-01', deliveryEnd: '2026-12-31', freight: 0, leviesPct: 0.011 },
  { id: 'sale-4', commodityId: 'chickpeas', buyer: 'Southern Pulse Exporters', contractNo: 'SPE-0733',
    grade: 'No.1 Chickpea', tons: 400, price: 771, date: '2026-08-05', location: 'Delivered Port',
    deliveryStart: '2026-12-01', deliveryEnd: '2027-02-28', freight: 46.0, leviesPct: 0.011 },
  { id: 'sale-5', commodityId: 'canola', buyer: 'Meridian Oilseeds', contractNo: 'MO-5512',
    grade: 'CAN', tons: 350, price: 828, date: '2026-07-19', location: 'Delivered Crushplant',
    deliveryStart: '2026-11-20', deliveryEnd: '2027-01-15', freight: 33.0, leviesPct: 0.011 },
  { id: 'sale-6', commodityId: 'wheat', buyer: 'Northbound Commodities', contractNo: 'NBC-8820',
    grade: 'APW1', tons: 600, price: 368, date: '2026-08-22', location: 'Delivered Newbridge',
    deliveryStart: '2027-01-05', deliveryEnd: '2027-02-28', freight: 21.5, leviesPct: 0.011 },
].map((s) => ({
  premiumDiscount: 0, ginning: 0, paymentTermsDays: 30, tolerancePct: 0.05,
  toleranceCapTons: 0, brokerNote: '', buyerAbn: '', buyerAddress: '', notes: '',
  tonsDelivered: 0, deliveryPeriod: '', ...s,
}));

// ---------------------------------------------------------------------------
// Movements. Two kinds, and they have to add up: harvest carts a paddock into a
// silo or bunker, delivery carts a store out against a contract. Nothing is
// delivered that was never harvested, and no store goes negative — the numbers
// on the Storage and Position screens come out of these, so an inconsistency
// here is a demo that looks broken to the person you are trying to sell to.
// ---------------------------------------------------------------------------

const TRUCKS = ['ABC 42Q', 'XKR 17N', 'TDD 88Q', 'JRP 06N'];
const DRIVERS = ['Sample Driver', 'Sample Driver', 'Casual Carter', 'Casual Carter'];
const STORE_FOR = {
  wheat: ['silo-a', 'silo-b', 'bunker-1'],
  barley: ['silo-c', 'bunker-2'],
  chickpeas: ['bunker-2'],
  canola: ['silo-d'],
};

const movements = [];
let ticket = 1001;
const intoStore = new Map();          // store id -> tonnes carted in
const outOfStore = new Map();         // store id -> tonnes carted out
const add = (map, key, t) => map.set(key, round((map.get(key) || 0) + t, 2));

// Harvest: each paddock leaves in two or three loads, split across the stores
// that hold that commodity.
for (const f of fields) {
  const stores = STORE_FOR[f.commodityId];
  const total = tonsOf(f);
  const loads = 2 + (fields.indexOf(f) % 2);
  let left = total;
  for (let i = 0; i < loads; i += 1) {
    const tons = i === loads - 1 ? round(left, 2) : round(total / loads, 2);
    left = round(left - tons, 2);
    const store = stores[i % stores.length];
    add(intoStore, store, tons);
    movements.push({
      id: `mv-${ticket}`, ticketNo: ticket, date: `2026-11-${String(3 + (ticket % 22)).padStart(2, '0')}`,
      commodityId: f.commodityId, status: 'closed',
      truckRego: TRUCKS[ticket % TRUCKS.length], driver: DRIVERS[ticket % DRIVERS.length],
      tons, weightStatus: 'final',
      grossWeight: round(tons + 16.4, 2), tareWeight: 16.4,
      froms: [{ type: 'field', id: f.id, tons }],
      tos: [{ type: 'silo', id: store, tons }],
      notes: '',
    });
    ticket += 1;
  }
}

// Delivery: part of three contracts goes out, drawn from the stores that
// actually hold that commodity and never more than went in.
const DELIVERIES = [
  ['sale-1', 'wheat', 4],
  ['sale-3', 'barley', 3],
  ['sale-5', 'canola', 2],
];
for (const [saleId, commodityId, loads] of DELIVERIES) {
  const sale = sales.find((s) => s.id === saleId);
  const stores = STORE_FOR[commodityId];
  for (let i = 0; i < loads; i += 1) {
    const store = stores[i % stores.length];
    const available = round((intoStore.get(store) || 0) - (outOfStore.get(store) || 0), 2);
    const tons = round(Math.min(jitter(38, 0.12), available), 2);
    if (tons <= 0) continue;
    add(outOfStore, store, tons);
    sale.tonsDelivered = round(sale.tonsDelivered + tons, 2);
    movements.push({
      id: `mv-${ticket}`, ticketNo: ticket, date: `2026-12-${String(2 + (ticket % 20)).padStart(2, '0')}`,
      commodityId, status: 'closed',
      truckRego: TRUCKS[ticket % TRUCKS.length], driver: DRIVERS[ticket % DRIVERS.length],
      tons, weightStatus: 'final',
      grossWeight: round(tons + 16.4, 2), tareWeight: 16.4,
      froms: [{ type: 'silo', id: store, tons }],
      tos: [{ type: 'sale', id: saleId, tons }],
      notes: '',
    });
    ticket += 1;
  }
}

// ---------------------------------------------------------------------------

const invoices = [
  { id: 'inv-1', saleId: 'sale-1', invoiceNo: 1, issueDate: '2026-12-18',
    dueDate: '2027-01-17', status: 'outstanding' },
  { id: 'inv-2', saleId: 'sale-3', invoiceNo: 2, issueDate: '2026-12-20',
    dueDate: '2027-01-19', status: 'paid', paidDate: '2027-01-12' },
].map((inv) => {
  const sale = sales.find((s) => s.id === inv.saleId);
  const tons = sale.tonsDelivered;
  const subtotalExGST = round(tons * sale.price, 2);
  const freightTotal = round(tons * sale.freight, 2);
  const levies = round(subtotalExGST * sale.leviesPct, 2);
  const net = round(subtotalExGST - freightTotal - levies, 2);
  return {
    ...inv,
    totalTons: tons, subtotalExGST, freightTotal, levies,
    gst: round(net * 0.1, 2), totalPayable: round(net * 1.1, 2),
    lines: [{ description: `${sale.grade} ${sale.buyer}`, tons, price: sale.price }],
    totals: { subtotalExGST, freightTotal, levies },
  };
});

const SEASON = 'Sample 2026';

const state = {
  version: 2,
  currentYear: SEASON,
  years: {
    [SEASON]: {
      commodities, fields, storages, sales, movements, invoices,
      overheads: {
        finance: 186000, equipmentRepayments: 214000, depreciation: 168000,
        wages: 152000, drawings: 120000, admin: 34000, energy: 46000,
        insurance: 58000, repairsMaintenance: 96000, other: 22000,
      },
    },
  },
  businessDetails: {
    farmName: 'Kurrajong Downs',
    entityName: 'Kurrajong Downs Pty Ltd',
    abn: '00 000 000 000', ngr: 'SAMPLE01',
    contactName: 'Sample User', phone: '', email: '',
    address: 'Sample address',
    paymentTermsDays: 30,
    // Left empty on purpose, and the test asserts it stays that way. A sample
    // farm that ships with a BSB and an account number teaches whoever is
    // looking at it that this is a reasonable thing to hand around.
    bankName: '', accountName: '', bsb: '', accountNumber: '',
  },
  nextMovementNo: ticket,
  nextInvoiceNo: 3,
};

mkdirSync(join(ROOT, 'docs', 'demo'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'demo', 'seed.json'), `${JSON.stringify(state, null, 2)}\n`);

const ha = fields.reduce((s, f) => s + f.areaHa, 0);
const t = fields.reduce((s, f) => s + tonsOf(f), 0);
console.log(`docs/demo/seed.json — ${fields.length} paddocks, ${ha} ha, ${round(t, 0)} t produced`);
console.log(`  ${commodities.length} commodities, ${storages.length} stores, ${sales.length} contracts, ${movements.length} movements`);
