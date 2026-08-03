# NaijaRide — Commercial Batch (KEY-OPTIONAL architecture)
Build-verified: a full `next build` compiles all pages (29/29).

Everything here follows one rule you asked for: **you only add a key when you
register with a provider.** Until then, each feature runs in a safe SIMULATED mode
so the whole flow is testable. The moment a secret exists, the feature goes live —
no code change, no redeploy gymnastics — and reports itself on the Integrations page.

## STEP 1 — Run the SQL (once)
Supabase → SQL Editor → run **`supabase/08_commercial.sql`** (additive, idempotent).
Adds: emergency_contacts, sos_alerts (+ `raise_sos`, `admin_resolve_sos`),
`public_trip_status` (token-gated live share), payout/refund status fields, and an
`integrations` registry (+ `set_integration`).

## STEP 2 — Deploy the Edge Functions (no keys required yet)
```bash
supabase functions deploy notify           --no-verify-jwt
supabase functions deploy paystack-transfer --no-verify-jwt
supabase functions deploy paystack-refund   --no-verify-jwt
supabase functions deploy verify-nin        --no-verify-jwt
```
They work immediately in simulated mode. Add secrets ONLY when you register:

| Provider | Add these secrets (later) | Turns on |
|---|---|---|
| Paystack | `PAYSTACK_SECRET_KEY` (on the functions) + `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (repo Variable) | Real card checkout, **driver transfers**, **card refunds** |
| Termii SMS | `TERMII_API_KEY`, `TERMII_SENDER_ID` (on `notify`) | Real SMS + OTP delivery |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` (on `notify`) | WhatsApp alerts |
| Resend | `RESEND_API_KEY`, `MAIL_FROM` (on `notify`) | Email |
| Dojah NIN | `DOJAH_API_KEY`, `DOJAH_APP_ID` (on `verify-nin`) | Auto NIN→Verified badge |
| Google Maps | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (repo Variable) | Maps (client flag ready) |

Each function calls `set_integration()` the first time it runs, so **Admin →
Integrations** shows green/grey automatically.

## STEP 3 — Frontend files
### New
  lib/config.ts                         Central key detection + `callFn()` helper.
  components/shared/sos-button.tsx       Floating 🚨 SOS (all signed-in users). Records
                                         an alert, notifies admins + driver in-app, and
                                         SMS/WhatsApps your emergency contacts (simulated
                                         until an SMS key exists).
  app/emergency-contacts/page.tsx        Manage next-of-kin (add/primary/delete).
  app/trip-share/page.tsx                PUBLIC live status (no login) via
                                         ?token=<qr_token> — route, driver, vehicle,
                                         status; auto-refreshes every 30s.
  app/admin/integrations/page.tsx        Provider cockpit: connected/simulated + how to
                                         activate each, with sign-up links.
### Modified (overwrite)
  app/layout.tsx                         Mounts <SosButton/> (bottom-left).
  components/shared/navbar.tsx           Adds "Emergency Contacts" (all) + "Integrations" (admin).
  app/receipt/page.tsx                   Adds "Share trip" → generates the /trip-share link
                                         (Web Share / WhatsApp / copy).

## Apply
```bash
git add supabase/08_commercial.sql lib/config.ts components/shared/sos-button.tsx \
        components/shared/navbar.tsx app/layout.tsx app/emergency-contacts app/trip-share \
        app/admin/integrations app/receipt/page.tsx supabase/functions
git commit -m "Commercial: trust triangle + key-optional Paystack transfers/refunds/SMS/NIN + Integrations"
git push
```
Then run the SQL and deploy the functions.

## What this unlocks (commercially)
- **Trust triangle (0 keys):** SOS panic button, emergency contacts, and a public
  live trip-share link for next-of-kin — the safety story that wins the NG market.
- **Real money movement (Paystack key):** drivers actually get PAID (Transfers API,
  bank-name resolve) and passengers actually get REFUNDED to card — both simulate
  today so you can demo the full loop.
- **Real comms (Termii/WhatsApp/Resend keys):** the OTP + reminder + booking pipes
  send for real; until then they no-op safely and still log in-app.
- **Real identity (Dojah key):** NIN auto-verifies against NIMC and grants the
  Verified badge; without a key it stays manual-review (today's behaviour).

## Wire-up notes (small, optional)
- **Process a payout for real:** in your admin payouts view, call
  `callFn('paystack-transfer', { payoutId })` on a "Process" button. (Simulated →
  marks paid; with key → disburses.)
- **Refund to card:** swap the admin refund button to
  `callFn('paystack-refund', { bookingId })` instead of the internal-only RPC.
- **Auto NIN check:** after `submit_kyc`, call
  `callFn('verify-nin', { userId, nin })` (kept separate so the DB stays clean).
- **SOS on an active trip:** the button raises a general SOS; pass a `bookingId`
  into `raise_sos` from the receipt page to tie it to a specific trip/driver.

## Still needs YOU (accounts only — no code)
Register with Paystack (live), Termii, Meta WhatsApp, Resend, Dojah, Google Cloud —
then paste each key where the table above says. The app already knows what to do
with them.
