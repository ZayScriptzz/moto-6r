# 6R Ride Prep

Study app for the SAAQ Class 6R motorcycle knowledge test. One static page (`index.html`), synced across devices through Supabase. Live at https://moto.zxyframe.ca.

## How it is wired

- Hosting: GitHub Pages, custom domain in `CNAME`.
- Data: Supabase project `PuffTracker` (shared with track.zxyframe.ca, same sign-in). Table `moto_progress` holds one row per user (the whole study state as JSON). Table `moto_assets` holds the book illustrations, readable only when signed in, so they are never in this public repo.
- Privacy: row-level security means a signed-in user can only read and write their own progress row. The Supabase URL and anon key in `index.html` are public by design and give a signed-out visitor no access. New sign-ups are off; users are added in the Supabase dashboard.
- Offline: progress is cached in `localStorage` (`moto6r.state.v1`, sync state in `moto6r.sync.v1`). Changes made offline push on the next focus or reconnect; the newer copy wins.
- Moving progress from the offline file: Settings & data → Export progress (JSON) in the old file, then Import progress (JSON) on the website.

## Checks

- `python3 test/check_scripts.py index.html`: syntax check of every inline script.
- `MOTO_TEST_EMAIL=… MOTO_TEST_PASS=… node test/sync-e2e.mjs <url>`: two headless Chrome profiles act as two devices and check sync both ways (needs a test user).
