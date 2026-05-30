/* ============================================================
 * items.js — instanced weapons: rarity, affixes, forge, dust.
 *
 * A weapon the player owns is an *instance*:
 * { uid, base:'sword', rarity:'rare', level:2, affixes:[{id,val}] }
 * Items.stats(item) resolves it into a combat-ready stat block,
 * folding in rarity power, forge level, and affixes.
 * ============================================================ */

(function (global) {
  'use strict';

  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITY = {
    common: { name: 'Common', color: '#9ca3af', affixes: 0, pow: 1.00, weight: 100 },
    uncommon: { name: 'Uncommon', color: '#2dc653', affixes: 1, pow: 1.12, weight: 52 },
    rare: { name: 'Rare', color: '#3a86ff', affixes: 2, pow: 1.30, weight: 24 },
    epic: { name: 'Epic', color: '#a855f7', affixes: 3, pow: 1.52, weight: 9 },
    legendary: { name: 'Legendary', color: '#ff9e00', affixes: 4, pow: 1.82, weight: 2.6 },
    mythic: { name: 'Mythic', color: '#ff2d55', affixes: 5, pow: 2.20, weight: 0.5 },
  };

  // affix pool. stat = combat field it feeds; roll = [min,max] value range.
  const AFFIXES = [
    { id: 'dmg', prefix: 'Brutal', stat: 'dmgPct', roll: [0.08, 0.22], pctText: true },
    { id: 'crit', prefix: 'Deadly', stat: 'crit', roll: [0.04, 0.13], pctText: true },
    { id: 'combo', prefix: 'Swift', stat: 'combo', roll: [0.05, 0.15], pctText: true },
    { id: 'acc', prefix: 'Precise', stat: 'accuracy', roll: [0.04, 0.12], pctText: true },
    { id: 'life', prefix: 'Vampiric', stat: 'lifesteal', roll: [0.05, 0.16], pctText: true },
    { id: 'pen', prefix: 'Piercing', stat: 'armorPen', roll: [0.12, 0.35], pctText: true },
    { id: 'speed', prefix: 'Hasted', stat: 'speed', roll: [0.06, 0.16], pctText: true },
    { id: 'block', prefix: 'Guarding', stat: 'block', roll: [0.06, 0.16], pctText: true },
  ];
  const AFFIX_BY_ID = {};
  AFFIXES.forEach(a => AFFIX_BY_ID[a.id] = a);

  function genUid() {
    return 'it_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e7).toString(36);
  }

  function rollRarity(rng, luck) {
    luck = luck || 0;
    const items = RARITIES.map(r => {
      const tierIdx = RARITIES.indexOf(r);
      // luck pushes weight toward higher tiers
      const w = RARITY[r].weight * (1 + luck * tierIdx * 0.9);
      return { item: r, weight: w };
    });
    return rng.weighted(items);
  }

  /* Generate a fresh weapon instance for a base id. */
  function generateWeapon(baseId, rng, opts) {
    opts = opts || {};
    const rarity = opts.rarity || rollRarity(rng, opts.luck || 0);
    const nAffix = RARITY[rarity].affixes;
    const pool = AFFIXES.slice();
    rng.shuffle(pool);
    const affixes = [];
    for (let i = 0; i < nAffix && i < pool.length; i++) {
      const a = pool[i];
      const val = +(rng.range(a.roll[0], a.roll[1]).toFixed(3));
      affixes.push({ id: a.id, val });
    }
    return { uid: genUid(), base: baseId, rarity, level: opts.level || 0, affixes };
  }

  /* Resolve an instance into combat stats. */
  function stats(item) {
    const D = global.GAMEDATA;
    const base = D.WEAPONS[item.base] || D.WEAPONS.fist;
    const info = RARITY[item.rarity] || RARITY.common;
    let dmgMul = info.pow * (1 + 0.07 * (item.level || 0));
    const out = {
      item, base: item.base, name: base.name, icon: base.icon, cat: base.cat || 'blade',
      rarity: item.rarity, level: item.level || 0,
      accuracy: base.accuracy, speedMod: base.speedMod, combo: base.combo,
      block: base.block, crit: base.crit, disarm: base.disarm,
      lifesteal: 0, armorPen: 0,
    };
    let dmgPct = 0;
    for (const af of (item.affixes || [])) {
      switch (af.id) {
        case 'dmg': dmgPct += af.val; break;
        case 'crit': out.crit += af.val; break;
        case 'combo': out.combo += af.val; break;
        case 'acc': out.accuracy += af.val; break;
        case 'life': out.lifesteal += af.val; break;
        case 'pen': out.armorPen += af.val; break;
        case 'speed': out.speedMod *= (1 - af.val); break;
        case 'block': out.block += af.val; break;
      }
    }
    out.dmg = base.dmg * dmgMul * (1 + dmgPct);
    out.power = Math.round(out.dmg * 2 + out.crit * 60 + out.combo * 40 + out.lifesteal * 80 + out.armorPen * 30);
    return out;
  }

  /* Synthetic fist "item" for the engine. */
  function fistStats() {
    const D = global.GAMEDATA;
    const f = D.WEAPONS.fist;
    return { item: null, base: 'fist', name: f.name, icon: f.icon, cat: 'fist', rarity: 'common', level: 0,
      dmg: f.dmg, accuracy: f.accuracy, speedMod: f.speedMod, combo: f.combo, block: f.block, crit: f.crit, disarm: f.disarm, lifesteal: 0, armorPen: 0, power: 0 };
  }

  /* ========================================================
   * PETS & SKILLS as instances (parity with weapons)
   * ====================================================== */

  // affixes that can roll on a PET instance
  const PET_AFFIXES = [
    { id: 'php', prefix: 'Hardy', stat: 'hp', roll: [0.10, 0.30], pctText: true },
    { id: 'pstr', prefix: 'Savage', stat: 'strength', roll: [0.10, 0.30], pctText: true },
    { id: 'pagi', prefix: 'Nimble', stat: 'agility', roll: [0.10, 0.30], pctText: true },
    { id: 'pcrit', prefix: 'Vicious', stat: 'crit', roll: [0.04, 0.12], pctText: true },
  ];
  const PET_AFFIX_BY_ID = {};
  PET_AFFIXES.forEach(a => PET_AFFIX_BY_ID[a.id] = a);

  function kindOf(inst) { return (inst && inst.kind) || 'weapon'; }
  function baseInfo(inst) {
    const D = global.GAMEDATA;
    const k = kindOf(inst);
    if (k === 'pet') return D.PETS[inst.base];
    if (k === 'skill') return D.SKILLS[inst.base];
    return D.WEAPONS[inst.base];
  }
  function icon(inst) { const b = baseInfo(inst); return b? b.icon : ''; }

  // tolerate legacy id-strings: turn 'wolf' / 'herculean' into a common instance
  function asPet(p) { return (typeof p === 'string')? { uid: 'leg_' + p, kind: 'pet', base: p, rarity: 'common', level: 0, affixes: [] } : p; }
  function asSkill(s) { return (typeof s === 'string')? { uid: 'leg_' + s, kind: 'skill', base: s, rarity: 'common', level: 0, roll: 0.5 } : s; }

  function generatePet(baseId, rng, opts) {
    opts = opts || {};
    const rarity = opts.rarity || rollRarity(rng, opts.luck || 0);
    const n = RARITY[rarity].affixes;
    const pool = PET_AFFIXES.slice();
    rng.shuffle(pool);
    const affixes = [];
    for (let i = 0; i < n && i < pool.length; i++) {
      const a = pool[i];
      affixes.push({ id: a.id, val: +(rng.range(a.roll[0], a.roll[1]).toFixed(3)) });
    }
    return { uid: genUid(), kind: 'pet', base: baseId, rarity, level: opts.level || 0, affixes };
  }

  // resolve a pet instance into combat-ready stats
  function petStats(p) {
    const D = global.GAMEDATA;
    const inst = asPet(p);
    const base = D.PETS[inst.base] || D.PETS.dog;
    const info = RARITY[inst.rarity] || RARITY.common;
    const mul = info.pow * (1 + 0.07 * (inst.level || 0));
    let hp = base.hp * mul, strength = base.strength * mul, agility = base.agility * mul, crit = 0;
    let hpPct = 0, strPct = 0, agiPct = 0;
    for (const af of inst.affixes || []) {
      if (af.id === 'php') hpPct += af.val;
      else if (af.id === 'pstr') strPct += af.val;
      else if (af.id === 'pagi') agiPct += af.val;
      else if (af.id === 'pcrit') crit += af.val;
    }
    hp = Math.round(hp * (1 + hpPct));
    strength = Math.round(strength * (1 + strPct));
    agility = Math.round(agility * (1 + agiPct));
    const out = { base: inst.base, name: base.name, icon: base.icon, rarity: inst.rarity, level: inst.level || 0,
      hp, strength, agility, speed: base.speed, crit };
    out.power = Math.round(hp + strength * 3 + agility * 2 + crit * 50);
    return out;
  }

  function generateSkill(baseId, rng, opts) {
    opts = opts || {};
    const rarity = opts.rarity || rollRarity(rng, opts.luck || 0);
    const roll = (opts.roll!= null)? opts.roll : +rng.float().toFixed(3);
    return { uid: genUid(), kind: 'skill', base: baseId, rarity, level: opts.level || 0, roll };
  }

  // how strongly a skill instance scales vs its base definition
  function skillScale(inst) {
    inst = asSkill(inst);
    const rank = rarityRank(inst.rarity);
    const roll = (inst.roll == null? 0.5 : inst.roll);
    return (1 + rank * 0.10 + (inst.level || 0) * 0.05) * (0.92 + 0.16 * roll);
  }

  // resolved, scaled skill effect for combat/effectiveStats
  function skillMods(inst) {
    const D = global.GAMEDATA;
    inst = asSkill(inst);
    const sk = D.SKILLS[inst.base];
    if (!sk) return { kind: 'passive', mods: {} };
    const s = skillScale(inst);
    if (sk.kind === 'passive') {
      const out = {};
      for (const k in (sk.mods || {})) {
        const v = sk.mods[k];
        out[k] = /Mul$/.test(k)? 1 + (v - 1) * s : v * s; // scale the delta from 1 for multipliers; additive otherwise
      }
      return { kind: 'passive', mods: out };
    }
    const a = Object.assign({}, sk.active);
    if (a.mult) a.mult = +(a.mult * (0.9 + 0.1 * s)).toFixed(2);
    if (a.dmg) a.dmg = Math.round(a.dmg * s);
    if (a.frac) a.frac = Math.min(0.9, +(a.frac * s).toFixed(3));
    if (a.uses) a.uses = a.uses + (rarityRank(inst.rarity) >= 3? 1 : 0);
    return { kind: 'active', active: a, id: sk.id, name: sk.name, icon: sk.icon };
  }

  function displayName(inst) {
    const D = global.GAMEDATA;
    const k = kindOf(inst);
    const base = baseInfo(inst);
    const baseName = base? base.name : inst.base;
    const lvl = inst.level? ' +' + inst.level : '';
    if (k === 'weapon' && inst.affixes && inst.affixes.length) {
      const a = AFFIX_BY_ID[inst.affixes[0].id];
      if (a) return a.prefix + ' ' + baseName + lvl;
    }
    if (k === 'pet' && inst.affixes && inst.affixes.length) {
      const a = PET_AFFIX_BY_ID[inst.affixes[0].id];
      if (a) return a.prefix + ' ' + baseName + lvl;
    }
    return baseName + lvl;
  }

  function affixLines(inst) {
    const k = kindOf(inst);
    if (k === 'skill') {
      const D = global.GAMEDATA;
      const sk = D.SKILLS[inst.base];
      const pctOver = Math.round((skillScale(inst) - 1) * 100);
      return [sk? sk.desc : '', (pctOver > 0? '+' + pctOver + '% potency' : 'base potency')].filter(Boolean);
    }
    const dict = (k === 'pet')? PET_AFFIX_BY_ID : AFFIX_BY_ID;
    return (inst.affixes || []).map(af => {
      const a = dict[af.id];
      if (!a) return '';
      const v = a.pctText? Math.round(af.val * 100) + '%' : af.val;
      return (a.stat? statLabel(af.id) : af.id) + ' +' + v;
    }).filter(Boolean);
  }
  function statLabel(id) {
    return {
      dmg: 'Damage', crit: 'Crit', combo: 'Combo', acc: 'Accuracy', life: 'Lifesteal', pen: 'Armor Pen', speed: 'Attack Speed', block: 'Block',
      php: 'Max HP', pstr: 'Strength', pagi: 'Agility', pcrit: 'Crit',
    }[id] || id;
  }
  function color(item) { return (RARITY[item.rarity] || RARITY.common).color; }
  function rarityName(item) { return (RARITY[item.rarity] || RARITY.common).name; }
  function rarityRank(r) { return RARITIES.indexOf(r); }

  /* ---------- forge operations ---------- */
  function upgradeCost(item) {
    const rk = rarityRank(item.rarity) + 1;
    return Math.floor(30 * rk * Math.pow(1.6, item.level || 0));
  }
  function rerollCost(item) {
    return Math.floor(8 + rarityRank(item.rarity) * 6);
  }
  function fuseDustCost(item) {
    return Math.floor(20 + rarityRank(item.rarity) * 15);
  }

  function upgrade(item) { item.level = (item.level || 0) + 1; return item; }

  // reroll: weapons/pets reroll affixes; skills reroll their potency roll
  function reroll(item, rng) {
    if (kindOf(item) === 'skill') { item.roll = +rng.float().toFixed(3); return item; }
    const pool = (kindOf(item) === 'pet'? PET_AFFIXES : AFFIXES).slice();
    const n = RARITY[item.rarity].affixes;
    rng.shuffle(pool);
    item.affixes = [];
    for (let i = 0; i < n && i < pool.length; i++) {
      const a = pool[i];
      item.affixes.push({ id: a.id, val: +(rng.range(a.roll[0], a.roll[1]).toFixed(3)) });
    }
    return item;
  }
  function canReroll(item) {
    return kindOf(item) === 'skill' || (item.affixes && item.affixes.length > 0);
  }

  // fuse two same-base, same-rarity, same-kind instances into the next rarity up
  function canFuse(a, b) {
    return a && b && a.uid!== b.uid && a.base === b.base && a.rarity === b.rarity
      && kindOf(a) === kindOf(b) && rarityRank(a.rarity) < RARITIES.length - 1;
  }
  function fuse(a, b, rng) {
    const nextRarity = RARITIES[rarityRank(a.rarity) + 1];
    const lvl = Math.max(a.level || 0, b.level || 0);
    const k = kindOf(a);
    if (k === 'pet') return generatePet(a.base, rng, { rarity: nextRarity, level: lvl });
    if (k === 'skill') return generateSkill(a.base, rng, { rarity: nextRarity, level: lvl });
    return generateWeapon(a.base, rng, { rarity: nextRarity, level: lvl });
  }

  function disenchantValue(item) {
    return Math.floor((rarityRank(item.rarity) + 1) * 6 + (item.level || 0) * 4);
  }
  // shards yielded when a weapon is scrapped — feeds the Forge's target crafting
  function shardValue(item) {
    return 2 * (rarityRank(item.rarity) + 1) + (item.level || 0);
  }

  global.Items = {
    RARITIES, RARITY, AFFIXES, PET_AFFIXES,
    generateWeapon, stats, fistStats, displayName, affixLines, color, rarityName, rarityRank,
    upgradeCost, rerollCost, fuseDustCost, upgrade, reroll, canReroll, canFuse, fuse, disenchantValue, shardValue,
    kindOf, icon, baseInfo, asPet, asSkill, generatePet, petStats, generateSkill, skillMods, skillScale,
  };
})(window);
