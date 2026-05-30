/* ============================================================
 * character.js — brute creation, stat math, opponent generation.
 * ============================================================ */

(function (global) {
  'use strict';

  const D = global.GAMEDATA;

  function randomName(rng) {
    const p = rng.pick(D.NAME_PREFIX);
    const s = rng.pick(D.NAME_SUFFIX);
    let name = p + s;
    if (rng.chance(0.35)) name += ' ' + rng.pick(D.NAME_TITLE);
    return name;
  }

  function randomAppearance(rng) {
    return {
      skin: rng.pick(D.SKIN_COLORS),
      outfit: rng.pick(D.OUTFIT_COLORS),
    };
  }

  /* Create a brand new level-1 brute.
   * legacyPerks: the player's prestige perk levels (affects starting kit).
   */
  function createBrute(rng, opts) {
    opts = opts || {};
    const legacy = opts.legacy || {};

    const bonusStat = (legacy.startStats || 0) * 2;
    const stats = {
      hp: rng.int(40, 60) + bonusStat,
      strength: rng.int(3, 8) + bonusStat,
      agility: rng.int(3, 8) + bonusStat,
      speed: rng.int(3, 8) + bonusStat,
    };

    const brute = {
      name: opts.name || randomName(rng),
      appearance: randomAppearance(rng),
      level: 1,
      xp: 0,
      stats,
      weapons: [],     // weapon INSTANCES
      skills: [],      // skill INSTANCES
      pets: [],        // pet INSTANCES
      equipped: { weapon: null, pet: null, skills: [] },
      wins: 0,
      losses: 0,
      seed: rng.seed,
    };

    // Starting kit: 1 guaranteed reward + legacy heirlooms
    grantRandomReward(rng, brute, { onlyKit: true });

    const extraWeapons = legacy.startWeapon || 0;
    for (let i = 0; i < extraWeapons; i++) {
      brute.weapons.push(global.Items.generateWeapon(rng.pick(D.DROPPABLE_WEAPONS).id, rng, {}));
    }
    const extraSkills = legacy.startSkill || 0;
    for (let i = 0; i < extraSkills; i++) {
      const pool = D.ALL_SKILLS.filter(s => !brute.skills.some(x => x.base === s.id));
      if (pool.length) brute.skills.push(global.Items.generateSkill(rng.pick(pool).id, rng, {}));
    }

    autoEquip(brute);
    return brute;
  }

  /* Grant a single random reward (starting kit) as an instance. */
  function grantRandomReward(rng, brute, opts) {
    opts = opts || {};
    if (rng.float() < 0.5) {
      const w = rng.pick(D.DROPPABLE_WEAPONS);
      brute.weapons.push(global.Items.generateWeapon(w.id, rng, {}));
      return;
    }
    const skillPool = D.ALL_SKILLS.filter(s => !brute.skills.some(x => x.base === s.id));
    if (skillPool.length) brute.skills.push(global.Items.generateSkill(rng.pick(skillPool).id, rng, {}));
  }

  /* Fill empty equip slots from owned inventory (keeps valid current picks).
   * All of weapons/skills/pets are instances with a uid. */
  function autoEquip(brute, skillSlots) {
    skillSlots = skillSlots || 3;
    const eq = brute.equipped = brute.equipped || { weapon: null, pet: null, skills: [] };
    const owns = (list, uid) => list.some(x => x && x.uid === uid);
    if (!eq.weapon || !owns(brute.weapons, eq.weapon)) {
      let best = null, bp = -1;
      for (const w of brute.weapons) { const p = global.Items.stats(w).power; if (p > bp) { bp = p; best = w; } }
      eq.weapon = best ? best.uid : null;
    }
    if (!eq.pet || !owns(brute.pets, eq.pet)) eq.pet = brute.pets[0] ? brute.pets[0].uid : null;
    eq.skills = (eq.skills || []).filter(uid => owns(brute.skills, uid)).slice(0, skillSlots);
    for (const s of brute.skills) {
      if (eq.skills.length >= skillSlots) break;
      if (!eq.skills.includes(s.uid)) eq.skills.push(s.uid);
    }
    return brute;
  }

  /* XP needed to reach the next level (from current level). */
  function xpForLevel(level) {
    return Math.floor(20 * Math.pow(level, 1.55) + 10 * level);
  }

  /* Resolve a brute's equipped loadout into concrete instances.
   * Tolerates legacy brutes (no `equipped`, skills/pets as id strings):
   * auto-derives a sensible loadout so old saves and PvP snapshots still fight.
   */
  function loadout(brute) {
    if (!brute) return { weapon: null, pet: null, skills: [] };
    const weapons = brute.weapons || [];
    const pets = brute.pets || [];
    const skills = brute.skills || [];
    const byUid = (list, uid) => list.find(x => x && typeof x === 'object' && x.uid === uid);
    if (brute.equipped) {
      const eq = brute.equipped;
      return {
        weapon: eq.weapon ? byUid(weapons, eq.weapon) || null : null,
        pet: eq.pet ? byUid(pets, eq.pet) || null : null,
        skills: (eq.skills || []).map(uid => byUid(skills, uid)).filter(Boolean),
      };
    }
    // legacy fallback: best weapon, first pet, first 3 skills (ids or instances)
    let weapon = null, wp = -1;
    for (const w of weapons) { const p = global.Items.stats(w).power; if (p > wp) { wp = p; weapon = w; } }
    return { weapon, pet: pets[0] || null, skills: skills.slice(0, 3) };
  }

  /* Compute "effective" combat stats after applying EQUIPPED skills.
   * Returns a fight-ready stat block.
   */
  function effectiveStats(brute, bonuses) {
    bonuses = bonuses || {};
    let hpMul = bonuses.hpMul || 1, strMul = bonuses.strMul || 1, agiMul = bonuses.agiMul || 1, spdMul = bonuses.spdMul || 1;
    let dmgReduction = 0, evasionAdd = 0, blockAdd = 0, counterAdd = 0;
    let critAdd = bonuses.critAdd || 0, accuracyAdd = 0, comboAdd = 0, reflect = 0;
    let fistMul = 1, weaponMul = 1;

    for (const skillInst of loadout(brute).skills) {
      const sk = D.SKILLS[global.Items.asSkill(skillInst).base];
      if (!sk || sk.kind !== 'passive') continue;
      const m = global.Items.skillMods(skillInst).mods;
      if (m.hpMul) hpMul *= m.hpMul;
      if (m.strengthMul) strMul *= m.strengthMul;
      if (m.agilityMul) agiMul *= m.agilityMul;
      if (m.speedMul) spdMul *= m.speedMul;
      if (m.dmgReduction) dmgReduction = 1 - (1 - dmgReduction) * (1 - m.dmgReduction);
      if (m.evasionAdd) evasionAdd += m.evasionAdd;
      if (m.blockAdd) blockAdd += m.blockAdd;
      if (m.counterAdd) counterAdd += m.counterAdd;
      if (m.critAdd) critAdd += m.critAdd;
      if (m.accuracyAdd) accuracyAdd += m.accuracyAdd;
      if (m.comboAdd) comboAdd += m.comboAdd;
      if (m.reflect) reflect += m.reflect;
      if (m.fistMul) fistMul *= m.fistMul;
      if (m.weaponMul) weaponMul *= m.weaponMul;
    }

    const s = brute.stats;
    const strength = s.strength * strMul;
    const agility = s.agility * agiMul;
    const speed = s.speed * spdMul;
    const maxHp = Math.round(s.hp * hpMul);

    // Derived combat chances from agility (with caps).
    return {
      maxHp,
      strength,
      agility,
      speed,
      // base derived stats; agility drives most of them
      evasion: Math.min(0.6, agility * 0.006 + evasionAdd),
      block: Math.min(0.6, agility * 0.004 + blockAdd),
      counter: Math.min(0.5, agility * 0.004 + counterAdd),
      crit: Math.min(0.7, 0.05 + agility * 0.003 + critAdd),
      accuracy: 0.75 + agility * 0.003 + accuracyAdd,
      combo: Math.min(0.7, agility * 0.004 + comboAdd),
      dmgReduction,
      reflect,
      fistMul,
      weaponMul,
    };
  }

  /* A rough "power rating" used for matchmaking — counts EQUIPPED gear only. */
  function powerRating(brute, bonuses) {
    const e = effectiveStats(brute, bonuses);
    const lo = loadout(brute);
    const weaponPower = lo.weapon ? global.Items.stats(lo.weapon).power : 0;
    const petPower = lo.pet ? global.Items.petStats(lo.pet).power : 0;
    const skillPower = lo.skills.reduce((a, s) => a + (global.Items.rarityRank(global.Items.asSkill(s).rarity) + 1) * 12, 0);
    return Math.round(e.maxHp + e.strength * 6 + e.agility * 4 + e.speed * 3 + weaponPower * 2 + petPower + skillPower + brute.level * 5);
  }

  /* Generate an arena opponent scaled to the player's level.
   * Uses its own RNG so it doesn't disturb fight determinism.
   */
  function generateOpponent(playerLevel, rng, opts) {
    opts = opts || {};
    const lvl = Math.max(1, (opts.level != null ? opts.level : playerLevel + rng.int(-1, 1)));
    const luck = opts.luck || Math.min(0.6, lvl * 0.02);
    const statMul = opts.statMul || 1;
    const opp = createBrute(rng, {});
    opp.level = lvl;

    for (let l = 2; l <= lvl; l++) {
      const pick = rng.float();
      if (pick < 0.6) {
        const stat = rng.pick(['hp', 'strength', 'agility', 'speed']);
        opp.stats[stat] += stat === 'hp' ? rng.int(8, 16) : rng.int(2, 5);
      } else if (pick < 0.82) {
        opp.weapons.push(global.Items.generateWeapon(rng.pick(D.DROPPABLE_WEAPONS).id, rng, { luck }));
      } else if (pick < 0.95) {
        const pool = D.ALL_SKILLS.filter(s => !opp.skills.some(x => x.base === s.id));
        if (pool.length) opp.skills.push(global.Items.generateSkill(rng.pick(pool).id, rng, { luck }));
      } else {
        const pool = D.ALL_PETS.filter(p => !opp.pets.some(x => x.base === p.id));
        if (pool.length) opp.pets.push(global.Items.generatePet(rng.pick(pool).id, rng, { luck }));
      }
      opp.stats.hp += rng.int(3, 7);
      opp.stats.strength += rng.int(1, 2);
      opp.stats.agility += rng.int(1, 2);
      opp.stats.speed += rng.int(1, 2);
    }

    if (statMul !== 1) {
      opp.stats.hp = Math.round(opp.stats.hp * statMul);
      opp.stats.strength = Math.round(opp.stats.strength * statMul);
      opp.stats.agility = Math.round(opp.stats.agility * statMul);
      opp.stats.speed = Math.round(opp.stats.speed * statMul);
    }
    autoEquip(opp);   // equip its best weapon / first pet / up to 3 skills
    return opp;
  }

  /* Gauntlet floor opponent: scales harder than the arena, bosses are beefy. */
  function generateGauntletOpponent(floor, rng) {
    const isBoss = floor % D.GAUNTLET.bossEvery === 0;
    const lvl = Math.max(1, Math.round(floor * 1.15));
    const opp = generateOpponent(lvl, rng, {
      level: lvl,
      luck: Math.min(0.9, 0.1 + floor * 0.03),
      statMul: 1 + floor * 0.05 + (isBoss ? 0.6 : 0),
    });
    if (isBoss) {
      opp.name = opp.name.split(' ')[0] + ' ' + rng.pick(D.GAUNTLET.bossTitles);
      opp.isBoss = true;
      // bosses get a guaranteed nasty weapon + a pet
      opp.weapons.push(global.Items.generateWeapon(rng.pick(D.DROPPABLE_WEAPONS).id, rng, { luck: 0.8 }));
      opp.pets.push(global.Items.generatePet(rng.pick(D.ALL_PETS).id, rng, { luck: 0.8 }));
      autoEquip(opp);   // re-equip so the boss wields its new weapon + pet
    }
    return opp;
  }

  global.Character = {
    randomName,
    randomAppearance,
    createBrute,
    grantRandomReward,
    xpForLevel,
    effectiveStats,
    powerRating,
    loadout,
    autoEquip,
    generateOpponent,
    generateGauntletOpponent,
  };
})(window);
