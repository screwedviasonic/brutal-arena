/* ============================================================
 * data.js — game content: weapons, skills, pets, names, shop.
 * All balance numbers live here so they're easy to tune.
 * ============================================================ */

(function (global) {
  'use strict';

  /* ---------------- WEAPONS ----------------
   * dmg      : base damage added on top of strength scaling
   * accuracy : additive hit chance modifier (0..1ish)
   * speedMod : action interval multiplier (<1 = faster)
   * combo    : added chance to chain an extra strike
   * block    : added chance to block while wielding
   * crit     : added crit chance
   * disarm   : chance to disarm the target on hit
   * tier     : drop rarity weighting (higher tier = rarer/stronger)
   */
  const WEAPONS = {
    fist:        { id: 'fist', name: 'Bare Fists', icon: '👊', cat: 'fist', dmg: 5,  accuracy: 0.00, speedMod: 1.00, combo: 0.10, block: 0.00, crit: 0.05, disarm: 0.00, tier: 0 },
    knife:       { id: 'knife', name: 'Knife', icon: '🔪', cat: 'blade', dmg: 7,  accuracy: 0.05, speedMod: 0.75, combo: 0.22, block: 0.00, crit: 0.12, disarm: 0.00, tier: 1 },
    sai:         { id: 'sai', name: 'Sai', icon: '🗡️', cat: 'blade', dmg: 6,  accuracy: 0.10, speedMod: 0.78, combo: 0.18, block: 0.18, crit: 0.05, disarm: 0.10, tier: 1 },
    fan:         { id: 'fan', name: 'War Fan', icon: '🪭', cat: 'blade', dmg: 5,  accuracy: 0.08, speedMod: 0.70, combo: 0.30, block: 0.12, crit: 0.04, disarm: 0.00, tier: 1 },
    baton:       { id: 'baton', name: 'Baton', icon: '🥢', cat: 'blunt', dmg: 8,  accuracy: 0.06, speedMod: 0.85, combo: 0.12, block: 0.05, crit: 0.05, disarm: 0.05, tier: 1 },
    mug:         { id: 'mug', name: 'Heavy Mug', icon: '🍺', cat: 'blunt', dmg: 9,  accuracy: 0.00, speedMod: 0.95, combo: 0.06, block: 0.05, crit: 0.06, disarm: 0.18, tier: 1 },
    fryingpan:   { id: 'fryingpan', name: 'Frying Pan', icon: '🍳', cat: 'blunt', dmg: 11, accuracy: 0.02, speedMod: 1.05, combo: 0.04, block: 0.16, crit: 0.06, disarm: 0.12, tier: 2 },
    club:        { id: 'club', name: 'Club', icon: '🏏', cat: 'blunt', dmg: 13, accuracy: -0.02, speedMod: 1.10, combo: 0.04, block: 0.04, crit: 0.08, disarm: 0.06, tier: 2 },
    sword:       { id: 'sword', name: 'Sword', icon: '⚔️', cat: 'blade', dmg: 14, accuracy: 0.05, speedMod: 0.95, combo: 0.10, block: 0.10, crit: 0.10, disarm: 0.00, tier: 2 },
    scimitar:    { id: 'scimitar', name: 'Scimitar', icon: '🗡️', cat: 'blade', dmg: 13, accuracy: 0.08, speedMod: 0.88, combo: 0.16, block: 0.06, crit: 0.12, disarm: 0.00, tier: 2 },
    whip:        { id: 'whip', name: 'Whip', icon: '🪢', cat: 'blade', dmg: 9,  accuracy: 0.10, speedMod: 0.80, combo: 0.20, block: 0.00, crit: 0.06, disarm: 0.22, tier: 2 },
    trident:     { id: 'trident', name: 'Trident', icon: '🔱', cat: 'spear', dmg: 16, accuracy: 0.04, speedMod: 1.00, combo: 0.08, block: 0.10, crit: 0.08, disarm: 0.04, tier: 3 },
    axe:         { id: 'axe', name: 'Battle Axe', icon: '🪓', cat: 'axe', dmg: 20, accuracy: -0.04, speedMod: 1.25, combo: 0.02, block: 0.05, crit: 0.14, disarm: 0.08, tier: 3 },
    morningstar: { id: 'morningstar', name: 'Morning Star', icon: '🔨', cat: 'blunt', dmg: 22, accuracy: -0.06, speedMod: 1.30, combo: 0.02, block: 0.06, crit: 0.16, disarm: 0.10, tier: 3 },
    halberd:     { id: 'halberd', name: 'Halberd', icon: '⛏️', cat: 'spear', dmg: 19, accuracy: 0.02, speedMod: 1.15, combo: 0.05, block: 0.14, crit: 0.10, disarm: 0.06, tier: 3 },
    broadsword:  { id: 'broadsword', name: 'Broadsword', icon: '🗡️', cat: 'blade', dmg: 24, accuracy: 0.00, speedMod: 1.20, combo: 0.04, block: 0.12, crit: 0.12, disarm: 0.00, tier: 4 },
    lightsaber:  { id: 'lightsaber', name: 'Plasma Blade', icon: '⚡', cat: 'blade', dmg: 21, accuracy: 0.12, speedMod: 0.80, combo: 0.14, block: 0.16, crit: 0.18, disarm: 0.05, tier: 5 },
  };

  // weapon categories used by masteries & the fighter rig
  const WEAPON_CATS = ['blade', 'blunt', 'axe', 'spear'];
  const CAT_NAMES = { blade: 'Blades', blunt: 'Blunt', axe: 'Axes', spear: 'Polearms', fist: 'Fists' };

  // weapons that can be found/dropped (everything except fists)
  const DROPPABLE_WEAPONS = Object.values(WEAPONS).filter(w => w.id !== 'fist');

  /* ---------------- SKILLS ----------------
   * kind: 'passive' modifies stats/combat constants;
   *       'active'  triggers during the fight.
   * mods: passive stat/combat multipliers & additives.
   * For active skills, the combat engine reads `trigger` info.
   */
  const SKILLS = {
    // ---- passive stat boosters ----
    herculean:   { id: 'herculean', name: 'Herculean Strength', icon: '💪', kind: 'passive', desc: '+50% Strength', mods: { strengthMul: 1.5 }, tier: 2 },
    feline:      { id: 'feline', name: 'Feline Agility', icon: '🐈', kind: 'passive', desc: '+50% Agility', mods: { agilityMul: 1.5 }, tier: 2 },
    lightning:   { id: 'lightning', name: 'Lightning Reflexes', icon: '🌩️', kind: 'passive', desc: '+50% Speed', mods: { speedMul: 1.5 }, tier: 2 },
    vitality:    { id: 'vitality', name: 'Vitality', icon: '❤️', kind: 'passive', desc: '+50% Max HP', mods: { hpMul: 1.5 }, tier: 2 },
    immortal:    { id: 'immortal', name: 'Immortality', icon: '🩸', kind: 'passive', desc: '+250% HP, -25% other stats', mods: { hpMul: 3.5, strengthMul: 0.75, agilityMul: 0.75, speedMul: 0.75 }, tier: 5 },
    toughened:   { id: 'toughened', name: 'Toughened Skin', icon: '🧱', kind: 'passive', desc: '+15% HP, take 12% less damage', mods: { hpMul: 1.15, dmgReduction: 0.12 }, tier: 2 },
    armor:       { id: 'armor', name: 'Armor', icon: '🛡️', kind: 'passive', desc: 'Take 25% less damage', mods: { dmgReduction: 0.25 }, tier: 3 },
    // ---- passive combat behaviour ----
    martial:     { id: 'martial', name: 'Martial Arts', icon: '🥋', kind: 'passive', desc: '+100% fist damage, +combo', mods: { fistMul: 2.0, comboAdd: 0.10 }, tier: 2 },
    weaponmaster:{ id: 'weaponmaster', name: 'Weapon Master', icon: '🎖️', kind: 'passive', desc: '+40% weapon damage', mods: { weaponMul: 1.4 }, tier: 3 },
    ballet:      { id: 'ballet', name: 'Ballet Shoes', icon: '🩰', kind: 'passive', desc: '+18% Evasion', mods: { evasionAdd: 0.18 }, tier: 2 },
    shield:      { id: 'shield', name: 'Shield', icon: '🛡️', kind: 'passive', desc: '+22% Block', mods: { blockAdd: 0.22 }, tier: 2 },
    sixthsense:  { id: 'sixthsense', name: 'Sixth Sense', icon: '👁️', kind: 'passive', desc: '+15% Counter, +10% Evasion', mods: { counterAdd: 0.15, evasionAdd: 0.10 }, tier: 3 },
    hostility:   { id: 'hostility', name: 'Hostility', icon: '😤', kind: 'passive', desc: 'Reflect 20% of damage taken', mods: { reflect: 0.20 }, tier: 3 },
    determination:{ id: 'determination', name: 'Determination', icon: '🔥', kind: 'passive', desc: '+12% Crit, +8% Accuracy', mods: { critAdd: 0.12, accuracyAdd: 0.08 }, tier: 2 },
    relentless:  { id: 'relentless', name: 'Relentless', icon: '🌀', kind: 'passive', desc: '+18% Combo chance', mods: { comboAdd: 0.18 }, tier: 2 },
    // ---- active skills ----
    fierce:      { id: 'fierce', name: 'Fierce Brute', icon: '😡', kind: 'active', desc: 'Unleash a devastating 3x strike (once)', tier: 3, active: { type: 'burst', uses: 1, mult: 3.0 } },
    hammer:      { id: 'hammer', name: 'Hammer Smash', icon: '🔨', kind: 'active', desc: 'Stun + heavy hit (twice)', tier: 3, active: { type: 'stun', uses: 2, mult: 2.0 } },
    bomb:        { id: 'bomb', name: 'Bomb', icon: '💣', kind: 'active', desc: 'Explosive damage to all foes (once)', tier: 4, active: { type: 'bomb', uses: 1, dmg: 35 } },
    net:         { id: 'net', name: 'Net', icon: '🕸️', kind: 'active', desc: 'Immobilize the enemy for a turn (twice)', tier: 2, active: { type: 'net', uses: 2 } },
    potion:      { id: 'potion', name: 'Tragic Potion', icon: '🧪', kind: 'active', desc: 'Heal 40% HP when low (once)', tier: 3, active: { type: 'heal', uses: 1, frac: 0.40 } },
    sabotage:    { id: 'sabotage', name: 'Sabotage', icon: '🔧', kind: 'active', desc: 'Destroy an enemy weapon at fight start', tier: 3, active: { type: 'sabotage', uses: 1 } },
    thief:       { id: 'thief', name: 'Thief', icon: '🤏', kind: 'active', desc: 'Steal an enemy weapon on a hit (once)', tier: 4, active: { type: 'thief', uses: 1 } },
  };

  const ALL_SKILLS = Object.values(SKILLS);

  /* ---------------- SKILL CATEGORIES (mirror weapon cats; drive skill masteries) ---------------- */
  const SKILL_CATS = ['brawn', 'guard', 'swift', 'arts'];
  const SKILL_CAT_NAMES = { brawn: 'Brawn', guard: 'Guard', swift: 'Swift', arts: 'Arts' };
  const SKILL_CAT = {
    herculean: 'brawn', martial: 'brawn', weaponmaster: 'brawn', determination: 'brawn', relentless: 'brawn', hostility: 'brawn',
    vitality: 'guard', immortal: 'guard', toughened: 'guard', armor: 'guard', shield: 'guard', ballet: 'guard', sixthsense: 'guard',
    feline: 'swift', lightning: 'swift',
    fierce: 'arts', hammer: 'arts', bomb: 'arts', net: 'arts', potion: 'arts', sabotage: 'arts', thief: 'arts',
  };
  const skillCatOf = (base) => SKILL_CAT[base] || 'arts';

  /* ---------------- PETS ----------------
   * Pets fight alongside you as extra combatants.
   */
  const PETS = {
    dog:     { id: 'dog', name: 'Dog', icon: '🐕', hp: 18, strength: 8,  agility: 14, speed: 1.0, tier: 1 },
    wolf:    { id: 'wolf', name: 'Wolf', icon: '🐺', hp: 28, strength: 14, agility: 18, speed: 0.85, tier: 2 },
    panther: { id: 'panther', name: 'Panther', icon: '🐆', hp: 35, strength: 18, agility: 24, speed: 0.7, tier: 3 },
    bear:    { id: 'bear', name: 'Bear', icon: '🐻', hp: 90, strength: 30, agility: 6,  speed: 1.4, tier: 4 },
  };

  const ALL_PETS = Object.values(PETS);

  /* ---------------- NAMES ----------------- */
  const NAME_PREFIX = ['Gor', 'Bru', 'Thra', 'Vex', 'Mor', 'Krag', 'Drax', 'Hul', 'Zed', 'Baf', 'Grim', 'Skull', 'Rok', 'Tor', 'Ulf', 'Vlad', 'Crom', 'Brak'];
  const NAME_SUFFIX = ['nok', 'gar', 'tusk', 'mash', 'gor', 'rok', 'din', 'ius', 'ax', 'or', 'ek', 'um', 'ash', 'og', 'an', 'ric'];
  const NAME_TITLE = ['the Brutal', 'the Wild', 'Ironjaw', 'the Mad', 'Bonecrusher', 'the Swift', 'Skullsplitter', 'the Grim', 'the Fierce', 'Bloodfist', 'the Untamed', 'Doomhammer'];

  /* ---------------- COLORS (appearance) ----------------- */
  const SKIN_COLORS = ['#e7b58f', '#c98b5e', '#8d5a3a', '#a3c586', '#7fa8c9', '#c98fb8', '#b0b0b0', '#d4a373'];
  const OUTFIT_COLORS = ['#b3261e', '#1e63b3', '#2e8b57', '#8b5cf6', '#d97706', '#0d9488', '#be123c', '#4b5563'];

  /* ---------------- SHOP (rotating item stock, gold sink) ----------------
   * A few slots, each a rolled weapon/pet/skill (base + rarity). Auto-rotates
   * on a timer; you can also pay gold to reroll the whole stock.
   */
  const SHOP = {
    slots: 6,
    refreshHours: 3,
    rerollCost: 60,          // gold to reroll the stock
    priceBase: 35,
    pricePerTier: 28,
    rarityMul: { common: 1, uncommon: 1.6, rare: 2.7, epic: 4.6, legendary: 8, mythic: 14 },
    rarityWeights: { common: 48, uncommon: 30, rare: 15, epic: 5, legendary: 1.5, mythic: 0.3 },
    kindWeights: { weapon: 3, pet: 1, skill: 2 },
  };

  /* ---------------- LEGACY PERKS (permanent, account-wide) ----------------
   * Legacy is earned by Ascending (see ASCENSION). Perks permanently buff
   * your single brute — no resets, no "starting" bonuses.
   */
  const LEGACY_PERKS = [
    { id: 'might', name: 'Savage Bloodline', desc: '+4% to all stats per level', max: 15, cost: 1 },
    { id: 'trainer', name: 'Drill Sergeant', desc: '+idle XP rate & cap per level', max: 10, cost: 2 },
    { id: 'goldMul', name: 'Merchant Ancestry', desc: '+20% gold gain per level', max: 10, cost: 1 },
    { id: 'xpMul', name: 'Veteran Blood', desc: '+15% XP gain per level', max: 10, cost: 1 },
    { id: 'fortune', name: "Warlord's Luck", desc: '+10% better loot per level', max: 10, cost: 2 },
    { id: 'skillSlots', name: 'Open Mind', desc: '+1 equipped skill slot per level', max: 3, cost: 4 },
  ];
  // perk ids that no longer exist — their spent legacy is refunded on load
  const LEGACY_PERKS_RETIRED = { startStats: 1, startWeapon: 2, startSkill: 3, vigor: 2 };

  /* ---------------- ASCENSION (endgame, replaces prestige) ----------------
   * Reaching a new deepest Gauntlet floor unlocks the next Ascension: bank
   * Legacy + a permanent global power boost. Nothing is reset and the tower
   * is identical for everyone, so the Gauntlet leaderboard stays a fair race.
   */
  const ASCENSION = {
    floorReq: (tier) => 15 + tier * 12,  // all-time gauntlet best floor needed to ascend to next tier
    legacy: (tier) => 4 + tier * 3,      // legacy granted on ascend (~1000 total over all tiers)
    powerPerTier: 0.06,                  // +6% to all your stats & damage per tier (permanent)
    maxTier: 25,                         // max ~floor 315, reachable ~lvl 150-200 (sim-verified)
  };

  /* ---------------- ARENA (ranked division ladder) ----------------
   * Stamina-gated ranked career vs NPCs. Wins earn ARP, losses lose some.
   * Crossing a 100-ARP band promotes you a division; opponents scale with
   * your division and higher divisions pay more. Distinct from the
   * Gauntlet's endless free climb.
   */
  const ARENA = {
    divisions: ['Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion'],
    bandSize: 100,          // ARP per division
    winARP: 12,
    lossARP: 8,
    // opponent power is set by your DIVISION (rank), not your brute level.
    // Tuned (sim-verified) so the ladder is a full-length endgame climb:
    // Bronze ~lvl30, Diamond ~lvl60, Champion ~lvl110-150.
    baseLevel: 3,           // Rookie opponent level
    levelPerDiv: 24,        // +levels per division (Champion ~ level 147)
    statMulPerDiv: 0.28,    // +stats per division on top of level (Champion ~x2.68)
    econPerDiv: 0.14,       // +14% gold & XP per division (harder = pays more)
    staminaPerDiv: 2,       // +2 max stamina per division reached (best) -> Champion +12
    regenPerDiv: 4,         // -4s stamina regen time per division reached
  };

  /* ---------------- GAUNTLET (endless tower) ---------------- */
  const GAUNTLET = {
    bossEvery: 5,                 // every Nth floor is a boss
    milestoneEvery: 10,           // every Nth floor grants a Legacy milestone reward
    bossTitles: ['the Gatekeeper', 'the Bonelord', 'the Executioner', 'the Devourer', 'the Warlord', 'the Undying', 'the Titan', 'the Ruin'],
  };

  /* ---------------- BOUNTIES (rotating goals) ----------------
   * Directed objectives to chase between stamina refills. Many are
   * completable in the stamina-free Gauntlet. Each template's make()
   * is handed an RNG and the player's best gauntlet floor and returns
   * the concrete goal: { target, desc, reward, cat? }.
   * progress is measured in game.js from fight results.
   */
  const BOUNTIES = {
    slots: 3,            // active bounties at once
    refreshHours: 4,     // un-completed bounties auto-rotate after this long
    rerollCost: 35,      // dust to manually reroll one bounty
    templates: [
      { id: 'gauntletClear', icon: '🗼', weight: 3,
        make: (r) => { const n = r.int(3, 6);  return { target: n, desc: `Clear ${n} Gauntlet floors`, reward: { gold: 60 + n * 18 } }; } },
      { id: 'arenaWin', icon: '🏟️', weight: 3,
        make: (r) => { const n = r.int(3, 6);  return { target: n, desc: `Win ${n} Arena fights`, reward: { gold: 50 + n * 14 } }; } },
      { id: 'anyWin', icon: '🥊', weight: 2,
        make: (r) => { const n = r.int(5, 10); return { target: n, desc: `Win ${n} fights (any mode)`, reward: { gold: 40 + n * 10, dust: 6 } }; } },
      { id: 'crits', icon: '💥', weight: 2,
        make: (r) => { const n = r.int(6, 14); return { target: n, desc: `Land ${n} critical hits`, reward: { dust: 12 + n } }; } },
      { id: 'catHits', icon: '⚔️', weight: 2,
        make: (r) => { const cat = r.pick(WEAPON_CATS); const n = r.int(8, 16); return { target: n, cat, desc: `Land ${n} hits with ${CAT_NAMES[cat]}`, reward: { dust: 10 + n } }; } },
      { id: 'reachFloor', icon: '🏔️', weight: 1,
        make: (r, best) => { const n = (best || 1) + r.int(2, 5); return { target: n, desc: `Reach Gauntlet floor ${n}`, reward: { legacy: 1, gold: 90 } }; } },
    ],
  };

  /* ---------------- STATS ----------------
   * Canonical tally fields, tracked per-brute (career) and account-wide
   * (lifetime). Order here is the display order on the stats screens.
   */
  const STAT_DEFS = [
    { key: 'dmgDealt',       icon: '⚔️', label: 'Damage Dealt' },
    { key: 'dmgTaken',       icon: '🛡️', label: 'Damage Taken' },
    { key: 'healed',         icon: '💚', label: 'HP Healed' },
    { key: 'petDmgDealt',    icon: '🐾', label: 'Pet Damage' },
    { key: 'petDmgTaken',    icon: '🩹', label: 'Pet Damage Taken' },
    { key: 'crits',          icon: '💥', label: 'Crits Landed' },
    { key: 'kills',          icon: '💀', label: 'Enemies Felled' },
    { key: 'petDeaths',      icon: '⚰️', label: 'Pets Lost' },
    { key: 'arenaFights',    icon: '🏟️', label: 'Arena Fights' },
    { key: 'gauntletFights', icon: '🗼', label: 'Gauntlet Fights' },
    { key: 'wins',           icon: '🏅', label: 'Wins' },
    { key: 'losses',         icon: '☠️', label: 'Losses' },
    { key: 'goldEarned',     icon: '🪙', label: 'Gold Earned' },
    { key: 'dustEarned',     icon: '✦', label: 'Dust Earned' },
    { key: 'xpEarned',       icon: '✨', label: 'XP Earned' },
  ];

  /* ---------------- ACHIEVEMENTS (display-only progress badges) ---------------- */
  const ACHIEVEMENTS = [
    { id: 'wAll', label: 'Armory', desc: 'Discover every weapon', kind: 'collectAll', group: 'weapons', icon: 'weapons' },
    { id: 'sAll', label: 'Polymath', desc: 'Discover every skill', kind: 'collectAll', group: 'skills', icon: 'skills' },
    { id: 'pAll', label: 'Beast Tamer', desc: 'Discover every pet', kind: 'collectAll', group: 'pets', icon: 'pets' },
    { id: 'rare10', label: 'Rare Collector', desc: 'Own 10 items at Rare or better', kind: 'rarityCount', rarity: 'rare', n: 10, icon: 'star' },
    { id: 'epic10', label: 'Epic Hoard', desc: 'Own 10 items at Epic or better', kind: 'rarityCount', rarity: 'epic', n: 10, icon: 'star' },
    { id: 'legend', label: 'Legend Holder', desc: 'Own a Legendary item', kind: 'rarityAny', rarity: 'legendary', icon: 'crown' },
    { id: 'mythic', label: 'Mythic Owner', desc: 'Own a Mythic item', kind: 'rarityAny', rarity: 'mythic', icon: 'flame' },
    { id: 'mast10', label: 'Specialist', desc: 'Reach mastery level 10', kind: 'masteryAny', n: 10, icon: 'medal' },
    { id: 'mast20', label: 'Grandmaster', desc: 'Max out a weapon mastery (Lv 20)', kind: 'masteryAny', n: 20, icon: 'medal' },
    { id: 'g25', label: 'Tower Climber', desc: 'Reach Gauntlet floor 25', kind: 'gauntlet', n: 25, icon: 'tower' },
    { id: 'g50', label: 'Skybreaker', desc: 'Reach Gauntlet floor 50', kind: 'gauntlet', n: 50, icon: 'tower' },
    { id: 'champ', label: 'Champion', desc: 'Reach the Champion division', kind: 'arenaDiv', n: 6, icon: 'champion' },
    { id: 'asc5', label: 'Ascendant', desc: 'Reach Ascension tier 5', kind: 'ascend', n: 5, icon: 'chevron' },
    { id: 'asc10', label: 'Transcendent', desc: 'Reach Ascension tier 10', kind: 'ascend', n: 10, icon: 'chevron' },
    { id: 'win100', label: 'Veteran', desc: 'Win 100 fights', kind: 'career', stat: 'wins', n: 100, icon: 'fist' },
    { id: 'crit250', label: 'Critical Mind', desc: 'Land 250 critical hits', kind: 'career', stat: 'crits', n: 250, icon: 'flame' },
    { id: 'kill200', label: 'Executioner', desc: 'Fell 200 enemies', kind: 'career', stat: 'kills', n: 200, icon: 'hammer' },
    { id: 'pvp1200', label: 'Duelist', desc: 'Reach PvP rating 1200', kind: 'pvp', n: 1200, icon: 'star' },
  ];

  /* ---------------- FORGE CRAFTING ----------------
   * Bank shards (from scrapping weapons) toward a chosen target weapon.
   * cost = shardBase + tier * shardPerTier. A craft yields the target at
   * minRarity or better.
   */
  const CRAFT = {
    shardBase: 10,
    shardPerTier: 6,
    minRarity: 'rare',
    luck: 0.7,
  };

  /* ---------------- IDLE TRAINING ----------------
   * Idle/offline time banks XP up to a cap. The player CLAIMS the banked XP
   * in the Brute tab (it feeds normal leveling). A small base rate always
   * accrues; Trainers (Shop) raise both the rate and the cap.
   */
  // Sparring builds "Focus" which multiplies idle-XP rate, then decays.
  // No stamina, no direct XP — just an active way to speed the trickle.
  const SPAR = { perFocus: 0.5, maxFocus: 5, decaySec: 90 };

  const TRAINING = {
    baseXpSec: 0.06,          // banked XP/sec with no Trainers
    xpPerTrainerSec: 0.06,    // extra banked XP/sec per Trainer
    capBase: 120,             // max banked XP with no Trainers
    capPerTrainer: 120,       // extra cap per Trainer
  };

  /* ---------------- MASTERIES ----------------
   * Weapon categories (incl. Fists), pet species, and skill categories all
   * level from use and grant account-wide bonuses.
   */
  const MASTERY = {
    cats: WEAPON_CATS,
    weaponCats: ['fist', 'blade', 'blunt', 'axe', 'spear'],   // fist now masterable too
    xpForLevel: (lvl) => Math.floor(50 * Math.pow(lvl, 1.7) + 40 * lvl),
    dmgPerLevel: 0.05,            // +5% category damage per weapon-mastery level
    petPerLevel: 0.05,            // +5% equipped pet damage per species-mastery level
    maxLevel: 20,
    // per-level bonus applied by each skill category mastery (account-wide)
    skillBonus: {
      brawn: { field: 'strMul', per: 0.03, label: 'Strength' },
      guard: { field: 'hpMul', per: 0.04, label: 'Max HP' },
      swift: { field: 'agiMul', per: 0.03, label: 'Agility' },
      arts: { field: 'dmgMul', per: 0.03, label: 'Damage' },
    },
  };

  /* ---------------- COLLECTION bonuses + goals ---------------- */
  const COLLECTION = {
    perWeapon: 0.008,   // base +0.8% global damage per unique weapon collected
    perSkill: 0.006,    // base +0.6% max HP per unique skill collected
    perPet: 0.02,       // +2% pet power per unique pet collected
    catCompleteDmg: 0.12, // +12% category damage when all weapons of a cat collected
    rarityScale: 0.35,  // each entry's bonus is multiplied by (1 + rarityScale * highestRarityRank)
  };

  global.GAMEDATA = {
    WEAPONS, DROPPABLE_WEAPONS, WEAPON_CATS, CAT_NAMES,
    SKILLS, ALL_SKILLS, SKILL_CATS, SKILL_CAT_NAMES, SKILL_CAT, skillCatOf,
    PETS, ALL_PETS,
    NAME_PREFIX, NAME_SUFFIX, NAME_TITLE,
    SKIN_COLORS, OUTFIT_COLORS,
    SHOP, LEGACY_PERKS, LEGACY_PERKS_RETIRED, ASCENSION,
    ARENA, GAUNTLET, MASTERY, COLLECTION, BOUNTIES, CRAFT, STAT_DEFS, TRAINING, SPAR, ACHIEVEMENTS,
  };
})(window);
