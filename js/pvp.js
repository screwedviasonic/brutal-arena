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
    // detect whether the egress-optimization column exists (pvp/appearance.sql).
    // until it's run, fall back to selecting the full row so search/boards keep working.
    if (myRow) hasAppearance = ('appearance' in myRow);
    else { const probe = await sb.from('ladder').select('appearance').limit(1); hasAppearance = !probe.error; }
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
      // small avatar-only snapshot so list queries don't pull the heavy defense JSON
      appearance: { skin: (b.appearance || {}).skin, outfit: (b.appearance || {}).outfit, seed: b.seed },
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
      // pull a light pool (no heavy defense JSON), then fetch the chosen brute's full row
      let pool = [];
      const near = await sb.from('ladder').select('user_id,rating')
        .neq('user_id', user.id)
        .gte('rating', myRating - 150).lte('rating', myRating + 150).limit(25);
      pool = (near.data) || [];
      if (!pool.length) {
        const any = await sb.from('ladder').select('user_id,rating').neq('user_id', user.id).limit(25);
        pool = (any.data) || [];
      }
      if (!pool.length) { toast('No opponents yet. Get another player to sign up — or open the game in another browser to test!', 'bad'); opponent = null; }
      else {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        opponent = await fetchFull(pick.user_id);
        if (!opponent) { toast('Could not load opponent. Try again.', 'bad'); }
      }
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
    const oppRef = { id: opponent.user_id, name: opponent.handle, tag: opponent.tag, power: opponent.power || 0 };
    let captured = false, freed = false;
    if (attackerWon) {
      if (Game().capturePrisoner) captured = Game().capturePrisoner(oppRef);
      if (Game().freeCaptor) freed = Game().freeCaptor(oppRef.id);   // beating your captor frees you
    } else if (Game().addCaptor) {
      Game().addCaptor(oppRef);                                       // lost your attack → they jail you
    }
    const note = attackerWon
      ? (captured ? '<br><span style="color:var(--pop-yellow)">PRISONER TAKEN</span>' : (freed ? '<br><span style="color:var(--pop-yellow)">YOU BROKE FREE</span>' : ''))
      : '<br><span style="color:var(--pop-red)">CAPTURED</span>';
    UI().showOutcome(attackerWon,
      `<div>${attackerWon ? 'PVP VICTORY' : 'PVP DEFEAT'}<br>vs ${oppName}${note}</div>`);
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
    const who = r => `<td class="lb-who">${global.Avatar ? `<span class="lb-av">${avatarFor(r)}</span>` : ''}${fullName(r.handle, r.tag)}</td>`;
    const divCell = arp => { const ico = (UI() && UI().rankIcon) ? UI().rankIcon(arenaRank(arp)) : ''; return `<td><span class="lb-rank-ico">${ico}</span> ${arenaDivName(arp)}</td>`; };
    const arpIco = `<svg viewBox="0 0 24 24" class="lb-arp-ico" aria-hidden="true"><path d="M12 3 L21 11 H16 L12 7.5 L8 11 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/><path d="M12 11 L21 19 H16 L12 15.5 L8 19 H3 Z" fill="var(--pop-blue)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/></svg>`;
    const arpCell = v => `<td><span class="lb-arp">${arpIco}${v || 0}</span></td>`;
    const floorIco = `<svg viewBox="0 0 24 24" class="lb-arp-ico" aria-hidden="true"><path d="M2 21 L9 6 L13 14 L16 9 L22 21 Z" fill="var(--pop-yellow)" stroke="var(--ink)" stroke-width="2.4" stroke-linejoin="round"/><path d="M9 6 L11 9 L8 10 Z" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const floorCell = v => `<td><span class="lb-arp">${floorIco}${v || 0}</span></td>`;

    // per-board config: column, header, value-cells, my live value, colspan
    const cfg = {
      arena:    { title: 'ARENA LEADERBOARD', col: 'arp', sel: hasAppearance ? 'user_id,handle,tag,arp,appearance' : '*', span: 4,
                  head: '<th>#</th><th>Brute</th><th>Division</th><th>ARP</th>',
                  cells: r => `${divCell(r.arp)}${arpCell(r.arp)}`, mine: () => `${divCell(Game().arp())}${arpCell(Game().arp())}`, myVal: () => Game().arp() },
      gauntlet: { title: 'GAUNTLET LEADERBOARD', col: 'gauntlet_best', sel: hasAppearance ? 'user_id,handle,tag,gauntlet_best,appearance' : '*', span: 3,
                  head: '<th>#</th><th>Brute</th><th>Best Floor</th>',
                  cells: r => floorCell(r.gauntlet_best), mine: () => floorCell(Game().gauntletBest()), myVal: () => Game().gauntletBest() },
      rating:   { title: 'PVP LEADERBOARD', col: 'rating', sel: hasAppearance ? 'user_id,handle,tag,rating,wins,losses,power,appearance' : '*', span: 5,
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
    else if (name === 'players') Promise.all([loadRivals(), loadNearby()]).then(renderPlayers);
    else if (name === 'battles') loadRecent().then(renderBattles);
    else if (name === 'prison') renderPrison();
  }

  /* ---------------- social: search / follow / inspect / challenge ---------------- */
  // list queries pull only the small avatar snapshot, never the heavy defense JSON.
  // when the `appearance` column isn't present yet (SQL not run), we fall back to the
  // full row so nothing breaks — `hasAppearance` is detected in loadMe().
  let hasAppearance = true;
  const PLAYER_COLS_BASE = 'user_id,handle,tag,rating,power,wins,losses,arp,gauntlet_best';
  function playerCols() { return hasAppearance ? PLAYER_COLS_BASE + ',appearance' : '*'; }
  function avatarFor(r) {
    if (!global.Avatar) return '';
    const stub = r && r.appearance
      ? { appearance: { skin: r.appearance.skin, outfit: r.appearance.outfit }, seed: r.appearance.seed || 0 }
      : (r && r.defense) || { appearance: {}, seed: 0 };
    return global.Avatar.svg(stub);
  }
  async function fetchFull(uid) {   // pull the full row (incl. defense) for one player on demand
    try { const r = await sb.from('ladder').select('*').eq('user_id', uid).maybeSingle(); return r.data || null; }
    catch (e) { return null; }
  }
  let rivals = [];           // ladder rows I follow
  let rivalIds = new Set();
  let searchResults = [];
  let searchQ = '';
  let nearby = [];           // random discovery list around my power
  let rivalsOk = true;       // false if the rivals table isn't set up
  let recent = [];           // recent match log (resolved against ladder names)
  const byId = {};            // uid -> ladder row (for button handlers)
  const fmt = (n) => (UI() && UI().fmt) ? UI().fmt(n) : ('' + n);

  // recent battles where I attacked or was defended against
  async function loadRecent() {
    if (!user || !sb) { recent = []; return; }
    try {
      const m = await sb.from('matches')
        .select('attacker,defender,attacker_won,attacker_rating_before,attacker_rating_after,defender_rating_before,defender_rating_after,created_at')
        .or('attacker.eq.' + user.id + ',defender.eq.' + user.id)
        .order('created_at', { ascending: false }).limit(15);
      const rows = (m.data) || [];
      // resolve the other player's name (one light query for all opponents)
      const ids = Array.from(new Set(rows.map(r => r.attacker === user.id ? r.defender : r.attacker)));
      let names = {};
      if (ids.length) {
        const nm = await sb.from('ladder').select(hasAppearance ? 'user_id,handle,tag,appearance' : 'user_id,handle,tag').in('user_id', ids);
        (nm.data || []).forEach(p => { names[p.user_id] = p; });
      }
      recent = rows.map(r => {
        const iAttacked = r.attacker === user.id;
        const oppId = iAttacked ? r.defender : r.attacker;
        const won = iAttacked ? r.attacker_won : !r.attacker_won;
        const delta = iAttacked
          ? (r.attacker_rating_after || 0) - (r.attacker_rating_before || 0)
          : (r.defender_rating_after || 0) - (r.defender_rating_before || 0);
        const opp = names[oppId] || {};
        return { oppId, opp, role: iAttacked ? 'ATK' : 'DEF', won, delta, at: r.created_at };
      });
    } catch (e) { recent = []; }
  }

  async function loadRivals() {
    if (!user || !sb) { rivals = []; rivalIds = new Set(); return; }
    try {
      const f = await sb.from('rivals').select('rival_id').eq('owner_id', user.id);
      if (f.error) throw f.error;
      const ids = (f.data || []).map(r => r.rival_id);
      rivalIds = new Set(ids);
      rivals = ids.length ? ((await sb.from('ladder').select(playerCols()).in('user_id', ids)).data || []) : [];
    } catch (e) { rivalsOk = false; rivals = []; rivalIds = new Set(); }
  }
  // a random sampling of players around my power, for discovery
  async function loadNearby() {
    if (!user || !sb) { nearby = []; return; }
    const p = livePower() || (myRow && myRow.power) || 100;
    const lo = Math.floor(p * 0.55), hi = Math.ceil(p * 1.8);
    try {
      let res = await sb.from('ladder').select(playerCols()).neq('user_id', user.id)
        .gte('power', lo).lte('power', hi).limit(25);
      let rows = (res.data) || [];
      if (rows.length < 4) {   // not enough in band — widen to anyone
        const any = await sb.from('ladder').select(playerCols()).neq('user_id', user.id).limit(25);
        rows = (any.data) || [];
      }
      // shuffle and trim so the list feels fresh each visit
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      nearby = rows.slice(0, 10);
    } catch (e) { nearby = []; }
  }
  async function searchPlayers(q) {
    searchQ = (q || '').trim();
    if (!sb || !searchQ) { searchResults = []; renderPlayers(); return; }
    try {
      let qb = sb.from('ladder').select(playerCols()).ilike('handle', '%' + searchQ + '%').order('power', { ascending: false }).limit(20);
      if (user) qb = qb.neq('user_id', user.id);
      searchResults = (await qb).data || [];
    } catch (e) { searchResults = []; }
    renderPlayers();
  }
  async function addRival(uid) {
    if (!user || !sb) return;
    try {
      const r = await sb.from('rivals').insert({ owner_id: user.id, rival_id: uid });
      if (r.error) throw r.error;
      toast('Rival added', 'good'); await loadRivals(); renderPlayers();
    } catch (e) { rivalsOk = false; toast('Rivals need setup — run pvp/rivals.sql in Supabase.', 'bad'); renderPlayers(); }
  }
  async function removeRival(uid) {
    if (!user || !sb) return;
    try { await sb.from('rivals').delete().eq('owner_id', user.id).eq('rival_id', uid); } catch (e) {}
    await loadRivals(); renderPlayers();
  }
  async function challenge(uid) {
    if (busy) return;
    if (!user) { toast('Sign in first (open the PVP tab).', 'bad'); return; }
    const full = await fetchFull(uid);
    if (!full || !full.defense) { toast('Could not load that player.', 'bad'); return; }
    opponent = full;
    attack().then(() => { renderPrison(); Promise.all([loadRivals(), loadRecent()]).then(() => { renderPlayers(); renderBattles(); }); });
  }
  async function inspect(uid) {
    const r = await fetchFull(uid);
    if (!r || !r.defense) { toast('Nothing to inspect.', 'bad'); return; }
    const b = r.defense, C = global.Character, I = global.Items, A = global.Avatar;
    const lo = (C && C.loadout) ? C.loadout(b) : { weapon: null, pet: null, skills: [] };
    const s = b.stats || {};
    const app = b.appearance || {};
    const chip = (k, v) => `<span class="ins-chip"><span class="ins-chip-v">${v}</span><span class="ins-chip-k">${k}</span></span>`;
    const st = (k, v) => `<span class="ins-stat"><i>${k}</i>${Math.round(v || 0)}</span>`;
    const gear = (inst, fb) => inst ? `<b style="color:${I.color(inst)}">${I.displayName(inst)}</b>` : `<span class="muted">${fb}</span>`;
    const skills = (lo.skills && lo.skills.length) ? lo.skills.map(sk => gear(sk, '')).join(', ') : '<span class="muted">None</span>';
    $('#inspect-body').innerHTML = `
      <div class="ins-hero">
        <div class="avatar lg" style="--skin:${app.skin || '#c98b5e'};--outfit:${app.outfit || '#b3261e'}">${A ? A.svg(b) : ''}</div>
        <div class="ins-id"><div class="ins-name">${fullName(r.handle, r.tag)}</div><div class="ins-lv">LEVEL ${b.level || 1}</div></div>
      </div>
      <div class="ins-chips">${chip('POWER', fmt(r.power))}${chip('PVP', r.rating)}${chip('W/L', r.wins + '-' + r.losses)}${chip('ARENA', arenaDivName(r.arp))}${chip('FLOOR', r.gauntlet_best || 0)}</div>
      <div class="ins-stats">${st('HP', s.hp)}${st('STR', s.strength)}${st('AGI', s.agility)}${st('SPD', s.speed)}</div>
      <div class="ins-sec">LOADOUT</div>
      <div class="ins-loadout">
        <div class="ins-slot"><span class="ins-slot-k">WEAPON</span>${gear(lo.weapon, 'Bare Fists')}</div>
        <div class="ins-slot"><span class="ins-slot-k">PET</span>${gear(lo.pet, 'None')}</div>
        <div class="ins-slot"><span class="ins-slot-k">SKILLS</span>${skills}</div>
      </div>
      <div class="ins-actions">
        <button class="primary-btn gaunt-climb" id="ins-fight">CHALLENGE</button>
        <button class="secondary-btn" id="ins-follow">${rivalIds.has(uid) ? 'REMOVE RIVAL' : 'ADD RIVAL'}</button>
      </div>`;
    const close = () => $('#inspect-modal').classList.add('hidden');
    $('#inspect-close').onclick = close;
    $('#ins-fight').onclick = () => { close(); challenge(uid); };
    $('#ins-follow').onclick = () => { (rivalIds.has(uid) ? removeRival(uid) : addRival(uid)); close(); };
    $('#inspect-modal').classList.remove('hidden');
  }
  function playerRow(r) {
    byId[r.user_id] = r;
    const isRival = rivalIds.has(r.user_id);
    return `<div class="pl-row">
      <span class="pl-av">${avatarFor(r)}</span>
      <div class="pl-main"><div class="pl-name">${fullName(r.handle, r.tag)}</div>
        <div class="pl-sub">PWR ${fmt(r.power)} · RTG ${r.rating} · ${arenaDivName(r.arp)}</div></div>
      <div class="pl-acts">
        <button class="forge-btn" data-pl-inspect="${r.user_id}">INSPECT</button>
        <button class="forge-btn eq${isRival ? ' on' : ''}" data-pl-rival="${r.user_id}">${isRival ? 'RIVAL ✓' : '+ RIVAL'}</button>
        <button class="forge-btn eq" data-pl-challenge="${r.user_id}">FIGHT</button>
      </div></div>`;
  }
  // shared row action wiring (inspect / rival / challenge buttons)
  function wireRowActions(el) {
    el.querySelectorAll('[data-pl-inspect]').forEach(b => b.addEventListener('click', () => inspect(b.dataset.plInspect)));
    el.querySelectorAll('[data-pl-rival]').forEach(b => b.addEventListener('click', () => (rivalIds.has(b.dataset.plRival) ? removeRival(b.dataset.plRival) : addRival(b.dataset.plRival))));
    el.querySelectorAll('[data-pl-challenge]').forEach(b => b.addEventListener('click', () => challenge(b.dataset.plChallenge)));
  }

  /* ----- PLAYERS tab: search + nearby + rivals ----- */
  function renderPlayers() {
    const el = $('#players-content'); if (!el) return;
    if (!sb || !user) { el.innerHTML = '<p class="muted">Sign in (open the PVP tab) to find and add rivals.</p>'; return; }
    const rivalsHtml = rivals.length ? rivals.map(playerRow).join('')
      : `<p class="muted small">${rivalsOk ? 'No rivals yet — search or pick from the list below.' : 'Rivals need setup — run pvp/rivals.sql in Supabase.'}</p>`;
    const nearbyHtml = nearby.length ? nearby.map(playerRow).join('')
      : `<p class="muted small">No other players in range yet.</p>`;
    el.innerHTML = `
      <div class="pl-search"><input id="pl-q" type="text" maxlength="20" placeholder="Search players by name…" value="${searchQ.replace(/"/g, '&quot;')}" /><button id="pl-go" class="primary-btn gaunt-climb">SEARCH</button></div>
      ${searchResults.length ? `<div class="brute-sec"><span class="brute-sec-tag">SEARCH RESULTS</span></div><div class="pl-list">${searchResults.map(playerRow).join('')}</div>` : ''}
      <div class="brute-sec"><span class="brute-sec-tag">RIVALS</span></div>
      <div class="pl-list">${rivalsHtml}</div>
      <div class="brute-sec"><span class="brute-sec-tag">NEAR YOUR POWER</span><button id="pl-shuffle" class="forge-btn" style="margin-left:auto">SHUFFLE</button></div>
      <div class="pl-list">${nearbyHtml}</div>`;
    const q = $('#pl-q'), go = $('#pl-go');
    if (go) go.addEventListener('click', () => searchPlayers(q.value));
    if (q) q.addEventListener('keydown', e => { if (e.key === 'Enter') searchPlayers(q.value); });
    const sh = $('#pl-shuffle'); if (sh) sh.addEventListener('click', () => loadNearby().then(renderPlayers));
    wireRowActions(el);
  }

  /* ----- BATTLES tab: recent match log ----- */
  function recentRow(b) {
    const name = b.opp.handle ? fullName(b.opp.handle, b.opp.tag) : '<span class="muted">Unknown</span>';
    const d = b.delta > 0 ? '+' + b.delta : '' + b.delta;
    return `<div class="rb-row">
      <span class="pl-av sm">${avatarFor(b.opp)}</span>
      <div class="pl-main"><div class="pl-name">${name}</div>
        <div class="pl-sub">${b.role === 'ATK' ? 'You attacked' : 'They attacked you'} · RTG ${d}</div></div>
      <span class="rb-res ${b.won ? 'win' : 'loss'}">${b.won ? 'WON' : 'LOST'}</span>
    </div>`;
  }
  function renderBattles() {
    const el = $('#battles-content'); if (!el) return;
    if (!sb || !user) { el.innerHTML = '<p class="muted">Sign in (open the PVP tab) to track your battles.</p>'; return; }
    const recentHtml = recent.length ? recent.map(recentRow).join('')
      : `<p class="muted small">No battles yet. Fight someone to start your record.</p>`;
    el.innerHTML = `
      <div class="brute-sec"><span class="brute-sec-tag">RECENT BATTLES</span></div>
      <div class="pl-list">${recentHtml}</div>`;
  }

  /* ----- PRISON tab: prisoners you hold + captors holding you ----- */
  function prisonRow(p) {
    return `<div class="pr-row">
      <div class="pl-main"><div class="pl-name">${fullName(p.name, p.tag)}</div>
        <div class="pl-sub">PWR ${fmt(p.power)} · +${Math.round(p.buff * 100)}% battle XP</div></div>
      <button class="forge-btn" data-pl-release="${p.id}">RELEASE</button>
    </div>`;
  }
  function captorRow(p) {
    const canPay = Game().gold() >= p.bribe;
    return `<div class="cap-row">
      <div class="pl-main"><div class="pl-name">${fullName(p.name, p.tag)}</div>
        <div class="pl-sub">PWR ${fmt(p.power)} · -${Math.round(p.penalty * 100)}% battle XP</div></div>
      <div class="pl-acts">
        <button class="forge-btn eq" data-cap-fight="${p.id}">BREAK OUT</button>
        <button class="forge-btn${canPay ? '' : ' off'}" data-cap-bribe="${p.id}" ${canPay ? '' : 'disabled'}>BRIBE ${fmt(p.bribe)}g</button>
      </div></div>`;
  }
  function renderPrison() {
    const el = $('#prison-content'); if (!el) return;
    const prison = (Game().prisonList ? Game().prisonList() : []);
    const captors = (Game().captorList ? Game().captorList() : []);
    const totalBuff = prison.reduce((s, p) => s + p.buff, 0);
    const totalPen = captors.reduce((s, p) => s + p.penalty, 0);
    const prisonHtml = prison.length ? prison.map(prisonRow).join('')
      : `<p class="muted small">No prisoners. Beat a player in PvP to capture them for a battle-XP buff.</p>`;
    const captorHtml = captors.length ? captors.map(captorRow).join('')
      : `<p class="muted small">You're a free brute. Lose a PvP attack and the winner jails you here.</p>`;
    el.innerHTML = `
      <div class="brute-sec"><span class="brute-sec-tag">YOUR PRISONERS</span>${prison.length ? `<span class="brute-sec-note">+${Math.round(totalBuff * 100)}% battle XP</span>` : ''}</div>
      <div class="pl-list">${prisonHtml}</div>
      <div class="brute-sec"><span class="brute-sec-tag">HOLDING YOU</span>${captors.length ? `<span class="brute-sec-note bad">-${Math.round(totalPen * 100)}% battle XP</span>` : ''}</div>
      <div class="pl-list">${captorHtml}</div>`;
    el.querySelectorAll('[data-pl-release]').forEach(b => b.addEventListener('click', () => { Game().releasePrisoner(b.dataset.plRelease); renderPrison(); }));
    el.querySelectorAll('[data-cap-fight]').forEach(b => b.addEventListener('click', () => challenge(b.dataset.capFight)));
    el.querySelectorAll('[data-cap-bribe]').forEach(b => b.addEventListener('click', () => {
      const r = Game().bribeCaptor(b.dataset.capBribe);
      if (r.ok) toast('Bought your freedom for ' + fmt(r.cost) + ' gold.', 'good');
      else if (r.short) toast('Not enough gold (need ' + fmt(r.cost) + ').', 'bad');
      renderPrison();
    }));
  }

  // live PvP standing for the brute card (null until the ladder row loads)
  function myStats() { return myRow ? { rating: myRow.rating, wins: myRow.wins, losses: myRow.losses } : null; }

  global.PVP = { init, render, publishDefense, renderArenaBoard, renderGauntletBoard, boardFor, claimName, getHandle, myStats };

  // self-initialize (game.js also calls init(); the `inited` guard makes that safe)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
