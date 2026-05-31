// ============================================================
// Brutal Arena - Discord server scaffolder.
//
// Builds the whole server layout (roles, categories, channels, topics)
// in one shot via the Discord REST API. Zero dependencies (Node 18+ has
// global fetch). Safe to re-run: it skips anything that already exists
// by name, so it only fills in what's missing.
//
// USAGE (PowerShell):
//   $env:DISCORD_TOKEN="your-bot-token"
//   $env:GUILD_ID="your-server-id"
//   node discord/setup-server.mjs
//
// Optional: set $env:POST_CONTENT="0" to skip seeding the rules /
// start-here text (just build the empty channels).
//
// See discord/README.md for how to get the token, invite the bot, and
// grab the server ID.
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.GUILD_ID;
const POST_CONTENT = process.env.POST_CONTENT !== '0';

if (!TOKEN || !GUILD) {
  console.error('Missing env. Set DISCORD_TOKEN and GUILD_ID. See discord/README.md.');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const VIEW_CHANNEL = 1 << 10; // 1024 - used to hide staff channels from @everyone

// ---- channel types ----
const T = { TEXT: 0, VOICE: 2, CATEGORY: 4 };

// ---- the server blueprint (edit freely) ----
const ROLES = [
  { name: 'Moderator',     color: 0xe63946, hoist: true },
  { name: 'Champion',      color: 0xffce3a, hoist: true },  // current tournament winner
  { name: 'Veteran Brute', color: 0x8338ec, hoist: false }, // regulars / flair
  { name: 'Brute',         color: 0x9aa0a6, hoist: false }, // base member
];

// each category lists its channels; `voice: true` makes a voice channel,
// `staff: true` hides it from @everyone (mods only).
const CATEGORIES = [
  { name: 'WELCOME', channels: [
    { name: 'rules',         topic: 'Read before you throw hands.' },
    { name: 'announcements', topic: 'Patch drops, events, and big news from the Arena.' },
    { name: 'start-here',    topic: 'New to Brutal Arena? Everything you need to start swinging.' },
  ]},
  { name: 'THE ARENA', channels: [
    { name: 'general',       topic: 'Ringside chatter. Talk brutes, brawls, and everything in between.' },
    { name: 'strategy',      topic: 'Theorycraft, stat talk, and how to fold the competition.' },
    { name: 'builds',        topic: 'Show off your loadout. Steal someone else’s.' },
    { name: 'highlight-reel', topic: 'Post your nastiest wins and clutch comebacks.' },
  ]},
  { name: 'COMPETITION', channels: [
    { name: 'leaderboard',   topic: 'Who’s sitting on top of the ladder.' },
    { name: 'tournament',    topic: 'The weekly main event. Lock a build, take the crown.' },
    { name: 'pvp-callouts',  topic: 'Call someone out. Start a rivalry.' },
    { name: 'prison-yard',   topic: 'Captured somebody? Got jailed? Trash talk goes here.' },
  ]},
  { name: 'THE FORGE', channels: [
    { name: 'help',          topic: 'Stuck? Ask here and someone’ll sort you out.' },
    { name: 'bug-reports',   topic: 'Something broke? Tell us exactly how.' },
    { name: 'suggestions',   topic: 'Ideas to make the Arena meaner.' },
  ]},
  { name: 'VOICE', channels: [
    { name: 'General',     voice: true },
    { name: 'Fight Night', voice: true },
  ]},
  { name: 'STAFF', channels: [
    { name: 'staff-chat', topic: 'Mods only.', staff: true },
    { name: 'mod-log',    topic: 'Mods only.', staff: true },
  ]},
];

// content seeded into freshly-created channels (comic-announcer voice)
const SEED = {
  'rules': [
    '**🥊 BRUTAL ARENA — HOUSE RULES 🥊**',
    '',
    'Welcome to the building. Keep it a good clean fight:',
    '',
    '**1.** Trash talk is fine. Being an actual jerk is not. Don’t cross the line.',
    '**2.** No harassment, hate, or NSFW. Instant red card.',
    '**3.** Keep posts in the right channel — builds in `#builds`, bugs in `#bug-reports`, and so on.',
    '**4.** No spam, no shady links, no advertising.',
    '**5.** Mods have the final say. Argue the call, not the ref.',
    '',
    'Now go crack some skulls. 🏆',
  ].join('\n'),
  'start-here': [
    '**👊 NEW TO THE ARENA? 👊**',
    '',
    'Brutal Arena is an idle fighting game: you raise a brute, gear it up, and shove it up every ladder in the building. The fists swing on their own.',
    '',
    '**Where to go here:**',
    '• `#announcements` — patch notes and events',
    '• `#strategy` & `#builds` — get meaner, fast',
    '• `#tournament` & `#leaderboard` — the weekly grind',
    '• `#pvp-callouts` & `#prison-yard` — start (and settle) rivalries',
    '• `#help` & `#bug-reports` — stuck or something broke',
    '',
    'Grab a name, lock in a build, and let’s brawl.',
  ].join('\n'),
};

// ---- tiny REST helper with basic 429 handling ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function api(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const wait = Math.ceil((j.retry_after || 1) * 1000) + 100;
      console.log(`  rate-limited, waiting ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    }
    await sleep(300); // be polite between calls
    return res.status === 204 ? null : res.json();
  }
  throw new Error(`${method} ${path} -> gave up after repeated rate limits`);
}

async function main() {
  // sanity: confirm the bot can see the guild
  const guild = await api('GET', `/guilds/${GUILD}`).catch(() => null);
  if (!guild) {
    console.error('Could not read the guild. Is the bot invited, and is GUILD_ID correct?');
    process.exit(1);
  }
  console.log(`Scaffolding server: ${guild.name}\n`);

  // ---- roles ----
  const existingRoles = await api('GET', `/guilds/${GUILD}/roles`);
  const roleByName = new Map(existingRoles.map(r => [r.name.toLowerCase(), r]));
  for (const r of ROLES) {
    if (roleByName.has(r.name.toLowerCase())) { console.log(`role exists: ${r.name}`); continue; }
    const made = await api('POST', `/guilds/${GUILD}/roles`, { name: r.name, color: r.color, hoist: r.hoist, mentionable: true });
    roleByName.set(r.name.toLowerCase(), made);
    console.log(`+ role: ${r.name}`);
  }

  // ---- channels (categories first, then their children) ----
  const existing = await api('GET', `/guilds/${GUILD}/channels`);
  const byKey = new Map(existing.map(c => [c.type + ':' + c.name.toLowerCase(), c]));
  const freshlyCreated = [];

  for (const cat of CATEGORIES) {
    let parent = byKey.get(T.CATEGORY + ':' + cat.name.toLowerCase());
    if (!parent) {
      parent = await api('POST', `/guilds/${GUILD}/channels`, { name: cat.name, type: T.CATEGORY });
      byKey.set(T.CATEGORY + ':' + cat.name.toLowerCase(), parent);
      console.log(`+ category: ${cat.name}`);
    } else {
      console.log(`category exists: ${cat.name}`);
    }

    for (const ch of cat.channels) {
      const type = ch.voice ? T.VOICE : T.TEXT;
      const key = type + ':' + ch.name.toLowerCase();
      if (byKey.has(key)) { console.log(`  channel exists: ${ch.name}`); continue; }
      const payload = { name: ch.name, type, parent_id: parent.id };
      if (ch.topic) payload.topic = ch.topic;
      if (ch.staff) payload.permission_overwrites = [{ id: GUILD, type: 0, deny: String(VIEW_CHANNEL) }]; // @everyone == guild id
      const made = await api('POST', `/guilds/${GUILD}/channels`, payload);
      byKey.set(key, made);
      freshlyCreated.push({ def: ch, channel: made });
      console.log(`  + channel: ${ch.name}`);
    }
  }

  // ---- seed rules / start-here into newly-created channels only ----
  if (POST_CONTENT) {
    for (const { def, channel } of freshlyCreated) {
      const body = SEED[def.name];
      if (!body) continue;
      await api('POST', `/channels/${channel.id}/messages`, { content: body });
      console.log(`  posted starter content -> #${def.name}`);
    }
  }

  console.log('\nDone. Reorder anything you like in the Discord app.');
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
