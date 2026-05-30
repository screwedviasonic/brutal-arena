# Supabase setup — beginner walkthrough

You don't need to write any code here. ~15 minutes of clicking. Follow in order.
When you finish, you'll send Claude two values (a URL and a key) and it builds the rest.

---

## Part 1 — Make a Supabase account + project

1. Go to **https://supabase.com**
2. Click **Start your project** (top right).
3. Sign in with **GitHub** (you already have a GitHub account — easiest option).
   Authorize Supabase when GitHub asks.
4. You land on the dashboard. Click **New project**.
   - If it asks you to create an **organization** first: name it anything
     (e.g. `personal`), plan **Free**, click create.
5. Fill the new-project form:
   - **Name:** `brutal-arena`
   - **Database Password:** click **Generate a password**, then copy it and
     paste it somewhere safe (a notes file). You probably won't need it for
     this, but never lose it.
   - **Region:** pick the one closest to you (e.g. *East US* / *West US*).
   - **Plan:** Free.
6. Click **Create new project**. It provisions for ~2 minutes (spinner).
   Wait until the dashboard shows your project is ready.

---

## Part 2 — Create the database tables

1. In the left sidebar, click the **SQL Editor** icon (looks like `>_`).
2. Click **+ New query** (or you'll see a blank editor).
3. Open the file **`pvp/schema.sql`** from your project folder in any text
   editor, **select all** (Ctrl+A), **copy** (Ctrl+C).
4. Paste it into the Supabase SQL editor (Ctrl+V).
5. Click the green **Run** button (bottom right), or press **Ctrl+Enter**.
6. You should see **“Success. No rows returned.”** at the bottom. ✅
   (If you see a red error, copy the error text and send it to Claude.)

> Sanity check: left sidebar → **Table Editor**. You should now see three
> tables: `accounts`, `ladder`, `matches`.

---

## Part 3 — Turn on sign-in

We'll use **Anonymous sign-in** first — it gives every player an instant
account with no email/password, perfect for testing.

1. Left sidebar → **Authentication**.
2. Find **Sign In / Providers** (newer UI) or **Providers** / **Configuration**.
3. Look for **Anonymous sign-ins** and toggle it **ON**. Save.
4. *(Optional, for real logins later)* In the **Email** provider, you can turn
   it on too. If you do, also turn **OFF** “Confirm email” while testing so you
   don't have to click a confirmation link every time.

---

## Part 4 — Copy the two values Claude needs

1. Left sidebar → **Project Settings** (the gear icon at the bottom).
2. Click **API** (or **API Keys**).
3. Copy these **two** things:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **The public client key** — labeled **`anon` `public`** (a long string
     starting with `eyJ...`). On newer projects it may instead be called
     **Publishable key**, starting with `sb_publishable_...`. Either one is
     the right, safe-to-share key.

### ⚠️ Important
- The **anon / publishable** key is *designed to be public* (it gets embedded
  in the game's code). Sending it in chat is fine and expected.
- There is also a **`service_role`** / **secret** key on that page. **Do NOT
  send that one** anywhere. Claude doesn't need it — Supabase gives the server
  function its own secret automatically.

---

## Part 5 — Send to Claude

Paste back:

```
Project URL: https://xxxxxxxx.supabase.co
anon key:    eyJ............ (or sb_publishable_............)
```

That's it. Claude wires up the PvP tab, the server fight function, and the
leaderboard from there.
