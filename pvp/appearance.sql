-- ============================================================
-- Brutal Arena — egress optimization. Run once in the Supabase SQL Editor.
-- Adds a tiny avatar-only snapshot column so list/matchmaking queries can
-- skip the heavy `defense` JSON. The full `defense` is fetched only when you
-- actually inspect or fight a single brute.
-- ============================================================

alter table public.ladder add column if not exists appearance jsonb;

-- backfill existing rows from the defense snapshot (best-effort, one-time)
update public.ladder
set appearance = jsonb_build_object(
  'skin',   defense -> 'appearance' ->> 'skin',
  'outfit', defense -> 'appearance' ->> 'outfit',
  'seed',   (defense ->> 'seed')::numeric
)
where appearance is null and defense is not null;
