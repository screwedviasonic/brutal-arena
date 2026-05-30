/* ============================================================
 * pvp/engine.mjs — headless loader for the Brutal Arena combat core.
 *
 * The browser game loads js/*.js as classic scripts that attach to
 * `window`. This module shims `window` to `globalThis`, evaluates the
 * pure simulation files (no DOM, no localStorage), and re-exports the
 * resulting globals so a Node/Deno backend can run the EXACT same
 * fight engine the client uses. That shared code path is what makes
 * server-authoritative PvP possible without a second implementation.
 *
 * NOTE: only the deterministic core is loaded — ui/avatar/fighter
 * (presentation) and game.js (state/loop) are intentionally excluded.
 * ============================================================ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// the IIFE modules do `(function (global) { ... })(window)` — point window at the global object
globalThis.window = globalThis;

// order matters: rng -> data -> items -> character -> combat
const CORE = ['js/rng.js', 'js/data.js', 'js/items.js', 'js/character.js', 'js/combat.js'];
for (const f of CORE) {
  // indirect eval runs in global scope so each file's `window.X = ...` lands on globalThis
  (0, eval)(readFileSync(join(root, f), 'utf8'));
}

export const RNG = globalThis.RNG;
export const GAMEDATA = globalThis.GAMEDATA;
export const Items = globalThis.Items;
export const Character = globalThis.Character;
export const Combat = globalThis.Combat;
