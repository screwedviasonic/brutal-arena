/* ============================================================
 * pvp/resolve.mjs — authoritative PvP match resolution.
 *
 * Pure functions the backend (Supabase Edge Function / Node) calls to
 * settle a ladder match. The fight runs through the shared combat
 * engine, so given (attacker, defender, seed, bonuses) the outcome is
 * fully reproducible — the client can replay the identical animation
 * by feeding the same seed back into UI.replayBattle.
 * ============================================================ */

import { Combat } from './engine.mjs';

/* Settle one attack: attacker (left) vs defender's snapshot (right). */
export function resolveMatch(attacker, defender, seed, opts = {}) {
  seed = seed >>> 0;
  const result = Combat.simulateBattle(attacker, defender, seed, {
    leftBonuses: opts.attackerBonuses || {},
    rightBonuses: opts.defenderBonuses || {},
  });
  const attackerWon = result.winner === 'left';
  return {
    seed,                       // store this in the match row; client replays with it
    attackerWon,
    winner: result.winner,
    playerStats: result.playerStats,
    turns: result.events.length,
  };
}

/* Standard Elo update. Returns new integer ratings for both sides. */
export function elo(ratingA, ratingB, attackerWon, k = 32) {
  const ea = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const eb = 1 - ea;
  const sa = attackerWon ? 1 : 0;
  return {
    a: Math.round(ratingA + k * (sa - ea)),
    b: Math.round(ratingB + k * ((1 - sa) - eb)),
  };
}
