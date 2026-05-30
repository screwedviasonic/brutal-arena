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
  function initTabs() {
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.tabpane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        $('#tab-' + tab.dataset.tab).classList.add('active');
      });
    });
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
    const skills = brute.skills.map(id => chip(D.SKILLS[id].icon, D.SKILLS[id].name)).join('');
    const pets = brute.pets.map(id => chip(D.PETS[id].icon, D.PETS[id].name)).join('');
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

  /* ---------------- brute tab ---------------- */
  function renderBruteTab(brute) {
    const e = C.effectiveStats(brute, curMeta);
    const s = brute.stats;
    const need = C.xpForLevel(brute.level);
    const xpPct = Math.min(100, (brute.xp / need) * 100);

    $('#brute-card-panel').innerHTML = `
      <div class="brute-hero">
        ${bruteAvatarHtml(brute, 'xl')}
        <div>
          <div class="bs-name big">${brute.name}</div>
          <div class="lvl-badge">LEVEL ${brute.level}</div>
          <div class="record">🏅 ${brute.wins}W / ${brute.losses}L</div>
          <div class="power big">⚡ POWER ${C.powerRating(brute, curMeta)}</div>
        </div>
      </div>
      <div class="xpbar"><div class="xpbar-fill" style="width:${xpPct}%"></div>
        <span class="xpbar-text">${fmt(brute.xp)} / ${fmt(need)} XP</span></div>
      <div class="statgrid">
        ${bigStat('❤️', 'Max HP', e.maxHp, s.hp)}
        ${bigStat('💪', 'Strength', round(e.strength), s.strength)}
        ${bigStat('🤸', 'Agility', round(e.agility), s.agility)}
        ${bigStat('💨', 'Speed', round(e.speed), s.speed)}
      </div>
      <div class="derived">
        ${derived('Crit', e.crit)} ${derived('Evasion', e.evasion)}
        ${derived('Block', e.block)} ${derived('Counter', e.counter)}
        ${derived('Combo', e.combo)} ${derived('Dmg Reduce', e.dmgReduction)}
      </div>`;

    const weaponsHtml = brute.weapons.length
      ? brute.weapons.map(itemRow).join('')
      : '<p class="muted small">No weapons yet — fists only.</p>';
    const skillsHtml = brute.skills.length
      ? brute.skills.map(id => invItem(D.SKILLS[id].icon, D.SKILLS[id].name, D.SKILLS[id].desc)).join('')
      : '<p class="muted small">No skills yet.</p>';
    const petsHtml = brute.pets.length
      ? brute.pets.map(id => invItem(D.PETS[id].icon, D.PETS[id].name, `${D.PETS[id].hp} HP / ${D.PETS[id].strength} STR`)).join('')
      : '<p class="muted small">No pets yet.</p>';

    $('#brute-inventory-panel').innerHTML = `
      <h3>⚔️ Weapons</h3><div class="inv-list">${weaponsHtml}</div>
      <h3>✨ Skills</h3><div class="inv-list">${skillsHtml}</div>
      <h3>🐾 Pets</h3><div class="inv-list">${petsHtml}</div>`;
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

  /* ---------------- legacy ---------------- */
  function renderLegacy(state, brute, onRetire, onBuyPerk) {
    const el = $('#legacy-content');
    const payout = legacyPayout(brute);
    let perksHtml = D.LEGACY_PERKS.map(p => {
      const owned = state.legacyPerks[p.id] || 0;
      const maxed = owned >= p.max;
      const cost = p.cost * (owned + 1);
      return `<div class="legacy-perk ${maxed ? 'maxed' : ''}">
        <div class="lp-body"><div class="lp-name">${p.name} <span class="si-owned">${owned}/${p.max}</span></div>
        <div class="si-desc">${p.desc}</div></div>
        <button class="buy-btn lp-buy ${maxed || state.legacy < cost ? 'disabled' : ''}" data-perk="${p.id}" ${maxed ? 'disabled' : ''}>
          ${maxed ? 'MAX' : '🏆 ' + cost}</button>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="legacy-intro">
        <p>Retire your current brute to earn <b>Legacy</b> points based on the level reached. Spend them on permanent bloodline perks that make every <i>future</i> brute stronger from birth.</p>
        <div class="retire-box">
          <div>Retiring <b>${brute.name}</b> (Lv ${brute.level}) yields <b class="big-num">🏆 ${payout}</b> legacy.</div>
          <button id="btn-retire" class="danger-btn">⚰️ RETIRE &amp; START NEW BRUTE</button>
        </div>
      </div>
      <h3>BLOODLINE PERKS</h3>
      <div class="legacy-perks">${perksHtml}</div>`;

    $('#btn-retire').addEventListener('click', onRetire);
    el.querySelectorAll('.lp-buy').forEach(b => { if (!b.disabled) b.addEventListener('click', () => onBuyPerk(b.dataset.perk)); });
  }
  function legacyPayout(brute) { return Math.floor(Math.pow(brute.level, 1.35) + brute.wins * 0.5); }

  /* ---------------- idle ---------------- */
  function renderIdle(rate) {
    $('#idle-rate').innerHTML = rate > 0
      ? `<span class="idle-glow">+${rate} XP / SEC</span> <span class="muted small">while training</span>`
      : `<span class="muted">Hire Trainers in the Shop to earn idle XP.</span>`;
  }

  /* ---------------- forge ---------------- */
  function renderForge(brute, dust, gold, h) {
    const el = $('#forge-list');
    if (!el) return;
    const dd = $('#forge-dust'); if (dd) dd.textContent = fmt(dust);
    el.innerHTML = brute.weapons.map(it => {
      const s = I.stats(it);
      const upCost = I.upgradeCost(it), rrCost = I.rerollCost(it), fuCost = I.fuseDustCost(it), deVal = I.disenchantValue(it);
      const aff = I.affixLines(it).map(a => `<span class="affix">${a}</span>`).join(' ') || '<span class="muted small">no affixes</span>';
      return `<div class="forge-item" style="border-color:${I.color(it)}">
        <div class="fi-head"><span class="ii-ico">${D.WEAPONS[it.base].icon}</span>
          <div><div class="ii-name" style="color:${I.color(it)}">${I.displayName(it)}</div>
          <div class="ii-sub">${I.rarityName(it)} • ${Math.round(s.dmg)} dmg • ⚡${s.power}</div></div></div>
        <div class="fi-affixes">${aff}</div>
        <div class="fi-btns">
          <button class="forge-btn" data-act="upgrade" data-uid="${it.uid}" ${gold < upCost ? 'disabled' : ''}>⚒️ +${(it.level || 0) + 1}<small>🪙${fmt(upCost)}</small></button>
          <button class="forge-btn" data-act="reroll" data-uid="${it.uid}" ${(dust < rrCost || !it.affixes.length) ? 'disabled' : ''}>🎲 Reroll<small>✦${rrCost}</small></button>
          <button class="forge-btn" data-act="fuse" data-uid="${it.uid}" ${dust < fuCost ? 'disabled' : ''}>✨ Fuse<small>✦${fuCost}</small></button>
          <button class="forge-btn de" data-act="disenchant" data-uid="${it.uid}">♻️ Scrap<small>+✦${deVal}</small></button>
        </div></div>`;
    }).join('') || '<p class="muted">No weapons to forge yet — win some loot!</p>';
    el.querySelectorAll('.forge-btn').forEach(b => {
      if (b.disabled) return;
      b.addEventListener('click', () => h[b.dataset.act](b.dataset.uid));
    });
  }

  /* ---------------- gauntlet ---------------- */
  function renderGauntlet(g, onClimb, enabled) {
    const el = $('#gauntlet-content');
    if (!el) return;
    const nextBoss = (g.floor % D.GAUNTLET.bossEvery) === 0;
    const toBoss = D.GAUNTLET.bossEvery - ((g.floor - 1) % D.GAUNTLET.bossEvery);
    el.innerHTML = `
      <div class="gaunt-top">
        <div class="gaunt-floor">FLOOR <b>${g.floor}</b></div>
        <div class="gaunt-best">🏔️ Best ${g.best} &nbsp; 🚩 Checkpoint ${g.checkpoint || 1}</div>
      </div>
      <div class="gaunt-next ${nextBoss ? 'boss' : ''}">${nextBoss ? '👑 BOSS FLOOR — guaranteed rare loot' : 'Next boss in ' + toBoss + ' floor' + (toBoss > 1 ? 's' : '')}</div>
      <p class="muted small">The Gauntlet scales forever. Win to climb; fall and you drop to your last boss checkpoint. Costs no stamina — your power is the only gate.</p>
      <button id="btn-climb" class="primary-btn" ${enabled ? '' : 'disabled'}>${nextBoss ? '⚔️ FIGHT THE BOSS' : '⬆️ CLIMB FLOOR ' + g.floor}</button>`;
    const btn = $('#btn-climb');
    if (btn && enabled) btn.addEventListener('click', onClimb);
  }

  /* ---------------- collection + masteries ---------------- */
  function renderCollection(state, mLevels) {
    const el = $('#collection-content');
    if (!el) return;
    const col = state.collection;
    const wHave = D.DROPPABLE_WEAPONS.filter(w => col.weapons[w.id]).length;
    const sHave = Object.keys(col.skills).length;
    const pHave = Object.keys(col.pets).length;
    function grid(items, have, iconOf, nameOf) {
      return items.map(it => `<div class="col-cell ${have[it.id] ? 'got' : 'miss'}" title="${nameOf(it)}${have[it.id] ? '' : ' (locked)'}">${iconOf(it)}</div>`).join('');
    }
    const wGrid = grid(D.DROPPABLE_WEAPONS, col.weapons, w => w.icon, w => w.name);
    const sGrid = grid(D.ALL_SKILLS, col.skills, s => s.icon, s => s.name);
    const pGrid = grid(D.ALL_PETS, col.pets, p => p.icon, p => p.name);
    const mastHtml = D.WEAPON_CATS.map(cat => {
      const lvl = mLevels[cat] || 0, xp = state.masteries[cat] || 0;
      const need = D.MASTERY.xpForLevel(lvl + 1), prev = D.MASTERY.xpForLevel(lvl);
      const pctv = need > prev ? Math.min(100, ((xp - prev) / (need - prev)) * 100) : 100;
      return `<div class="mastery-row"><div class="m-name">${D.CAT_NAMES[cat]} <b>Lv ${lvl}</b> <span class="muted small">+${Math.round(lvl * D.MASTERY.dmgPerLevel * 100)}% dmg</span></div>
        <div class="m-bar"><div class="m-fill" style="width:${pctv}%"></div></div></div>`;
    }).join('');
    el.innerHTML = `
      <div class="col-bonuses">Collection bonus: <b>+${Math.round(wHave * D.COLLECTION.perWeapon * 100)}%</b> global damage • <b>+${Math.round(sHave * D.COLLECTION.perSkill * 100)}%</b> max HP</div>
      <h3>⚔️ Weapons <span class="muted small">${wHave}/${D.DROPPABLE_WEAPONS.length}</span></h3><div class="col-grid">${wGrid}</div>
      <h3>✨ Skills <span class="muted small">${sHave}/${D.ALL_SKILLS.length}</span></h3><div class="col-grid">${sGrid}</div>
      <h3>🐾 Pets <span class="muted small">${pHave}/${D.ALL_PETS.length}</span></h3><div class="col-grid">${pGrid}</div>
      <h3>🎖️ Weapon Masteries</h3><div class="mastery-list">${mastHtml}</div>`;
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
  function setupArena(result, leftBrute, rightBrute) {
    const start = result.events.find(e => e.type === 'start');
    $('#slot-left').innerHTML = renderTeam(start.left);
    $('#slot-right').innerHTML = renderTeam(start.right);
    const unitEls = {};
    $$('#arena-stage .unit').forEach(el => { unitEls[el.dataset.uid] = el; });
    // mount articulated fighters for the brutes
    fighters = {};
    start.left.forEach(u => mountFighter(u, leftBrute, 'right'));
    start.right.forEach(u => mountFighter(u, rightBrute, 'left'));
    return unitEls;
  }

  function mountFighter(u, brute, facing) {
    const rig = document.querySelector('[data-rig="' + u.id + '"]');
    if (!rig) return;
    if (u.type === 'brute') {
      if (global.Fighter) fighters[u.id] = new global.Fighter(rig, brute, facing);
    } else if (global.PetFighter) {
      fighters[u.id] = new global.PetFighter(rig, u.petId, facing);
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
        case 'start': return 320;

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
          logLine(logIcon(ev) + ev.text, ev.crit ? 'crit' : ev.type === 'counter' ? 'counter' : '');
          let d = isF ? (willDraw(ev.source, cat) ? 760 : 540) : 360;
          if (ev.crit) d += 120;
          return d;
        }

        case 'miss': {
          const cat = catOf(ev.weapon);
          attackerAct(ev.source, cat, () => { if (!cancelled()) spawnImpact(unitEls, ev.source, 'WHIFF!', 'miss'); });
          logLine(`<span class="muted">${ev.text}</span>`);
          return fighters[ev.source] ? (willDraw(ev.source, cat) ? 700 : 480) : 340;
        }

        case 'evade': {
          const cat = catOf(ev.weapon);
          attackerAct(ev.source, cat, () => {
            if (cancelled()) return;
            spawnImpact(unitEls, ev.target, 'DODGE!', 'miss');
            react(ev.target, 'dodge');
          });
          logLine(`<span class="muted">${ev.text}</span>`);
          return fighters[ev.source] ? (willDraw(ev.source, cat) ? 700 : 480) : 340;
        }

        case 'skill': {
          logLine(`<span class="log-skill">${ev.icon || '✨'} ${ev.text}</span>`, 'skill');
          const f = fighters[ev.source];
          if (ev.skill === 'bomb') {
            if (f) f.throwGesture();
            setTimeout(() => { if (cancelled()) return; shakeStage(true); if (ev.source) spawnImpact(unitEls, ev.source, 'KABOOM!', 'bomb'); }, 200 * ts);
            return 560;
          } else if (ev.skill === 'net') {
            if (f) f.throwGesture();
            setTimeout(() => { if (!cancelled() && ev.target) spawnImpact(unitEls, ev.target, 'NET!', 'counter'); }, 200 * ts);
            return 520;
          } else if (ev.hp != null && ev.source) {
            updateHp(unitEls, ev.source, ev.hp, findUnitMax(result, ev.source));
            spawnImpact(unitEls, ev.source, 'GULP!', 'heal');
            spawnNumber(unitEls, ev.source, 'HEAL', 'heal');
            return 360;
          } else {
            if (ev.target) spawnSpecks(unitEls, ev.target, 4);
            return 220;
          }
        }

        case 'combo':
          logLine(`<span class="log-combo">🔁 ${ev.text}</span>`);
          return 110;

        case 'stun':
        case 'immobilized':
          spawnImpact(unitEls, ev.source || ev.target, 'STUN!', 'counter');
          logLine(`<span class="muted">${ev.text}</span>`);
          return 220;

        case 'death': {
          const f = fighters[ev.source];
          if (f) f.die();
          else { const el = unitEls[ev.source]; if (el) el.classList.add('dead'); }
          shakeStage(true);
          spawnSpecks(unitEls, ev.source, 12);
          spawnImpact(unitEls, ev.source, 'K.O.!', 'ko');
          logLine(`<span>${ev.text}</span>`, 'death');
          return 520;
        }

        case 'timeout':
          logLine(`<span class="muted">${ev.text}</span>`);
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

  function logIcon(ev) {
    if (ev.type === 'counter') return '↩️ ';
    if (ev.kind === 'reflect') return '🪞 ';
    if (ev.kind === 'bomb') return '💥 ';
    return (ev.icon || '👊') + ' ';
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
    toast, renderTopbar, showScreen, initTabs,
    renderCreatePreview, renderBruteTab, renderShop, shopCost,
    renderLegacy, legacyPayout, renderIdle,
    renderForge, renderGauntlet, renderCollection, setMeta,
    showLevelUp, isModalOpen,
    replayBattle, showOutcome, cancelReplay,
    bruteSummaryHtml, fmt,
  };
})(window);
