-- What a real grain contract actually says.
--
-- Six live purchase contracts — Bunge, Cargill, Louis Dreyfus, CL Commodities,
-- KB Agri, Network Grains — all confirming trades brokered by the same broker,
-- all laid out differently, and all carrying the same dozen terms that this
-- schema had nowhere to put. Buyer, contract number, grade, tonnes, price,
-- delivery window and tolerance were already here. Everything below was being
-- lost, or crammed into the notes field.
--
-- These are not decorations. The carry charge is $2.50/MT/month against 1,500
-- tonnes; the broker reference is what the broker's own paperwork is filed
-- under; "weights to govern: destination" decides whose weighbridge settles an
-- argument about a load. A grower who cannot record them has to keep the PDF
-- open beside the app, which is the thing this is supposed to replace.
--
-- The split follows the one the schema already makes and for the same reason.
-- `sales` is what a field device may hold: what is being carted, where, when.
-- `sale_terms` is withheld: anything that moves the margin or names the money.
-- Brokerage and carry are commercial, so they go in the withheld half; the
-- delivery basis and whose weights govern are operational, so they do not.

alter table sales
  -- "2025/2026" as the contract writes it. The app's own season is a single
  -- label chosen by the grower ("2026"); the crop year is the buyer's, and on a
  -- document that has to be quoted back it needs to match theirs, not ours.
  add column if not exists crop_year        text,
  -- "Ex Farm", "Delivered Buyer", "Standard Fixed Grade".
  add column if not exists contract_type    text,
  -- Where the price is struck, which is not always where the grain goes:
  -- "Goondiwindi - 45km S/W" is a pricing point, "Delivered Brisbane" is a
  -- destination. `location` already holds the latter.
  add column if not exists pricing_point    text,
  -- 'destination' or 'origin'. Whose weighbridge settles a dispute.
  add column if not exists weights_to_govern text,
  -- "Buyers Call, 5 business days notice" — free text, because every issuer
  -- words it differently and an enum would refuse a real contract.
  add column if not exists delivery_terms   text,
  -- The trader or grower-services contact named on the document, so a query
  -- about the load does not start with hunting for the PDF.
  add column if not exists buyer_contact    text;

alter table sale_terms
  add column if not exists broker            text,
  -- The broker's own reference. Their paperwork is filed under it, and it is
  -- the fastest way to reconcile their statement against yours.
  add column if not exists broker_ref        text,
  -- 'seller' or 'buyer'. Seller on every one of the six.
  add column if not exists brokerage_paid_by text,
  -- Carry: the buyer pays to leave grain on farm past a date. Two contracts of
  -- the six carry $2.50/MT/month, which against 1,500 tonnes is $3,750 a month
  -- that nothing in this app could previously record.
  add column if not exists carry_rate        numeric(10,2),
  add column if not exists carry_from        date,
  -- payment_terms_days already exists and is not enough on its own: "30 days"
  -- from the delivery date and "30 days from the end of the week of delivery"
  -- are up to six days apart, which matters when it is the difference between
  -- one month's interest and the next.
  add column if not exists payment_terms_basis text,
  -- "GTA contract 3", "GTA Grower Contract 6", "Cargill GT&C 22 Aug 2024".
  -- Which rulebook governs is the first question in any dispute.
  add column if not exists trade_rules       text;
