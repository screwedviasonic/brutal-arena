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
  function renderLifetime(lifetime, gauntletBest) {
    const el = $('#stats-content');
    if (!el) return;
    el.innerHTML = `<p class="muted small">Totals across every brute you've ever fielded — these never reset, even when you retire.</p>
      <div class="stat-banner">🏔️ Highest Gauntlet floor reached: <b>${gauntletBest || 0}</b></div>
      ${statsGridHtml(lifetime)}`;
  }

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
      </div>
      ${loadoutHtml(brute)}
      <h3 class="run-stats-head">📋 THIS BRUTE'S RECORD</h3>
      ${statsGridHtml(brute.career)}`;

    const eq = brute.equipped || { weapon: null, pet: null, skills: [] };
    const isEq = (uid) => eq.weapon === uid || eq.pet === uid || (eq.skills || []).includes(uid);
    const weaponsHtml = brute.weapons.length
      ? brute.weapons.map(it => invInstance(it, 'weapon', isEq(it.uid))).join('')
      : '<p class="muted small">No weapons yet — fists only.</p>';
    const skillsHtml = brute.skills.length
      ? brute.skills.map(it => invInstance(it, 'skill', isEq(it.uid))).join('')
      : '<p class="muted small">No skills yet.</p>';
    const petsHtml = brute.pets.length
      ? brute.pets.map(it => invInstance(it, 'pet', isEq(it.uid))).join('')
      : '<p class="muted small">No pets yet.</p>';

    $('#brute-inventory-panel').innerHTML = `
      <h3>⚔️ Weapons</h3><div class="inv-list">${weaponsHtml}</div>
      <h3>✨ Skills</h3><div class="inv-list">${skillsHtml}</div>
      <h3>🐾 Pets</h3><div class="inv-list">${petsHtml}</div>
      <p class="muted small">Equip and forge gear in the ⚒️ FORGE tab.</p>`;
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

  /* ---------------- idle training (claimable stat bank) ---------------- */
  function renderTraining(bank, rate, onClaim) {
    const el = $('#idle-rate');
    if (!el) return;
    bank = bank || {};
    const order = ['hp', 'strength', 'agility', 'speed'];
    const banked = order.map(k => ({ k, n: Math.floor(bank[k] || 0) })).filter(x => x.n > 0);
    const hasAny = banked.length > 0;
    if (rate <= 0) {
      el.innerHTML = `<p class="muted">Hire <b>Trainers</b> in the Shop and your brute trains its stats while you're away. Claim the banked gains here.</p>`;
      return;
    }
    const chips = hasAny
      ? banked.map(x => `<span class="train-chip">+${x.n} ${D.TRAINING.statLabel[x.k]}</span>`).join('')
      : '<span class="muted small">banking… check back after some idle time</span>';
    el.innerHTML = `
      <p class="muted small">Training at <b>${rate}/sec</b> while idle or offline (capped at 8h). No XP, no popups — just claim the gains.</p>
      <div class="train-bank">${chips}</div>
      <button id="btn-claim-train" class="primary-btn" ${hasAny ? '' : 'disabled'}>CLAIM TRAINING</button>`;
    const b = $('#btn-claim-train');
    if (b && hasAny) b.addEventListener('click', onClaim);
  }

  /* ---------------- forge: target crafting ---------------- */
  function renderCraft(shards, target, cost, h) {
    const el = $('#forge-craft');
    if (!el) return;
    const sd = $('#forge-shards'); if (sd) sd.textContent = fmt(shards);
    // weapon picker, grouped/sorted by tier
    const opts = D.DROPPABLE_WEAPONS.slice().sort((a, b) => a.tier - b.tier)
      .map(w => `<option value="${w.id}" ${w.id === target ? 'selected' : ''}>${w.icon} ${w.name} (T${w.tier})</option>`).join('');
    let body;
    if (!target) {
      body = '<p class="muted small">Choose a weapon above to start banking shards toward it.</p>';
    } else {
      const w = D.WEAPONS[target];
      const pct = Math.min(100, (shards / cost) * 100);
      const ready = shards >= cost;
      body = `<div class="craft-target">
          <span class="craft-ico">${w.icon}</span>
          <div class="craft-info">
            <div class="craft-name">${w.name}</div>
            <div class="muted small">Crafts at ${I.RARITY[D.CRAFT.minRarity].name}+ quality</div>
          </div>
        </div>
        <div class="bounty-bar"><div class="bounty-fill craft-fill" style="width:${pct}%"></div>
          <span class="bounty-count">🧩 ${fmt(Math.min(shards, cost))} / ${cost}</span></div>
        <button id="btn-craft" class="primary-btn" ${ready ? '' : 'disabled'}>⚒️ CRAFT ${w.name.toUpperCase()}</button>`;
    }
    el.innerHTML = `<label class="craft-pick"><span>TARGET</span>
        <select id="craft-select"><option value="">— none —</option>${opts}</select></label>${body}`;
    const sel = $('#craft-select');
    if (sel) sel.addEventListener('change', () => h.setTarget(sel.value));
    const cb = $('#btn-craft');
    if (cb && shards >= cost) cb.addEventListener('click', h.craft);
  }

  /* ---------------- forge (weapons / pets / skills) ---------------- */
  function instSubline(it, kind) {
    if (kind === 'pet') { const s = I.petStats(it); return `${I.rarityName(it)} • ❤️${s.hp} 💪${s.strength} 🤸${s.agility} • ⚡${s.power}`; }
    if (kind === 'skill') { const sk = D.SKILLS[it.base] || {}; return `${I.rarityName(it)} • ${sk.kind === 'active' ? 'Active' : 'Passive'}`; }
    const s = I.stats(it); return `${I.rarityName(it)} • ${Math.round(s.dmg)} dmg • ⚡${s.power}`;
  }
  function forgeCard(it, kind, dust, gold, eq, slots) {
    const upCost = I.upgradeCost(it), rrCost = I.rerollCost(it), fuCost = I.fuseDustCost(it), deVal = I.disenchantValue(it);
    const aff = I.affixLines(it).map(a => `<span class="affix">${a}</span>`).join(' ') || '<span class="muted small">no bonuses</span>';
    const equipped = kind === 'skill' ? (eq.skills || []).includes(it.uid) : (kind === 'pet' ? eq.pet === it.uid : eq.weapon === it.uid);
    const equipAct = kind === 'skill' ? 'toggleSkill' : (kind === 'pet' ? 'equipPet' : 'equipWeapon');
    const equipLabel = equipped ? (kind === 'skill' ? '➖ Unequip' : '✓ Equipped') : '➕ Equip';
    const equipDisabled = equipped && kind !== 'skill';   // weapon/pet equip button is just an indicator when equipped
    const canRR = I.canReroll(it);
    return `<div class="forge-item ${equipped ? 'equipped' : ''}" style="border-color:${I.color(it)}">
      <div class="fi-head"><span class="ii-ico">${I.icon(it)}</span>
        <div><div class="ii-name" style="color:${I.color(it)}">${I.displayName(it)}</div>
        <div class="ii-sub">${instSubline(it, kind)}</div></div></div>
      <div class="fi-affixes">${aff}</div>
      <div class="fi-btns">
        <button class="forge-btn eq ${equipped ? 'on' : ''}" data-act="${equipAct}" data-uid="${it.uid}" ${equipDisabled ? 'disabled' : ''}>${equipLabel}</button>
        <button class="forge-btn" data-act="upgrade" data-uid="${it.uid}" ${gold < upCost ? 'disabled' : ''}>⚒️ +${(it.level || 0) + 1}<small>🪙${fmt(upCost)}</small></button>
        <button class="forge-btn" data-act="reroll" data-uid="${it.uid}" ${(dust < rrCost || !canRR) ? 'disabled' : ''}>🎲 Reroll<small>✦${rrCost}</small></button>
        <button class="forge-btn" data-act="fuse" data-uid="${it.uid}" ${dust < fuCost ? 'disabled' : ''}>✨ Fuse<small>✦${fuCost}</small></button>
        <button class="forge-btn de" data-act="disenchant" data-uid="${it.uid}" ${equipped ? 'disabled' : ''}>♻️ Scrap<small>+✦${deVal}</small></button>
      </div></div>`;
  }
  function renderForge(brute, dust, gold, h) {
    const el = $('#forge-list');
    if (!el) return;
    const dd = $('#forge-dust'); if (dd) dd.textContent = fmt(dust);
    const eq = brute.equipped || { weapon: null, pet: null, skills: [] };
    const slots = h.skillSlots || 3;
    const sec = (title, sub, list, kind, empty) =>
      `<div class="forge-section"><h4>${title} <span class="muted small">${sub}</span></h4>
        <div class="forge-list-grid">${list.map(it => forgeCard(it, kind, dust, gold, eq, slots)).join('') || '<p class="muted small">' + empty + '</p>'}</div></div>`;
    el.innerHTML =
      sec('⚔️ Weapons', '— equip 1', brute.weapons, 'weapon', 'No weapons yet — win some loot!') +
      sec('🐾 Pets', '— equip 1', brute.pets, 'pet', 'No pets yet.') +
      sec('✨ Skills', `— ${eq.skills.length}/${slots} slots equipped`, brute.skills, 'skill', 'No skills yet.');
    el.querySelectorAll('.forge-btn').forEach(b => {
      if (b.disabled) return;
      b.addEventListener('click', () => h[b.dataset.act](b.dataset.uid));
    });
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
  function renderGauntlet(g, onClimb, enabled, mutator, settings) {
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
    const mutHtml = mutator
      ? `<div class="gaunt-mut">${GICON.bolt}<span class="gaunt-mut-tag">MODIFIER</span><b>${mutator.label}</b><span class="gm-desc">${mutator.desc}</span></div>`
      : '';
    el.innerHTML = `
      <div class="gaunt-top">
        <div class="gaunt-floor">FLOOR <b>${g.floor}</b></div>
        <div class="gaunt-stats">
          <span class="gaunt-chip chip-best">${GICON.peak}<span class="gc-k">BEST</span><span class="gc-v">${g.best}</span></span>
          <span class="gaunt-chip chip-cp">${GICON.flag}<span class="gc-k">CHECKPOINT</span><span class="gc-v">${g.checkpoint || 1}</span></span>
        </div>
      </div>
      ${bannerHtml}
      ${mutHtml}
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
    const wcat = (lo && lo.weapon) ? catOf(lo.weapon.base) : 'fist';
    if (rig && global.Fighter) fighters.idle = new global.Fighter(rig, brute, 'right', wcat);
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
      const wcat = (lo && lo.weapon) ? catOf(lo.weapon.base) : 'fist';
      if (global.Fighter) fighters[u.id] = new global.Fighter(rig, brute, facing, wcat);
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
    const dmgChip = (n, crit) => `<b class="cl-dmg${crit ? ' crit' : ''}">${n}</b>`;
    // tag = the consistent comic "icon"; side colors the line by who acted
    function clog(tag, tagCls, html, srcUid, lineCls) {
      const side = srcUid ? (teamOf(srcUid) === 'left' ? 'cl-l' : 'cl-r') : '';
      logLine(`<span class="cl-tag cl-${tagCls}">${tag}</span>${html}`, [lineCls || '', side].join(' ').trim());
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
    renderLegacy, legacyPayout, renderTraining,
    renderForge, renderCraft, renderArenaRank, renderGauntlet, renderBounties, renderCollection, renderLifetime, setMeta, rankIcon,
    showLevelUp, isModalOpen,
    replayBattle, showOutcome, cancelReplay, showIdleBrute,
    bruteSummaryHtml, fmt,
  };
})(window);
