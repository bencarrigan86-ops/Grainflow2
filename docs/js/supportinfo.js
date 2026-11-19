// What goes into a problem report, and how support access is described. Pure: the screens (views/support.js) and the
// storage of recent errors (installErrorLog below, the only part that touches the browser) use it.
//
// A report carries what the app knows and nothing of the farm's records: the build, the role, whether it is online,
// what is waiting to send, the last send that failed, and the last few errors the app caught. The person adds a message.

const KEY = 'grainflow.errors';
export const MAX_ERRORS = 20;
const SHORT = 300;

const clip = (v, n = SHORT) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** One error as it is kept: when, where from, and what it said. Never the data behind it. */
export function errorEntry(kind, message, at = new Date().toISOString()) {
  return { at, kind: clip(kind, 40), message: clip(message) };
}

/** Adds an entry to the list, newest last, keeping the most recent `max`. Does not change the list it was given. */
export function addError(list, entry, max = MAX_ERRORS) {
  const next = [...(Array.isArray(list) ? list : []), entry];
  return next.slice(-max);
}

/** The errors kept on this device (empty when none, or when storage cannot be read). */
export function recentErrors(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.message === 'string') : [];
  } catch { return []; }
}

/** Keeps an error for a report. Never throws: a log that breaks the app is worse than no log. */
export function noteError(kind, message, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(addError(recentErrors(storage), errorEntry(kind, message)))); } catch { /* nowhere to keep it */ }
}

/** Starts noting what the page itself fails on, and the send and save failures the app already announces. */
export function installErrorLog(win = globalThis.window) {
  if (!win || win.__grainflowErrorLog) return;
  win.__grainflowErrorLog = true;
  win.addEventListener('error', (e) => noteError('error', e.message || (e.error && e.error.message) || 'script error'));
  win.addEventListener('unhandledrejection', (e) => noteError('promise', (e.reason && e.reason.message) || e.reason || 'rejected'));
  win.addEventListener('grainflow:push-failed', (e) => {
    const first = e.detail?.errors?.[0] || {};
    noteError('send failed', [first.table, first.code, first.message].filter(Boolean).join(': '));
  });
  win.addEventListener('grainflow:save-failed', (e) => noteError('save failed', e.detail?.error));
}

/**
 * @param {{message?: string, build?: string, role?: string, online?: boolean, sync?: {pending?: number, lastError?: object|null},
 *          errors?: object[], screen?: string, userAgent?: string}} src
 */
export function buildReport({ message = '', build = '', role = '', online = true, sync = {}, errors = [], screen = '', userAgent = '' } = {}) {
  const last = sync?.lastError || null;
  return {
    message: String(message || '').trim().slice(0, 4000),
    build: clip(build, 40),
    role: clip(role, 20),
    details: {
      online: !!online,
      waitingToSend: Number(sync?.pending) || 0,
      lastSendError: last ? [last.table, last.code, last.message].filter(Boolean).map((x) => clip(x, 160)).join(': ') : null,
      recentErrors: (errors || []).slice(-MAX_ERRORS).map((e) => ({ at: e.at, kind: clip(e.kind, 40), message: clip(e.message) })),
      screen: clip(screen, 60),
      device: clip(userAgent, 200),
    },
  };
}

/** The report as plain text, to show before it is sent and to copy when it cannot be. */
export function reportText(r) {
  const d = r.details || {};
  return [
    r.message || '(no message)',
    '',
    `Build: ${r.build || 'unknown'}`,
    `Role: ${r.role || 'unknown'}`,
    `Online: ${d.online ? 'yes' : 'no'}`,
    `Waiting to send: ${d.waitingToSend ?? 0}`,
    d.lastSendError ? `Last send error: ${d.lastSendError}` : 'Last send error: none',
    d.screen ? `Screen: ${d.screen}` : '',
    `Recent errors: ${(d.recentErrors || []).length ? '' : 'none'}`,
    ...(d.recentErrors || []).map((e) => `  ${String(e.at || '').slice(0, 19).replace('T', ' ')} ${e.kind}: ${e.message}`),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "23 Nov 2026, 3:15 pm" in the viewer's own time. */
/** The words beside the tick on "Report a problem": one tap sends the report and lets support look at the farm. */
export const SUPPORT_TICK = 'Let support look at my farm, read only, for 7 days';
export const SUPPORT_TICK_HINT = 'So they can see what you see. They cannot change anything or see your bank details. It switches itself off, and you can take it away in Settings.';
export const SUPPORT_ALREADY = 'Support can already see your farm, read only.';
export const SUPPORT_OWNER_ONLY = 'Only an owner can let support look at the farm. Ask the owner, who can do it from this same screen or under Settings.';

/** What the report says about support access, added under the message so whoever reads it knows (given, or tried and failed). */
export function accessNote(outcome) {
  if (outcome === 'given') return 'Support access: given for 7 days with this report.';
  if (outcome === 'failed') return 'Support access: the owner ticked the box but it did not go through.';
  return '';
}

export function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** What the owner is told about support access, from the expiry the database gave (null when there is none). */
export function supportStatusText(until, now = new Date()) {
  const end = until ? new Date(until) : null;
  if (!end || Number.isNaN(end.getTime()) || end <= now) return { on: false, text: 'Support cannot see your farm.' };
  return { on: true, text: `Support can look at your farm, read only, until ${whenText(end.toISOString())}. It switches itself off then.` };
}

/** The owner's status line when support was given standing access as part of a trial: no end date, and it can be switched off. */
export function standingStatus(text) { return { on: true, text }; }

const ACTION = { granted: 'Access given', revoked: 'Access taken away', opened: 'Support looked at the farm' };
/** One line of the access log. */
export function logLine(row) {
  return `${ACTION[row?.action] || row?.action || ''} · ${whenText(row?.at)}`;
}
