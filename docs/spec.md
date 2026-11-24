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

---

# Block B: systems map rebuild (Zay picked "System cards", 2026-11-24)

Work happens on branch `map-cards` in the worktree `~/moto-6r-work/map-cards` (NOT in ~/moto-6r). Nothing merges to main or gets pushed until Zay sees the prototype screenshots and says yes.

## Why (root cause, one sentence)
`mapView()` places 112 concepts with a global repulsion simulation that has no containment and draws them into a fixed 1560×1180 SVG viewBox, so dots drift out of their system boxes and onto titles, 11px labels render at ~7px and overlap, every cross-system link is drawn at once, and on a phone the whole graph shrinks to a thumbnail under the panel.

## Feel-ladder sheet (moment: selecting a concept)
```
Moment: concept select   Tier: Few   Top rung: 4
Metaphor: none drawn (lines are road-paint amber, the app's accent)
1 Designed:  selected row = hero (amber dot ring + ink label + raised surface) | input = tap/click a row | hit area = whole row, min-height 36px (44px under 720px)
2 Alive:     links draw out from the selected dot (stroke-dashoffset length→0, 280ms var(--ease), 24ms stagger) | dim of the rest = opacity 160ms
3 Polished:  only lines + opacity animate; selecting never changes any size (no border-width change); counts tabular mono
4 Playable:  interruptible: a new tap clears old lines at once and draws the new set; panel chips select + smooth-scroll the row to centre | no sound | momentum n/a (tap control)
5 Real:      skipped (gate)
6 Ships:     rows are <button>s with aria-pressed; Enter/Space select, Escape clears; panel aria-live="polite"; reduced motion = lines appear at once (global rule already kills transitions); context kept: legend, Home, "Drill this"
Felt check for Zay: tap Traction: do amber lines grow out of its dot to every linked concept in a blink while everything else steps back? Tap another concept mid-draw: does it switch at once?
```

## Presentation (acceptance criteria, all measured in the prototype)
P1. Every concept row sits inside its own system card: for every `.cpt`, `CON[row.dataset.c].n === row.closest('.sys').dataset.n`.
P2. Concept labels are full text (no ellipsis, no `slice`), computed font-size ≥ 14px.
P3. 1280×900: the panel is a sticky column on the right and its rect does not intersect any `.sys` rect.
P4. 390 px wide: `document.documentElement.scrollWidth <= innerWidth`; cards stack in one column; the sheet is off-screen until a concept is selected, then on-screen with "Drill this".
P5. Selecting a concept with N links draws exactly N `path`s in `#mlines`; each path starts within 6 px of the selected row's dot centre and ends within 6 px of a linked row's dot centre.
P6. While a concept is selected, rows that are neither it nor linked to it have computed opacity ≤ 0.4.
P7. Escape (or tapping the selected row again) → 0 paths, no dimming, panel back to its default text.
P8. Tokens only. Amber appears only on: the selected row's dot ring, the lines, the linked rows' end dots, the "Drill this" button.
P9. No uncaught exception or console error on #map.

## Task 4a: cards, panel, selection (one commit, ≤120 changed lines)
Replace the body of `mapView()` (from `const cc = scoped()` to the end of `sideFor`) and the map CSS. Keep the function name and the `map` route.
- Sweep first: `grep -n -F` each of `mapwrap`, `.side`, `#side`, `data-side`, `msvg`, `mg`, `map-legend`, `sideFor` in index.html; list hits; remove `.mapwrap*` and `.side*` rules only if nothing else uses them.
- Markup, in order: the existing Home ghost button; header row as now (h2 "Systems map", sub "Tap a concept to see what it affects and what affects it.", the existing legend); then `<div class="map2"><div class="map2-body" id="mbody">…chapters…<svg id="mlines" aria-hidden="true"></svg></div><aside class="mpanel" id="mpanel" aria-live="polite">…</aside></div>`.
- Chapters: iterate `B.nodes.filter(n => n.sec === 'moto')` in order, start a new chapter block whenever `CH_START[n.id]` exists (`<div class="sec-h"><h3>${CH_START[id]}</h3></div>` then a `.sys-grid`). Use the `CH_START` constant already defined for the campaign (move it to a shared scope if it is local to another function; say so in the report). A system card is emitted only if `scopedNode(n.id)` is non-empty.
- System card: `<section class="sys" data-n="${n.id}"><div class="sys-h"><span class="sys-t">${esc(n.title)}</span><span class="meta mono">${m}/${total}</span></div>` then one `<button class="cpt" data-c="${c.id}" aria-pressed="false"><span class="dot ${status(c)}"></span><span>${esc(c.t)}</span></button>` per concept in `scopedNode(n.id)` order.
- Links: the same edge set as today (both directions, both ends in scope, no self-links).
- Selection: clicking a `.cpt` sets `#mbody.focus`, `.on` + `aria-pressed="true"` on it, `.nb` on linked rows, `.nbs` on cards holding the selected row or a linked row; renders the panel (content = today's `sideFor` content, unchanged wording, plus its chips call the same select function and `scrollIntoView({block:'center', behavior:'smooth'})` the row). Clicking the selected row again, Escape, or a click on empty `#mbody` space clears. Remove the keydown listener through the existing `cleanup` array (look at how the scenario player registers it).
- Default panel: `<h3>Pick a concept</h3><p class="sub">Each concept is one idea from the guide. Lines show the ideas it explains or depends on. Drilling a concept asks it in several different ways.</p>`
- CSS (put it where `.mapwrap` was):
```css
.map2{display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start}
.map2-body{position:relative}
.map2-body .sec-h:first-child{margin-top:0}
.sys-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.sys{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px 12px 12px;transition:opacity .16s var(--ease)}
.sys-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:0 8px 8px}
.sys-t{font:600 20px/1.1 var(--font-d)}
.cpt{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;background:none;border:0;border-radius:8px;text-align:left;font-size:14px;line-height:20px;color:var(--ink2);cursor:pointer;transition:background-color .15s var(--ease),color .15s var(--ease),opacity .16s var(--ease)}
.cpt:hover{background:var(--panel2);color:var(--ink)}
.cpt .dot{box-shadow:0 0 0 2px transparent;transition:box-shadow .15s var(--ease)}
.cpt.on{background:var(--raised);color:var(--ink)}
.cpt.on .dot{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--amber)}
.cpt.nb{color:var(--ink)}
.cpt.nb .dot{box-shadow:0 0 0 2px var(--bg),0 0 0 3px rgba(242,194,0,.6)}
.focus .cpt:not(.on):not(.nb){opacity:.35}
.focus .sys:not(.nbs){opacity:.6}
#mlines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
#mlines path{fill:none;stroke:var(--amber);stroke-width:1.5;stroke-linecap:round;opacity:.85;transition:stroke-dashoffset .28s var(--ease)}
.mpanel{position:sticky;top:72px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:20px;max-height:calc(100vh - 96px);overflow:auto}
.mpanel p{margin-top:8px}
.mpanel .x{display:none}
```
  and inside `@media (max-width:720px)`: `.map2{grid-template-columns:1fr}` `.cpt{min-height:44px}` `.mpanel{position:fixed;left:8px;right:8px;bottom:8px;top:auto;max-height:55vh;z-index:30;transform:translateY(calc(100% + 16px));transition:transform .24s var(--ease);border-color:var(--line2)}` `.mpanel.open{transform:none}` `.mpanel .x{display:inline-flex;position:absolute;top:8px;right:8px}`. Under 980px and above 720px use one column too (add `@media (max-width:980px){.map2{grid-template-columns:1fr}.mpanel{position:static;max-height:none}}` before the 720 block).
- On phones the panel gets `.open` when a concept is selected and a close button `<button class="btn ghost x" aria-label="Close">${I.x}</button>` that clears the selection.

**Verify:** `python3 test/check_scripts.py index.html | tail -1` → `11 inline scripts, 0 failed`. Commit: `Rebuild systems map as system cards`.

## Task 4b: connection lines (one commit, ≤60 changed lines)
- `drawLines()`: clear `#mlines`; if a concept is selected, for each linked row compute both dot centres relative to `#mbody` (`getBoundingClientRect` minus `#mbody`'s rect), and append `<path d="M x1 y1 C cx1 cy1, cx2 cy2, x2 y2">` where the control points pull horizontally (`dx = Math.max(40, Math.abs(x2 - x1) / 2)`; `cx1 = x1 + dx*sign`, `cx2 = x2 - dx*sign`, `sign = x2 >= x1 ? 1 : -1`; when `|x2 - x1| < 24` pull sideways instead: `cx1 = cx2 = Math.max(x1, x2) + 64`, `cy1 = y1`, `cy2 = y2`). Set the SVG `viewBox` / size to `#mbody`'s box.
- Draw-in: each path gets `stroke-dasharray = stroke-dashoffset = getTotalLength()`, then on the next frame `stroke-dashoffset = 0` with `transition-delay = i * 24ms`, ordered by path length (shortest first). A new selection clears old paths at once (no fade-out queue).
- Redraw on selection, on a `ResizeObserver` of `#mbody`, and after `document.fonts.ready`. Disconnect the observer through `cleanup`.

**Verify:** check_scripts → `0 failed`. Then the presentation checks P1–P9 with headless Chrome against `python3 -m http.server 8768` served from the worktree (use the CDP pattern in `~/moto-6r-work/cdp-shot.mjs`). The map sits behind the sign-in gate: sign in with the test account through the form exactly like test/sync-e2e.mjs does (`set -a; . ~/moto-6r-work/test.env; set +a`). Do not bypass or edit the gate. Screenshots into `~/moto-6r-work/shots/map/`: `desk-default.png`, `desk-selected.png` (select concept `traction` if it exists, else the concept with the most links), `phone-default.png`, `phone-selected.png` (390×844, mobile emulation). Commit: `Draw amber connection lines on the systems map`.

---

# Block C: QA fixes from the Chrome pass (after the map merges; same worktree flow)

## Task C1: real titles on the Diagrams page (one commit, ≤20 changed lines)
Root cause: `diagrams()` prints the raw SVG key (`gears`, `counterbal`, …) as each card's `<h3>`.
Fix: title = the `t` of the first concept in `B.concepts` whose `img === key`; else the `title` of the first scenario in `B.scen` that has a step with `img === key`; else the key. Escape it with `esc`. Every one of the 17 keys in `window.SVGS` is used by at least one concept or scenario (`grep -o "img: '…'"` count, 2026-11-24).
Verify: check_scripts `0 failed`; on #diagrams (signed in) `[...document.querySelectorAll('#app .card h3')].map(h => h.textContent)` contains no string equal to a key of `window.SVGS`.

## Task C2: overlaps in the redrawn diagrams (one commit, ≤120 changed lines)
Root cause: hand-placed SVG text and paths collide in four diagrams (seen in Chrome at 1200 px, 2026-11-24):
- `S.rider`: "Elbows slightly bent" and "Wrists slightly bent" leader lines cross and both labels crowd the arm; "Knees hug the tank" leader line runs through the leg.
- `S.counterbal`: "Body shifts to the OUTSIDE" text sits on the arrow head.
- `S.countersteer`: the caption "Countersteering · above ~25 km/h · right-hand curve" sits on the road drawing.
- `S.trajectory`: the orange paths of the two panels cross the gap into the other panel; the yellow top caption sits on the road.
Fix only those four. Move labels and leader lines so no text overlaps another text, a path or a shape's edge, give each caption its own empty band (enlarge the viewBox height if needed), and clip each trajectory panel to its own rectangle (`<clipPath>`). Keep colours, wording and the drawing style.
Verify: check_scripts `0 failed`; screenshot each of the four cards on #diagrams (signed in, 1280×900) into `~/moto-6r-work/shots/diagrams/<key>.png` and confirm by eye that nothing overlaps. Also confirm with `getBBox()` that no two `<text>` elements in each of the four SVGs intersect (print the pairs checked and the count of intersections, expected 0).
