-- STEP 2 of 2: THE FIX. Run only after the preview looked right.
-- Soft-deletes the extra copies of legs (deleted_at is stamped; nothing is removed).
-- Keeps one of each, only on loads where a side adds up to more than the load itself.

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
),
doomed as (
  select g.id
  from legs g
  join sides s on s.movement_id = g.movement_id and s.direction = g.direction
  where g.rn > 1 and s.side_tons > s.load_tons + 0.01 and s.kept_tons <= s.load_tons + 0.01
)
update movement_legs
   set deleted_at = now()
 where id in (select id from doomed);
