// Run with:
//   node tests/ticketmerge.test.mjs
//
// Two devices change the same ticket. Nothing either did is lost, and a real clash is
// reported rather than quietly decided.
import assert from 'node:assert/strict';
import { mergeTicket, plainOf, stampBase, reconcileTickets, describeMerges, valueText } from '../docs/js/ticketmerge.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const leg = (type, id, tons, __legId) => ({ type, id, tons, ...(__legId ? { __legId } : {}) });
const ticket = (extra = {}) => ({
  id: 'm1', ticketNo: 1043, date: '2026-11-12', commodityId: 'w', truckRego: 'TAMBO', driver: '', notes: '',
  tons: 32, weightStatus: 'estimate', grossWeight: null, tareWeight: null,
  froms: [leg('field', 'f1', 32, 'lf')], tos: [leg('silo', 'transit', 32, 'lt')], ...extra,
});

console.log('\n=== merging two changed copies ===');

await check('changes to different things are both kept', () => {
  const base = plainOf(ticket());
  const ours = plainOf(ticket({ tons: 31, weightStatus: 'final', froms: [leg('field', 'f1', 31, 'lf')], tos: [leg('silo', 'transit', 31, 'lt')] }));
  const theirs = plainOf(ticket({ grade: 'APH1', proteinPct: 11.8 }));
  const m = mergeTicket(base, ours, theirs);
  assert.equal(m.values.tons, 31);
  assert.equal(m.values.weightStatus, 'final');
  assert.equal(m.values.grade, 'APH1');
  assert.equal(m.values.proteinPct, 11.8);
  assert.deepEqual(m.fromTheirs.sort(), ['grade', 'proteinPct']);
  assert.deepEqual(m.conflicts, []);
});
await check('a change on this device alone is not a merge at all', () => {
  const base = plainOf(ticket());
  const m = mergeTicket(base, plainOf(ticket({ notes: 'wet patch' })), base);
  assert.equal(m.changed, false);
  assert.equal(m.values.notes, 'wet patch');
});
await check('a change on the other device alone is taken', () => {
  const base = plainOf(ticket());
  const m = mergeTicket(base, base, plainOf(ticket({ driver: 'Sam' })));
  assert.equal(m.values.driver, 'Sam');
  assert.deepEqual(m.fromTheirs, ['driver']);
});
await check('both changing the same field to the same thing is not a clash', () => {
  const base = plainOf(ticket());
  const same = plainOf(ticket({ grade: 'APH1' }));
  const m = mergeTicket(base, same, same);
  assert.deepEqual(m.conflicts, []);
  assert.equal(m.changed, false);
});
await check('both changing the same field differently is a clash: this device\'s is kept, and both values are reported', () => {
  const base = plainOf(ticket());
  const m = mergeTicket(base, plainOf(ticket({ tons: 33.2 })), plainOf(ticket({ tons: 34 })));
  assert.equal(m.values.tons, 33.2);
  assert.equal(m.conflicts.length, 1);
  assert.deepEqual([m.conflicts[0].key, m.conflicts[0].ours, m.conflicts[0].theirs], ['tons', 33.2, 34]);
});
await check('blank and nothing are the same, and a number typed as text is that number', () => {
  const base = plainOf(ticket({ notes: '', grade: undefined }));
  const m = mergeTicket(base, plainOf(ticket({ notes: null })), plainOf(ticket({ notes: '', tons: '32' })));
  assert.equal(m.changed, false);
});

console.log('\n=== the real sequence: field, then weighbridge, then a device that had not caught up ===');

await check('a correction to the weight does not undo the other device\'s choice of silo', () => {
  // the ticket as both devices last agreed: on a truck, destination still In transit
  const base = plainOf(ticket());
  // the weighbridge allocated it to Silo C and added quality
  const theirs = plainOf(ticket({ grade: 'APH1', proteinPct: 11.8, tos: [leg('silo', 'siloC', 32, 'lc')] }));
  // the field device, behind, then corrected the net load; its legs followed it
  const ours = plainOf(ticket({ tons: 31, weightStatus: 'final', froms: [leg('field', 'f1', 31, 'lf')], tos: [leg('silo', 'transit', 31, 'lt')] }));
  const m = mergeTicket(base, ours, theirs);
  assert.deepEqual(m.conflicts, [], 'the destination was changed only on the other device');
  assert.equal(m.values.tos[0].id, 'siloC', 'the weighbridge\'s silo stands');
  assert.equal(m.values.tos[0].tons, 31, 'and the silo gets the corrected weight');
  assert.equal(m.values.tos[0].__legId, 'lc', 'with its own leg id, so no copy of the leg is made');
  assert.equal(m.values.froms[0].tons, 31);
  assert.equal(m.values.tons, 31);
  assert.equal(m.values.weightStatus, 'final');
  assert.equal(m.values.grade, 'APH1');
  assert.deepEqual(m.fromTheirs.sort(), ['grade', 'proteinPct', 'tos']);
});
await check('two devices choosing different silos is a clash, and says so', () => {
  const base = plainOf(ticket());
  const m = mergeTicket(base, plainOf(ticket({ tos: [leg('silo', 'siloA', 32, 'la')] })), plainOf(ticket({ tos: [leg('silo', 'siloC', 32, 'lc')] })));
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.conflicts[0].key, 'tos');
  assert.equal(m.values.tos[0].id, 'siloA', 'this device\'s choice is kept');
});
await check('a load split across several silos is merged as a whole', () => {
  const split = [leg('silo', 'a', 20, 'l1'), leg('silo', 'b', 12, 'l2')];
  const base = plainOf(ticket({ tos: split }));
  const m = mergeTicket(base, plainOf(ticket({ tos: split, notes: 'x' })), plainOf(ticket({ tos: [leg('silo', 'a', 10, 'l1'), leg('silo', 'b', 22, 'l2')] })));
  assert.deepEqual(m.fromTheirs, ['tos']);
  assert.equal(m.values.tos[1].tons, 22);
  assert.equal(m.values.notes, 'x');
});

console.log('\n=== checking against the server before sending ===');

const serverRow = (extra = {}) => ({
  id: 'm1', ticket_no: 1043, move_date: '2026-11-12', commodity_id: 'w', status: 'open', truck_rego: 'TAMBO', driver_name: null,
  gross_weight: null, tare_weight: null, tons: 32, weight_status: 'estimate', notes: null, updated_at: 'v2', ...extra,
});
const serverLegs = (toId = 'siloC') => [
  { id: 'lf', movement_id: 'm1', direction: 'from', ref_type: 'field', ref_id: 'f1', tons: 32 },
  { id: 'lc', movement_id: 'm1', direction: 'to', ref_type: 'storage', ref_id: toId, tons: 32 },
];
const stateWith = (m) => ({ years: { 2026: { movements: [m] } } });
const serverOf = (row, legs) => ({ movements: async () => [row], legs: async () => legs });

await check('a ticket the server has not changed is sent as it is, with nothing said', async () => {
  const m = stampBase(ticket({ __rev: 'v1' }));
  m.notes = 'edited here';
  const notices = await reconcileTickets(stateWith(m), ['m1'], serverOf(serverRow({ updated_at: 'v1', truck_rego: 'TAMBO', notes: null, ...{ } }), []));
  assert.deepEqual(notices, []);
  assert.equal(m.notes, 'edited here');
});
await check('a ticket the server has moved on is merged in place, remembered at the server\'s version, and reported', async () => {
  const m = stampBase(ticket({ __rev: 'v1' }));
  m.tons = 31; m.weightStatus = 'final'; m.froms[0].tons = 31; m.tos[0].tons = 31;
  const notices = await reconcileTickets(stateWith(m), ['m1'], serverOf(serverRow({ grade: 'APH1', protein_pct: 11.8 }), serverLegs('siloC')));
  assert.equal(notices.length, 1);
  assert.equal(notices[0].ticketNo, 1043);
  assert.ok(notices[0].fromTheirs.includes('grade') && notices[0].fromTheirs.includes('tos'));
  assert.equal(m.grade, 'APH1');
  assert.equal(m.tos[0].id, 'siloC');
  assert.equal(m.tos[0].tons, 31);
  assert.equal(m.tons, 31);
  assert.equal(m.__rev, 'v2', 'it now knows it has seen the server\'s latest');
  // merging again with nothing new says nothing
  const again = await reconcileTickets(stateWith(m), ['m1'], serverOf(serverRow({ grade: 'APH1', protein_pct: 11.8 }), serverLegs('siloC')));
  assert.deepEqual(again, []);
});
await check('a ticket with no remembered version (new here, or from before this) is left alone', async () => {
  const m = ticket();
  const notices = await reconcileTickets(stateWith(m), ['m1'], serverOf(serverRow(), serverLegs()));
  assert.deepEqual(notices, []);
});
await check('only the tickets being sent are looked at', async () => {
  const m = stampBase(ticket({ __rev: 'v1' }));
  let asked = 0;
  await reconcileTickets(stateWith(m), ['someone-else'], { movements: async () => { asked += 1; return []; }, legs: async () => [] });
  assert.equal(asked, 0);
});

console.log('\n=== telling the person ===');

await check('the warning says what was combined and what clashed, in words', () => {
  const ctx = { storages: [{ id: 'siloC', name: 'Silo C' }, { id: 'siloA', name: 'Silo A' }], fields: [{ id: 'f1', name: 'Boundary' }], commodities: [], sales: [] };
  const text = describeMerges([{ id: 'm1', ticketNo: 1043, fromTheirs: ['grade', 'tos'], conflicts: [{ key: 'tons', ours: 33.2, theirs: 34 }] }], ctx);
  assert.ok(text.includes('Ticket #1043 was also changed on another device'));
  assert.ok(text.includes('took the other device\'s grade, destination'));
  assert.ok(text.includes('Both devices changed the net load. Kept this device\'s (33.2 t); the other device had 34 t.'));
});
await check('values read as names and tonnes, not ids', () => {
  const ctx = { storages: [{ id: 'siloC', name: 'Silo C' }], fields: [{ id: 'f1', name: 'Boundary' }], commodities: [{ id: 'w', name: 'Wheat' }], sales: [] };
  assert.equal(valueText('tos', [leg('silo', 'siloC', 31.4)], ctx), 'Silo C 31.4 t');
  assert.equal(valueText('froms', [leg('field', 'f1', 20), leg('field', 'f1', 11.5)], ctx), 'Boundary 20 t + Boundary 11.5 t');
  assert.equal(valueText('commodityId', 'w', ctx), 'Wheat');
  assert.equal(valueText('weightStatus', 'final', ctx), 'Final');
  assert.equal(valueText('notes', '', ctx), 'nothing');
  assert.equal(valueText('proteinPct', 11.5, ctx), '11.5%');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
