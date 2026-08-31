// Movement photos in Supabase Storage.
//
// The app still captures a photo exactly as it did — img.js compresses it and
// stamps the date into the corner, producing a data URL. What changed is where
// that data URL ends up: it is uploaded on save and the movement keeps only a
// path, instead of carrying a few hundred kilobytes of base64 in the row.
//
// Two fields exist on a movement during the transition and both are handled:
//
//   photoDataUrl  legacy, or captured-but-not-yet-uploaded. Renders directly.
//   photoPath     an object in the bucket. Rendered through a signed URL.
//
// Keeping both is what makes the app work offline. A photo taken in a paddock
// stays a data URL until there is signal to upload it, and displays fine in
// the meantime.

import { supabase } from './supabase.js?v=67';

const BUCKET = 'movement-photos';
const SIGNED_URL_TTL = 60 * 60; // an hour is plenty for a screen, short enough to not be a link

/** data: URL -> Blob, without a network round trip. */
function dataUrlToBlob(dataUrl) {
  const [header, encoded] = String(dataUrl).split(',');
  const mime = (header.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const extFor = (mime) =>
  ({ 'image/png': 'png', 'image/webp': 'webp' })[mime] || 'jpg';

/**
 * Upload one photo. Returns the object path to store on the movement.
 *
 * The path leads with farm_id because that is what the storage policies key
 * off — see the migration. Anything else and an object's ownership cannot be
 * decided without a join, which storage policies cannot do.
 */
export async function uploadPhoto(dataUrl, { farmId, movementId }) {
  const blob = dataUrlToBlob(dataUrl);
  const path = `${farmId}/${movementId}/${crypto.randomUUID()}.${extFor(blob.type)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });

  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

/**
 * A temporary URL for displaying a stored photo. Null rather than throwing on
 * failure — a missing photo should leave a gap in a ticket, not stop the ticket
 * from rendering.
 */
export async function signedUrlFor(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function deletePhoto(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

/**
 * Whatever it takes to show this movement's photo: a stored object, a
 * not-yet-uploaded capture, or nothing.
 */
export async function displayUrlFor(movement) {
  if (movement?.photoDataUrl) return movement.photoDataUrl;
  if (movement?.photoPath) return signedUrlFor(movement.photoPath);
  return null;
}

/**
 * Upload anything still held as a data URL and swap it for a path. Called on
 * save and again when the device reconnects, so a photo taken out of range
 * makes its own way up without the grower doing anything.
 *
 * Mutates in place and reports whether anything changed, so the caller knows
 * whether the farm needs saving again.
 */
export async function flushPendingPhotos(state, farmId) {
  let changed = 0;
  const failures = [];
  for (const year of Object.values(state?.years || {})) {
    for (const m of year.movements || []) {
      if (!m.photoDataUrl) continue;
      try {
        m.photoPath = await uploadPhoto(m.photoDataUrl, { farmId, movementId: m.id });
        delete m.photoDataUrl;
        changed += 1;
      } catch (e) {
        // Leave it as a data URL and try again next time. A failed upload must
        // never lose the photo — it is the one thing here that cannot be
        // reconstructed.
        //
        // Reported loudly rather than warned quietly: a photo that silently
        // never uploads looks identical to one that did, right up until the
        // day someone needs it.
        console.error('Photo upload FAILED (kept locally, will retry):', e.message);
        failures.push(e.message);
      }
    }
  }
  if (failures.length) {
    // Surfaced on window so the app can show it; the details are already in
    // the console for whoever is debugging.
    window.dispatchEvent(new CustomEvent('grainflow:photo-upload-failed', {
      detail: { count: failures.length, messages: [...new Set(failures)] },
    }));
  }
  return { changed, failures };
}
