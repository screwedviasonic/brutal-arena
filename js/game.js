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
      shop: {},
      legacyPerks: {},
      gauntlet: { floor: 1, best: 0, checkpoint: 1 },
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
    state.dust += d;
    state.brute.weapons = state.brute.weapons.filter(w => w.uid !== uid);
    UI.toast(`♻️ Disenchanted (+${d} dust)`, 'good'); save(); renderAll();
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

  /* ---------------- gauntlet ---------------- */
  function climbGauntlet() {
    if (fightInProgress) return;
    if (pendingLevels > 0) { processLevelUps(() => {}); return; }
    fightInProgress = true;
    activateTab('arena');
    const floor = state.gauntlet.floor;
    const opp = C.generateGauntletOpponent(floor, new RNG(randomSeed()));
    const result = global.Combat.simulateBattle(state.brute, opp, randomSeed(), { leftBonuses: metaBonuses() });
    const won = result.winner === 'left';
    renderAll();
    UI.replayBattle(result, state.brute, opp, state.settings.fastFight).then((finished) => {
      if (!finished) { fightInProgress = false; return; }
      resolveGauntlet(won, floor, result);
    });
  }
  function resolveGauntlet(won, floor, result) {
    const isBoss = floor % D.GAUNTLET.bossEvery === 0;
    awardMastery(result.playerStats);
    syncCollection(state.brute);
    if (won) {
      const xp = Math.round((20 + floor * 6) * xpMul());
      const gold = Math.round((15 + floor * 7) * goldMul());
      const dust = Math.round(3 + floor * 1.2) + (isBoss ? 20 : 0);
      state.gold += gold; state.dust += dust;
      let dropTxt = '';
      if (isBoss) { dropTxt = ' • ' + lootBadge(dropItem(Math.min(0.95, 0.3 + floor * 0.04))); }
      else if (Math.random() < 0.28) { dropTxt = ' • ' + lootBadge(dropItem(Math.min(0.9, 0.1 + floor * 0.03))); }
      state.gauntlet.floor = floor + 1;
      if (floor > state.gauntlet.best) state.gauntlet.best = floor;
      if (isBoss) state.gauntlet.checkpoint = floor + 1;
      UI.showOutcome(true, `<div>FLOOR ${floor} CLEARED${isBoss ? ' 👑' : ''}<br>+${UI.fmt(xp)} XP • +🪙${UI.fmt(gold)} • +✦${dust}${dropTxt}</div>`);
      grantXp(xp, true);
    } else {
      state.brute.losses++;
      const back = state.gauntlet.checkpoint || 1;
      state.gauntlet.floor = back;
      UI.showOutcome(false, `<div>FELL ON FLOOR ${floor}<br>Back to floor ${back}</div>`);
    }
    save(); renderAll(); fightInProgress = false;
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
    save();
    renderAll();
    fightInProgress = false;

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
    UI.setMeta(metaBonuses());
    UI.renderBruteTab(state.brute);
    UI.renderForge(state.brute, state.dust, state.gold, {
      upgrade: forgeUpgrade, reroll: forgeReroll, disenchant: forgeDisenchant, fuse: forgeFuse,
    });
    UI.renderGauntlet(state.gauntlet, climbGauntlet, !fightInProgress);
    UI.renderCollection(state, masteryLevels());
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
