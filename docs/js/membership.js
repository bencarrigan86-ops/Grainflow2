// Which membership row is *mine*.
//
// This exists because of a fault that made the whole of role-aware navigation
// meaningless. getMembership() used to ask for farm_users rows and take the
// first one:
//
//     .from('farm_users').select(...).is('deleted_at', null).limit(1)
//
// with no filter on the signed-in user. The farm_users policy quite correctly
// lets any member see everyone on their farm — that is how a farm knows who is
// on it — so that query returns every membership for the farm, and limit(1)
// takes whichever row Postgres hands back first. A driver signing in was being
// handed the owner's role, and with it the owner's tab bar.
//
// Nothing failed. The server would still have refused the data on every screen
// the driver opened, and the writes with it, so no records were at risk. But
// the interface offered the whole book, which is not what anyone means by a
// driver login.
//
// The query is now filtered server-side. This module is the second line: given
// whatever came back, pick the row that belongs to this user and nothing else.
// It is pure so the rule can be tested without a browser, a login, or a server
// — which is the only way to be sure of a decision that failed silently once.

/**
 * @param {Array} rows    farm_users rows, each with at least user_id and role
 * @param {string} userId the signed-in user
 * @returns {object|null} the membership, or null if none of them is this user's
 */
/**
 * The membership remembered from the last time the server could be reached.
 *
 * Being unable to *ask* whether someone is on a farm is not the same answer as
 * "they are not on one", and the app used to conflate the two: offline, the
 * query errored, getMembership() returned null, and boot() read that as a
 * brand-new account and offered to name a farm. On a phone in a paddock — the
 * one place this app is supposed to work — it greeted you by proposing to
 * create a second farm over the top of your season.
 *
 * Keyed by user id, so a device two people share never hands one of them the
 * other's role. Anything unreadable is treated as nothing remembered.
 *
 * Worth being clear about what this is not: it is not a security decision. The
 * role only chooses which tabs are offered. What can actually be read stays
 * with the RLS policies on the server, which do not care what this device
 * wrote down about itself.
 */
export function recallMembership(saved, userId) {
  if (!userId || !saved || typeof saved !== 'object') return null;
  if (saved.userId !== userId) return null;
  return saved.membership ?? null;
}

export function pickMembership(rows, userId) {
  if (!Array.isArray(rows) || !userId) return null;

  const mine = rows.filter((r) => r && r.user_id === userId);
  if (mine.length === 0) return null;

  // Someone can belong to more than one farm — a contractor, or an agronomist
  // across two clients. Until there is a farm switcher, pick the oldest so the
  // app opens the same farm every time rather than flipping between them on
  // whatever order the server happened to return.
  mine.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const row = mine[0];

  return {
    farmId: row.farm_id,
    role: row.role,
    canWriteProduction: !!row.can_write_production,
    // The property name if it has been set, the trading entity if not. A farm
    // created before these were separate columns has only the entity, and
    // showing nothing would be worse than showing the name it has always had.
    farmName: row.farms?.farm_name || row.farms?.entity_name || '',
    // Kept so a later farm switcher has something to offer, and so the account
    // screen can say "1 of 2 farms" rather than pretending there is only one.
    memberships: mine.length,
  };
}
