/* ============================================================
 * game.js — main controller: state, save/load, the game loop,
 * and all the glue between combat, progression and UI.
 * ============================================================ */

(function (global) {
  'use strict';

  const D = global.GAMEDATA;
  const C = global.Character;
  const P = global.Progression;
  const SAVE_KEY = 'brutal_arena_save_v1';
  const GAME_VERSION = '0.9.0';     // displayed on the About tab; bump on release
  const STAMINA_BASE = 6;
  const STAMINA_REGEN_BASE = 45;   // seconds per point at 0 upgrades
  const OFFLINE_CAP_SEC = 8 * 3600;
  const WEAPON_CAP = 12;           // max weapons a brute holds (extras auto-disenchant)
  const MASTERY_XP_PER_HIT = 3;

  let state = null;
  let candidate = null;       // brute being rolled on the create screen
  let pendingLevels = 0;      // level-ups awaiting player choice
  let fightInProgress = false;
  let idleXpAccum = 0;
  let tickTimer = null;       // the 1s game loop
  let wiped = false;          // set on reset so nothing re-saves before reload

  /* ---------------- state ---------------- */
  function defaultState() {
    return {
      version: 1,
      gold: 0,
      stamina: STAMINA_BASE,
      lastTick: now(),
      staminaProgress: 0,      // seconds accumulated toward next stamina point
      dust: 0,
      shards: 0,
      craftTarget: null,
      craftKind: 'weapon',
      shop: {},                 // legacy (old upgrade counts) — unused
      shopStock: { list: [], lastRefresh: 0 },
      gauntlet: { floor: 1, best: 0, checkpoint: 1 },
      arena: { arp: 0, best: 0, _stepMigrated: true },   // ranked ladder (arp + highest step reached)
      powerTier: 0,             // claimed Power Rank tiers (permanent buff bundles)
      lifetime: emptyStats(),   // account-wide tally across every brute
      training: 0,            // banked idle XP (claimable, capped)
      sparFocus: 0,           // sparring Focus: multiplies idle XP rate, decays
      prison: [],             // captured players: {id,name,tag,power,at} — grant a power-scaled battle-XP buff
      captors: [],            // players who beat you when you attacked — impose an XP penalty until you escape
      tourney: { claimed: {} }, // weekly-tournament reward claims, keyed by tournament_id
      battlesSeenAt: 0,         // ms of the newest PvP battle the player has viewed (nav "new" dot)
      bounties: null,   // lazily seeded by ensureBounties()
      collection: { weapons: {}, skills: {}, pets: {} },   // base -> highest rarity rank owned
      masteries: { fist: 0, blade: 0, blunt: 0, axe: 0, spear: 0 },
      petMast: {},                  // pet species -> xp
      skillMast: {},                // skill category -> xp
      brute: null,
      settings: { autoFight: false, fastFight: false, autoClimb: false },
    };
  }

  /* Bring an older / partial save up to the current schema. */
  function migrate(s) {
    if (!s) return s;
    if (s.dust == null) s.dust = 0;
    if (s.shards == null) s.shards = 0;
    if (s.craftTarget === undefined) s.craftTarget = null;
    if (s.craftKind === undefined) s.craftKind = 'weapon';
    if (typeof s.training !== 'number') s.training = 0;   // legacy stat-bank object -> XP bank
    if (typeof s.sparFocus !== 'number') s.sparFocus = 0;
    if (!Array.isArray(s.prison)) s.prison = [];
    if (!Array.isArray(s.captors)) s.captors = [];
    if (!s.tourney || typeof s.tourney !== 'object') s.tourney = { claimed: {} };
    if (!s.tourney.claimed) s.tourney.claimed = {};
    s.lifetime = fillStats(s.lifetime);
    if (s.brute) s.brute.career = fillStats(s.brute.career);
    if (!s.gauntlet) s.gauntlet = { floor: 1, best: 0, checkpoint: 1 };
    if (!s.arena) s.arena = { arp: 0, best: 0 };
    // arena.best switched from division index (0-6) to step index (0-20); rescale old saves
    if (s.arena._stepMigrated == null) { s.arena.best = (s.arena.best || 0) * 3; s.arena._stepMigrated = true; }
    if (!s.shopStock) s.shopStock = { list: [], lastRefresh: 0 };
    // Power Ranks replaced the old Legacy/Ascension prestige: drop the currency,
    // perk counts, and tier. Claimed tiers start at 0 and are re-earned from power
    // (the Ranks tab will show everything you already qualify for as claimable).
    if (s.powerTier == null) s.powerTier = 0;
    delete s.legacy; delete s.legacyPerks; delete s.ascension;
    if (!s.collection) s.collection = { weapons: {}, skills: {}, pets: {} };
    // legacy collection stored booleans (true=seen); convert to rarity rank 0 (common)
    ['weapons', 'skills', 'pets'].forEach(k => {
      const b = s.collection[k] || (s.collection[k] = {});
      for (const id in b) if (b[id] === true) b[id] = 0;
    });
    if (!s.masteries) s.masteries = {};
    if (s.masteries.fist == null) s.masteries.fist = 0;
    ['blade', 'blunt', 'axe', 'spear'].forEach(c => { if (s.masteries[c] == null) s.masteries[c] = 0; });
    if (!s.petMast) s.petMast = {};
    if (!s.skillMast) s.skillMast = {};
    if (s.brute) migrateBrute(s.brute, computeSkillSlots(s.powerTier || 0));
    return s;
  }

  /* Convert a pre-loadout brute (string skill/pet ids, no equipped slots)
   * into the instanced loadout model, preserving everything it owned. */
  function migrateBrute(b, slots) {
    const rng = () => new RNG(randomSeed());
    if (Array.isArray(b.weapons)) {
      b.weapons = b.weapons.map(w => typeof w === 'string'
        ? global.Items.generateWeapon(w, rng(), { rarity: 'common' }) : w);
    }
    if (Array.isArray(b.skills)) {
      b.skills = b.skills.map(s => typeof s === 'string'
        ? global.Items.generateSkill(s, rng(), { rarity: 'common' }) : s);
    }
    if (Array.isArray(b.pets)) {
      b.pets = b.pets.map(p => typeof p === 'string'
        ? global.Items.generatePet(p, rng(), { rarity: 'common' }) : p);
    }
    if (!b.equipped) b.equipped = { weapon: null, pet: null, skills: [] };
    C.autoEquip(b, slots);   // equip best weapon / first pet / up to N skills
    return b;
  }
  // ---- Power Ranks: claimed tiers grant a cumulative bundle of permanent buffs ----
  function rankSlotCount(tier) { return D.POWER_RANKS.skillSlotTiers.filter(t => t <= (tier || 0)).length; }
  function rankBonuses() {
    const R = D.POWER_RANKS, T = state.powerTier || 0;
    let stats = 0, stam = 0, gold = 0, xp = 0, idle = 0, luck = 0;
    for (let t = 1; t <= T; t++) { stats += R.statsPct(t); stam += R.staminaPer; gold += R.goldPer; xp += R.xpPer; idle += R.idlePer; luck += R.luckPer; }
    return { stats, stam, gold, xp, idle, luck, slots: rankSlotCount(T) };
  }
  // skill slots: base 3, +1 at each skill-slot rank tier
  function computeSkillSlots(tier) { return 3 + rankSlotCount(tier || 0); }
  function skillSlots() { return computeSkillSlots(state.powerTier || 0); }

  function now() { return Date.now(); }

  function save() {
    if (wiped) return; // a reset is in progress; never re-persist old state
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /* ---------------- derived values ---------------- */
  // max stamina + regen now scale with your highest Arena division reached
  function arenaBestRank() { return arenaRankIdx((state.arena && state.arena.best) || 0); }
  function staminaMax() { return STAMINA_BASE + arenaBestRank() * D.ARENA.staminaPerRank + rankBonuses().stam; }
  function staminaRegenTime() {
    return Math.max(6, STAMINA_REGEN_BASE - arenaBestRank() * D.ARENA.regenPerRank);
  }
  function trainXpRate() { return D.TRAINING.baseXpSec * (1 + rankBonuses().idle); }
  function trainXpCap() { return D.TRAINING.capBase * (1 + rankBonuses().idle); }
  function goldMul() { return 1 + rankBonuses().gold; }
  function xpMul() { return Math.max(0.4, 1 + rankBonuses().xp + prisonBuff() - captorPenalty()); }

  /* ---------------- prison (captured players → power-scaled battle-XP buff) ---------------- */
  const PRISON_SLOTS = 3;
  const PRISON_PER_CAP = 0.08;     // max XP buff one prisoner can give
  // a prisoner stronger than you is worth more; weaker still gives a small cut
  function prisonValue(p) {
    const mine = livePower() || 1;
    return Math.max(0.01, Math.min(PRISON_PER_CAP, (p.power / mine) * PRISON_PER_CAP));
  }
  function prisonBuff() {
    const list = state.prison || [];
    return list.reduce((s, p) => s + prisonValue(p), 0);
  }
  function prisonList() {
    return (state.prison || []).map(p => ({ ...p, buff: prisonValue(p) }));
  }
  function capturePrisoner(p) {
    if (!p || !p.id) return false;
    state.prison = state.prison || [];
    if (state.prison.some(x => x.id === p.id)) return false;   // already jailed
    const entry = { id: p.id, name: p.name || 'Unknown', tag: p.tag || '', power: p.power || 0, at: now() };
    if (state.prison.length >= PRISON_SLOTS) {
      // replace the weakest only if the newcomer is stronger
      let wi = 0; for (let i = 1; i < state.prison.length; i++) if (state.prison[i].power < state.prison[wi].power) wi = i;
      if (state.prison[wi].power >= entry.power) return false;
      state.prison[wi] = entry;
    } else {
      state.prison.push(entry);
    }
    save();
    return true;
  }
  function releasePrisoner(id) {
    state.prison = (state.prison || []).filter(p => p.id !== id);
    save();
  }

  /* ---------------- captors (lose a PvP attack → you're jailed; free yourself) ---------------- */
  const CAPTOR_PER_CAP = 0.06;     // max battle-XP penalty one captor inflicts
  function captorValue(p) {
    const mine = livePower() || 1;
    return Math.max(0.01, Math.min(CAPTOR_PER_CAP, (p.power / mine) * CAPTOR_PER_CAP));
  }
  function captorPenalty() {
    return (state.captors || []).reduce((s, p) => s + captorValue(p), 0);
  }
  function captorList() {
    return (state.captors || []).map(p => ({ ...p, penalty: captorValue(p), bribe: bribeCost(p) }));
  }
  function bribeCost(p) {
    return Math.max(25, Math.round((p.power || 0) * 0.6));   // gold to buy your way out
  }
  function addCaptor(p) {
    if (!p || !p.id) return false;
    state.captors = state.captors || [];
    if (state.captors.some(x => x.id === p.id)) return false;
    state.captors.push({ id: p.id, name: p.name || 'Unknown', tag: p.tag || '', power: p.power || 0, at: now() });
    save();
    return true;
  }
  function freeCaptor(id) {   // freed by beating them in a rematch
    const had = (state.captors || []).some(p => p.id === id);
    state.captors = (state.captors || []).filter(p => p.id !== id);
    if (had) save();
    return had;
  }
  function bribeCaptor(id) {  // pay gold to escape without fighting
    const p = (state.captors || []).find(x => x.id === id);
    if (!p) return { ok: false };
    const cost = bribeCost(p);
    if ((state.gold || 0) < cost) return { ok: false, cost, short: true };
    state.gold -= cost;
    state.captors = state.captors.filter(x => x.id !== id);
    save(); renderAll();
    return { ok: true, cost, name: p.name };
  }
  function livePower() {
    if (!state.brute || !global.Character) return 0;
    return global.Character.powerRating(state.brute, metaBonuses());
  }

  /* ---------------- weekly tournament reward claims ---------------- */
  function tourneyClaimed(id) { return !!(state.tourney && state.tourney.claimed && state.tourney.claimed[id]); }
  function claimTourney(id, gold) {
    state.tourney = state.tourney || { claimed: {} };
    if (state.tourney.claimed[id]) return false;
    state.tourney.claimed[id] = true;
    state.gold = (state.gold || 0) + (gold || 0);
    save(); renderAll();
    return true;
  }
  function dropLuck() { return rankBonuses().luck; }

  /* ---------------- masteries & collection (account-wide meta) ---------------- */
  const PET_MAST_XP_PER_DMG = 0.5;   // pet-species xp per point of pet damage dealt
  const SKILL_MAST_XP_PER_FIGHT = 4; // skill-category xp per fight per equipped skill of that cat

  function lvlFromXp(xp) {
    let lvl = 0;
    while (lvl < D.MASTERY.maxLevel && (xp || 0) >= D.MASTERY.xpForLevel(lvl + 1)) lvl++;
    return lvl;
  }
  function masteryLevel(cat) { return lvlFromXp((state.masteries && state.masteries[cat]) || 0); }
  function petMasteryLevel(sp) { return lvlFromXp((state.petMast && state.petMast[sp]) || 0); }
  function skillMasteryLevel(cat) { return lvlFromXp((state.skillMast && state.skillMast[cat]) || 0); }
  function masteryLevels() {
    const out = {};
    D.MASTERY.weaponCats.forEach(c => out[c] = masteryLevel(c));
    return out;
  }

  /* The combat/power bonuses the player earns from collection + masteries. */
  function metaBonuses() {
    const col = state.collection, CB = D.COLLECTION, M = D.MASTERY, IT = global.Items;
    const rk = id => (id in col.weapons ? col.weapons[id] : null);
    // collection bonus scales with the highest rarity owned of each entry
    const sumRarity = bucket => Object.keys(bucket).reduce((a, id) => a + (1 + CB.rarityScale * (bucket[id] || 0)), 0);
    let dmgMul = 1 + sumRarity(col.weapons) * CB.perWeapon;
    let hpMul = 1 + sumRarity(col.skills) * CB.perSkill;
    let strMul = 1, agiMul = 1;
    const catDmg = { fist: 1, blade: 1, blunt: 1, axe: 1, spear: 1 };
    for (const cat of M.weaponCats) {
      catDmg[cat] += masteryLevel(cat) * M.dmgPerLevel;
      if (cat !== 'fist') {
        const inCat = D.DROPPABLE_WEAPONS.filter(w => w.cat === cat);
        if (inCat.length && inCat.every(w => w.id in col.weapons)) catDmg[cat] += CB.catCompleteDmg;
      }
    }
    // skill category masteries -> themed account-wide bonus
    for (const cat of D.SKILL_CATS) {
      const lvl = skillMasteryLevel(cat); if (!lvl) continue;
      const b = M.skillBonus[cat]; if (!b) continue;
      const amt = lvl * b.per;
      if (b.field === 'strMul') strMul += amt;
      else if (b.field === 'agiMul') agiMul += amt;
      else if (b.field === 'hpMul') hpMul += amt;
      else if (b.field === 'dmgMul') dmgMul += amt;
    }
    // equipped pet's species mastery -> pet damage multiplier
    let petMul = 1;
    const eqPet = state.brute && state.brute.equipped && state.brute.equipped.pet;
    if (eqPet && state.brute.pets) {
      const inst = state.brute.pets.find(p => p.uid === eqPet);
      if (inst) petMul = 1 + petMasteryLevel(inst.base) * M.petPerLevel;
    }
    // Power Rank tiers: permanent global power (+all stats & damage)
    const glob = rankBonuses().stats;
    if (glob) { strMul += glob; agiMul += glob; hpMul += glob; dmgMul += glob; petMul += glob; }
    return { dmgMul, hpMul, strMul, agiMul, petMul, catDmg };
  }

  // record an owned item into the rarity-ranked collection (keeps the highest rarity seen)
  function collectItem(kind, base, rarity) {
    if (!base) return;
    const bucket = kind === 'pet' ? state.collection.pets : kind === 'skill' ? state.collection.skills : state.collection.weapons;
    const rank = global.Items.rarityRank(rarity || 'common');
    if (!(base in bucket) || rank > bucket[base]) bucket[base] = rank;
  }
  function collectWeapon(base, rarity) { collectItem('weapon', base, rarity); }
  function syncCollection(brute) {
    if (!brute) return;
    brute.weapons.forEach(w => collectItem('weapon', w.base, w.rarity));
    brute.skills.forEach(s => collectItem('skill', s.base || s, s.rarity));
    brute.pets.forEach(p => collectItem('pet', p.base || p, p.rarity));
  }
  function awardMastery(playerStats) {
    if (!playerStats) return;
    const toastLvl = (label, before, after) => { if (after > before) UI.toast(`${label} Mastery hits Lv ${after}!`, 'good'); };
    // weapon categories (incl. fists)
    if (playerStats.catHits) {
      for (const cat of D.MASTERY.weaponCats) {
        const hits = playerStats.catHits[cat] || 0;
        if (hits <= 0) continue;
        const before = masteryLevel(cat);
        state.masteries[cat] = (state.masteries[cat] || 0) + hits * MASTERY_XP_PER_HIT;
        toastLvl(D.CAT_NAMES[cat] || cat, before, masteryLevel(cat));
      }
    }
    const b = state.brute;
    // equipped pet's species levels from pet damage dealt
    const petDmg = playerStats.petDmgDealt || 0;
    const eqPet = b && b.equipped && b.equipped.pet && (b.pets || []).find(p => p.uid === b.equipped.pet);
    if (eqPet && petDmg > 0) {
      const before = petMasteryLevel(eqPet.base);
      state.petMast[eqPet.base] = (state.petMast[eqPet.base] || 0) + petDmg * PET_MAST_XP_PER_DMG;
      const pn = (D.PETS[eqPet.base] || {}).name || 'Pet';
      toastLvl(pn, before, petMasteryLevel(eqPet.base));
    }
    // each equipped skill feeds its category mastery
    if (b && b.equipped && b.equipped.skills) {
      const cats = {};
      b.equipped.skills.forEach(uid => {
        const inst = (b.skills || []).find(s => s.uid === uid);
        if (inst) cats[D.skillCatOf(inst.base)] = true;
      });
      for (const cat in cats) {
        const before = skillMasteryLevel(cat);
        state.skillMast[cat] = (state.skillMast[cat] || 0) + SKILL_MAST_XP_PER_FIGHT;
        toastLvl(D.SKILL_CAT_NAMES[cat] || cat, before, skillMasteryLevel(cat));
      }
    }
  }


  /* ---------------- stats (career + lifetime) ---------------- */
  function emptyStats() {
    const o = {};
    D.STAT_DEFS.forEach(d => o[d.key] = 0);
    return o;
  }
  // ensure every canonical key exists on a (possibly older/missing) stats object
  function fillStats(o) {
    o = o || {};
    D.STAT_DEFS.forEach(d => { if (typeof o[d.key] !== 'number') o[d.key] = 0; });
    return o;
  }
  function ensureStats() {
    state.lifetime = fillStats(state.lifetime);
    if (state.brute) state.brute.career = fillStats(state.brute.career);
  }
  function addInto(target, delta) { for (const k in delta) target[k] = (target[k] || 0) + delta[k]; }
  function accumulateStats(delta) {
    ensureStats();
    addInto(state.lifetime, delta);
    if (state.brute) addInto(state.brute.career, delta);
  }
  // turn a finished fight into a stat delta
  function extractFightStats(result, won, isGauntlet, earned) {
    const ps = (result && result.playerStats) || {};
    earned = earned || {};
    let crits = 0;
    for (const e of (result && result.events) || []) {
      if ((e.type === 'hit' || e.type === 'counter') && e.crit && e.source && String(e.source)[0] === 'L') crits++;
    }
    return {
      dmgDealt: Math.round(ps.dmgDealt || 0),
      dmgTaken: Math.round(ps.dmgTaken || 0),
      healed: Math.round(ps.healed || 0),
      petDmgDealt: Math.round(ps.petDmgDealt || 0),
      petDmgTaken: Math.round(ps.petDmgTaken || 0),
      crits,
      kills: ps.kills || 0,
      petDeaths: ps.petDeaths || 0,
      wins: won ? 1 : 0,
      losses: won ? 0 : 1,
      arenaFights: isGauntlet ? 0 : 1,
      gauntletFights: isGauntlet ? 1 : 0,
      goldEarned: Math.round(earned.gold || 0),
      dustEarned: Math.round(earned.dust || 0),
      xpEarned: Math.round(earned.xp || 0),
    };
  }

  /* ---------------- loot ---------------- */
  function addWeaponToBrute(item) {
    state.brute.weapons.push(item);
    collectWeapon(item.base, item.rarity);
    if (state.brute.weapons.length > WEAPON_CAP) {
      const equippedUid = state.brute.equipped && state.brute.equipped.weapon;
      let wi = -1, wp = Infinity;
      state.brute.weapons.forEach((w, i) => {
        if (w.uid === equippedUid) return;           // never auto-scrap the equipped weapon
        const p = global.Items.stats(w).power;
        if (p < wp) { wp = p; wi = i; }
      });
      if (wi >= 0) {
        const weak = state.brute.weapons[wi];
        state.dust += global.Items.disenchantValue(weak);
        state.shards += global.Items.shardValue(weak);
        state.brute.weapons.splice(wi, 1);
      }
    }
  }
  function dropItem(luck) {
    const rng = new RNG(randomSeed());
    const base = rng.pick(D.DROPPABLE_WEAPONS).id;
    const item = global.Items.generateWeapon(base, rng, { luck: luck, dropLevel: state.brute ? state.brute.level : 1 });
    addWeaponToBrute(item);
    return item;
  }
  function lootBadge(item) {
    return `<b style="color:${global.Items.color(item)}">${global.Items.displayName(item)}</b>`;
  }

  /* ---------------- bounties ---------------- */
  function rollBounty() {
    const rng = new RNG(randomSeed());
    const tpl = rng.weighted(D.BOUNTIES.templates.map(t => ({ item: t, weight: t.weight })));
    const made = tpl.make(rng, state.gauntlet.best || 1);
    return Object.assign({ type: tpl.id, icon: tpl.icon, progress: 0, done: false }, made);
  }
  function ensureBounties() {
    if (!state.bounties) state.bounties = { list: [], lastRefresh: now() };
    while (state.bounties.list.length < D.BOUNTIES.slots) state.bounties.list.push(rollBounty());
  }
  function refreshBountiesIfDue() {
    ensureBounties();
    const due = state.bounties.lastRefresh + D.BOUNTIES.refreshHours * 3600 * 1000;
    if (now() >= due) {
      // rotate only the un-completed bounties; never wipe a claimable reward
      state.bounties.list = state.bounties.list.map(b => (b && b.done) ? b : rollBounty());
      state.bounties.lastRefresh = now();
      save(); renderAll();
    }
  }
  // build the per-fight context bounties measure against
  function fightContext(won, isGauntlet, result, floorReached) {
    let crits = 0;
    const evs = (result && result.events) || [];
    for (const e of evs) {
      if ((e.type === 'hit' || e.type === 'counter') && e.crit && e.source && String(e.source)[0] === 'L') crits++;
    }
    return {
      won,
      arenaWin: won && !isGauntlet,
      gauntletWin: won && isGauntlet,
      crits,
      catHits: (result && result.playerStats && result.playerStats.catHits) || {},
      floorReached: floorReached != null ? floorReached : null,
    };
  }
  function progressBounties(ctx) {
    ensureBounties();
    let changed = false;
    for (const b of state.bounties.list) {
      if (!b || b.done) continue;
      const before = b.progress;
      switch (b.type) {
        case 'gauntletClear': if (ctx.gauntletWin) b.progress++; break;
        case 'arenaWin':      if (ctx.arenaWin) b.progress++; break;
        case 'anyWin':        if (ctx.won) b.progress++; break;
        case 'crits':         b.progress += ctx.crits; break;
        case 'catHits':       b.progress += (ctx.catHits[b.cat] || 0); break;
        case 'reachFloor':    if (ctx.floorReached != null) b.progress = Math.max(b.progress, ctx.floorReached); break;
      }
      if (b.progress > b.target) b.progress = b.target;
      if (b.progress !== before) changed = true;
      if (b.progress >= b.target && !b.done) { b.done = true; changed = true; UI.toast(`Bounty bagged! Step up and claim it: ${b.desc}`, 'good'); }
    }
    if (changed) { save(); updateBountyBadge(); }
  }
  // persistent alert on the BOUNTIES nav tab: how many are ready to claim
  function updateBountyBadge() {
    const el = $('#bounty-badge');
    if (!el) return;
    const n = (state.bounties && state.bounties.list || []).filter(b => b && b.done).length;
    el.textContent = n;
    el.classList.toggle('hidden', n <= 0);
  }

  /* ---- live info + alerts under each nav-menu button ---- */
  function setNavSub(id, text, hot) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hot', !!hot && !!text);
  }
  function setNavBadge(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  }
  function collectionOwned() {
    const c = state.collection || {};
    return Object.keys(c.weapons || {}).length + Object.keys(c.skills || {}).length + Object.keys(c.pets || {}).length;
  }
  function updateNavInfo() {
    if (!state || !state.brute) return;
    const fmt = UI.fmt;
    const pvp = (global.PVP && global.PVP.navInfo) ? global.PVP.navInfo() : null;
    // FIGHT
    setNavSub('nav-arena', arenaInfo().label);
    const best = (state.gauntlet && state.gauntlet.best) || 0;
    setNavSub('nav-gauntlet', best > 0 ? 'Floor ' + fmt(best) : '');
    setNavSub('nav-pvp', (pvp && pvp.rating != null) ? 'RTG ' + pvp.rating : '');
    const bank = Math.floor(state.training || 0);
    setNavSub('nav-sparring', bank > 0 ? fmt(bank) + ' XP' : '');
    // BRUTE
    setNavSub('nav-brute', 'Lv ' + (state.brute.level || 1) + ' · ' + fmt(Math.round(livePower())));
    setNavSub('nav-forge', (state.shards || 0) > 0 ? fmt(state.shards) + ' shards' : '');
    setNavSub('nav-collection', collectionOwned() + ' owned');
    // SOCIAL
    setNavSub('nav-prison', (state.prison || []).length ? (state.prison.length + ' held') : '');
    setNavSub('nav-tournament', (pvp && pvp.tourneyLocked) ? 'Locked in' : '');
    const battlesNew = !!(pvp && pvp.battlesLatestAt && pvp.battlesLatestAt > (state.battlesSeenAt || 0));
    setNavBadge('battles-badge', battlesNew);
    // PROGRESS
    const rk = rankInfo();
    setNavBadge('ascend-badge', rk.ready);
    setNavSub('nav-ascension', rk.ready ? 'Claim!' : (rk.maxed ? 'MAX' : 'Tier ' + rk.claimed), rk.ready);
    ensureShop();
    const dueMs = ((state.shopStock && state.shopStock.lastRefresh) || 0) + D.SHOP.refreshHours * 3600000 - now();
    setNavSub('nav-shop', '↻ ' + formatDuration(Math.max(0, Math.ceil(dueMs / 1000))));
    const av = achievementsData();
    setNavSub('nav-achievements', av.reduce((s, a) => s + a.tiersDone, 0) + '/' + av.reduce((s, a) => s + a.tiersTotal, 0));
  }
  // called by PVP when the Battles tab is opened: clear the "new battles" dot
  function markBattlesSeen() {
    const pvp = (global.PVP && global.PVP.navInfo) ? global.PVP.navInfo() : null;
    if (pvp && pvp.battlesLatestAt) { state.battlesSeenAt = pvp.battlesLatestAt; save(); }
    setNavBadge('battles-badge', false);
  }
  function claimBounty(idx) {
    ensureBounties();
    const b = state.bounties.list[idx];
    if (!b || !b.done) return;
    const r = b.reward || {};
    if (r.gold) state.gold += r.gold;
    if (r.dust) state.dust += r.dust;
    const parts = [];
    if (r.gold) parts.push(`🪙${UI.fmt(r.gold)}`);
    if (r.dust) parts.push(`✦${r.dust}`);
    UI.toast(`📜 Loot in the bag: ${parts.join(' • ')}`, 'good');
    state.bounties.list[idx] = rollBounty();
    save(); renderAll();
  }
  function rerollBounty(idx) {
    ensureBounties();
    const b = state.bounties.list[idx];
    if (!b || b.done) return;
    const cost = D.BOUNTIES.rerollCost;
    if (state.dust < cost) { UI.toast('Not enough dust for that reroll.', 'bad'); return; }
    state.dust -= cost;
    state.bounties.list[idx] = rollBounty();
    save(); renderAll();
  }

  /* ---------------- equip / loadout ---------------- */
  function isEquipped(uid) {
    const e = state.brute.equipped || {};
    return e.weapon === uid || e.pet === uid || (e.skills || []).includes(uid);
  }
  function equipWeapon(uid) {
    if (!state.brute.weapons.some(w => w.uid === uid)) return;
    state.brute.equipped.weapon = uid; save(); renderAll(); refreshIdleBrute();
  }
  function equipPet(uid) {
    if (uid && !state.brute.pets.some(p => p.uid === uid)) return;
    state.brute.equipped.pet = uid || null; save(); renderAll(); refreshIdleBrute();
  }
  function toggleSkill(uid) {
    const eq = state.brute.equipped;
    const i = eq.skills.indexOf(uid);
    if (i >= 0) { eq.skills.splice(i, 1); }
    else {
      if (eq.skills.length >= skillSlots()) { UI.toast('Skill slots are jammed full. Drop one first.', 'bad'); return; }
      if (!state.brute.skills.some(s => s.uid === uid)) return;
      eq.skills.push(uid);
    }
    save(); renderAll(); refreshIdleBrute();
  }

  /* ---------------- forge (works on weapons, pets & skills) ---------------- */
  function findInstance(uid) {
    const b = state.brute; if (!b) return null;
    return b.weapons.find(x => x.uid === uid) || b.pets.find(x => x.uid === uid) || b.skills.find(x => x.uid === uid) || null;
  }
  function inventoryOf(inst) {
    const k = global.Items.kindOf(inst);
    return k === 'pet' ? state.brute.pets : k === 'skill' ? state.brute.skills : state.brute.weapons;
  }
  function forgeUpgrade(uid) {
    const it = findInstance(uid); if (!it) return;
    const cost = global.Items.upgradeCost(it);
    if (state.gold < cost) { UI.toast('Pockets empty, champ.', 'bad'); return; }
    state.gold -= cost; global.Items.upgrade(it);
    UI.toast(`Beefed up to +${it.level}!`, 'good'); save(); renderAll();
  }
  function forgeReroll(uid) {
    const it = findInstance(uid); if (!it) return;
    if (!global.Items.canReroll(it)) { UI.toast('Nothing on this one to reroll.', 'bad'); return; }
    const cost = global.Items.rerollCost(it);
    if (state.dust < cost) { UI.toast('Not enough dust for that.', 'bad'); return; }
    state.dust -= cost; global.Items.reroll(it, new RNG(randomSeed()));
    UI.toast(global.Items.kindOf(it) === 'skill' ? 'Potency rolled fresh!' : 'Affixes rolled fresh!', 'good');
    save(); renderAll();
  }
  function forgeDisenchant(uid) {
    const it = findInstance(uid); if (!it) return;
    if (isEquipped(uid)) { UI.toast('Take it off before you scrap it.', 'bad'); return; }
    const inv = inventoryOf(it);
    if (global.Items.kindOf(it) === 'weapon' && state.brute.weapons.length <= 1) { UI.toast('No way, that is your last weapon!', 'bad'); return; }
    const d = global.Items.disenchantValue(it);
    const sh = global.Items.shardValue(it);
    state.dust += d; state.shards += sh;
    const i = inv.findIndex(x => x.uid === uid); if (i >= 0) inv.splice(i, 1);
    UI.toast(`Smashed for parts (+${d} dust, +${sh} shards)`, 'good'); save(); renderAll();
  }
  function forgeFuse(uid) {
    const it = findInstance(uid); if (!it) return;
    const inv = inventoryOf(it);
    const partner = inv.find(w => global.Items.canFuse(it, w));
    if (!partner) { UI.toast('Fusing takes two of the same type at the same rarity.', 'bad'); return; }
    const cost = global.Items.fuseDustCost(it);
    if (state.dust < cost) { UI.toast('Not enough dust to fuse.', 'bad'); return; }
    state.dust -= cost;
    const wasEquipped = isEquipped(it.uid) || isEquipped(partner.uid);
    const fused = global.Items.fuse(it, partner, new RNG(randomSeed()));
    const keep = inv.filter(w => w.uid !== it.uid && w.uid !== partner.uid);
    keep.push(fused);
    inv.length = 0; inv.push(...keep);
    collectItem(global.Items.kindOf(fused), fused.base, fused.rarity);
    if (wasEquipped) C.autoEquip(state.brute, skillSlots());
    UI.toast(`SMASHED TOGETHER into ${global.Items.rarityName(fused)} ${global.Items.displayName(fused)}!`, 'good');
    save(); renderAll(); refreshIdleBrute();
  }
  // shards needed to craft a base (weapon/pet/skill), scaling with its tier
  function craftDict(kind) { return kind === 'pet' ? D.PETS : kind === 'skill' ? D.SKILLS : D.WEAPONS; }
  function craftCost(kind, base) {
    const tier = (craftDict(kind)[base] && craftDict(kind)[base].tier) || 1;
    return D.CRAFT.shardBase + tier * D.CRAFT.shardPerTier;
  }
  function setCraftTarget(kind, base) {
    state.craftKind = kind || 'weapon';
    state.craftTarget = base || null;
    save(); renderAll();
  }
  function forgeCraft() {
    const kind = state.craftKind || 'weapon';
    const base = state.craftTarget;
    const dict = craftDict(kind);
    if (!base || !dict[base]) { UI.toast('Pick something to craft first.', 'bad'); return; }
    const cost = craftCost(kind, base);
    if (state.shards < cost) { UI.toast('Not enough shards for that.', 'bad'); return; }
    state.shards -= cost;
    const rng = new RNG(randomSeed());
    const It = global.Items;
    const gen = kind === 'pet' ? It.generatePet : kind === 'skill' ? It.generateSkill : It.generateWeapon;
    const item = gen(base, rng, { dropLevel: state.brute ? state.brute.level : 1, luck: D.CRAFT.luckBonus });
    if (kind === 'pet') { state.brute.pets.push(item); collectItem('pet', item.base, item.rarity); }
    else if (kind === 'skill') { state.brute.skills.push(item); collectItem('skill', item.base, item.rarity); }
    else addWeaponToBrute(item);
    UI.toast(`Hot off the anvil: ${It.rarityName(item)} ${It.displayName(item)}!`, 'good');
    save(); renderAll();
  }

  // equip the highest-power weapon, pet, and top skills (max power loadout)
  function autoEquipBest() {
    const b = state.brute; if (!b) return;
    const It = global.Items;
    if (b.weapons.length) {
      let best = b.weapons[0], bp = It.stats(best).power;
      for (const w of b.weapons) { const p = It.stats(w).power; if (p > bp) { bp = p; best = w; } }
      b.equipped.weapon = best.uid;
    }
    if (b.pets.length) {
      let best = b.pets[0], bp = It.petStats(best).power;
      for (const p of b.pets) { const pw = It.petStats(p).power; if (pw > bp) { bp = pw; best = p; } }
      b.equipped.pet = best.uid;
    }
    const slots = skillSlots();
    const ranked = b.skills.slice().sort((a, c) =>
      (It.rarityRank(c.rarity) - It.rarityRank(a.rarity)) || ((c.level || 0) - (a.level || 0)));
    b.equipped.skills = ranked.slice(0, slots).map(s => s.uid);
    UI.toast('Suited up in your nastiest gear!', 'good');
    save(); renderAll(); refreshIdleBrute();
  }
  // repeatedly fuse every available duplicate pair of one type (chains up rarities)
  function autoMerge(kind) {
    const b = state.brute; if (!b) return;
    const It = global.Items;
    const inv = kind === 'pet' ? b.pets : kind === 'skill' ? b.skills : b.weapons;
    let fused = 0, guard = 0, ranDry = false;
    while (guard++ < 1000) {
      let a = null, p = null;
      for (let i = 0; i < inv.length && !a; i++) {
        for (let j = i + 1; j < inv.length; j++) {
          if (It.canFuse(inv[i], inv[j])) { a = inv[i]; p = inv[j]; break; }
        }
      }
      if (!a) break;
      const cost = It.fuseDustCost(a);
      if (state.dust < cost) { ranDry = true; break; }
      state.dust -= cost;
      const wasEq = isEquipped(a.uid) || isEquipped(p.uid);
      const f = It.fuse(a, p, new RNG(randomSeed()));
      const keep = inv.filter(w => w.uid !== a.uid && w.uid !== p.uid);
      keep.push(f); inv.length = 0; inv.push(...keep);
      collectItem(It.kindOf(f), f.base, f.rarity);
      if (wasEq) C.autoEquip(state.brute, skillSlots());
      fused++;
    }
    if (fused) { UI.toast(`Auto-smashed ${fused} fusion${fused > 1 ? 's' : ''}${ranDry ? ' (then ran dry on dust)' : ''}!`, 'good'); save(); renderAll(); refreshIdleBrute(); }
    else UI.toast(ranDry ? 'Not enough dust to fuse.' : 'No duplicates to smash together.', 'bad');
  }

  /* ---------------- gauntlet ---------------- */
  function climbGauntlet(auto) {
    if (fightInProgress) return;
    // manual click resolves queued level-ups first; auto-climb leaves them queued
    if (!auto && pendingLevels > 0) { processLevelUps(() => {}); return; }
    fightInProgress = true;
    const floor = state.gauntlet.floor;
    const opp = C.generateGauntletOpponent(floor, new RNG(randomSeed()));
    const result = global.Combat.simulateBattle(state.brute, opp, randomSeed(), {
      leftBonuses: metaBonuses(),
    });
    const won = result.winner === 'left';
    renderAll();
    UI.replayBattle(result, state.brute, opp, state.settings.fastFight).then((finished) => {
      if (!finished) { fightInProgress = false; return; }
      resolveGauntlet(won, floor, result, auto);
    }).catch((e) => { console.error('gauntlet replay failed', e); fightInProgress = false; renderAll(); });
  }
  function resolveGauntlet(won, floor, result, auto) {
    const isBoss = floor % D.GAUNTLET.bossEvery === 0;
    const isMilestone = floor % D.GAUNTLET.milestoneEvery === 0;
    const earned = { gold: 0, dust: 0, xp: 0 };
    awardMastery(result.playerStats);
    syncCollection(state.brute);
    if (won) {
      const xp = Math.round((20 + floor * 6) * xpMul());
      const gold = Math.round((15 + floor * 7) * goldMul());
      let dust = Math.round(3 + floor * 1.2) + (isBoss ? 20 : 0) + (isMilestone ? 40 : 0);
      state.gold += gold; state.dust += dust;
      earned.gold = gold; earned.dust = dust; earned.xp = xp;
      let dropTxt = '';
      const wantDrop = isBoss || Math.random() < 0.28;
      if (wantDrop) { dropTxt = ' • ' + lootBadge(dropItem(Math.min(0.95, (isBoss ? 0.3 : 0.1) + floor * 0.04))); }
      if (isMilestone) { const mg = 40 + floor * 4, md = 6 + Math.floor(floor / 5); state.gold += mg; state.dust += md; dropTxt += ` • 🪙+${mg} ✦+${md}`; }
      state.gauntlet.floor = floor + 1;
      if (floor > state.gauntlet.best) state.gauntlet.best = floor;
      if (isBoss) state.gauntlet.checkpoint = floor + 1;
      const tag = isMilestone ? ' 🏆' : (isBoss ? ' 👑' : '');
      UI.showOutcome(true, `<div>FLOOR ${floor} CLEARED${tag}<br>+${UI.fmt(xp)} XP • +🪙${UI.fmt(gold)} • +✦${dust}${dropTxt}</div>`);
      grantXp(xp, true);
    } else {
      state.brute.losses++;
      const back = state.gauntlet.checkpoint || 1;
      state.gauntlet.floor = back;
      state.settings.autoClimb = false;   // stop auto-climbing once you hit your wall
      UI.showOutcome(false, `<div>FELL ON FLOOR ${floor}<br>Back to floor ${back}</div>`);
    }
    progressBounties(fightContext(won, true, result, won ? state.gauntlet.floor : null));
    accumulateStats(extractFightStats(result, won, true, earned));
    fightInProgress = false;
    save(); renderAll();
    const contAuto = () => {
      if (won && state.settings.autoClimb) {
        setTimeout(() => { if (state.settings.autoClimb && !fightInProgress) climbGauntlet(true); }, state.settings.fastFight ? 500 : 1400);
      }
    };
    if (auto) {
      // auto-climb: leave level-ups queued and keep going
      contAuto();
    } else {
      processLevelUps(contAuto);
      if (!state.settings.autoClimb) idleSoon();
    }
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('active'));
    const pane = document.getElementById('tab-' + name);
    if (pane) pane.classList.add('active');
    if (UI.updateFightView) UI.updateFightView(name);
  }

  /* ---------------- offline / tick progression ---------------- */
  function applyElapsed() {
    const t = now();
    let elapsed = (t - state.lastTick) / 1000;
    state.lastTick = t;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > OFFLINE_CAP_SEC) elapsed = OFFLINE_CAP_SEC;

    // stamina regen
    if (state.stamina < staminaMax()) {
      state.staminaProgress += elapsed;
      const per = staminaRegenTime();
      while (state.staminaProgress >= per && state.stamina < staminaMax()) {
        state.staminaProgress -= per;
        state.stamina++;
      }
      if (state.stamina >= staminaMax()) state.staminaProgress = 0;
    }

    // idle training: bank XP up to a cap. Sparring "Focus" multiplies the rate
    // and decays over time; integrate the decay across the elapsed window so
    // offline returns don't keep a stale buff.
    if (state.brute) {
      const F0 = state.sparFocus || 0, decay = D.SPAR.decaySec;
      let focusSec = 0;
      if (F0 > 0) {
        const tz = F0 * decay;   // seconds until focus hits 0
        focusSec = elapsed >= tz ? 0.5 * F0 * tz : elapsed * F0 - 0.5 * elapsed * elapsed / decay;
        state.sparFocus = Math.max(0, F0 - elapsed / decay);
      }
      const cap = trainXpCap();
      const gained = trainXpRate() * (elapsed + D.SPAR.perFocus * focusSec);
      state.training = Math.min(cap, (state.training || 0) + gained);
    }
    return elapsed;
  }

  /* Claim banked idle training XP: feed it into normal leveling. */
  function claimTraining() {
    if (!state.brute) return;
    const xp = Math.floor(state.training || 0);
    if (xp <= 0) { UI.toast('Nothing banked yet. Let it sit and stew a while.', 'bad'); return; }
    state.training = 0;
    grantXp(xp, true);
    UI.toast('Cashed in ' + UI.fmt(xp) + ' training XP!', 'good');
    save(); renderAll();
    processLevelUps(() => {});
  }
  // sparring: a no-stakes practice fight that builds Focus (boosts idle XP rate).
  // No stamina, no loot, no direct XP.
  function spar() {
    if (fightInProgress || !state.brute) return;
    fightInProgress = true;
    const rng = new RNG(randomSeed());
    const opp = C.generateOpponent(state.brute.level, rng, { level: Math.max(1, state.brute.level) });
    opp.name = 'Training Dummy';
    const result = global.Combat.simulateBattle(state.brute, opp, randomSeed(), { leftBonuses: metaBonuses() });
    renderAll();
    UI.replayBattle(result, state.brute, opp, state.settings.fastFight).then((finished) => {
      fightInProgress = false;
      if (!finished) return;
      state.sparFocus = Math.min(D.SPAR.maxFocus, (state.sparFocus || 0) + 1);   // no-stakes: always +1 Focus
      save(); renderAll();
    }).catch((e) => { console.error('spar replay failed', e); fightInProgress = false; renderAll(); });
  }

  /* ---------------- xp / leveling ---------------- */
  function grantXp(amount, silent) {
    if (!state.brute) return;
    const gained = P.addXp(state.brute, Math.round(amount));
    if (gained > 0) {
      pendingLevels += gained;
      if (!silent) UI.toast(`✨ DING DING! Your brute is now level ${state.brute.level}!`, 'good');
    }
  }

  function processLevelUps(after) {
    if (pendingLevels <= 0) { if (after) after(); return; }
    if (UI.isModalOpen()) return;
    const lvl = state.brute.level - pendingLevels + 1;
    const rng = new RNG(randomSeed());
    const choices = P.generateChoices(state.brute, rng, dropLuck());
    const gains = state.brute._gain; state.brute._gain = null;   // auto-stat gains since last claim
    UI.showLevelUp(lvl, choices, (choice) => {
      P.applyChoice(state.brute, choice);
      C.autoEquip(state.brute, skillSlots());   // fill any empty loadout slot with the new item
      syncCollection(state.brute);
      pendingLevels--;
      UI.toast(`Snagged ${choice.icon} ${choice.title}!`, 'good');
      renderAll();
      save();
      // chain remaining level-ups, then run the continuation
      setTimeout(() => processLevelUps(after), 150);
    }, gains);
  }

  /* ---------------- arena rank (division ladder w/ sub-tiers) ---------------- */
  function arenaStep(arp) { return Math.min(D.ARENA.steps - 1, Math.floor((arp || 0) / D.ARENA.bandSize)); }
  function arenaRankIdx(step) { return Math.min(D.ARENA.divisions.length - 1, Math.floor(step / 3)); }
  function arenaName(step) { return D.ARENA.divisions[arenaRankIdx(step)]; }            // rank (for the medal)
  function arenaLabel(step) { return arenaName(step) + ' ' + D.ARENA.tiers[step % 3]; }  // e.g. "Bronze II"
  function arenaDiv(arp) { return arenaRankIdx(arenaStep(arp)); }                        // legacy: rank index
  function arenaInfo() {
    const A = D.ARENA, arp = (state.arena && state.arena.arp) || 0, step = arenaStep(arp);
    const isTop = step >= A.steps - 1;
    return {
      step, rankIdx: arenaRankIdx(step), name: arenaName(step), label: arenaLabel(step),
      into: arp - step * A.bandSize, band: A.bandSize, isTop, arp,
      nextLabel: isTop ? null : arenaLabel(step + 1),
    };
  }
  function arenaPromoReward(rankIdx) {
    return { gold: 60 + rankIdx * 70 + (rankIdx >= 6 ? 200 : 0), dust: 8 + rankIdx * 10, drop: rankIdx >= 3 };
  }
  // cross-mode standings shown on the brute card
  function bruteCardData() {
    const rk = rankInfo();
    return {
      arena: arenaInfo(),
      gauntletBest: (state.gauntlet && state.gauntlet.best) || 0,
      pvp: (global.PVP && global.PVP.myStats) ? global.PVP.myStats() : null,
      rank: { tier: rk.claimed, max: rk.maxTier, ready: rk.ready },
    };
  }
  function renderBrute() {
    if (!state.brute) return;
    UI.renderBruteTab(state.brute, bruteCardData());
    const rl = $('#btn-reroll-look');
    if (rl) rl.onclick = rerollAppearance;
  }
  // re-roll the brute's looks (colors + procedural face seed); propagate everywhere
  function rerollAppearance() {
    if (!state.brute) return;
    const rng = new RNG(randomSeed());
    state.brute.appearance = C.randomAppearance(rng);
    state.brute.seed = rng.int(1, 2000000000);
    save();
    renderAll();
    if (UI.showIdleBrute) UI.showIdleBrute(state.brute);   // refresh the arena idle brute
    if (global.PVP && global.PVP.publishDefense) global.PVP.publishDefense(true);  // update leaderboard snapshot
    UI.toast('Fresh new look, same bad attitude!', 'good');
  }

  /* ---------------- fighting ---------------- */
  function doFight(auto) {
    if (fightInProgress) return;
    // manual click resolves any queued level-ups first; auto-fight leaves them queued
    if (!auto && pendingLevels > 0) { processLevelUps(() => {}); return; }
    if (state.stamina < 1) { if (!auto) UI.toast('⚡ Out of gas! Let stamina top back up.', 'bad'); return; }

    fightInProgress = true;
    state.stamina--;
    save();
    renderTopbarOnly();

    const oppRng = new RNG(randomSeed());
    // opponent power is driven by your arena DIVISION (rank), not your brute level
    const step = arenaStep(state.arena.arp);
    const oppLvl = D.ARENA.oppLevel(step);
    const opponent = C.generateOpponent(oppLvl, oppRng, { level: oppLvl, statMul: D.ARENA.oppStatMul(step) });
    const seed = randomSeed();
    const result = global.Combat.simulateBattle(state.brute, opponent, seed, { leftBonuses: metaBonuses() });
    const playerWon = result.winner === 'left';

    UI.replayBattle(result, state.brute, opponent, state.settings.fastFight).then((finished) => {
      if (!finished) { fightInProgress = false; return; } // replay was cancelled
      resolveFight(playerWon, opponent, result, auto);
    }).catch((e) => { console.error('arena replay failed', e); fightInProgress = false; renderAll(); });
  }

  function resolveFight(playerWon, opponent, result, auto) {
    const lvl = opponent.level;
    const econ = 1 + arenaStep(state.arena.arp) * D.ARENA.econPerStep;   // higher steps pay more
    let xp = Math.round((playerWon ? 18 : 7) * Math.pow(lvl, 1.15) * xpMul() * econ);
    let gold = 0, dust = 0, dropTxt = '';
    if (playerWon) {
      state.brute.wins++;
      gold = Math.round((10 + lvl * 4 + Math.random() * lvl * 3) * goldMul() * econ);
      dust = Math.round(2 + lvl * 0.5);
      state.gold += gold; state.dust += dust;
      // loot drop
      const dropChance = 0.16 + rankBonuses().luck * 0.2;
      if (Math.random() < dropChance) dropTxt = ' • ' + lootBadge(dropItem(dropLuck() + 0.04));
    } else {
      state.brute.losses++;
      gold = Math.round((3 + lvl * 1.5) * goldMul() * econ);
      state.gold += gold;
    }

    awardMastery(result && result.playerStats);
    syncCollection(state.brute);

    // ---- ranked ARP + promotions ----
    const A = D.ARENA;
    const arpBefore = state.arena.arp || 0;
    state.arena.arp = Math.max(0, arpBefore + (playerWon ? A.winARP : -A.lossARP));
    const arpDelta = state.arena.arp - arpBefore;
    const newStep = arenaStep(state.arena.arp);
    let promoTxt = '';
    if (newStep > (state.arena.best || 0)) {
      const rank = arenaRankIdx(newStep);
      state.arena.best = newStep;
      const pr = arenaPromoReward(rank);
      state.gold += pr.gold; state.dust += pr.dust;
      const pdrop = pr.drop ? ' • ' + lootBadge(dropItem(0.5 + rank * 0.06)) : '';
      promoTxt = `<div class="promo">MOVING ON UP: ${arenaLabel(newStep).toUpperCase()}!<br>+${pr.gold}g • +${pr.dust} dust${pdrop}</div>`;
      UI.toast('MOVING ON UP to ' + arenaLabel(newStep) + '!', 'good');
    }
    const arpHtml = `<div class="arp-line">${arpDelta >= 0 ? '+' : ''}${arpDelta} ARP • ${arenaLabel(newStep)}</div>`;

    const rewardHtml = `<div>+${UI.fmt(xp)} XP • +🪙 ${UI.fmt(gold)}${dust ? ' • +✦ ' + dust : ''}${dropTxt}</div>${arpHtml}${promoTxt}`;
    UI.showOutcome(playerWon, rewardHtml);

    grantXp(xp, true);
    progressBounties(fightContext(playerWon, false, result, null));
    accumulateStats(extractFightStats(result, playerWon, false, { gold, dust, xp }));
    fightInProgress = false;
    save();
    renderAll();

    const contAuto = () => {
      if (state.settings.autoFight && state.stamina >= 1) {
        setTimeout(() => { if (state.settings.autoFight) doFight(true); }, state.settings.fastFight ? 500 : 1400);
      }
    };
    if (auto) {
      // auto-fight: queue level-ups (claim them when you want) and keep going
      contAuto();
    } else {
      // manual fight: open the level-up choice now, then optionally start auto-fighting
      processLevelUps(contAuto);
      idleSoon();
    }
  }

  /* ---------------- shop (rotating item stock) ---------------- */
  function rollShopItem() {
    const rng = new RNG(randomSeed());
    const S = D.SHOP, It = global.Items;
    const kind = rng.weighted(Object.keys(S.kindWeights).map(k => ({ item: k, weight: S.kindWeights[k] })));
    const lvl = state.brute ? state.brute.level : 1;
    const center = Math.min(S.maxCenter, (Math.max(1, lvl) - 1) * S.levelToCenter);
    const rarity = rng.weighted(It.rarityWeightsForCenter(center, S.spread));
    let base, inst, tier;
    if (kind === 'pet') { base = rng.pick(D.ALL_PETS); inst = It.generatePet(base.id, rng, { rarity }); tier = base.tier; }
    else if (kind === 'skill') { base = rng.pick(D.ALL_SKILLS); inst = It.generateSkill(base.id, rng, { rarity }); tier = base.tier; }
    else { base = rng.pick(D.DROPPABLE_WEAPONS); inst = It.generateWeapon(base.id, rng, { rarity }); tier = base.tier; }
    const price = Math.round((S.priceBase + (tier || 1) * S.pricePerTier) * (S.rarityMul[rarity] || 1));
    return { kind, inst, price, sold: false };
  }
  function rollShopStock() {
    state.shopStock.list = [];
    for (let i = 0; i < D.SHOP.slots; i++) state.shopStock.list.push(rollShopItem());
    state.shopStock.lastRefresh = now();
  }
  function ensureShop() {
    if (!state.shopStock) state.shopStock = { list: [], lastRefresh: 0, rerolls: 0 };
    if (state.shopStock.rerolls == null) state.shopStock.rerolls = 0;
    if (!state.shopStock.list.length) rollShopStock();
  }
  // gold to reroll right now; climbs with each manual reroll this cycle
  function shopRerollCost() {
    const n = (state.shopStock && state.shopStock.rerolls) || 0;
    return Math.round(D.SHOP.rerollCost * Math.pow(D.SHOP.rerollGrowth, n));
  }
  function refreshShopIfDue() {
    ensureShop();
    if (now() >= state.shopStock.lastRefresh + D.SHOP.refreshHours * 3600 * 1000) {
      rollShopStock();
      state.shopStock.rerolls = 0;   // the timed restock clears the stacking reroll cost
    }
  }
  function buyShopItem(idx) {
    const s = state.shopStock.list[idx];
    if (!s || s.sold) return;
    if (state.gold < s.price) { UI.toast('Pockets empty, champ.', 'bad'); return; }
    state.gold -= s.price;
    if (s.kind === 'pet') { state.brute.pets.push(s.inst); collectItem('pet', s.inst.base, s.inst.rarity); }
    else if (s.kind === 'skill') { state.brute.skills.push(s.inst); collectItem('skill', s.inst.base, s.inst.rarity); }
    else addWeaponToBrute(s.inst);
    s.sold = true;
    UI.toast(`Sold! ${global.Items.rarityName(s.inst)} ${global.Items.displayName(s.inst)} is yours.`, 'good');
    save(); renderAll();
  }
  function rerollShop() {
    const cost = shopRerollCost();
    if (state.gold < cost) { UI.toast('Not enough gold to restock the shelves.', 'bad'); return; }
    state.gold -= cost;
    state.shopStock.rerolls += 1;   // next reroll this cycle costs more
    rollShopStock();
    save(); renderAll();
  }

  /* ---------------- power ranks (endgame milestone ladder) ---------------- */
  // info for the Ranks tab + nav alert
  function rankInfo() {
    const R = D.POWER_RANKS;
    const claimed = state.powerTier || 0;
    const power = Math.round(livePower());
    const maxed = claimed >= R.maxTier;
    let claimable = 0;
    while (claimed + claimable < R.maxTier && power >= R.threshold(claimed + claimable + 1)) claimable++;
    const nextN = Math.min(claimed + 1, R.maxTier);
    const nextThreshold = R.threshold(nextN);
    const prevThreshold = claimed > 0 ? R.threshold(claimed) : 0;
    const pct = maxed ? 100 : Math.max(0, Math.min(100, ((power - prevThreshold) / ((nextThreshold - prevThreshold) || 1)) * 100));
    const tierReward = (t) => ({ stats: R.statsPct(t), stam: R.staminaPer, gold: R.goldPer, xp: R.xpPer, idle: R.idlePer, luck: R.luckPer, slot: R.skillSlotTiers.indexOf(t) >= 0 });
    const tiers = [];
    for (let t = 1; t <= R.maxTier; t++) tiers.push({ n: t, threshold: R.threshold(t), claimed: t <= claimed, claimable: t > claimed && t <= claimed + claimable, reward: tierReward(t) });
    return { claimed, maxTier: R.maxTier, power, maxed, claimable, ready: claimable > 0, nextThreshold, prevThreshold, pct, totals: rankBonuses(), tiers };
  }
  /* ---------------- achievements (display-only progress) ---------------- */
  function rarityOwnedCount(minRarity) {
    const min = global.Items.rarityRank(minRarity);
    let n = 0;
    ['weapons', 'skills', 'pets'].forEach(k => { const b = state.collection[k]; for (const id in b) if (b[id] >= min) n++; });
    return n;
  }
  function achievementsData() {
    const col = state.collection, life = state.lifetime || {};
    const maxWeaponMast = Math.max(0, ...D.MASTERY.weaponCats.map(c => masteryLevel(c)));
    const pvp = (global.PVP && global.PVP.myStats && global.PVP.myStats()) || null;
    const It = global.Items, RAR = It.RARITIES;
    // highest rarity rank owned anywhere in the collection (for the rarity-ladder track)
    let maxRarity = 0;
    ['weapons', 'skills', 'pets'].forEach(k => { const b = col[k] || {}; for (const id in b) maxRarity = Math.max(maxRarity, b[id]); });

    const metric = (a) => {
      switch (a.kind) {
        case 'collectCount': { const list = a.group === 'skills' ? D.ALL_SKILLS : a.group === 'pets' ? D.ALL_PETS : D.DROPPABLE_WEAPONS; return list.filter(it => it.id in col[a.group]).length; }
        case 'rarityLadder': return maxRarity;
        case 'rarityCount':  return rarityOwnedCount(a.rarity);
        case 'masteryAny':   return maxWeaponMast;
        case 'gauntlet':     return state.gauntlet.best || 0;
        case 'arenaDiv':     return arenaRankIdx(state.arena.best || 0);
        case 'ascend':       return state.powerTier || 0;
        case 'career':       return Math.floor(life[a.stat] || 0);
        case 'pvp':          return pvp ? pvp.rating : 0;
      }
      return 0;
    };
    // human-readable threshold value for the description (number, rarity name, or division)
    const tierLabel = (a, th) => {
      if (a.kind === 'rarityLadder') return (It.RARITY[RAR[Math.min(th, RAR.length - 1)]] || {}).name || '';
      if (a.kind === 'arenaDiv') return D.ARENA.divisions[Math.min(th, D.ARENA.divisions.length - 1)];
      return UI.fmt(th);
    };

    return D.ACHIEVEMENTS.map(a => {
      const tiers = a.tiers;
      const cur = metric(a);
      let done = 0;
      for (let i = 0; i < tiers.length; i++) if (cur >= tiers[i]) done++;
      const maxed = done >= tiers.length;
      const ti = maxed ? tiers.length - 1 : done;        // current (or final) tier index
      const target = tiers[ti];
      const prev = ti > 0 ? tiers[ti - 1] : 0;
      const pct = maxed ? 100 : Math.max(0, Math.min(100, ((cur - prev) / ((target - prev) || 1)) * 100));
      return {
        id: a.id, label: a.label, icon: a.icon,
        desc: a.descT.replace('{n}', tierLabel(a, target)),
        cur, target, pct,
        tierIndex: ti, tiersDone: done, tiersTotal: tiers.length, maxed,
        showCount: a.kind !== 'rarityLadder' && a.kind !== 'arenaDiv',
      };
    });
  }

  // claim every Power Rank tier the current power qualifies for
  function claimRank() {
    const info = rankInfo();
    if (!info.claimable) { UI.toast('No new Power Ranks yet. Build more power!', 'bad'); return; }
    const from = (state.powerTier || 0) + 1;
    state.powerTier = (state.powerTier || 0) + info.claimable;
    state.stamina = staminaMax();   // top off to the new max as a little kicker
    UI.toast(info.claimable > 1
      ? `POWER RANKS ${from}-${state.powerTier} CLAIMED!`
      : `POWER RANK ${state.powerTier} CLAIMED!`, 'good');
    save(); renderAll(); refreshIdleBrute();
  }

  /* ---------------- create screen ---------------- */
  function rollCandidate() {
    candidate = C.createBrute(new RNG(randomSeed()));
    UI.renderCreatePreview(candidate, '');
  }

  function beginGame() {
    const name = ($('#create-name').value || '').trim();
    if (name) candidate.name = name;
    state.brute = candidate;
    candidate = null;
    state.lastTick = now();
    syncCollection(state.brute);
    save();
    enterGame();
    // brute name == username: first brute claims the account name; prestige keeps it
    if (global.PVP && global.PVP.claimName) global.PVP.claimName(state.brute.name);
  }

  function startCreateScreen() {
    UI.showScreen('screen-create');
    rollCandidate();
    setupNameField();
  }
  // first brute: free name input; prestige (you already have a username): locked to it
  function setupNameField() {
    const inp = $('#create-name');
    if (!inp) return;
    const note = $('#create-name-note');
    const h = (global.PVP && global.PVP.getHandle) ? global.PVP.getHandle() : null;
    if (h) {
      inp.value = h; inp.readOnly = true; inp.classList.add('locked');
      if (note) note.textContent = 'Your brute fights under your name. Rename it from the top bar anytime.';
    } else {
      inp.readOnly = false; inp.classList.remove('locked'); inp.value = '';
      if (note) note.textContent = '';
    }
  }

  function enterGame() {
    UI.showScreen('screen-game');
    renderAll();
    if (UI.showIdleBrute) UI.showIdleBrute(state.brute);   // brute idles in the stage at rest
  }
  // settle back to the idle brute a few seconds after a manual fight result
  function idleSoon() {
    setTimeout(() => {
      if (!fightInProgress && state.brute && !UI.isModalOpen()) UI.showIdleBrute(state.brute);
    }, 3000);
  }
  // immediately re-mount the idle arena brute (so loadout/look changes show at once)
  function refreshIdleBrute() {
    if (!fightInProgress && state.brute && UI.showIdleBrute) UI.showIdleBrute(state.brute);
  }

  /* ---------------- rendering ---------------- */
  function renderTopbarOnly() {
    UI.renderTopbar({
      gold: state.gold, dust: state.dust,
      stamina: state.stamina, staminaMax: staminaMax(),
      level: state.brute ? state.brute.level : null,
      power: state.brute ? C.powerRating(state.brute, metaBonuses()) : null,
    });
    const lvlBtn = $('#btn-levelup');
    if (lvlBtn) {
      lvlBtn.classList.toggle('hidden', pendingLevels <= 0);
      lvlBtn.textContent = pendingLevels > 0 ? `LEVEL UP ×${pendingLevels}` : 'LEVEL UP';
    }
  }
  function renderAll() {
    renderTopbarOnly();
    if (!state.brute) return;
    ensureStats();
    const navIco = $('#nav-brute-ico');
    if (navIco && global.Avatar) navIco.innerHTML = global.Avatar.svg(state.brute);
    UI.setMeta(metaBonuses());
    renderBrute();
    UI.renderForge(state.brute, state.dust, state.gold, {
      upgrade: forgeUpgrade, reroll: forgeReroll, disenchant: forgeDisenchant, fuse: forgeFuse,
      equipWeapon: equipWeapon, equipPet: equipPet, toggleSkill: toggleSkill, skillSlots: skillSlots(),
      autoEquip: autoEquipBest, autoMerge: autoMerge,
    });
    UI.renderCraft(state.shards, state.craftKind, state.craftTarget,
      { setTarget: setCraftTarget, craft: forgeCraft, cost: craftCost });
    UI.renderArenaRank(arenaInfo());
    UI.renderGauntlet(state.gauntlet, climbGauntlet, !fightInProgress, state.settings);
    wireGauntletControls();
    ensureBounties();
    UI.renderBounties(state.bounties, { claim: claimBounty, reroll: rerollBounty, rerollDust: state.dust });
    updateBountyBadge();
    UI.renderCollection(state);
    UI.renderAchievements(achievementsData());
    ensureShop();
    UI.renderShop(state.shopStock, state.gold, { buy: buyShopItem, reroll: rerollShop, rerollCost: shopRerollCost() });
    UI.renderRanks(rankInfo(), { claim: claimRank });
    UI.renderTraining(state.training, trainXpRate(), trainXpCap(), state.sparFocus || 0, { claim: claimTraining, spar: spar });
    updateNavInfo();
    const btn = $('#btn-fight');
    if (btn) btn.disabled = state.stamina < 1 || fightInProgress;
  }

  /* ---------------- the loop ---------------- */
  function tick() {
    applyElapsed();
    renderTopbarOnly();
    const btn = $('#btn-fight');
    if (btn) btn.disabled = state.stamina < 1 || fightInProgress;
    refreshBountiesIfDue();
    refreshShopIfDue();
    updateBountyBadge();
    updateNavInfo();
    save();
  }

  /* ---------------- wiring ---------------- */
  function $(s) { return document.querySelector(s); }

  // gauntlet AUTO/FAST toggles live inside the re-rendered gauntlet content,
  // so (re)bind them via .onchange (idempotent) after each renderGauntlet
  function wireGauntletControls() {
    const ga = $('#gaunt-auto');
    if (ga) ga.onchange = (e) => {
      state.settings.autoClimb = e.target.checked;
      if (e.target.checked) {                       // gauntlet auto and arena auto are mutually exclusive
        state.settings.autoFight = false;
        const af = $('#auto-fight'); if (af) af.checked = false;
      }
      save();
      if (e.target.checked && !fightInProgress) climbGauntlet(true);
    };
    const gf = $('#gaunt-fast');
    if (gf) gf.onchange = (e) => {
      state.settings.fastFight = e.target.checked;
      const af = $('#fast-fight'); if (af) af.checked = e.target.checked;   // keep arena in sync
      save();
    };
  }

  function wireEvents() {
    $('#btn-reroll').addEventListener('click', rollCandidate);
    $('#btn-begin').addEventListener('click', beginGame);
    $('#btn-fight').addEventListener('click', () => doFight(false));
    const lvlBtn = $('#btn-levelup');
    if (lvlBtn) lvlBtn.addEventListener('click', () => processLevelUps(() => {}));
    $('#btn-reset').addEventListener('click', () => { $('#reset-modal').classList.remove('hidden'); });
    $('#reset-cancel').addEventListener('click', () => { $('#reset-modal').classList.add('hidden'); });
    $('#reset-modal').addEventListener('click', (e) => { if (e.target.id === 'reset-modal') $('#reset-modal').classList.add('hidden'); });
    $('#reset-confirm').addEventListener('click', () => {
      wiped = true;                         // block any queued autosave
      if (tickTimer) clearInterval(tickTimer);
      // clear EVERYTHING: the local save AND the Supabase auth token, so reload
      // starts a brand-new brute on a fresh anonymous ladder identity.
      try {
        if (global.PVP && global.PVP.signOut) global.PVP.signOut();   // best-effort server-side sign out
      } catch (e) {}
      try { localStorage.clear(); } catch (e) {}
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}   // belt-and-suspenders
      location.reload();
    });
    $('#auto-fight').addEventListener('change', (e) => {
      state.settings.autoFight = e.target.checked;
      if (e.target.checked) {                       // arena auto and gauntlet auto are mutually exclusive
        state.settings.autoClimb = false;
        const gc = $('#gaunt-auto'); if (gc) gc.checked = false;
      }
      save();
      if (e.target.checked && !fightInProgress && state.stamina >= 1) doFight(true);
    });
    $('#fast-fight').addEventListener('change', (e) => {
      state.settings.fastFight = e.target.checked;
      const gf = $('#gaunt-fast'); if (gf) gf.checked = e.target.checked;   // keep gauntlet in sync
      save();
    });
    // pause auto-fight replay cancellation when switching to a non-arena tab is not needed;
    // keep it simple.
  }

  /* ---------------- boot ---------------- */
  function boot() {
    UI.initTabs();
    wireEvents();
    const verEl = $('#about-version'); if (verEl) verEl.textContent = 'v' + GAME_VERSION;

    state = migrate(load()) || defaultState();
    // AUTO never persists across reloads (don't resume fighting unattended); FAST is a kept preference
    if (state.settings) { state.settings.autoFight = false; state.settings.autoClimb = false; }
    // restore settings toggles
    $('#auto-fight').checked = false;
    $('#fast-fight').checked = !!(state.settings && state.settings.fastFight);

    const elapsed = applyElapsed();

    if (state.brute) {
      syncCollection(state.brute);
      enterGame();
      if (elapsed > 60 && Math.floor(state.training || 0) > 0) {
        UI.toast(`Look who's back! Your brute banked training XP over ${formatDuration(elapsed)}. Go cash it in on the Brute tab.`, 'good');
      }
    } else {
      startCreateScreen();
    }

    tickTimer = setInterval(tick, 1000);

    // PvP client reads live state through this bridge
    if (global.PVP) global.PVP.init();
  }

  /* Minimal surface the PvP module needs (game.js owns all state). */
  global.Game = {
    state: () => state,
    brute: () => state && state.brute,
    metaBonuses: () => metaBonuses(),
    fast: () => !!(state && state.settings && state.settings.fastFight),
    activateTab: activateTab,
    refreshBrute: () => { renderBrute(); },
    arp: () => (state && state.arena && state.arena.arp) || 0,
    gauntletBest: () => (state && state.gauntlet && state.gauntlet.best) || 0,
    setBruteName: (n) => { if (state && state.brute && n) { state.brute.name = n; save(); renderAll(); } },
    capturePrisoner: (p) => capturePrisoner(p),
    releasePrisoner: (id) => { releasePrisoner(id); },
    prisonList: () => prisonList(),
    prisonBuff: () => prisonBuff(),
    addCaptor: (p) => addCaptor(p),
    freeCaptor: (id) => freeCaptor(id),
    bribeCaptor: (id) => bribeCaptor(id),
    captorList: () => captorList(),
    captorPenalty: () => captorPenalty(),
    gold: () => (state && state.gold) || 0,
    livePower: () => livePower(),
    tourneyClaimed: (id) => tourneyClaimed(id),
    claimTourney: (id, gold) => claimTourney(id, gold),
    updateNavInfo: () => updateNavInfo(),
    markBattlesSeen: () => markBattlesSeen(),
  };

  function formatDuration(sec) {
    sec = Math.floor(sec);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);
