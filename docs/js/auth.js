// Authentication and farm membership.
//
// Two separate questions live here and it is worth keeping them apart:
//
//   Who are you?      — Supabase Auth. A user exists independently of any farm.
//   What may you do?  — farm_users. Role and capability flags, per farm.
//
// A user with no membership row is signed in but has no farm, which is the
// state you are in for the few seconds between creating an account and creating
// a farm. The app has to handle it rather than assume it away.

import { supabase } from './supabase.js?v=81';
import { pickMembership } from './membership.js?v=81';
import { newToken, expiryFrom } from './invites.js?v=81';

/** The signed-in user, or null. */
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
}

/** The active session, or null. Cheap — reads from local storage, no network. */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * This user's membership: { farm_id, role, can_write_production, farm_name }.
 * Null when they belong to no farm.
 *
 * One row is expected. A user on several farms is a Phase 4 problem — when it
 * arrives this returns a list and the app grows a farm switcher.
 */
/**
 * The signed-in user's membership: which farm, and as what.
 *
 * The user_id filter is not decoration. The farm_users policy lets any member
 * see everyone on their farm — which is right, a farm should know who is on it
 * — so an unfiltered query returns every membership row and the old `.limit(1)`
 * took whichever came back first. A driver signing in was handed the owner's
 * role, and the tab bar with it. Every screen was still empty, because the
 * server refused the data, but the app offered the whole book.
 *
 * pickMembership() checks the same thing again on the way out. Two lines of
 * defence for one question, because the failure was silent: nothing errored,
 * nothing looked wrong from the outside, and the only symptom was a driver
 * seeing tabs they should not have.
 */
export async function getMembership(userId) {
  // The id is passed in, deliberately. Calling supabase.auth.getUser() here
  // hung the app on sign-in: getMembership runs inside boot(), boot() runs from
  // the onAuthStateChange callback, and supabase-js serialises auth calls
  // behind a lock the callback itself is holding. The await never returns and
  // the app sits on "Loading your farm…" forever — no error, no console line,
  // just a screen that never changes.
  //
  // boot() already has the session, so the id costs nothing to hand over.
  if (!userId) return null;

  const { data, error } = await supabase
    .from('farm_users')
    .select('user_id, farm_id, role, can_write_production, created_at, farms ( entity_name )')
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (error || !data) return null;
  return pickMembership(data, userId);
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(friendly(error.message));
}

/**
 * Create an account. Note this does NOT create a farm — Supabase may require
 * the email to be confirmed first, and there is no point creating a farm for a
 * session that does not exist yet. createFarm() runs once they are actually in.
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) throw new Error(friendly(error.message));
  // No session means Supabase is holding the account pending email confirmation.
  return { needsConfirmation: !data.session };
}

/**
 * Create a farm and make this user its owner, in one transaction.
 *
 * You cannot insert a farm you are not a member of, and you cannot be a member
 * of a farm that does not exist. The create_farm() function in the RLS
 * migration does both as the definer, which is the only clean way out of that.
 */
export async function createFarm(entityName) {
  const farmId = crypto.randomUUID();
  const { error } = await supabase.rpc('create_farm', {
    p_farm_id: farmId,
    p_entity_name: entityName.trim(),
  });
  if (error) throw new Error(error.message);
  return farmId;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------------------
// Getting other people onto the farm
//
// Five calls, and the split between them is the security model: reading who is
// here and writing an invitation are ordinary table operations an owner is
// allowed to do, so they go straight through the client and the RLS policies
// judge them. Accepting is the one thing the invitee is *not* allowed to do —
// they have no membership row yet, so every policy on farm_users refuses them
// — and that goes through the definer function, which checks the token, the
// expiry and the email before it writes anything.
//
// See supabase/migrations/20260901100000_invitations.sql for the other half.
// ---------------------------------------------------------------------------

/**
 * Write an invitation and return the link to send.
 *
 * Nothing is emailed. The owner gets a URL and sends it however they already
 * talk to that person. The link is not the secret — the email match on the
 * server is — so it can travel over a text message without worry.
 */
export async function createInvitation({ farmId, email, role, canWriteProduction = false }) {
  const session = await getSession();
  const me = session?.user?.id ?? null;
  const token = newToken();

  const { error } = await supabase.from('invitations').insert({
    id: crypto.randomUUID(),
    farm_id: farmId,
    email: String(email).trim().toLowerCase(),
    role,
    can_write_production: !!canWriteProduction,
    token,
    expires_at: expiryFrom().toISOString(),
    created_by: me,
    updated_by: me,
  });

  // A duplicate token is not a thing that happens to 256 bits, but the column
  // is unique and pretending otherwise would hide a real fault behind a
  // meaningless message.
  if (error) throw new Error(friendlyInvite(error));
  return { token };
}

/**
 * Everyone on this farm, with their email addresses.
 *
 * Through a function rather than a select, because farm_users holds user ids
 * and the addresses live in auth.users — which no client may read, correctly,
 * since it is every user of the platform and not just this farm's.
 */
export async function listMembers(farmId) {
  const { data, error } = await supabase.rpc('farm_members', { p_farm: farmId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
    canWriteProduction: !!r.can_write_production,
    joinedAt: r.joined_at,
  }));
}

/** Invitations sent and not yet taken up. Owners only — the function says so. */
export async function listPendingInvitations(farmId) {
  const { data, error } = await supabase.rpc('pending_invitations', { p_farm: farmId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    canWriteProduction: !!r.can_write_production,
    token: r.token,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

/**
 * Withdraw an invitation.
 *
 * Soft delete, matching every other table here: the row stays so the history
 * of who was asked and when survives, and accept_invitation() skips it because
 * it only looks at rows with deleted_at null.
 */
export async function revokeInvitation(id) {
  const { error } = await supabase
    .from('invitations')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Take someone off the farm.
 *
 * Also a soft delete, and deliberately reversible: re-inviting them un-deletes
 * this same row, which is what bringing back a seasonal worker should do.
 */
export async function removeMember(farmId, userId) {
  const { error } = await supabase
    .from('farm_users')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('farm_id', farmId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Turn an invitation into a membership.
 *
 * Everything that matters happens on the server. This function cannot be made
 * to write a membership by lying to it: the token has to exist, be unused, be
 * unexpired, and have been issued to the address the caller is signed in as.
 * The errors come back already written for a person to read.
 */
export async function acceptInvitation(token) {
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) throw new Error(error.message);
  return { farmId: data?.farm_id, role: data?.role, farmName: data?.farm_name ?? '' };
}

function friendlyInvite(error) {
  const m = String(error?.message || '').toLowerCase();
  if (error?.code === '42501' || m.includes('row-level security')) {
    return 'Only the farm owner can invite people.';
  }
  if (error?.code === '23505') {
    return 'That invitation could not be created — try again.';
  }
  return error?.message || 'Could not create the invitation.';
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event) => callback(event));
  return () => data?.subscription?.unsubscribe();
}

/** Supabase's messages are accurate but terse. These are the ones users hit. */
function friendly(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (m.includes('email not confirmed')) {
    return 'Check your email and click the confirmation link, then sign in again.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'An account with that email already exists — try signing in instead.';
  }
  if (m.includes('password should be at least')) {
    return 'Password needs to be at least 6 characters.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'That does not look like a valid email address.';
  }
  return message;
}
