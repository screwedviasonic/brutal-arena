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
      legacy: 0,
      stamina: STAMINA_BASE,
      lastTick: now(),
      staminaProgress: 0,      // seconds accumulated toward next stamina point
      dust: 0,
      shards: 0,
      craftTarget: null,
      shop: {},
      legacyPerks: {},
      gauntlet: { floor: 1, best: 0, checkpoint: 1 },
      lifetime: emptyStats(),   // account-wide tally across every brute
      bounties: null,   // lazily seeded by ensureBounties()
      collection: { weapons: {}, skills: {}, pets: {} },
      masteries: { blade: 0, blunt: 0, axe: 0, spear: 0 },
      brute: null,
      settings: { autoFight: false, fastFight: false },
    };
  }

  /* Bring an older / partial save up to the current schema. */
  function migrate(s) {
    if (!s) return s;
    if (s.dust == null) s.dust = 0;
    if (s.shards == null) s.shards = 0;
    if (s.craftTarget === undefined) s.craftTarget = null;
    s.lifetime = fillStats(s.lifetime);
    if (s.brute) s.brute.career = fillStats(s.brute.career);
    if (!s.gauntlet) s.gauntlet = { floor: 1, best: 0, checkpoint: 1 };
    if (!s.collection) s.collection = { weapons: {}, skills: {}, pets: {} };
    if (!s.masteries) s.masteries = { blade: 0, blunt: 0, axe: 0, spear: 0 };
    if (s.brute && Array.isArray(s.brute.weapons)) {
      s.brute.weapons = s.brute.weapons.map(w =>
        typeof w === 'string' ? global.Items.generateWeapon(w, new RNG(randomSeed()), { rarity: 'common' }) : w);
    }
    return s;
  }

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
  function staminaMax() { return STAMINA_BASE + (state.shop.staminaMax || 0); }
  function staminaRegenTime() {
    return Math.max(6, STAMINA_REGEN_BASE - (state.shop.staminaRegen || 0) * 6);
  }
  function idleXpRate() { return (state.shop.trainer || 0); }
  function goldMul() {
    return (1 + (state.shop.goldFind || 0) * 0.15) * (1 + (state.legacyPerks.goldMul || 0) * 0.20);
  }
  function xpMul() {
    return (1 + (state.shop.xpBoost || 0) * 0.10) * (1 + (state.legacyPerks.xpMul || 0) * 0.15);
  }
  function dropLuck() { return (state.shop.dropLuck || 0) * 0.08; }
  function legacyPerksForCreate() { return state.legacyPerks; }

  /* ---------------- masteries & collection (account-wide meta) ---------------- */
  function masteryLevel(cat) {
    const xp = (state.masteries && state.masteries[cat]) || 0;
    let lvl = 0;
    while (lvl < D.MASTERY.maxLevel && xp >= D.MASTERY.xpForLevel(lvl + 1)) lvl++;
    return lvl;
  }
  function masteryLevels() {
    const out = {};
    D.WEAPON_CATS.forEach(c => out[c] = masteryLevel(c));
    return out;
  }

  /* The combat/power bonuses the player earns from collection + masteries. */
  function metaBonuses() {
    const col = state.collection, CB = D.COLLECTION, M = D.MASTERY;
    const wCount = Object.keys(col.weapons).length;
    const sCount = Object.keys(col.skills).length;
    const dmgMul = 1 + wCount * CB.perWeapon;
    const hpMul = 1 + sCount * CB.perSkill;
    const catDmg = { blade: 1, blunt: 1, axe: 1, spear: 1, fist: 1 };
    for (const cat of D.WEAPON_CATS) {
      catDmg[cat] += masteryLevel(cat) * M.dmgPerLevel;
      const inCat = D.DROPPABLE_WEAPONS.filter(w => w.cat === cat);
      if (inCat.length && inCat.every(w => col.weapons[w.id])) catDmg[cat] += CB.catCompleteDmg;
    }
    return { dmgMul, hpMul, catDmg };
  }

  function collectWeapon(base) { state.collection.weapons[base] = true; }
  function syncCollection(brute) {
    if (!brute) return;
    brute.weapons.forEach(w => state.collection.weapons[w.base] = true);
    brute.skills.forEach(s => state.collection.skills[s] = true);
    brute.pets.forEach(p => state.collection.pets[p] = true);
  }
  function awardMastery(playerStats) {
    if (!playerStats || !playerStats.catHits) return;
    for (const cat of D.WEAPON_CATS) {
      const hits = playerStats.catHits[cat] || 0;
      if (hits <= 0) continue;
      const before = masteryLevel(cat);
      state.masteries[cat] = (state.masteries[cat] || 0) + hits * MASTERY_XP_PER_HIT;
      const after = masteryLevel(cat);
      if (after > before) UI.toast(`🎖️ ${D.CAT_NAMES[cat]} Mastery Lv ${after}!`, 'good');
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
    collectWeapon(item.base);
    if (state.brute.weapons.length > WEAPON_CAP) {
      let wi = -1, wp = Infinity;
      state.brute.weapons.forEach((w, i) => { const p = global.Items.stats(w).power; if (p < wp) { wp = p; wi = i; } });
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
    const item = global.Items.generateWeapon(base, rng, { luck: luck });
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
      if (b.progress >= b.target && !b.done) { b.done = true; changed = true; UI.toast(`📜 Bounty ready to claim: ${b.desc}`, 'good'); }
    }
    if (changed) save();
  }
  function claimBounty(idx) {
    ensureBounties();
    const b = state.bounties.list[idx];
    if (!b || !b.done) return;
    const r = b.reward || {};
    if (r.gold) state.gold += r.gold;
    if (r.dust) state.dust += r.dust;
    if (r.legacy) state.legacy += r.legacy;
    const parts = [];
    if (r.gold) parts.push(`🪙${UI.fmt(r.gold)}`);
    if (r.dust) parts.push(`✦${r.dust}`);
    if (r.legacy) parts.push(`🏆${r.legacy}`);
    UI.toast(`📜 Claimed: ${parts.join(' • ')}`, 'good');
    state.bounties.list[idx] = rollBounty();
    save(); renderAll();
  }
  function rerollBounty(idx) {
    ensureBounties();
    const b = state.bounties.list[idx];
    if (!b || b.done) return;
    const cost = D.BOUNTIES.rerollCost;
    if (state.dust < cost) { UI.toast('Not enough dust to reroll.', 'bad'); return; }
    state.dust -= cost;
    state.bounties.list[idx] = rollBounty();
    save(); renderAll();
  }

  /* ---------------- forge ---------------- */
  function findWeapon(uid) { return state.brute.weapons.find(w => w.uid === uid); }
  function forgeUpgrade(uid) {
    const it = findWeapon(uid); if (!it) return;
    const cost = global.Items.upgradeCost(it);
    if (state.gold < cost) { UI.toast('Not enough gold.', 'bad'); return; }
    state.gold -= cost; global.Items.upgrade(it);
    UI.toast(`⚒️ Upgraded to +${it.level}`, 'good'); save(); renderAll();
  }
  function forgeReroll(uid) {
    const it = findWeapon(uid); if (!it) return;
    if (!it.affixes.length) { UI.toast('No affixes to reroll.', 'bad'); return; }
    const cost = global.Items.rerollCost(it);
    if (state.dust < cost) { UI.toast('Not enough dust.', 'bad'); return; }
    state.dust -= cost; global.Items.reroll(it, new RNG(randomSeed()));
    UI.toast('🎲 Affixes rerolled', 'good'); save(); renderAll();
  }
  function forgeDisenchant(uid) {
    const it = findWeapon(uid); if (!it) return;
    if (state.brute.weapons.length <= 1) { UI.toast('Cannot disenchant your last weapon.', 'bad'); return; }
    const d = global.Items.disenchantValue(it);
    const sh = global.Items.shardValue(it);
    state.dust += d; state.shards += sh;
    state.brute.weapons = state.brute.weapons.filter(w => w.uid !== uid);
    UI.toast(`♻️ Scrapped (+${d} dust • +${sh} shards)`, 'good'); save(); renderAll();
  }
  function forgeFuse(uid) {
    const it = findWeapon(uid); if (!it) return;
    const partner = state.brute.weapons.find(w => global.Items.canFuse(it, w));
    if (!partner) { UI.toast('Need another same-type, same-rarity weapon to fuse.', 'bad'); return; }
    const cost = global.Items.fuseDustCost(it);
    if (state.dust < cost) { UI.toast('Not enough dust to fuse.', 'bad'); return; }
    state.dust -= cost;
    const fused = global.Items.fuse(it, partner, new RNG(randomSeed()));
    state.brute.weapons = state.brute.weapons.filter(w => w.uid !== uid && w.uid !== partner.uid);
    state.brute.weapons.push(fused); collectWeapon(fused.base);
    UI.toast(`✨ Fused into ${global.Items.rarityName(fused)} ${global.Items.displayName(fused)}!`, 'good');
    save(); renderAll();
  }
  // shards needed to craft a given weapon base (scales with its tier)
  function craftCost(base) {
    const w = D.WEAPONS[base];
    const tier = (w && w.tier) || 1;
    return D.CRAFT.shardBase + tier * D.CRAFT.shardPerTier;
  }
  function setCraftTarget(base) {
    state.craftTarget = base || null;
    save(); renderAll();
  }
  function forgeCraft() {
    const base = state.craftTarget;
    if (!base || !D.WEAPONS[base]) { UI.toast('Pick a weapon to craft first.', 'bad'); return; }
    const cost = craftCost(base);
    if (state.shards < cost) { UI.toast('Not enough shards.', 'bad'); return; }
    state.shards -= cost;
    const rng = new RNG(randomSeed());
    let item = global.Items.generateWeapon(base, rng, { luck: D.CRAFT.luck });
    // guarantee at least the configured minimum rarity
    if (global.Items.rarityRank(item.rarity) < global.Items.rarityRank(D.CRAFT.minRarity)) {
      item = global.Items.generateWeapon(base, rng, { rarity: D.CRAFT.minRarity });
    }
    addWeaponToBrute(item);
    UI.toast(`⚒️ Crafted ${global.Items.rarityName(item)} ${global.Items.displayName(item)}!`, 'good');
    save(); renderAll();
  }

  /* ---------------- gauntlet ---------------- */
  // Roll the mutator for a floor. Deterministic by floor number so a retry of
  // the same floor always faces the same modifier. Boss floors are exempt.
  function mutatorForFloor(floor) {
    if (floor % D.GAUNTLET.bossEvery === 0) return null;
    const rng = new RNG((Math.imul(floor, 2654435761) ^ 0x9e3779b9) >>> 0);
    const m = rng.weighted(D.GAUNTLET.mutators.map(x => ({ item: x, weight: x.weight })));
    return (m.id === 'calm') ? null : m;
  }
  // Multiply numeric bonus fields together; copy non-numeric (e.g. catDmg) as-is.
  function mergeBonuses(a, b) {
    const out = Object.assign({}, a);
    if (b) for (const k in b) {
      out[k] = (typeof b[k] === 'number' && typeof out[k] === 'number') ? out[k] * b[k] : b[k];
    }
    return out;
  }
  function climbGauntlet() {
    if (fightInProgress) return;
    if (pendingLevels > 0) { processLevelUps(() => {}); return; }
    fightInProgress = true;
    activateTab('arena');
    const floor = state.gauntlet.floor;
    const mut = mutatorForFloor(floor);
    const opp = C.generateGauntletOpponent(floor, new RNG(randomSeed()));
    const result = global.Combat.simulateBattle(state.brute, opp, randomSeed(), {
      leftBonuses: mergeBonuses(metaBonuses(), mut && mut.left),
      rightBonuses: (mut && mut.right) || {},
    });
    const won = result.winner === 'left';
    renderAll();
    UI.replayBattle(result, state.brute, opp, state.settings.fastFight).then((finished) => {
      if (!finished) { fightInProgress = false; return; }
      resolveGauntlet(won, floor, result, mut);
    });
  }
  function resolveGauntlet(won, floor, result, mut) {
    const isBoss = floor % D.GAUNTLET.bossEvery === 0;
    const isMilestone = floor % D.GAUNTLET.milestoneEvery === 0;
    const rMul = (mut && mut.rewardMul) || {};
    const earned = { gold: 0, dust: 0, xp: 0 };
    awardMastery(result.playerStats);
    syncCollection(state.brute);
    if (won) {
      const xp = Math.round((20 + floor * 6) * xpMul() * (rMul.xp || 1));
      const gold = Math.round((15 + floor * 7) * goldMul() * (rMul.gold || 1));
      let dust = Math.round((3 + floor * 1.2) * (rMul.dust || 1)) + (isBoss ? 20 : 0) + (isMilestone ? 40 : 0);
      state.gold += gold; state.dust += dust;
      earned.gold = gold; earned.dust = dust; earned.xp = xp;
      let dropTxt = '';
      const wantDrop = isBoss || (mut && mut.bonusDrop) || Math.random() < 0.28;
      if (wantDrop) { dropTxt = ' • ' + lootBadge(dropItem(Math.min(0.95, (isBoss ? 0.3 : 0.1) + floor * 0.04))); }
      if (isMilestone) { state.legacy += 1; dropTxt += ' • 🏆+1'; }
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
      UI.showOutcome(false, `<div>FELL ON FLOOR ${floor}<br>Back to floor ${back}</div>`);
    }
    progressBounties(fightContext(won, true, result, won ? state.gauntlet.floor : null));
    accumulateStats(extractFightStats(result, won, true, earned));
    fightInProgress = false;
    save(); renderAll();
    processLevelUps(() => {});
  }

  function activateTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('active'));
    const pane = document.getElementById('tab-' + name);
    if (pane) pane.classList.add('active');
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

    // idle XP
    if (state.brute && idleXpRate() > 0) {
      idleXpAccum += elapsed * idleXpRate() * xpMul();
      if (idleXpAccum >= 1) {
        const whole = Math.floor(idleXpAccum);
        idleXpAccum -= whole;
        grantXp(whole, true);
      }
    }
    return elapsed;
  }

  /* ---------------- xp / leveling ---------------- */
  function grantXp(amount, silent) {
    if (!state.brute) return;
    const gained = P.addXp(state.brute, Math.round(amount));
    if (gained > 0) {
      pendingLevels += gained;
      if (!silent) UI.toast(`✨ Level up! Now level ${state.brute.level}`, 'good');
    }
  }

  function processLevelUps(after) {
    if (pendingLevels <= 0) { if (after) after(); return; }
    if (UI.isModalOpen()) return;
    const lvl = state.brute.level - pendingLevels + 1;
    const rng = new RNG(randomSeed());
    const choices = P.generateChoices(state.brute, rng, dropLuck());
    UI.showLevelUp(lvl, choices, (choice) => {
      P.applyChoice(state.brute, choice);
      syncCollection(state.brute);
      pendingLevels--;
      UI.toast(`Gained ${choice.icon} ${choice.title}`, 'good');
      renderAll();
      save();
      // chain remaining level-ups, then run the continuation
      setTimeout(() => processLevelUps(after), 150);
    });
  }

  /* ---------------- fighting ---------------- */
  function doFight() {
    if (fightInProgress) return;
    if (pendingLevels > 0) { processLevelUps(() => {}); return; }
    if (state.stamina < 1) { UI.toast('⚡ Out of stamina! It regenerates over time.', 'bad'); return; }

    fightInProgress = true;
    state.stamina--;
    save();
    renderTopbarOnly();

    const oppRng = new RNG(randomSeed());
    const opponent = C.generateOpponent(state.brute.level, oppRng);
    const seed = randomSeed();
    const result = global.Combat.simulateBattle(state.brute, opponent, seed, { leftBonuses: metaBonuses() });
    const playerWon = result.winner === 'left';

    UI.replayBattle(result, state.brute, opponent, state.settings.fastFight).then((finished) => {
      if (!finished) { fightInProgress = false; return; } // replay was cancelled
      resolveFight(playerWon, opponent, result);
    });
  }

  function resolveFight(playerWon, opponent, result) {
    const lvl = opponent.level;
    let xp = Math.round((playerWon ? 18 : 7) * Math.pow(lvl, 1.15) * xpMul());
    let gold = 0, dust = 0, dropTxt = '';
    if (playerWon) {
      state.brute.wins++;
      gold = Math.round((10 + lvl * 4 + Math.random() * lvl * 3) * goldMul());
      dust = Math.round(2 + lvl * 0.5);
      state.gold += gold; state.dust += dust;
      // loot drop
      const dropChance = 0.16 + (state.shop.dropLuck || 0) * 0.03;
      if (Math.random() < dropChance) dropTxt = ' • ' + lootBadge(dropItem(dropLuck() + 0.04));
    } else {
      state.brute.losses++;
      gold = Math.round((3 + lvl * 1.5) * goldMul());
      state.gold += gold;
    }

    awardMastery(result && result.playerStats);
    syncCollection(state.brute);

    const rewardHtml = `<div>+${UI.fmt(xp)} XP • +🪙 ${UI.fmt(gold)}${dust ? ' • +✦ ' + dust : ''}${dropTxt}</div>`;
    UI.showOutcome(playerWon, rewardHtml);

    grantXp(xp, true);
    progressBounties(fightContext(playerWon, false, result, null));
    accumulateStats(extractFightStats(result, playerWon, false, { gold, dust, xp }));
    fightInProgress = false;
    save();
    renderAll();

    // resolve any level-ups, then optionally auto-continue
    processLevelUps(() => {
      if (state.settings.autoFight && state.stamina >= 1 && pendingLevels === 0) {
        setTimeout(() => { if (state.settings.autoFight) doFight(); }, state.settings.fastFight ? 500 : 1400);
      }
    });
  }

  /* ---------------- shop ---------------- */
  function buyShop(item, cost) {
    if (state.gold < cost) { UI.toast('Not enough gold.', 'bad'); return; }
    state.gold -= cost;
    state.shop[item.id] = (state.shop[item.id] || 0) + 1;
    if (item.id === 'staminaMax') { /* max grew; allow regen toward it */ }
    UI.toast(`Bought ${item.icon} ${item.name}`, 'good');
    save();
    renderAll();
  }

  /* ---------------- legacy / prestige ---------------- */
  function retireBrute() {
    const payout = UI.legacyPayout(state.brute);
    if (!confirm(`Retire ${state.brute.name} (Lv ${state.brute.level}) for 🏆 ${payout} legacy? This starts a brand new brute.`)) return;
    state.legacy += payout;
    state.brute = null;
    state.gauntlet.floor = 1;          // new brute starts the climb over (best is kept)
    state.gauntlet.checkpoint = 1;
    save();
    UI.toast(`🏆 +${payout} legacy earned!`, 'good');
    startCreateScreen();
  }

  function buyLegacyPerk(perkId) {
    const perk = D.LEGACY_PERKS.find(p => p.id === perkId);
    const owned = state.legacyPerks[perkId] || 0;
    if (owned >= perk.max) return;
    const cost = perk.cost * (owned + 1);
    if (state.legacy < cost) { UI.toast('Not enough legacy.', 'bad'); return; }
    state.legacy -= cost;
    state.legacyPerks[perkId] = owned + 1;
    UI.toast(`Bloodline strengthened: ${perk.name}`, 'good');
    save();
    renderAll();
  }

  /* ---------------- create screen ---------------- */
  function rollCandidate() {
    candidate = C.createBrute(new RNG(randomSeed()), { legacy: legacyPerksForCreate() });
    const note = totalLegacyPerks() > 0
      ? '🏆 Bloodline perks are applied to this new brute.'
      : 'Tip: win fights, level up, then retire to earn permanent bloodline perks.';
    UI.renderCreatePreview(candidate, note);
  }

  function totalLegacyPerks() {
    return Object.values(state.legacyPerks).reduce((a, b) => a + b, 0);
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
  }

  function startCreateScreen() {
    UI.showScreen('screen-create');
    rollCandidate();
  }

  function enterGame() {
    UI.showScreen('screen-game');
    renderAll();
  }

  /* ---------------- rendering ---------------- */
  function renderTopbarOnly() {
    UI.renderTopbar({
      gold: state.gold, legacy: state.legacy, dust: state.dust,
      stamina: state.stamina, staminaMax: staminaMax(),
    });
  }
  function renderAll() {
    renderTopbarOnly();
    if (!state.brute) return;
    ensureStats();
    UI.setMeta(metaBonuses());
    UI.renderBruteTab(state.brute);
    UI.renderForge(state.brute, state.dust, state.gold, {
      upgrade: forgeUpgrade, reroll: forgeReroll, disenchant: forgeDisenchant, fuse: forgeFuse,
    });
    UI.renderCraft(state.shards, state.craftTarget, state.craftTarget ? craftCost(state.craftTarget) : 0,
      { setTarget: setCraftTarget, craft: forgeCraft });
    UI.renderGauntlet(state.gauntlet, climbGauntlet, !fightInProgress, mutatorForFloor(state.gauntlet.floor));
    ensureBounties();
    UI.renderBounties(state.bounties, { claim: claimBounty, reroll: rerollBounty, rerollDust: state.dust });
    UI.renderCollection(state, masteryLevels());
    UI.renderLifetime(state.lifetime, state.gauntlet.best);
    UI.renderShop(stateForShop(), buyShop);
    UI.renderLegacy(state, state.brute, retireBrute, buyLegacyPerk);
    UI.renderIdle(idleXpRate());
    const btn = $('#btn-fight');
    if (btn) btn.disabled = state.stamina < 1 || fightInProgress;
  }
  function stateForShop() {
    return { gold: state.gold, shop: state.shop };
  }

  /* ---------------- the loop ---------------- */
  function tick() {
    applyElapsed();
    renderTopbarOnly();
    const btn = $('#btn-fight');
    if (btn) btn.disabled = state.stamina < 1 || fightInProgress;
    // resolve queued level-ups if player is just sitting there
    if (!fightInProgress && pendingLevels > 0 && !UI.isModalOpen()) processLevelUps(() => {});
    refreshBountiesIfDue();
    save();
  }

  /* ---------------- wiring ---------------- */
  function $(s) { return document.querySelector(s); }

  function wireEvents() {
    $('#btn-reroll').addEventListener('click', rollCandidate);
    $('#btn-begin').addEventListener('click', beginGame);
    $('#btn-fight').addEventListener('click', doFight);
    $('#btn-reset').addEventListener('click', () => {
      if (confirm('Wipe ALL progress (brute, gold, legacy)? This cannot be undone.')) {
        wiped = true;                       // block any queued autosave
        if (tickTimer) clearInterval(tickTimer);
        try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
        location.reload();
      }
    });
    $('#auto-fight').addEventListener('change', (e) => {
      state.settings.autoFight = e.target.checked;
      save();
      if (e.target.checked && !fightInProgress && state.stamina >= 1 && pendingLevels === 0) doFight();
    });
    $('#fast-fight').addEventListener('change', (e) => {
      state.settings.fastFight = e.target.checked;
      save();
    });
    // pause auto-fight replay cancellation when switching to a non-arena tab is not needed;
    // keep it simple.
  }

  /* ---------------- boot ---------------- */
  function boot() {
    UI.initTabs();
    wireEvents();

    state = migrate(load()) || defaultState();
    // restore settings toggles
    $('#auto-fight').checked = !!(state.settings && state.settings.autoFight);
    $('#fast-fight').checked = !!(state.settings && state.settings.fastFight);

    const elapsed = applyElapsed();

    if (state.brute) {
      syncCollection(state.brute);
      enterGame();
      if (elapsed > 60 && idleXpRate() > 0) {
        UI.toast(`Welcome back! Your brute trained for ${formatDuration(elapsed)}.`, 'good');
      }
      // resolve any offline level-ups
      setTimeout(() => processLevelUps(() => {}), 400);
    } else {
      startCreateScreen();
    }

    tickTimer = setInterval(tick, 1000);
  }

  function formatDuration(sec) {
    sec = Math.floor(sec);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window);
