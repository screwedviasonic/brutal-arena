/* ============================================================
 * ui.js — DOM rendering + animated comic battle replay.
 * Pure presentation; game.js owns state and wires callbacks.
 * ============================================================ */

(function (global) {
  'use strict';

  const D = global.GAMEDATA;
  const C = global.Character;
  const A = global.Avatar;
  const I = global.Items;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let replayToken = 0; // increments to cancel an in-progress replay
  let fighters = {};   // uid -> Fighter instance (brutes only)
  let curTS = 1;       // current replay time scale
  let curMeta = null;  // current player meta bonuses (for power display)
  function setMeta(m) { curMeta = m; }

  const POW_WORDS = ['POW!', 'BAM!', 'WHAM!', 'BIFF!', 'SOK!', 'THWAK!', 'KRUNCH!', 'WHACK!', 'SMASH!', 'BONK!'];

  /* ---------------- toast ---------------- */
  function toast(msg, type) {
    const stack = $('#toast-stack');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = msg;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, 2600);
  }

  /* ---------------- topbar ---------------- */
  function renderTopbar(state) {
    const g = $('#res-gold'), prev = g.dataset.v;
    g.textContent = fmt(state.gold);
    if (prev !== undefined && +prev !== state.gold) flash($('#res-gold-box'));
    g.dataset.v = state.gold;
    $('#res-stamina').textContent = Math.floor(state.stamina);
    $('#res-stamina-max').textContent = state.staminaMax;
    $('#res-legacy').textContent = fmt(state.legacy);
    const d = $('#res-dust'); if (d) d.textContent = fmt(state.dust || 0);
  }
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  /* ---------------- screens & tabs ---------------- */
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#' + id).classList.remove('hidden');
  }
  const FIGHT_TABS = ['arena', 'gauntlet', 'pvp'];
  // the shared fight stage is visible only on the fighting tabs
  function updateFightView(tabName) {
    const fv = $('#fight-view');
    if (fv) fv.classList.toggle('hidden', FIGHT_TABS.indexOf(tabName) < 0);
  }
  function initTabs() {
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.tabpane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        $('#tab-' + tab.dataset.tab).classList.add('active');
        updateFightView(tab.dataset.tab);
        if (global.PVP && global.PVP.boardFor) global.PVP.boardFor(tab.dataset.tab);
      });
    });
    const active = document.querySelector('.tab.active');
    updateFightView(active ? active.dataset.tab : 'arena');
  }

  /* ---------------- avatars ---------------- */
  function bruteAvatarHtml(brute, size) {
    return `<div class="avatar ${size || ''}" style="--skin:${brute.appearance.skin};--outfit:${brute.appearance.outfit}">${A.svg(brute)}</div>`;
  }

  /* ---------------- creation preview ---------------- */
  function renderCreatePreview(brute, legacyNote) {
    $('#create-preview').innerHTML = bruteAvatarHtml(brute, 'lg') + bruteSummaryHtml(brute);
    if (!$('#create-name').value) $('#create-name').value = brute.name;
    $('#create-legacy-note').textContent = legacyNote || '';
  }

  function weaponChip(it) {
    return `<span class="chip wchip" style="border-color:${I.color(it)};box-shadow:2px 2px 0 ${I.color(it)}" title="${I.displayName(it)}">${D.WEAPONS[it.base].icon} ${I.displayName(it)}</span>`;
  }

  function bruteSummaryHtml(brute) {
    const s = brute.stats;
    const e = C.effectiveStats(brute, curMeta);
    const weapons = brute.weapons.map(weaponChip).join('');
    const skills = brute.skills.map(it => chip(I.icon(it), I.displayName(it))).join('');
    const pets = brute.pets.map(it => chip(I.icon(it), I.displayName(it))).join('');
    return `<div class="brute-summary">
      <div class="bs-name">${brute.name} <span class="lvl">LV ${brute.level}</span></div>
      <div class="statline">
        ${statPill('❤️', 'HP', e.maxHp)}
        ${statPill('💪', 'STR', s.strength)}
        ${statPill('🤸', 'AGI', s.agility)}
        ${statPill('💨', 'SPD', s.speed)}
      </div>
      <div class="power">⚡ POWER ${C.powerRating(brute, curMeta)}</div>
      ${weapons ? `<div class="chips"><span class="chips-label">Weapons</span>${weapons}</div>` : ''}
      ${skills ? `<div class="chips"><span class="chips-label">Skills</span>${skills}</div>` : ''}
      ${pets ? `<div class="chips"><span class="chips-label">Pets</span>${pets}</div>` : ''}
    </div>`;
  }
  function statPill(icon, label, val) {
    return `<span class="stat-pill"><span class="sp-ico">${icon}</span><span class="sp-lbl">${label}</span><b>${val}</b></span>`;
  }
  function chip(icon, name) { return `<span class="chip" title="${name}">${icon} ${name}</span>`; }

  /* ---------------- stats grid (shared) ---------------- */
  function statsGridHtml(stats) {
    stats = stats || {};
    const total = (stats.wins || 0) + (stats.losses || 0);
    const winRate = total ? Math.round((stats.wins / total) * 100) : 0;
    const cells = D.STAT_DEFS.map(d =>
      `<div class="stat-cell"><span class="stat-ico">${d.icon}</span>
        <span class="stat-num">${fmt(stats[d.key] || 0)}</span>
        <span class="stat-key">${d.label}</span></div>`).join('');
    return `<div class="stat-cells">${cells}</div>
      <div class="stat-extra">Total fights: <b>${fmt(total)}</b> • Win rate: <b>${winRate}%</b></div>`;
  }
  function achvGlyph(key) {
    const wrap = inner => `<svg viewBox="0 0 24 24" class="cg" aria-hidden="true">${inner}</svg>`;
    switch (key) {
      case 'weapons': return craftGlyph('weapon', 'sword');
      case 'skills': return wrap(SCON.bolt);
      case 'pets': return craftGlyph('pet', 'wolf');
      case 'crown': return GICON.crown;
      case 'flame': return wrap(SCON.flame);
      case 'medal': return wrap(SCON.medal);
      case 'tower': return GICON.peak;
      case 'champion': return rankIcon('champion');
      case 'chevron': return GICON.chevron;
      case 'fist': return wrap(SCON.fist);
      case 'hammer': return wrap(SCON.hammer);
      case 'star': default: return GICON.star;
    }
  }
  function renderAchievements(list) {
    const el = $('#achv-content');
    if (!el) return;
    const done = list.filter(a => a.done).length;
    const card = a => {
      const pct = Math.min(100, (a.cur / a.target) * 100);
      return `<div class="achv${a.done ? ' done' : ''}">
        <div class="achv-top">
          <span class="achv-glyph">${achvGlyph(a.icon)}</span>
          <div class="achv-info">
            <div class="achv-head"><span class="achv-name">${a.label}</span>${a.done ? '<span class="achv-badge">DONE</span>' : ''}</div>
            <div class="achv-desc">${a.desc}</div>
          </div>
        </div>
        <div class="achv-bar"><div class="achv-fill" style="width:${pct}%"></div></div>
        <div class="achv-num">${fmt(Math.min(a.cur, a.target))} / ${fmt(a.target)}</div></div>`;
    };
    el.innerHTML = `
      <div class="col-bonus"><span class="cb-chip"><span class="cb-v">${done}/${list.length}</span><span class="cb-k">UNLOCKED</span></span></div>
      <div class="achv-grid">${list.map(card).join('')}</div>`;
  }

  /* ---------------- brute tab ---------------- */
  function renderBruteTab(brute, info) {
    const panel = $('#brute-card-panel');
    if (!panel) return;
    info = info || {};
    const e = C.effectiveStats(brute, curMeta);
    const need = C.xpForLevel(brute.level);
    const xpPct = Math.min(100, (brute.xp / need) * 100);
    const power = C.powerRating(brute, curMeta);
    const swords = `<svg viewBox="0 0 24 24" class="gicon" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 L15 5" stroke="#14110d" stroke-width="4.6"/><path d="M20 20 L9 5" stroke="#14110d" stroke-width="4.6"/><path d="M4 20 L15 5" stroke="#d4d8dd" stroke-width="2.4"/><path d="M20 20 L9 5" stroke="#d4d8dd" stroke-width="2.4"/></g></svg>`;
    const arena = info.arena;
    const pvp = info.pvp;
    const standings = `
      ${arena ? `<span class="gaunt-chip chip-rank"><span class="bc-medal">${rankIcon(arena.name)}</span><span class="gc-k">ARENA</span><span class="gc-v rank-v">${arena.name.toUpperCase()}</span></span>` : ''}
      <span class="gaunt-chip chip-best">${GICON.peak}<span class="gc-k">BEST FLOOR</span><span class="gc-v">${fmt(info.gauntletBest || 0)}</span></span>
      <span class="gaunt-chip chip-cp">${GICON.star}<span class="gc-k">PVP RATING</span><span class="gc-v">${pvp ? fmt(pvp.rating) : '—'}</span></span>`;

    panel.innerHTML = `
      <h3 class="comic-title">${brute.name} <span class="ct-sub">LV ${brute.level}</span></h3>
      <div class="gaunt-top brute-hero">
        <div class="brute-hero-id">
          <div class="bh-avatar">
            ${bruteAvatarHtml(brute, 'lg')}
            <button id="btn-reroll-look" class="reroll-look" title="Randomize this brute's appearance">
              <svg viewBox="0 0 24 24" class="rl-ico" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="#fff" stroke="#14110d" stroke-width="2"/><circle cx="9" cy="9" r="1.7" fill="#14110d"/><circle cx="15" cy="9" r="1.7" fill="#14110d"/><circle cx="12" cy="12" r="1.7" fill="#14110d"/><circle cx="9" cy="15" r="1.7" fill="#14110d"/><circle cx="15" cy="15" r="1.7" fill="#14110d"/></svg>
              RE-ROLL LOOK
            </button>
          </div>
          <div class="bh-power"><span class="bh-power-num">${fmt(power)}</span><span class="bh-power-lbl">POWER</span></div>
        </div>
        <div class="gaunt-stats">
          <span class="gaunt-chip chip-best">${swords}<span class="gc-k">RECORD</span><span class="gc-v">${brute.wins}-${brute.losses}</span></span>
        </div>
      </div>
      <div class="xpbar"><div class="xpbar-fill" style="width:${xpPct}%"></div>
        <span class="xpbar-text">${fmt(brute.xp)} / ${fmt(need)} XP</span></div>
      <div class="brute-sec"><span class="brute-sec-tag">STANDINGS</span></div>
      <div class="brute-standings">${standings}</div>
      <div class="brute-sec"><span class="brute-sec-tag">STATS</span></div>
      <div class="brute-tiles">
        ${statTile('HP', e.maxHp)}${statTile('STR', round(e.strength))}${statTile('AGI', round(e.agility))}${statTile('SPD', round(e.speed))}
      </div>
      <div class="brute-deriv">
        ${derivChip('CRIT', e.crit)}${derivChip('EVASION', e.evasion)}${derivChip('BLOCK', e.block)}${derivChip('COUNTER', e.counter)}${derivChip('COMBO', e.combo)}${derivChip('DMG RED', e.dmgReduction)}
      </div>
      <div class="brute-sec"><span class="brute-sec-tag">LOADOUT</span></div>
      ${loadoutComic(brute)}
      <div class="brute-sec"><span class="brute-sec-tag">CAREER RECORD</span></div>
      ${careerComic(brute.career)}`;
  }

  // ---- comic brute-card helpers ----
  function statTile(label, val) {
    return `<div class="btile"><span class="btile-v">${val}</span><span class="btile-k">${label}</span></div>`;
  }
  function derivChip(label, val) {
    return `<span class="bderiv"><b>${Math.round(val * 100)}%</b><span>${label}</span></span>`;
  }
  function loadoutComic(brute) {
    const lo = C.loadout(brute);
    const slot = (label, inst, fallback, sub) => {
      const col = inst ? I.color(inst) : 'var(--ink)';
      const main = inst
        ? `<span class="bslot-name" style="color:${col}">${I.displayName(inst)}</span><span class="bslot-rar" style="background:${col}">${I.rarityName(inst)}</span>`
        : `<span class="bslot-empty">${fallback}</span>`;
      return `<div class="bslot" style="border-color:${inst ? col : 'var(--ink)'}">
        <div class="bslot-lbl">${label}</div>
        <div class="bslot-main">${main}</div>
        ${sub ? `<div class="bslot-sub">${sub}</div>` : ''}</div>`;
    };
    const wSub = lo.weapon ? `${Math.round(I.stats(lo.weapon).dmg)} dmg` : 'unarmed';
    const pSub = lo.pet ? (() => { const s = I.petStats(lo.pet); return `${Math.round(s.hp)} HP / ${Math.round(s.strength)} STR`; })() : '';
    const skills = lo.skills.length
      ? lo.skills.map(s => `<span class="bskill" style="border-color:${I.color(s)};color:${I.color(s)}">${I.displayName(s)}</span>`).join('')
      : '<span class="bslot-empty">none equipped</span>';
    return `<div class="bloadout">
      ${slot('WEAPON', lo.weapon, 'Bare Fists', wSub)}
      ${slot('PET', lo.pet, 'No pet', pSub)}
      <div class="bslot bslot-skills"><div class="bslot-lbl">SKILLS</div><div class="bslot-skilllist">${skills}</div></div>
    </div>`;
  }
  function careerComic(stats) {
    stats = stats || {};
    const total = (stats.wins || 0) + (stats.losses || 0);
    const winRate = total ? Math.round((stats.wins / total) * 100) : 0;
    const cells = D.STAT_DEFS.map(d =>
      `<div class="bcareer-cell"><span class="bcareer-num">${fmt(stats[d.key] || 0)}</span><span class="bcareer-key">${d.label}</span></div>`).join('');
    return `<div class="bcareer">${cells}</div>
      <div class="bcareer-foot">Total fights <b>${fmt(total)}</b> · Win rate <b>${winRate}%</b></div>`;
  }

  // compact "what's equipped" summary
  function loadoutHtml(brute) {
    const lo = C.loadout(brute);
    const slot = (label, inst, fallback) => {
      const name = inst ? `<b style="color:${I.color(inst)}">${I.displayName(inst)}</b>` : `<span class="muted">${fallback}</span>`;
      return `<div class="lo-slot"><span class="lo-ico">${inst ? I.icon(inst) : '—'}</span><div><div class="lo-lbl">${label}</div><div>${name}</div></div></div>`;
    };
    const skills = lo.skills.length
      ? lo.skills.map(s => `<span class="lo-skill" title="${I.displayName(s)}">${I.icon(s)}</span>`).join('')
      : '<span class="muted small">none</span>';
    return `<h3 class="run-stats-head">🎒 LOADOUT</h3>
      <div class="loadout">
        ${slot('Weapon', lo.weapon, 'fists')}
        ${slot('Pet', lo.pet, 'none')}
        <div class="lo-slot"><span class="lo-ico">✨</span><div><div class="lo-lbl">Skills</div><div class="lo-skills">${skills}</div></div></div>
      </div>`;
  }
  function invInstance(it, kind, equipped) {
    const sub = kind === 'pet' ? (() => { const s = I.petStats(it); return `${Math.round(s.hp)} HP / ${Math.round(s.strength)} STR`; })()
      : kind === 'skill' ? ((D.SKILLS[it.base] || {}).desc || '')
      : (() => { const s = I.stats(it); return `${Math.round(s.dmg)} dmg • ⚡${s.power}`; })();
    const tag = `<span class="rar-tag" style="background:${I.color(it)}">${I.rarityName(it)}</span>`;
    const eqTag = equipped ? '<span class="eq-tag">equipped</span>' : '';
    return `<div class="inv-item ${equipped ? 'equipped' : ''}" style="border-color:${I.color(it)}"><span class="ii-ico">${I.icon(it)}</span>
      <div style="flex:1"><div class="ii-name" style="color:${I.color(it)}">${I.displayName(it)} ${tag} ${eqTag}</div>
      <div class="ii-sub">${sub}</div></div></div>`;
  }

  function bigStat(icon, label, eff, base) {
    const bonus = eff !== base ? `<span class="stat-bonus">(${base}+${round(eff - base)})</span>` : '';
    return `<div class="big-stat"><div class="bs-ico">${icon}</div>
      <div class="bs-val">${eff} ${bonus}</div><div class="bs-lbl">${label}</div></div>`;
  }
  function derived(label, val) { return `<span class="deriv"><b>${Math.round(val * 100)}%</b> ${label}</span>`; }
  function invItem(icon, name, sub) {
    return `<div class="inv-item"><span class="ii-ico">${icon}</span>
      <div><div class="ii-name">${name}</div><div class="ii-sub">${sub}</div></div></div>`;
  }
  function itemRow(it) {
    const s = I.stats(it);
    const aff = I.affixLines(it).map(a => `<span class="affix">${a}</span>`).join(' ');
    return `<div class="inv-item" style="border-color:${I.color(it)}"><span class="ii-ico">${D.WEAPONS[it.base].icon}</span>
      <div style="flex:1"><div class="ii-name" style="color:${I.color(it)}">${I.displayName(it)} <span class="rar-tag" style="background:${I.color(it)}">${I.rarityName(it)}</span></div>
      <div class="ii-sub">${Math.round(s.dmg)} dmg • ⚡${s.power}${aff ? ' — ' + aff : ''}</div></div></div>`;
  }

  /* ---------------- shop ---------------- */
  function renderShop(state, onBuy) {
    const list = $('#shop-list');
    list.innerHTML = '';
    for (const item of D.SHOP_ITEMS) {
      const owned = state.shop[item.id] || 0;
      const maxed = owned >= item.max;
      const cost = shopCost(item, owned);
      const card = document.createElement('div');
      card.className = 'shop-item' + (maxed ? ' maxed' : '');
      card.innerHTML = `
        <div class="si-ico">${item.icon}</div>
        <div class="si-body">
          <div class="si-name">${item.name} <span class="si-owned">${owned}/${item.max}</span></div>
          <div class="si-desc">${item.desc}</div>
          <div class="si-effect muted small">${item.effect}</div>
        </div>
        <button class="buy-btn ${maxed || state.gold < cost ? 'disabled' : ''}" ${maxed ? 'disabled' : ''}>
          ${maxed ? 'MAX' : '🪙 ' + fmt(cost)}
        </button>`;
      if (!maxed) card.querySelector('.buy-btn').addEventListener('click', () => onBuy(item, cost));
      list.appendChild(card);
    }
  }
  function shopCost(item, owned) { return Math.floor(item.baseCost * Math.pow(item.growth, owned)); }

  /* ---------------- legacy / ascension ---------------- */
  function renderLegacy(state, asc, h) {
    const el = $('#legacy-content');
    if (!el) return;
    const pct = asc.maxed ? 100 : Math.min(100, (asc.best / asc.req) * 100);
    const perksHtml = D.LEGACY_PERKS.map(p => {
      const owned = state.legacyPerks[p.id] || 0;
      const maxed = owned >= p.max;
      const cost = p.cost * (owned + 1);
      return `<div class="legacy-perk ${maxed ? 'maxed' : ''}">
        <div class="lp-body"><div class="lp-name">${p.name} <span class="si-owned">${owned}/${p.max}</span></div>
        <div class="si-desc">${p.desc}</div></div>
        <button class="buy-btn lp-buy ${maxed || state.legacy < cost ? 'disabled' : ''}" data-perk="${p.id}" ${maxed ? 'disabled' : ''}>
          ${maxed ? 'MAX' : costChip(cost, 'legacy')}</button>
      </div>`;
    }).join('');

    const ascBody = asc.maxed
      ? `<div class="gaunt-banner milestone">${GICON.crown}<span>MAX ASCENSION</span><span class="gb-sub">+${asc.powerNow}% power earned</span></div>`
      : `<div class="asc-readout">
           <span class="asc-need">Reach Gauntlet floor <b>${asc.req}</b> to ascend <span class="muted small">(best ${asc.best})</span></span>
           <span class="asc-reward">${costChip(asc.legacy, 'legacy')} <span class="muted small">+ permanent +${D.ASCENSION.powerPerTier * 100}% power</span></span>
         </div>
         <div class="train-bar"><div class="train-fill asc-fill${asc.ready ? ' full' : ''}" style="width:${pct}%"></div></div>
         <button id="btn-ascend" class="primary-btn gaunt-climb" ${asc.ready ? '' : 'disabled'}>ASCEND TO TIER ${asc.tier + 1}</button>`;

    el.innerHTML = `
      <div class="asc-top">
        <div class="asc-tier"><span class="asc-tier-n">${asc.tier}</span><span class="asc-tier-k">ASCENSION TIER</span></div>
        <span class="gaunt-chip chip-best">${GICON.chevron}<span class="gc-k">POWER</span><span class="gc-v">+${asc.powerNow}%</span></span>
        <span class="gaunt-chip chip-cp">${GICON.trophy}<span class="gc-k">LEGACY</span><span class="gc-v">${fmt(state.legacy)}</span></span>
      </div>
      ${ascBody}
      <div class="gaunt-rules"><span class="gr-tag">HOW IT WORKS</span><p>No resets — your brute is permanent. Push the Gauntlet to each threshold floor to Ascend: bank Legacy and a permanent global power boost, then spend Legacy on the upgrades below.</p></div>
      <div class="brute-sec"><span class="brute-sec-tag">LEGACY UPGRADES</span></div>
      <div class="legacy-perks">${perksHtml}</div>`;

    const ab = $('#btn-ascend');
    if (ab && asc.ready) ab.addEventListener('click', h.ascend);
    el.querySelectorAll('.lp-buy').forEach(b => { if (!b.disabled) b.addEventListener('click', () => h.buyPerk(b.dataset.perk)); });
  }

  /* ---------------- idle training (claimable stat bank) ---------------- */
  function renderTraining(banked, rate, cap, onClaim) {
    const el = $('#idle-rate');
    if (!el) return;
    banked = Math.floor(banked || 0);
    cap = Math.max(1, Math.floor(cap || 0));
    const pct = Math.min(100, (banked / cap) * 100);
    const full = banked >= cap;
    const has = banked > 0;
    el.innerHTML = `
      <p class="muted small">Your brute trains while you're away, banking XP up to a cap. Claim it here. Hire <b>Trainers</b> in the Shop to bank faster and raise the cap.</p>
      <div class="train-readout">
        <div class="train-xp"><span class="train-xp-num">${fmt(banked)}</span><span class="train-xp-lbl">/ ${fmt(cap)} XP</span></div>
        <span class="train-rate">${rate.toFixed(2)} XP/sec${full ? ' · FULL' : ''}</span>
      </div>
      <div class="train-bar"><div class="train-fill${full ? ' full' : ''}" style="width:${pct}%"></div></div>
      <button id="btn-claim-train" class="primary-btn gaunt-climb" ${has ? '' : 'disabled'}>CLAIM ${fmt(banked)} XP</button>`;
    const b = $('#btn-claim-train');
    if (b && has) b.addEventListener('click', onClaim);
  }

  /* ---------------- forge: target crafting ---------------- */
  // tiny inline cost icons (no emoji)
  const MINI = {
    gold:  `<svg viewBox="0 0 24 24" class="cc-ico"><circle cx="12" cy="12" r="9" fill="#ffce3a" stroke="#14110d" stroke-width="2.6"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#14110d" stroke-width="1.6" opacity=".5"/></svg>`,
    dust:  `<svg viewBox="0 0 24 24" class="cc-ico"><path d="M12 2 L13.8 9.5 L21 11.2 L13.8 13 L12 21 L10.2 13 L3 11.2 L10.2 9.5 Z" fill="#7fd8ff" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/></svg>`,
    shard: `<svg viewBox="0 0 24 24" class="cc-ico"><path d="M12 3 L20 9 L14.5 21 L4 14 Z" fill="#b06bff" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/></svg>`,
    legacy: `<svg viewBox="0 0 24 24" class="cc-ico"><path d="M7 4 H17 V8 C17 11 14.5 12.5 12 12.5 C9.5 12.5 7 11 7 8 Z" fill="#ffce3a" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M12 12.5 V16 M9 20 H15 L14 17 H10 Z" fill="#ffce3a" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/></svg>`,
  };
  function costChip(n, type) { return `<span class="cc">${MINI[type] || ''}${fmt(n)}</span>`; }
  let forgeFilter = 'weapon';   // which gear type the Forge is showing
  let _forgeArgs = null;        // cached for re-render on filter switch

  // per-item comic glyphs (inner SVG paths; craftGlyph wraps them)
  const WGLYPH = {
    knife: '<path d="M6 18 L15 9 L18 6 L18 9 L9 18 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M5 19 L8 16 L10 18 L7 21 Z" fill="#8a5a2b" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    sai: '<g stroke-linecap="round"><path d="M12 2 V13 M8 5 V10.5 M16 5 V10.5" stroke="#14110d" stroke-width="5"/><path d="M8 10.5 Q8 13 12 13 Q16 13 16 10.5" fill="none" stroke="#14110d" stroke-width="5"/><path d="M12 2 V13 M8 5 V10.5 M16 5 V10.5" stroke="#cfd4da" stroke-width="2.6"/><path d="M8 10.5 Q8 13 12 13 Q16 13 16 10.5" fill="none" stroke="#cfd4da" stroke-width="2.6"/></g><rect x="10.8" y="13" width="2.4" height="8" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6"/>',
    fan: '<path d="M12 20 L5 9 A8 8 0 0 1 19 9 Z" fill="#e0563f" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M12 20 L8.5 11 M12 20 L12 9.5 M12 20 L15.5 11" stroke="#14110d" stroke-width="1.4"/><circle cx="12" cy="20" r="1.5" fill="#14110d"/>',
    baton: '<rect x="4" y="11" width="16" height="3.6" rx="1.8" transform="rotate(-32 12 12.8)" fill="#2b2230" stroke="#14110d" stroke-width="2"/>',
    mug: '<rect x="6" y="6" width="9" height="13" rx="1.6" fill="#ffce3a" stroke="#14110d" stroke-width="2"/><rect x="6" y="6" width="9" height="3.4" fill="#fff" stroke="#14110d" stroke-width="2"/><path d="M15 9 H18 A2.4 2.4 0 0 1 18 14.5 H15" fill="none" stroke="#14110d" stroke-width="2"/>',
    fryingpan: '<circle cx="9.5" cy="13" r="6.2" fill="#3a3530" stroke="#14110d" stroke-width="2"/><rect x="15" y="11.4" width="7.5" height="3.2" rx="1.6" fill="#8a5a2b" stroke="#14110d" stroke-width="2"/>',
    club: '<path d="M5 19 L8.5 15.5 L17 7 C19.5 4.5 19.5 8.5 18.5 9.5 L9.5 18 C8.5 19 6 20 5 19 Z" fill="#8a5a2b" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    sword: '<path d="M5 19 L16 8 L19 5 L19 8 L8 19 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M3 16 L8 21" stroke="#ffce3a" stroke-width="3.4" stroke-linecap="round"/>',
    scimitar: '<path d="M5 20 C5 11 11 4 20 4 C16 9 15 15 10 20 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M4 19 L9 20 L8 15 Z" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6" stroke-linejoin="round"/>',
    whip: '<path d="M4 6 C11 5 12 11 7 12 C3 13 4 18 10 17 C15 16 18 18 20 20" fill="none" stroke="#8a5a2b" stroke-width="3.2" stroke-linecap="round"/><circle cx="4" cy="6" r="1.8" fill="#8a5a2b" stroke="#14110d" stroke-width="1.5"/>',
    trident: '<g stroke-linecap="round"><path d="M5 4 V9 M12 2.5 V9 M19 4 V9" stroke="#14110d" stroke-width="5"/><path d="M5 9 Q5 12 12 12 Q19 12 19 9" fill="none" stroke="#14110d" stroke-width="5"/><path d="M5 4 V9 M12 2.5 V9 M19 4 V9" stroke="#cfd4da" stroke-width="2.6"/><path d="M5 9 Q5 12 12 12 Q19 12 19 9" fill="none" stroke="#cfd4da" stroke-width="2.6"/></g><rect x="10.8" y="12" width="2.4" height="9" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6"/>',
    axe: '<rect x="10.6" y="3" width="2.6" height="18" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.8"/><path d="M13 4 C18.5 4 20.5 8.5 19 12.5 L13 11 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    morningstar: '<rect x="10.8" y="11" width="2.4" height="10" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6"/><path d="M12 1.5 V4 M12 10 V12.5 M5.5 7 H8 M16 7 H18.5 M7.4 2.4 L9.2 4.2 M16.6 2.4 L14.8 4.2 M7.4 11.6 L9.2 9.8 M16.6 11.6 L14.8 9.8" stroke="#14110d" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="4.3" fill="#8a8472" stroke="#14110d" stroke-width="2"/>',
    halberd: '<rect x="10.8" y="3" width="2.4" height="18" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6"/><path d="M12 1.5 L14.2 6 L12 5 L9.8 6 Z" fill="#cfd4da" stroke="#14110d" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 6 C17.5 6 19 9.5 17.8 12.5 L13 11 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    broadsword: '<path d="M9.6 2 L14.4 2 L13.4 14 L10.6 14 Z" fill="#cfd4da" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><rect x="6.5" y="13.6" width="11" height="2.6" rx="1" fill="#14110d"/><rect x="10.8" y="16" width="2.4" height="5" rx="1" fill="#8a5a2b" stroke="#14110d" stroke-width="1.6"/>',
    lightsaber: '<rect x="10.4" y="2" width="3.2" height="14" rx="1.6" fill="#5ec6ff" stroke="#14110d" stroke-width="2"/><rect x="9.8" y="15.5" width="4.4" height="5.5" rx="1.2" fill="#2b2230" stroke="#14110d" stroke-width="2"/><rect x="11.2" y="3.5" width="1.6" height="10" rx=".8" fill="#eafaff"/>',
  };
  const PGLYPH = {
    dog: '<ellipse cx="12" cy="14.5" rx="6" ry="5.3" fill="#cd9a5b" stroke="#14110d" stroke-width="2"/><path d="M6.5 8 L5 14 L9.5 12 Z" fill="#b07c43" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M17.5 8 L19 14 L14.5 12 Z" fill="#b07c43" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="14" r="1" fill="#14110d"/><circle cx="14" cy="14" r="1" fill="#14110d"/><circle cx="12" cy="16.5" r="1.4" fill="#14110d"/>',
    wolf: '<ellipse cx="12" cy="15" rx="5.6" ry="5" fill="#8a8f96" stroke="#14110d" stroke-width="2"/><path d="M6.5 6 L9.5 12.5 L5.5 12 Z" fill="#8a8f96" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M17.5 6 L14.5 12.5 L18.5 12 Z" fill="#8a8f96" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="14" r="1" fill="#14110d"/><circle cx="14" cy="14" r="1" fill="#14110d"/><path d="M12 16 L10.5 18 H13.5 Z" fill="#14110d"/>',
    panther: '<ellipse cx="12" cy="14.5" rx="5.8" ry="5.2" fill="#2b2230" stroke="#14110d" stroke-width="2"/><path d="M7 7.5 L9.5 12.5 L6 12 Z" fill="#2b2230" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M17 7.5 L14.5 12.5 L18 12 Z" fill="#2b2230" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><circle cx="10" cy="14" r="1.1" fill="#ffd23f"/><circle cx="14" cy="14" r="1.1" fill="#ffd23f"/>',
    bear: '<ellipse cx="12" cy="14.5" rx="7" ry="6" fill="#7a4a2b" stroke="#14110d" stroke-width="2"/><circle cx="6.5" cy="8" r="2.6" fill="#7a4a2b" stroke="#14110d" stroke-width="2"/><circle cx="17.5" cy="8" r="2.6" fill="#7a4a2b" stroke="#14110d" stroke-width="2"/><circle cx="9.5" cy="13.5" r="1" fill="#14110d"/><circle cx="14.5" cy="13.5" r="1" fill="#14110d"/><ellipse cx="12" cy="16.5" rx="2.4" ry="1.8" fill="#5a3420" stroke="#14110d" stroke-width="1.6"/><circle cx="12" cy="16" r=".8" fill="#14110d"/>',
  };
  const SCON = {
    dumbbell: '<rect x="9" y="10.4" width="6" height="3.2" fill="#8a8472" stroke="#14110d" stroke-width="2"/><rect x="3.5" y="7" width="4" height="10" rx="1.5" fill="#6b7077" stroke="#14110d" stroke-width="2"/><rect x="16.5" y="7" width="4" height="10" rx="1.5" fill="#6b7077" stroke="#14110d" stroke-width="2"/>',
    cat: '<path d="M6 9 L7 5 L10 8 H14 L17 5 L18 9 C19 11 19 17 12 18 C5 17 5 11 6 9 Z" fill="#8a8472" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><circle cx="9.5" cy="12" r="1" fill="#14110d"/><circle cx="14.5" cy="12" r="1" fill="#14110d"/>',
    bolt: '<path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" fill="#ffce3a" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    heart: '<path d="M12 21 C4 15 4 8 8 6 C10.5 4.7 12 7 12 7 C12 7 13.5 4.7 16 6 C20 8 20 15 12 21 Z" fill="#e0563f" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    brick: '<rect x="4" y="6" width="16" height="12" rx="1" fill="#b5562f" stroke="#14110d" stroke-width="2"/><path d="M4 12 H20 M12 6 V12 M8 12 V18 M16 12 V18" stroke="#14110d" stroke-width="1.6"/>',
    shield: '<path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z" fill="#3aa0d6" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    fist: '<path d="M6 12 V8.5 A1.5 1.5 0 0 1 9 8.5 V7.5 A1.5 1.5 0 0 1 12 7.5 A1.5 1.5 0 0 1 15 7.5 V8.5 A1.5 1.5 0 0 1 18 9.5 V15 A5 5 0 0 1 8 16 L6 13 Z" fill="#e0a06b" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    medal: '<path d="M9 2 L11 9 L8 9 Z M15 2 L16 9 L13 9 Z" fill="#e0563f" stroke="#14110d" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="14" r="5.5" fill="#ffce3a" stroke="#14110d" stroke-width="2"/><path d="M12 11 l1.1 2.3 2.6.3 -1.9 1.8 .5 2.5 -2.3-1.3 -2.3 1.3 .5-2.5 -1.9-1.8 2.6-.3 Z" fill="#fff" stroke="#14110d" stroke-width="1" stroke-linejoin="round"/>',
    swirl: '<path d="M12 4 A8 8 0 1 1 4 12" fill="none" stroke="#5ec6ff" stroke-width="3" stroke-linecap="round"/><path d="M4 12 L2.5 8.5 M4 12 L7.5 10.5" stroke="#5ec6ff" stroke-width="3" stroke-linecap="round"/>',
    eye: '<path d="M3 12 C7 6 17 6 21 12 C17 18 7 18 3 12 Z" fill="#fff" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="#3aa0d6" stroke="#14110d" stroke-width="1.6"/><circle cx="12" cy="12" r="1" fill="#14110d"/>',
    flame: '<path d="M12 2 C14 7 19 9 19 14 a7 7 0 0 1 -14 0 C5 10 9 9 9 5 C10.5 7 12 6 12 2 Z" fill="#ff7b00" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    hammer: '<rect x="4.5" y="5" width="11" height="6" rx="1.5" fill="#8a8472" stroke="#14110d" stroke-width="2"/><rect x="8.5" y="10" width="2.6" height="10" rx="1" transform="rotate(20 9.8 15)" fill="#8a5a2b" stroke="#14110d" stroke-width="1.8"/>',
    bomb: '<circle cx="11" cy="15" r="6" fill="#2b2230" stroke="#14110d" stroke-width="2"/><rect x="13" y="5" width="3" height="3" fill="#2b2230" stroke="#14110d" stroke-width="1.6"/><path d="M15 5 C17 3 19 4 19 6" fill="none" stroke="#ff7b00" stroke-width="2" stroke-linecap="round"/><circle cx="19" cy="6" r="1.4" fill="#ffce3a"/>',
    net: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="#14110d" stroke-width="2"/><path d="M12 3.5 V20.5 M3.5 12 H20.5 M6 6 L18 18 M18 6 L6 18" stroke="#14110d" stroke-width="1.4"/>',
    flask: '<path d="M10 3 H14 V8 L18 17 A2 2 0 0 1 16 20 H8 A2 2 0 0 1 6 17 L10 8 Z" fill="#8338ec" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><rect x="9.5" y="2" width="5" height="2" fill="#14110d"/>',
    wrench: '<path d="M16 4 A4.5 4.5 0 0 0 10 9 L4 15 A2.5 2.5 0 0 0 8 19 L14 13 A4.5 4.5 0 0 0 19 7 L16 9 L14 7 Z" fill="#8a8472" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
    hand: '<path d="M7 12 V7.5 A1.4 1.4 0 0 1 9.8 7.5 V6.5 A1.4 1.4 0 0 1 12.6 6.5 A1.4 1.4 0 0 1 15.4 6.8 V11 L17 9.5 A1.6 1.6 0 0 1 19 11.5 L15 17 A5 5 0 0 1 7 15 Z" fill="#e0a06b" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/>',
  };
  const SKILL_GLYPH = {
    herculean: 'dumbbell', feline: 'cat', lightning: 'bolt', vitality: 'heart', immortal: 'heart',
    toughened: 'brick', armor: 'shield', martial: 'fist', weaponmaster: 'medal', ballet: 'swirl',
    shield: 'shield', sixthsense: 'eye', hostility: 'flame', determination: 'flame', relentless: 'swirl',
    fierce: 'flame', hammer: 'hammer', bomb: 'bomb', net: 'net', potion: 'flask', sabotage: 'wrench', thief: 'hand',
  };
  function craftGlyph(kind, base) {
    let inner;
    if (kind === 'pet') inner = PGLYPH[base];
    else if (kind === 'skill') inner = SCON[SKILL_GLYPH[base] || ((D.SKILLS[base] || {}).kind === 'active' ? 'bolt' : 'shield')];
    else inner = WGLYPH[base];
    if (!inner) inner = SCON.medal;   // safe fallback
    return `<svg viewBox="0 0 24 24" class="cg" aria-hidden="true">${inner}</svg>`;
  }

  function renderCraft(shards, kind, target, h) {
    const el = $('#forge-craft');
    if (!el) return;
    kind = kind || 'weapon';
    const lists = { weapon: D.DROPPABLE_WEAPONS, pet: D.ALL_PETS, skill: D.ALL_SKILLS };
    const dicts = { weapon: D.WEAPONS, pet: D.PETS, skill: D.SKILLS };
    const list = (lists[kind] || lists.weapon).slice().sort((a, b) => a.tier - b.tier);
    const seg = (k, label) => `<button class="forge-seg${k === kind ? ' active' : ''}" data-cseg="${k}">${label}</button>`;
    const cards = list.map(o => {
      const cost = h.cost(kind, o.id);
      const sel = o.id === target;
      return `<button class="craft-card${sel ? ' sel' : ''}${shards >= cost ? ' ready' : ''}" data-cbase="${o.id}" title="${o.name} — T${o.tier}">
        <span class="craft-glyph">${craftGlyph(kind, o.id)}</span>
        <span class="craft-cname">${o.name}</span>
        <span class="craft-cfoot"><span class="craft-tier">T${o.tier}</span>${costChip(cost, 'shard')}</span>
      </button>`;
    }).join('');
    let detail;
    const dict = dicts[kind] || D.WEAPONS;
    if (target && dict[target]) {
      const cost = h.cost(kind, target);
      const pct = Math.min(100, (shards / cost) * 100);
      const ready = shards >= cost;
      detail = `
        <div class="craft-target">
          <div class="craft-info"><div class="craft-name">${dict[target].name}</div>
            <div class="muted small">Crafts at ${I.RARITY[D.CRAFT.minRarity].name}+ quality</div></div>
          <span class="craft-need">${costChip(cost, 'shard')}</span>
        </div>
        <div class="train-bar"><div class="train-fill craft-fill${ready ? ' full' : ''}" style="width:${pct}%"></div></div>
        <div class="craft-prog muted small">${costChip(Math.min(shards, cost), 'shard')} / ${fmt(cost)}</div>
        <button id="btn-craft" class="primary-btn gaunt-climb" ${ready ? '' : 'disabled'}>CRAFT ${dict[target].name.toUpperCase()}</button>`;
    } else {
      detail = '<p class="muted small">Pick a target above to bank shards toward it.</p>';
    }
    el.innerHTML = `
      <div class="forge-resbar"><span class="forge-res">${costChip(shards, 'shard')}<span class="fr-reslbl">SHARDS BANKED</span></span></div>
      <div class="forge-segs craft-segs">${seg('weapon', 'WEAPONS')}${seg('pet', 'PETS')}${seg('skill', 'SKILLS')}</div>
      <div class="craft-grid">${cards}</div>
      ${detail}`;
    el.querySelectorAll('[data-cseg]').forEach(b => b.addEventListener('click', () => h.setTarget(b.dataset.cseg, null)));
    el.querySelectorAll('[data-cbase]').forEach(b => b.addEventListener('click', () => h.setTarget(kind, b.dataset.cbase)));
    const cb = $('#btn-craft');
    if (cb && !cb.disabled) cb.addEventListener('click', h.craft);
  }

  /* ---------------- forge (weapons / pets / skills) ---------------- */
  function instSubline(it, kind) {
    if (kind === 'pet') { const s = I.petStats(it); return `${Math.round(s.hp)} HP · ${Math.round(s.strength)} STR · PWR ${s.power}`; }
    if (kind === 'skill') { const sk = D.SKILLS[it.base] || {}; return `${sk.kind === 'active' ? 'Active' : 'Passive'}${sk.desc ? ' · ' + sk.desc : ''}`; }
    const s = I.stats(it); return `${Math.round(s.dmg)} dmg · PWR ${s.power}`;
  }
  // count how many fuse pairs are currently available in a list
  function countFusable(list) {
    let pairs = 0; const used = {};
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (!used[j] && I.canFuse(list[i], list[j])) { pairs++; used[i] = used[j] = true; break; }
      }
    }
    return pairs;
  }
  function forgeRow(it, kind, dust, gold, eq, list) {
    const col = I.color(it);
    const equipped = kind === 'skill' ? (eq.skills || []).includes(it.uid) : (kind === 'pet' ? eq.pet === it.uid : eq.weapon === it.uid);
    const equipAct = kind === 'skill' ? 'toggleSkill' : (kind === 'pet' ? 'equipPet' : 'equipWeapon');
    const upCost = I.upgradeCost(it), rrCost = I.rerollCost(it), fuCost = I.fuseDustCost(it), deVal = I.disenchantValue(it);
    const canRR = I.canReroll(it);
    const hasPartner = list.some(o => o.uid !== it.uid && I.canFuse(it, o));
    const aff = I.affixLines(it).map(a => `<span class="fr-affix">${a}</span>`).join('');
    const lvl = it.level ? `<span class="fr-lvl">+${it.level}</span>` : '';
    const eqLabel = equipped ? (kind === 'skill' ? 'UNEQUIP' : 'EQUIPPED') : 'EQUIP';
    const catLbl = kind === 'skill' ? D.SKILL_CAT_NAMES[D.skillCatOf(it.base)]
      : kind === 'pet' ? 'Companion'
      : (D.CAT_NAMES[(D.WEAPONS[it.base] || {}).cat] || '');
    return `<div class="forge-row${equipped ? ' equipped' : ''}" style="border-left-color:${col}">
      <div class="fr-main">
        <div class="fr-name" style="color:${col}">${I.displayName(it)}${lvl}<span class="fr-rar" style="background:${col}">${I.rarityName(it)}</span>${catLbl ? `<span class="fr-cat">${catLbl}</span>` : ''}</div>
        <div class="fr-sub">${instSubline(it, kind)}</div>
        ${aff ? `<div class="fr-affixes">${aff}</div>` : ''}
      </div>
      <div class="fr-acts">
        <button class="forge-btn eq${equipped ? ' on' : ''}" data-act="${equipAct}" data-uid="${it.uid}" ${equipped && kind !== 'skill' ? 'disabled' : ''}>${eqLabel}</button>
        <button class="forge-btn" data-act="upgrade" data-uid="${it.uid}" ${gold < upCost ? 'disabled' : ''} title="Upgrade to +${(it.level || 0) + 1}">UP ${costChip(upCost, 'gold')}</button>
        <button class="forge-btn" data-act="reroll" data-uid="${it.uid}" ${(dust < rrCost || !canRR) ? 'disabled' : ''} title="Reroll bonuses">RR ${costChip(rrCost, 'dust')}</button>
        <button class="forge-btn" data-act="fuse" data-uid="${it.uid}" ${(dust < fuCost || !hasPartner) ? 'disabled' : ''} title="${hasPartner ? 'Fuse with a duplicate' : 'Need another same-rarity copy'}">FUSE ${costChip(fuCost, 'dust')}</button>
        <button class="forge-btn de" data-act="disenchant" data-uid="${it.uid}" ${equipped ? 'disabled' : ''} title="Scrap for dust + shards">SCRAP ${costChip(deVal, 'dust')}</button>
      </div></div>`;
  }
  function renderForge(brute, dust, gold, h) {
    _forgeArgs = [brute, dust, gold, h];
    const el = $('#forge-list');
    if (!el) return;
    const eq = brute.equipped || { weapon: null, pet: null, skills: [] };
    const slots = h.skillSlots || 3;
    const lists = { weapon: brute.weapons, pet: brute.pets, skill: brute.skills };
    if (!lists[forgeFilter]) forgeFilter = 'weapon';
    const list = lists[forgeFilter];
    const fusable = countFusable(list);
    const seg = (k, label) => `<button class="forge-seg${k === forgeFilter ? ' active' : ''}" data-seg="${k}">${label}<span class="seg-n">${lists[k].length}</span></button>`;
    const empty = { weapon: 'No weapons yet — win some loot!', pet: 'No pets yet.', skill: 'No skills yet.' }[forgeFilter];
    // equipped first, then strongest
    const isEq = it => forgeFilter === 'skill' ? (eq.skills || []).includes(it.uid) : forgeFilter === 'pet' ? eq.pet === it.uid : eq.weapon === it.uid;
    const rankVal = it => forgeFilter === 'pet' ? I.petStats(it).power
      : forgeFilter === 'skill' ? (I.rarityRank(it.rarity) * 100 + (it.level || 0))
      : I.stats(it).power;
    const sorted = list.slice().sort((a, b) => (isEq(b) ? 1 : 0) - (isEq(a) ? 1 : 0) || rankVal(b) - rankVal(a));
    const rows = list.length
      ? sorted.map(it => forgeRow(it, forgeFilter, dust, gold, eq, list)).join('')
      : `<p class="muted small forge-empty">${empty}</p>`;
    el.innerHTML = `
      <div class="forge-bar">
        <div class="forge-segs">${seg('weapon', 'WEAPONS')}${seg('pet', 'PETS')}${seg('skill', 'SKILLS')}</div>
        <span class="forge-res forge-res-dust">${costChip(dust, 'dust')}<span class="fr-reslbl">DUST</span></span>
      </div>
      <div class="forge-tools">
        <button class="forge-tool" data-act="autoEquip" title="Equip your highest-power weapon, pet & skills">MAX POWER</button>
        <button class="forge-tool" data-act="autoMerge" data-kind="${forgeFilter}" ${fusable ? '' : 'disabled'} title="Fuse every duplicate ${forgeFilter}">AUTO-MERGE${fusable ? `<span class="seg-n">${fusable}</span>` : ''}</button>
        ${forgeFilter === 'skill' ? `<span class="forge-slotnote">${(eq.skills || []).length}/${slots} slots</span>` : ''}
      </div>
      <div class="forge-rows">${rows}</div>`;
    el.querySelectorAll('.forge-seg').forEach(b => b.addEventListener('click', () => {
      forgeFilter = b.dataset.seg;
      if (_forgeArgs) renderForge.apply(null, _forgeArgs);
    }));
    el.querySelectorAll('.forge-tool').forEach(b => { if (!b.disabled) b.addEventListener('click', () => h[b.dataset.act](b.dataset.kind)); });
    el.querySelectorAll('.forge-btn').forEach(b => { if (!b.disabled) b.addEventListener('click', () => h[b.dataset.act](b.dataset.uid)); });
  }

  /* ---------------- arena rank ---------------- */
  function renderArenaRank(info) {
    const el = $('#arena-rank');
    if (!el || !info) return;
    const pct = info.isTop ? 100 : Math.min(100, (info.into / info.band) * 100);
    const next = info.isTop ? null : D.ARENA.divisions[info.idx + 1];
    const progHtml = info.isTop
      ? `<div class="gaunt-banner milestone">${GICON.crown}<span>TOP DIVISION</span><span class="gb-sub">keep stacking ARP</span></div>`
      : `<div class="ar-next">
           <span class="gaunt-pill mile-pill">${GICON.flag}<span>NEXT</span><b>${next.toUpperCase()}</b></span>
           <div class="ar-barwrap">
             <div class="ar-bar"><div class="ar-fill" style="width:${pct}%"></div></div>
             <span class="ar-barlabel">${info.into} / ${info.band} ARP</span>
           </div>
         </div>`;
    el.innerHTML = `
      <div class="gaunt-top">
        <div class="ar-divline">
          <span class="ar-medal">${rankIcon(info.name)}</span>
          <div class="gaunt-floor ar-divname">${info.name.toUpperCase()}</div>
        </div>
        <div class="gaunt-stats">
          <span class="gaunt-chip chip-best">${GICON.chevron}<span class="gc-k">ARP</span><span class="gc-v">${fmt(info.arp)}</span></span>
        </div>
      </div>
      ${progHtml}
      <div class="gaunt-rules"><span class="gr-tag">HOW IT WORKS</span><p>Win ranked fights to bank ARP and climb divisions; lose and you shed some. Opponent power scales with your division, and the higher you sit the bigger the payouts.</p></div>`;
  }

  /* ---------------- gauntlet ---------------- */
  // small inked comic glyphs (no emoji)
  const GICON = {
    peak:  `<svg viewBox="0 0 24 24" class="gicon"><path d="M2 21 L9 6 L13 14 L16 9 L22 21 Z" fill="var(--pop-yellow)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/><path d="M9 6 L11 9 L8 10 Z" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    flag:  `<svg viewBox="0 0 24 24" class="gicon"><path d="M6 3 V22" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round"/><path d="M6 4 H19 L15.5 8.5 L19 13 H6 Z" fill="var(--pop-green,#2bb673)" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
    crown: `<svg viewBox="0 0 24 24" class="gicon"><path d="M3 18 L4.5 7 L9 12 L12 4.5 L15 12 L19.5 7 L21 18 Z" fill="var(--pop-yellow)" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/><rect x="3" y="17.5" width="18" height="3.5" rx="1" fill="var(--ink)"/></svg>`,
    star:  `<svg viewBox="0 0 24 24" class="gicon"><path d="M12 2.5 L14.7 9 L21.5 9.6 L16.3 14 L18 20.7 L12 17 L6 20.7 L7.7 14 L2.5 9.6 L9.3 9 Z" fill="#fff" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
    bolt:  `<svg viewBox="0 0 24 24" class="gicon"><path d="M13 2 L4 14 H11 L10 22 L20 9 H13 Z" fill="var(--pop-orange)" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" class="gicon"><path d="M12 3 L21 11 H16 L12 7.5 L8 11 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/><path d="M12 11 L21 19 H16 L12 15.5 L8 19 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/></svg>`,
    trophy: `<svg viewBox="0 0 24 24" class="gicon"><path d="M6.5 3 H17.5 V7.5 C17.5 11 15 13 12 13 C9 13 6.5 11 6.5 7.5 Z" fill="#ffce3a" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M6.5 4.5 H3.5 V6.5 C3.5 8.8 5.3 9.8 6.9 9.8" fill="none" stroke="#14110d" stroke-width="2" stroke-linecap="round"/><path d="M17.5 4.5 H20.5 V6.5 C20.5 8.8 18.7 9.8 17.1 9.8" fill="none" stroke="#14110d" stroke-width="2" stroke-linecap="round"/><path d="M12 13 V16.5" stroke="#14110d" stroke-width="2"/><path d="M8.5 21 H15.5 L14.5 17 H9.5 Z" fill="#ffce3a" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/></svg>`,
  };

  /* ---- procedural comic rank badges (replaces the AI medal PNGs) ---- */
  const RANK_META = {
    rookie:   { metal: '#9aa0a8', emblem: 'pip'   },
    bronze:   { metal: '#cd7f32', emblem: 'star'  },
    silver:   { metal: '#cdd3d9', emblem: 'star'  },
    gold:     { metal: '#ffce3a', emblem: 'star'  },
    platinum: { metal: '#86e4d6', emblem: 'star2' },
    diamond:  { metal: '#5ec6ff', emblem: 'gem'   },
    champion: { metal: '#ff5a5f', emblem: 'crown' },
  };
  const RANK_EMBLEM = {
    // all centered on (24,19)
    pip:   `<circle cx="24" cy="19" r="4.4" fill="#fff" stroke="#14110d" stroke-width="1.5"/>`,
    star:  `<path d="M24 11 l2.2 4.7 5.1 .5 -3.8 3.4 1.1 5 -4.6-2.7 -4.6 2.7 1.1-5 -3.8-3.4 5.1-.5 Z" fill="#fff" stroke="#14110d" stroke-width="1.4" stroke-linejoin="round"/>`,
    star2: `<path d="M24 10 l1.9 4 4.4 .4 -3.3 2.9 1 4.3 -4-2.3 -4 2.3 1-4.3 -3.3-2.9 4.4-.4 Z" fill="#fff" stroke="#14110d" stroke-width="1.3" stroke-linejoin="round"/><circle cx="16.5" cy="25" r="2" fill="#fff" stroke="#14110d" stroke-width="1.1"/><circle cx="31.5" cy="25" r="2" fill="#fff" stroke="#14110d" stroke-width="1.1"/>`,
    gem:   `<g stroke="#14110d" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"><path d="M18 13 H30 L34 18 L24 28 L14 18 Z" fill="#eafaff"/><path d="M14 18 H34 M18 13 L24 28 M30 13 L24 28" fill="none"/></g>`,
    crown: `<g stroke="#14110d" stroke-width="1.6" stroke-linejoin="round"><path d="M13 25 L15 12 L19.5 18.5 L24 10 L28.5 18.5 L33 12 L35 25 Z" fill="#ffd23f"/><rect x="13" y="24" width="22" height="3.4" rx="1.2" fill="#14110d"/></g>`,
  };
  function rankIcon(name) {
    const k = (name || '').toLowerCase();
    const d = RANK_META[k] || RANK_META.rookie;
    return `<svg viewBox="0 0 48 48" class="rankglyph" aria-hidden="true">
      <path d="M17 27 L13 45 L21 40 L24 46 L27 40 L35 45 L31 27 Z" fill="#b23a2e" stroke="#14110d" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="24" cy="19" r="14.5" fill="${d.metal}" stroke="#14110d" stroke-width="3"/>
      <circle cx="24" cy="19" r="10.5" fill="none" stroke="#14110d" stroke-width="1.4" opacity=".4"/>
      ${RANK_EMBLEM[d.emblem]}
    </svg>`;
  }
  function renderGauntlet(g, onClimb, enabled, settings) {
    const el = $('#gauntlet-content');
    if (!el) return;
    settings = settings || {};
    const nextBoss = (g.floor % D.GAUNTLET.bossEvery) === 0;
    const isMilestone = (g.floor % D.GAUNTLET.milestoneEvery) === 0;
    const toBoss = D.GAUNTLET.bossEvery - ((g.floor - 1) % D.GAUNTLET.bossEvery);
    const toMilestone = D.GAUNTLET.milestoneEvery - ((g.floor - 1) % D.GAUNTLET.milestoneEvery);
    const bannerHtml = isMilestone
      ? `<div class="gaunt-banner milestone">${GICON.star}<span>MILESTONE FLOOR</span><span class="gb-sub">bonus Legacy, loot &amp; dust</span></div>`
      : nextBoss
        ? `<div class="gaunt-banner boss">${GICON.crown}<span>BOSS FLOOR</span><span class="gb-sub">guaranteed rare loot</span></div>`
        : `<div class="gaunt-prog">
             <span class="gaunt-pill boss-pill">${GICON.crown}<span>BOSS IN</span><b>${toBoss}</b></span>
             <span class="gaunt-pill mile-pill">${GICON.star}<span>MILESTONE IN</span><b>${toMilestone}</b></span>
           </div>`;
    el.innerHTML = `
      <div class="gaunt-top">
        <div class="gaunt-floor">FLOOR <b>${g.floor}</b></div>
        <div class="gaunt-stats">
          <span class="gaunt-chip chip-best">${GICON.peak}<span class="gc-k">BEST</span><span class="gc-v">${g.best}</span></span>
          <span class="gaunt-chip chip-cp">${GICON.flag}<span class="gc-k">CHECKPOINT</span><span class="gc-v">${g.checkpoint || 1}</span></span>
        </div>
      </div>
      ${bannerHtml}
      <div class="gaunt-rules"><span class="gr-tag">HOW IT WORKS</span><p>The tower scales forever. Win to climb; fall and you drop to your last boss checkpoint. No stamina, your power is the only gate.</p></div>
      <div class="gaunt-controls">
        <button id="btn-climb" class="primary-btn gaunt-climb" ${enabled ? '' : 'disabled'}>${nextBoss ? 'FIGHT THE BOSS' : 'CLIMB FLOOR ' + g.floor}</button>
        <label class="switch"><input type="checkbox" id="gaunt-auto" ${settings.autoClimb ? 'checked' : ''} /><span class="switch-track"></span><span class="switch-label">AUTO</span></label>
        <label class="switch"><input type="checkbox" id="gaunt-fast" ${settings.fastFight ? 'checked' : ''} /><span class="switch-track"></span><span class="switch-label">FAST</span></label>
      </div>`;
    const btn = $('#btn-climb');
    if (btn && enabled) btn.addEventListener('click', () => onClimb(false));
  }

  /* ---------------- bounties ---------------- */
  function rewardText(r) {
    const parts = [];
    if (r.gold) parts.push(`🪙 ${fmt(r.gold)}`);
    if (r.dust) parts.push(`✦ ${r.dust}`);
    if (r.legacy) parts.push(`🏆 ${r.legacy}`);
    return parts.join(' • ');
  }
  function renderBounties(bounties, h) {
    const el = $('#bounties-content');
    if (!el) return;
    const timer = $('#bounty-timer');
    if (timer && bounties) {
      const ms = (bounties.lastRefresh + D.BOUNTIES.refreshHours * 3600000) - Date.now();
      if (ms > 0) {
        const hrs = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
        timer.textContent = `↻ rotates in ${hrs > 0 ? hrs + 'h ' : ''}${mins}m`;
      } else timer.textContent = '↻ rotating…';
    }
    if (!bounties || !bounties.list.length) { el.innerHTML = '<p class="muted">No bounties yet.</p>'; return; }
    el.innerHTML = bounties.list.map((b, i) => {
      if (!b) return '';
      const pct = Math.min(100, (b.progress / b.target) * 100);
      const canReroll = !b.done && h.rerollDust >= D.BOUNTIES.rerollCost;
      return `<div class="bounty ${b.done ? 'done' : ''}">
        <div class="bounty-head">
          <span class="bounty-ico">${b.icon}</span>
          <div class="bounty-body">
            <div class="bounty-desc">${b.desc}</div>
            <div class="bounty-reward muted small">Reward: ${rewardText(b.reward)}</div>
          </div>
        </div>
        <div class="bounty-bar"><div class="bounty-fill" style="width:${pct}%"></div>
          <span class="bounty-count">${Math.min(b.progress, b.target)} / ${b.target}</span></div>
        <div class="bounty-btns">
          ${b.done
            ? `<button class="primary-btn bounty-claim" data-idx="${i}">✅ CLAIM</button>`
            : `<button class="forge-btn" data-act="reroll" data-idx="${i}" ${canReroll ? '' : 'disabled'}>🎲 Reroll<small>✦${D.BOUNTIES.rerollCost}</small></button>`}
        </div></div>`;
    }).join('');
    el.querySelectorAll('.bounty-claim').forEach(b => b.addEventListener('click', () => h.claim(+b.dataset.idx)));
    el.querySelectorAll('[data-act="reroll"]').forEach(b => { if (!b.disabled) b.addEventListener('click', () => h.reroll(+b.dataset.idx)); });
  }

  /* ---------------- collection + masteries ---------------- */
  function renderCollection(state) {
    const el = $('#collection-content');
    if (!el) return;
    const col = state.collection, M = D.MASTERY, CB = D.COLLECTION;
    const RANKS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const rcolor = r => (I.RARITY[RANKS[r]] || I.RARITY.common).color;
    const rname = r => (I.RARITY[RANKS[r]] || I.RARITY.common).name;
    const cgWrap = inner => `<svg viewBox="0 0 24 24" class="cg" aria-hidden="true">${inner}</svg>`;
    const wHave = D.DROPPABLE_WEAPONS.filter(w => w.id in col.weapons).length;
    const sHave = D.ALL_SKILLS.filter(s => s.id in col.skills).length;
    const pHave = D.ALL_PETS.filter(p => p.id in col.pets).length;
    // rarity-scaled collection bonus
    const sumR = bucket => Object.keys(bucket).reduce((a, id) => a + (1 + CB.rarityScale * (bucket[id] || 0)), 0);
    const dmgPct = Math.round(sumR(col.weapons) * CB.perWeapon * 100);
    const hpPct = Math.round(sumR(col.skills) * CB.perSkill * 100);

    const cell = (kind, it, bucket, catLbl) => {
      const have = it.id in bucket;
      const rank = have ? (bucket[it.id] || 0) : 0;
      const rc = have ? rcolor(rank) : 'var(--ink)';
      return `<div class="col-cell ${have ? 'got' : 'miss'}" style="${have ? `border-color:${rc}` : ''}" title="${have ? it.name + ' — best ' + rname(rank) : it.name + ' (locked)'}">
        <span class="col-glyph">${craftGlyph(kind, it.id)}</span>
        <span class="col-cname">${have ? it.name : '???'}</span>
        <span class="col-cat">${catLbl}</span>
        ${have ? `<span class="col-rar" style="background:${rc}">${rname(rank)}</span>` : ''}</div>`;
    };
    const wGrid = D.DROPPABLE_WEAPONS.map(w => cell('weapon', w, col.weapons, D.CAT_NAMES[w.cat] || w.cat)).join('');
    const sGrid = D.ALL_SKILLS.map(s => cell('skill', s, col.skills, D.SKILL_CAT_NAMES[D.skillCatOf(s.id)])).join('');
    const pGrid = D.ALL_PETS.map(p => cell('pet', p, col.pets, 'Companion')).join('');
    const head = (label, have, total) => `<div class="col-head"><span class="col-tag">${label}</span>${total !== '' ? `<span class="col-count">${have}/${total}</span>` : ''}</div>`;

    const bar = xp => { let l = 0; while (l < M.maxLevel && (xp || 0) >= M.xpForLevel(l + 1)) l++; const need = M.xpForLevel(l + 1), prev = M.xpForLevel(l); return { l, pct: l >= M.maxLevel ? 100 : (need > prev ? Math.min(100, ((xp - prev) / (need - prev)) * 100) : 0) }; };
    const mRow = (glyph, name, xp, bonus) => { const b = bar(xp); return `<div class="mastery-row"><span class="m-glyph">${glyph}</span><div class="m-main"><div class="m-name">${name} <b>LV ${b.l}</b> <span class="muted small">${bonus(b.l)}</span></div><div class="train-bar"><div class="train-fill" style="width:${b.pct}%"></div></div></div></div>`; };
    const wRep = { fist: cgWrap(SCON.fist), blade: craftGlyph('weapon', 'sword'), blunt: craftGlyph('weapon', 'club'), axe: craftGlyph('weapon', 'axe'), spear: craftGlyph('weapon', 'trident') };
    const wMast = M.weaponCats.map(c => mRow(wRep[c], D.CAT_NAMES[c] || c, (state.masteries || {})[c] || 0, l => `+${Math.round(l * M.dmgPerLevel * 100)}% dmg`)).join('');
    const pMast = D.ALL_PETS.map(p => mRow(craftGlyph('pet', p.id), p.name, (state.petMast || {})[p.id] || 0, l => `+${Math.round(l * M.petPerLevel * 100)}% pet dmg`)).join('');
    const sRep = { brawn: cgWrap(SCON.dumbbell), guard: cgWrap(SCON.shield), swift: cgWrap(SCON.bolt), arts: cgWrap(SCON.flask) };
    const sMast = D.SKILL_CATS.map(c => { const sb = M.skillBonus[c]; return mRow(sRep[c], D.SKILL_CAT_NAMES[c], (state.skillMast || {})[c] || 0, l => `+${Math.round(l * sb.per * 100)}% ${sb.label}`); }).join('');

    el.innerHTML = `
      <div class="col-bonus">
        <span class="cb-chip"><span class="cb-v">+${dmgPct}%</span><span class="cb-k">GLOBAL DAMAGE</span></span>
        <span class="cb-chip"><span class="cb-v">+${hpPct}%</span><span class="cb-k">MAX HP</span></span>
      </div>
      ${head('WEAPONS', wHave, D.DROPPABLE_WEAPONS.length)}<div class="col-grid">${wGrid}</div>
      ${head('SKILLS', sHave, D.ALL_SKILLS.length)}<div class="col-grid">${sGrid}</div>
      ${head('PETS', pHave, D.ALL_PETS.length)}<div class="col-grid">${pGrid}</div>
      ${head('WEAPON MASTERIES', '', '')}<div class="mastery-list">${wMast}</div>
      ${head('PET MASTERIES', '', '')}<div class="mastery-list">${pMast}</div>
      ${head('SKILL MASTERIES', '', '')}<div class="mastery-list">${sMast}</div>`;
  }

  /* ---------------- level-up modal ---------------- */
  function showLevelUp(level, choices, onPick) {
    const modal = $('#levelup-modal');
    $('#levelup-title').textContent = `LEVEL ${level}!`;
    const box = $('#levelup-choices');
    box.innerHTML = '';
    choices.forEach((ch, i) => {
      const el = document.createElement('button');
      el.className = 'choice rar-' + ch.rarity;
      el.style.animationDelay = (i * 60) + 'ms';
      el.innerHTML = `
        <div class="choice-ico">${ch.icon}</div>
        <div class="choice-title">${ch.title}</div>
        <div class="choice-desc">${ch.desc}</div>
        <div class="choice-rar">${ch.rarity}</div>`;
      el.addEventListener('click', () => { modal.classList.add('hidden'); onPick(ch); });
      box.appendChild(el);
    });
    modal.classList.remove('hidden');
  }
  function isModalOpen() { return !$('#levelup-modal').classList.contains('hidden'); }

  /* ============================================================
   * BATTLE REPLAY
   * ============================================================ */
  // show the player's brute idling in the stage when no fight is happening
  function showIdleBrute(brute) {
    if (!brute) return;
    cancelReplay();              // make sure no replay is mid-flight
    fighters = {};
    const left = $('#slot-left'), right = $('#slot-right');
    if (!left) return;
    left.innerHTML = `<div class="unit is-brute"><div class="unit-name">${brute.name}</div><div class="fighter-rig" data-rig="idle"></div></div>`;
    if (right) right.innerHTML = '';
    const stage = $('#arena-stage'); if (stage) stage.classList.add('is-idle');
    const vs = document.querySelector('#arena-stage .vs-badge'); if (vs) vs.style.display = 'none';
    const ov = $('#arena-overlay'); if (ov) ov.classList.add('hidden');
    const rig = document.querySelector('[data-rig="idle"]');
    const lo = C.loadout ? C.loadout(brute) : null;
    if (rig && global.Fighter) fighters.idle = new global.Fighter(rig, brute, 'right', (lo && lo.weapon) || null);
  }

  function setupArena(result, leftBrute, rightBrute) {
    const start = result.events.find(e => e.type === 'start');
    const stage = $('#arena-stage'); if (stage) stage.classList.remove('is-idle');
    const vs = document.querySelector('#arena-stage .vs-badge'); if (vs) vs.style.display = '';
    $('#slot-left').innerHTML = renderTeam(start.left);
    $('#slot-right').innerHTML = renderTeam(start.right);
    const unitEls = {};
    $$('#arena-stage .unit').forEach(el => { unitEls[el.dataset.uid] = el; });
    // power badges under each brute (player uses meta bonuses; opponent doesn't)
    addPowerBadge('#slot-left', leftBrute, curMeta);
    addPowerBadge('#slot-right', rightBrute, null);
    // mount articulated fighters for the brutes
    fighters = {};
    start.left.forEach(u => mountFighter(u, leftBrute, 'right'));
    start.right.forEach(u => mountFighter(u, rightBrute, 'left'));
    return unitEls;
  }

  function addPowerBadge(slotSel, brute, bonuses) {
    if (!brute || !C.powerRating) return;
    const u = document.querySelector(slotSel + ' .is-brute');
    const name = u && u.querySelector('.unit-name');
    if (!name) return;
    const p = C.powerRating(brute, bonuses || {});
    name.insertAdjacentHTML('afterend', `<div class="unit-power">PWR ${fmt(p)}</div>`);
  }

  function mountFighter(u, brute, facing) {
    const rig = document.querySelector('[data-rig="' + u.id + '"]');
    if (!rig) return;
    if (u.type === 'brute') {
      const lo = C.loadout ? C.loadout(brute) : null;
      if (global.Fighter) fighters[u.id] = new global.Fighter(rig, brute, facing, (lo && lo.weapon) || null);
    } else if (global.PetFighter) {
      const lo = C.loadout ? C.loadout(brute) : null;
      const petRarity = (lo && lo.pet && lo.pet.base === u.petId) ? lo.pet.rarity : 'common';
      fighters[u.id] = new global.PetFighter(rig, u.petId, facing, petRarity);
    }
  }

  function renderTeam(roster) {
    return roster.map(u => {
      const isBrute = u.type === 'brute';
      const body = isBrute
        ? `<div class="fighter-rig" data-rig="${u.id}"></div>`
        : `<div class="pet-rig" data-rig="${u.id}"></div>`;
      return `<div class="unit ${isBrute ? 'is-brute' : 'is-pet'}" data-uid="${u.id}">
        <div class="unit-name">${u.name}</div>
        <div class="hpbar"><div class="hpbar-ghost" style="width:100%"></div><div class="hpbar-fill" style="width:100%"></div><span class="hpbar-txt">${u.hp}</span></div>
        ${body}
      </div>`;
    }).join('');
  }

  function catOf(wid) {
    if (!wid || wid === 'fist') return 'fist';
    return (global.FighterCat && global.FighterCat[wid]) || 'blade';
  }

  function updateHp(unitEls, uid, hp, maxHp) {
    const el = unitEls[uid];
    if (!el) return;
    const fill = el.querySelector('.hpbar-fill');
    const ghost = el.querySelector('.hpbar-ghost');
    const txt = el.querySelector('.hpbar-txt');
    const pct = Math.max(0, (hp / maxHp) * 100);
    fill.style.width = pct + '%';
    if (ghost) ghost.style.width = pct + '%';
    fill.style.background = pct > 50 ? 'linear-gradient(180deg,#3ce06a,#1faa4c)'
      : pct > 22 ? 'linear-gradient(180deg,#ffd23f,#e0a800)'
      : 'linear-gradient(180deg,#ff5a5a,#c1121f)';
    if (txt) txt.textContent = Math.max(0, Math.round(hp));
  }

  /* --- FX positioning --- */
  function unitPoint(unitEls, uid) {
    const el = unitEls[uid];
    const stage = $('#arena-stage');
    if (!el || !stage) return null;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - s.left,
      y: r.top + r.height * 0.42 - s.top,
      w: s.width, h: s.height,
    };
  }

  function spawnImpact(unitEls, uid, word, kind) {
    const p = unitPoint(unitEls, uid);
    if (!p) return;
    const layer = $('#fx-layer');
    const imp = document.createElement('div');
    const big = kind === 'ko' || kind === 'bomb';
    imp.className = 'impact' + (big ? ' big' : '');
    const colors = { crit: 'var(--pop-yellow)', counter: 'var(--pop-purple)', block: 'var(--pop-blue)',
      miss: '#fff', ko: 'var(--pop-red)', bomb: 'var(--pop-orange)', heal: 'var(--pop-green)' };
    imp.style.setProperty('--burst', colors[kind] || 'var(--pop-yellow)');
    imp.style.setProperty('--rot', (Math.random() * 24 - 12).toFixed(1) + 'deg');
    imp.style.left = p.x + 'px';
    imp.style.top = p.y + 'px';
    imp.innerHTML = `<span class="word">${word}</span>`;
    layer.appendChild(imp);
    setTimeout(() => imp.remove(), 720);
  }

  function spawnNumber(unitEls, uid, text, cls) {
    const p = unitPoint(unitEls, uid);
    if (!p) return;
    const layer = $('#fx-layer');
    const n = document.createElement('div');
    n.className = 'dmg-pop ' + (cls || '');
    n.textContent = text;
    n.style.left = (p.x + (Math.random() * 24 - 12)) + 'px';
    n.style.top = (p.y - 6) + 'px';
    layer.appendChild(n);
    setTimeout(() => n.remove(), 860);
  }

  function spawnSpecks(unitEls, uid, count) {
    const p = unitPoint(unitEls, uid);
    if (!p) return;
    const layer = $('#fx-layer');
    for (let i = 0; i < count; i++) {
      const sp = document.createElement('div');
      sp.className = 'speck';
      const ang = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 46;
      sp.style.left = p.x + 'px';
      sp.style.top = p.y + 'px';
      sp.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
      sp.style.setProperty('--ty', Math.sin(ang) * dist + 'px');
      layer.appendChild(sp);
      setTimeout(() => sp.remove(), 600);
    }
  }

  // expanding explosion ring at a unit (bombs, big skills)
  function spawnBurst(unitEls, uid) {
    const p = unitPoint(unitEls, uid);
    if (!p) return;
    const b = document.createElement('div');
    b.className = 'fx-burst';
    b.style.left = p.x + 'px';
    b.style.top = p.y + 'px';
    $('#fx-layer').appendChild(b);
    setTimeout(() => b.remove(), 520);
  }
  // briefly flash a fighter's body (rage/heal/tangle auras)
  function fighterFlash(uid, cls, ms) {
    const f = fighters[uid];
    if (!f || !f.svg) return;
    f.svg.classList.add(cls);
    setTimeout(() => { if (f.svg) f.svg.classList.remove(cls); }, ms || 500);
  }

  function speedlinesAt(unitEls, uid) {
    const p = unitPoint(unitEls, uid);
    const sl = $('#speedlines');
    if (!p || !sl) return;
    sl.style.setProperty('--ox', (p.x / p.w * 100).toFixed(1) + '%');
    sl.style.setProperty('--oy', (p.y / p.h * 100).toFixed(1) + '%');
    sl.classList.remove('active'); void sl.offsetWidth; sl.classList.add('active');
    setTimeout(() => sl.classList.remove('active'), 240);
  }

  function shakeStage(big) {
    const st = $('#arena-stage');
    const cls = big ? 'shake-lg' : 'shake-sm';
    st.classList.remove('shake-sm', 'shake-lg'); void st.offsetWidth; st.classList.add(cls);
    setTimeout(() => st.classList.remove(cls), big ? 340 : 220);
  }

  function logLine(text, cls) {
    const log = $('#combat-log');
    const line = document.createElement('div');
    line.className = 'log-line ' + (cls || '');
    line.innerHTML = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  function teamOf(uid) { return uid[0] === 'L' ? 'left' : 'right'; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* Replay a battle. The master clock is a plain setTimeout chain so it
   * can never stall; fighter animations are TRIGGERED (fire-and-forget)
   * and the contact FX fire via each move's onContact callback. This
   * decouples the logic timeline from the visual animation layer. */
  function replayBattle(result, leftBrute, rightBrute, fast) {
    const myToken = ++replayToken;
    curTS = fast ? 0.5 : 1;
    if (global.setFighterTimeScale) global.setFighterTimeScale(curTS);
    const unitEls = setupArena(result, leftBrute, rightBrute);
    $('#combat-log').innerHTML = '';
    $('#fx-layer').innerHTML = '';
    $('#arena-overlay').classList.add('hidden');
    const ts = curTS;
    const events = result.events;
    const cancelled = () => myToken !== replayToken;

    /* --- combat-log builders (emoji-free, fighter-colored, punchy) --- */
    const startEv = events.find(e => e.type === 'start');
    const uName = {};
    if (startEv) (startEv.left || []).concat(startEv.right || []).forEach(u => { uName[u.id] = u.name; });
    const stripFx = s => (s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
    const nm = uid => `<span class="cl-name ${teamOf(uid) === 'left' ? 'you' : 'foe'}">${uName[uid] || '?'}</span>`;
    const dmgChip = (n, crit) => `<b class="cl-dmg${crit ? ' crit' : ''}">-${n}</b>`;
    // tag = the consistent comic label; side colors the line by who acted
    function clog(tag, tagCls, html, srcUid, lineCls) {
      const side = srcUid ? (teamOf(srcUid) === 'left' ? 'cl-l' : 'cl-r') : '';
      logLine(`<span class="cl-tag cl-${tagCls}">${tag}</span><span class="cl-msg">${html}</span>`, [lineCls || '', side].join(' ').trim());
    }

    /* --- pet (non-rig) motion --- */
    function petAttack(uid, onContact) {
      const el = unitEls[uid];
      if (!el) { setTimeout(() => !cancelled() && onContact && onContact(), 120 * ts); return; }
      const dir = teamOf(uid) === 'left' ? 1 : -1;
      el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${34 * dir}px) scale(1.08)` }, { transform: 'translateX(0)' }],
        { duration: 300 * ts, easing: 'ease-out' });
      setTimeout(() => { if (!cancelled()) onContact && onContact(); }, 150 * ts);
    }
    function petReact(uid, kind) {
      const el = unitEls[uid];
      if (!el) return;
      const dir = teamOf(uid) === 'left' ? 1 : -1;
      if (kind === 'dodge') el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-28 * dir}px) translateY(-12px)` }, { transform: 'translateX(0)' }], { duration: 340 * ts, easing: 'ease-in-out' });
      else el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-16 * dir}px) rotate(${-4 * dir}deg)` }, { transform: 'translateX(0)' }], { duration: 280 * ts, easing: 'ease-out' });
    }
    function attackerAct(srcUid, cat, onContact) {
      const f = fighters[srcUid];
      if (f) f.attack(cat, onContact);   // fire-and-forget; attack fires onContact at the swing
      else petAttack(srcUid, onContact);
    }
    function react(uid, type) {
      const f = fighters[uid];
      if (f) { if (type === 'block') f.block(); else if (type === 'dodge') f.dodge(); else f.hurt(); }
      else petReact(uid, type === 'dodge' ? 'dodge' : 'hurt');
    }
    function willDraw(uid, cat) {
      const f = fighters[uid];
      return f && cat !== 'fist' && f.currentCat !== cat;
    }

    // handle one event: trigger visuals, return the unscaled ms until the next event
    function handle(ev) {
      switch (ev.type) {
        case 'start': {
          const lb = (ev.left || []).find(u => u.type === 'brute');
          const rb = (ev.right || []).find(u => u.type === 'brute');
          if (lb && rb) clog('VS', 'vs', `${nm(lb.id)} vs ${nm(rb.id)}`, null, 'cl-start');
          return 320;
        }

        case 'hit':
        case 'counter': {
          const max = findUnitMax(result, ev.target);
          const cat = catOf(ev.weapon);
          const isF = !!fighters[ev.source];
          attackerAct(ev.source, cat, () => {
            if (cancelled()) return;
            shakeStage(ev.crit || ev.dmg >= 28);
            updateHp(unitEls, ev.target, ev.hp, max);
            speedlinesAt(unitEls, ev.target);
            spawnSpecks(unitEls, ev.target, ev.crit ? 9 : 5);
            spawnNumber(unitEls, ev.target, '-' + ev.dmg, ev.crit ? 'crit' : ev.type === 'counter' ? 'counter' : ev.blocked ? 'blocked' : '');
            let word, kind;
            if (ev.crit) { word = 'CRIT!'; kind = 'crit'; }
            else if (ev.type === 'counter') { word = 'COUNTER!'; kind = 'counter'; }
            else if (ev.blocked) { word = 'KLANG!'; kind = 'block'; }
            else if (ev.kind === 'bomb') { word = 'BLAM!'; kind = 'bomb'; }
            else { word = pick(POW_WORDS); kind = 'pow'; }
            spawnImpact(unitEls, ev.target, word, kind);
            if (ev.lifeheal > 0 && ev.sourceHp != null) {
              updateHp(unitEls, ev.source, ev.sourceHp, findUnitMax(result, ev.source));
              spawnNumber(unitEls, ev.source, '+' + ev.lifeheal, 'heal');
            }
            react(ev.target, ev.blocked ? 'block' : 'hurt');
          });
          let tag = 'HIT', tcls = 'hit', verb = 'hits', line = '';
          if (ev.crit) { tag = 'CRIT'; tcls = 'crit'; verb = 'crits'; line = 'crit'; }
          else if (ev.type === 'counter') { tag = 'CTR'; tcls = 'counter'; verb = 'counters'; line = 'counter'; }
          else if (ev.kind === 'reflect') { tag = 'RFLCT'; tcls = 'counter'; verb = 'reflects onto'; }
          else if (ev.kind === 'bomb') { tag = 'BOOM'; tcls = 'bomb'; verb = 'blasts'; }
          else if (ev.blocked) { tag = 'BLOCK'; tcls = 'block'; }
          clog(tag, tcls,
            `${nm(ev.source)} ${verb} ${nm(ev.target)} ${dmgChip(ev.dmg, ev.crit)}${ev.blocked ? ' <span class="cl-note">blocked</span>' : ''}`,
            ev.source, line);
          let d = isF ? (willDraw(ev.source, cat) ? 760 : 540) : 360;
          if (ev.crit) d += 120;
          return d;
        }

        case 'miss': {
          const cat = catOf(ev.weapon);
          attackerAct(ev.source, cat, () => { if (!cancelled()) spawnImpact(unitEls, ev.source, 'WHIFF!', 'miss'); });
          clog('MISS', 'miss', `${nm(ev.source)} misses`, ev.source);
          return fighters[ev.source] ? (willDraw(ev.source, cat) ? 700 : 480) : 340;
        }

        case 'evade': {
          const cat = catOf(ev.weapon);
          attackerAct(ev.source, cat, () => {
            if (cancelled()) return;
            spawnImpact(unitEls, ev.target, 'DODGE!', 'miss');
            react(ev.target, 'dodge');
          });
          clog('DODGE', 'miss', `${nm(ev.target)} dodges ${nm(ev.source)}`, ev.target);
          return fighters[ev.source] ? (willDraw(ev.source, cat) ? 700 : 480) : 340;
        }

        case 'skill': {
          const s = ev.source, t = ev.target;
          const phrase = {
            bomb: `${nm(s)} hurls a bomb`, fierce: `${nm(s)} enters a rage`, hammer: `${nm(s)} readies a hammer`,
            net: `${nm(s)} nets ${nm(t)}`, potion: `${nm(s)} drinks a potion`, sabotage: `${nm(s)} sabotages ${nm(t)}`,
            thief: `${nm(s)} steals from ${nm(t)}`, disarm: `${nm(s)} disarms ${nm(t)}`,
          }[ev.skill] || stripFx(ev.text);
          clog('SKILL', 'skill', phrase, s);
          const f = fighters[ev.source];
          switch (ev.skill) {
            case 'bomb':
              if (f && f.throwGesture) f.throwGesture();
              setTimeout(() => {
                if (cancelled() || !ev.source) return;
                shakeStage(true); spawnBurst(unitEls, ev.source); spawnSpecks(unitEls, ev.source, 8);
                spawnImpact(unitEls, ev.source, 'KABOOM!', 'bomb');
              }, 200 * ts);
              return 560;
            case 'fierce':
              fighterFlash(ev.source, 'f-rage', 650 * ts);
              if (ev.source) { speedlinesAt(unitEls, ev.source); spawnImpact(unitEls, ev.source, 'RAGE!', 'crit'); }
              return 380;
            case 'hammer':
              if (ev.source) spawnImpact(unitEls, ev.source, 'SMASH!', 'bomb');
              return 320;
            case 'net':
              if (f && f.throwGesture) f.throwGesture();
              setTimeout(() => {
                if (cancelled() || !ev.target) return;
                spawnImpact(unitEls, ev.target, 'NET!', 'counter'); fighterFlash(ev.target, 'f-tangle', 480 * ts);
              }, 200 * ts);
              return 520;
            case 'potion':
              if (ev.hp != null && ev.source) updateHp(unitEls, ev.source, ev.hp, findUnitMax(result, ev.source));
              fighterFlash(ev.source, 'f-heal', 650 * ts);
              if (ev.source) { spawnImpact(unitEls, ev.source, 'GULP!', 'heal'); spawnNumber(unitEls, ev.source, 'HEAL', 'heal'); }
              return 380;
            case 'sabotage':
              if (ev.target) { spawnImpact(unitEls, ev.target, 'SABOTAGE!', 'counter'); spawnSpecks(unitEls, ev.target, 5); }
              return 320;
            case 'thief':
              if (ev.target) spawnImpact(unitEls, ev.target, 'SWIPE!', 'counter');
              return 300;
            case 'disarm':
              if (ev.target) { spawnImpact(unitEls, ev.target, 'DISARMED!', 'counter'); spawnSpecks(unitEls, ev.target, 4); }
              return 260;
            default:
              if (ev.target) spawnSpecks(unitEls, ev.target, 4);
              return 220;
          }
        }

        case 'combo':
          clog('COMBO', 'combo', `${nm(ev.source)} chains another strike`, ev.source);
          return 110;

        case 'stun':
          spawnImpact(unitEls, ev.source || ev.target, 'STUN!', 'counter');
          clog('STUN', 'stun', ev.target ? `${nm(ev.source)} stuns ${nm(ev.target)}` : `${nm(ev.source)} is stunned`, ev.source || ev.target);
          return 220;
        case 'immobilized':
          spawnImpact(unitEls, ev.source || ev.target, 'STUN!', 'counter');
          clog('NET', 'stun', `${nm(ev.source)} is immobilized`, ev.source);
          return 220;

        case 'death': {
          const f = fighters[ev.source];
          if (f) f.die();
          else { const el = unitEls[ev.source]; if (el) el.classList.add('dead'); }
          shakeStage(true);
          spawnSpecks(unitEls, ev.source, 12);
          spawnImpact(unitEls, ev.source, 'K.O.!', 'ko');
          clog('K.O.', 'ko', `${nm(ev.source)} is DOWN`, ev.source, 'death');
          return 520;
        }

        case 'timeout':
          clog('TIME', 'time', stripFx(ev.text), null);
          return 160;
        case 'end': return 0;
      }
      return 60;
    }

    return new Promise((resolve) => {
      let i = 0;
      function step() {
        if (cancelled()) { resolve(false); return; }
        if (i >= events.length) { resolve(true); return; }
        const ev = events[i++];
        const d = handle(ev);
        setTimeout(step, Math.max(20, d * ts));
      }
      step();
    });
  }

  function findUnitMax(result, uid) {
    const snap = result.events[result.events.length - 1].snapshot;
    if (snap && snap[uid]) return snap[uid].maxHp;
    return 100;
  }

  function showOutcome(win, rewards) {
    const ov = $('#arena-overlay');
    ov.className = 'arena-overlay ' + (win ? 'victory' : 'defeat');
    ov.innerHTML = `<div class="outcome">
      <div class="outcome-title">${win ? 'VICTORY!' : 'DEFEAT!'}</div>
      <div class="outcome-rewards">${rewards || ''}</div>
    </div>`;
    ov.classList.remove('hidden');
    shakeStage(true);
  }

  function cancelReplay() { replayToken++; }

  /* ---------------- helpers ---------------- */
  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return '' + n;
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  function round(n) { return Math.round(n); }

  global.UI = {
    toast, renderTopbar, showScreen, initTabs, updateFightView,
    renderCreatePreview, renderBruteTab, renderShop, shopCost,
    renderLegacy, renderTraining,
    renderForge, renderCraft, renderArenaRank, renderGauntlet, renderBounties, renderCollection, renderAchievements, setMeta, rankIcon,
    showLevelUp, isModalOpen,
    replayBattle, showOutcome, cancelReplay, showIdleBrute,
    bruteSummaryHtml, fmt,
  };
})(window);
