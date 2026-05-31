-- ============================================================
-- Brutal Arena — Riot/Blizzard-style name tags (run after schema.sql)
-- Names no longer need to be globally unique; a 4-digit #tag
-- differentiates players (e.g. Sonic#1234). Run once in the SQL Editor.
-- ============================================================

-- names can now repeat, so drop the unique constraint on the handle
alter table public.accounts drop constraint if exists accounts_handle_key;

-- per-account discriminator (shown as name#tag)
alter table public.accounts add column if not exists tag text;
alter table public.ladder   add column if not exists tag text;
