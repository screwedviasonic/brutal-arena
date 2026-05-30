# ⚔️ BRUTAL ARENA — Incremental Auto Battler

A fully playable, MyBrute-inspired incremental auto battler that runs entirely in
the browser. No build step, no dependencies — just open `index.html`.

## How to play

1. Open `index.html` in any modern browser (double-click it, or run a local server).
2. **Forge a brute** — every brute rolls random stats and a random starting weapon
   or skill. Reroll until destiny smiles, name it, and enter the arena.
3. **Fight** — press *Find a Fight* (costs 1 ⚡ stamina). Battles auto-resolve and
   play out as an animated brawl with a live combat log.
4. **Level up** — winning (and losing) grants XP. On each level you pick 1 of 3
   random rewards: a stat boost, a new weapon, a new skill, or a pet.
5. **Grow** — spend gold in the **Shop** on permanent upgrades (stamina, idle
   trainers, gold/XP boosts, better drop luck).
6. **Prestige** — in the **Legacy** tab, retire a brute to bank Legacy points, then
   spend them on bloodline perks that make every future brute stronger from birth.

Progress saves automatically to your browser's localStorage.

## Progression systems

- **Loot & rarity.** Weapons drop as instances with a rarity tier (Common to Mythic)
  and random affixes (damage, crit, combo, lifesteal, armor-pen, attack speed, block).
  The same base weapon is now something you re-roll for.
- **The Forge.** Spend gold to upgrade a weapon (+1, +2...), spend Dust to reroll its
  affixes, fuse two same-rarity copies into the next tier, or scrap weapons into Dust.
- **The Gauntlet.** An endless tower that scales forever. Win to climb; fall and you
  drop to your last boss checkpoint. Bosses every 5 floors drop guaranteed rare loot.
  Costs no stamina — your power is the only gate.
- **Collection.** An account-wide Bestiary of every weapon, skill, and pet. Each unique
  unlock grants a permanent global bonus, and completing a weapon category boosts that
  category's damage. Collection persists across prestige.
- **Masteries.** Fighting with a weapon category (blades, blunt, axes, polearms) earns
  Mastery XP; each level permanently boosts that category's damage. Rewards how you fight.

## Features

- **Random gear & skills** — 15 weapons, 24 skills (passive + active), 4 pets.
- **Deep auto-battle engine** — initiative by speed, accuracy/evasion, crits,
  blocks, combos, counter-attacks, disarms, reflect, and active skills like
  Fierce Brute, Hammer, Bomb, Net, Tragic Potion, Sabotage and Thief.
- **Pets** fight at your side as extra combatants.
- **Idle progression** — hired trainers earn XP while you're away (offline too).
- **Prestige loop** — retire → legacy → permanent bloodline perks.
- **Animated arena** with floating damage numbers, HP bars, and a combat log.

## Project structure

```
index.html        markup + screens
styles.css        dark gladiator theme
js/rng.js         seeded PRNG + random helpers (battles are reproducible)
js/data.js        all content & balance numbers (weapons/skills/pets/shop)
js/character.js   brute creation, effective-stat math, opponent generation
js/combat.js      the auto-battle simulation engine (no DOM)
js/progression.js XP, leveling, random level-up choices
js/ui.js          all DOM rendering + animated battle replay
js/game.js        state, save/load, the game loop, glue
```

## Tuning

All balance lives in `js/data.js` (weapon/skill/pet stats, shop costs, legacy
perks) and a few constants at the top of `js/combat.js` and `js/character.js`.
Tweak freely — the combat engine is pure and seed-driven, so you can reason
about changes deterministically.
