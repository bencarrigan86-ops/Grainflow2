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
import { ringsAreaHa, simplifyRing } from '../docs/js/farmmap.js';
import { invoiceLineItems, invoiceTotals } from '../docs/js/derived.js';
import { ginPrepaid, cleanGin, allocateLint, ginInvoice, contractShare } from '../docs/js/ginning.js';
import { sprayDefaults } from '../docs/js/spray.js';

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

// Cotton is counted in bales, with its seed and ginning settings; hay is sold in tonnes and counted in bales as well. Wheat
// straw is baled behind the header on the wheat paddocks: its own commodity, on the same ground as the crop.
commodities.push(
  { id: 'cotton', name: 'Cotton', unit: 'bale', angleOfRepose: 0, testWeight: 0, nPerTonne: 0, mtmPrice: 565, targetYieldTHa: 11, defaultYieldTHa: 10.5, grossMarginCost: 640000,
    cotton: { seedMtm: 480, seedFactor: 0.245, ginRate: 75, levies: 3.75, turnout: 43, moduleKg: 2400 },
    balesPerRoundBale: 0, openingStock: 0, retainedSeed: 0, notes: '' },
  { id: 'lucerne', name: 'Lucerne hay', unit: 't', angleOfRepose: 35, testWeight: 0.14, nPerTonne: 0, mtmPrice: 410, targetYieldTHa: 9, defaultYieldTHa: 9, grossMarginCost: 38000,
    hay: { baleType: 'round', baleKg: 480 }, balesPerRoundBale: 0, openingStock: 0, retainedSeed: 0, notes: '' },
  { id: 'wheatstraw', name: 'Wheat straw', unit: 't', angleOfRepose: 35, testWeight: 0.1, nPerTonne: 0, mtmPrice: 82, targetYieldTHa: 0, defaultYieldTHa: 0, grossMarginCost: 0,
    hay: { baleType: 'large', baleKg: 520 }, balesPerRoundBale: 0, openingStock: 0, retainedSeed: 0, notes: '' },
);

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

// Cotton and lucerne paddocks, on an estimated yield (bales a hectare for cotton, tonnes for hay). Their own random draws
// are not used, so the grain paddocks above come out exactly as they did.
for (const [id, name, areaHa, commodityId, yieldTHa, seedVariety, seedRateKgHa] of [
  ['fld-cotton1', 'Cotton North', 150, 'cotton', 10.8, 'Sicot 746B3F', 12],
  ['fld-cotton2', 'Cotton South', 118, 'cotton', 10.2, 'Sicot 746B3F', 12],
  ['fld-lucerne', 'Lucerne Flat', 42, 'lucerne', 9, 'SARDI 7', 15],
]) {
  fields.push({
    id, name, areaHa, commodityId, yieldTHa, yieldMode: 'estimate', soilTestNKgHa: 0, ureaRequiredKgHa: 0, ureaApplications: [],
    seedVariety, seedRateKgHa, starterRequiredKgHa: 0, starterAppliedKgHa: 0, targetYieldOverrideTHa: 0, notes: '',
  });
}

// ---------------------------------------------------------------------------
// The farm map. Every paddock gets an outline of exactly its area, laid out on
// two invented properties so the Farms list and the farm names have something
// to show. Rows of paddocks with a lane between them; each corner nudged so
// they do not look drawn with a ruler. The place is made up too: open country
// with nothing real near it.
// ---------------------------------------------------------------------------

const MAP_LAT = -33.6;
const MAP_LON = 148.05;
const M_LAT = 1 / 110574;                                        // degrees of latitude in a metre
const M_LON = 1 / (111320 * Math.cos((MAP_LAT * Math.PI) / 180));
const LANE = 26;                                                  // metres between paddocks

// [property, x of its west edge in metres, rows of [paddock ids] with the row's depth in metres]
const PROPERTIES = [
  ['Home Farm', 0, [
    [1250, ['fld-boundary', 'fld-long']],
    [1100, ['fld-airstrip', 'fld-stony', 'fld-woolshed']],
    [900, ['fld-homestead', 'fld-siloblock']],
  ]],
  ['River Flats', 4600, [
    [1100, ['fld-river', 'fld-backcreek']],
    [1000, ['fld-dam', 'fld-ironbark', 'fld-bore']],
    [950, ['fld-cotton1', 'fld-cotton2', 'fld-lucerne']],
  ]],
];

// its own generator, so drawing the map does not move any number elsewhere in the sample farm
let mapSeed = 77031;
const mapRnd = () => { mapSeed = (mapSeed * 1103515245 + 12345) & 0x7fffffff; return mapSeed / 0x7fffffff; };

function outlineOf(areaHa, x, y, w, h) {
  const jig = () => (mapRnd() * 2 - 1) * 9;
  const pts = [[x, y], [x + w * 0.5, y + jig() * 0.6], [x + w, y], [x + w, y + h], [x + w * 0.5, y + h + jig() * 0.6], [x, y + h]]
    .map(([px, py]) => [px + jig(), py + jig()]);
  const ring = [...pts, pts[0]].map(([px, py]) => [MAP_LON + px * M_LON, MAP_LAT - py * M_LAT]);   // y runs south
  // scaled about its middle until it is exactly the paddock's area, so the map and the typed area agree
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = Math.sqrt(areaHa / ringsAreaHa([ring]));
  return simplifyRing(ring.map(([lon, lat]) => [cx + (lon - cx) * k, cy + (lat - cy) * k]));
}

for (const [property, x0, rows] of PROPERTIES) {
  let y = 0;
  for (const [depth, ids] of rows) {
    let x = x0;
    for (const id of ids) {
      const f = fields.find((q) => q.id === id);
      // the paddock itself is the row's depth less a lane, as wide as its area needs; the lane is then added for the next one
      const width = (f.areaHa * 10000) / (depth - LANE);
      f.boundary = [outlineOf(f.areaHa, x + LANE / 2, y + LANE / 2, width, depth - LANE)];
      f.property = property;
      x += width + LANE;
    }
    y += depth;
  }
}

const tonsOf = (f) => round(f.areaHa * f.yieldTHa, 2);

// ---------------------------------------------------------------------------
// Storage. Four silos and two bunkers, deliberately at different fill states so
// the Storage screen shows all three volume formulas rather than one.
// ---------------------------------------------------------------------------

const storages = [
  { id: 'silo-a', kind: 'silo',   name: 'Silo A',      commodityId: 'wheat',
    radius: 4.6, coneAngle: 35, currentHeight: 9.2, fillState: 'peak',   capacityTons: 620 },
  { id: 'silo-b', kind: 'silo',   name: 'Silo B',      commodityId: 'wheat',
    radius: 4.6, coneAngle: 35, currentHeight: 9.6, fillState: 'flat',   capacityTons: 620 },
  { id: 'silo-c', kind: 'silo',   name: 'Silo C',      commodityId: 'barley',
    radius: 3.8, coneAngle: 35, currentHeight: 10.2, fillState: 'decline', capacityTons: 410 },
  { id: 'silo-d', kind: 'silo',   name: 'Silo D',      commodityId: 'canola',
    radius: 3.2, coneAngle: 35, currentHeight: 7.6, fillState: 'peak',   capacityTons: 265 },
  { id: 'bunker-1', kind: 'bunker', name: 'Bunker 1',  commodityId: 'wheat',
    width: 14, length: 30, currentHeight: 4.1, fillState: 'peak', capacityTons: 2400, tarpOverhangM: 1.5 },
  { id: 'bunker-2', kind: 'bunker', name: 'Bunker 2',  commodityId: 'barley',
    width: 20, length: 48, currentHeight: 3.4, fillState: 'flat', capacityTons: 1500, tarpOverhangM: 1.5 },
].map((s) => ({ openingStock: 0, unitLabel: 't', ...s }));
storages.push(
  { id: 'gin-yard', kind: 'tally', name: 'Bimbi gin yard', commodityId: 'cotton', unitLabel: 'modules', openingStock: 0 },
  { id: 'bale-shed', kind: 'tally', name: 'Bale shed', commodityId: 'cotton', unitLabel: 'bales', openingStock: 0 },
  { id: 'hay-shed-1', kind: 'bunker', name: 'Hay shed 1', commodityId: 'lucerne', width: 14, length: 28, currentHeight: 4, fillState: 'flat', capacityTons: 150, tarpOverhangM: 0, openingStock: 0, unitLabel: 't' },
  { id: 'hay-shed-2', kind: 'bunker', name: 'Hay shed 2', commodityId: 'wheatstraw', width: 14, length: 28, currentHeight: 4.6, fillState: 'flat', capacityTons: 130, tarpOverhangM: 0, openingStock: 0, unitLabel: 't' },
);

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
  premiumDiscount: 0, ginning: 0, paymentTermsDays: 30, tolerancePct: 5,
  toleranceCapTons: 20, brokerNote: '', buyerAbn: '', buyerAddress: '', notes: '',
  tonsDelivered: 0, deliveryPeriod: '', ...s,
}));

sales.push(...[
  { id: 'sale-ct1', commodityId: 'cotton', buyer: 'Wattle Cotton Merchants', contractNo: 'WCM-2610', grade: '', tons: 600, price: 570, date: '2025-10-30',
    location: 'Delivered gin', deliveryStart: '2026-04-01', deliveryEnd: '2026-09-30', freight: 0, leviesPct: 0, deliveryPattern: 'ginrun', tolerancePct: 0, toleranceCapTons: 1 },
  { id: 'sale-ct2', commodityId: 'cotton', buyer: 'Wattle Cotton Merchants', contractNo: 'WCM-2611', grade: '', tons: 500, price: 585, date: '2025-11-12',
    location: 'Delivered gin', deliveryStart: '2026-04-01', deliveryEnd: '2026-09-30', freight: 0, leviesPct: 0, deliveryPattern: 'ginrun', tolerancePct: 0, toleranceCapTons: 1 },
  { id: 'sale-hay1', commodityId: 'lucerne', buyer: 'Valley Stockfeeds', contractNo: 'VS-3310', grade: 'Premium', tons: 150, price: 395, date: '2026-09-20',
    location: 'Ex farm', deliveryStart: '2026-12-01', deliveryEnd: '2027-02-28', freight: 0, leviesPct: 0 },
  { id: 'sale-hay2', commodityId: 'wheatstraw', buyer: 'Hillcrest Dairy Co-op', contractNo: 'HD-0412', grade: '', tons: 80, price: 82, date: '2026-10-08',
    location: 'Ex farm', deliveryStart: '2026-12-01', deliveryEnd: '2027-01-31', freight: 0, leviesPct: 0 },
].map((s) => ({
  premiumDiscount: 0, ginning: 0, paymentTermsDays: 14, tolerancePct: 5,
  toleranceCapTons: 20, brokerNote: '', buyerAbn: '', buyerAddress: '', notes: '',
  tonsDelivered: 0, deliveryPeriod: '', ...s,
})));

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
for (const f of fields.filter((q) => STORE_FOR[q.commodityId])) {
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
// Size the grain stores to what is in them. The harvest and the deliveries above decide the tonnes in each silo and bunker;
// the geometry and the typed capacity are then worked out from that, so no store reads over capacity and the measured tonnes
// (from the silo or bunker size) agree with the tracked tonnes. A silo keeps its grain height and fill shape and gets the
// radius that holds the stock; a bunker keeps its width and gets the filled length; the capacity is the stock over how full
// the store is meant to look.
// ---------------------------------------------------------------------------

const D2R = Math.PI / 180;
const FILL = { 'silo-a': 0.86, 'silo-b': 0.78, 'silo-c': 0.72, 'silo-d': 0.9, 'bunker-1': 0.55, 'bunker-2': 0.7 };
for (const s of storages.filter((q) => FILL[q.id])) {
  const net = (intoStore.get(s.id) || 0) - (outOfStore.get(s.id) || 0);
  const c = commodities.find((q) => q.id === s.commodityId);
  const vol = net / c.testWeight;
  const tanA = Math.tan(c.angleOfRepose * D2R);
  if (s.kind === 'silo') {
    const tanC = Math.tan(s.coneAngle * D2R);
    const sign = s.fillState === 'peak' ? 1 : s.fillState === 'decline' ? -1 : 0;
    const volAt = (r) => Math.PI * r * r * (s.currentHeight + (r / 3) * (tanC + sign * tanA));
    let lo = 1; let hi = 12;
    for (let i = 0; i < 40; i += 1) { const mid = (lo + hi) / 2; if (volAt(mid) < vol) lo = mid; else hi = mid; }
    s.radius = Math.round(((lo + hi) / 2) * 20) / 20;
  } else {
    s.length = round(vol / (0.25 * tanA * s.width * s.width) - (Math.PI / 6) * s.width + s.width, 0);
  }
  s.capacityTons = Math.round(net / FILL[s.id] / 10) * 10;
}

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


// ---------------------------------------------------------------------------
// Cotton and hay. Two more crops the sample farm grows, so the Modules report, the gin run, the cotton invoice, the bale
// logs and the hay stores all have something real in them. The same rules as the grain above: what was carted from a
// paddock is what arrived in the yard, what was ginned left the yard, and what a contract was delivered is on its
// invoice. The cotton and hay figures come out of the app's own functions where there is one (the gin invoice, the
// invoice lines and totals), so the sample agrees with the screens.
// ---------------------------------------------------------------------------

const r3 = (v) => Math.round(v * 1000) / 1000;
const STD = 227;

// --- cotton: modules picked, carted to a gin yard, ginned and sold in bales ---
const cottonPickedNorth = [
  { id: 'pk-n1', date: '2026-04-06', count: 130, kg: 312000, turnoutPct: 43, estBales: r3((312000 * 0.43) / STD) },
  { id: 'pk-n2', date: '2026-04-11', count: 170, kg: 408000, turnoutPct: 43, estBales: r3((408000 * 0.43) / STD) },
  { id: 'pk-n3', date: '2026-04-19', count: 60, kg: 144000, turnoutPct: 42, estBales: r3((144000 * 0.42) / STD) },
];
const cottonPickedSouth = [
  { id: 'pk-s1', date: '2026-04-14', count: 90, kg: 216000, turnoutPct: 43, estBales: r3((216000 * 0.43) / STD) },
  { id: 'pk-s2', date: '2026-04-22', count: 60, kg: 144000, turnoutPct: 43, estBales: r3((144000 * 0.43) / STD) },
];
fields.find((f) => f.id === 'fld-cotton1').modulesPicked = cottonPickedNorth;
fields.find((f) => f.id === 'fld-cotton2').modulesPicked = cottonPickedSouth;

const YARD = 'gin-yard';
// three weighed loads of 100 modules from Cotton North, and one estimated load of 40 from Cotton South still on its way
const cottonLoads = [
  ['fld-cotton1', '2026-04-23', 100, 238500, true],
  ['fld-cotton1', '2026-04-25', 100, 241200, true],
  ['fld-cotton1', '2026-04-27', 100, 236300, true],
  ['fld-cotton2', '2026-04-28', 40, 0, false],
];
for (const [fieldId, date, count, kg, final] of cottonLoads) {
  const useKg = kg || count * 2400;
  const estBales = r3((useKg * 0.43) / STD);
  movements.push({
    id: `mv-${ticket}`, ticketNo: ticket, date, commodityId: 'cotton', status: 'closed',
    truckRego: TRUCKS[ticket % TRUCKS.length], driver: DRIVERS[ticket % DRIVERS.length],
    tons: estBales, weightStatus: final ? 'final' : 'estimate',
    froms: [{ type: 'field', id: fieldId, tons: estBales }],
    tos: [{ type: 'silo', id: YARD, tons: count }],
    notes: 'Modules',
    modules: { count, kg, turnoutPct: 43, estBales },
  });
  ticket += 1;
}

// the run: 300 modules in, 1,340 bales out, to two contracts and to the bale shed
const run = {
  ginName: 'Bimbi Ginning', invoiceNo: 'I021/26', modules: 300, moduleKg: 716000, physicalBales: 1340, lintKg: 306000, seedKg: 331000,
  stdBaleKg: STD, baleFrom: 'KG100001', baleTo: 'KG101340', ginRate: 75, researchLevy: 2.25, voluntaryLevy: 1.5, gstOnGin: true, paidBy: 'buyer',
  allocations: [
    { to: 'sale:sale-ct1', baleFrom: 'KG100001', baleTo: 'KG100597', bales: 597, kg: 136000, location: '' },
    { to: 'sale:sale-ct2', baleFrom: 'KG100598', baleTo: 'KG101000', bales: 403, kg: 91500, location: '' },
    { to: 'silo:bale-shed', baleFrom: 'KG101001', baleTo: 'KG101340', bales: 340, kg: 78500, location: 'Shed bay 2' },
  ],
};
const ginRun = { ...cleanGin(run), payableId: 'pay-gin' };
const lots = allocateLint(ginRun);
const ginMovement = {
  id: `mv-${ticket}`, ticketNo: ticket, date: '2026-05-02', commodityId: 'cotton', status: 'closed',
  truckRego: '', driver: '', tons: r3(lots.reduce((s, a) => s + a.std, 0)), weightStatus: 'final',
  froms: [{ type: 'silo', id: YARD, tons: 300 }],
  tos: lots.map((a) => { const [type, ...rest] = a.to.split(':'); return { type, id: rest.join(':'), tons: r3(a.std) }; }),
  notes: 'Ginning', gin: ginRun,
};
movements.push(ginMovement);
ticket += 1;

// --- hay: lucerne baled in the paddock, stored, sold by the tonne, and used on the farm; wheat straw baled behind the header ---
const baled = (id, date, label, bales, baleKg, commodityId) => ({ id, date, label, bales, kg: bales * baleKg, ...(commodityId ? { commodityId } : {}) });
fields.find((f) => f.id === 'fld-lucerne').balesBaled = [
  baled('bb-l1', '2026-10-20', 'Cut 1', 260, 480), baled('bb-l2', '2026-11-25', 'Cut 2', 240, 480), baled('bb-l3', '2026-12-18', 'Cut 3', 220, 480),
];
fields.find((f) => f.id === 'fld-boundary').balesBaled = [baled('bb-w1', '2026-11-26', 'Behind the header', 160, 520, 'wheatstraw')];
fields.find((f) => f.id === 'fld-river').balesBaled = [baled('bb-w2', '2026-11-28', 'Behind the header', 120, 520, 'wheatstraw')];

const hayMove = (date, fromType, fromId, toLegs, commodityId, bales, baleKg, extra = {}) => {
  const tons = r3((bales * baleKg) / 1000);
  const m = {
    id: `mv-${ticket}`, ticketNo: ticket, date, commodityId, status: 'closed',
    truckRego: TRUCKS[ticket % TRUCKS.length], driver: DRIVERS[ticket % DRIVERS.length],
    tons, weightStatus: 'final',
    froms: [{ type: fromType, id: fromId, tons }],
    tos: toLegs.map((l) => ({ ...l, tons })),
    notes: '', hayLoad: { bales, kg: Math.round(tons * 1000), ...(extra.use ? { use: extra.use } : {}) },
  };
  movements.push(m);
  ticket += 1;
  return m;
};
for (const d of ['2026-10-24', '2026-10-26', '2026-11-28', '2026-11-30', '2026-12-02']) hayMove(d, 'field', 'fld-lucerne', [{ type: 'silo', id: 'hay-shed-1' }], 'lucerne', 80, 480);
const hayLoads = [
  hayMove('2026-12-08', 'silo', 'hay-shed-1', [{ type: 'sale', id: 'sale-hay1' }], 'lucerne', 60, 480),
  hayMove('2026-12-10', 'silo', 'hay-shed-1', [{ type: 'sale', id: 'sale-hay1' }], 'lucerne', 60, 480),
];
const fed = hayMove('2026-12-12', 'silo', 'hay-shed-1', [], 'lucerne', 40, 480, { use: 'Fed to cattle' });
for (const d of ['2026-11-29', '2026-12-01']) hayMove(d, 'field', 'fld-boundary', [{ type: 'silo', id: 'hay-shed-2' }], 'wheatstraw', 70, 520);
hayMove('2026-11-30', 'field', 'fld-river', [{ type: 'silo', id: 'hay-shed-2' }], 'wheatstraw', 100, 520);
const strawLoad = hayMove('2026-12-14', 'silo', 'hay-shed-2', [{ type: 'sale', id: 'sale-hay2' }], 'wheatstraw', 60, 520);
sales.find((s) => s.id === 'sale-hay1').tonsDelivered = r3(hayLoads.reduce((s, m) => s + m.tons, 0));
sales.find((s) => s.id === 'sale-hay2').tonsDelivered = strawLoad.tons;
sales.find((s) => s.id === 'sale-ct1').tonsDelivered = r3(lots[0].std);
sales.find((s) => s.id === 'sale-ct2').tonsDelivered = r3(lots[1].std);

// invoices, built by the app's own functions so the totals agree with what the screens work out
const buildInvoice = (base, sale, movs, extraLines = []) => {
  const lines = [...invoiceLineItems(sale, movs, {}), ...extraLines];
  const totals = invoiceTotals(sale, lines);
  const gin = totals.ginTotal || 0;
  return {
    ...base, saleId: sale.id,
    totalTons: round(lines.reduce((s, l) => s + (Number(l.tons) || 0), 0), 3),
    subtotalExGST: round(totals.subtotalExGST, 2), freightTotal: round(totals.freightTotal, 2), levies: round(totals.levies, 2),
    gst: round(totals.gst, 2), totalPayable: round(totals.subtotalExGST + totals.gst - totals.levies - totals.freightTotal - gin, 2),
    lines,
  };
};
const ctSale = sales.find((s) => s.id === 'sale-ct1');
const prepaid = ginPrepaid(ctSale, [ginMovement]).map((p) => ({
  date: p.date || ctSale.date, rego: '—', tons: null, movementId: null, rate: null, subtotal: 0, isGinPrepaid: true, ginRunId: p.movementId,
  description: `${p.ginName || 'Ginning'} invoice ${p.invoiceNo || ''}`.trim(), ginning: p.ginning, levies: p.levies, gst: p.gst, amount: p.total,
}));
const pdUsd = -1642.35;
const pdRate = 0.6609;
const pdAud = round(pdUsd / pdRate, 2);
invoices.push(buildInvoice({ id: 'inv-3', invoiceNo: 3, issueDate: '2026-05-08', dueDate: '2026-05-22', status: 'outstanding' }, ctSale, [ginMovement], [
  { date: ctSale.date, rego: 'Classing P&D', tons: null, movementId: null, rate: null, subtotal: pdAud, description: 'Classing premiums and discounts', isCustom: true, foreign: { usd: pdUsd, rate: pdRate } },
  ...prepaid,
]));
invoices.push(buildInvoice({ id: 'inv-4', invoiceNo: 4, issueDate: '2026-12-16', dueDate: '2027-01-15', status: 'outstanding' },
  sales.find((s) => s.id === 'sale-hay1'), hayLoads));

// Bills, inputs and a spray request, so Payables, Inputs and stock and Spray requests are not empty either.
const payables = [
  { id: 'pay-1', kind: 'brokerage', supplier: 'Sample Grain Brokers', reference: 'BR-0231', invoiceDate: '2026-12-19', dueDate: '2027-01-18', amount: 1824, gst: 182.4, saleId: 'sale-1', storageId: '', tons: '', rate: '', status: 'unpaid', paidDate: '', notes: '' },
  { id: 'pay-2', kind: 'freight', supplier: 'Ace Haulage', reference: 'AH-5530', invoiceDate: '2026-12-05', dueDate: '2026-12-19', amount: 1290, gst: 129, saleId: 'sale-1', storageId: '', tons: 60, rate: 21.5, status: 'paid', paidDate: '2026-12-17', notes: '' },
  { id: 'pay-3', kind: 'storage', supplier: 'Newbridge Storage Co', reference: 'NS-118', invoiceDate: '2026-12-10', dueDate: '2027-01-09', amount: 960, gst: 96, saleId: '', storageId: 'bunker-1', tons: 320, rate: 3, status: 'unpaid', paidDate: '', notes: 'Wheat, December' },
  // the gin's invoice, paid by the lint buyer and taken off the lint payment: marked paid when invoice 3 is
  (() => { const gi = ginInvoice(ginRun); const part = contractShare(ginRun); return { id: 'pay-gin', kind: 'other', supplier: ginRun.ginName, reference: ginRun.invoiceNo, invoiceDate: '2026-05-02', dueDate: '', amount: round(gi.exGst * part, 2), gst: round(gi.gst * part, 2), saleId: '', storageId: '', tons: round(gi.bales * part, 3), rate: ginRun.ginRate, status: 'unpaid', paidDate: '', payer: 'buyer', notes: 'Paid by the lint buyer and taken off the lint payment' }; })(),
  { id: 'pay-4', kind: 'other', supplier: 'Sample Ag Services', reference: 'AS-2204', invoiceDate: '2026-11-22', dueDate: '2026-12-22', amount: 540, gst: 54, saleId: '', storageId: '', tons: '', rate: '', status: 'unpaid', paidDate: '', notes: 'Weighbridge calibration' },
];
const inputStock = [
  { id: 'in-1', kind: 'seed', product: 'Scepter wheat', unit: 't', type: 'buy', qty: 14.7, unitCost: 640, date: '2026-05-02', supplier: 'Sample Seeds', reference: 'SS-8801', notes: '', location: 'Machinery shed' },
  { id: 'in-2', kind: 'seed', product: 'Scepter wheat', unit: 't', type: 'use', qty: 14.1, unitCost: '', date: '2026-05-20', supplier: '', reference: '', notes: 'Sown', location: 'Machinery shed' },
  { id: 'in-3', kind: 'fert', product: 'Urea', unit: 't', type: 'buy', qty: 75, unitCost: 690, date: '2026-04-28', supplier: 'Sample Ag Supplies', reference: 'AG-4417', notes: '', location: 'Fert shed' },
  { id: 'in-4', kind: 'fert', product: 'Urea', unit: 't', type: 'use', qty: 68, unitCost: '', date: '2026-06-02', supplier: '', reference: '', notes: 'Spread', location: 'Fert shed' },
  { id: 'in-5', kind: 'fert', product: 'Urea', unit: 't', type: 'adjust', qty: -0.5, unitCost: '', date: '2026-09-01', supplier: '', reference: '', notes: 'Stocktake', location: 'Fert shed' },
  { id: 'in-6', kind: 'fuel', product: 'Diesel', unit: 'L', type: 'buy', qty: 20000, unitCost: 1.78, date: '2026-05-10', supplier: 'Sample Fuels', reference: 'SF-3321', notes: '', location: 'Farm tank' },
  { id: 'in-7', kind: 'fuel', product: 'Diesel', unit: 'L', type: 'use', qty: 13400, unitCost: '', date: '2026-10-30', supplier: '', reference: '', notes: 'Season to date', location: 'Farm tank' },
  { id: 'in-8', kind: 'chem', product: 'Glyphosate 450', unit: 'L', type: 'buy', qty: 1200, unitCost: 6.2, date: '2026-07-06', supplier: 'Sample Ag Supplies', reference: 'AG-4630', notes: '', location: 'Chemical shed' },
  { id: 'in-9', kind: 'chem', product: 'Glyphosate 450', unit: 'L', type: 'use', qty: 900, unitCost: '', date: '2026-08-12', supplier: '', reference: '', notes: 'Fallow spray', location: 'Chemical shed' },
];
const sprayJobs = [(() => {
  const job = sprayDefaults({
    business: { entityName: 'Kurrajong Downs Pty Ltd', farmName: 'Kurrajong Downs', address: 'Sample address', contactName: 'Sample User' },
    paddocks: ['fld-boundary', 'fld-river', 'fld-long'].map((id) => { const f = fields.find((q) => q.id === id); return { id, name: f.name, areaHa: f.areaHa, crop: 'Wheat', farm: f.property }; }),
    today: '2026-08-10', jobs: [], form: 'standard',
  });
  return { id: 'spray-1', ...job, contractor: 'Sample Aerial Spraying', contractorEmail: '', status: 'sent', dateRequired: '2026-08-14',
    chemicals: [{ name: 'Glyphosate 450', rate: 1.5, unit: 'L' }], waterRate: 80 };
})()];

const SEASON = 'Sample 2026';

// ---------------------------------------------------------------------------
// Two earlier seasons, so the screens that need history have some: the rotation
// grid, yield and price averages, season comparison, the farm map by season.
// Same twelve paddocks, rotated; yields recorded at harvest; every contract
// delivered in full, as a farm's past seasons are. Their own generator and
// their own ids (a record id is a primary key, so 'wheat' cannot repeat across
// seasons), so adding them moves no number in the current season.
// ---------------------------------------------------------------------------

let histSeed = 4417;
const histRnd = () => { histSeed = (histSeed * 1103515245 + 12345) & 0x7fffffff; return histSeed / 0x7fffffff; };

// crop by paddock id, per season; a legume or canola ahead of wheat, wheat ahead of barley
const HISTORY = [
  { label: 'Sample 2025', year: 2025, yieldFactor: 0.92, priceFactor: 1.07, crops: {
    'fld-boundary': 'chickpeas', 'fld-river': 'canola', 'fld-long': 'barley', 'fld-airstrip': 'canola',
    'fld-stony': 'chickpeas', 'fld-woolshed': 'wheat', 'fld-backcreek': 'canola', 'fld-dam': 'wheat',
    'fld-ironbark': 'wheat', 'fld-bore': 'barley', 'fld-homestead': 'wheat', 'fld-siloblock': 'barley' },
  overheadFactor: 0.95 },
  { label: 'Sample 2024', year: 2024, yieldFactor: 1.06, priceFactor: 0.9, crops: {
    'fld-boundary': 'barley', 'fld-river': 'wheat', 'fld-long': 'canola', 'fld-airstrip': 'wheat',
    'fld-stony': 'wheat', 'fld-woolshed': 'canola', 'fld-backcreek': 'wheat', 'fld-dam': 'chickpeas',
    'fld-ironbark': 'barley', 'fld-bore': 'wheat', 'fld-homestead': 'chickpeas', 'fld-siloblock': 'wheat' },
  overheadFactor: 0.9 },
];
const BUYERS = {
  wheat: ['Riverina Grain Traders', 'Kurrajong Milling Co', 'Northbound Commodities'],
  barley: ['Coastal Feeds Pty Ltd', 'Riverina Grain Traders', 'Northbound Commodities'],
  chickpeas: ['Southern Pulse Exporters', 'Northbound Commodities', 'Southern Pulse Exporters'],
  canola: ['Meridian Oilseeds', 'Northbound Commodities', 'Meridian Oilseeds'],
};
const GRADE = { wheat: 'APW1', barley: 'BAR1', chickpeas: 'No.1 Chickpea', canola: 'CAN' };
const FREIGHT = { wheat: 21.5, barley: 0, chickpeas: 46, canola: 33 };
const SHARES = [0.4, 0.35, 0.25];

const pastSeason = (h) => {
  const tag = String(h.year);
  const used = [...new Set(Object.values(h.crops))];
  const pastCommodities = used.map((cid) => {
    const c = commodities.find((q) => q.id === cid);
    return { ...c, id: `${cid}-${tag}`, mtmPrice: 0 };
  });
  const pastFields = fields.filter((f) => h.crops[f.id]).map((f) => {
    const cid = h.crops[f.id];
    const c = commodities.find((q) => q.id === cid);
    const yieldTHa = round(c.defaultYieldTHa * h.yieldFactor * (0.9 + histRnd() * 0.2), 2);
    return {
      id: `${f.id}-${tag}`, name: f.name, areaHa: f.areaHa, commodityId: `${cid}-${tag}`,
      yieldTHa, yieldMode: 'recorded', soilTestNKgHa: 0, ureaRequiredKgHa: 0, ureaApplications: [],
      seedVariety: f.seedVariety && { wheat: 'Scepter', barley: 'Compass', chickpeas: 'Seamer', canola: 'Hyola 410XX' }[cid],
      seedRateKgHa: { wheat: 70, barley: 65, chickpeas: 90, canola: 3 }[cid],
      starterRequiredKgHa: 0, starterAppliedKgHa: 0, targetYieldOverrideTHa: 0, notes: '',
      boundary: f.boundary, property: f.property,
    };
  });
  const pastSales = [];
  for (const cid of used) {
    const c = commodities.find((q) => q.id === cid);
    const produced = pastFields.filter((f) => f.commodityId === `${cid}-${tag}`).reduce((s, f) => s + f.areaHa * f.yieldTHa, 0);
    const toSell = Math.floor(produced);
    let left = toSell;
    SHARES.forEach((share, i) => {
      const tons = i === SHARES.length - 1 ? left : Math.floor(toSell * share);
      left -= tons;
      if (tons <= 0) return;
      const price = Math.round(c.mtmPrice * h.priceFactor * (0.95 + histRnd() * 0.1));
      const month = [3, 6, 9][i];
      pastSales.push({
        id: `sale-${tag}-${cid}-${i + 1}`, commodityId: `${cid}-${tag}`, buyer: BUYERS[cid][i],
        contractNo: `${cid.slice(0, 2).toUpperCase()}-${h.year % 100}${String(pastSales.length + 11).padStart(2, '0')}`,
        grade: GRADE[cid], tons, price, date: `${h.year}-${String(month).padStart(2, '0')}-12`,
        location: FREIGHT[cid] ? 'Delivered buyer' : 'Ex farm',
        deliveryStart: `${h.year + 1}-01-05`, deliveryEnd: `${h.year + 1}-03-${i === 0 ? '15' : '28'}`,
        freight: FREIGHT[cid], leviesPct: 0.011,
        premiumDiscount: 0, ginning: 0, paymentTermsDays: 30, tolerancePct: 5,
        toleranceCapTons: 20, brokerNote: '', buyerAbn: '', buyerAddress: '', notes: '',
        tonsDelivered: tons, deliveryPeriod: '',
      });
    });
  }
  const scale = (n) => Math.round(n * h.overheadFactor / 1000) * 1000;
  const overheads = Object.fromEntries(Object.entries({
    finance: 186000, equipmentRepayments: 214000, depreciation: 168000,
    wages: 152000, drawings: 120000, admin: 34000, energy: 46000,
    insurance: 58000, repairsMaintenance: 96000, other: 22000,
  }).map(([k, v]) => [k, scale(v)]));
  return { commodities: pastCommodities, fields: pastFields, storages: [], sales: pastSales, movements: [], invoices: [], overheads };
};

// One grain order (the buyer's call on a contract) and the freight order that carts it, so Grain orders and Freight orders
// have something in them. The freight order is numbered from its contract, as the app does.
const orders = [
  { id: 'order-1', saleId: 'sale-1', orderNo: 'B-1001', tons: 300, deliverFrom: '2026-11-20', deliverBy: '2026-12-05',
    freightCompany: 'Ace Haulage', status: 'open', notes: 'Gate 3, 7am to 4pm. Call the receival site before loading.' },
];
const freightOrders = [
  { id: 'freight-1', saleId: 'sale-1', orderId: 'order-1', freightNo: 'RGT-4471-01', carrier: 'Ace Haulage', carrierEmail: '',
    tons: 300, rate: 21.5, rateBasis: 'per_t', flatRate: '', distanceKm: '',
    pickup: 'Kurrajong Downs, 12 Back Rd, Newbridge NSW 2810',
    pickupParts: { line1: '12 Back Rd', line2: 'Kurrajong Downs', town: 'Newbridge', state: 'NSW', postcode: '2810' },
    deliverTo: 'Newbridge Receival Site, 1 Rail Rd, Newbridge NSW 2810',
    deliverToParts: { line1: '1 Rail Rd', line2: 'Newbridge Receival Site', town: 'Newbridge', state: 'NSW', postcode: '2810' },
    loadFrom: '2026-11-20', loadBy: '2026-12-05', status: 'open', notes: 'Gate 3, 7am to 4pm.' },
];

const state = {
  version: 2,
  currentYear: SEASON,
  years: {
    [SEASON]: {
      commodities, fields, storages, sales, movements, invoices, orders, freightOrders, payables, inputStock, sprayJobs,
      overheads: {
        finance: 186000, equipmentRepayments: 214000, depreciation: 168000,
        wages: 152000, drawings: 120000, admin: 34000, energy: 46000,
        insurance: 58000, repairsMaintenance: 96000, other: 22000,
      },
    },
    ...Object.fromEntries(HISTORY.map((h) => [h.label, pastSeason(h)])),
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
  nextInvoiceNo: 5,
};

mkdirSync(join(ROOT, 'docs', 'demo'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'demo', 'seed.json'), `${JSON.stringify(state, null, 2)}\n`);

const ha = fields.reduce((s, f) => s + f.areaHa, 0);
const t = fields.reduce((s, f) => s + tonsOf(f), 0);
console.log(`docs/demo/seed.json — ${fields.length} paddocks, ${ha} ha, ${round(t, 0)} t produced`);
console.log(`  ${commodities.length} commodities, ${storages.length} stores, ${sales.length} contracts, ${movements.length} movements`);
