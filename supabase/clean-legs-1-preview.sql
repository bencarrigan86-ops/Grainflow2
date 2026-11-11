-- STEP 1 of 2: PREVIEW. Changes nothing. Paste into the Supabase SQL editor and Run.
-- Expect: loads_with_copies and copies_to_remove above zero if the server still holds doubled legs.

with legs as (
  select
    l.id, l.movement_id, l.direction, l.tons, m.tons as load_tons,
    row_number() over (
      partition by l.movement_id, l.direction, l.ref_type, l.ref_id, l.tons
      order by l.updated_at desc, l.id
    ) as rn
  from movement_legs l
  join movements m on m.id = l.movement_id
  where l.deleted_at is null and m.deleted_at is null
),
sides as (
  select
    movement_id, direction, max(load_tons) as load_tons,
    sum(tons) as side_tons,
    sum(case when rn = 1 then tons else 0 end) as kept_tons
  from legs
  group by movement_id, direction
)
select
  (select count(*) from movements where deleted_at is null)                          as live_loads,
  (select count(*) from movement_legs where deleted_at is null)                       as live_legs,
  (select count(distinct movement_id) from sides
     where side_tons > load_tons + 0.01 and kept_tons <= load_tons + 0.01)            as loads_with_copies,
  (select count(*) from legs g
     join sides s on s.movement_id = g.movement_id and s.direction = g.direction
     where g.rn > 1 and s.side_tons > s.load_tons + 0.01
       and s.kept_tons <= s.load_tons + 0.01)                                         as copies_to_remove;


