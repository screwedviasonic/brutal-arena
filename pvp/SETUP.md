# Brutal Arena — PvP Tier 1 setup

Server-authoritative ranked ladder on Supabase. Async "ghost" fights: you
attack another player's stored brute, the **server** runs your existing
combat engine to settle it, and Elo ratings update. Nobody can cheat the
result because the fight runs server-side from a stored seed.

## Architecture at a glance

```
 Browser (game)                 Supabase
 ─────────────                  ────────────────────────────
 auth (email/anon)  ───────▶    auth.users
 sync save          ───────▶    accounts.save        (private, RLS owner-only)
 publish defense    ───────▶    ladder.defense       (public read)
 "Find opponent"    ───────▶    select from ladder near my rating
 "Attack"           ───────▶    Edge Function: resolve-match  (service role)
                                   ├─ load both brute snapshots
                                   ├─ pick seed, run Combat.simulateBattle  ← your engine
                                   ├─ Elo update both ratings
                                   └─ insert matches row, return {seed, won}
 replay fight       ◀───────    same seed → UI.replayBattle = identical animation
 leaderboard        ◀───────    select * from ladder order by rating desc
```

## What you do (one-time)

1. **Create a project** at supabase.com (free tier is fine). Note the
   **Project URL** and **anon public key** (Project Settings > API).
2. **Run the schema**: open SQL Editor, paste `pvp/schema.sql`, run.
3. **Auth**: Authentication > Providers. Easiest start is **Anonymous**
   sign-in (instant accounts) and/or **Email**. Enable what you want.
4. **Give me the Project URL + anon key.** They're safe to embed in the
   client (the anon key is meant to be public; RLS is what protects data).
   I'll drop them into `js/pvp-config.js`.
5. **Rating-guard trigger** (so clients can't bump their own rating via the
   `ladder own update` policy): I'll provide the trigger SQL — it pins
   `rating/wins/losses` to their old values on any non-service write.

## What I build once the project exists

- `supabase/functions/resolve-match/` — the Deno Edge Function. It vendors
  the engine core (`js/{rng,data,items,character,combat}.js`) via a tiny
  copy step and runs the **same** `simulateBattle` proven in
  `pvp/test-parity.mjs`. It's the only writer of `rating`.
- `js/pvp.js` — client module: sign in, sync save → `accounts`, publish
  defense snapshot → `ladder`, "Find opponent" / "Attack", replay via the
  returned seed, render the leaderboard.
- A **⚔️ PVP tab** + "claim your local brute into an account" migration.

## Honest scope notes

- Tier 1 makes the **fight** authoritative. It does **not** re-validate your
  whole PvE history — `accounts.save` is still client-produced, so a
  determined cheater could inflate their brute's stats offline. Closing that
  fully means server-validated progression (a bigger Tier-2+ job). For a
  ladder among normal players, server-authoritative fights + a power-bucketed
  matchmaker is the right 80/20.
- Defense snapshots are taken when you publish; opponents fight that frozen
  brute, not your live one (standard async-PvP behavior).
