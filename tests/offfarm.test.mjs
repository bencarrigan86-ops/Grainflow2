// Run with:
//   node tests/offfarm.test.mjs
//
// Grain held off the farm by a third party: a balance for each commodity and grade.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isOffFarm, cleanOffFarm, commodityOfLoad, holdings, heldOf, holdsCommodity, totalHeld, carryOffFarm,
} from '../docs/js/offfarm.js';
import { pickableSilos } from '../docs/js/silopick.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const WHEAT = 'w1';
const BARLEY = 'b1';
const loc = { id: 'gc', name: 'GrainCorp Gunnedah', offFarm: { operator: 'GrainCorp', opening: [{ commodityId: WHEAT, grade: 'APH1', tons: 100 }] } };
const ctx = { fields: [{ id: 'f1', commodityId: WHEAT }], storages: [loc, { id: 's1', commodityId: BARLEY }], sales: [{ id: 'sale1', commodityId: WHEAT }] };
// 200 t of H2 wheat in, 40 t of APH1 wheat out, 60 t of barley in under no grade
const moves = [
  { id: 'm1', commodityId: WHEAT, grade: 'H2', froms: [{ type: 'field', id: 'f1', tons: 200 }], tos: [{ type: 'silo', id: 'gc', tons: 200 }] },
  { id: 'm2', commodityId: WHEAT, grade: 'APH1', froms: [{ type: 'silo', id: 'gc', tons: 40 }], tos: [{ type: 'sale', id: 'sale1', tons: 40 }] },
  { id: 'm3', commodityId: BARLEY, grade: '', froms: [{ type: 'silo', id: 's1', tons: 60 }], tos: [{ type: 'silo', id: 'gc', tons: 60 }] },
];
const rowsOf = (list) => list.map((h) => `${h.commodityId}/${h.grade || '-'}/${h.tons}`).sort();

console.log('\n=== what a location holds ===');

check('only a storage with the off-farm part is an off-farm location', () => {
  assert.equal(isOffFarm(loc), true);
  assert.equal(isOffFarm({ id: 's1' }), false);
  assert.equal(isOffFarm(null), false);
});
check('the opening holdings, plus what went in under each grade, less what came out under each', () => {
  assert.deepEqual(rowsOf(holdings(loc, moves, ctx)), ['b1/-/60', 'w1/APH1/60', 'w1/H2/200']);
});
check('a grade is one balance whatever the case it was typed in', () => {
  const more = [...moves, { id: 'm4', commodityId: WHEAT, grade: 'aph1', froms: [], tos: [{ type: 'silo', id: 'gc', tons: 10 }] }];
  assert.equal(heldOf(loc, more, ctx, WHEAT, 'APH1'), 70);
});
check('the same grade of another commodity is a different balance', () => {
  assert.equal(heldOf(loc, moves, ctx, BARLEY, 'APH1'), 0);
  assert.equal(heldOf(loc, moves, ctx, WHEAT, 'H2'), 200);
});
check('a grade nothing was drawn from keeps its full balance', () => {
  assert.equal(heldOf(loc, moves, ctx, WHEAT, 'H2'), 200);
});
check('a ticket can be left out, to check one being edited against what the others leave', () => {
  assert.equal(heldOf(loc, moves, ctx, WHEAT, 'APH1', { except: 'm2' }), 100);
});
check('more drawn than was ever held is kept as a negative balance, not hidden', () => {
  const over = [{ id: 'm9', commodityId: WHEAT, grade: 'FED1', froms: [{ type: 'silo', id: 'gc', tons: 25 }], tos: [] }];
  assert.equal(heldOf(loc, over, ctx, WHEAT, 'FED1'), -25);
});
check('a balance that has come to nothing is not listed', () => {
  const out = [{ id: 'm5', commodityId: WHEAT, grade: 'APH1', froms: [{ type: 'silo', id: 'gc', tons: 100 }], tos: [] }];
  assert.ok(!rowsOf(holdings(loc, out, ctx)).some((r) => r.startsWith('w1/APH1')));
});
check('loads to and from other silos do not count', () => {
  const other = [{ id: 'mx', commodityId: WHEAT, grade: 'H2', froms: [], tos: [{ type: 'silo', id: 's1', tons: 500 }] }];
  assert.deepEqual(rowsOf(holdings(loc, other, ctx)), ['w1/APH1/100']);
});
check('the total, every commodity and grade', () => {
  assert.equal(totalHeld(holdings(loc, moves, ctx)), 320);
});
check('does it hold a commodity', () => {
  assert.equal(holdsCommodity(loc, moves, ctx, WHEAT), true);
  assert.equal(holdsCommodity(loc, moves, ctx, 'canola'), false);
});

console.log('\n=== the commodity of a load ===');

check('the ticket\'s own commodity first, then the contract, then where it came from', () => {
  assert.equal(commodityOfLoad({ commodityId: 'x' }, ctx), 'x');
  assert.equal(commodityOfLoad({ tos: [{ type: 'sale', id: 'sale1' }] }, ctx), WHEAT);
  assert.equal(commodityOfLoad({ froms: [{ type: 'field', id: 'f1' }], tos: [{ type: 'silo', id: 'gc' }] }, ctx), WHEAT);
  assert.equal(commodityOfLoad({ froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'silo', id: 'gc' }] }, ctx), BARLEY);
  assert.equal(commodityOfLoad({}, ctx), '');
});
check('a load with no commodity on the ticket is still counted, under the commodity it came from', () => {
  const unlabeled = [{ id: 'm6', grade: 'H2', froms: [{ type: 'field', id: 'f1', tons: 30 }], tos: [{ type: 'silo', id: 'gc', tons: 30 }] }];
  assert.equal(heldOf(loc, unlabeled, ctx, WHEAT, 'H2'), 30);
});

console.log('\n=== saving the off-farm part ===');

check('the operator is trimmed, and holdings with no tonnes or no commodity are dropped', () => {
  const c = cleanOffFarm({ operator: '  GrainCorp ', opening: [{ commodityId: 'w1', grade: ' APH1 ', tons: '50' }, { commodityId: 'w1', grade: 'H2', tons: 0 }, { commodityId: '', grade: 'x', tons: 5 }] });
  assert.deepEqual(c, { operator: 'GrainCorp', opening: [{ commodityId: 'w1', grade: 'APH1', tons: 50 }] });
});
check('the same commodity and grade is added together', () => {
  const c = cleanOffFarm({ opening: [{ commodityId: 'w1', grade: 'APH1', tons: 50 }, { commodityId: 'w1', grade: 'aph1', tons: 25 }] });
  assert.equal(c.opening.length, 1);
  assert.equal(c.opening[0].tons, 75);
});
check('nothing at all is an empty location, not an error', () => {
  assert.deepEqual(cleanOffFarm(undefined), { operator: '', opening: [] });
});

console.log('\n=== a new season ===');

check('what is held now becomes what the location opens with, under the new commodity ids', () => {
  const next = carryOffFarm(loc, moves, ctx, new Map([[WHEAT, 'w2'], [BARLEY, 'b2']]));
  assert.equal(next.operator, 'GrainCorp');
  assert.deepEqual(next.opening.map((o) => `${o.commodityId}/${o.grade || '-'}/${o.tons}`).sort(), ['b2/-/60', 'w2/APH1/60', 'w2/H2/200']);
});
check('a commodity with no new id is left out', () => {
  assert.equal(carryOffFarm(loc, moves, ctx, new Map([[WHEAT, 'w2']])).opening.length, 2);
});

console.log('\n=== the movement pickers ===');

const silos = [{ id: 's1', commodityId: WHEAT, openingStock: 50 }, { id: 's2', commodityId: BARLEY, openingStock: 50 }, loc];
check('an off-farm location is always offered to put grain into', () => {
  assert.ok(pickableSilos(silos, WHEAT, { to: true }).some((s) => s.id === 'gc'));
});
check('and to take grain out of only when it holds the commodity', () => {
  const holds = (l, c) => holdsCommodity(l, moves, ctx, c);
  assert.ok(pickableSilos(silos, WHEAT, { holds }).some((s) => s.id === 'gc'));
  assert.ok(!pickableSilos(silos, 'canola', { holds }).some((s) => s.id === 'gc'));
});
check('with no commodity chosen every location is offered', () => {
  assert.ok(pickableSilos(silos, '').some((s) => s.id === 'gc'));
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const state = (storage, movement = {}) => ({
  currentYear: '2026', nextMovementNo: 2, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [storage],
    movements: [{ id: '77777777-7777-7777-7777-777777777777', ticketNo: 1, froms: [], tos: [], tons: 10, ...movement }] } },
});
const SID = '88888888-8888-8888-8888-888888888888';
check('a location goes to the server and comes back', () => {
  const off = { operator: 'GrainCorp', opening: [{ commodityId: 'c1', grade: 'APH1', tons: 450 }] };
  const rows = stateToRows(state({ id: SID, kind: 'silo', name: 'GrainCorp Gunnedah', offFarm: off }), FARM);
  assert.deepEqual(rows.storages[0].off_farm, off);
  assert.deepEqual(rowsToState(rows).years[2026].storages[0].offFarm, off);
});
check('a silo sends no off-farm column, so silos still save before the database has it', () => {
  assert.ok(!('off_farm' in stateToRows(state({ id: SID, kind: 'silo', name: 'Silo 1' }), FARM).storages[0]));
});
check('their ticket number goes to the server and comes back', () => {
  const rows = stateToRows(state({ id: SID, kind: 'silo', name: 'x' }, { externalTicketNo: 'GC-88213' }), FARM);
  assert.equal(rows.movements[0].external_ticket_no, 'GC-88213');
  assert.equal(rowsToState(rows).years[2026].movements[0].externalTicketNo, 'GC-88213');
});
check('a load without one sends no such column', () => {
  assert.ok(!('external_ticket_no' in stateToRows(state({ id: SID, kind: 'silo', name: 'x' }), FARM).movements[0]));
});
check('having had one and cleared it still sends it, so the clearing reaches the server', () => {
  const row = stateToRows(state({ id: SID, kind: 'silo', name: 'x' }, { externalTicketNo: '', __hasExtTicket: true }), FARM).movements[0];
  assert.ok('external_ticket_no' in row);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the Storage screen has the off-farm card, and keeps off-farm locations out of the silo list', () => {
  const src = read('docs/js/views/storage.js');
  assert.match(src, /paintOffFarmCard\(/);
  assert.match(src, /!isOffFarm\(x\)/);
});
check('the movement form has their ticket number, saves the commodity, and warns about drawing too much', () => {
  const src = read('docs/js/views/movements.js');
  assert.match(src, /id: 'extTicket'/);
  assert.match(src, /externalTicketNo: getVal\(root, 'extTicket'\)/);
  assert.match(src, /commodityId: ctx\.commodityId/);
  assert.match(src, /heldOf\(loc, movements/);
});
check('the database columns are in the paste-in file', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.ok(sql.includes('off_farm jsonb'));
  assert.ok(sql.includes('external_ticket_no text'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
