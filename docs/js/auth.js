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

import { supabase } from './supabase.js?v=69';

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
export async function getMembership() {
  const { data, error } = await supabase
    .from('farm_users')
    .select('farm_id, role, can_write_production, farms ( entity_name )')
    .is('deleted_at', null)
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return {
    farmId: row.farm_id,
    role: row.role,
    canWriteProduction: row.can_write_production,
    farmName: row.farms?.entity_name ?? '',
  };
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
