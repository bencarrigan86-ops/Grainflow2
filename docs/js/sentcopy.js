// Keeping a copy of what was sent: a document made in the app and sent out (a vendor declaration, and later a freight
// order or an invoice) is filed with its contract as an attachment, so what went to whom can be seen afterwards.
//
// It uses the same place and the same rules as a contract attached by hand (documents.js), so it shows in the
// contract's Documents list and follows its permissions. Needs signal: the send does not wait for it, and the
// caller says so if the copy could not be filed.

import { db } from './storage.js?v=237';
import { uploadSaleDocument } from './documents.js?v=237';

/**
 * Files `bytes` (a PDF) with the contract. Resolves to the document that was added, or throws a sentence a person
 * can act on.
 * @param {{saleId: string, bytes: Uint8Array, fileName: string, kind?: string}} item
 */
export async function fileSentCopy({ saleId, bytes, fileName, kind = 'other' }) {
  const sale = db.get().sales.find((s) => s.id === saleId);
  if (!sale) throw new Error('That contract is no longer there to file a copy with.');
  const file = new File([bytes], fileName, { type: 'application/pdf' });
  const stored = await uploadSaleDocument(file, { farmId: db.getFarmId(), saleId });
  const doc = { id: crypto.randomUUID(), kind, uploadedAt: new Date().toISOString(), ...stored };
  // read the sale again: the upload took a moment, and documents may have been added since
  const latest = db.get().sales.find((s) => s.id === saleId) || sale;
  db.upsertSale({ id: saleId, documents: [...(latest.documents || []), doc] });
  return doc;
}
