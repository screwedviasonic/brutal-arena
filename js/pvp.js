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
  let handle = null;    // my display name
  let myRow = null;     // my ladder row (rating/wins/losses)
  let opponent = null;  // currently matched opponent row
  let busy = false;

  const UI = () => global.UI;
  const Game = () => global.Game;
  const toast = (m, t) => global.UI && global.UI.toast(m, t);

  function configured() { return cfg && cfg.url && cfg.key && global.supabase; }

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
      }
    } catch (e) {
      toast('PvP init error: ' + (e.message || e), 'bad');
    }
    render();
  }

  async function loadMe() {
    if (!user) return;
    const acc = await sb.from('accounts').select('handle').eq('user_id', user.id).maybeSingle();
    if (acc.data) handle = acc.data.handle;
    const lad = await sb.from('ladder').select('*').eq('user_id', user.id).maybeSingle();
    myRow = lad.data || null;
  }

  /* ---------------- sign in / register ---------------- */
  async function signIn() {
    if (!sb) return;
    if (!Game().brute()) { toast('Create a brute first, then enter the PvP arena.', 'bad'); return; }
    const input = $('#pvp-handle');
    const wanted = (input && input.value.trim()) || ('Brute' + Math.floor(1000 + Math.random() * 9000));
    setBusy(true);
    try {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      user = data.user;
      handle = wanted.slice(0, 16);
      // create private account row + public ladder row
      const accErr = (await sb.from('accounts').upsert(
        { user_id: user.id, handle, save: Game().state(), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' })).error;
      if (accErr && accErr.code === '23505') { // handle taken
        handle = handle + Math.floor(10 + Math.random() * 89);
        await sb.from('accounts').upsert({ user_id: user.id, handle, save: Game().state() }, { onConflict: 'user_id' });
      }
      await publishDefense(true);
      await loadMe();
      toast('⚔️ Welcome to the ladder, ' + handle + '!', 'good');
    } catch (e) {
      toast('Sign-in failed: ' + (e.message || e), 'bad');
    } finally {
      setBusy(false); render();
    }
  }

  async function signOut() {
    if (sb) await sb.auth.signOut();
    user = null; myRow = null; handle = null; opponent = null;
    render();
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
      user_id: user.id, handle: handle, defense: snapshot,
      defense_bonuses: bonuses, power: power, updated_at: new Date().toISOString(),
    };
    // rating/wins/losses intentionally omitted — the DB guard owns those
    const { error } = await sb.from('ladder').upsert(row, { onConflict: 'user_id' });
    if (error) { toast('Publish failed: ' + error.message, 'bad'); return; }
    if (!silent) toast('🛡️ Defense brute published (Power ' + power + ').', 'good');
    await loadMe();
    render();
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
    const oppName = opponent.handle;
    try { await UI().replayBattle(result, me, opponent.defense, Game().fast()); } catch (e) {}
    UI().showOutcome(attackerWon,
      `<div>${attackerWon ? '🏆 PVP VICTORY' : '☠️ PVP DEFEAT'}<br>vs ${oppName}</div>`);
    await loadMe();
    opponent = null;
    setBusy(false);
    render();
  }

  function setBusy(v) { busy = v; render(); }

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
        <button id="pvp-signin" class="primary-btn" ${busy ? 'disabled' : ''}>⚔️ ENTER THE PVP ARENA</button>`;
      $('#pvp-signin').addEventListener('click', signIn);
      renderLeaderboard();
      return;
    }

    const r = myRow || { rating: 1000, wins: 0, losses: 0, power: 0 };
    const oppHtml = opponent ? `
      <div class="pvp-opp">
        <div class="pvp-opp-head">OPPONENT: <b>${opponent.handle}</b> <span class="muted small">★ ${opponent.rating} • ⚡${opponent.power}</span></div>
        <div class="pvp-opp-card">${opponentSummary(opponent.defense)}</div>
        <div class="pvp-fight-btns">
          <button id="pvp-attack" class="primary-btn" ${busy ? 'disabled' : ''}>⚔️ ATTACK</button>
          <button id="pvp-skip" class="secondary-btn" ${busy ? 'disabled' : ''}>↻ Another</button>
        </div>
      </div>` : `
      <button id="pvp-find" class="primary-btn" ${busy ? 'disabled' : ''}>🔍 FIND OPPONENT</button>`;

    el.innerHTML = `
      <div class="pvp-me">
        <div class="pvp-rating">★ <b>${r.rating}</b><span class="muted small"> rating</span></div>
        <div class="muted">${handle} &nbsp;•&nbsp; 🏅 ${r.wins}W / ${r.losses}L &nbsp;•&nbsp; ⚡ Power ${r.power}</div>
      </div>
      <div class="pvp-actions">
        ${oppHtml}
      </div>
      <div class="pvp-tools">
        <button id="pvp-publish" class="secondary-btn" ${busy ? 'disabled' : ''}>🛡️ Update my defense brute</button>
        <button id="pvp-signout" class="ghost-btn">Sign out</button>
      </div>
      <p class="muted small">Your "defense brute" is a frozen snapshot others fight while you're away. Update it after you upgrade.</p>
      <div id="pvp-leaderboard"></div>`;

    const bind = (id, fn) => { const b = $(id); if (b && !b.disabled) b.addEventListener('click', fn); };
    bind('#pvp-find', findOpponent);
    bind('#pvp-attack', attack);
    bind('#pvp-skip', findOpponent);
    bind('#pvp-publish', () => publishDefense(false));
    bind('#pvp-signout', signOut);
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
    const baseIcon = (x, dict, fb) => (dict[(x && x.base) || x] || {}).icon || fb;
    const wpns = wList.map(w => baseIcon(w, D.WEAPONS, '🗡️')).join(' ');
    const skills = sList.map(s => baseIcon(s, D.SKILLS, '✨')).join(' ');
    const pets = pList.map(p => baseIcon(p, D.PETS, '🐾')).join(' ');
    return `<div class="pvp-opp-line">LV ${b.level} • ❤️${b.stats.hp} 💪${b.stats.strength} 🤸${b.stats.agility} 💨${b.stats.speed}</div>
      <div class="pvp-opp-line">${wpns || '👊'} ${skills} ${pets}</div>`;
  }

  async function renderLeaderboard() {
    const box = $('#pvp-leaderboard') || $('#pvp-content');
    if (!box || !sb) return;
    const { data } = await sb.from('ladder').select('handle,rating,wins,losses,power').order('rating', { ascending: false }).limit(15);
    const rows = (data || []).map((row, i) => `
      <tr class="${user && row.handle === handle ? 'me' : ''}">
        <td>${i + 1}</td><td>${row.handle}</td><td>★ ${row.rating}</td>
        <td>${row.wins}/${row.losses}</td><td>⚡${row.power}</td></tr>`).join('');
    const target = $('#pvp-leaderboard');
    if (target) target.innerHTML = `
      <h3 class="pvp-lb-head">🏆 LEADERBOARD</h3>
      <table class="pvp-lb"><thead><tr><th>#</th><th>Brute</th><th>Rating</th><th>W/L</th><th>Power</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No fighters yet.</td></tr>'}</tbody></table>`;
  }

  global.PVP = { init, render, publishDefense };

  // self-initialize (game.js also calls init(); the `inited` guard makes that safe)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
