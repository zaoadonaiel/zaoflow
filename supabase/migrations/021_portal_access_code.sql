-- A private access code per client portal.
--
-- The gate used to show the client a random 5-digit number and ask them to type
-- it back — a bot speed bump and nothing more, since the answer was printed on
-- the page it guarded. This makes the code a real credential: it is generated
-- here, shown only in the dashboard, handed to the client out of band, and
-- checked on the server.
--
-- With the code held back, the link alone is no longer enough to read a
-- client's articles, so the portal API routes require a passed code too.

alter table client_portals add column if not exists access_code text;

-- Existing portals get a code rather than a null one, so no live link breaks on
-- deploy. Every one of them changes: whatever the client was typing before came
-- off the page, and these have to be sent out.
update client_portals
   set access_code = lpad((floor(random() * 100000))::int::text, 5, '0')
 where access_code is null;

alter table client_portals alter column access_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_portals_access_code_shape'
  ) then
    alter table client_portals
      add constraint client_portals_access_code_shape check (access_code ~ '^[0-9]{5}$');
  end if;
end $$;

-- Five digits is 100k guesses, which a script gets through quickly. Three wrong
-- ones shut the link, and it stays shut until the team issues a new code from
-- the dashboard; a correct code clears the count.
alter table client_portals add column if not exists failed_attempts integer not null default 0;

-- An earlier draft of this migration timed the lockout instead. Dropped if it
-- ever landed, so re-running this file leaves nothing dead behind.
alter table client_portals drop column if exists locked_until;
