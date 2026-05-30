/* ============================================================
 * avatar.js — procedural inked "mugshot" generator.
 * Every brute gets a unique comic-book portrait drawn from its
 * seed: head shape, brow, eyes, snarl, hair/horns, scars, paint.
 * Pure SVG string output, bold black ink + flat fills + halftone.
 * ============================================================ */

(function (global) {
  'use strict';

  let _patternUid = 0; // keeps SVG <pattern>/<clip> ids unique on the page

  const HEADS = {
    square: 'M28,42 Q28,22 60,21 Q92,22 92,42 L92,74 Q92,94 60,99 Q28,94 28,74 Z',
    round:  'M26,58 Q26,21 60,21 Q94,21 94,58 Q94,96 60,99 Q26,96 26,58 Z',
    angular:'M60,19 L90,37 L92,74 L60,100 L28,74 L30,37 Z',
    long:   'M32,38 Q32,20 60,20 Q88,20 88,38 L88,82 Q88,99 60,102 Q32,99 32,82 Z',
    jaw:    'M30,40 Q34,21 60,21 Q86,21 90,40 L86,70 Q84,88 60,98 Q36,88 34,70 Z',
  };
  const HEAD_KEYS = Object.keys(HEADS);

  function lighten(hex, amt) {
    const c = parseHex(hex);
    return rgb(
      Math.min(255, c.r + amt),
      Math.min(255, c.g + amt),
      Math.min(255, c.b + amt)
    );
  }
  function darken(hex, amt) {
    const c = parseHex(hex);
    return rgb(Math.max(0, c.r - amt), Math.max(0, c.g - amt), Math.max(0, c.b - amt));
  }
  function parseHex(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

  /* Build the portrait SVG for a brute. */
  function svg(brute, opts) {
    opts = opts || {};
    const seed = (brute && brute.seed != null) ? brute.seed : 12345;
    const app = (brute && brute.appearance) || {};
    const skin = app.skin || '#c98b5e';
    const outfit = app.outfit || '#b3261e';
    const rng = new global.RNG((seed ^ 0x9e3779b9) >>> 0);
    const uid = 'av' + (_patternUid++);

    const headKey = rng.pick(HEAD_KEYS);
    const head = HEADS[headKey];
    const skinDark = darken(skin, 40);
    const skinLight = lighten(skin, 28);
    const hairColor = rng.pick(['#1a1620', '#2b2230', '#3a2a1a', '#5a3a2a', '#101015', outfit]);

    const browAngry = rng.float() < 0.78;
    const eyeType = rng.pick(['glare', 'glare', 'dots', 'wide', 'patch']);
    const mouthType = rng.pick(['snarl', 'snarl', 'gritted', 'grimace', 'smirk']);
    const topType = rng.pick(['mohawk', 'horns', 'bald', 'topknot', 'tufts', 'bald']);
    const hasScar = rng.float() < 0.4;
    const hasPaint = rng.float() < 0.4;
    const paintColor = rng.pick([outfit, '#dc2626', '#1a1620', '#f59e0b']);

    // ---- halftone shading dots (cheek shadow) ----
    let dots = '';
    for (let yy = 44; yy <= 88; yy += 6) {
      for (let xx = 66; xx <= 88; xx += 6) {
        const edge = (xx - 66) / 22;          // 0..1 toward the right edge
        const r = 0.6 + edge * 1.7;
        if (rng.float() < 0.15) continue;
        dots += `<circle cx="${xx + rng.range(-1, 1).toFixed(1)}" cy="${yy + rng.range(-1, 1).toFixed(1)}" r="${r.toFixed(2)}" fill="rgba(0,0,0,0.16)"/>`;
      }
    }

    // ---- neck + shoulders (outfit) ----
    const shoulders = `
      <path d="M22,118 Q24,96 44,90 L76,90 Q96,96 98,118 Z" fill="${outfit}" stroke="#0b0a0f" stroke-width="4" stroke-linejoin="round"/>
      <path d="M50,92 L70,92 L66,104 L60,108 L54,104 Z" fill="${skinDark}" stroke="#0b0a0f" stroke-width="3.5" stroke-linejoin="round"/>`;

    // ---- head base ----
    const headSvg = `
      <path d="${head}" fill="${skin}" stroke="#0b0a0f" stroke-width="5" stroke-linejoin="round"/>
      <path d="M30,76 Q60,96 90,76 Q88,92 60,99 Q34,93 30,76 Z" fill="${skinDark}" opacity="0.5"/>
      <g clip-path="url(#clip${uid})">${dots}</g>`;

    const clip = `<clipPath id="clip${uid}"><path d="${head}"/></clipPath>`;

    // ---- ears ----
    const ears = `
      <path d="M28,56 Q18,54 20,64 Q22,72 30,70" fill="${skin}" stroke="#0b0a0f" stroke-width="4"/>
      <path d="M92,56 Q102,54 100,64 Q98,72 90,70" fill="${skin}" stroke="#0b0a0f" stroke-width="4"/>`;

    // ---- top / hair ----
    let top = '';
    if (topType === 'mohawk') {
      let spikes = '';
      for (let i = 0; i < 5; i++) {
        const x = 42 + i * 9;
        const h = rng.range(10, 22);
        spikes += `<path d="M${x},24 L${x + 4.5},${24 - h} L${x + 9},24 Z" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3" stroke-linejoin="round"/>`;
      }
      top = spikes;
    } else if (topType === 'horns') {
      top = `
        <path d="M34,34 Q22,22 26,8 Q34,16 40,30 Z" fill="${rng.pick(['#e8e2d0', '#d8c8b0', '#3a2a1a'])}" stroke="#0b0a0f" stroke-width="4" stroke-linejoin="round"/>
        <path d="M86,34 Q98,22 94,8 Q86,16 80,30 Z" fill="${rng.pick(['#e8e2d0', '#d8c8b0', '#3a2a1a'])}" stroke="#0b0a0f" stroke-width="4" stroke-linejoin="round"/>`;
    } else if (topType === 'topknot') {
      top = `
        <path d="M44,28 Q60,18 76,28 L74,36 Q60,30 46,36 Z" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3.5" stroke-linejoin="round"/>
        <circle cx="60" cy="14" r="8" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3.5"/>`;
    } else if (topType === 'tufts') {
      top = `
        <path d="M30,40 Q26,28 38,26 Q34,34 40,40 Z" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3" stroke-linejoin="round"/>
        <path d="M90,40 Q94,28 82,26 Q86,34 80,40 Z" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3" stroke-linejoin="round"/>
        <path d="M48,24 Q60,18 72,24 L70,32 Q60,27 50,32 Z" fill="${hairColor}" stroke="#0b0a0f" stroke-width="3" stroke-linejoin="round"/>`;
    } else {
      // bald — add a small ink shine
      top = `<path d="M44,30 Q54,25 64,29" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3" stroke-linecap="round"/>`;
    }

    // ---- eyes + brows ----
    const lx = 47, rx = 73, ey = 54;
    let eyes = '';
    if (eyeType === 'patch') {
      // one glaring eye + an eyepatch
      eyes += eyeGlare(rx, ey, rng, -1);
      eyes += `<path d="M30,48 L66,42" stroke="#0b0a0f" stroke-width="3.5" stroke-linecap="round"/>
               <rect x="38" y="48" width="20" height="16" rx="3" fill="#0b0a0f"/>`;
    } else if (eyeType === 'dots') {
      eyes += `<circle cx="${lx}" cy="${ey}" r="3.6" fill="#0b0a0f"/><circle cx="${rx}" cy="${ey}" r="3.6" fill="#0b0a0f"/>`;
    } else if (eyeType === 'wide') {
      eyes += eyeBall(lx, ey, 9, 7) + eyeBall(rx, ey, 9, 7);
    } else {
      eyes += eyeGlare(lx, ey, rng, 1) + eyeGlare(rx, ey, rng, -1);
    }
    // brows
    const browY = ey - 11;
    const innerDrop = browAngry ? 6 : 0;
    eyes += `
      <path d="M${lx - 11},${browY - 2} L${lx + 9},${browY + innerDrop}" stroke="#0b0a0f" stroke-width="6" stroke-linecap="round"/>
      <path d="M${rx + 11},${browY - 2} L${rx - 9},${browY + innerDrop}" stroke="#0b0a0f" stroke-width="6" stroke-linecap="round"/>`;

    // ---- nose ----
    const nose = `<path d="M58,58 L55,70 Q60,73 65,70 L62,58" fill="none" stroke="#0b0a0f" stroke-width="3" stroke-linejoin="round" opacity="0.7"/>`;

    // ---- mouth ----
    let mouth = '';
    if (mouthType === 'snarl') {
      mouth = `
        <path d="M44,80 Q60,74 76,80 Q72,92 60,93 Q48,92 44,80 Z" fill="#3a0d0d" stroke="#0b0a0f" stroke-width="4" stroke-linejoin="round"/>
        <path d="M50,80 L53,73 L56,80 Z" fill="#fff" stroke="#0b0a0f" stroke-width="2"/>
        <path d="M64,80 L67,73 L70,80 Z" fill="#fff" stroke="#0b0a0f" stroke-width="2"/>
        <path d="M50,84 L56,84 L53,90 Z" fill="#fff" stroke="#0b0a0f" stroke-width="2"/>
        <path d="M64,84 L70,84 L67,90 Z" fill="#fff" stroke="#0b0a0f" stroke-width="2"/>`;
    } else if (mouthType === 'gritted') {
      mouth = `
        <rect x="46" y="80" width="28" height="11" rx="2" fill="#fff" stroke="#0b0a0f" stroke-width="4"/>
        <path d="M53,80 L53,91 M60,80 L60,91 M67,80 L67,91" stroke="#0b0a0f" stroke-width="2"/>`;
    } else if (mouthType === 'smirk') {
      mouth = `<path d="M46,84 Q58,92 74,80" fill="none" stroke="#0b0a0f" stroke-width="5" stroke-linecap="round"/>`;
    } else {
      mouth = `<path d="M46,86 Q60,78 74,86" fill="none" stroke="#0b0a0f" stroke-width="5" stroke-linecap="round"/>`;
    }

    // ---- scar / war paint ----
    let extras = '';
    if (hasScar) {
      const sx = rng.float() < 0.5 ? 44 : 74;
      extras += `<path d="M${sx},40 L${sx + (sx < 60 ? -4 : 4)},66" stroke="#0b0a0f" stroke-width="2.5" stroke-linecap="round"/>
                 <path d="M${sx - 3},46 L${sx + 3},46 M${sx - 3},54 L${sx + 3},54" stroke="#0b0a0f" stroke-width="2"/>`;
    }
    if (hasPaint) {
      extras += `<rect x="30" y="${ey - 4}" width="60" height="7" fill="${paintColor}" opacity="0.85" rx="2"/>`;
    }

    const inner = `<defs>${clip}</defs>
      ${shoulders}
      ${ears}
      ${headSvg}
      ${top}
      ${hasPaint ? extras : ''}
      ${eyes}
      ${nose}
      ${mouth}
      ${!hasPaint ? extras : ''}`;

    if (opts.raw) return inner;
    return `<svg class="brute-svg" viewBox="0 0 120 124" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;

    function eyeGlare(cx, cy, rng, gaze) {
      return `
        <path d="M${cx - 8},${cy} Q${cx},${cy - 6} ${cx + 8},${cy} Q${cx},${cy + 5} ${cx - 8},${cy} Z" fill="#fff" stroke="#0b0a0f" stroke-width="3"/>
        <circle cx="${cx + gaze * 2}" cy="${cy}" r="3" fill="#0b0a0f"/>`;
    }
    function eyeBall(cx, cy, w, h) {
      return `
        <ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${h}" fill="#fff" stroke="#0b0a0f" stroke-width="3.5"/>
        <circle cx="${cx}" cy="${cy}" r="3.4" fill="#0b0a0f"/>`;
    }
  }

  /* A simple inked badge for pets (animal emoji on a halftone disc). */
  function petSvg(icon) {
    return `<div class="pet-ink"><span>${icon}</span></div>`;
  }

  global.Avatar = { svg, petSvg };
})(window);
