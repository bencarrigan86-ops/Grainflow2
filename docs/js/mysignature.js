// The signed-in person's own handwritten signature.
//
// It belongs to the person, not to the farm: one row per user in user_signatures that only they can read or write
// (see the migration), so an owner's signature is never on a driver's phone. It is kept on the device too, so a
// document can be signed with no signal. Any document that needs a signature takes it from here: the vendor
// declaration today, contracts and others as they are added.

import { supabase } from './supabase.js?v=243';
import { getSession } from './auth.js?v=243';
import { cleanStrokes, strokesToText, strokesFromText, hasSignature } from './signature.js?v=243';

const KEY = 'grainflow.signature';

const readCache = (userId) => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && v.userId === userId) return { strokes: strokesFromText(v.strokes), name: v.name || '' };
  } catch { /* private window or damaged: no cache */ }
  return null;
};
const writeCache = (userId, strokes, name) => {
  try {
    if (!hasSignature(strokes)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ userId, strokes: strokesToText(strokes), name: name || '' }));
  } catch { /* nothing to do: the server copy is the record */ }
};

const userIdOf = async () => (await getSession())?.user?.id || null;

/** The saved signature as it was last known on this device, or null. Does not touch the network. */
export async function mySignatureOnDevice() {
  const id = await userIdOf();
  const hit = id ? readCache(id) : null;
  return hit && hasSignature(hit.strokes) ? hit : null;
}

/**
 * The saved signature: {strokes, name}, or null when there is none. What is on the device is returned at once and
 * refreshed from the server in the background (so a signature drawn on another device turns up); with nothing on
 * the device it waits for the server, unless there is no signal.
 */
export async function loadMySignature() {
  const id = await userIdOf();
  if (!id) return null;
  const local = readCache(id);
  const fetchRemote = async () => {
    const { data, error } = await supabase.from('user_signatures').select('strokes, signer_name').eq('user_id', id).maybeSingle();
    if (error) return local;
    if (!data) { writeCache(id, [], ''); return null; }
    const strokes = strokesFromText(data.strokes);
    writeCache(id, strokes, data.signer_name || '');
    return hasSignature(strokes) ? { strokes, name: data.signer_name || '' } : null;
  };
  if (!navigator.onLine) return local && hasSignature(local.strokes) ? local : null;
  if (local && hasSignature(local.strokes)) { fetchRemote().catch(() => {}); return local; }
  try { return await fetchRemote(); } catch { return null; }
}

/** Saves (or replaces) the signature. Throws a sentence a person can act on. */
export async function saveMySignature(strokes, name = '') {
  const clean = cleanStrokes(strokes);
  if (!clean.length) throw new Error('Draw your signature first.');
  const id = await userIdOf();
  if (!id) throw new Error('Sign in to save a signature.');
  if (!navigator.onLine) throw new Error('You need signal to save your signature. Try again when you have some.');
  const { error } = await supabase.from('user_signatures').upsert({
    user_id: id, strokes: strokesToText(clean), signer_name: String(name || '').trim() || null, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('Could not save it just now. Check your signal and try again.');
  writeCache(id, clean, String(name || '').trim());
  return { strokes: clean, name: String(name || '').trim() };
}

/** Removes the saved signature. */
export async function clearMySignature() {
  const id = await userIdOf();
  if (!id) return;
  if (!navigator.onLine) throw new Error('You need signal to remove your signature. Try again when you have some.');
  const { error } = await supabase.from('user_signatures').delete().eq('user_id', id);
  if (error) throw new Error('Could not remove it just now. Check your signal and try again.');
  writeCache(id, [], '');
}
