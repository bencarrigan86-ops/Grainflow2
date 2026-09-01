// Inviting someone onto a farm.
//
// No email is sent. The owner gets a link and sends it however they already
// talk to that person — text, WhatsApp, a photo of a screen. Supabase can send
// email, but doing it properly needs a domain, a verified sender and a week of
// watching whether messages land in junk; a link you paste works this
// afternoon, and nothing here changes when email is added later.
//
// The link is not the security boundary — the email match on the server is.
// accept_invitation() refuses anyone signed in as a different address, so a
// forwarded link, or one read off a screenshot, is useless to whoever finds it.
// That is what lets us be relaxed about the link travelling over a text message.
//
// Everything in this file is pure so it can be tested without a browser.

/**
 * Roles an owner can hand out.
 *
 * Owner is deliberately absent. A second owner can change the business details,
 * the bank account and everyone else's role, and that is a decision to make
 * deliberately in the database rather than from a dropdown next to "driver".
 */
export const INVITABLE_ROLES = [
  { value: 'manager',     label: 'Farm manager',
    blurb: 'Everything except the bank details and contract pricing.' },
  { value: 'bookkeeper',  label: 'Bookkeeper',
    blurb: 'Contracts, invoicing and overheads. The financial side.' },
  { value: 'farm_worker', label: 'Farm worker',
    blurb: 'Paddocks, storage and movements. No contract pricing, no position.' },
  { value: 'driver',      label: 'Driver',
    blurb: 'Movements only — the loads they cart and nothing else.' },
];

export const DEFAULT_EXPIRY_DAYS = 14;

/**
 * A token with no meaning in it.
 *
 * Two UUIDs, hyphens stripped: 256 bits from the platform's cryptographic
 * source. Not derived from the email, the farm or the time, because anything
 * guessable is a link somebody else can construct.
 */
export function newToken() {
  const uuid = () => globalThis.crypto.randomUUID().replace(/-/g, '');
  return uuid() + uuid();
}

/** The link to send. Same origin and path as the app the owner is looking at. */
export function inviteLink(token, origin, pathname = '/') {
  const base = `${origin}${pathname}`.replace(/\/+$/, '/');
  return `${base}#/join/${token}`;
}

/** Pull a token back out of a link or a bare hash. Null if there isn't one. */
export function tokenFromHash(hash) {
  const m = String(hash || '').match(/#\/join\/([A-Za-z0-9_-]{16,})/);
  return m ? m[1] : null;
}

/**
 * Check an invitation before it is written.
 *
 * Deliberately strict about the address: the server refuses anyone signed in as
 * a different one, so a typo here does not create a security hole — it creates
 * a link that can never be accepted by anybody, and a person waiting for an
 * invitation that will never work.
 */
export function validateInvite({ email, role, existingMembers = [], pendingInvites = [] }) {
  const problems = [];
  const clean = String(email || '').trim().toLowerCase();

  if (!clean) problems.push('Enter the email address they will sign in with.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    problems.push(`"${email}" does not look like an email address.`);
  }

  if (!INVITABLE_ROLES.some((r) => r.value === role)) {
    problems.push('Choose what they will be able to do.');
  }

  const already = existingMembers.find((m) => String(m.email || '').toLowerCase() === clean);
  if (already) problems.push(`${clean} is already on this farm as a ${roleLabel(already.role)}.`);

  const waiting = pendingInvites.find((i) => String(i.email || '').toLowerCase() === clean);
  if (waiting) {
    problems.push(`${clean} already has an invitation waiting. Revoke it first if the role has changed.`);
  }

  return { ok: problems.length === 0, email: clean, role, problems };
}

export function roleLabel(role) {
  if (role === 'owner') return 'Owner';
  return INVITABLE_ROLES.find((r) => r.value === role)?.label ?? role;
}

/** When an invitation created now should stop working. */
export function expiryFrom(now = new Date(), days = DEFAULT_EXPIRY_DAYS) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * How an owner reads an expiry.
 *
 * "Expires in 3 days" rather than a timestamp, because the only question being
 * asked of this number is whether to chase the person today.
 */
export function expiryText(expiresAt, now = new Date()) {
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return 'no expiry recorded';
  const ms = when.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `expires in ${days} days`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 2) return `expires in ${hours} hours`;
  return 'expires within the hour';
}
