-- ============================================================
-- Brutal Arena — Rivals (one-way follow). Run once in the Supabase SQL Editor.
-- Search/inspect/challenge use the already-public `ladder` table and need
-- no setup; only the RIVALS list needs this table.
-- ============================================================

create table if not exists public.rivals (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  rival_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, rival_id)
);

alter table public.rivals enable row level security;

-- you may only read / add / remove your OWN rivals
drop policy if exists "rivals read own"   on public.rivals;
drop policy if exists "rivals insert own" on public.rivals;
drop policy if exists "rivals delete own" on public.rivals;
create policy "rivals read own"   on public.rivals for select using (auth.uid() = owner_id);
create policy "rivals insert own" on public.rivals for insert with check (auth.uid() = owner_id);
create policy "rivals delete own" on public.rivals for delete using (auth.uid() = owner_id);
