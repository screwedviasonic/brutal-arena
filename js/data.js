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

  /* ---------------- SHOP ----------------
   * Permanent gold sinks. cost grows per level owned.
   */
  const SHOP_ITEMS = [
    { id: 'staminaMax', name: 'Bigger Lungs', icon: '⚡', desc: '+1 max stamina', max: 30, baseCost: 40, growth: 1.45,
      effect: 'Increases your maximum stamina by 1.' },
    { id: 'staminaRegen', name: 'Endurance Training', icon: '⏱️', desc: '-6s stamina regen time', max: 20, baseCost: 60, growth: 1.5,
      effect: 'Stamina refills faster.' },
    { id: 'trainer', name: 'Hire Trainer', icon: '🏋️', desc: '+1 idle stat training/sec', max: 50, baseCost: 30, growth: 1.35,
      effect: 'Trains your brute\'s stats while idle. Claim the banked gains in the Brute tab.' },
    { id: 'goldFind', name: 'Looter', icon: '💰', desc: '+15% gold from fights', max: 20, baseCost: 80, growth: 1.5,
      effect: 'Win more gold from every victory.' },
    { id: 'xpBoost', name: 'War College', icon: '📚', desc: '+10% XP from fights', max: 20, baseCost: 90, growth: 1.5,
      effect: 'Gain more XP from every fight.' },
    { id: 'dropLuck', name: "Scavenger's Eye", icon: '🍀', desc: '+8% better level-up reward odds', max: 15, baseCost: 120, growth: 1.6,
      effect: 'Improves the rarity of weapons/skills offered on level up.' },
  ];

  /* ---------------- LEGACY (prestige) PERKS ---------------- */
  const LEGACY_PERKS = [
    { id: 'startStats', name: 'Strong Bloodline', desc: '+2 to all starting stats per level', max: 10, cost: 1 },
    { id: 'startWeapon', name: 'Heirloom Weapon', desc: 'Start with an extra random weapon per level', max: 3, cost: 2 },
    { id: 'startSkill', name: 'Innate Talent', desc: 'Start with an extra random skill per level', max: 3, cost: 3 },
    { id: 'goldMul', name: 'Merchant Ancestry', desc: '+20% gold gain per level', max: 10, cost: 1 },
    { id: 'xpMul', name: 'Veteran Blood', desc: '+15% XP gain per level', max: 10, cost: 1 },
    { id: 'skillSlots', name: 'Open Mind', desc: '+1 equipped skill slot per level', max: 3, cost: 3 },
  ];

  /* ---------------- GAUNTLET (endless tower) ---------------- */
  const GAUNTLET = {
    bossEvery: 5,                 // every Nth floor is a boss
    milestoneEvery: 10,           // every Nth floor grants a Legacy milestone reward
    bossTitles: ['the Gatekeeper', 'the Bonelord', 'the Executioner', 'the Devourer', 'the Warlord', 'the Undying', 'the Titan', 'the Ruin'],
    // Floor mutators: a non-boss floor rolls one of these (deterministically by
    // floor number, so re-attempts are fair). They tweak the fight and/or rewards.
    //   right     : stat bonuses applied to the ENEMY side
    //   left      : extra stat bonuses applied to YOU (stacked on meta bonuses)
    //   rewardMul : multipliers on { gold, dust, xp }
    //   bonusDrop : guarantee a weapon drop this floor
    mutators: [
      { id: 'calm',     weight: 5 },
      { id: 'frenzy',   weight: 2, icon: '🔥', label: 'Frenzy',       desc: 'Enemies hit +30% harder — but a drop is guaranteed', right: { dmgMul: 1.30 }, bonusDrop: true },
      { id: 'golden',   weight: 2, icon: '💰', label: 'Golden Floor', desc: '+150% gold from this floor',                       rewardMul: { gold: 2.5 } },
      { id: 'treasure', weight: 2, icon: '💎', label: 'Treasure',     desc: 'Guaranteed weapon drop • +100% dust',              bonusDrop: true, rewardMul: { dust: 2 } },
      { id: 'overload', weight: 1, icon: '⚡', label: 'Overload',     desc: 'Everyone deals +25% damage • +75% XP',             right: { dmgMul: 1.25 }, left: { dmgMul: 1.25 }, rewardMul: { xp: 1.75 } },
      { id: 'brittle',  weight: 2, icon: '🩸', label: 'Brittle Foes', desc: 'Enemies have 25% less HP',                         right: { hpMul: 0.75 } },
    ],
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
   * Idle/offline time banks small flat stat gains (per second, per Trainer
   * owned). The player CLAIMS the bank in the Brute tab — no XP, no popups.
   * Tuned so ~8h offline at max Trainers is a meaningful-but-not-crazy chunk.
   */
  const TRAINING = {
    perTrainerSec: { hp: 0.00008, strength: 0.00002, agility: 0.00002, speed: 0.000015 },
    statLabel: { hp: 'Max HP', strength: 'Strength', agility: 'Agility', speed: 'Speed' },
  };

  /* ---------------- MASTERIES (per weapon category) ---------------- */
  const MASTERY = {
    cats: WEAPON_CATS,
    // xp needed for a given mastery level
    xpForLevel: (lvl) => Math.floor(50 * Math.pow(lvl, 1.7) + 40 * lvl),
    dmgPerLevel: 0.05,            // +5% category damage per mastery level
    maxLevel: 20,
  };

  /* ---------------- COLLECTION bonuses ---------------- */
  const COLLECTION = {
    perWeapon: 0.008,   // +0.8% global damage per unique weapon collected
    perSkill: 0.006,    // +0.6% max HP per unique skill collected
    perPet: 0.02,       // +2% pet power per unique pet collected
    catCompleteDmg: 0.12, // +12% category damage when all weapons of a cat collected
  };

  global.GAMEDATA = {
    WEAPONS, DROPPABLE_WEAPONS, WEAPON_CATS, CAT_NAMES,
    SKILLS, ALL_SKILLS,
    PETS, ALL_PETS,
    NAME_PREFIX, NAME_SUFFIX, NAME_TITLE,
    SKIN_COLORS, OUTFIT_COLORS,
    SHOP_ITEMS, LEGACY_PERKS,
    GAUNTLET, MASTERY, COLLECTION, BOUNTIES, CRAFT, STAT_DEFS, TRAINING,
  };
})(window);
