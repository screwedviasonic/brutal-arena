/* ============================================================
 * progression.js — XP, leveling, and random level-up choices.
 *
 * On level up the player is offered 3 random rewards (MyBrute
 * style): stat boosts, new weapons, new skills, or pets.
 * dropLuck (shop) nudges the rarity of what's offered.
 * ============================================================ */

(function (global) {
  'use strict';

  const D = global.GAMEDATA;
  const C = global.Character;

  /* Add XP; returns the number of levels gained. */
  function addXp(brute, amount) {
    brute.xp += amount;
    let gained = 0;
    let need = C.xpForLevel(brute.level);
    while (brute.xp >= need) {
      brute.xp -= need;
      brute.level++;
      gained++;
      need = C.xpForLevel(brute.level);
    }
    return gained;
  }

  /* Generate 3 distinct reward choices for a level-up.
   * luck: 0..~1.2, raises odds of higher-tier offers.
   */
  function generateChoices(brute, rng, luck) {
    luck = luck || 0;
    const choices = [];
    const usedKinds = [];

    // weighted category roll
    function rollCategory() {
      return rng.weighted([
        { item: 'stat', weight: 42 },
        { item: 'weapon', weight: 26 },
        { item: 'skill', weight: 22 },
        { item: 'pet', weight: 10 + luck * 6 },
      ]);
    }

    let attempts = 0;
    while (choices.length < 3 && attempts < 40) {
      attempts++;
      const cat = rollCategory();
      let choice = null;
      if (cat === 'stat') choice = makeStatChoice(rng);
      else if (cat === 'weapon') choice = makeWeaponChoice(brute, rng, luck);
      else if (cat === 'skill') choice = makeSkillChoice(brute, rng, luck);
      else if (cat === 'pet') choice = makePetChoice(brute, rng, luck);

      if (!choice) continue;
      // avoid duplicate identical choices
      if (choices.some(c => c.key === choice.key)) continue;
      choices.push(choice);
    }

    // guarantee at least the board is full with stat choices
    while (choices.length < 3) {
      const s = makeStatChoice(rng);
      if (!choices.some(c => c.key === s.key)) choices.push(s);
    }
    return choices;
  }

  function makeStatChoice(rng) {
    const which = rng.weighted([
      { item: 'hp', weight: 30 },
      { item: 'strength', weight: 24 },
      { item: 'agility', weight: 24 },
      { item: 'speed', weight: 22 },
    ]);
    const map = {
      hp: { label: 'Max HP', icon: '', amount: rng.int(8, 18) },
      strength: { label: 'Strength', icon: '', amount: rng.int(2, 5) },
      agility: { label: 'Agility', icon: '', amount: rng.int(2, 5) },
      speed: { label: 'Speed', icon: '', amount: rng.int(2, 5) },
    };
    const m = map[which];
    return {
      key: 'stat:' + which + ':' + m.amount,
      kind: 'stat', stat: which, amount: m.amount,
      icon: m.icon, title: `+${m.amount} ${m.label}`,
      desc: `Permanently increase ${m.label}.`,
      rarity: m.amount > (which === 'hp'? 14 : 4)? 'rare' : 'common',
    };
  }

  function tierWeight(tier, luck) {
    // lower tiers common; luck shifts probability toward higher tiers
    return Math.max(0.5, (6 - tier) + luck * tier * 1.2);
  }

  function makeWeaponChoice(brute, rng, luck) {
    // pick a base (dupes allowed — loot!), then roll a full item instance
    const w = rng.weighted(D.DROPPABLE_WEAPONS.map(w => ({ item: w, weight: tierWeight(w.tier, luck) })));
    const item = global.Items.generateWeapon(w.id, rng, { luck: luck });
    const s = global.Items.stats(item);
    const affixTxt = global.Items.affixLines(item).join(', ');
    return {
      key: 'weapon:' + item.uid, kind: 'weapon', item: item,
      icon: w.icon, title: global.Items.displayName(item),
      desc: `${Math.round(s.dmg)} dmg` + (affixTxt? ' — ' + affixTxt : ''),
      rarity: item.rarity,
    };
  }

  function makeSkillChoice(brute, rng, luck) {
    // dupes allowed now — collect copies to merge/level in the forge
    const base = rng.weighted(D.ALL_SKILLS.map(s => ({ item: s, weight: tierWeight(s.tier, luck) })));
    const item = global.Items.generateSkill(base.id, rng, { luck: luck });
    return {
      key: 'skill:' + item.uid, kind: 'skill', item: item,
      icon: base.icon, title: global.Items.rarityName(item) + ' ' + base.name,
      desc: base.desc + (base.kind === 'active'? ' (active)' : ''),
      rarity: item.rarity,
    };
  }

  function makePetChoice(brute, rng, luck) {
    const base = rng.weighted(D.ALL_PETS.map(p => ({ item: p, weight: tierWeight(p.tier, luck) })));
    const item = global.Items.generatePet(base.id, rng, { luck: luck });
    const ps = global.Items.petStats(item);
    return {
      key: 'pet:' + item.uid, kind: 'pet', item: item,
      icon: base.icon, title: global.Items.rarityName(item) + ' ' + base.name,
      desc: `Pet — ${ps.hp} HP, ${ps.strength} STR. Fights at your side.`,
      rarity: item.rarity,
    };
  }

  /* Apply a chosen reward to the brute (game.js auto-equips empty slots after). */
  function applyChoice(brute, choice) {
    switch (choice.kind) {
      case 'stat':
        brute.stats[choice.stat] += choice.amount;
        break;
      case 'weapon':
        brute.weapons.push(choice.item);
        break;
      case 'skill':
        brute.skills.push(choice.item);
        break;
      case 'pet':
        brute.pets.push(choice.item);
        break;
    }
    // every level also grants a small baseline stat bump so growth feels steady
    brute.stats.hp += 2;
  }

  function rarityForTier(tier) {
    if (tier >= 5) return 'legendary';
    if (tier >= 4) return 'epic';
    if (tier >= 3) return 'rare';
    if (tier >= 2) return 'uncommon';
    return 'common';
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  global.Progression = { addXp, generateChoices, applyChoice, rarityForTier };
})(window);
