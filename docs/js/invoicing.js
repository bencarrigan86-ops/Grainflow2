// Who raises the invoice for a contract: the seller (the farm invoices the buyer) or the buyer, by a recipient created
// tax invoice (RCTI), which is the buyer's own record of what they owe the farm. Chosen on the contract, printed on the
// confirmation, and kept as a short word. Pure.

export const INVOICING = [
  { value: '', label: 'Not set' },
  { value: 'seller', label: 'Seller invoicing (we invoice the buyer)' },
  { value: 'rcti', label: 'Buyer RCTI (the buyer issues the invoice)' },
];
/** The invoicing words a contract confirmation prints. */
export const INVOICING_ON_CONTRACT = { seller: 'Seller invoicing', rcti: 'Buyer RCTI' };
export const INVOICING_VALUES = INVOICING.map((o) => o.value).filter(Boolean);
