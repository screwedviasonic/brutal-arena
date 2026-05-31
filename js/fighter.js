/* ============================================================
 * fighter.js — an articulated, animated comic-book brute.
 *
 * Builds a full-body SVG rig (legs, torso, head=procedural face,
 * weapon arm) and exposes move methods that return Promises:
 *   attack(cat, onContact) · hurt() · dodge() · block() · die()
 *   drawWeapon(cat)  ("pull out a weapon" flourish)
 * Animations use the Web Animations API so the battle replay can
 * await each beat and chain them to the combat event stream.
 *
 * The rig is authored facing RIGHT. The right-side fighter mounts
 * mirrored (scaleX(-1)), so the same move code reads correctly
 * for both corners.
 * ============================================================ */

(function (global) {
  'use strict';

  const A = global.Avatar;

  // global time scale (replay sets this; FAST mode shrinks it)
  let TS = 1;

  const WEAPON_CAT = {
    knife: 'blade', sword: 'blade', scimitar: 'blade', broadsword: 'blade',
    sai: 'blade', lightsaber: 'blade', fan: 'blade', whip: 'blade',
    baton: 'blunt', mug: 'blunt', club: 'blunt', fryingpan: 'blunt', morningstar: 'blunt',
    axe: 'axe', halberd: 'spear', trident: 'spear',
  };

  // per-weapon held shapes (hand at origin, weapon extends +y away from the fist)
  const WEAPON_SHAPE = {
    knife: '<rect x="-7" y="-3" width="14" height="6" rx="2" fill="#7a5230" stroke="#14110d" stroke-width="3"/><path d="M-3,2 L3,2 L1.5,34 L0,40 L-1.5,34 Z" fill="#eef3f8" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/>',
    sword: '<rect x="-8" y="-3" width="16" height="6" rx="2" fill="#7a5230" stroke="#14110d" stroke-width="3"/><path d="M-3.5,2 L3.5,2 L2,46 L0,54 L-2,46 Z" fill="#eef3f8" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/>',
    broadsword: '<rect x="-10" y="-3" width="20" height="6" rx="2" fill="#7a5230" stroke="#14110d" stroke-width="3"/><path d="M-5,2 L5,2 L4,42 L0,52 L-4,42 Z" fill="#dfe6ee" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/>',
    scimitar: '<rect x="-7" y="-3" width="14" height="6" rx="2" fill="#7a5230" stroke="#14110d" stroke-width="3"/><path d="M-3,2 C-3,2 16,16 5,52 C3,44 -2,38 -2,28 Z" fill="#eef3f8" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/>',
    sai: '<rect x="-4" y="-2" width="8" height="12" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><g stroke-linecap="round"><path d="M0,8 V50 M-9,16 V30 M9,16 V30" stroke="#14110d" stroke-width="8"/><path d="M-9,16 Q0,10 9,16" fill="none" stroke="#14110d" stroke-width="8"/><path d="M0,8 V50 M-9,16 V30 M9,16 V30" stroke="#cfd6de" stroke-width="4.5"/><path d="M-9,16 Q0,10 9,16" fill="none" stroke="#cfd6de" stroke-width="4.5"/></g>',
    fan: '<rect x="-3" y="-2" width="6" height="14" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><path d="M0,10 L-22,44 A26 26 0 0 0 22,44 Z" fill="#e0563f" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/><path d="M0,12 L-12,42 M0,12 L0,46 M0,12 L12,42" stroke="#14110d" stroke-width="2"/>',
    whip: '<path d="M0,0 C-14,12 14,20 0,32 C-12,42 12,48 6,60" fill="none" stroke="#6b4a2a" stroke-width="6" stroke-linecap="round"/><path d="M0,0 C-14,12 14,20 0,32 C-12,42 12,48 6,60" fill="none" stroke="#3a2a1a" stroke-width="2.4" stroke-linecap="round"/>',
    lightsaber: '<rect x="-5" y="-4" width="10" height="16" rx="3" fill="#2b2230" stroke="#14110d" stroke-width="3"/><rect x="-4" y="12" width="8" height="44" rx="4" fill="#7fd8ff" stroke="#14110d" stroke-width="3"/><rect x="-1.6" y="14" width="3.2" height="40" rx="1.6" fill="#eafaff"/>',
    baton: '<rect x="-3.5" y="0" width="7" height="36" rx="3" fill="#2b2230" stroke="#14110d" stroke-width="3"/>',
    club: '<path d="M-4,0 L4,0 L8,46 C8,55 -8,55 -8,46 Z" fill="#6b4a2a" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/><circle cx="-3" cy="40" r="1.8" fill="#3a2a1a"/><circle cx="3" cy="47" r="1.8" fill="#3a2a1a"/>',
    mug: '<rect x="-3.5" y="0" width="7" height="20" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><rect x="-11" y="20" width="22" height="26" rx="4" fill="#ffce3a" stroke="#14110d" stroke-width="3"/><rect x="-11" y="20" width="22" height="7" fill="#fff" stroke="#14110d" stroke-width="3"/><path d="M11,26 H17 A4 4 0 0 1 17 40 H11" fill="none" stroke="#14110d" stroke-width="3"/>',
    fryingpan: '<rect x="-3.5" y="0" width="7" height="24" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><circle cx="0" cy="42" r="14" fill="#3a3530" stroke="#14110d" stroke-width="3.5"/>',
    morningstar: '<rect x="-3.5" y="0" width="7" height="32" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><path d="M0,31 V37 M0,55 V61 M-15,46 H-9 M9,46 H15 M-10,36 L-6,40 M10,36 L6,40 M-10,56 L-6,52 M10,56 L6,52" stroke="#14110d" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="46" r="11" fill="#9aa0a8" stroke="#14110d" stroke-width="3.5"/>',
    axe: '<rect x="-3.5" y="-6" width="7" height="56" rx="3" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><path d="M3,10 Q26,12 20,36 Q12,30 3,34 Z" fill="#aab0b8" stroke="#14110d" stroke-width="3.5" stroke-linejoin="round"/>',
    trident: '<rect x="-2.5" y="-6" width="5" height="52" rx="2" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><g stroke-linecap="round"><path d="M0,66 V46 M-10,60 V48 M10,60 V48" stroke="#14110d" stroke-width="7"/><path d="M-10,48 Q0,54 10,48" fill="none" stroke="#14110d" stroke-width="7"/><path d="M0,66 V46 M-10,60 V48 M10,60 V48" stroke="#cfd6de" stroke-width="3.5"/><path d="M-10,48 Q0,54 10,48" fill="none" stroke="#cfd6de" stroke-width="3.5"/></g>',
    halberd: '<rect x="-2.5" y="-6" width="5" height="60" rx="2" fill="#6b4a2a" stroke="#14110d" stroke-width="3"/><path d="M-4,58 L4,58 L0,70 Z" fill="#cfd6de" stroke="#14110d" stroke-width="3" stroke-linejoin="round"/><path d="M3,30 Q24,32 18,52 Q11,47 3,50 Z" fill="#aab0b8" stroke="#14110d" stroke-width="3.5" stroke-linejoin="round"/>',
  };
  // category fallback for any unmapped base
  const CAT_SHAPE = {
    blade: WEAPON_SHAPE.sword, blunt: WEAPON_SHAPE.club, axe: WEAPON_SHAPE.axe, spear: WEAPON_SHAPE.trident,
  };
  function weaponShape(base) { return WEAPON_SHAPE[base] || CAT_SHAPE[WEAPON_CAT[base]] || ''; }

  // rarity aura: a colored glow on the weapon (common = none)
  const AURA = { uncommon: '#2dc653', rare: '#3a86ff', epic: '#a855f7', legendary: '#ff9e00', mythic: '#ff2d55' };
  function auraFilter(rarity, scale) {
    const c = AURA[rarity];
    if (!c) return '';
    const s = scale || 1;
    const strong = rarity === 'legendary' || rarity === 'mythic';
    return `drop-shadow(0 0 ${(strong ? 4 : 3) * s}px ${c}) drop-shadow(0 0 ${(strong ? 9 : 5) * s}px ${c})`;
  }

  class Fighter {
    constructor(mount, brute, facing, weapon) {
      this.brute = brute;
      this.facing = facing || 'right';
      this.dead = false;
      this.currentCat = 'fist';
      // weapon: an item instance {base, rarity}, or null/'fist' for unarmed
      if (weapon && typeof weapon === 'object') { this.weaponBase = weapon.base || 'fist'; this.weaponRarity = weapon.rarity || 'common'; }
      else { this.weaponBase = (weapon && weapon !== 'fist') ? weapon : 'fist'; this.weaponRarity = 'common'; }
      this.skin = (brute.appearance && brute.appearance.skin) || '#c98b5e';
      this.outfit = (brute.appearance && brute.appearance.outfit) || '#b3261e';
      this.armRest = 14;     // resting front-arm angle (deg)
      this.backRest = -10;

      mount.classList.add('fighter-rig');
      if (this.facing === 'left') mount.classList.add('flip');
      mount.innerHTML = this._svg();

      this.svg = mount.querySelector('svg');
      this.root = mount.querySelector('.f-root');
      this.bob = mount.querySelector('.f-bob');
      this.head = mount.querySelector('.f-head');
      this.frontArm = mount.querySelector('.f-frontarm');
      this.backArm = mount.querySelector('.f-backarm');
      this.weapon = mount.querySelector('.f-weapon');
      this.fist = mount.querySelector('.f-fist');

      // baseline rest poses
      this.frontArm.style.transform = `rotate(${this.armRest}deg)`;
      this.backArm.style.transform = `rotate(${this.backRest}deg)`;
      // hold the equipped weapon from the start (so the fighter visibly wields it)
      this.setWeaponNow(this.weaponBase, this.weaponRarity);

      this._idle();
    }

    _svg() {
      const out = this.outfit, skin = this.skin;
      const outD = shade(out, -34), skinD = shade(skin, -34);
      const faceInner = A.svg(this.brute, { raw: true });
      return `<svg class="f-svg" viewBox="0 0 140 220" xmlns="http://www.w3.org/2000/svg" overflow="visible">
        <g class="f-root">
          <!-- ground shadow -->
          <ellipse class="f-shadow" cx="70" cy="210" rx="42" ry="8" fill="rgba(0,0,0,0.22)"/>
          <g class="f-bob">
            <!-- back leg -->
            <g transform="translate(62,122)"><rect x="-8" y="0" width="16" height="86" rx="8" fill="${outD}" stroke="#14110d" stroke-width="4"/><ellipse cx="-4" cy="88" rx="14" ry="7" fill="${outD}" stroke="#14110d" stroke-width="4"/></g>
            <!-- back arm -->
            <g transform="translate(60,74)"><g class="f-backarm"><rect x="-6" y="-2" width="12" height="52" rx="6" fill="${outD}" stroke="#14110d" stroke-width="4"/><circle cx="0" cy="52" r="8" fill="${skinD}" stroke="#14110d" stroke-width="4"/></g></g>
            <!-- front leg -->
            <g transform="translate(80,122)"><rect x="-8" y="0" width="16" height="86" rx="8" fill="${out}" stroke="#14110d" stroke-width="4"/><ellipse cx="6" cy="88" rx="15" ry="7" fill="${out}" stroke="#14110d" stroke-width="4"/></g>
            <!-- torso -->
            <g transform="translate(70,124)">
              <path d="M-20,2 Q-22,-30 -15,-56 L15,-56 Q22,-30 20,2 Q0,8 -20,2 Z" fill="${out}" stroke="#14110d" stroke-width="4.5" stroke-linejoin="round"/>
              <path d="M2,-54 Q18,-28 17,0 Q9,3 2,2 Z" fill="rgba(0,0,0,0.14)"/>
              <rect x="-21" y="-4" width="42" height="9" rx="3" fill="#14110d"/>
              <rect x="-5" y="-3" width="10" height="7" rx="2" fill="${out}" stroke="#14110d" stroke-width="2.5"/>
            </g>
            <!-- head (procedural face) -->
            <g transform="translate(70,72)"><g class="f-head">
              <rect x="-8" y="-14" width="16" height="16" rx="4" fill="${skin}" stroke="#14110d" stroke-width="4"/>
              <svg x="-30" y="-66" width="60" height="62" viewBox="0 0 120 124" overflow="visible">${faceInner}</svg>
            </g></g>
            <!-- front (weapon) arm -->
            <g transform="translate(80,73)"><g class="f-frontarm">
              <rect x="-6.5" y="-2" width="13" height="22" rx="6" fill="${out}" stroke="#14110d" stroke-width="4"/>
              <rect x="-6" y="16" width="12" height="40" rx="6" fill="${skin}" stroke="#14110d" stroke-width="4"/>
              <g transform="translate(0,56)">
                <g class="f-weapon"></g>
                <circle class="f-fist" cx="0" cy="2" r="9" fill="${skin}" stroke="#14110d" stroke-width="4"/>
              </g>
            </g></g>
          </g>
        </g>
      </svg>`;
    }

    /* ----- animation helpers ----- */
    // Always resolves: races the animation's finish against a safety
    // timeout so a single stalled promise can never freeze the fight.
    _anim(el, frames, dur, easing, fillEnd) {
      const d = Math.max(1, dur * TS);
      let done = false;
      const finish = () => { if (done) return; done = true; if (fillEnd) el.style.transform = fillEnd; };
      let a;
      try { a = el.animate(frames, { duration: d, easing: easing || 'ease', fill: 'none' }); }
      catch (e) { finish(); return Promise.resolve(); }
      return Promise.race([
        a.finished.then(finish).catch(() => finish()),
        new Promise(r => setTimeout(() => { finish(); r(); }, d + 80)),
      ]);
    }
    _rot(el, from, to, dur, easing) {
      return this._anim(el, [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], dur, easing, `rotate(${to}deg)`);
    }
    _idle() {
      this._bobAnim = this.bob.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }],
        { duration: 2200, iterations: Infinity, easing: 'ease-in-out' }
      );
    }

    /* ----- moves ----- */
    setWeaponNow(base, rarity) {
      base = base || 'fist';
      if (base === 'fist') {
        this.weapon.style.display = 'none'; this.weapon.style.filter = ''; this.fist.style.display = '';
        this.currentCat = 'fist';
      } else {
        this.weapon.innerHTML = weaponShape(base);
        this.weapon.style.filter = auraFilter(rarity != null ? rarity : this.weaponRarity);
        this.weapon.style.display = ''; this.fist.style.display = 'none';
        this.weaponBase = base;
        this.currentCat = WEAPON_CAT[base] || 'blade';
      }
    }

    // the fighter always wields its equipped weapon; only flourish if not yet shown
    async drawWeapon(cat) {
      if (this.dead) return;
      cat = cat || 'fist';
      if (cat === this.currentCat) return;
      if (cat === 'fist') { this.setWeaponNow('fist'); return; }
      await this._rot(this.frontArm, this.armRest, 120, 130, 'ease-out');
      this.setWeaponNow(this.weaponBase, this.weaponRarity);
      await this._rot(this.frontArm, 120, this.armRest, 150, 'ease-in');
    }

    async attack(cat, onContact) {
      if (this.dead) return;
      await this.drawWeapon(cat || 'fist');
      // lunge in toward the opponent
      const lunge = this._anim(this.root, [{ transform: 'translateX(0)' }, { transform: 'translateX(46px)' }], 150, 'ease-out', 'translateX(46px)');
      await this._rot(this.frontArm, this.armRest, 122, 130, 'ease-out'); // windup: cock the arm up & back
      await lunge;
      await this._rot(this.frontArm, 122, -98, 105, 'cubic-bezier(.3,0,.2,1)'); // overhead chop forward -> contact
      if (typeof onContact === 'function') onContact();
      await wait(70);
      // recover
      const back = this._anim(this.root, [{ transform: 'translateX(46px)' }, { transform: 'translateX(0)' }], 200, 'ease-in-out', 'translateX(0)');
      await this._rot(this.frontArm, -98, this.armRest, 200, 'ease-out');
      await back;
    }

    async hurt() {
      if (this.dead) return;
      this.svg.classList.add('f-flash');
      const kb = this._anim(this.root,
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-26px) rotate(-5deg)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }],
        320, 'ease-out', 'translateX(0)');
      this._rot(this.head, 0, -24, 120, 'ease-out').then(() => this._rot(this.head, -24, 0, 180, 'ease-in'));
      await kb;
      this.svg.classList.remove('f-flash');
    }

    async dodge() {
      if (this.dead) return;
      await this._anim(this.root,
        [{ transform: 'translateX(0) translateY(0)' },
         { transform: 'translateX(-30px) translateY(-14px) rotate(-6deg)' },
         { transform: 'translateX(-30px) translateY(0) rotate(-6deg)' },
         { transform: 'translateX(0) translateY(0)' }],
        360, 'ease-in-out', 'translateX(0)');
    }

    async block() {
      if (this.dead) return;
      this.svg.classList.add('f-block');
      const guardFront = this._rot(this.frontArm, this.armRest, -36, 110, 'ease-out');
      const guardBack = this._rot(this.backArm, this.backRest, -64, 110, 'ease-out');
      const recoil = this._anim(this.root, [{ transform: 'translateX(0)' }, { transform: 'translateX(-12px)' }, { transform: 'translateX(0)' }], 300, 'ease-out', 'translateX(0)');
      await Promise.all([guardFront, guardBack]);
      await wait(60 * TS);
      this.svg.classList.remove('f-block');
      await Promise.all([
        this._rot(this.frontArm, -36, this.armRest, 160, 'ease-in'),
        this._rot(this.backArm, -64, this.backRest, 160, 'ease-in'),
        recoil,
      ]);
    }

    async throwGesture() {
      if (this.dead) return;
      await this._rot(this.frontArm, this.armRest, 120, 120, 'ease-out'); // wind back
      await this._rot(this.frontArm, 120, -60, 110, 'ease-in');           // hurl forward
      await this._rot(this.frontArm, -60, this.armRest, 160, 'ease-out');
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      if (this._bobAnim) this._bobAnim.cancel();
      this.svg.classList.add('f-dead');
      const a = this.root.animate(
        [{ transform: 'translateX(0) rotate(0) translateY(0)' },
         { transform: 'translateX(-6px) rotate(-86deg) translateY(20px)' }],
        { duration: 620 * TS, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
      a.finished.then(() => { this.root.style.transform = 'translateX(-6px) rotate(-86deg) translateY(20px)'; }).catch(() => {});
    }

    weaponPoint() {
      // approximate world point of the weapon tip for FX (in stage coords handled by caller)
      const r = this.svg.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
    }
  }

  /* ============================================================
   * PetFighter — an animated quadruped that lunges, bites, recoils,
   * dodges and dies. Same method surface as Fighter so the battle
   * replay can drive brutes and pets through one code path.
   * ============================================================ */
  const PET_LOOK = {
    dog:     { color: '#b07a3c', w: 132, h: 96, ear: 'flop',  tail: 'curl' },
    wolf:    { color: '#8b929c', w: 138, h: 98, ear: 'point', tail: 'bush' },
    panther: { color: '#3b3146', w: 142, h: 98, ear: 'point', tail: 'thin' },
    bear:    { color: '#6f4d2e', w: 158, h: 112, ear: 'round', tail: 'stub' },
  };

  function petEars(L, c, cd, ink) {
    if (L.ear === 'point') return `<path d="M-6,-14 L-12,-34 L4,-20 Z" fill="${c}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M14,-16 L16,-36 L26,-18 Z" fill="${c}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`;
    if (L.ear === 'round') return `<circle cx="-6" cy="-18" r="9" fill="${c}" stroke="${ink}" stroke-width="4"/><circle cx="18" cy="-18" r="9" fill="${c}" stroke="${ink}" stroke-width="4"/>`;
    return `<path d="M-8,-10 Q-20,-12 -18,6 Q-8,2 0,-6 Z" fill="${cd}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/><path d="M16,-12 Q28,-14 26,4 Q16,0 10,-8 Z" fill="${cd}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`;
  }

  class PetFighter {
    constructor(mount, species, facing, rarity) {
      this.species = PET_LOOK[species] ? species : 'dog';
      this.facing = facing || 'right';
      this.dead = false;
      this.currentCat = 'fist';
      const L = PET_LOOK[this.species];
      mount.classList.add('pet-rig');
      mount.style.width = L.w + 'px';
      mount.style.height = L.h + 'px';
      if (this.facing === 'left') mount.classList.add('flip');
      mount.innerHTML = this._svg();
      this.svg = mount.querySelector('svg');
      if (this.svg) this.svg.style.filter = auraFilter(rarity, 1.7);   // rarity glow around the pet
      this.root = mount.querySelector('.p-root');
      this.bob = mount.querySelector('.p-bob');
      this.head = mount.querySelector('.p-head');
      this.tail = mount.querySelector('.p-tail');
      this._idle();
    }

    _svg() {
      const L = PET_LOOK[this.species];
      const c = L.color, cd = shade(c, -42), cl = shade(c, 26), ink = '#14110d';
      return `<svg class="p-svg" viewBox="0 0 180 122" xmlns="http://www.w3.org/2000/svg" overflow="visible">
        <g class="p-root">
          <ellipse class="p-shadow" cx="86" cy="114" rx="60" ry="8" fill="rgba(0,0,0,0.22)"/>
          <g class="p-bob">
            <g transform="translate(30,62)"><g class="p-tail"><path d="M0,0 Q-24,-6 -30,-30 Q-14,-16 6,-8 Z" fill="${cd}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/></g></g>
            <rect x="36" y="80" width="14" height="32" rx="7" fill="${cd}" stroke="${ink}" stroke-width="4"/>
            <rect x="56" y="82" width="14" height="30" rx="7" fill="${cd}" stroke="${ink}" stroke-width="4"/>
            <rect x="104" y="82" width="14" height="30" rx="7" fill="${c}" stroke="${ink}" stroke-width="4"/>
            <rect x="122" y="80" width="14" height="32" rx="7" fill="${c}" stroke="${ink}" stroke-width="4"/>
            <ellipse cx="82" cy="62" rx="54" ry="32" fill="${c}" stroke="${ink}" stroke-width="4.5"/>
            <ellipse cx="46" cy="58" rx="28" ry="28" fill="${c}" stroke="${ink}" stroke-width="0"/>
            <path d="M54,40 Q86,30 114,44" stroke="${cl}" stroke-width="5" fill="none" opacity=".35" stroke-linecap="round"/>
            <g transform="translate(128,48)"><g class="p-head">
              ${petEars(L, c, cd, ink)}
              <circle cx="6" cy="2" r="21" fill="${c}" stroke="${ink}" stroke-width="4.5"/>
              <path d="M20,-3 Q44,-3 44,11 Q44,20 23,18 Q16,8 20,-3 Z" fill="${cl}" stroke="${ink}" stroke-width="4.5" stroke-linejoin="round"/>
              <circle cx="44" cy="7" r="4" fill="${ink}"/>
              <circle cx="9" cy="-5" r="3.4" fill="${ink}"/>
              <path d="M24,17 L28,17 L26,23 Z" fill="#fff" stroke="${ink}" stroke-width="1.6"/>
              <path d="M32,17 L36,17 L34,23 Z" fill="#fff" stroke="${ink}" stroke-width="1.6"/>
            </g></g>
          </g>
        </g>
      </svg>`;
    }

    _anim(el, frames, dur, easing, fillEnd) { return animEl(el, frames, dur, easing, fillEnd); }
    _rot(el, from, to, dur, easing) { return rotEl(el, from, to, dur, easing); }
    _idle() {
      this._bobAnim = this.bob.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }],
        { duration: 1800, iterations: Infinity, easing: 'ease-in-out' });
      this._tailAnim = this.tail.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(16deg)' }, { transform: 'rotate(0deg)' }],
        { duration: 900, iterations: Infinity, easing: 'ease-in-out' });
    }

    drawWeapon() { return Promise.resolve(); }
    setWeaponNow() {}

    async attack(cat, onContact) {
      if (this.dead) return;
      const lunge = this._anim(this.root, [{ transform: 'translateX(0)' }, { transform: 'translateX(42px)' }], 150, 'ease-out', 'translateX(42px)');
      await this._rot(this.head, 0, -26, 110, 'ease-out'); // rear back
      await lunge;
      await this._rot(this.head, -26, 30, 90, 'cubic-bezier(.3,0,.2,1)'); // snap forward (bite)
      if (typeof onContact === 'function') onContact();
      await wait(70);
      const back = this._anim(this.root, [{ transform: 'translateX(42px)' }, { transform: 'translateX(0)' }], 190, 'ease-in-out', 'translateX(0)');
      await this._rot(this.head, 30, 0, 170, 'ease-out');
      await back;
    }

    async hurt() {
      if (this.dead) return;
      this.svg.classList.add('f-flash');
      await this._anim(this.root,
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-22px) rotate(-4deg)' }, { transform: 'translateX(0)' }],
        300, 'ease-out', 'translateX(0)');
      this.svg.classList.remove('f-flash');
    }

    async dodge() {
      if (this.dead) return;
      await this._anim(this.root,
        [{ transform: 'translateX(0) translateY(0)' }, { transform: 'translateX(-26px) translateY(-12px)' }, { transform: 'translateX(0) translateY(0)' }],
        340, 'ease-in-out', 'translateX(0)');
    }

    block() { return this.hurt(); }
    throwGesture() { return Promise.resolve(); }

    die() {
      if (this.dead) return;
      this.dead = true;
      if (this._bobAnim) this._bobAnim.cancel();
      if (this._tailAnim) this._tailAnim.cancel();
      this.svg.classList.add('f-dead');
      const a = this.root.animate(
        [{ transform: 'rotate(0) translateY(0)' }, { transform: 'rotate(82deg) translateY(16px)' }],
        { duration: 560 * TS, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
      a.finished.then(() => { this.root.style.transform = 'rotate(82deg) translateY(16px)'; }).catch(() => {});
    }
  }

  /* shared animation helpers (used by both rigs) */
  function animEl(el, frames, dur, easing, fillEnd) {
    const d = Math.max(1, dur * TS);
    let done = false;
    const finish = () => { if (done) return; done = true; if (fillEnd) el.style.transform = fillEnd; };
    let a;
    try { a = el.animate(frames, { duration: d, easing: easing || 'ease', fill: 'none' }); }
    catch (e) { finish(); return Promise.resolve(); }
    return Promise.race([
      a.finished.then(finish).catch(() => finish()),
      new Promise(r => setTimeout(() => { finish(); r(); }, d + 80)),
    ]);
  }
  function rotEl(el, from, to, dur, easing) {
    return animEl(el, [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], dur, easing, `rotate(${to}deg)`);
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms * TS)); }

  function shade(hex, amt) {
    hex = (hex || '#888').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    let r = parseInt(hex.slice(0, 2), 16) + amt;
    let g = parseInt(hex.slice(2, 4), 16) + amt;
    let b = parseInt(hex.slice(4, 6), 16) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  global.Fighter = Fighter;
  global.PetFighter = PetFighter;
  global.FighterCat = WEAPON_CAT;
  global.setFighterTimeScale = function (t) { TS = t; };
})(window);
