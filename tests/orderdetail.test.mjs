// Run with:
//   node tests/orderdetail.test.mjs
//
// The detail a buyer puts on a grain order (who issued it, grade, destination, delivery address, booking instructions, what is
// rejected on arrival), and how the freight order made from it carries it to the carrier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanOrderDetail, nilToleranceLines, orderDelivery, orderGrade, bookingRows, contractMismatch, cleanFreightDetail, orderDefaults } from '../docs/js/orderdetail.js';
import { freightDefaults, freightOrderPdf, freightDestination } from '../docs/js/freight.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const latin1 = (b) => Buffer.from(b).toString('latin1');
const src = (p) => readFileSync(new URL(`../docs/js/${p}`, import.meta.url), 'utf8');

const detail = {
  issuedBy: 'Jodie Koczwara', issuedOn: '2026-11-17', grade: 'CHKP1', deliveryRef: 'CMO0000656',
  destination: 'Brisbane (Queensland Bulk Terminal)',
  address: { line1: '156 Colmslie Road', line2: '', town: 'Murarrie', state: 'QLD', postcode: '4170' },
  bookingContact: 'Bookings by email or on the terminal number',
  booking: 'Monday to Friday, 0600 to 1600.\nA booking needs the order number, the transport company, the registration and the time to unload.',
  nilTolerance: '• Any dead animals visible\n- Phosphine tablets\nUrea\n\n  Weevils or beetles (depending on count)',
};
const order = { id: 'o1', saleId: 's1', orderNo: 'CMO0000656', tons: 110, deliverFrom: '2026-11-18', deliverBy: '2026-11-30', freightCompany: 'Ace Haulage', detail };
const sale = { id: 's1', buyer: 'ADM', contractNo: 'ADM106256', grade: 'CHKP2', location: 'Brisbane' };

console.log('\n=== the detail ===');
check('what is typed is kept, and nothing at all is no detail', () => {
  const d = cleanOrderDetail(detail);
  assert.equal(d.issuedBy, 'Jodie Koczwara');
  assert.equal(d.address.town, 'Murarrie');
  assert.equal(cleanOrderDetail({}), null);
  assert.equal(cleanOrderDetail({ address: { line1: '', town: '' }, issuedBy: '  ' }), null);
  assert.equal(cleanOrderDetail(null), null);
});
check('the rejections are a list: bullets and blank lines taken off', () => {
  assert.deepEqual(nilToleranceLines(detail), ['Any dead animals visible', 'Phosphine tablets', 'Urea', 'Weevils or beetles (depending on count)']);
  assert.deepEqual(nilToleranceLines({}), []);
});
check('the grade is the order\'s, or the contract\'s when it does not say', () => {
  assert.equal(orderGrade(order, sale), 'CHKP1');
  assert.equal(orderGrade({ ...order, detail: null }, sale), 'CHKP2');
});

console.log('\n=== the freight order ===');
check('it is delivered to the buyer\'s address, the site named on the second line', () => {
  const to = orderDelivery(order);
  assert.equal(to.parts.line2, 'Brisbane (Queensland Bulk Terminal)');
  assert.ok(to.text.includes('156 Colmslie Road') && to.text.includes('Murarrie'));
  const d = freightDefaults({ sale, order });
  assert.equal(d.deliverTo, to.text);
  assert.equal(d.deliverToParts.postcode, '4170');
});
check('with no address the destination alone is where it goes, and with no detail it is the contract\'s site', () => {
  assert.equal(freightDefaults({ sale, order: { ...order, detail: { destination: 'Brisbane terminal' } } }).deliverTo, 'Brisbane terminal');
  const plain = freightDefaults({ sale, order: { ...order, detail: null } });
  assert.equal(plain.deliverTo, 'Brisbane');
  assert.equal(plain.deliverToParts, undefined);
});
check('the carrier\'s copy has the delivery reference, how to book and what is rejected', () => {
  const pdf = latin1(freightOrderPdf({
    fo: { freightNo: 'ADM106256-01', carrier: 'Ace Haulage', tons: 110, rate: 40, rateBasis: 'per_t', pickup: 'Home farm', deliverTo: 'x', loadFrom: '2026-11-18', loadBy: '2026-11-30' },
    sale, order, commodityName: 'Chickpeas', business: {}, date: '2026-11-17',
  }));
  assert.ok(pdf.includes('BOOKINGS') && pdf.includes('CMO0000656') && pdf.includes('Jodie Koczwara'));
  assert.ok(pdf.includes('Monday to Friday'));
  assert.ok(pdf.includes('REJECTED ON ARRIVAL') && pdf.includes('Phosphine tablets'));
  assert.ok(pdf.includes('CHKP1'), 'the grade on the order');
});
check('an order with no detail leaves the carrier\'s copy as it was', () => {
  const pdf = latin1(freightOrderPdf({
    fo: { freightNo: 'F-1', carrier: 'Ace', tons: 10, rate: 20, rateBasis: 'per_t' },
    sale, order: { ...order, detail: null }, commodityName: 'Chickpeas', business: {}, date: '2026-11-17',
  }));
  assert.ok(!pdf.includes('BOOKINGS') && !pdf.includes('REJECTED ON ARRIVAL'));
  assert.deepEqual(bookingRows({}), []);
});

console.log('\n=== saved ===');
const FARM = '11111111-1111-1111-1111-111111111111';
const SID = '99999999-9999-4999-8999-999999999999';
const OID = '77777777-7777-4777-8777-777777777777';
const CID = '88888888-8888-4888-8888-888888888888';
const stateWith = (orders) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [{ id: CID, name: 'Chickpeas', unit: 't' }], fields: [], storages: [], movements: [], invoices: [], overheads: {}, sales: [{ id: SID, commodityId: CID, tons: 110, price: 1010 }], orders, payables: [] } },
});
check('the detail is not sent until there is some, is sent when there is, and clearing it reaches the server', () => {
  const plain = stateToRows(stateWith([{ id: OID, saleId: SID, tons: 10 }]), FARM).orders[0];
  assert.ok(!('detail' in plain));
  const sent = stateToRows(stateWith([{ id: OID, saleId: SID, tons: 10, detail }]), FARM).orders[0];
  assert.equal(sent.detail.deliveryRef, 'CMO0000656');
  assert.equal(sent.detail.address.town, 'Murarrie');
  const cleared = stateToRows(stateWith([{ id: OID, saleId: SID, tons: 10, detail: null, __hasDetail: true }]), FARM).orders[0];
  assert.equal(cleared.detail, null);
});
check('and it reads back as it was', () => {
  const rows = stateToRows(stateWith([{ id: OID, saleId: SID, tons: 10, detail }]), FARM);
  const back = rowsToState(rows).years['2026'].orders[0];
  assert.equal(back.detail.issuedBy, 'Jodie Koczwara');
  assert.deepEqual(back.detail.address, { line1: '156 Colmslie Road', line2: '', town: 'Murarrie', state: 'QLD', postcode: '4170' });
  assert.equal(back.__hasDetail, true);
});

console.log('\n=== the screens ===');
check('the order sheet has the buyer\'s details fold and saves them', () => {
  const v = src('views/orders.js');
  for (const id of ["'od-by'", "'od-on'", "'od-grade'", "'od-ref'", "'od-dest'", "'od-contact'", "'od-book'", "'od-nil'"]) assert.ok(v.includes(`id: ${id}`), id);
  assert.ok(v.includes("addressFields('od-addr'") && v.includes('detail: cleanOrderDetail('));
  assert.ok(v.includes("addressFields('od-addr', src.detail?.address,"), 'the saved address is shown as it is saved');
});
check('choosing an order on a freight order brings its address over what was there', () => {
  const v = src('views/freightorders.js');
  assert.ok(v.includes('orderDelivery(order).text ? { deliverTo: fresh.deliverTo'));
});

console.log('\n=== what the examples carry ===');
check('the contract number on the order is checked against the contract', () => {
  assert.equal(contractMismatch({ detail: { contractNo: 'ADM106256' } }, { contractNo: 'ADM 106256' }), '');
  assert.ok(contractMismatch({ detail: { contractNo: 'ADM106256' } }, { contractNo: 'ADM999' }).includes('ADM106256'));
  assert.equal(contractMismatch({ detail: { contractNo: 'X1' } }, {}), '');
  assert.equal(contractMismatch({}, { contractNo: 'A' }), '');
});
check('the order keeps the buyer\'s contract no., site phone and comments', () => {
  const d = cleanOrderDetail({ contractNo: ' ADM106256 ', sitePhone: '07 0000 0000', comments: 'Chain of responsibility applies.' });
  assert.deepEqual([d.contractNo, d.sitePhone, d.comments], ['ADM106256', '07 0000 0000', 'Chain of responsibility applies.']);
});
check('the freight order keeps the carrier\'s details, the variety, the payment terms and the site phones, and nothing is no detail', () => {
  const d = cleanFreightDetail({ carrierAbn: '22 764 182 134', carrierContact: 'Brian', variety: 'PBA Warda', paymentTerms: '30 days end of week', deliverySitePhone: '07 2222 2222', packaging: 'Bulk', transportMode: 'Truck', pickupSite: 'Home', deliveryOrderNo: '57215', junk: 'x' });
  assert.deepEqual(Object.keys(d).sort(), ['carrierAbn', 'carrierContact', 'deliverySitePhone', 'paymentTerms', 'variety'], 'packaging, transport, site names and order numbers are no longer kept');
  assert.equal(cleanFreightDetail({}), null);
});
check('a new freight order starts with the farm\'s phone as the pick up phone and the buyer\'s site phone as the delivery phone', () => {
  const d = freightDefaults({ sale, order: { ...order, detail: { ...detail, sitePhone: '07 3333 3333' } }, business: { entityName: 'Kurrajong Downs', phone: '0400 000 000' } }).detail;
  assert.equal(d.pickupPhone, '0400 000 000'); assert.equal(d.deliverySitePhone, '07 3333 3333');
  assert.ok(!('packaging' in d) && !('pickupSite' in d) && !('deliverySite' in d) && !('deliveryOrderNo' in d));
});
check('the carrier\'s copy shows the NGR, the carrier\'s ABN, the terms, both sites and the buyer\'s other terms', () => {
  const pdf = latin1(freightOrderPdf({
    fo: { freightNo: 'F-1', carrier: 'Ace Haulage', tons: 10, rate: 40, rateBasis: 'per_t', detail: { carrierAbn: '22764182134', carrierContact: 'Brian', variety: 'PBA Warda', paymentTerms: '30 days end of week', pickupPhone: '07 1111 1111', deliverySitePhone: '07 2222 2222', pickupInstructions: 'Ring the gate' } },
    sale: { ...sale, cropYear: '26/27', tolerancePct: 5, toleranceCapTons: 20 }, order: { ...order, detail: { ...detail, comments: 'Chain of responsibility applies.' } },
    commodityName: 'Chickpeas', business: { entityName: 'Kurrajong Downs', abn: '11 111 111 111', ngr: '15120110' }, date: '2026-11-17',
  }));
  for (const s of ['NGR 15120110', '22764182134', 'PBA Warda', 'whichever is the lesser', '30 days end of week', '07 1111 1111', '07 2222 2222', 'Chain of responsibility applies.', 'Ring the gate']) assert.ok(pdf.includes(s), s);
  // the tolerance and both phone numbers are in the job; the two boxes that held them are gone
  assert.ok(!pdf.includes('COMMODITY AND TERMS') && !pdf.includes('SITES'));
});
check('the order sheet and freight sheet have the new fields', () => {
  const o = src('views/orders.js'); const f = src('views/freightorders.js');
  for (const id of ["'od-cno'", "'od-phone'", "'od-comments'"]) assert.ok(o.includes(`id: ${id}`), id);
  assert.ok(!o.includes('od-responded') && !o.includes('24 hours'), 'no 24 hour acceptance');
  for (const id of ['fd-abn', 'fd-variety', 'fd-terms', 'fd-pphone', 'fd-dphone', 'fd-bkc', 'fd-dins']) assert.ok(f.includes(`id: '${id}'`), id);
  for (const id of ['fd-pack', 'fd-mode', 'fd-psite', 'fd-pno', 'fd-dsite', 'fd-dno']) assert.ok(!f.includes(`id: '${id}'`), id + ' is gone');
});
check('the freight order detail goes to the server once there is some, and reads back', () => {
  const st = { currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [{ id: CID, name: 'C', unit: 't' }], fields: [], storages: [], movements: [], invoices: [], overheads: {}, sales: [{ id: SID, commodityId: CID, tons: 1, price: 1 }], orders: [], freightOrders: [{ id: OID, saleId: SID, tons: 5, rate: 1, detail: { carrierAbn: '123', variety: 'Hartog' } }], payables: [] } } };
  const rows = stateToRows(st, FARM);
  assert.equal(rows.freight_orders[0].detail.carrierAbn, '123');
  assert.equal(rowsToState(rows).years['2026'].freightOrders[0].detail.variety, 'Hartog');
  st.years['2026'].freightOrders[0] = { id: OID, saleId: SID, tons: 5, rate: 1 };
  assert.ok(!('detail' in stateToRows(st, FARM).freight_orders[0]));
});

console.log('\n=== pulling from the contract and the grain order ===');
check('a new grain order takes the contract\'s grade, number, contact and site, but never its tonnes or dates', () => {
  const s = { id: 's1', tons: 500, deliveryStart: '2026-12-01', deliveryEnd: '2027-01-31', grade: 'APW1', contractNo: 'RGT-4471', location: 'Newbridge', buyerContact: 'Sam Trader 0400 111 222 sam@buyer.example' };
  const d = orderDefaults({ sale: s, orders: [], movements: [], today: '2026-11-18' });
  assert.ok(!('tons' in d) && !('deliverFrom' in d) && !('deliverBy' in d));
  assert.deepEqual([d.detail.grade, d.detail.contractNo, d.detail.issuedBy, d.detail.destination], ['APW1', 'RGT-4471', 'Sam Trader', 'Newbridge']);
  assert.ok(d.detail.bookingContact.includes('0400 111 222') && d.detail.bookingContact.includes('sam@buyer.example'));
});
check('the last carrier on the contract is carried over', () => {
  const s = { id: 's1', tons: 500 };
  assert.equal(orderDefaults({ sale: s, orders: [{ id: 'o1', saleId: 's1', tons: 200, freightCompany: 'Ace Haulage' }] }).freightCompany, 'Ace Haulage');
});
check('a contract with a choice of grades leaves the grade for the order, and no contract is nothing', () => {
  assert.equal(orderDefaults({ sale: { id: 's1', tons: 1, grade: 'H2', gradeOptions: ['H1', 'H2'] } }).detail.grade, '');
  assert.deepEqual(orderDefaults({}).detail, {});
});
check('a new freight order to a carrier used before starts with their email, rate and particulars', () => {
  const past = [{ id: 'f0', carrier: 'Ace Haulage', carrierEmail: 'ace@carrier.example', rate: 18.5, rateBasis: 'per_t', detail: { carrierAbn: '12 345 678 901', paymentTerms: '30 days' } }];
  const f = freightDefaults({ sale, order, freightOrders: past });
  assert.equal(f.carrierEmail, 'ace@carrier.example');
  assert.equal(f.rate, 18.5);
  assert.equal(f.detail.carrierAbn, '12 345 678 901');
  assert.equal(f.detail.paymentTerms, '30 days');
});
check('the farm\'s address is the pick up, and a new carrier starts with nothing of anyone else\'s', () => {
  const f = freightDefaults({ sale, order, freightOrders: [{ id: 'f0', carrier: 'Other Co', carrierEmail: 'o@x.example', rate: 9 }], business: { address: '1 Farm Road, Moree NSW 2400' } });
  assert.equal(f.pickup, '1 Farm Road, Moree NSW 2400');
  assert.equal(f.carrierEmail, '');
  assert.notEqual(f.rate, 9);
});
check('the order sheet fills from the contract, and the freight sheet keeps what was typed', () => {
  const o = src('views/orders.js'), f = src('views/freightorders.js');
  assert.ok(o.includes('orderDefaults(') && o.includes('o-filled'));
  assert.ok(f.includes('freightDetailDefaults('));
});

console.log('\n=== booking, rejections and other terms on the freight order; the rate ===');
const pdfOf = (fo, o = order) => latin1(freightOrderPdf({ fo: { freightNo: 'F-1', carrier: 'Ace', tons: 10, rate: 40, rateBasis: 'per_t', pickup: 'Home', deliverTo: 'x', ...fo }, sale, order: o, commodityName: 'Chickpeas', business: {}, date: '2026-11-17' }));
check('a new freight order takes the grain order\'s booking instructions, rejections and other terms', () => {
  const f = freightDefaults({ sale, order: { ...order, detail: { ...detail, comments: 'Chain of responsibility applies.' } } });
  assert.ok(f.detail.deliveryInstructions.includes('Monday to Friday'));
  assert.equal(f.detail.rejectedOnArrival.split('\n')[1], 'Phosphine tablets');
  assert.ok(f.notes.includes('Chain of responsibility applies.'));
});
check('the carrier\'s copy prints the freight order\'s own wording, not the grain order\'s', () => {
  const p = pdfOf({ detail: { deliveryInstructions: 'Ring the gate first.', rejectedOnArrival: 'Wet grain' }, notes: 'Call on arrival.' });
  assert.ok(p.includes('Ring the gate first.') && p.includes('Wet grain') && p.includes('Call on arrival.'));
  assert.ok(!p.includes('Phosphine tablets') && !p.includes('Monday to Friday'));
});
check('the rate is on the carrier\'s copy unless it is turned off, and then it is not in the email either', () => {
  assert.ok(pdfOf({}).includes('RATE'));
  const p = pdfOf({ detail: { hideRate: true, variety: 'Hartog' } });
  assert.ok(!p.includes('RATE') && !p.includes('per tonne'));
  assert.deepEqual(cleanFreightDetail({ hideRate: true }), { hideRate: true });
  assert.equal(cleanFreightDetail({ hideRate: false }), null);
  const f = src('views/freightorders.js');
  assert.ok(f.includes('id="fo-showrate"') && f.includes('hideRate: !root.querySelector'));
  assert.ok(f.includes('showsRate(d) ? ` at ${rateText(d)}`'));
});

check('bookings contact and who issued the order are the freight order\'s own to change or clear', () => {
  const f = freightDefaults({ sale, order });
  assert.equal(f.detail.bookingContact, 'Bookings by email or on the terminal number');
  assert.equal(f.detail.orderIssuedBy, 'Jodie Koczwara, 17-11-2026');
  const p = pdfOf({ detail: { ownTerms: true, bookingContact: 'Ring Sam first', deliveryInstructions: 'Gate 2' } });
  assert.ok(p.includes('Ring Sam first') && !p.includes('Jodie Koczwara') && !p.includes('Bookings by email'));
});
check('once a freight order has its own terms, clearing them leaves them off, and does not read the grain order again', () => {
  const p = pdfOf({ detail: { ownTerms: true, variety: 'Hartog' } });
  assert.ok(!p.includes('BOOKINGS') && !p.includes('REJECTED ON ARRIVAL') && !p.includes('Phosphine tablets'));
  assert.ok(src('views/freightorders.js').includes('ownTerms: true'));
});

check('deliver to is the company, then the address; the company starts as the buyer and is the freight order\'s own to change', () => {
  assert.equal(freightDefaults({ sale, order }).detail.deliverCompany, 'ADM');
  const p = pdfOf({ deliverTo: 'Dock 4, 1 Rail Rd, Murarrie QLD 4170', detail: { ownTerms: true, deliverCompany: 'Port Services Pty Ltd' } });
  assert.ok(p.includes('Port Services Pty Ltd') && p.includes('1 Rail Rd'));
  assert.ok(!pdfOf({ deliverTo: 'x', detail: { ownTerms: true } }).includes('(ADM)'), 'cleared stays cleared');
  assert.ok(src('views/freightorders.js').includes("id: 'fd-dco'"));
});

check('a load on a freight order takes its destination from it: the company, then the address, never over what was typed', () => {
  assert.equal(freightDestination({ deliverTo: 'Dock 4, 1 Rail Rd, Murarrie QLD', detail: { ownTerms: true, deliverCompany: 'Port Services' } }, sale), 'Port Services, Dock 4, 1 Rail Rd, Murarrie QLD');
  assert.equal(freightDestination({ deliverTo: 'Dock 4, 1 Rail Rd' }, sale), 'ADM, Dock 4, 1 Rail Rd', 'the buyer when no company was set');
  assert.equal(freightDestination({ deliverTo: 'Dock 4', detail: { ownTerms: true } }, sale), 'Dock 4', 'a cleared company stays cleared');
  assert.equal(freightDestination({ deliverTo: 'ADM Dock 4', detail: { ownTerms: true, deliverCompany: 'ADM' } }, sale), 'ADM Dock 4', 'not said twice');
  assert.equal(freightDestination(null, sale), '');
  const m = src('views/movements.js');
  assert.ok(m.includes('applyFreightDestination(saleId)') && m.includes('el.value === destAuto'));
});

check('a freight order with everything on it is still one page', () => {
  const full = pdfOf({ pickup: 'Kurrajong Downs, 12 Back Rd, Newbridge NSW 2810', deliverTo: 'Newbridge Receival Site, 1 Rail Rd, Newbridge NSW 2810', notes: 'Gate 3, 7am to 4pm.\nHigh-vis required.', detail: { ownTerms: true, carrierAbn: '22764182134', variety: 'Hartog', paymentTerms: '30 days end of week', pickupPhone: '07 1111 1111', deliverySitePhone: '07 2222 2222', pickupInstructions: 'Ring the gate first.', deliveryInstructions: detail.booking, rejectedOnArrival: detail.nilTolerance, bookingContact: 'Bookings by email', orderIssuedBy: 'Jodie Koczwara', deliverCompany: 'ADM' } });
  assert.equal((full.match(/\/Type\s*\/Page[^s]/g) || []).length, 1);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
