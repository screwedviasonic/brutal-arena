/* Verifies the loadout rework: instanced pets/skills, equipped-only combat,
 * legacy compatibility, and forge ops. Run: node pvp/test-loadout.mjs */
import { RNG, Character, Combat, Items, GAMEDATA } from './engine.mjs';

let fail = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fail++; };

console.log('createBrute + loadout:');
const a = Character.createBrute(new RNG(7));
ok(a.equipped && typeof a.equipped === 'object', 'has equipped slots');
ok(a.equipped.skills.length <= 3, 'starts with <=3 equipped skills');
const lo = Character.loadout(a);
ok(!lo.weapon || lo.weapon.uid === a.equipped.weapon, 'loadout weapon matches equipped');

console.log('instanced pets & skills:');
const pet = Items.generatePet('wolf', new RNG(3), { rarity: 'rare', level: 2 });
const ps = Items.petStats(pet);
const baseWolf = GAMEDATA.PETS.wolf;
ok(ps.hp > baseWolf.hp, `rare+2 wolf HP scaled up (${ps.hp} > ${baseWolf.hp})`);
const sk = Items.generateSkill('herculean', new RNG(4), { rarity: 'common', level: 0 });
const skHi = Items.generateSkill('herculean', new RNG(4), { rarity: 'legendary', level: 5 });
const mLo = Items.skillMods(sk).mods.strengthMul, mHi = Items.skillMods(skHi).mods.strengthMul;
ok(mHi > mLo, `legendary+5 skill scales potency (${mHi.toFixed(2)} > ${mLo.toFixed(2)})`);

console.log('equipped-only combat (power reflects equipped weapon):');
const b = Character.createBrute(new RNG(11));
const strong = Items.generateWeapon('lightsaber', new RNG(1), { rarity: 'legendary' });
const weak = Items.generateWeapon('knife', new RNG(2), { rarity: 'common' });
b.weapons.push(strong, weak);
b.equipped.weapon = strong.uid;
const pStrong = Character.powerRating(b, {});
b.equipped.weapon = weak.uid;
const pWeak = Character.powerRating(b, {});
ok(pStrong > pWeak, `equipping strong weapon raises power (${pStrong} > ${pWeak}); owning both doesn't stack`);

console.log('equipped skills change effective stats:');
const c = Character.createBrute(new RNG(21));
const vit = Items.generateSkill('vitality', new RNG(5), { rarity: 'rare' });
c.skills.push(vit);
c.equipped.skills = [];
const hpNo = Character.effectiveStats(c, {}).maxHp;
c.equipped.skills = [vit.uid];
const hpYes = Character.effectiveStats(c, {}).maxHp;
ok(hpYes > hpNo, `equipping Vitality raises maxHp (${hpYes} > ${hpNo})`);

console.log('determinism with new model:');
const opp = Character.generateOpponent(10, new RNG(99));
const r1 = Combat.simulateBattle(a, opp, 0xABCDE, {});
const r2 = Combat.simulateBattle(a, opp, 0xABCDE, {});
ok(r1.winner === r2.winner && r1.events.length === r2.events.length, 'same seed -> identical fight');

console.log('legacy brute (string ids, no equipped) still fights:');
const legacy = {
  name: 'Old Timer', appearance: a.appearance, level: 8,
  stats: { hp: 120, strength: 30, agility: 20, speed: 18 },
  weapons: [Items.generateWeapon('sword', new RNG(6), { rarity: 'rare' })],
  skills: ['herculean', 'vitality', 'armor', 'feline'],  // ids, > 3
  pets: ['wolf'],                                          // id
};
let crashed = false, lr;
try { lr = Combat.simulateBattle(legacy, opp, 0x1234, {}); } catch (e) { crashed = true; console.log('   ', e.message); }
ok(!crashed && lr, 'legacy snapshot simulates without crashing');
const llo = Character.loadout(legacy);
ok(llo.skills.length === 3, `legacy fallback equips first 3 of 4 skills (${llo.skills.length})`);
ok(!!llo.pet, 'legacy fallback equips the pet');

console.log('forge: fuse two same pets -> higher rarity:');
const p1 = Items.generatePet('panther', new RNG(8), { rarity: 'rare' });
const p2 = Items.generatePet('panther', new RNG(9), { rarity: 'rare' });
ok(Items.canFuse(p1, p2), 'two rare panthers can fuse');
const fused = Items.fuse(p1, p2, new RNG(10));
ok(Items.rarityRank(fused.rarity) === Items.rarityRank('rare') + 1, `fused pet is one rarity up (${fused.rarity})`);
ok(Items.kindOf(fused) === 'pet', 'fused result is still a pet');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
