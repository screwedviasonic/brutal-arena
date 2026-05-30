/* ============================================================
 * combat.js — the auto-battle engine.
 *
 * simulateBattle(left, right, seed) runs a complete fight using a
 * seeded RNG and returns:
 * { winner: 'left'|'right', events: [...], units: {...}, seed }
 * The UI replays `events` to animate the fight; nothing here
 * touches the DOM, so battles are pure & reproducible.
 * ============================================================ */

(function (global) {
  'use strict';

  const D = global.GAMEDATA;
  const C = global.Character;

  const BASE_INTERVAL = 100; // arbitrary time units between actions
  const STR_SCALE = 0.85; // strength -> damage contribution
  const CRIT_MULT = 1.8;
  const BLOCK_REDUCTION = 0.55; // blocked hits lose 55% damage
  const MAX_ACTIONS = 240; // safety cap to guarantee termination

  let _uid = 0;

  function buildUnits(brute, team, bonuses) {
    bonuses = bonuses || {};
    const units = [];
    const lo = C.loadout(brute); // equipped weapon / pet / skills only
    const eff = C.effectiveStats(brute, bonuses);

    const bruteUnit = {
      id: team[0].toUpperCase() + (_uid++),
      team,
      type: 'brute',
      name: brute.name,
      icon: '',
      appearance: brute.appearance,
      hp: eff.maxHp,
      maxHp: eff.maxHp,
      eff,
      weapons: lo.weapon? [global.Items.stats(lo.weapon)] : [], // only the equipped weapon
      skills: lo.skills.map(s => global.Items.asSkill(s).base),
      actives: buildActives(lo.skills),
      dmgMul: bonuses.dmgMul || 1,
      catDmg: bonuses.catDmg || null,
      catHits: { blade: 0, blunt: 0, axe: 0, spear: 0, fist: 0 },
      dmgDealt: 0,
      dmgTaken: 0,
      healed: 0,
      immobilized: 0,
      nextTime: 0,
      alive: true,
      stunReady: true,
    };
    units.push(bruteUnit);

    if (lo.pet) {
      const pet = global.Items.petStats(lo.pet); // resolved: hp/strength/agility/speed/crit
      units.push({
        id: team[0].toUpperCase() + (_uid++),
        team,
        type: 'pet',
        name: pet.name,
        icon: pet.icon,
        petId: pet.base,
        hp: pet.hp,
        maxHp: pet.hp,
        eff: {
          maxHp: pet.hp,
          strength: pet.strength,
          agility: pet.agility,
          speed: 10 / pet.speed, // convert pet.speed (interval mult) to a speed-ish value
          evasion: Math.min(0.5, pet.agility * 0.006),
          block: 0,
          counter: Math.min(0.4, pet.agility * 0.004),
          crit: Math.min(0.7, 0.05 + pet.agility * 0.003 + (pet.crit || 0)),
          accuracy: 0.75 + pet.agility * 0.003,
          combo: Math.min(0.5, pet.agility * 0.004),
          dmgReduction: 0,
          reflect: 0,
          fistMul: 1,
          weaponMul: 1,
        },
        weapons: [],
        skills: [],
        actives: [],
        petSpeedMod: pet.speed,
        dmgDealt: 0,
        dmgTaken: 0,
        immobilized: 0,
        nextTime: 0,
        alive: true,
      });
    }
    return units;
  }

  function buildActives(skillInsts) {
    const out = [];
    for (const inst of (skillInsts || [])) {
      const m = global.Items.skillMods(inst); // scaled by rarity/level/roll
      if (m.kind === 'active') {
        out.push(Object.assign({ id: m.id, name: m.name, icon: m.icon, used: 0 }, m.active));
      }
    }
    return out;
  }

  function actionInterval(unit, weapon) {
    const speedMod = unit.type === 'pet'? unit.petSpeedMod : (weapon? weapon.speedMod : 1);
    const speedFactor = 1 + unit.eff.speed * 0.03;
    return BASE_INTERVAL * speedMod / speedFactor;
  }

  function pickWeapon(unit, rng) {
    if (unit.type === 'pet' || unit.weapons.length === 0) return global.Items.fistStats();
    // mostly draw a real weapon, weighted by its power, else fall back to fists
    if (rng.chance(0.82)) {
      return rng.weighted(unit.weapons.map(w => ({ item: w, weight: 12 + (w.power || 0) })));
    }
    return global.Items.fistStats();
  }

  function aliveEnemies(units, team) {
    return units.filter(u => u.alive && u.team!== team);
  }

  function snapshot(units) {
    const out = {};
    for (const u of units) out[u.id] = { hp: u.hp, maxHp: u.maxHp, alive: u.alive };
    return out;
  }

  function simulateBattle(left, right, seed, opts) {
    opts = opts || {};
    _uid = 0;
    const rng = new global.RNG(seed);
    const units = [...buildUnits(left, 'left', opts.leftBonuses || {}),...buildUnits(right, 'right', opts.rightBonuses || {})];
    const events = [];
    let time = 0;
    let actionCount = 0;

    const E = (type, extra) => {
      events.push(Object.assign({ t: time, type }, extra));
    };

    // Roster intro
    E('start', {
      left: rosterInfo(units, 'left'),
      right: rosterInfo(units, 'right'),
    });

    // --- Fight-start active skills (sabotage / bomb opener) ---
    for (const u of units.filter(x => x.type === 'brute' && x.alive)) {
      const sab = u.actives.find(a => a.type === 'sabotage' && a.used < a.uses);
      if (sab) {
        const foe = aliveEnemies(units, u.team).find(e => e.type === 'brute' && e.weapons.length);
        if (foe) {
          const lost = rng.pick(foe.weapons);
          foe.weapons = foe.weapons.filter(w => w!== lost);
          sab.used++;
          E('skill', { skill: 'sabotage', icon: '', source: u.id, target: foe.id,
            text: `${u.name} sabotages ${foe.name}, destroying their ${lost.name}!` });
        }
      }
    }

    // --- Main loop: discrete-event by nextTime ---
    while (actionCount < MAX_ACTIONS) {
      const liveLeft = units.some(u => u.alive && u.team === 'left');
      const liveRight = units.some(u => u.alive && u.team === 'right');
      if (!liveLeft ||!liveRight) break;

      // next actor = smallest nextTime among alive units
      let actor = null;
      for (const u of units) {
        if (!u.alive) continue;
        if (!actor || u.nextTime < actor.nextTime) actor = u;
      }
      time = actor.nextTime;
      actionCount++;

      if (actor.immobilized > 0) {
        actor.immobilized--;
        E('immobilized', { source: actor.id, text: `${actor.name} struggles free of the net.` });
        actor.nextTime += actionInterval(actor, D.WEAPONS.fist);
        continue;
      }

      // pick target
      const enemies = aliveEnemies(units, actor.team);
      if (enemies.length === 0) break;
      // prefer attacking the enemy brute ~60% of the time
      let target;
      const enemyBrute = enemies.find(e => e.type === 'brute');
      if (enemyBrute && rng.chance(0.6)) target = enemyBrute;
      else target = rng.pick(enemies);

      // --- pre-attack active skills ---
      // potion heal when low
      const potion = actor.actives && actor.actives.find(a => a.type === 'heal' && a.used < a.uses);
      if (potion && actor.hp < actor.maxHp * 0.35) {
        const healed = Math.round(actor.maxHp * potion.frac);
        actor.hp = Math.min(actor.maxHp, actor.hp + healed);
        if (actor.healed!= null) actor.healed += healed;
        potion.used++;
        E('skill', { skill: 'potion', icon: '', source: actor.id, hp: actor.hp,
          text: `${actor.name} gulps a Tragic Potion and recovers ${healed} HP!` });
      }
      // net: immobilize and skip dealing damage
      const net = actor.actives && actor.actives.find(a => a.type === 'net' && a.used < a.uses);
      if (net && rng.chance(0.5)) {
        net.used++;
        target.immobilized += 1;
        E('skill', { skill: 'net', icon: '', source: actor.id, target: target.id,
          text: `${actor.name} throws a net — ${target.name} is immobilized!` });
        actor.nextTime += actionInterval(actor, D.WEAPONS.fist);
        continue;
      }
      // bomb: AoE
      const bomb = actor.actives && actor.actives.find(a => a.type === 'bomb' && a.used < a.uses);
      if (bomb) {
        bomb.used++;
        E('skill', { skill: 'bomb', icon: '', source: actor.id,
          text: `${actor.name} hurls a bomb! ` });
        for (const foe of aliveEnemies(units, actor.team)) {
          const dmg = Math.round(bomb.dmg * (1 - foe.eff.dmgReduction));
          foe.hp -= dmg;
          if (actor.dmgDealt!= null) actor.dmgDealt += dmg;
          if (foe.dmgTaken!= null) foe.dmgTaken += dmg;
          E('hit', { source: actor.id, target: foe.id, dmg, hp: Math.max(0, foe.hp),
            crit: false, kind: 'bomb', text: ` ${foe.name} takes ${dmg} blast damage.` });
          checkDeath(foe, events, time);
        }
        actor.nextTime += actionInterval(actor, D.WEAPONS.fist);
        continue;
      }

      // --- normal attack (with combo loop) ---
      let weapon = pickWeapon(actor, rng);
      let comboing = true;
      let strikes = 0;
      while (comboing && target.alive && actor.alive && strikes < 4) {
        strikes++;
        resolveStrike(actor, target, weapon, rng, events, time, units);
        // combo chance to chain another strike (diminishing)
        const comboChance = (actor.eff.combo + weapon.combo) * Math.pow(0.6, strikes - 1);
        comboing = target.alive && actor.alive && rng.chance(comboChance);
        if (comboing) {
          E('combo', { source: actor.id, text: `${actor.name} chains another strike!` });
        }
      }

      actor.nextTime += actionInterval(actor, weapon);
    }

    // --- determine winner ---
    const leftAlive = units.some(u => u.alive && u.team === 'left');
    const rightAlive = units.some(u => u.alive && u.team === 'right');
    let winner;
    if (leftAlive &&!rightAlive) winner = 'left';
    else if (rightAlive &&!leftAlive) winner = 'right';
    else {
      // timeout: compare remaining HP fraction of the brute
      const lb = units.find(u => u.team === 'left' && u.type === 'brute');
      const rb = units.find(u => u.team === 'right' && u.type === 'brute');
      const lf = lb && lb.alive? lb.hp / lb.maxHp : 0;
      const rf = rb && rb.alive? rb.hp / rb.maxHp : 0;
      winner = lf >= rf? 'left' : 'right';
      E('timeout', { text: 'Time limit! The brute with more health is declared the winner.' });
    }

    E('end', { winner, snapshot: snapshot(units) });

    const playerBrute = units.find(u => u.team === 'left' && u.type === 'brute');
    const playerPets = units.filter(u => u.team === 'left' && u.type!== 'brute');
    const playerStats = playerBrute? {
      catHits: playerBrute.catHits,
      dmgDealt: playerBrute.dmgDealt,
      dmgTaken: playerBrute.dmgTaken,
      healed: playerBrute.healed,
      petDmgDealt: playerPets.reduce((a, p) => a + (p.dmgDealt || 0), 0),
      petDmgTaken: playerPets.reduce((a, p) => a + (p.dmgTaken || 0), 0),
      kills: units.filter(u => u.team === 'right' &&!u.alive).length,
      petDeaths: playerPets.filter(p =>!p.alive).length,
    } : null;
    return {
      winner, events, seed: rng.seed,
      playerBruteId: playerBrute? playerBrute.id : null,
      playerStats,
    };
  }

  function resolveStrike(actor, target, weapon, rng, events, time, units) {
    const E = (type, extra) => events.push(Object.assign({ t: time, type }, extra));

    // --- check active burst/stun skills for this strike ---
    let dmgMult = 1;
    let stun = false;
    let usedActive = null;
    const fierce = actor.actives && actor.actives.find(a => a.type === 'burst' && a.used < a.uses);
    const hammer = actor.actives && actor.actives.find(a => a.type === 'stun' && a.used < a.uses);
    if (fierce && rng.chance(0.5)) {
      fierce.used++; dmgMult = fierce.mult; usedActive = 'fierce';
      E('skill', { skill: 'fierce', icon: '', source: actor.id, target: target.id,
        text: `${actor.name} enters a FIERCE rage!` });
    } else if (hammer && rng.chance(0.45)) {
      hammer.used++; dmgMult = hammer.mult; stun = true; usedActive = 'hammer';
      E('skill', { skill: 'hammer', icon: '', source: actor.id, target: target.id,
        text: `${actor.name} swings a mighty Hammer!` });
    }

    // --- accuracy / evasion ---
    const hitChance = actor.eff.accuracy + weapon.accuracy - target.eff.evasion;
    if (!rng.chance(clamp(hitChance, 0.05, 0.97))) {
      // missed or evaded
      if (rng.chance(0.5)) E('miss', { source: actor.id, target: target.id, text: `${actor.name} misses.` });
      else E('evade', { source: actor.id, target: target.id, text: `${target.name} dodges!` });
      // a clean dodge can trigger a counter
      maybeCounter(target, actor, rng, events, time, units);
      return;
    }

    // --- block ---
    let blocked = false;
    if (rng.chance(clamp(target.eff.block + weapon.block * 0.3, 0, 0.6))) {
      blocked = true;
    }

    // --- damage ---
    const isFist = weapon.cat === 'fist';
    const styleMul = isFist? actor.eff.fistMul : actor.eff.weaponMul;
    let base = (weapon.dmg + actor.eff.strength * STR_SCALE) * styleMul * dmgMult;
    // player meta bonuses (mastery + collection): per-category & global damage
    if (actor.catDmg && actor.catDmg[weapon.cat]) base *= actor.catDmg[weapon.cat];
    base *= actor.dmgMul || 1;
    let crit = rng.chance(clamp(actor.eff.crit + weapon.crit, 0, 0.85));
    if (crit) base *= CRIT_MULT;
    // armor penetration reduces the target's damage reduction
    base *= (1 - target.eff.dmgReduction * (1 - (weapon.armorPen || 0)));
    if (blocked) base *= (1 - BLOCK_REDUCTION);
    // small variance
    base *= rng.range(0.9, 1.1);
    const dmg = Math.max(1, Math.round(base));

    target.hp -= dmg;
    actor.catHits && (actor.catHits[weapon.cat] = (actor.catHits[weapon.cat] || 0) + 1);
    if (actor.dmgDealt!= null) actor.dmgDealt += dmg;
    if (target.dmgTaken!= null) target.dmgTaken += dmg;

    // lifesteal
    let lifeheal = 0;
    if (weapon.lifesteal > 0 && actor.alive) {
      lifeheal = Math.max(1, Math.round(dmg * weapon.lifesteal));
      actor.hp = Math.min(actor.maxHp, actor.hp + lifeheal);
      if (actor.healed!= null) actor.healed += lifeheal;
    }

    E('hit', {
      source: actor.id, target: target.id, dmg, crit, blocked,
      weapon: weapon.base, icon: weapon.icon, rarity: weapon.rarity, lifeheal, sourceHp: actor.hp,
      hp: Math.max(0, target.hp),
      text: `${actor.name} hits ${target.name} with ${weapon.name} for ${dmg}${crit? ' (CRIT!)' : ''}${blocked? ' (blocked)' : ''}.`,
    });

    // --- thief: steal a weapon on hit ---
    const thief = actor.actives && actor.actives.find(a => a.type === 'thief' && a.used < a.uses);
    if (thief && target.type === 'brute' && target.weapons.length && rng.chance(0.6)) {
      thief.used++;
      const stolen = rng.pick(target.weapons);
      target.weapons = target.weapons.filter(w => w!== stolen);
      actor.weapons.push(stolen);
      E('skill', { skill: 'thief', icon: '', source: actor.id, target: target.id,
        text: `${actor.name} steals ${target.name}'s ${stolen.name}!` });
    }

    // --- weapon disarm ---
    if (!isFist && target.type === 'brute' && target.weapons.length && rng.chance(weapon.disarm)) {
      const lost = rng.pick(target.weapons);
      target.weapons = target.weapons.filter(w => w!== lost);
      E('skill', { skill: 'disarm', icon: '', source: actor.id, target: target.id,
        text: `${target.name} is disarmed, dropping their ${lost.name}!` });
    }

    // --- reflect (hostility) ---
    if (target.alive && target.eff.reflect > 0 && target.hp > 0) {
      const rdmg = Math.max(1, Math.round(dmg * target.eff.reflect));
      actor.hp -= rdmg;
      if (actor.dmgTaken!= null) actor.dmgTaken += rdmg;
      if (target.dmgDealt!= null) target.dmgDealt += rdmg;
      E('hit', { source: target.id, target: actor.id, dmg: rdmg, crit: false, kind: 'reflect',
        hp: Math.max(0, actor.hp), text: `${target.name} reflects ${rdmg} damage back!` });
      checkDeath(actor, events, time);
    }

    // --- stun from hammer ---
    if (stun && target.alive) {
      target.immobilized += 1;
      E('stun', { source: actor.id, target: target.id, text: `${target.name} is stunned!` });
    }

    checkDeath(target, events, time);

    // --- counter-attack ---
    if (!blocked) maybeCounter(target, actor, rng, events, time, units);
  }

  function maybeCounter(defender, attacker, rng, events, time, units) {
    if (!defender.alive ||!attacker.alive) return;
    if (!rng.chance(defender.eff.counter)) return;
    const E = (type, extra) => events.push(Object.assign({ t: time, type }, extra));
    const weapon = defender.type === 'pet'? global.Items.fistStats() : (defender.weapons.length && rng.chance(0.5)? rng.pick(defender.weapons) : global.Items.fistStats());
    const styleMul = weapon.cat === 'fist'? defender.eff.fistMul : defender.eff.weaponMul;
    let cdmg = (weapon.dmg + defender.eff.strength * STR_SCALE) * styleMul * 0.7;
    if (defender.catDmg && defender.catDmg[weapon.cat]) cdmg *= defender.catDmg[weapon.cat];
    cdmg *= defender.dmgMul || 1;
    let dmg = Math.max(1, Math.round(cdmg * (1 - attacker.eff.dmgReduction * (1 - (weapon.armorPen || 0)))));
    attacker.hp -= dmg;
    if (defender.dmgDealt!= null) defender.dmgDealt += dmg;
    if (attacker.dmgTaken!= null) attacker.dmgTaken += dmg;
    E('counter', { source: defender.id, target: attacker.id, dmg, hp: Math.max(0, attacker.hp),
      text: `${defender.name} counter-attacks for ${dmg}!` });
    checkDeath(attacker, events, time);
  }

  function checkDeath(unit, events, time) {
    if (unit.alive && unit.hp <= 0) {
      unit.alive = false;
      unit.hp = 0;
      events.push({ t: time, type: 'death', source: unit.id,
        text: `${unit.name} is defeated! ${unit.type === 'pet'? '' : ''}` });
    }
  }

  function rosterInfo(units, team) {
    return units.filter(u => u.team === team).map(u => ({
      id: u.id, name: u.name, icon: u.icon, type: u.type, petId: u.petId || null,
      hp: u.hp, maxHp: u.maxHp, appearance: u.appearance || null,
      weapons: u.weapons.slice(), skills: u.skills? u.skills.slice() : [],
    }));
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  global.Combat = { simulateBattle };
})(window);
