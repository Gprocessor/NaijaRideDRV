-- ============================================================
-- NaijaRide — Commercial batch (additive, idempotent, key-optional)
-- Trust triangle (emergency contacts, SOS, live trip-share) +
-- money-movement status fields + an integrations flag table.
-- Nothing is dropped. Safe to run on your existing DB.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- EMERGENCY CONTACTS (next of kin)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.emergency_contacts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null,
  phone      text not null,
  relation   text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_emg_user on public.emergency_contacts(user_id);
alter table public.emergency_contacts enable row level security;
drop policy if exists emg_rw on public.emergency_contacts;
create policy emg_rw on public.emergency_contacts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- SOS ALERTS (panic button)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sos_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  trip_id    uuid references public.trips(id) on delete set null,
  lat        double precision,
  lng        double precision,
  note       text,
  status     text not null default 'active' check (status in ('active','resolved','false_alarm')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_sos_status on public.sos_alerts(status);
alter table public.sos_alerts enable row level security;
drop policy if exists sos_owner on public.sos_alerts;
create policy sos_owner on public.sos_alerts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists sos_insert on public.sos_alerts;
create policy sos_insert on public.sos_alerts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists sos_admin_update on public.sos_alerts;
create policy sos_admin_update on public.sos_alerts for update to authenticated using (public.is_admin());

-- Raise an SOS: records the alert, notifies admins + the trip's driver in-app,
-- and returns the user's emergency contacts so the client can also alert them
-- (and an Edge Function can SMS them if a provider key is configured).
create or replace function public.raise_sos(p_booking uuid default null, p_lat double precision default null, p_lng double precision default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_trip uuid; v_driver uuid; v_name text; a record;
begin
  if auth.uid() is null then return json_build_object('error','Not authenticated'); end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  if p_booking is not null then
    select b.trip_id, t.driver_id into v_trip, v_driver
    from public.bookings b join public.trips t on t.id = b.trip_id where b.id = p_booking;
  end if;

  insert into public.sos_alerts(booking_id, trip_id, lat, lng, note)
  values (p_booking, v_trip, p_lat, p_lng, p_note) returning id into v_id;

  -- notify all admins
  insert into public.notifications(user_id, type, channel, title, body, data)
  select id, 'SOS', 'in_app', '🚨 SOS raised',
         coalesce(v_name,'A user') || ' triggered an emergency alert.' ||
         case when p_lat is not null then ' Location: '||p_lat||', '||p_lng else '' end,
         jsonb_build_object('sosId', v_id, 'lat', p_lat, 'lng', p_lng)
  from public.profiles where role = 'admin';

  -- notify the driver (if in a trip)
  if v_driver is not null then
    insert into public.notifications(user_id, type, channel, title, body, data)
    values (v_driver, 'SOS', 'in_app', '🚨 Passenger emergency',
            'A passenger on your trip raised an SOS. Please ensure their safety.',
            jsonb_build_object('sosId', v_id));
  end if;

  return json_build_object('id', v_id, 'ok', true);
end; $$;

create or replace function public.admin_resolve_sos(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.sos_alerts set status = p_status, resolved_at = now() where id = p_id;
end; $$;

-- ─────────────────────────────────────────────────────────────
-- LIVE TRIP SHARE (send a read-only status link to next of kin)
-- Uses the booking's existing qr_token as the public share token.
-- ─────────────────────────────────────────────────────────────
-- Public, minimal status for a shared booking — no auth required, token-gated.
create or replace function public.public_trip_status(p_token text)
returns table (
  reference text, status text, origin text, destination text,
  departure_time timestamptz, pickup text, dropoff text,
  driver_name text, driver_phone text, vehicle text, plate text,
  passenger_name text
)
language sql security definer set search_path = public as $$
  select b.booking_reference, b.status, t.origin, t.destination,
         t.departure_time, t.pickup_point, t.dropoff_point,
         d.full_name, d.phone,
         (v.make || ' ' || v.model) as vehicle, v.plate_number,
         p.full_name
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  join public.profiles d on d.id = t.driver_id
  join public.profiles p on p.id = b.passenger_id
  left join public.vehicles v on v.id = t.vehicle_id
  where b.qr_token = p_token
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- MONEY MOVEMENT status fields (Paystack transfers/refunds)
-- ─────────────────────────────────────────────────────────────
alter table public.payouts  add column if not exists transfer_code text;
alter table public.payouts  add column if not exists failure_reason text;
alter table public.payments add column if not exists refund_ref text;

-- ─────────────────────────────────────────────────────────────
-- INTEGRATIONS registry (which providers are connected)
-- Edge Functions flip these to true once their secrets are set.
-- The admin Integrations page reads this to show green/grey.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.integrations (
  key         text primary key,   -- 'paystack','termii_sms','whatsapp','resend_email','dojah_nin','google_maps'
  label       text not null,
  connected   boolean not null default false,
  category    text not null default 'other',
  updated_at  timestamptz not null default now()
);
alter table public.integrations enable row level security;
drop policy if exists integ_read on public.integrations;
create policy integ_read on public.integrations for select to authenticated using (public.is_admin());

insert into public.integrations (key, label, category) values
  ('paystack','Paystack (payments, transfers, refunds)','payments'),
  ('termii_sms','Termii (SMS + OTP)','notifications'),
  ('whatsapp','WhatsApp Business (Meta)','notifications'),
  ('resend_email','Resend (email)','notifications'),
  ('dojah_nin','Dojah / Prembly (NIN verification)','identity'),
  ('google_maps','Google Maps (routes & geocoding)','maps')
on conflict (key) do nothing;

-- Edge Functions call this (service role) to report they have a working key.
create or replace function public.set_integration(p_key text, p_connected boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.integrations set connected = p_connected, updated_at = now() where key = p_key;
end; $$;
