-- When the client first opened an article in their portal.
--
-- Only the portal writes this, and reaching the portal means passing the code
-- gate — so a timestamp here means the client looked, never the team. Null is
-- "Unseen by client".
alter table articles add column if not exists client_viewed_at timestamptz;
