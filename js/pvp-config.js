/* ============================================================
 * pvp-config.js — Supabase connection + PvP feature flags.
 *
 * The publishable key is MEANT to be public (it ships in the client);
 * Row Level Security in the database is what actually protects data.
 * Never put the service_role / secret key here.
 * ============================================================ */
window.PVP_CONFIG = {
  url: 'https://geljubpsgtgzaqtcldxn.supabase.co',
  key: 'sb_publishable_WCAG4kivBDWOPihEDoVScQ__u5D_2sC',

  // While true, fights are resolved in the browser and the result is
  // reported to the database. This lets you PLAY before the authoritative
  // resolve-match Edge Function is deployed. Flip to false once that
  // function is live so outcomes are server-authoritative (uncheatable).
  allowClientResolve: true,
};
