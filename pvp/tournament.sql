-- ============================================================
-- Brutal Arena — Weekly Tournament. Run once in the Supabase SQL Editor.
--
-- Each week (Mon 00:00 UTC -> the following Sun 20:00 UTC lock) players lock
-- in a frozen build. After the deadline the bracket is resolved CLIENT-SIDE
-- (combat is deterministic), and the first client to resolve writes the
-- standings row; everyone else just reads it.
-- ============================================================

-- a locked-in build for one player in one weekly tournament
create table if not exists public.tournament_entries (
  tournament_id text not null,                 -- the Monday (UTC) date, e.g. '2026-05-25'
  user_id   uuid not null references auth.users(id) on delete cascade,
  handle    text,
  tag       text,
  power     int  not null default 0,
  appearance jsonb,                            -- tiny avatar snapshot for standings
  build     jsonb not null,                    -- frozen brute (for deterministic resolution)
  bonuses   jsonb,                             -- frozen meta bonuses
  locked_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

alter table public.tournament_entries enable row level security;

-- everyone signed in can read all entries (needed to resolve the bracket)
drop policy if exists "tourney entries read"   on public.tournament_entries;
drop policy if exists "tourney entries write"  on public.tournament_entries;
drop policy if exists "tourney entries update" on public.tournament_entries;
create policy "tourney entries read"   on public.tournament_entries for select using (auth.role() = 'authenticated');
create policy "tourney entries write"  on public.tournament_entries for insert with check (auth.uid() = user_id);
create policy "tourney entries update" on public.tournament_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- final standings for a tournament (written once, first resolver wins)
create table if not exists public.tournament_results (
  tournament_id text primary key,
  standings   jsonb not null,                  -- ordered [{user_id,handle,tag,power,wins,losses}]
  field_size  int not null default 0,
  resolved_at timestamptz not null default now()
);

alter table public.tournament_results enable row level security;

drop policy if exists "tourney results read"   on public.tournament_results;
drop policy if exists "tourney results insert" on public.tournament_results;
create policy "tourney results read"   on public.tournament_results for select using (auth.role() = 'authenticated');
-- insert only; the primary key makes the first writer win and later writes conflict (no update policy)
create policy "tourney results insert" on public.tournament_results for insert with check (auth.role() = 'authenticated');
