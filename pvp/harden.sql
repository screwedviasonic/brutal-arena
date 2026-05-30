-- ============================================================
-- Brutal Arena — PvP hardening (run AFTER schema.sql)
-- Paste into Supabase Studio > SQL Editor and run once.
--
-- Two things:
--  1. guard_ladder() trigger — clients may update their own ladder row
--     (to refresh their defense snapshot), but rating/wins/losses are
--     PINNED to their previous values on any client-side write. Only
--     privileged code (the report_match function below, or the Edge
--     Function via service_role) can change them.
--  2. report_match() — a SECURITY DEFINER function that applies an Elo
--     update for both players and logs the match in one transaction.
--     This is what the client calls in `allowClientResolve` mode.
-- ============================================================

-- ---------- 1. rating guard ----------
create or replace function public.guard_ladder()
returns trigger language plpgsql as $$
begin
  -- 'authenticated'/'anon' = a normal client request. Privileged callers
  -- (SECURITY DEFINER funcs run as the owner; Edge Function uses service_role)
  -- fall through and may change rating.
  if current_user in ('authenticated', 'anon') then
    new.rating := old.rating;
    new.wins   := old.wins;
    new.losses := old.losses;
  end if;
  return new;
end $$;

drop trigger if exists ladder_guard on public.ladder;
create trigger ladder_guard
  before update on public.ladder
  for each row execute function public.guard_ladder();

-- ---------- 2. match report + Elo ----------
create or replace function public.report_match(
  p_defender uuid, p_seed bigint, p_attacker_won boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare
  a_id uuid := auth.uid();
  ra int; rb int; na int; nb int; ea float; k int := 32;
begin
  if a_id is null then raise exception 'not authenticated'; end if;
  if a_id = p_defender then raise exception 'cannot fight yourself'; end if;

  select rating into ra from ladder where user_id = a_id;
  select rating into rb from ladder where user_id = p_defender;
  if ra is null or rb is null then raise exception 'both players must be on the ladder'; end if;

  ea := 1.0 / (1.0 + power(10.0, (rb - ra) / 400.0));   -- attacker expected score

  if p_attacker_won then
    na := round(ra + k * (1 - ea));
    nb := round(rb - k * (1 - ea));
    update ladder set rating = na, wins   = wins   + 1, updated_at = now() where user_id = a_id;
    update ladder set rating = nb, losses = losses + 1, updated_at = now() where user_id = p_defender;
  else
    na := round(ra - k * ea);
    nb := round(rb + k * ea);
    update ladder set rating = na, losses = losses + 1, updated_at = now() where user_id = a_id;
    update ladder set rating = nb, wins   = wins   + 1, updated_at = now() where user_id = p_defender;
  end if;

  insert into matches(attacker, defender, seed, attacker_won,
    attacker_rating_before, attacker_rating_after,
    defender_rating_before, defender_rating_after)
  values (a_id, p_defender, p_seed, p_attacker_won, ra, na, rb, nb);

  return json_build_object('attacker_rating', na, 'defender_rating', nb);
end $$;

grant execute on function public.report_match(uuid, bigint, boolean) to authenticated, anon;
