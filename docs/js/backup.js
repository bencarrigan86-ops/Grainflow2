// A reminder to keep your own copy of the farm: when it was last backed up, and when a backup is due.
//
// The backup itself is db.exportJSON(); this remembers the day it was last downloaded (on this device only; it is a
// courtesy, not data) and says when it has been long enough to ask again.

const KEY = 'grainflow.lastBackup';
export const BACKUP_EVERY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** The time the backup was last downloaded on this device, or null. */
export function lastBackup() {
  try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}

export function markBackup(now = Date.now()) {
  try { localStorage.setItem(KEY, String(now)); } catch { /* the reminder just comes back */ }
}

/** Whole days since `last`, or null if never. */
export const daysSince = (last, now = Date.now()) => (last ? Math.max(0, Math.floor((now - last) / DAY)) : null);

/** "never", "today", "yesterday" or "12 days ago". */
export function backupAgeText(last, now = Date.now()) {
  const d = daysSince(last, now);
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** A backup is due once the farm holds some records and it has been `days` days (or it has never been done). */
export function backupDue({ last, hasRecords, now = Date.now(), days = BACKUP_EVERY_DAYS }) {
  if (!hasRecords) return false;
  const d = daysSince(last, now);
  return d === null || d >= days;
}

/** Downloads the backup file and remembers the day. */
export function downloadBackup(json, now = new Date()) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grainflow-backup-${now.toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  markBackup(now.getTime());
}
