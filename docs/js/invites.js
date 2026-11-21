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
 * Owner is on this list. It was left off at first on the reasoning that a second
 * owner can change the bank details and remove everybody else, so it should be a
 * deliberate act in the database rather than a dropdown choice. That reasoning
 * suits a company and not a farm: a family partnership has several owners by
 * definition, and making the others go through a hand-typed SQL statement does
 * not make the decision more considered, it just makes it someone else's job.
 *
 * The database never had the restriction — farm_users has no single-owner
 * constraint and the invitations check constraint has always allowed 'owner'.
 * This was only ever a rule in the interface, so the honest fix is to state the
 * consequence plainly in the blurb and let the owner decide.
 *
 * The one thing an owner still cannot do is remove themselves, which is what
 * keeps every farm with at least one.
 */
export const INVITABLE_ROLES = [
  { value: 'owner',       label: 'Owner',
    blurb: 'Full access, including bank details, contract pricing, and inviting or removing anyone else — including you.' },
  { value: 'manager',     label: 'Farm manager',
    blurb: 'Runs fields, silos and loads, and handles orders, invoices and bills. Cannot see contract prices, overheads or the bank details in Settings, and cannot change the business details.' },
  { value: 'bookkeeper',  label: 'Bookkeeper',
    blurb: 'Contracts and prices, invoicing and bills. The financial side. Sees fields, loads and reports, but not Position, Storage, overheads or grain orders, and changes no fields, stock or loads.' },
  { value: 'farm_worker', label: 'Farm worker',
    blurb: 'Fields, storage and loads. No contract pricing, no position.' },
  { value: 'driver',      label: 'Driver',
    blurb: 'Loads only — the ones they cart and nothing else.' },
  { value: 'advisor',     label: 'Advisor',
    blurb: 'Looks and changes nothing: an agronomist, accountant or bank. Sees fields, production, inputs and sprays. Loads, prices and overheads only if you switch them on in Settings.' },
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

/**
 * May the person looking at the People card change this member?
 *
 * Everyone except themselves. It reads like a courtesy and it is actually the
 * only thing keeping a farm administrable: with several owners allowed, the
 * only person who can strip the last owner's access is that owner, and this is
 * the rule that says no. Every other combination is somebody else's decision to
 * make — an owner demoting another owner is a partnership matter, not a
 * software one.
 *
 * Unknown ids fail closed. A screen that could not work out who is looking at
 * it should offer nothing rather than everything.
 */
export function canEditMember(member, meId) {
  if (!meId || !member?.userId) return false;
  return member.userId !== meId;
}

export function roleLabel(role) {
  if (role === 'support') return 'Support (read only)';
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
