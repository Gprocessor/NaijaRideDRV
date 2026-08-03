# NaijaRide — Fixes applied to this codebase

This is your full codebase with the driver-flow bugs fixed. Build-verified:
a complete `next build` compiles all pages (28/28), including the two pages
that were missing before.

## 1) Missing driver pages (the "create trip not working" bug)  — ADDED
The driver dashboard and navbar link to these routes, but the page files did
not exist, so clicking them 404'd:
- **app/driver/trips/new/page.tsx**  — Publish a trip (pick approved vehicle,
  route, schedule, price, seats). Robust: inserts only guaranteed core columns,
  then attaches pickup/drop-off as a best-effort update so a missing column can
  never block trip creation.
- **app/driver/vehicles/page.tsx**   — Manage vehicles (add/list/delete). Robust:
  photo upload is best-effort, so a missing storage bucket won't block adding a car.

## 2) request_booking SQL bug (booking failed)  — FIXED  (supabase/02_functions.sql)
- Added `extensions` to the function search_path and qualified
  `extensions.gen_random_bytes(6)` — pgcrypto lives in the `extensions` schema,
  so the old `set search_path = public` made booking throw
  "function gen_random_bytes(integer) does not exist".
- Removed the fragile `insert into public.bookings(reference_placeholder_ignore)…`
  no-op guard that deliberately raised an exception.

## 3) Schema hardening  — FIXED  (supabase/01_schema.sql)
- Qualified `extensions.gen_random_bytes(...)` in the `qr_token` default and the
  `referral_code` backfill (resolves regardless of search_path).
- Renamed reserved-word column `authorization` → `authorization_data` on
  `public.payments` (no app code references it) so a fresh `CREATE TABLE` can't
  hit a syntax error.

## Nothing else changed
All other files are exactly as you uploaded them (design, components, other SQL,
edge functions, config). node_modules and .next are excluded from this archive —
run `npm install` then `npm run build` (or just push).

## Deploy
```bash
npm install
git add .
git commit -m "Fix: add missing driver create-trip/vehicles pages + request_booking SQL"
git push
```
Run the SQL as usual (supabase/01…04 + migrations). The two fixed SQL files are
idempotent-safe to re-run.

## Verify
- GitHub Actions build goes green.
- /driver/vehicles → add a car (Under review) → approve it in /admin.
- /driver/trips/new → publish → it appears in Search → a passenger can book it.
