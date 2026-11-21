// Run with:
//   node tests/batch4.test.mjs
//
// Batch 4 of the review: screens. These read the source, as the other screen tests do.
//   - the load form asks for the weight first, then where it came from and went
//   - a load from one place to one place has no Tonnes boxes of its own (they follow Net), until a second source or
//     destination is added or a figure differs from Net
//   - a deleted record says so
//   - the Help text does not describe boxes and buttons the app does not have
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== the load form ===');
const mv = read('docs/js/views/movements.js');
check('Weight comes before From and to, and Truck and tickets last', () => {
  const at = (t) => mv.indexOf(`<div class="subhead">${t}</div>`);
  assert.ok(at('Load') > 0 && at('Load') < at('Weight') && at('Weight') < at('From and to') && at('From and to') < at('Truck and tickets'));
});
check('one source to one place hides its own Tonnes boxes and totals', () => {
  assert.ok(mv.includes('function markSingle()'));
  assert.ok(mv.includes("fromRowsEl.classList.toggle('single', fromAlone)"));
  assert.ok(mv.includes("toRowsBox.classList.toggle('single', toAlone)"));
  assert.ok(read('docs/css/styles.css').includes('.single > .from-row .tons-field'));
});
check('a figure that differs from Net, or a second row, keeps the boxes; the box being typed in never hides', () => {
  assert.ok(mv.includes('Math.abs(t - net) < 0.005'));
  assert.ok(mv.includes('fromRows.length === 1 && (!toRowsBox || toRows.length === 1)'));
  assert.ok(mv.includes("a?.matches?.('.from-tons, .to-tons')"));
});
check('adding a source or destination, and changing where it goes, bring the boxes back or follow Net', () => {
  assert.ok(mv.includes("addFromRow(fromRowsEl, ctx, recomputeSourcesTotal); recomputeSourcesTotal();"));
  assert.ok(mv.includes("addToRow(toRowsEl, ctx, recomputeDestTotal); recomputeDestTotal(); recomputeSourcesTotal();"));
  assert.ok(mv.includes('syncSingleLegs();   // a new silo row takes the net weight already typed'));
});
check('the Destination hint shows only for a contract', () => {
  assert.ok(mv.includes('id="dest-hint"') && mv.includes("h.hidden = toKind !== 'sale'"));
});

check('Commodity is the first box, tinted and outlined so it is not skipped', () => {
  assert.ok(mv.indexOf('class="field must-pick"') > 0 && mv.indexOf('class="field must-pick"') < mv.indexOf("label: 'Date', id: 'date'"));
  assert.ok(read('docs/css/styles.css').includes('.form-section .field.must-pick select'));
});
check('a warning shows when the sources or the silos do not add up to the Net weight', () => {
  assert.ok(mv.includes('id="legs-warn"') && mv.includes('function legsWarn()'));
  assert.ok(mv.includes('The sources add up to') && mv.includes('The storage adds up to'));
  assert.ok(mv.includes('markSingle() {\n      legsWarn();'), 'checked wherever the figures change');
});

console.log('\n=== deletes say so ===');
for (const f of ['movements', 'offfarm', 'production', 'settings', 'storage', 'payables', 'freightorders', 'orders', 'sales', 'invoice']) {
  check(`${f}: a delete shows "Deleted"`, () => assert.ok(read(`docs/js/views/${f}.js`).includes("toast('Deleted')")));
}

console.log('\n=== Help text matches the app ===');
const help = read('docs/js/helpcontent.js');
check('the Farm box is optional, Use it is for editing, View PDF is the spray button', () => {
  assert.ok(!help.includes('Farm box appears only if'));
  assert.ok(help.includes('When you edit a field, tap Use it'));
  assert.ok(help.includes('Tap View PDF to look at it'));
  assert.ok(!help.includes('Search, Sort by and More'));
});

console.log('\n=== one word for one thing ===');
const src = (p) => read(`docs/js/${p}`);
check('a load is a Load: the tab, the sheet, the lists and Help', () => {
  assert.ok(src('main.js').includes("label: 'Loads', icon: MOVEMENT_ICON"));
  assert.ok(mv.includes('`Add load #${db.nextTicketNo()}`') && mv.includes('<h1>Loads</h1>') && mv.includes('>Delete load<'));
  assert.ok(!mv.includes('Related movements') && src('views/orders.js').includes('Related loads'));
  assert.ok(src('helpcontent.js').includes("openLabel: 'Open Loads'") && !src('helpcontent.js').includes('Open Movement'));
});
check('the trucking company is the Carrier, and a bill is from a Supplier', () => {
  assert.ok(mv.includes("label: 'Carrier'") && src('views/orders.js').includes("label: 'Carrier'"));
  assert.ok(src('views/payables.js').includes("label: 'Supplier', id: 'b-supplier'"));
});
check('a contract delivers from and by, like an order', () => {
  assert.ok(src('views/sales.js').includes("label: 'Deliver from', id: 'deliveryStart'") && src('views/sales.js').includes("label: 'Deliver by', id: 'deliveryEnd'"));
});
check('a field is a Field and a season is a Season on screen', () => {
  assert.ok(src('views/production.js').includes("label: 'Field to merge in'") || !src('views/production.js').includes('Paddock to merge in'));
  assert.ok(src('views/settings.js').includes('Start new season') && !src('views/settings.js').includes('Start new year'));
  assert.ok(src('views/spray.js').includes("label: 'Farm', id: 'sp-property'"));
});
check('the PDF buttons say View PDF, Send PDF and Download PDF', () => {
  assert.ok(mv.includes('>View PDF<') && mv.includes('>Send PDF<'));
  assert.ok(!mv.includes('Send this load as a PDF') && !src('views/loadreport.js').includes('>Send as PDF<'));
});
check('the load form says Storage where it used to say Silo', () => {
  assert.ok(mv.includes('>Storage</button>') && mv.includes('<label>Storage</label>'));
});

console.log('\n=== screens ===');
check('a menu of one tool is that tool, and the contractor questions are folded', () => {
  assert.ok(mv.includes('const only = toolButtons.length === 1 ? toolButtons[0] : null;') && mv.includes('if (toolButtons.length === 0) toolsBtn.hidden = true;'));
  assert.ok(src('views/spray.js').includes('id="sp-q-fold"'));
});
check('small tap targets are enlarged, and the contract numbers sit under the buyer', () => {
  const css = read('docs/css/styles.css');
  assert.ok(css.includes('.jump-link::before') && css.includes('.rep-star { position: absolute; top: 0; right: 0; width: 40px; height: 40px;') && css.includes('min-height: 40px;'));
  const sales = src('views/sales.js');
  assert.ok(sales.indexOf("id: 'contractNo'") < sales.indexOf('id="buyer-fold"'));
});
check('the setup button has one name', () => {
  assert.ok(src('views/help.js').includes('id="help-walk">Start setup<') && !src('helpcontent.js').includes('Open the walk-through'));
});

console.log('\n=== the access review before a person is given access ===');
const { accessReview } = await import('../docs/js/accessreview.js?v=513');
const { withLevel } = await import('../docs/js/farmswitches.js?v=513');
const { ACCESS: ACC } = await import('../docs/js/helpcontent.js?v=513');
check('every area is either something they can open or something they cannot see', () => {
  for (const role of ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver', 'advisor']) {
    const r = accessReview(role, {});
    assert.equal(r.can.length + r.cannot.length, ACC.length, role);
  }
});
check('an owner can open everything; a driver is kept out of the money', () => {
  assert.equal(accessReview('owner', {}).cannot.length, 0);
  const d = accessReview('driver', {});
  assert.ok(d.cannot.length > 0 && d.can.length > 0);
});
check('the review follows the farm own levels (set an area to None and it moves to Cannot see)', () => {
  const base = accessReview('manager', {});
  assert.ok(base.can.some((c) => c.key === 'production'));
  const after = accessReview('manager', withLevel({}, 'production', 'manager', 'none'));
  assert.ok(after.cannot.some((c) => c.key === 'production') && after.can.length === base.can.length - 1);
});
check('a field role allowed production says so', () => {
  assert.equal(accessReview('farm_worker', {}, { canWriteProduction: true }).extras.length, 1);
  assert.equal(accessReview('farm_worker', {}).extras.length, 0);
  assert.equal(accessReview('manager', {}, { canWriteProduction: true }).extras.length, 0);
});
const people = read('docs/js/views/settingspeople.js');
check('an invitation is only created after the list is gone through and ticked', () => {
  assert.ok(people.includes('who: v.email, role: v.role'));
  assert.ok(people.includes("onConfirm: () => create(v)"));
  assert.ok(people.includes('id="ar-ok"') && people.includes('<button class="btn" id="ar-go" disabled>'));
  assert.ok(people.includes("go.disabled = !e.target.checked"));
  const at = people.indexOf('createInvitation({');
  assert.ok(at > people.indexOf('const create = async'), 'createInvitation is only called from create()');
});
check('changing a member level or production setting goes through the same review', () => {
  assert.ok(people.includes("onConfirm: () => save(role, production)"));
  assert.ok(people.includes("if (role !== m.role ||"));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
