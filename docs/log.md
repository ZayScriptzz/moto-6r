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
