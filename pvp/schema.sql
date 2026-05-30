-- ============================================================
-- Brutal Arena — PvP ladder schema (Supabase / Postgres)
-- Paste into Supabase Studio > SQL Editor and run once.
--
-- Trust model:
--   * accounts.save  — the player's full game state. PRIVATE: only the
--     owner can read/write it (their PvE progression is client-driven).
--   * ladder         — the PUBLIC snapshot used for matchmaking: handle,
--     rating, and the "defense" brute others fight. Anyone can READ it
--     (leaderboard + opponent selection) but NOBODY can write rating —
--     only the resolve-match Edge Function (service role) may.
--   * matches        — append-only fight log; seed makes every fight replayable.
-- ============================================================

-- ---------- private per-account state ----------
create table if not exists public.accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  handle     text unique not null,
  save       jsonb not null default '{}'::jsonb,   -- full game state (source of truth for this account)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- public ladder / matchmaking row ----------
create table if not exists public.ladder (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  handle           text not null,
  rating           int  not null default 1000,
  wins             int  not null default 0,
  losses           int  not null default 0,
  power            int  not null default 0,        -- brute power rating, for matchmaking buckets
  defense          jsonb not null,                  -- brute snapshot opponents fight
  defense_bonuses  jsonb not null default '{}'::jsonb, -- metaBonuses() snapshot (mastery/collection)
  updated_at       timestamptz not null default now()
);

create index if not exists ladder_rating_idx on public.ladder (rating);
create index if not exists ladder_power_idx  on public.ladder (power);

-- ---------- match log (replayable via seed) ----------
create table if not exists public.matches (
  id                    bigint generated always as identity primary key,
  attacker              uuid not null references auth.users (id) on delete cascade,
  defender              uuid not null references auth.users (id) on delete cascade,
  seed                  bigint not null,
  attacker_won          boolean not null,
  attacker_rating_before int not null,
  attacker_rating_after  int not null,
  defender_rating_before int not null,
  defender_rating_after  int not null,
  created_at            timestamptz not null default now()
);

create index if not exists matches_attacker_idx on public.matches (attacker, created_at desc);
create index if not exists matches_defender_idx on public.matches (defender, created_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.accounts enable row level security;
alter table public.ladder   enable row level security;
alter table public.matches  enable row level security;

-- accounts: owner-only
create policy "own account read"   on public.accounts for select using (auth.uid() = user_id);
create policy "own account write"  on public.accounts for insert with check (auth.uid() = user_id);
create policy "own account update" on public.accounts for update using (auth.uid() = user_id);

-- ladder: everyone can read (leaderboard + opponents); owner may upsert ONLY their defense snapshot/handle/power.
-- rating/wins/losses are written exclusively by the Edge Function (service role bypasses RLS).
create policy "ladder public read"  on public.ladder for select using (true);
create policy "ladder own insert"   on public.ladder for insert with check (auth.uid() = user_id);
create policy "ladder own update"   on public.ladder for update using (auth.uid() = user_id);
-- NOTE: protect rating columns from client writes with a trigger (see SETUP.md step 5).

-- matches: players can read fights they were in. Inserts come from the Edge Function only.
create policy "matches own read" on public.matches for select
  using (auth.uid() = attacker or auth.uid() = defender);
