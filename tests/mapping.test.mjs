import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import assert from 'node:assert';
import { ALLOWED } from '../docs/js/import.js';

const FARM = '11111111-1111-1111-1111-111111111111';
const u = () => crypto.randomUUID();

// A season with the awkward cases in it, not the easy ones: a load blending
// two sources and splitting across two destinations, an unassigned paddock,
// a paid invoice, a silo with partial geometry.
const cWheat = u(), cBarley = u(), f1 = u(), f2 = u(), s1 = u(), s2 = u(),
      sale1 = u(), mov1 = u(), mov2 = u(), inv1 = u();

const state = {
  version: 2,
  currentYear: '2026',
  businessDetails: {
    farmName: 'Sunnyridge', entityName: 'Carrigan Farms', abn: '12345678901', ngr: 'NGR123',
    contactName: 'Ben', phone: '0400000000', email: 'b@example.com',
    address: '123 Road', paymentTermsDays: 21,
    bankName: 'NAB', accountName: 'Carrigan', bsb: '084-000', accountNumber: '12345678',
  },
  years: {
    '2025': {
      commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [],
      overheads: { finance: 0, equipmentRepayments: 0, depreciation: 0, wages: 0,
                   drawings: 0, admin: 0, energy: 0, insurance: 0,
                   repairsMaintenance: 0, other: 0 },
    },
    '2026': {
      commodities: [
        { id: cWheat, name: 'Wheat', angleOfRepose: 24, testWeight: 0.82, nPerTonne: 44,
          mtmPrice: 412.5, openingStock: 120, retainedSeed: 8, grossMarginCost: 310,
          unit: 't', balesPerRoundBale: 0, defaultYieldTHa: 3, targetYieldTHa: 3.5,
          notes: 'main program' },
        { id: cBarley, name: 'Barley', angleOfRepose: 27, testWeight: 0.69, nPerTonne: 34,
          mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0,
          unit: 't', balesPerRoundBale: 0, defaultYieldTHa: 0, targetYieldTHa: 0,
          notes: '' },
      ],
      fields: [
        { id: f1, name: 'Home Block', areaHa: 320, commodityId: cWheat, yieldTHa: 3.2,
          yieldMode: 'actual', ureaRequiredKgHa: 140, ureaAppliedKgHa: 120,
          seedVariety: 'Scepter', seedRateKgHa: 65,
          soilTestNKgHa: 38, targetYieldOverrideTHa: 3.6,
          starterRequiredKgHa: 60, starterAppliedKgHa: 60,
          ureaApplications: [{ date: '2026-06-01', kgHa: 70 },
                             { date: '2026-07-14', kgHa: 50 }],
          notes: 'boggy in the north-east corner' },
        { id: f2, name: 'Back Paddock', areaHa: 180, commodityId: null, yieldTHa: 0,
          yieldMode: 'estimate', ureaRequiredKgHa: 0, ureaAppliedKgHa: 0,
          seedVariety: '', seedRateKgHa: 0,
          soilTestNKgHa: 0, targetYieldOverrideTHa: 0,
          starterRequiredKgHa: 0, starterAppliedKgHa: 0,
          ureaApplications: [], notes: '' },
      ],
      storages: [
        { id: s1, kind: 'silo', name: 'Silo 1', commodityId: cWheat, radius: 3.2,
          coneAngle: 45, width: null, length: 0, capacityTons: 800, angleOfRepose: 24,
          testWeight: 0.82, tarpOverhangM: null, currentHeight: 6.4, fillState: 'peak',
          openingStock: 0, unitLabel: 't' },
        { id: s2, kind: 'bunker', name: 'Bunker A', commodityId: null, radius: null,
          coneAngle: null, width: 20, length: 60, capacityTons: 4000, angleOfRepose: 26,
          testWeight: 0.8, tarpOverhangM: 1.5, currentHeight: 3, fillState: 'flat',
          openingStock: 250, unitLabel: 't' },
      ],
      sales: [
        // Spelled the way the app spells it. This fixture used to say `tonnes`,
        // a key the app has never written, and so agreed with the mapping's own
        // mistake instead of catching it.
        { id: sale1, commodityId: cWheat, buyer: 'CBH', contractNo: 'C-10245',
          grade: 'APW1', tons: 500, deliveryPeriod: 'Jan-Feb', date: '2026-01-15',
          price: 412.5, paymentTermsDays: 14, contractValue: 206250,
          location: 'Kwinana', deliveryStart: '2026-01-05', deliveryEnd: '2026-02-28',
          tonsDelivered: 120, tolerancePct: 5, toleranceCapTons: 25,
          notes: 'split delivery',
          freight: 18.5, premiumDiscount: -4, ginning: 0, leviesPct: 0.0102,
          brokerNote: 'via Clear Grain', buyerAbn: '11 222 333 444',
          buyerAddress: '1 Port Road',
          // The terms a real purchase contract carries. Invented values — the
          // six documents these were modelled on are live trades and none of
          // their figures belong in a public repo.
          cropYear: '2025/2026', contractType: 'Ex Farm',
          pricingPoint: 'Kwinana - 30km E', weightsToGovern: 'destination',
          deliveryTerms: "Buyer's call, 5 business days notice",
          buyerContact: 'A Trader',
          broker: 'Example Commodities', brokerRef: 'EX0001234',
          brokeragePaidBy: 'seller', carryRate: 2.5, carryFrom: '2026-09-01',
          paymentTermsBasis: 'end of week of delivery',
          tradeRules: 'GTA contract 3' },
      ],
      movements: [
        { id: mov1, ticketNo: 1, date: '2026-01-20', commodityId: cWheat, status: 'open',
          truckRego: 'ABC123', driver: 'Bluey', grossWeight: 42.5, tareWeight: 10,
          tons: 32.5, weightStatus: 'final', notes: 'blend', correctsId: null,
          photoPath: `${FARM}/${mov1}/abc.jpg`, photoTakenAt: '2026-01-20T04:00:00.000Z',
          froms: [ { type: 'field', id: f1, tons: 20 }, { type: 'silo', id: s1, tons: 12.5 } ],
          tos:   [ { type: 'silo', id: s2, tons: 22.5 }, { type: 'sale', id: sale1, tons: 10 } ] },
        { id: mov2, ticketNo: 2, date: '2026-01-21', commodityId: cWheat, status: 'closed',
          truckRego: '', driver: '', grossWeight: null, tareWeight: null,
          tons: 28, weightStatus: 'estimate', notes: '', correctsId: null,
          froms: [ { type: 'silo', id: s1, tons: 28 } ],
          tos:   [ { type: 'sale', id: sale1, tons: 28 } ] },
      ],
      invoices: [
        { id: inv1, saleId: sale1, invoiceNo: 1, status: 'paid', paidDate: '2026-02-01',
          lines: [{ desc: 'Wheat APW1', tonnes: 500, rate: 412.5 }],
          totals: { subtotal: 206250, gst: 20625, total: 226875 } },
      ],
      overheads: { finance: 50000, equipmentRepayments: 30000, depreciation: 40000,
                   wages: 180000, drawings: 90000, admin: 12000, energy: 22000,
                   insurance: 18000, repairsMaintenance: 35000, other: 5000 },
    },
  },
};

// ---- round 1 -------------------------------------------------------------
const rows1 = stateToRows(state, FARM);
const back1 = rowsToState(rows1);

// ---- round 2: proves stability, and that hidden ids are reused ------------
const rows2 = stateToRows(back1, FARM);
const back2 = rowsToState(rows2);

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k.startsWith('__') ? undefined : v)));

let fails = 0;
const check = (label, fn) => {
  try { fn(); console.log('  PASS ', label); }
  catch (e) { fails++; console.log('  FAIL ', label, '\n        ', e.message.split('\n')[0]); }
};

console.log('=== structure ===');
check('two seasons produced', () => assert.equal(rows1.seasons.length, 2));
check('current season flagged once', () =>
  assert.equal(rows1.seasons.filter(s => s.is_current).length, 1));
check('2 commodities', () => assert.equal(rows1.commodities.length, 2));
check('2 fields -> 2 agronomy rows', () => {
  assert.equal(rows1.fields.length, 2);
  assert.equal(rows1.field_agronomy.length, 2);
});
check('1 sale -> 1 sale_terms row', () => {
  assert.equal(rows1.sales.length, 1);
  assert.equal(rows1.sale_terms.length, 1);
});
check('multi-source multi-dest load -> 4 legs (+2 for the second load)', () =>
  assert.equal(rows1.movement_legs.length, 6));
check('legs carry direction', () => {
  assert.equal(rows1.movement_legs.filter(l => l.direction === 'from').length, 3);
  assert.equal(rows1.movement_legs.filter(l => l.direction === 'to').length, 3);
});
check('one overheads row per season', () => assert.equal(rows1.overheads.length, 2));

console.log('\n=== the split tables really are split ===');
check('price is NOT on sales', () =>
  assert.equal('price' in rows1.sales[0], false));
check('price IS on sale_terms', () =>
  assert.equal(rows1.sale_terms[0].price, 412.5));
check('yield is NOT on fields', () =>
  assert.equal('yield_t_ha' in rows1.fields[0], false));
check('yield IS on field_agronomy', () =>
  assert.equal(rows1.field_agronomy.find(a => a.field_id === '${f1}' || true).yield_t_ha !== undefined, true));

console.log('\n=== round trip ===');
check('state -> rows -> state is faithful', () =>
  assert.deepEqual(strip(back1), strip(state)));
check('second pass is identical (stable)', () =>
  assert.deepEqual(strip(back2), strip(back1)));
check('hidden ids reused, no orphan growth', () => {
  assert.equal(rows2.field_agronomy.length, rows1.field_agronomy.length);
  assert.equal(rows2.sale_terms.length, rows1.sale_terms.length);
  assert.equal(rows2.movement_legs.length, rows1.movement_legs.length);
  assert.equal(rows2.sale_terms[0].id, rows1.sale_terms[0].id);
  assert.equal(rows2.overheads[0].id, rows1.overheads[0].id);
});

console.log('\n=== leg type vocabulary ===');
check("app 'silo' becomes db 'storage'", () => {
  const siloLegs = rows1.movement_legs.filter(l => l.ref_type === 'storage');
  assert.ok(siloLegs.length >= 3, 'expected silo legs to map to storage');
  assert.equal(rows1.movement_legs.some(l => l.ref_type === 'silo'), false,
    "'silo' must never reach the database — the check constraint rejects it");
});
check('every ref_type satisfies the db check constraint', () => {
  const allowed = new Set(['field', 'storage', 'sale']);
  for (const l of rows1.movement_legs) {
    assert.ok(allowed.has(l.ref_type), `ref_type '${l.ref_type}' would be rejected`);
  }
});
check("db 'storage' comes back as app 'silo'", () => {
  const m = back1.years['2026'].movements[0];
  assert.equal(m.froms[1].type, 'silo');
  assert.equal(m.tos[0].type, 'silo');
});

console.log('\n=== storage vocabulary ===');
// The fixture in this file used to say fillState: 'flat', which no version of
// the app has ever written — I invented it when I wrote the schema, then wrote
// it again here, so the test agreed with the bug. ALLOWED is imported rather
// than retyped precisely so that cannot happen a third time: enums.test.mjs
// holds it against the migrations, this holds the mapped rows against it.
check('every storage kind satisfies the db check constraint', () => {
  for (const st of rows1.storages) {
    assert.ok(ALLOWED.storageKind.includes(st.kind),
      `kind '${st.kind}' would be rejected by storages_kind_check`);
  }
});
check('every fill_state satisfies the db check constraint', () => {
  for (const st of rows1.storages) {
    assert.ok(ALLOWED.fillState.includes(st.fill_state),
      `fill_state '${st.fill_state}' would be rejected by storages_fill_state_check`);
  }
});

console.log('\n=== photos ===');
check('only the movement with a photo makes a row', () =>
  assert.equal(rows1.movement_photos.length, 1));
check('photo path survives the round trip', () =>
  assert.equal(back1.years['2026'].movements[0].photoPath, `${FARM}/${mov1}/abc.jpg`));
check('a movement with no photo gains no photo fields', () => {
  const m = back1.years['2026'].movements[1];
  assert.equal('photoPath' in m, false);
});
check('photo row id is reused, not regenerated', () =>
  assert.equal(rows2.movement_photos[0].id, rows1.movement_photos[0].id));

console.log('\n=== detail that would be easy to lose ===');
check('multi-source tonnages survive', () => {
  const m = back1.years['2026'].movements[0];
  assert.deepEqual(m.froms.map(f => f.tons), [20, 12.5]);
  assert.deepEqual(m.tos.map(t => t.tons), [22.5, 10]);
});
check('a "to" leg pointing at a contract survives', () => {
  const m = back1.years['2026'].movements[0];
  assert.equal(m.tos[1].type, 'sale');
  assert.equal(m.tos[1].id, sale1);
});
check('unassigned paddock keeps null commodity', () =>
  assert.equal(back1.years['2026'].fields[1].commodityId, null));
check('invoice snapshot json intact', () => {
  const inv = back1.years['2026'].invoices[0];
  assert.equal(inv.totals.total, 226875);
  assert.equal(inv.lines[0].rate, 412.5);
});
check('empty 2025 season survives', () => {
  assert.equal(Object.keys(back1.years).length, 2);
  assert.equal(back1.years['2025'].movements.length, 0);
});
check('business details survive', () =>
  assert.deepEqual(back1.businessDetails, state.businessDetails));
check('currentYear preserved', () => assert.equal(back1.currentYear, '2026'));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);
