// The words and small checks for trial farms, kept apart from the server calls so they can be tested without a connection.

export const asText = (v) => String(v ?? '').trim();

/** Good enough to catch a typo before the server is asked; the server checks again. */
export function validEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(asText(email));
}

/** What to send to the person: where to go, what to pick, and what they will be told about who can see the farm. */
export function trialInviteMessage(email, url = 'https://grainflow2.bencarrigan86.workers.dev') {
  return [
    'You are invited to try Commodity Mate.',
    '',
    `1. Open ${url}`,
    `2. Choose Create account and use this email address: ${asText(email).toLowerCase()}`,
    '3. Confirm the email we send you, then sign in.',
    '4. Name your farm and leave "A sample farm" chosen to start with some made-up numbers to look at. You can delete it and start your own whenever you like.',
    '',
    'Your trial farm is yours alone: nobody else I invite can see it. I can look at it, read only, to help if you get stuck. You can switch that off any time in Settings.',
  ].join('\n');
}

/** How a farm is named in the list: its name, then whose it is when it is somebody else's. */
export function farmLabel(row) {
  const name = asText(row?.farm_name) || 'Unnamed farm';
  return row?.role === 'support' && asText(row?.owner_email) ? `${name} (${asText(row.owner_email)})` : name;
}

/** The sentence an owner reads when support has standing access to a trial farm. */
export function standingText() {
  return 'The person who set up your trial can look at your farm, read only, to help you. They cannot change anything and cannot see your bank details. You can switch it off.';
}

/** What a trial owner is told in place of the "Start with" choice: a trial is always the sample farm. */
export function trialSampleText() {
  return 'Your trial starts with a sample farm to look around: an invented property in a season called "Sample 2026". Nothing in it is real.';
}

/** The season name offered for their own farm: this year's, by the calendar. */
export function ownSeasonGuess(now = new Date()) {
  return String(now.getFullYear());
}

/** The confirm text before the sample is cleared. */
export function startOwnWarning() {
  return 'This clears the sample farm (the invented paddocks, silos, contracts and loads) and gives you a blank season to start your own. Nothing real is lost. It cannot be brought back.';
}

/** One line in the support login's list: who has started their own, and when. */
export function startedLine(row, locale = 'en-AU') {
  if (!row?.started_at) return '';
  let when = '';
  try { when = new Date(row.started_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }); } catch { /* no date */ }
  return `started their own farm${when ? ` ${when}` : ''}`;
}

/** The sentence a new trial owner reads before they create the farm. */
export function trialNoticeText() {
  return 'You were invited to try this. Your farm is yours alone. The person who invited you can look at it, read only, to help you; you can switch that off in Settings.';
}
