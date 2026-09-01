// The buyer's contract and the broker's note, kept beside the sale.
//
// These arrive by email and then live in an inbox, which is where they are
// when somebody needs to check whether the tolerance was 20 tonnes or 5%. The
// figures get typed into the app by hand — that is the grower's job and they
// are quick at it. This is only about keeping the paper they came from.
//
// Follows photos.js: a private bucket, farm_id as the leading path segment so
// the storage policies can decide ownership without a join, and short-lived
// signed URLs rather than public links. The one difference is who may look —
// a purchase contract has the price on it, so it is owners, managers and
// bookkeepers, not drivers. See the migration.
//
// No offline queue, deliberately. A photo is taken in a paddock and has to
// survive having no signal; a contract is filed at a desk. Adding an upload
// queue for a case that does not arise would be machinery to maintain for
// nothing, and the failure it would hide — an upload that silently never
// happened — is worse than being told to try again.

import { supabase } from './supabase.js?v=93';

const BUCKET = 'sale-documents';
const SIGNED_URL_TTL = 60 * 60;
const MAX_BYTES = 20 * 1024 * 1024;

/** What a document is, so the screen can label it rather than list filenames. */
export const DOCUMENT_KINDS = [
  { value: 'contract', label: "Buyer's contract" },
  { value: 'broker_note', label: "Broker's note" },
  { value: 'other', label: 'Other' },
];

export function kindLabel(kind) {
  return DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? 'Document';
}

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Check a file before it goes anywhere.
 *
 * The bucket enforces both of these too, and that is the enforcement that
 * counts. This exists so the answer arrives before a 20MB upload rather than
 * after it, and so the message says what is wrong in words.
 */
export function checkFile(file) {
  if (!file) return 'No file chosen.';
  if (file.size > MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 20MB.`;
  }
  // Some browsers report an empty type for a PDF picked from a cloud drive, so
  // the extension is accepted as a fallback rather than refusing a real file.
  const byName = /\.(pdf|jpe?g|png|webp|heic)$/i.test(file.name || '');
  if (!ALLOWED.includes(file.type) && !byName) {
    return 'Attach a PDF or a photo — that looks like neither.';
  }
  return null;
}

/**
 * Upload one document. Returns what the sale needs to remember about it.
 *
 * The stored name is a UUID, not the file's own name: two contracts called
 * "Contract.pdf" must not collide, and a filename is not something to trust in
 * a path. The real name is kept in the row instead, because "Contract
 * 672392.pdf" is how the grower knows which one it is.
 */
export async function uploadSaleDocument(file, { farmId, saleId }) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);

  const ext = (file.name?.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'pdf').toLowerCase();
  const path = `${farmId}/${saleId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });

  if (error) throw new Error(friendly(error.message));

  return {
    storagePath: path,
    fileName: file.name || `document.${ext}`,
    byteSize: file.size,
  };
}

/**
 * A temporary link for opening a stored document.
 *
 * Null rather than throwing: a document that cannot be reached should leave
 * one row on the screen unopenable, not stop the sale from rendering.
 */
export async function signedUrlFor(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) {
    console.error('Could not sign a document URL', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Remove the object behind a document.
 *
 * The row is soft-deleted by the caller like everything else in this app; this
 * is the file itself, and it is deliberately a hard delete. A soft-deleted row
 * pointing at a contract still sitting in the bucket is a copy of a commercial
 * document that nothing in the interface admits to holding.
 */
export async function removeSaleDocument(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  // Logged rather than thrown: the row is going regardless, and a file that
  // outlives it is a tidiness problem, not a reason to refuse the delete.
  if (error) console.error('Could not remove the stored document', error);
}

function friendly(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('exceeded the maximum allowed size')) return 'That file is over the 20MB limit.';
  if (m.includes('mime type') || m.includes('not allowed')) {
    return 'That file type is not accepted — attach a PDF or a photo.';
  }
  if (m.includes('row-level security') || m.includes('unauthorized')) {
    return 'You do not have permission to attach documents to a sale.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'No connection — the file could not be uploaded. Try again when you have signal.';
  }
  return message || 'The upload failed.';
}
