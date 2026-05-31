/* ============================================================
 * pvp.js — PvP ladder client (Supabase).
 *
 * Talks to Supabase for auth + storage, reuses the existing combat
 * engine (global.Combat) and replay (UI.replayBattle) for fights, and
 * reads the live game state through the small `global.Game` bridge
 * exposed by game.js.
 *
 * Flow: sign in (anonymous) -> publish a "defense" snapshot of your
 * brute to the public ladder -> find an opponent near your rating ->
 * fight their snapshot -> Elo updates -> leaderboard.
 * ============================================================ */
(function (global) {
  'use strict';

  const cfg = global.PVP_CONFIG;
  const $ = (s) => document.querySelector(s);

  let sb = null;        // supabase client
  let user = null;      // auth user
  let handle = null;    // my display name (not unique)
  let tag = null;       // my #tag discriminator (e.g. 1234)
  let myRow = null;     // my ladder row (rating/wins/losses)
  let opponent = null;  // currently matched opponent row
  let busy = false;

  const UI = () => global.UI;
  const Game = () => global.Game;
  const toast = (m, t) => global.UI && global.UI.toast(m, t);

  function configured() { return cfg && cfg.url && cfg.key && global.supabase; }
  const randTag = () => String(Math.floor(1 + Math.random() * 9998)).padStart(4, '0');
  const fullName = (h, t) => (h || '?') + '#' + (t || '0000');

  let inited = false;
  async function init() {
    if (inited) return;
    inited = true;
    render();                       // always paint something immediately
    if (!configured()) return;      // render() shows the right "why" message
    try {
      sb = global.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      const { data } = await sb.auth.getSession();
      if (data && data.session) {
        user = data.session.user;
        await loadMe();
      } else {
        await autoSignIn();   // seamless anonymous account — you're on the boards by default
      }
    } catch (e) {
      toast('PvP init error: ' + (e.message || e), 'bad');
    }
    renderAcct();
    wireRename();
    const chip = document.querySelector('#acct-chip');
    if (chip && !chip._wired) { chip._wired = true; chip.addEventListener('click', openRename); }
    render();
    const active = document.querySelector('.tab.active');
    if (active) boardFor(active.dataset.tab);   // populate the board on the starting tab
  }

  function renderAcct() {
    const el = document.querySelector('#acct-chip');
    if (!el) return;
    if (user && handle) { el.textContent = fullName(handle, tag); el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }

  /* ---------------- in-app rename modal ---------------- */
  function openRename() {
    const m = $('#rename-modal'), inp = $('#rename-input'), t = $('#rename-tag');
    if (!m || !inp) return;
    inp.value = handle || '';
    if (t) t.textContent = '#' + (tag || '0000');
    m.classList.remove('hidden');
    inp.focus(); inp.select();
  }
  function closeRename() { const m = $('#rename-modal'); if (m) m.classList.add('hidden'); }
  function wireRename() {
    const m = $('#rename-modal'); if (!m || m._wired) return; m._wired = true;
    const inp = $('#rename-input');
    const commit = () => { const v = (inp.value || '').trim(); if (v) setHandle(v); closeRename(); };
    const save = $('#rename-save'), cancel = $('#rename-cancel');
    if (save) save.addEventListener('click', commit);
    if (cancel) cancel.addEventListener('click', closeRename);
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') closeRename(); });
    m.addEventListener('click', e => { if (e.target === m) closeRename(); });   // click backdrop to close
  }

  // create/refresh the private account row (names repeat freely; the #tag differentiates)
  async function ensureAccount(wanted) {
    handle = ((wanted || '').slice(0, 16)) || ('Brute' + Math.floor(1000 + Math.random() * 9000));
    tag = tag || randTag();
    await sb.from('accounts').upsert(
      { user_id: user.id, handle, tag, save: Game().state(), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }

  // silent anonymous sign-in on first load
  async function autoSignIn() {
    try {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      user = data.user;
      const b = Game().brute();
      if (b) {                              // returning brute: ensure account + ladder row
        await ensureAccount(b.name);
        await publishDefense(true);
      }
      // brand-new players have no name yet — the account is created when they
      // name their first brute (claimName from beginGame). No random handle.
      await loadMe();
    } catch (e) { /* anon auth off / offline — boards stay read-only */ }
  }

  // brute name == username. First brute creates the account; later renames sync.
  async function claimName(name) {
    if (!user || !sb || !name) return;
    name = name.slice(0, 16);
    if (!handle) {                          // first brute ever: create the account with this name
      await ensureAccount(name);
      if (Game().brute && Game().brute()) await publishDefense(true);
      await loadMe(); renderAcct();
    } else if (name !== handle) {           // renamed
      await setHandle(name);
    } else {                                // prestige with same locked name: refresh snapshot
      if (Game().brute && Game().brute()) await publishDefense(true);
      renderAcct();
    }
  }
  function getHandle() { return handle; }

  // rename: change the name part only — the #tag stays, so no collisions.
  // also renames the brute itself so the two stay in sync.
  async function setHandle(n) {
    if (!user || !n) return;
    handle = n.slice(0, 16);
    if (Game().setBruteName) Game().setBruteName(handle);   // brute name follows leaderboard name
    try {
      await sb.from('accounts').update({ handle }).eq('user_id', user.id);
      if (Game().brute && Game().brute()) await publishDefense(true);   // syncs ladder + new-name snapshot
      else await sb.from('ladder').update({ handle }).eq('user_id', user.id);
    } catch (e) { toast('Rename failed: ' + (e.message || e), 'bad'); return; }
    toast('Renamed to ' + fullName(handle, tag), 'good');
    renderAcct(); render();
  }

  async function loadMe() {
    if (!user) return;
    const acc = await sb.from('accounts').select('handle,tag').eq('user_id', user.id).maybeSingle();
    if (acc.data) { handle = acc.data.handle; tag = acc.data.tag; }
    if (!tag) {   // backfill a tag for accounts created before tags existed
      tag = randTag();
      await sb.from('accounts').update({ tag }).eq('user_id', user.id);
      await sb.from('ladder').update({ tag }).eq('user_id', user.id);
    }
    const lad = await sb.from('ladder').select('*').eq('user_id', user.id).maybeSingle();
    myRow = lad.data || null;
    if (Game() && Game().refreshBrute) Game().refreshBrute();   // brute card shows PvP rating once it loads
  }

  /* ---------------- sign in / register (manual fallback) ---------------- */
  async function signIn() {
    if (!sb) return;
    const input = $('#pvp-handle');
    setBusy(true);
    try {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      user = data.user;
      await ensureAccount(input && input.value.trim());
      if (Game().brute()) await publishDefense(true);
      await loadMe();
      renderAcct();
      toast('Welcome to the ladder, ' + fullName(handle, tag) + '!', 'good');
    } catch (e) {
      toast('Sign-in failed: ' + (e.message || e), 'bad');
    } finally {
      setBusy(false); render();
    }
  }

  /* ---------------- publish defense snapshot ---------------- */
  async function publishDefense(silent) {
    if (!user) return;
    const b = Game().brute();
    if (!b) return;
    const snapshot = JSON.parse(JSON.stringify(b));     // freeze current brute
    const bonuses = Game().metaBonuses();
    const power = global.Character.powerRating(b, bonuses);
    const row = {
      user_id: user.id, handle: handle, tag: tag, defense: snapshot,
      defense_bonuses: bonuses, power: power,
      arp: Game().arp ? Game().arp() : 0, gauntlet_best: Game().gauntletBest ? Game().gauntletBest() : 0,
      updated_at: new Date().toISOString(),
    };
    // rating/wins/losses intentionally omitted — the DB guard owns those
    const { error } = await sb.from('ladder').upsert(row, { onConflict: 'user_id' });
    if (error) { toast('Publish failed: ' + error.message, 'bad'); return; }
    if (!silent) toast('Defense brute published (Power ' + power + ').', 'good');
    await loadMe();
    render();
  }

  // push just the PvE bragging stats (arena rank + gauntlet floor) for the boards
  async function publishStats() {
    if (!user || !sb) return;
    try {
      await sb.from('ladder').update({
        arp: Game().arp ? Game().arp() : 0,
        gauntlet_best: Game().gauntletBest ? Game().gauntletBest() : 0,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
    } catch (e) {}
  }
  function arenaStep(arp) {
    const A = global.GAMEDATA && global.GAMEDATA.ARENA;
    return A ? Math.min(A.steps - 1, Math.floor((arp || 0) / A.bandSize)) : 0;
  }
  function arenaRank(arp) {   // rank name (for the medal icon)
    const A = global.GAMEDATA && global.GAMEDATA.ARENA;
    if (!A) return '-';
    return A.divisions[Math.min(A.divisions.length - 1, Math.floor(arenaStep(arp) / 3))];
  }
  function arenaDivName(arp) {   // full label, e.g. "Bronze II"
    const A = global.GAMEDATA && global.GAMEDATA.ARENA;
    if (!A) return '-';
    return arenaRank(arp) + ' ' + A.tiers[arenaStep(arp) % 3];
  }

  /* ---------------- matchmaking ---------------- */
  async function findOpponent() {
    if (!user) return;
    setBusy(true);
    try {
      const myRating = myRow ? myRow.rating : 1000;
      let pool = [];
      const near = await sb.from('ladder').select('*')
        .neq('user_id', user.id)
        .gte('rating', myRating - 150).lte('rating', myRating + 150).limit(25);
      pool = (near.data) || [];
      if (!pool.length) {
        const any = await sb.from('ladder').select('*').neq('user_id', user.id).limit(25);
        pool = (any.data) || [];
      }
      if (!pool.length) { toast('No opponents yet. Get a friend to sign up — or open the game in another browser to test!', 'bad'); opponent = null; }
      else opponent = pool[Math.floor(Math.random() * pool.length)];
    } catch (e) {
      toast('Matchmaking error: ' + (e.message || e), 'bad');
    } finally {
      setBusy(false); render();
    }
  }

  /* ---------------- fight ---------------- */
  async function attack() {
    if (!opponent || busy) return;
    const me = Game().brute();
    if (!me) return;
    setBusy(true);
    let seed, attackerWon, result;
    try {
      if (cfg.allowClientResolve) {
        seed = (Math.random() * 0xffffffff) >>> 0;
        result = global.Combat.simulateBattle(me, opponent.defense, seed, {
          leftBonuses: Game().metaBonuses(), rightBonuses: opponent.defense_bonuses || {},
        });
        attackerWon = result.winner === 'left';
        const rep = await sb.rpc('report_match', { p_defender: opponent.user_id, p_seed: seed, p_attacker_won: attackerWon });
        if (rep.error) throw rep.error;
      } else {
        const inv = await sb.functions.invoke('resolve-match', { body: { defenderId: opponent.user_id } });
        if (inv.error) throw inv.error;
        seed = inv.data.seed; attackerWon = inv.data.attacker_won;
        result = global.Combat.simulateBattle(me, opponent.defense, seed, {
          leftBonuses: Game().metaBonuses(), rightBonuses: opponent.defense_bonuses || {},
        });
      }
    } catch (e) {
      toast('Match failed: ' + (e.message || e), 'bad');
      setBusy(false); return;
    }

    // animate the (authoritative) fight in the shared stage (already visible on the PVP tab)
    const oppName = fullName(opponent.handle, opponent.tag);
    try { await UI().replayBattle(result, me, opponent.defense, Game().fast()); } catch (e) {}
    UI().showOutcome(attackerWon,
      `<div>${attackerWon ? 'PVP VICTORY' : 'PVP DEFEAT'}<br>vs ${oppName}</div>`);
    await loadMe();
    opponent = null;
    setBusy(false);
    render();
    // settle the shared stage back to the idle brute a few seconds after the result
    setTimeout(() => {
      if (!busy && UI().showIdleBrute && Game().brute) UI().showIdleBrute(Game().brute());
    }, 3000);
  }

  function setBusy(v) { busy = v; render(); }

  /* ---------------- comic glyphs (no emoji) ---------------- */
  const PVP_ICON = {
    // rating medallion (purple, gold star) — fills the .ar-medal box
    badge: `<svg viewBox="0 0 48 48" class="rankglyph" aria-hidden="true"><path d="M17 27 L13 45 L21 40 L24 46 L27 40 L35 45 L31 27 Z" fill="#b23a2e" stroke="#14110d" stroke-width="2.4" stroke-linejoin="round"/><circle cx="24" cy="19" r="14.5" fill="#8338ec" stroke="#14110d" stroke-width="3"/><circle cx="24" cy="19" r="10.5" fill="none" stroke="#14110d" stroke-width="1.4" opacity=".4"/><path d="M24 11 l2.2 4.7 5.1 .5 -3.8 3.4 1.1 5 -4.6-2.7 -4.6 2.7 1.1-5 -3.8-3.4 5.1-.5 Z" fill="#ffd23f" stroke="#14110d" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    // crossed swords (record / W-L)
    swords: `<svg viewBox="0 0 24 24" class="gicon" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 L15 5" stroke="#14110d" stroke-width="4.6"/><path d="M20 20 L9 5" stroke="#14110d" stroke-width="4.6"/><path d="M4 20 L15 5" stroke="#d4d8dd" stroke-width="2.4"/><path d="M20 20 L9 5" stroke="#d4d8dd" stroke-width="2.4"/></g></svg>`,
    // flame (power)
    power: `<svg viewBox="0 0 24 24" class="gicon" aria-hidden="true"><path d="M12 2 C14 7 19 9 19 14 a7 7 0 0 1 -14 0 C5 10 9 9 9 5 C10.5 7 12 6 12 2 Z" fill="#ff7b00" stroke="#14110d" stroke-width="2" stroke-linejoin="round"/><path d="M12.5 12 C13.4 13.6 15 14.4 14.5 16.4 a2.4 2.4 0 0 1 -4.8 -.3 C9.8 14.8 11 14.3 11 12.9 C11.6 13.7 12.5 13 12.5 12 Z" fill="#ffce3a" stroke="#14110d" stroke-width="1.1" stroke-linejoin="round"/></svg>`,
  };

  // current (live) power of my brute vs my published defense snapshot
  function livePower() {
    const b = Game().brute && Game().brute();
    if (!b || !global.Character) return 0;
    return global.Character.powerRating(b, Game().metaBonuses ? Game().metaBonuses() : {});
  }

  /* ---------------- rendering ---------------- */
  function render() {
    const el = $('#pvp-content');
    if (!el) return;

    if (!cfg || !cfg.url || !cfg.key) {
      el.innerHTML = `<p class="muted">PvP isn't configured. Add your Supabase URL + key in <code>js/pvp-config.js</code>.</p>`;
      return;
    }
    if (!global.supabase) {
      el.innerHTML = `<p class="muted">Loading the PvP library… if this sticks, hard-refresh (Ctrl+Shift+R). It loads from a CDN, so a network/ad-blocker can block it.</p>`;
      return;
    }
    if (!user) {
      el.innerHTML = `
        <p class="muted small">Sign in to publish your brute and battle other players' brutes for ladder rating. Anonymous — no email needed.</p>
        <label class="field"><span>HANDLE (your ladder name)</span>
          <input id="pvp-handle" type="text" maxlength="16" placeholder="e.g. Skullcrusher" /></label>
        <button id="pvp-signin" class="primary-btn gaunt-climb" ${busy ? 'disabled' : ''}>ENTER THE PVP ARENA</button>
        <div id="pvp-leaderboard"></div>`;
      $('#pvp-signin').addEventListener('click', signIn);
      renderLeaderboard();
      return;
    }

    const r = myRow || { rating: 1000, wins: 0, losses: 0, power: 0 };
    const cur = livePower();
    const pub = r.power || 0;
    const stale = cur > pub;   // brute has grown since the defense snapshot was published
    const oppHtml = opponent ? `
      <div class="pvp-opp">
        <div class="pvp-opp-head"><span class="pvp-opp-tag">OPPONENT</span><b>${fullName(opponent.handle, opponent.tag)}</b><span class="pvp-opp-meta">RTG ${opponent.rating} · PWR ${opponent.power}</span></div>
        <div class="pvp-opp-card">${opponentSummary(opponent.defense)}</div>
        <div class="pvp-fight-btns">
          <button id="pvp-attack" class="primary-btn gaunt-climb" ${busy ? 'disabled' : ''}>ATTACK</button>
          <button id="pvp-skip" class="secondary-btn" ${busy ? 'disabled' : ''}>ANOTHER</button>
        </div>
      </div>` : `
      <button id="pvp-find" class="primary-btn gaunt-climb" ${busy ? 'disabled' : ''}>FIND OPPONENT</button>`;

    el.innerHTML = `
      <div class="gaunt-top">
        <div class="ar-divline">
          <span class="ar-medal">${PVP_ICON.badge}</span>
          <div class="pvp-id">
            <div class="gaunt-floor ar-divname">${r.rating}</div>
            <div class="pvp-handle">${fullName(handle, tag)}</div>
          </div>
        </div>
        <div class="gaunt-stats">
          <span class="gaunt-chip chip-best">${PVP_ICON.swords}<span class="gc-k">RECORD</span><span class="gc-v">${r.wins}-${r.losses}</span></span>
          <span class="gaunt-chip chip-cp${stale ? ' chip-stale' : ''}">${PVP_ICON.power}<span class="gc-k">POWER</span><span class="gc-v">${cur}</span></span>
        </div>
      </div>
      <div class="pvp-actions">
        ${oppHtml}
      </div>
      <div class="pvp-tools">
        <button id="pvp-publish" class="${stale ? 'primary-btn' : 'secondary-btn'}" ${busy ? 'disabled' : ''} title="${stale ? `Your defense is Power ${pub}; you're now Power ${cur}` : 'Refresh your defense snapshot'}">UPDATE DEFENSE BRUTE${stale ? ` <span class="pw-delta">+${cur - pub}</span>` : ''}</button>
      </div>
      <div class="gaunt-rules"><span class="gr-tag">HOW IT WORKS</span><p>Fight other players' defense brutes to win rating. Your defense brute is a frozen snapshot others battle while you're away, so update it whenever you upgrade.</p></div>
      <div id="pvp-leaderboard"></div>`;

    const bind = (id, fn) => { const b = $(id); if (b && !b.disabled) b.addEventListener('click', fn); };
    bind('#pvp-find', findOpponent);
    bind('#pvp-attack', attack);
    bind('#pvp-skip', findOpponent);
    bind('#pvp-publish', () => publishDefense(false));
    renderLeaderboard();
  }

  function opponentSummary(b) {
    if (!b) return '';
    const D = global.GAMEDATA;
    // tolerate instances (new) and legacy id-strings (old defense snapshots)
    const eq = b.equipped || null;
    const wList = eq && eq.weapon ? (b.weapons || []).filter(w => w.uid === eq.weapon) : (b.weapons || []).slice(0, 1);
    const sList = eq && eq.skills ? (b.skills || []).filter(s => eq.skills.includes(s.uid)) : (b.skills || []);
    const pList = eq && eq.pet ? (b.pets || []).filter(p => p.uid === eq.pet) : (b.pets || []).slice(0, 1);
    const baseName = (x, dict, fb) => (dict[(x && x.base) || x] || {}).name || fb;
    const stat = (k, v) => `<span class="ost"><i>${k}</i>${v}</span>`;
    const gear = [
      baseName(wList[0], D.WEAPONS, 'Bare Fists'),
      pList[0] ? baseName(pList[0], D.PETS, null) : null,
      sList.length ? sList.length + ' skill' + (sList.length > 1 ? 's' : '') : null,
    ].filter(Boolean).join(' · ');
    return `<div class="pvp-opp-stats">${stat('LV', b.level)}${stat('HP', b.stats.hp)}${stat('STR', b.stats.strength)}${stat('AGI', b.stats.agility)}${stat('SPD', b.stats.speed)}</div>
      <div class="pvp-opp-gear">${gear}</div>`;
  }

  // render one leaderboard (rating | arena | gauntlet) into a target element
  async function renderBoardInto(mode, selector) {
    const target = $(selector);
    if (!target) return;
    if (!sb) { target.innerHTML = '<p class="muted small">Leaderboard offline.</p>'; return; }
    if (user) await publishStats();   // freshen my own entry before showing
    const me = r => (user && r.user_id === user.id) ? 'me' : '';   // names repeat, so match by id
    const empty = n => `<tr><td colspan="${n}" class="muted">No entries yet.</td></tr>`;
    // brute portrait + name#tag
    const who = r => `<td class="lb-who">${r.defense && global.Avatar ? `<span class="lb-av">${global.Avatar.svg(r.defense)}</span>` : ''}${fullName(r.handle, r.tag)}</td>`;
    const divCell = arp => { const ico = (UI() && UI().rankIcon) ? UI().rankIcon(arenaRank(arp)) : ''; return `<td><span class="lb-rank-ico">${ico}</span> ${arenaDivName(arp)}</td>`; };
    const arpIco = `<svg viewBox="0 0 24 24" class="lb-arp-ico" aria-hidden="true"><path d="M12 3 L21 11 H16 L12 7.5 L8 11 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/><path d="M12 11 L21 19 H16 L12 15.5 L8 19 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/></svg>`;
    const arpCell = v => `<td><span class="lb-arp">${arpIco}${v || 0}</span></td>`;
    const floorIco = `<svg viewBox="0 0 24 24" class="lb-arp-ico" aria-hidden="true"><path d="M2 21 L9 6 L13 14 L16 9 L22 21 Z" fill="var(--pop-yellow)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/><path d="M9 6 L11 9 L8 10 Z" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const floorCell = v => `<td><span class="lb-arp">${floorIco}${v || 0}</span></td>`;

    // per-board config: column, header, value-cells, my live value, colspan
    const cfg = {
      arena:    { title: 'ARENA LEADERBOARD', col: 'arp', sel: 'user_id,handle,tag,arp,defense', span: 4,
                  head: '<th>#</th><th>Brute</th><th>Division</th><th>ARP</th>',
                  cells: r => `${divCell(r.arp)}${arpCell(r.arp)}`, mine: () => `${divCell(Game().arp())}${arpCell(Game().arp())}`, myVal: () => Game().arp() },
      gauntlet: { title: 'GAUNTLET LEADERBOARD', col: 'gauntlet_best', sel: 'user_id,handle,tag,gauntlet_best,defense', span: 3,
                  head: '<th>#</th><th>Brute</th><th>Best Floor</th>',
                  cells: r => floorCell(r.gauntlet_best), mine: () => floorCell(Game().gauntletBest()), myVal: () => Game().gauntletBest() },
      rating:   { title: 'PVP LEADERBOARD', col: 'rating', sel: 'user_id,handle,tag,rating,wins,losses,power,defense', span: 5,
                  head: '<th>#</th><th>Brute</th><th>Rating</th><th>W/L</th><th>Power</th>',
                  cells: r => `<td>${r.rating}</td><td>${r.wins}/${r.losses}</td><td>${r.power}</td>`,
                  mine: () => `<td>${myRow.rating}</td><td>${myRow.wins}/${myRow.losses}</td><td>${myRow.power}</td>`, myVal: () => (myRow ? myRow.rating : 0) },
    };
    const c = cfg[mode] || cfg.rating;
    const rankCls = i => i < 3 ? ' rank-' + (i + 1) : '';
    const { data } = await sb.from('ladder').select(c.sel).order(c.col, { ascending: false }).limit(15);
    let body = (data || []).map((r, i) =>
      `<tr class="${me(r)}${rankCls(i)}"><td>${i + 1}</td>${who(r)}${c.cells(r)}</tr>`).join('') || empty(c.span);

    // pin my own rank at the bottom if I'm signed in but outside the top 15
    if (user && myRow && !(data || []).some(r => r.handle === handle)) {
      const { count } = await sb.from('ladder').select('user_id', { count: 'exact', head: true }).gt(c.col, c.myVal());
      const myRank = (count || 0) + 1;
      body += `<tr class="pin-sep"><td colspan="${c.span}"></td></tr>` +
              `<tr class="me pinned"><td>${myRank}</td>${who(myRow)}${c.mine()}</tr>`;
    }
    target.innerHTML = `<h3 class="pvp-lb-head">${c.title}</h3><table class="pvp-lb"><thead><tr>${c.head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  function renderLeaderboard() { return renderBoardInto('rating', '#pvp-leaderboard'); }
  function renderArenaBoard() { return renderBoardInto('arena', '#arena-leaderboard'); }
  function renderGauntletBoard() { return renderBoardInto('gauntlet', '#gauntlet-leaderboard'); }
  // render the board that belongs to a given tab (called on tab switch)
  function boardFor(name) {
    if (name === 'arena') renderArenaBoard();
    else if (name === 'gauntlet') renderGauntletBoard();
  }

  // live PvP standing for the brute card (null until the ladder row loads)
  function myStats() { return myRow ? { rating: myRow.rating, wins: myRow.wins, losses: myRow.losses } : null; }

  global.PVP = { init, render, publishDefense, renderArenaBoard, renderGauntletBoard, boardFor, claimName, getHandle, myStats };

  // self-initialize (game.js also calls init(); the `inited` guard makes that safe)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
