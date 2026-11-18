-- Preview only. Changes nothing. Shows what a reset of one trial account would remove.
-- Paste into the Supabase SQL editor and send me the three result tables.

-- 1. Is this account the support login (the one that sends invites)? If yes, DO NOT delete it.
select u.id as user_id, u.email, u.created_at,
       exists (select 1 from support_settings s where s.user_id = u.id) as is_support_login
from auth.users u
where lower(u.email) = lower('bencarrigan_9@hotmail.com');

-- 2. The farms this account belongs to, and who else is in each one.
select f.id as farm_id, f.entity_name, fu.role,
       (select count(*) from farm_users x where x.farm_id = f.id and x.deleted_at is null) as members,
       (select string_agg(coalesce(au.email, '?') || ' (' || x.role || ')', ', ')
          from farm_users x join auth.users au on au.id = x.user_id
         where x.farm_id = f.id and x.deleted_at is null and x.user_id <> u.id) as other_members
from auth.users u
join farm_users fu on fu.user_id = u.id
join farms f on f.id = fu.farm_id
where lower(u.email) = lower('bencarrigan_9@hotmail.com');

-- 3. The trial invitation(s) sent to this address.
select id, email, created_at, used_at, withdrawn_at, farm_id
from trial_invites
where lower(email) = lower('bencarrigan_9@hotmail.com');
