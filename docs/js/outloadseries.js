// A person's outload series: the digit in the middle of their numbers (26 1 001), kept against them on the farm by the server.
// The phone asks for its own digit once it has signal, and remembers it, so a number can be given out in a paddock with none.

import { supabase } from './supabase.js?v=354';

const KEY = (userId, farmId) => `grainflow.outloadSeries.${userId}.${farmId}`;

/** The digit this phone last knew for this person on this farm (null when it has never heard one). */
export function rememberedSeries(userId, farmId) {
  try {
    const v = Number(localStorage.getItem(KEY(userId, farmId)));
    return v >= 1 && v <= 9 ? v : null;
  } catch { return null; }
}

function remember(userId, farmId, series) {
  try {
    if (series >= 1 && series <= 9) localStorage.setItem(KEY(userId, farmId), String(series));
    else localStorage.removeItem(KEY(userId, farmId));
  } catch { /* private mode: the digit is asked for again next time */ }
}

/**
 * This person's digit from the server. If the server cannot be asked, whatever this phone last knew is kept: not being able to
 * ask is not the same as having no digit.
 * @returns {Promise<number|null>}
 */
export async function loadMySeries(userId, farmId) {
  if (!userId || !farmId) return null;
  try {
    const { data, error } = await supabase.from('farm_users').select('outload_series')
      .eq('user_id', userId).eq('farm_id', farmId).is('deleted_at', null).limit(1);
    if (error) throw error;
    const n = Number(data?.[0]?.outload_series);
    const series = n >= 1 && n <= 9 ? n : null;
    remember(userId, farmId, series);
    return series;
  } catch { return rememberedSeries(userId, farmId); }
}

/** Everyone's digit on the farm, for the People card: a Map of user id to digit. Owners read the whole list. */
export async function listSeries(farmId) {
  const { data, error } = await supabase.from('farm_users').select('user_id, outload_series')
    .eq('farm_id', farmId).is('deleted_at', null);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.user_id, Number(r.outload_series) || null]));
}

/** The owner gives somebody a different digit. One already in use is refused by the server; the message says so plainly. */
export async function setMemberSeries(farmId, userId, series) {
  const { error } = await supabase.from('farm_users')
    .update({ outload_series: series, updated_at: new Date().toISOString() })
    .eq('farm_id', farmId).eq('user_id', userId);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('Somebody else on the farm already has that digit. Give them a different one first.');
    throw new Error(error.message);
  }
}
