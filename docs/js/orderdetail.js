// The detail a buyer puts on a grain order (a grain movement order): who issued it and when, the grade and destination, the
// delivery address and reference, how to book a slot, and what is rejected on arrival. It is kept with the order, and the
// freight order made from it reads it from there: the address becomes where the carrier delivers, and the booking
// instructions and site rules go to the carrier on the freight order, so the buyer's words are typed once.
//
// Pure: no screen and no storage in here.

import { cleanParts, hasParts, joinAddress } from './address.js?v=498';
import { splitContact } from './buyercontact.js?v=498';

const text = (v) => String(v ?? '').trim();
const MAX = 4000;

/** The detail as it is saved, or null when there is none. */
export function cleanOrderDetail(d) {
  if (!d || typeof d !== 'object') return null;
  const parts = cleanParts(d.address);
  const out = {
    issuedBy: text(d.issuedBy), issuedOn: text(d.issuedOn).slice(0, 10),
    grade: text(d.grade), destination: text(d.destination),
    ...(hasParts(parts) ? { address: parts } : {}),
    deliveryRef: text(d.deliveryRef), contractNo: text(d.contractNo), sitePhone: text(d.sitePhone),
    bookingContact: text(d.bookingContact), booking: text(d.booking).slice(0, MAX), nilTolerance: text(d.nilTolerance).slice(0, MAX),
    comments: text(d.comments).slice(0, MAX),
  };
  return Object.entries(out).some(([k, v]) => (k === 'address' ? !!v : v !== '')) ? out : null;
}

/** Does the contract number on the buyer's order differ from the contract it is against? '' when it agrees or either is missing. */
export function contractMismatch(order, sale) {
  const on = text(order?.detail?.contractNo).replace(/\s+/g, '').toUpperCase();
  const has = text(sale?.contractNo).replace(/\s+/g, '').toUpperCase();
  return on && has && on !== has ? `The order quotes contract ${text(order.detail.contractNo)}, this contract is ${text(sale.contractNo)}.` : '';
}


/** The rules as a list: one to a line, any bullet taken off, blanks left out. */
export const nilToleranceLines = (detail) => text(detail?.nilTolerance).split(/\r?\n/).map((l) => l.replace(/^\s*[-*•·\u2022\uF0B7]+\s*/, '').trim()).filter(Boolean);

/**
 * Where the grain is delivered, for a freight order: the destination and address as one line, and as the address boxes.
 * The site's name sits on the address's second line when that is free.
 */
export function orderDelivery(order) {
  const d = order?.detail;
  if (!d) return { text: '', parts: null };
  const parts = hasParts(d.address) ? cleanParts(d.address) : null;
  const site = text(d.destination);
  const withSite = parts ? { ...parts, line2: parts.line2 || site } : null;
  const line = parts ? joinAddress(withSite) : '';
  const full = [parts && !parts.line2 ? '' : site, line].filter(Boolean).join(', ');
  return { text: full || site, parts: withSite };
}

/** The grade on the buyer's order, or the contract's when the order does not say. */
export const orderGrade = (order, sale) => text(order?.detail?.grade) || text(sale?.grade);

/** Who the carrier books with and who issued the buyer's order, as [label, lines] pairs. (The site, its phone and the delivery reference are the freight order's own.) */
export function bookingRows(order) {
  const d = order?.detail;
  if (!d) return [];
  const by = [d.issuedBy, d.issuedOn ? d.issuedOn.split('-').reverse().join('-') : ''].filter(Boolean).join(', ');
  return [
    ['Bookings', d.bookingContact ? [d.bookingContact] : []],
    ['Order issued by', by ? [by] : []],
  ].filter(([, lines]) => lines.length);
}

/** Other terms the buyer put on the order, one to a line. */
export const orderCommentText = (order) => orderCommentLines(order).join('\n');
export const orderCommentLines = (order) => text(order?.detail?.comments).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// --- the freight order's own detail: what the carrier's copy carries beyond the job itself --------------------------------------

/** The detail on a freight order, or null when there is none. */
export function cleanFreightDetail(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of ['carrierAbn', 'carrierContact', 'carrierPhone', 'variety', 'paymentTerms',
    'pickupPhone', 'pickupInstructions', 'deliverySitePhone', 'deliveryInstructions', 'rejectedOnArrival', 'bookingContact', 'orderIssuedBy', 'deliverCompany']) {
    const v = text(d[k]).slice(0, MAX);
    if (v) out[k] = v;
  }
  // the rate is on the carrier's copy unless this is set
  if (d.hideRate) out.hideRate = true;
  // set once the freight order has been saved with its own terms: from then on what is blank is blank, never read from the grain order
  if (d.ownTerms) out.ownTerms = true;
  return Object.keys(out).length ? out : null;
}

/** Who issued the buyer's order, and when, as one line. */
export const orderIssuedText = (order) => [order?.detail?.issuedBy, order?.detail?.issuedOn ? order.detail.issuedOn.split('-').reverse().join('-') : ''].filter(Boolean).join(', ');

/** Does the carrier's copy show the rate? It does, unless the freight order says not to. */
export const showsRate = (fo) => !fo?.detail?.hideRate;

/**
 * What a new freight order starts with in its detail: the delivery site, its phone and the delivery reference come from the
 * buyer's order; the pick up site and phone are the farm's. Bulk by truck, which is nearly always the job.
 */
export function freightDetailDefaults({ order = null, sale = null, business = {} } = {}) {
  const o = order?.detail || {};
  return cleanFreightDetail({
    // the company the grain is delivered to: the buyer on the contract, before the address
    deliverCompany: sale?.buyer,
    pickupPhone: text(business.phone), deliverySitePhone: o.sitePhone,
    // the buyer's booking instructions and what it rejects on arrival: the freight order's own copy, to change for the carrier
    deliveryInstructions: o.booking, rejectedOnArrival: nilToleranceLines(o).join('\n'),
    bookingContact: o.bookingContact, orderIssuedBy: orderIssuedText(order),
  });
}

// --- a new grain order, from its contract ------------------------------------------------------------------------------------

/**
 * What a new grain order starts with, taken from its contract: the grade, the buyer's contract number and contact, the delivery
 * site, and whoever carted the contract's last order. Never the tonnes or the dates: an order is often a smaller or tighter part
 * of the contract, so those are the order's own.
 * @returns {{freightCompany: string, detail: object}}
 */
export function orderDefaults({ sale, orders = [] } = {}) {
  if (!sale) return { freightCompany: '', detail: {} };
  const mine = (orders || []).filter((o) => o.saleId === sale.id);
  const contact = splitContact(sale.buyerContact);
  const lastFreight = [...mine].reverse().map((o) => text(o.freightCompany)).find(Boolean) || '';
  return {
    freightCompany: lastFreight,
    detail: {
      grade: sale.gradeOptions?.length ? '' : text(sale.grade),
      contractNo: text(sale.contractNo),
      issuedBy: text(contact.name),
      bookingContact: [contact.email, contact.phone].filter(Boolean).join(' or '),
      destination: text(sale.location),
    },
  };
}
