// Run with:
//   node tests/address.test.mjs
//
// An address in its parts (line 1, line 2, town, state, postcode): joined for the documents, read from the old one-line
// form, saved beside the joined line, and into Xero's postal address columns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanParts, hasParts, joinAddress, addressLines, parseAddress, partsOf, addressLinesOf } from '../docs/js/address.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { xeroInvoices, XERO_COLUMNS } from '../docs/js/xero.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const WAGIN = { line1: '12 Smith Rd', line2: 'Lot 4', town: 'Wagin', state: 'WA', postcode: '6315' };

console.log('\n=== joining ===');
check('the parts join to one line, the town, state and postcode together', () => {
  assert.equal(joinAddress(WAGIN), '12 Smith Rd, Lot 4, Wagin WA 6315');
  assert.deepEqual(addressLines(WAGIN), ['12 Smith Rd', 'Lot 4', 'Wagin WA 6315']);
});
check('blank parts are left out, with no stray commas', () => {
  assert.equal(joinAddress({ line1: 'PO Box 9', town: 'Wagin' }), 'PO Box 9, Wagin');
  assert.equal(joinAddress({}), '');
  assert.equal(joinAddress(null), '');
  assert.deepEqual(addressLines({ town: 'Wagin', postcode: '6315' }), ['Wagin 6315']);
});
check('parts are trimmed and the state is in capitals', () => {
  assert.deepEqual(cleanParts({ line1: ' 1 A St ', state: 'wa', postcode: ' 6315 ', extra: 'x' }), { line1: '1 A St', line2: '', town: '', state: 'WA', postcode: '6315' });
  assert.equal(hasParts({ line1: '  ' }), false);
  assert.equal(hasParts(WAGIN), true);
});

console.log('\n=== reading an address written as one line ===');
check('a street, a town, a state and a postcode are split', () => {
  assert.deepEqual(parseAddress('12 Smith Rd, Wagin WA 6315'), { line1: '12 Smith Rd', line2: '', town: 'Wagin', state: 'WA', postcode: '6315' });
  assert.deepEqual(parseAddress('12 Smith Rd, Lot 4, Wagin WA 6315'), WAGIN);
  assert.deepEqual(parseAddress('12 Smith Rd, Wagin, WA, 6315'), { line1: '12 Smith Rd', line2: '', town: 'Wagin', state: 'WA', postcode: '6315' });
  assert.deepEqual(parseAddress('Wagin WA 6315'), { line1: '', line2: '', town: 'Wagin', state: 'WA', postcode: '6315' });
});
check('line breaks are read as commas', () => {
  assert.deepEqual(parseAddress('PO Box 9\nWagga Wagga NSW 2650'), { line1: 'PO Box 9', line2: '', town: 'Wagga Wagga', state: 'NSW', postcode: '2650' });
});
check('what cannot be read with confidence goes whole into line 1, nothing lost', () => {
  assert.deepEqual(parseAddress('Silo Rd Wagga'), { line1: 'Silo Rd Wagga', line2: '', town: '', state: '', postcode: '' });
  assert.deepEqual(parseAddress('12 Silo Rd, Wagga NSW'), { line1: '12 Silo Rd, Wagga NSW', line2: '', town: '', state: '', postcode: '' });
  assert.deepEqual(parseAddress('10 High St Wagin WA 6315'), { line1: '10 High St Wagin WA 6315', line2: '', town: '', state: '', postcode: '' });
  assert.equal(joinAddress(parseAddress('10 High St Wagin WA 6315')), '10 High St Wagin WA 6315', 'the joined line is what was typed');
  assert.deepEqual(parseAddress(''), cleanParts({}));
});
check('reading and joining again gives back what was typed, for the usual shapes', () => {
  for (const t of ['12 Smith Rd, Wagin WA 6315', '12 Smith Rd, Lot 4, Wagin WA 6315', 'PO Box 9, Wagga Wagga NSW 2650', 'Silo Rd Wagga']) assert.equal(joinAddress(parseAddress(t)), t);
});
check('stored parts are used while they still say what the text says; if the text was changed some other way the text wins', () => {
  assert.deepEqual(partsOf('12 Smith Rd, Lot 4, Wagin WA 6315', WAGIN), WAGIN);
  assert.deepEqual(partsOf('1 New St, Katanning WA 6317', WAGIN), parseAddress('1 New St, Katanning WA 6317'));
  assert.deepEqual(partsOf('', WAGIN), cleanParts({}));
  assert.deepEqual(addressLinesOf('12 Smith Rd, Wagin WA 6315', undefined), ['12 Smith Rd', 'Wagin WA 6315']);
});

console.log('\n=== saving and loading ===');
const FARM = '11111111-1111-1111-1111-111111111111';
const state = (business, sale = {}) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: business,
  years: { 2026: { commodities: [], fields: [], storages: [], movements: [], invoices: [], overheads: {},
    sales: [{ id: '44444444-4444-4444-4444-444444444444', tons: 100, price: 300, ...sale }] } },
});
check('a farm and a contract that were never split send no such column, so saving works before the database has it', () => {
  const rows = stateToRows(state({ farmName: 'X', address: '1 A St' }, { buyerAddress: '2 B St' }), FARM);
  assert.ok(!('address_parts' in rows.farms[0]));
  assert.ok(!('buyer_address_parts' in rows.sale_terms[0]));
  assert.equal(rows.farms[0].address, '1 A St');
});
check('the business address goes up as the joined line and the parts, and comes back as both', () => {
  const rows = stateToRows(state({ farmName: 'X', address: joinAddress(WAGIN), addressParts: WAGIN }), FARM);
  assert.equal(rows.farms[0].address, '12 Smith Rd, Lot 4, Wagin WA 6315');
  assert.deepEqual(rows.farms[0].address_parts, WAGIN);
  const back = rowsToState(rows).businessDetails;
  assert.deepEqual(back.addressParts, WAGIN);
  assert.equal(back.address, '12 Smith Rd, Lot 4, Wagin WA 6315');
});
check("the buyer's address goes up as the joined line and the parts, and comes back as both", () => {
  const rows = stateToRows(state({}, { buyerAddress: joinAddress(WAGIN), buyerAddressParts: WAGIN }), FARM);
  assert.deepEqual(rows.sale_terms[0].buyer_address_parts, WAGIN);
  const sale = rowsToState(rows).years[2026].sales[0];
  assert.deepEqual(sale.buyerAddressParts, WAGIN);
  assert.equal(sale.buyerAddress, '12 Smith Rd, Lot 4, Wagin WA 6315');
});
check('clearing the parts still reaches the server', () => {
  const rows = stateToRows(state({ address: '', addressParts: cleanParts({}), __hasAddressParts: true }, { buyerAddress: '', buyerAddressParts: cleanParts({}), __hasBuyerAddressParts: true }), FARM);
  assert.equal(rows.farms[0].address_parts, null);
  assert.equal(rows.sale_terms[0].buyer_address_parts, null);
});
check('parts that no longer match the joined line (an older copy of the app changed just the line) are not trusted', () => {
  const rows = stateToRows(state({ address: joinAddress(WAGIN), addressParts: WAGIN }), FARM);
  rows.farms[0].address = '9 Other St, Dumbleyung WA 6350';
  const back = rowsToState(rows).businessDetails;
  assert.equal(back.address, '9 Other St, Dumbleyung WA 6350');
  assert.equal(back.addressParts, undefined);
  assert.deepEqual(partsOf(back.address, back.addressParts), parseAddress('9 Other St, Dumbleyung WA 6350'));
});

console.log('\n=== Xero ===');
const inv = { id: 'i1', saleId: 's1', invoiceNo: 5, issueDate: '2026-11-01', dueDate: '2026-11-15', lines: [{ tons: 10, rate: 300 }], subtotalExGST: 3000, levies: 0, freightTotal: 0 };
const xero = (sale) => xeroInvoices({ invoices: [inv], sales: [{ id: 's1', buyer: 'Buyer Co', ...sale }], commodities: [], from: '', to: '2026-12-01' }).rows[0];
check("the buyer's address fills Xero's postal address columns", () => {
  const r = xero({ buyerAddress: joinAddress(WAGIN), buyerAddressParts: WAGIN });
  assert.equal(r.POAddressLine1, '12 Smith Rd');
  assert.equal(r.POAddressLine2, 'Lot 4');
  assert.equal(r.POCity, 'Wagin');
  assert.equal(r.PORegion, 'WA');
  assert.equal(r.POPostalCode, '6315');
  assert.equal(r.POCountry, 'Australia');
});
check('an address typed before the split is read into them, and none leaves them blank', () => {
  const old = xero({ buyerAddress: '12 Smith Rd, Wagin WA 6315' });
  assert.equal(old.POCity, 'Wagin'); assert.equal(old.POAddressLine1, '12 Smith Rd');
  const none = xero({});
  for (const c of ['POAddressLine1', 'POCity', 'PORegion', 'POPostalCode', 'POCountry']) { assert.ok(XERO_COLUMNS.includes(c)); assert.equal(none[c], ''); }
});

console.log('\n=== on the screens ===');
check('Settings and the contract form use the five boxes and save both the joined line and the parts', () => {
  const st = read('docs/js/views/settings.js');
  assert.ok(st.includes("addressFields('bd-addr'") && st.includes('address: joinAddress(addr)') && st.includes('addressParts: addr'));
  const sales = read('docs/js/views/sales.js');
  assert.ok(sales.includes("addressFields('buyerAddr'") && sales.includes("buyerAddress: joinAddress(readAddress(root, 'buyerAddr'))") && sales.includes("buyerAddressParts: readAddress(root, 'buyerAddr')"));
  assert.ok(!sales.includes("id: 'buyerAddress'"), 'the old one-line box is gone');
});
check('the contract and invoice print the address a line at a time', () => {
  for (const f of ['contract', 'invoice']) {
    const v = read(`docs/js/views/${f}.js`);
    assert.ok(v.includes('addressLinesOf(business.address, business.addressParts)') && v.includes('addressLinesOf(sale.buyerAddress, sale.buyerAddressParts)'), f);
  }
});
check('the columns are in the paste-in file and the migration', () => {
  const paste = read('supabase/paste-into-sql-editor.sql');
  assert.ok(paste.includes('add column if not exists address_parts jsonb') && paste.includes('add column if not exists buyer_address_parts jsonb'));
  const mig = read('supabase/migrations/20261116100000_address_parts.sql');
  assert.ok(mig.includes('alter table farms') && mig.includes('alter table sale_terms'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
