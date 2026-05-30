/* Proves the two foundations of server-authoritative PvP:
 *   1. Determinism — same (attacker, defender, seed) => identical result.
 *   2. Elo — rating updates are sane and zero-sum-ish.
 * Run: node pvp/test-parity.mjs
 */
import { RNG, Character } from './engine.mjs';
import { resolveMatch, elo } from './resolve.mjs';

let fail = 0;
const assert = (cond, msg) => { if (!cond) { console.log('  ✗', msg); fail++; } else console.log('  ✓', msg); };

// build two repeatable brutes
function brute(seed, level) {
  const b = Character.createBrute(new RNG(seed));
  b.level = level;
  return b;
}

console.log('determinism:');
const A = brute(111, 10), B = brute(222, 10);
const seed = 0xDECAF;
const r1 = resolveMatch(A, B, seed);
const r2 = resolveMatch(A, B, seed);
assert(r1.attackerWon === r2.attackerWon, 'same winner on repeat');
assert(r1.turns === r2.turns, 'same event count on repeat (' + r1.turns + ')');
assert(r1.seed === seed, 'seed echoed back for client replay');

// different seed can differ; same-seed must not
let diffs = 0;
for (let s = 1; s <= 50; s++) {
  const a = resolveMatch(A, B, s), b = resolveMatch(A, B, s);
  if (a.attackerWon !== b.attackerWon || a.turns !== b.turns) diffs++;
}
assert(diffs === 0, 'no nondeterminism across 50 seeds');

console.log('elo:');
const up = elo(1000, 1000, true);
assert(up.a === 1016 && up.b === 984, 'even match, attacker wins: +16/-16 (' + up.a + '/' + up.b + ')');
const upset = elo(1000, 1400, true);
assert(upset.a - 1000 > 25, 'beating a much higher rating gains more (' + (upset.a - 1000) + ')');
const expected = elo(1400, 1000, true);
assert(expected.a - 1400 < 10, 'beating a much lower rating gains little (' + (expected.a - 1400) + ')');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
