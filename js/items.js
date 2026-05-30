/* ============================================================
 * items.js — instanced weapons: rarity, affixes, forge, dust.
 *
 * A weapon the player owns is an *instance*:
 *   { uid, base:'sword', rarity:'rare', level:2, affixes:[{id,val}] }
 * Items.stats(item) resolves it into a combat-ready stat block,
 * folding in rarity power, forge level, and affixes.
 * ============================================================ */

(function (global) {
  'use strict';

  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITY = {
    common:    { name: 'Common',    color: '#9ca3af', affixes: 0, pow: 1.00, weight: 100 },
    uncommon:  { name: 'Uncommon',  color: '#2dc653', affixes: 1, pow: 1.12, weight: 52 },
    rare:      { name: 'Rare',      color: '#3a86ff', affixes: 2, pow: 1.30, weight: 24 },
    epic:      { name: 'Epic',      color: '#a855f7', affixes: 3, pow: 1.52, weight: 9 },
    legendary: { name: 'Legendary', color: '#ff9e00', affixes: 4, pow: 1.82, weight: 2.6 },
    mythic:    { name: 'Mythic',    color: '#ff2d55', affixes: 5, pow: 2.20, weight: 0.5 },
  };

  // affix pool. stat = combat field it feeds; roll = [min,max] value range.
  const AFFIXES = [
    { id: 'dmg',   prefix: 'Brutal',   stat: 'dmgPct',    roll: [0.08, 0.22], pctText: true },
    { id: 'crit',  prefix: 'Deadly',   stat: 'crit',      roll: [0.04, 0.13], pctText: true },
    { id: 'combo', prefix: 'Swift',    stat: 'combo',     roll: [0.05, 0.15], pctText: true },
    { id: 'acc',   prefix: 'Precise',  stat: 'accuracy',  roll: [0.04, 0.12], pctText: true },
    { id: 'life',  prefix: 'Vampiric', stat: 'lifesteal', roll: [0.05, 0.16], pctText: true },
    { id: 'pen',   prefix: 'Piercing', stat: 'armorPen',  roll: [0.12, 0.35], pctText: true },
    { id: 'speed', prefix: 'Hasted',   stat: 'speed',     roll: [0.06, 0.16], pctText: true },
    { id: 'block', prefix: 'Guarding', stat: 'block',     roll: [0.06, 0.16], pctText: true },
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

  function displayName(item) {
    const D = global.GAMEDATA;
    const base = D.WEAPONS[item.base];
    const baseName = base ? base.name : item.base;
    let prefix = '';
    if (item.affixes && item.affixes.length) {
      // use the first affix's prefix word as a title
      const a = AFFIX_BY_ID[item.affixes[0].id];
      if (a) prefix = a.prefix + ' ';
    }
    const lvl = item.level ? ' +' + item.level : '';
    return prefix + baseName + lvl;
  }

  function affixLines(item) {
    return (item.affixes || []).map(af => {
      const a = AFFIX_BY_ID[af.id];
      if (!a) return '';
      const v = a.pctText ? Math.round(af.val * 100) + '%' : af.val;
      return statLabel(af.id) + ' +' + v;
    });
  }
  function statLabel(id) {
    return { dmg: 'Damage', crit: 'Crit', combo: 'Combo', acc: 'Accuracy', life: 'Lifesteal', pen: 'Armor Pen', speed: 'Attack Speed', block: 'Block' }[id] || id;
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

  function reroll(item, rng) {
    const n = RARITY[item.rarity].affixes;
    const pool = AFFIXES.slice();
    rng.shuffle(pool);
    item.affixes = [];
    for (let i = 0; i < n && i < pool.length; i++) {
      const a = pool[i];
      item.affixes.push({ id: a.id, val: +(rng.range(a.roll[0], a.roll[1]).toFixed(3)) });
    }
    return item;
  }

  // fuse two same-base items of the same rarity into the next rarity up
  function canFuse(a, b) {
    return a && b && a.uid !== b.uid && a.base === b.base && a.rarity === b.rarity && rarityRank(a.rarity) < RARITIES.length - 1;
  }
  function fuse(a, b, rng) {
    const nextRarity = RARITIES[rarityRank(a.rarity) + 1];
    return generateWeapon(a.base, rng, { rarity: nextRarity, level: Math.max(a.level || 0, b.level || 0) });
  }

  function disenchantValue(item) {
    return Math.floor((rarityRank(item.rarity) + 1) * 6 + (item.level || 0) * 4);
  }
  // shards yielded when a weapon is scrapped — feeds the Forge's target crafting
  function shardValue(item) {
    return 2 * (rarityRank(item.rarity) + 1) + (item.level || 0);
  }

  global.Items = {
    RARITIES, RARITY, AFFIXES,
    generateWeapon, stats, fistStats, displayName, affixLines, color, rarityName, rarityRank,
    upgradeCost, rerollCost, fuseDustCost, upgrade, reroll, canFuse, fuse, disenchantValue, shardValue,
  };
})(window);
