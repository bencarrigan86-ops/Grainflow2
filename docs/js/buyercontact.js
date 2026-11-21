// The buyer's contact on a contract: a name, a phone number and an email.
//
// They are kept as the one line the contract has always held ("Jane Smith, 0400 123 456, jane@buyer.com.au"), so the
// vendor declaration, the Xero invoice and the freight order, which all read that line, carry on working and no new
// columns are needed. The form shows three boxes; this turns the line into three and back again. A line typed
// before the boxes existed ("Jane 0400 123 456") is pulled apart the same way. Pure.

import { emailIn, phoneIn } from './vendordec.js?v=500';

const clean = (v) => String(v ?? '').trim();

/** One line of contact text as { name, phone, email }. What is left once the phone and email are taken out is the name. */
export function splitContact(text) {
  const t = clean(text);
  const email = emailIn(t);
  const phone = phoneIn(t);
  let name = t;
  if (email) name = name.replace(email, ' ');
  if (phone) name = name.replace(phone, ' ');
  name = name.replace(/\s*[,;|/]\s*/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim();
  return { name, phone, email };
}

/** The three boxes as the one line kept on the contract: the ones filled in, separated by commas. */
export function joinContact({ name = '', phone = '', email = '' } = {}) {
  return [name, phone, email].map(clean).filter(Boolean).join(', ');
}

/** The lines the confirmation prints for the buyer's contact: the name, then the phone, then the email. */
export function contactLines(text) {
  const { name, phone, email } = splitContact(text);
  return [name && `Attn: ${name}`, phone && `Ph: ${phone}`, email && `Email: ${email}`].filter(Boolean);
}

/**
 * What is already known about a buyer from the contracts sold to them before: the contact line, the ABN and the address,
 * each taken from the most recent contract that has it (so one contract left blank does not lose what an earlier one had).
 * null when there is no earlier contract with that buyer (matched on the name, ignoring capitals).
 *
 * @returns {{contact: {name: string, phone: string, email: string}, abn: string, address: {buyerAddress: string, buyerAddressParts: object|undefined}|null}|null}
 */
export function buyerProfile(sales, name) {
  const key = clean(name).toLowerCase();
  if (!key) return null;
  const mine = (sales || [])
    .filter((s) => clean(s.buyer).toLowerCase() === key)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!mine.length) return null;
  const latest = (has) => mine.find(has) || null;
  const withContact = latest((s) => clean(s.buyerContact));
  const withAbn = latest((s) => clean(s.buyerAbn));
  const withAddress = latest((s) => clean(s.buyerAddress) || Object.values(s.buyerAddressParts || {}).some((v) => clean(v)));
  return {
    contact: splitContact(withContact?.buyerContact),
    abn: clean(withAbn?.buyerAbn),
    address: withAddress ? { buyerAddress: withAddress.buyerAddress, buyerAddressParts: withAddress.buyerAddressParts } : null,
  };
}
