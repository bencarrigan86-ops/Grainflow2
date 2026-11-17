// Run with:
//   node tests/buyerprofile.test.mjs
//
// A buyer sold to before: their contact, ABN and address come from the earlier contracts, each from the most recent one
// that has it, and fill only the boxes still empty on a new contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buyerProfile } from '../docs/js/buyercontact.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const sales = [
  { id: 'a', buyer: 'Coastal Feeds Pty Ltd', date: '2026-01-10', buyerContact: 'Old Trader, 0400 111 111', buyerAbn: '11 111 111 111', buyerAddress: '1 Old Rd, Perth WA 6000' },
  { id: 'b', buyer: 'coastal feeds pty ltd', date: '2026-05-02', buyerContact: 'Jane Smith, 0400 123 456, jane@coastal.com.au', buyerAbn: '', buyerAddress: '' },
  { id: 'c', buyer: 'Other Buyer', date: '2026-06-01', buyerContact: 'Somebody' },
];

check('no earlier contract, or no name, gives nothing', () => {
  assert.equal(buyerProfile(sales, 'Nobody Ltd'), null);
  assert.equal(buyerProfile(sales, ''), null);
  assert.equal(buyerProfile([], 'Coastal Feeds Pty Ltd'), null);
});

check('the contact comes from the most recent contract that has one, matched ignoring capitals', () => {
  const p = buyerProfile(sales, 'COASTAL FEEDS PTY LTD');
  assert.deepEqual(p.contact, { name: 'Jane Smith', phone: '0400 123 456', email: 'jane@coastal.com.au' });
});

check('a contract left blank does not lose what an earlier one had: the ABN and address come from the older one', () => {
  const p = buyerProfile(sales, 'Coastal Feeds Pty Ltd');
  assert.equal(p.abn, '11 111 111 111');
  assert.equal(p.address.buyerAddress, '1 Old Rd, Perth WA 6000');
});

check('a buyer with only a contact has no ABN or address to fill', () => {
  const p = buyerProfile(sales, 'Other Buyer');
  assert.equal(p.contact.name, 'Somebody');
  assert.equal(p.abn, '');
  assert.equal(p.address, null);
});

check('the form fills only empty boxes, on a new contract, when the name is picked or the box is left', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes('buyerProfile(allSales'));
  assert.ok(s.includes("if (el && v && el.value === '')"), 'it could overwrite what was typed');
  assert.ok(s.includes('if (existing || !filledEl) return;'), 'it could change a saved contract');
  assert.ok(s.includes("buyerBox.addEventListener('change'") && s.includes('buyerList.some('));
});

check('the tolerance is 5% or 20 t side by side, a transfer tickbox sets both to nothing, and the terms fold starts closed', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes("id: 'tolCap'") && s.includes('id="tol-transfer"') && s.includes('DEFAULT_TOLERANCE_CAP_TONS'));
  assert.ok(s.includes('<details class="fold" id="terms-fold">') && s.includes('id="buyer-fold"') && !/id="buyer-fold"[^>]*open/.test(s), 'a fold starts open');
  assert.ok(s.indexOf("id: 'carryRate'") > s.indexOf('Payment &amp; broker') && s.indexOf("id: 'carryRate'") < s.indexOf("id: 'notes'"), 'carry is not in the payment panel');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
