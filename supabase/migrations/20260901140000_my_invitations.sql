-- Finding the invitation that was sent to you.
--
-- An invitation could only be spent by opening its link, and the link put the
-- token in that browser's localStorage. Everything else about the flow was
-- correct and it still failed the first time a real person used it: he went to
-- the app's address rather than opening the link, was shown "name your farm"
-- because he belonged to none, and created one. He then opened the link and
-- accepted properly — and finished with two farms, opening into the empty one.
--
-- Going to the website instead of clicking the link is not a mistake, it is
-- what most people will do. The invitation is addressed to an email; once
-- somebody is signed in as that email the app should be able to find it without
-- being handed a token.
--
-- Definer, because the invitee cannot read the invitations table — the select
-- policy is owners only, and rightly so: it holds every pending token for the
-- farm. This returns only rows addressed to the caller's own address, which is
-- the same test accept_invitation() already applies before writing anything.

create or replace function invitations_for_me()
returns table (
  id         uuid,
  farm_id    uuid,
  farm_name  text,
  role       text,
  token      text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select i.id, i.farm_id,
         coalesce(nullif(f.farm_name, ''), nullif(f.entity_name, ''), 'a farm')::text,
         i.role,
         -- Their own token, for their own invitation. Handing it back is what
         -- lets the Join button call accept_invitation() without the link, and
         -- it grants nothing they were not already sent by text message.
         i.token,
         i.expires_at
    from invitations i
    join farms f on f.id = i.farm_id
    join auth.users u on u.id = auth.uid()
   where lower(i.email) = lower(u.email)
     and i.deleted_at is null
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at desc;
$$;

revoke all on function invitations_for_me() from public;
grant execute on function invitations_for_me() to authenticated;

notify pgrst, 'reload schema';
