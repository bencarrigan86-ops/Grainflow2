// Trial farms: inviting somebody to try the app on a farm of their own, and opening any of them from the support login.
//
// The database does the work (see supabase/migrations/20261118700000_trial_invites.sql): an invitation is only an email address waiting
// for somebody to sign up and create their farm, and when they do, the support login is added to that farm, read only, with no end
// date. Nothing here can give anybody access; it only asks the functions that can.

import { supabase } from './supabase.js?v=346';

import { asText, validEmail } from './trialtext.js?v=346';
export { validEmail, trialInviteMessage, farmLabel, standingText, trialNoticeText, trialSampleText, trialLink, emailFromTrialHash, ownSeasonGuess, startOwnWarning, startedLine } from './trialtext.js?v=346';

/** Is the signed-in person the support login? Anything that goes wrong is a no. */
export async function isSupportAdmin() {
  try {
    const { data, error } = await supabase.rpc('is_support_admin');
    return !error && data === true;
  } catch { return false; }
}

export async function createTrialInvite(email, note) {
  if (!validEmail(email)) throw new Error('That does not look like an email address.');
  const { data, error } = await supabase.rpc('trial_invite_create', { p_email: asText(email), p_note: asText(note) || null });
  if (error) throw new Error(error.message);
  return data;
}

export async function withdrawTrialInvite(id) {
  const { error } = await supabase.rpc('trial_invite_withdraw', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function listTrialInvites() {
  const { data, error } = await supabase.rpc('trial_invites_list');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listSupportFarms() {
  const { data, error } = await supabase.rpc('support_farms');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Does the signed-in person have an open trial invitation? A failure is a no: the screen just says nothing extra. */
export async function hasTrialInvite() {
  try {
    const { data, error } = await supabase.rpc('my_trial_invite');
    return !error && data === true;
  } catch { return false; }
}

/** Has support been given standing access to this farm as part of a trial? Owners only; anything else is false. */
export async function trialWatched(farmId) {
  try {
    const { data, error } = await supabase.rpc('support_standing', { p_farm_id: farmId });
    return !error && data === true;
  } catch { return false; }
}

/**
 * Is this a trial farm, and has its owner already started their own? Owners only; anything else (or no answer) reads as not a trial,
 * so the button is simply not offered.
 * @returns {Promise<{trial: boolean, startedAt: string|null}>}
 */
export async function trialFarmStatus(farmId) {
  try {
    const { data, error } = await supabase.rpc('trial_farm_status', { p_farm_id: farmId });
    const row = Array.isArray(data) ? data[0] : data;
    return !error && row?.trial === true ? { trial: true, startedAt: row.started_at ?? null } : { trial: false, startedAt: null };
  } catch { return { trial: false, startedAt: null }; }
}

/** Record that the owner started their own farm, and whether support keeps its read-only view. */
export async function recordStartOwn(farmId, keepSupport) {
  const { error } = await supabase.rpc('trial_start_own', { p_farm_id: farmId, p_keep_support: !!keepSupport });
  if (error) throw new Error(error.message);
}
