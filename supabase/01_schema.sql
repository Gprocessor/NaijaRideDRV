-- ============================================================
-- NaijaRide — GAP PHASE 1: schema foundation (additive, idempotent)
-- Adds the tables/fields the spec lists but the app didn't have:
--   payments, wallets, wallet_transactions, payouts, notifications,
--   otps, kyc, documents, promo_codes, referrals, audit_logs, seats
--   + trip state/pickup/dropoff fields + expanded booking lifecycle
--   + NIN encryption (pgcrypto) + duplicate-NIN detection
-- Safe to run on your existing Bolt/Supabase DB. Nothing is dropped.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ── TRIP: add state + pickup/drop-off points ────────────────
alter table public.trips add column if not exists departure_state   text;
alter table public.trips add column if not exists destination_state text;
alter table public.trips add column if not exists pickup_point      text;
alter table public.trips add column if not exists dropoff_point     text;

-- ── BOOKING: richer lifecycle + payment status ──────────────
alter table public.bookings add column if not exists payment_status text not null default 'unpaid';
alter table public.bookings add column if not exists qr_token text not null default upper(substr(encode(extensions.gen_random_bytes(9),'hex'),1,16));
-- expand status enum: pending → accepted/rejected → confirmed(paid) → completed/cancelled/refunded
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending','accepted','rejected','confirmed','cancelled','completed','refunded'));
alter table public.bookings drop constraint if exists bookings_payment_status_check;
alter table public.bookings add constraint bookings_payment_status_check
  check (payment_status in ('unpaid','pending','paid','failed','refunded'));

-- ── SEATS (per-seat map; optional but spec-required) ────────
create table if not exists public.seats (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  seat_number integer not null,
  booking_id  uuid references public.bookings(id) on delete set null,
  is_booked   boolean not null default false,
  unique (trip_id, seat_number)
);
create index if not exists idx_seats_trip on public.seats(trip_id);

-- ── PAYMENTS (Paystack) ─────────────────────────────────────
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null unique references public.bookings(id) on delete cascade,
  provider        text not null default 'paystack',
  provider_ref    text unique,
  amount          integer not null,           -- naira (whole)
  currency        text not null default 'NGN',
  channel         text,                        -- card / bank_transfer / ussd / apple_pay ...
  status          text not null default 'initiated'
                    check (status in ('initiated','pending','success','failed','refunded','partially_refunded')),
  commission      integer not null default 0,
  refunded_amount integer not null default 0,
  authorization_data jsonb,                       -- tokenised auth for recovery
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_payments_status on public.payments(status);

-- ── WALLETS + LEDGER ────────────────────────────────────────
create table if not exists public.wallets (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references public.profiles(id) on delete cascade,
  earnings             integer not null default 0,   -- lifetime gross net-of-commission
  pending_balance      integer not null default 0,   -- held until trip completes
  withdrawable_balance integer not null default 0,
  currency             text not null default 'NGN',
  created_at           timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id            uuid primary key default gen_random_uuid(),
  wallet_id     uuid not null references public.wallets(id) on delete cascade,
  type          text not null check (type in
                  ('credit_earning','debit_commission','debit_payout','credit_refund_adj','debit_refund','adjustment')),
  amount        integer not null,             -- signed
  balance_after integer not null default 0,
  reference     text,
  description   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_wallet_tx_wallet on public.wallet_transactions(wallet_id);

create table if not exists public.payouts (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null references public.profiles(id) on delete cascade,
  amount         integer not null check (amount > 0),
  bank_code      text,
  account_number text,
  account_name   text,
  status         text not null default 'requested'
                   check (status in ('requested','processing','paid','failed')),
  provider_ref   text,
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_payouts_driver on public.payouts(driver_id);

-- ── NOTIFICATIONS (in-app log for every event type) ─────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,   -- OTP / DRIVER_APPROVAL / BOOKING_ACCEPTED / PAYMENT_CONFIRMED / TRIP_REMINDER_24H ...
  channel    text not null default 'in_app', -- in_app / email / sms / whatsapp / push
  title      text not null,
  body       text not null,
  data       jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, read);

-- ── OTP (phone verification) ────────────────────────────────
create table if not exists public.otps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code_hash  text not null,
  purpose    text not null default 'phone_verification',
  channel    text not null default 'sms',
  attempts   integer not null default 0,
  consumed   boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otps_user on public.otps(user_id, purpose);

-- ── KYC (NIN encrypted at rest + duplicate detection) ───────
create table if not exists public.kyc (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references public.profiles(id) on delete cascade,
  status           text not null default 'not_started'
                     check (status in ('not_started','pending','verified','rejected')),
  nin_encrypted    bytea,        -- pgp_sym_encrypt(nin, key)
  nin_hash         text unique,  -- sha256(nin) → duplicate detection without plaintext
  provider_ref     text,
  selfie_match     boolean,
  liveness_passed  boolean,
  rejection_reason text,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── DOCUMENTS (licence, insurance, selfie, etc.) ────────────
create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  type       text not null,   -- drivers_licence / vehicle_licence / proof_of_ownership / insurance / gov_id / selfie
  path       text not null,   -- storage object path in 'kyc-documents'
  mime_type  text,
  scanned    boolean not null default false,   -- virus-scan status
  verified   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_documents_user on public.documents(user_id);

-- ── PROMO CODES ─────────────────────────────────────────────
create table if not exists public.promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  description     text,
  percent_off     integer check (percent_off between 0 and 100),
  amount_off      integer,       -- naira
  max_redemptions integer,
  redemptions     integer not null default 0,
  active          boolean not null default true,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.bookings add column if not exists promo_code_id uuid references public.promo_codes(id);
alter table public.bookings add column if not exists discount integer not null default 0;

-- ── REFERRALS ───────────────────────────────────────────────
create table if not exists public.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  reward      integer not null default 0,
  rewarded    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists referral_code text unique;
-- give every profile a referral code (once)
update public.profiles set referral_code = upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,8))
  where referral_code is null;

-- ── SAVED PICKUP LOCATIONS (spec: save pickup locations) ────
create table if not exists public.saved_locations (
  id           uuid primary key default gen_random_uuid(),
  passenger_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label        text not null,
  address      text not null,
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now()
);

-- ── ACCOUNT STATUS (admin suspend / block fraud) ────────────
alter table public.profiles add column if not exists account_status text not null default 'active'
  check (account_status in ('active','suspended','banned'));

-- ── AUDIT LOGS ──────────────────────────────────────────────
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text,
  entity_id  uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_logs(entity, entity_id);

-- ============================================================
-- ENABLE RLS + POLICIES ON NEW TABLES
-- ============================================================
alter table public.seats               enable row level security;
alter table public.payments            enable row level security;
alter table public.wallets             enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.payouts             enable row level security;
alter table public.notifications       enable row level security;
alter table public.otps                enable row level security;
alter table public.kyc                 enable row level security;
alter table public.documents           enable row level security;
alter table public.promo_codes         enable row level security;
alter table public.referrals           enable row level security;
alter table public.saved_locations     enable row level security;
alter table public.audit_logs          enable row level security;

-- helper (assumes is_admin() exists from the earlier patch; create if missing)
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public
as $$ select coalesce((select role='admin' from public.profiles where id=auth.uid()), false); $$;

-- seats: public read; only trip driver manages
drop policy if exists seats_read on public.seats;
create policy seats_read on public.seats for select using (true);
drop policy if exists seats_write on public.seats;
create policy seats_write on public.seats for all to authenticated
  using (exists (select 1 from public.trips t where t.id=trip_id and t.driver_id=auth.uid()))
  with check (exists (select 1 from public.trips t where t.id=trip_id and t.driver_id=auth.uid()));

-- payments: passenger of booking OR driver of the trip OR admin
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (
  public.is_admin()
  or exists (select 1 from public.bookings b where b.id=booking_id and b.passenger_id=auth.uid())
  or exists (select 1 from public.bookings b join public.trips t on t.id=b.trip_id where b.id=booking_id and t.driver_id=auth.uid())
);

-- wallets + ledger + payouts: owner or admin
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists wtx_read on public.wallet_transactions;
create policy wtx_read on public.wallet_transactions for select to authenticated using (
  public.is_admin() or exists (select 1 from public.wallets w where w.id=wallet_id and w.user_id=auth.uid()));
drop policy if exists payouts_rw on public.payouts;
create policy payouts_rw on public.payouts for select to authenticated using (driver_id=auth.uid() or public.is_admin());
drop policy if exists payouts_insert on public.payouts;
create policy payouts_insert on public.payouts for insert to authenticated with check (driver_id=auth.uid());

-- notifications: owner
drop policy if exists notif_rw on public.notifications;
create policy notif_rw on public.notifications for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id=auth.uid());

-- otps: owner only
drop policy if exists otps_rw on public.otps;
create policy otps_rw on public.otps for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- kyc: owner reads own (never expose nin) + admin
drop policy if exists kyc_read on public.kyc;
create policy kyc_read on public.kyc for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists kyc_write on public.kyc;
create policy kyc_write on public.kyc for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- documents: owner + admin
drop policy if exists docs_rw on public.documents;
create policy docs_rw on public.documents for select to authenticated using (user_id=auth.uid() or public.is_admin());
drop policy if exists docs_insert on public.documents;
create policy docs_insert on public.documents for insert to authenticated with check (user_id=auth.uid());

-- promo codes: public read active; admin manages
drop policy if exists promo_read on public.promo_codes;
create policy promo_read on public.promo_codes for select using (active = true or public.is_admin());
drop policy if exists promo_admin on public.promo_codes;
create policy promo_admin on public.promo_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- referrals: participants + admin
drop policy if exists ref_read on public.referrals;
create policy ref_read on public.referrals for select to authenticated using (referrer_id=auth.uid() or referred_id=auth.uid() or public.is_admin());

-- saved locations: owner
drop policy if exists sl_rw on public.saved_locations;
create policy sl_rw on public.saved_locations for all to authenticated using (passenger_id=auth.uid()) with check (passenger_id=auth.uid());

-- audit logs: admin only
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());

-- create a wallet for every existing driver (once)
insert into public.wallets (user_id)
  select id from public.profiles where role='driver'
  on conflict (user_id) do nothing;
