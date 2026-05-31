# Brutal Arena - Discord server setup

`setup-server.mjs` builds the whole server layout (roles, categories,
channels, topics, plus starter rules/start-here text) in one shot via the
Discord API. Zero dependencies (needs Node 18+). Re-running it is safe: it
skips anything that already exists by name and only fills in what's missing.

## What it builds

- **Roles:** Moderator, Champion, Veteran Brute, Brute
- **WELCOME:** `#rules`, `#announcements`, `#start-here`
- **THE ARENA:** `#general`, `#strategy`, `#builds`, `#highlight-reel`
- **COMPETITION:** `#leaderboard`, `#tournament`, `#pvp-callouts`, `#prison-yard`
- **THE FORGE:** `#help`, `#bug-reports`, `#suggestions`
- **VOICE:** General, Fight Night
- **STAFF (hidden from @everyone):** `#staff-chat`, `#mod-log`

Edit the `ROLES` / `CATEGORIES` arrays at the top of the script to change any of it.

## One-time setup (about 5 minutes)

1. **Create the server.** In Discord: the `+` on the left rail -> *Create My Own*.
   You stay the owner.

2. **Make a bot.** Go to <https://discord.com/developers/applications> ->
   *New Application* (name it whatever) -> **Bot** tab -> *Reset Token* ->
   copy the token. Keep it secret. No privileged intents are needed.

3. **Invite the bot** with permission to build things. On the **OAuth2 ->
   URL Generator** page tick scope **`bot`**, then permissions
   **Manage Roles**, **Manage Channels**, **View Channels**, **Send Messages**.
   Open the generated URL and add the bot to your server. (Or use this, with
   your application's Client ID swapped in:)
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=268438544
   ```

4. **Grab the server ID.** Discord Settings -> *Advanced* -> turn on
   **Developer Mode**. Right-click the server icon -> *Copy Server ID*.

## Run it (PowerShell)

```powershell
$env:DISCORD_TOKEN = "the-bot-token-from-step-2"
$env:GUILD_ID      = "the-server-id-from-step-4"
node discord/setup-server.mjs
```

Set `$env:POST_CONTENT = "0"` first if you want the empty channels without the
seeded rules/start-here messages.

## Notes

- The bot only needs to be in the server while you run this. You can kick it
  afterward; the channels and roles stay.
- The script never posts on an ongoing basis. It only seeds the static
  rules/start-here text once, into channels it just created.
- Want auto-announcements later (weekly tournament champ, leaderboard)? That's
  a separate webhook/bot job, easy to add on top of this layout.
