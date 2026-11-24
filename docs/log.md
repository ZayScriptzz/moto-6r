# moto.zxyframe.ca: log (append-only)

## 2026-11-24 10:33 EST: rulings from Zay
- Auth + DB: "Approved: PuffTracker project". moto shares the PuffTracker Supabase project and its one user (same email and password as track.zxyframe.ca). Sign-ups already off there.
- SAAQ book crops: keep them, but Zay's reason was "it's login based ... so it's private". The page is public on GitHub Pages, so the crops were moved out of `index.html` into table `moto_assets` (select only for signed-in users) and load after sign-in. Git history restarted so no public commit holds them.
- Sync test: throwaway test user allowed, deleted afterwards.
- New scope: systems map dots misaligned + feel not working; Chrome QA of every other system (block B).
- unslop skill applies to the new UI (sign-in screen, settings progress card). Polish mode: direction from the 2026-11-11 pass (asphalt neutrals, amber only on primary/progress/current/selection, Barlow Condensed 600 sentence case, Inter, weights ≤600, lucide icons, painted lane dash).

## 2026-11-24 10:33 EST: done
- A1: migration `moto_progress_and_assets` applied (RLS on both; anon revoked; authenticated: CRUD own row on progress, select on assets).
- A2: `index.html` 949 KB → 416 KB; `CONFIG.bookCrops` false until crops load.

## 2026-11-24 11:13 EST: Task 1
- Zay raised the cap for Task 1 only: 156 changed lines (35 deleted dead draft lines + 31 spec-verbatim markup/CSS). Committed as "Add Supabase sync and sign-in to 6R Ride Prep".
- Supabase: "Allow new users to sign up" was ON despite the PuffTracker README; Zay approved turning it off; off and saved (verified after reload).

## 2026-11-24 11:24 EST: block A deploy + block B QA findings
- A6: test user moto-e2e@example.com (uid f6a37058…) created by SQL (dashboard password entry is off-limits for the lead); creds only in ~/moto-6r-work/test.env (600). Crops uploaded to moto_assets via a temporary insert policy for that uid; policy dropped, insert revoked; authenticated now SELECT-only on moto_assets; anon has nothing on either table.
- A7: repo ZayScriptzz/moto-6r (public; no book-crop bytes in any commit, checked with git log -p). Pages on main, CNAME moto.zxyframe.ca, build "built". Namecheap CNAME moto → zayscriptzz.github.io. added after Pages claimed the name; resolves on pdns1 and 1.1.1.1. HTTP 200 live; HTTPS cert pending.
- B1 Chrome QA (local copy, desktop 1200 + phone 390):
  - Map: nodes escape their system boxes (global repulsion, no containment), dots sit on box titles, labels overlap, 11px text in a 1560 viewBox (~7px on screen), cross-system edges everywhere, side panel covers clusters; on phone the map is a thumbnail under the panel; wheel zoom ignores the cursor.
  - Diagrams page: card titles are raw keys (gears, counterbal…); redrawn SVG overlaps in rider (labels), counterbal (label on arrow), countersteer + trajectory (captions on the drawing), trajectory paths cross between its two panels.
  - Book crops misframed (cut text columns): gears p.42, twosec p.97, thirds p.101, merge p.111, rail p.127. Needs the guide PDF (not readable from here).
  - Physics lab: perception band dominates the lane, braking band is a sliver at the horizon, yellow band covers the centre line.
  - Home on phone: 17 route stops crowd into one chain.
  - No console errors on any screen visited (campaign, node, scen, play, lab, burst, diagrams, map, settings).

## 2026-11-24 11:29 EST: A8 sync proven
- Tester (Sonnet) first run: step 6 failed because the test checked dirty=false before the 250 ms debounced save ran (false PASS at step 5); fixed in a66aafc (wait for savedAt to advance) + profile cleanup retries.
- Re-run local against live Supabase: 10/10 PASS twice (fresh and existing progress). Red run on 5d04e2d: FAIL as expected (no sync code).
- Live run blocked: GitHub has no cert yet (it cached NXDOMAIN when Pages was enabled before the DNS record; SOA negative TTL 3601 s), and Chrome auto-upgrades http to https, so the page errors in Chrome until the cert exists.
- Zay picked "System cards" for the map. Block B spec + feel-ladder sheet in spec.md; prototype on branch map-cards (worktree ~/moto-6r-work/map-cards).

## 2026-11-24 11:48 EST: map shipped
- Zay: "Ship it" for the system-cards map (prototype 0ba76b3 + f65694a + 07e34bd; 4c needed a lead ruling: 50vh sheet could not hold the panel, so the Drill row is pinned and the phone sheet is min(60vh, 100vh-160px); amber keyboard focus ring allowed under P8).
- main fast-forwarded to 07e34bd; check_scripts 0 failed; sync E2E re-run before push.
- Block C starts on branch qa-fixes in the same worktree.
