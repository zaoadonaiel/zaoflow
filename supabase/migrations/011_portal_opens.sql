-- One row per time a client passed the code gate on a portal link.
--
-- Recorded when the 5-digit code is accepted, not when the page loads, so the
-- count means "the client got in" rather than "something fetched this URL".
create table if not exists portal_opens (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references client_portals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  opened_at timestamptz not null default now()
);

create index if not exists portal_opens_portal_idx on portal_opens (portal_id, opened_at desc);

alter table portal_opens enable row level security;

-- Dashboard reads only; the portal writes through the service-role client after
-- validating the token.
create policy "portal_opens_owner" on portal_opens for all using (auth.uid() = user_id);
