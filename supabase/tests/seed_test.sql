-- Test fixtures. Run as superuser so RLS is bypassed while seeding.
-- Two farms, so every read can be checked for cross-tenant leakage.

insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),  -- owner       farm A
  ('a0000000-0000-0000-0000-000000000002'),  -- manager     farm A
  ('a0000000-0000-0000-0000-000000000003'),  -- bookkeeper  farm A
  ('a0000000-0000-0000-0000-000000000004'),  -- farm worker farm A
  ('a0000000-0000-0000-0000-000000000005'),  -- driver      farm A
  ('b0000000-0000-0000-0000-000000000001');  -- owner       farm B

insert into farms (id, entity_name) values
  ('11111111-0000-0000-0000-00000000000a', 'Farm A'),
  ('11111111-0000-0000-0000-00000000000b', 'Farm B');

insert into farm_users (id, farm_id, user_id, role, can_write_production) values
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'owner',       true),
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'manager',     true),
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'bookkeeper',  false),
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000004', 'farm_worker', true),
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000005', 'driver',      false),
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000001', 'owner',       true);

-- Farm A data
insert into seasons (id, farm_id, label, is_current) values
  ('22222222-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a', '2026', true),
  ('22222222-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000b', '2026', true);

insert into commodities (id, farm_id, season_id, name) values
  ('33333333-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 'Wheat'),
  ('33333333-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-00000000000b', 'Wheat');

insert into fields (id, farm_id, season_id, name, area_ha, commodity_id) values
  ('44444444-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 'Home Block', 320, '33333333-0000-0000-0000-00000000000a'),
  ('44444444-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000b', '22222222-0000-0000-0000-00000000000b', 'B Block',    150, '33333333-0000-0000-0000-00000000000b');

insert into field_agronomy (id, farm_id, field_id, yield_t_ha, seed_variety) values
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', '44444444-0000-0000-0000-00000000000a', 3.2, 'Scepter');

insert into storages (id, farm_id, season_id, kind, name, capacity_tons) values
  ('55555555-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 'silo', 'Silo 1', 800);

insert into sales (id, farm_id, season_id, commodity_id, buyer, contract_no, tonnes) values
  ('66666666-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', '33333333-0000-0000-0000-00000000000a', 'CBH', 'C-10245', 500);

insert into sale_terms (id, farm_id, sale_id, price) values
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-00000000000a', 412.50);

-- One open ticket created by the driver, one closed ticket created by the worker
insert into movements (id, farm_id, season_id, ticket_no, status, tons, created_by) values
  ('77777777-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 1, 'open',   32.5, 'a0000000-0000-0000-0000-000000000005'),
  ('77777777-0000-0000-0000-000000000002', '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 2, 'closed', 30.0, 'a0000000-0000-0000-0000-000000000004');

insert into invoices (id, farm_id, season_id, sale_id, invoice_no) values
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', '66666666-0000-0000-0000-00000000000a', 1);

insert into overheads (id, farm_id, season_id, wages, drawings) values
  (gen_random_uuid(), '11111111-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-00000000000a', 180000, 90000);
