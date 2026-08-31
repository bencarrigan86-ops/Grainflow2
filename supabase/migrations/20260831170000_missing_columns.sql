-- The 27 values the app saves and the database had nowhere to put.
--
-- Found by tests/roundtrip.test.mjs, which reads the object literals the views
-- actually pass to db.upsertField(), db.upsertSale() and the rest, sends them
-- through mapping.js to rows and back, and reports what does not come home.
-- Nothing here is my idea of what a paddock or a contract has on it; every
-- column below exists because a form writes it.
--
-- The shape of the mistake is worth recording, because it was not one missing
-- column. The mapping was reading `sale.tonnes`, `sale.deliveryPeriod`,
-- `sale.paymentTermsDays` and `sale.contractValue` — none of which any build of
-- the app has ever written — while `tons`, `deliveryStart`, `deliveryEnd`,
-- `freight`, `premiumDiscount`, `ginning`, `leviesPct`, the tolerance pair, the
-- broker note and the buyer's ABN and address were all discarded on push. The
-- schema was written from an imagined app rather than the real one, and every
-- loss was silent: no error, no warning, the value simply absent after the next
-- sync.
--
-- The split follows the one the schema already makes. `sales` and `fields` are
-- what a field device may hold; `sale_terms` and `field_agronomy` are withheld
-- as whole tables. So delivery quantities, dates, location and tolerance sit
-- with the load, and anything that adds up to margin sits behind the wall.

-- ---------------------------------------------------------------------------
-- Paddocks
--
-- notes rides on `fields` because a note about access, a boggy corner or a gate
-- is exactly what the person carting needs. The agronomy program does not.
-- ---------------------------------------------------------------------------

alter table fields
  add column if not exists notes text;

alter table field_agronomy
  add column if not exists soil_test_n_kg_ha        numeric(10,2) not null default 0,
  add column if not exists target_yield_override_t_ha numeric(10,3) not null default 0,
  add column if not exists starter_required_kg_ha   numeric(10,2) not null default 0,
  add column if not exists starter_applied_kg_ha    numeric(10,2) not null default 0,
  -- Dated applications, not a single running total: [{date, kgHa}, …]. Kept as
  -- jsonb rather than a fifth table because nothing queries across them — they
  -- are read back with the paddock and displayed as a list. If that changes,
  -- this becomes a table and the jsonb migrates into it.
  add column if not exists urea_applications        jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Contracts — the operational half
--
-- tons maps onto the existing `tonnes` column; the app spells it the American
-- way and the column the British way, which cost nothing to reconcile in the
-- mapping and would cost a rewrite to reconcile here.
-- ---------------------------------------------------------------------------

alter table sales
  add column if not exists location           text,
  add column if not exists delivery_start     date,
  add column if not exists delivery_end       date,
  add column if not exists tons_delivered     numeric(14,3) not null default 0,
  add column if not exists tolerance_pct      numeric(6,3)  not null default 0,
  add column if not exists tolerance_cap_tons numeric(14,3) not null default 0,
  add column if not exists notes              text;

-- delivery_period, sale_terms.payment_terms_days and sale_terms.contract_value
-- are left in place but nothing writes them: they were columns for an app that
-- does not exist. Left rather than dropped because dropping is irreversible and
-- they cost nothing; flagged here so the next reader does not mistake an empty
-- column for a missing feature.

-- ---------------------------------------------------------------------------
-- Contracts — the commercial half
--
-- Everything that moves the margin. Withheld from field devices by virtue of
-- living in sale_terms at all; no policy change is needed.
--
-- premium_discount is deliberately signed: a discount is a negative premium,
-- and the form allows it.
-- ---------------------------------------------------------------------------

alter table sale_terms
  add column if not exists freight          numeric(12,2) not null default 0,
  add column if not exists premium_discount numeric(12,2) not null default 0,
  add column if not exists ginning          numeric(14,2) not null default 0,
  -- Stored as a fraction, not a percentage — the form divides by 100 on the way
  -- in. 0.0102, not 1.02.
  add column if not exists levies_pct       numeric(8,6)  not null default 0,
  add column if not exists broker_note      text,
  add column if not exists buyer_abn        text,
  add column if not exists buyer_address    text;

-- ---------------------------------------------------------------------------
-- Commodities and storage
-- ---------------------------------------------------------------------------

alter table commodities
  add column if not exists unit                 text not null default 't',
  add column if not exists bales_per_round_bale numeric(8,2)  not null default 0,
  add column if not exists default_yield_t_ha   numeric(10,3) not null default 0,
  add column if not exists target_yield_t_ha    numeric(10,3) not null default 0,
  add column if not exists notes                text;

alter table storages
  -- What a tally store counts: round bales, lint bales, or tonnes.
  add column if not exists unit_label text not null default 't';
