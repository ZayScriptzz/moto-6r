# moto.zxyframe.ca: spec + executor briefs (block A)

## Problem
6R Ride Prep is one HTML file (`~/moto-6r/index.html`, ~416 KB) that saves progress only in the browser (`localStorage['moto6r.state.v1']`). It goes live at moto.zxyframe.ca (GitHub Pages, public) and must sync across Zay's devices through Supabase, the way track.zxyframe.ca does (reference build: `/private/tmp/claude-501/-Users-zayblock/21b3579f-1834-44d5-8bf0-9376c0bdf669/scratchpad/puff/index.html`, lines 471–1690: email + password sign-in, offline cache, sync on focus/online).

## Fixed facts (do not change)
- Supabase project URL `https://chqogvxuoeypraplllhx.supabase.co`. Client key: the legacy anon key, the exact `SB_KEY` string at line 477 of the reference build above (public by design; RLS protects the data).
- Library: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>` (same pinned build as track; its calls `createClient`, `auth.getSession`, `auth.signInWithPassword`, `auth.signOut`, `auth.onAuthStateChange`, `from().select().eq().maybeSingle()`, `from().upsert()` are proven live there).
- Tables (already created, RLS on):
  - `public.moto_progress (user_id uuid pk default auth.uid() → auth.users, state jsonb NULL, updated_at timestamptz)`: a signed-in user reads and writes only their own row.
  - `public.moto_assets (key text pk, data jsonb, updated_at)`: signed-in users can select. Row `key='cropimg'` holds the 16 book crops as `{ name: "data:image/webp;base64,…" }`, the same shape `window.CROPIMG` had.
- `localStorage` key `moto6r.state.v1` keeps holding the state JSON (same shape as the offline build, so exports and imports stay compatible). Sync metadata goes in a NEW key `moto6r.sync.v1` = `{ uid, savedAt, dirty }`.
- Look (unslop polish mode, direction from the 2026-11-11 pass): only existing tokens (`--bg --bg2 --panel --panel2 --raised --line --line2 --ink --ink2 --mute --amber --amber2 --red --green`), existing classes (`.wrap .card .btn .btn.pri .btn.lg .btn.ghost .btn.danger .eyebrow .lede .meta .mono .sub .row .dot`). Amber appears only on the primary button and the focus border. No new colours, no glows, no gradients, no emoji, no exclamation marks, weights ≤600, every spacing value a multiple of 4.

## Definition of done (all three tasks)
1. Signed out: the sign-in screen shows, the app view and header chips are hidden.
2. Signed in on device A, a change syncs to the server; device B signing in later sees it; a change on B reaches A when A's tab becomes visible again.
3. Offline or a server error: changes stay in `localStorage` with `dirty: true` and push on the next `online`/`visibilitychange`; every catch logs `console.warn('[moto6r] …', err)` (no silent fallback).
4. Book crops: absent from `index.html`; load from `moto_assets` after sign-in and switch `CONFIG.bookCrops` on; a failed load warns loudly and the app shows "See the guide, p. X".
5. `python3 test/check_scripts.py index.html` → `0 failed`.

---

## Task 1: sync engine + sign-in gate (one commit, ≤120 changed lines)

**Sweep first (rule 19).** `grep -n -F` each of `Store.`, `moto6r.`, `CROPIMG`, `bookCrops`, `id="app"`, `id="chips"` in `index.html`; list every hit with its line in your report and make sure each consumer still works after your change.

1. Markup. Right after `<main class="wrap" id="app"></main>` add:
```html
<main class="wrap auth" id="auth" hidden>
  <div class="auth-in">
    <div>
      <p class="eyebrow">SAAQ Class 6R knowledge test · motorcycle section</p>
      <h1>Ride the guide on any device</h1>
      <p class="lede">Sign in and your mastered concepts, due reviews and campaign stop follow you between your phone and your laptop.</p>
    </div>
    <form class="card auth-card" id="auth-form" novalidate>
      <h3>Sign in</h3>
      <label for="auth-email">Email</label>
      <input id="auth-email" type="email" autocomplete="email" autocapitalize="off" spellcheck="false">
      <label for="auth-pass">Password</label>
      <input id="auth-pass" type="password" autocomplete="current-password">
      <button type="submit" class="btn pri lg" id="auth-go">Sign in</button>
      <p class="auth-err" id="auth-err" role="alert"></p>
    </form>
  </div>
</main>
```
2. CSS, inserted just before `@media (max-width:720px){`:
```css
/* sign-in */
.auth-in{display:grid;grid-template-columns:1fr 360px;gap:32px;align-items:center;min-height:calc(100vh - 200px)}
.auth-card{display:flex;flex-direction:column}
.auth-card h3{margin-bottom:16px}
.auth-card label{font-size:13px;color:var(--ink2);margin-bottom:8px}
.auth-card input{height:44px;background:var(--bg2);border:1px solid var(--line2);border-radius:10px;padding:0 12px;color:var(--ink);font:15px var(--font-ui);margin:0 0 16px;transition:border-color .15s var(--ease)}
.auth-card input:focus{outline:none;border-color:rgba(242,194,0,.6)}
.auth-card .btn{margin-top:8px;width:100%}
.auth-card .btn:disabled{opacity:.6;cursor:default}
.auth-err{color:#ff8a6e;font-size:13px;margin-top:12px;min-height:20px}
```
and inside the existing `@media (max-width:720px){…}` block add `.auth-in{grid-template-columns:1fr;min-height:0;gap:24px;margin-top:8px}`.

3. Add the supabase-js `<script src>` tag (fixed facts) immediately before the Store `<script>` (the one that starts `/* ONE storage layer.`).

4. Rewrite that Store script. Keep `LocalAdapter` and the `window.Store` methods the app already calls (`load`, `save` with its 250 ms debounce, `reset`, `exportJSON`, `adapterName`). Update the header comment to describe the website build. Add:
   - `Store.ready`: a Promise the app awaits before its first `Store.load()`; resolved by `Store.start(adapter)`.
   - `SupabaseAdapter(sb, uid)` (factory), name `'supabase'`, with `meta` = `moto6r.sync.v1` (reset to `{uid, savedAt:0, dirty:false}` when absent or `meta.uid !== uid`; the cached state only counts when `meta.savedAt > 0` for this uid) and `lastError`:
     - `pull()`: `select('state,updated_at').eq('user_id', uid).maybeSingle()` → `{state, at: Date.parse(updated_at)}` or `null`; throws on `error`.
     - `push()`: only if `meta.dirty`; `upsert({ user_id: uid, state: <cached state>, updated_at: new Date(meta.savedAt).toISOString() })`; on success clear `dirty` only if `meta.savedAt` did not change during the request.
     - `load()`: pull; if the server row is newer than `meta.savedAt` (or there is no local copy) take it (write cache + meta, `dirty:false`); else if local is dirty, push; return the chosen state. On error: warn and return the local copy.
     - `save(state)`: write the cache and meta (`savedAt: Date.now(), dirty: true`) synchronously, then push; on error warn and keep it dirty.
     - `refresh()`: push pending, then pull; if the server is newer, write cache + meta and return the new state, else `null`. Errors warn.
   - `Store.flush()`: if a debounced save is pending, run it now. Call it on `pagehide`.
   - `Store.onRemote(fn)` and `Store.refresh()`: flush, then `adapter.refresh()`; when it returns a state, set the in-memory copy and call `fn(state)`.
   - `Store.status()` → `{ adapter: name, pending: !!meta?.dirty, error: !!lastError }`.
   - Auth gate in the same script (or a second script right after it), modelled on the reference build lines 1602–1690: `createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })`; `getSession()` → session ? `enter(session)` : `showAuth('')`. `showAuth(msg)` hides `#app` and `#chips` and shows `#auth`. `enter(session)` hides `#auth`, shows `#app` and `#chips`, sets `Store.email = session.user.email`, and calls `Store.start(SupabaseAdapter(sb, session.user.id))`. Form submit: empty fields → "Enter your email and password"; button disabled with the text "Signing in…" while waiting; `/invalid login/i` → "Wrong email or password"; network throw → "Couldn’t reach the server. Try again". No library (`!window.supabase`) → `showAuth('Couldn’t load the sign-in library. Check your connection and reload')`. `onAuthStateChange`: `SIGNED_OUT` after entering → `location.reload()`. Once entered: `visibilitychange` (visible) and `online` → `Store.refresh()`.
   - `Store.signOut()`: flush; if still dirty after one push attempt return `'pending'`; else `sb.auth.signOut()`, remove `moto6r.state.v1` and `moto6r.sync.v1`, `location.reload()`.

5. App boot (the `// ───────────── boot ─────────────` block near the end): add `const hydrate = saved => Object.assign(DEF(), saved, { settings: Object.assign(DEF().settings, saved.settings) });`, `await Store.ready;` before `Store.load()`, use `hydrate` there, and register `Store.onRemote(saved => { if (!saved || saved.v !== 1) return; S = hydrate(saved); route(); toast('Progress updated from your other device'); });`. Expose `hydrate` on `window.__app` (Task 2 uses it).

**Verify:** `python3 test/check_scripts.py index.html` → `0 failed`. Then serve and screenshot the sign-in state:
`cd ~/moto-6r && (python3 -m http.server 8765 >/dev/null 2>&1 &) && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir=$(mktemp -d) --window-size=1280,900 --virtual-time-budget=6000 --screenshot=/private/tmp/claude-501/-Users-zayblock/21b3579f-1834-44d5-8bf0-9376c0bdf669/scratchpad/shots/t1-signin.png http://localhost:8765/`
Look at the png: the sign-in screen must show, with no app content under it. Commit: `Add Supabase sync and sign-in to 6R Ride Prep`.

## Task 2: settings progress card + login-only book crops (one commit, ≤120 changed lines)

1. In `enter(session)` (Task 1), after `Store.start`, fetch `sb.from('moto_assets').select('data').eq('key','cropimg').maybeSingle()`. On success with data: `window.CROPIMG = row.data; window.CONFIG.bookCrops = true;` and if `(location.hash || '#home').startsWith('#diagrams')` dispatch a re-render (call the app's `route` through a `window.dispatchEvent(new Event('hashchange'))`). On error or no row: `console.warn('[moto6r] book illustrations failed to load', err)`.
2. Diagrams page: where it now prints `The guide has no illustration for this one.` when `window.CROPS[k]` exists but `CONFIG.bookCrops` is false, print `See the guide, p. ${window.CROPS[k]}` instead (keep the old text for keys with no `CROPS` entry).
3. Settings "Your progress" card → class `card progress-card`:
   - `<p class="sub">` "Saved to your account and synced across your devices. Signed in as <span class="mono">{email, escaped}</span>." (when `Store.adapterName === 'local'`: "Saved in this browser on this device.")
   - `<p class="meta sync-line"><span class="dot {ok|wait}"></span>{text}</p>`, from `Store.status()`: not pending → `ok` "All changes synced"; pending + error → `wait` "Changes saved on this device, waiting to sync"; pending, no error → `wait` "Syncing…".
   - Button row: `Export progress (JSON)` `#exp` (unchanged), `Import progress (JSON)` `#imp` + hidden `<input type="file" id="impf" accept="application/json,.json" hidden>`, `<span class="push"></span>`, `Sign out` `.btn.ghost` `#out`, `Reset everything` `.btn.danger` `#rst`.
   - CSS (beside the Task 1 block): `.progress-card{grid-column:1/-1}` `.progress-card .push{flex:1}` `.settings .progress-card p.sub{margin:8px 0 8px}` `.settings .progress-card .sync-line{display:flex;align-items:center;gap:8px;margin:0 0 16px}` `.dot.ok{background:var(--green)}` `.dot.wait{background:var(--amber2)}`.
   - Import: `#imp` → `#impf.click()`; on change read the file text, `JSON.parse` in try/catch; not an object with `v === 1` → toast "That file isn’t a 6R Ride Prep progress export"; else `confirm('Replace the progress on your account with this file?')` → `S = hydrate(obj); save(); route(); toast('Progress imported')`.
   - Sign out: `#out` → `const r = await Store.signOut(); if (r === 'pending') toast('Some changes haven’t synced yet. Reconnect, wait a moment, then sign out');`
   - Reset confirm text → `Erase all progress on your account? This clears it on every device.`

**Verify:** `python3 test/check_scripts.py index.html` → `0 failed`. Commit: `Add sync status, import and sign-out to the progress card`.

## Task 3: two-device E2E test (one commit)

Write `test/sync-e2e.mjs` (Node 26: built-in `fetch` and `WebSocket`, no npm installs). Pattern for driving headless Chrome over CDP: `~/.claude/skills/zxy-websites/tools/cdp-check.mjs` (read it, do not edit it). Usage: `MOTO_TEST_EMAIL=… MOTO_TEST_PASS=… node test/sync-e2e.mjs <baseUrl>`.

Two Chrome instances, each with its own fresh `--user-data-dir` (device A and device B). Print `PASS`/`FAIL` with a reason per step, exit 1 on any FAIL, and always kill both Chromes and remove both profiles in `finally`.
1. A opens the URL: `#auth` visible and `#app` hidden.
2. A fills `#auth-email` / `#auth-pass`, submits `#auth-form`; within 15 s `#app` is visible and `#auth` hidden.
3. A: `x0 = __app.S.xp`; run `__app.S.xp += 7; Store.save(__app.S)`; within 10 s `JSON.parse(localStorage['moto6r.sync.v1']).dirty === false`.
4. B opens and signs in the same way; within 15 s `__app.S.xp === x0 + 7`.
5. B: `__app.S.xp += 5; Store.save(__app.S)`; wait for `dirty === false`.
6. A: `document.dispatchEvent(new Event('visibilitychange'))`; within 10 s `__app.S.xp === x0 + 12`.
7. A: `Object.keys(window.CROPIMG).length === 16 && window.CONFIG.bookCrops === true`.
8. Without a session (plain `fetch` with only the anon key headers `apikey` + `Authorization: Bearer <anon>`): `GET <SB_URL>/rest/v1/moto_assets?select=key` and `GET <SB_URL>/rest/v1/moto_progress?select=user_id` each return status 200 with `[]`, or status 401/403/404 (any of these = PASS; data in the body = FAIL).
9. No uncaught exception (`Runtime.exceptionThrown`) on A or B during the run (`[moto6r]` warnings are allowed and printed).

**Verify:** `node --check test/sync-e2e.mjs`. Do NOT run it against the server: the test user is created by the lead, and a Sonnet tester runs it. Commit: `Add two-device sync E2E test`.
