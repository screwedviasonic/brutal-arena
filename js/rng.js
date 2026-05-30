/* ============================================================
 * rng.js — small seeded RNG + random helpers
 * A seedable PRNG (mulberry32) lets battles be deterministic
 * given a seed, which makes the animated replay reproducible.
 * ============================================================ */

(function (global) {
  'use strict';

  // mulberry32: fast, decent-quality 32-bit PRNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class RNG {
    constructor(seed) {
      if (seed === undefined || seed === null) {
        seed = (Math.random() * 0xffffffff) >>> 0;
      }
      this.seed = seed >>> 0;
      this._next = mulberry32(this.seed);
    }
    // float in [0,1)
    float() {
      return this._next();
    }
    // int in [min, max] inclusive
    int(min, max) {
      return Math.floor(this._next() * (max - min + 1)) + min;
    }
    // float in [min, max)
    range(min, max) {
      return this._next() * (max - min) + min;
    }
    // true with probability p (0..1)
    chance(p) {
      return this._next() < p;
    }
    // pick a random element
    pick(arr) {
      return arr[Math.floor(this._next() * arr.length)];
    }
    // pick n distinct elements
    sample(arr, n) {
      const copy = arr.slice();
      const out = [];
      n = Math.min(n, copy.length);
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(this._next() * copy.length);
        out.push(copy.splice(idx, 1)[0]);
      }
      return out;
    }
    // weighted pick: items = [{item, weight}, ...]
    weighted(items) {
      let total = 0;
      for (const it of items) total += it.weight;
      let r = this._next() * total;
      for (const it of items) {
        r -= it.weight;
        if (r <= 0) return it.item;
      }
      return items[items.length - 1].item;
    }
    // shuffle in place (Fisher-Yates) and return
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this._next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  global.RNG = RNG;
  global.randomSeed = randomSeed;
})(window);
