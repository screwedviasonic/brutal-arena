-- ============================================================
-- Brutal Arena — unified leaderboards (run AFTER schema.sql + harden.sql)
-- Adds Arena rank + Gauntlet best-floor to the public ladder so the
-- in-game Leaderboards view can rank by Rating / Arena Division / Floor.
-- Paste into Supabase Studio > SQL Editor and run once.
-- ============================================================

alter table public.ladder add column if not exists arp           int not null default 0;
alter table public.ladder add column if not exists gauntlet_best int not null default 0;

create index if not exists ladder_arp_idx  on public.ladder (arp);
create index if not exists ladder_gb_idx   on public.ladder (gauntlet_best);

-- These two are PvE bragging stats, so the owner may update their own
-- (the rating guard from harden.sql still pins rating/wins/losses).
