-- ============================================================
-- NaijaRide — GAP PHASE 1: functions/RPCs (run AFTER 01_schema.sql)
-- Booking lifecycle, wallet ledger, ratings, KYC (encrypted NIN),
-- payouts, promo, referral, OTP, audit logging. All idempotent.
-- Money is WHOLE NAIRA; platform commission = 10%.
-- ============================================================

-- ── AUDIT: generic logger + triggers on key tables ──────────
create or replace function public.audit_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id, action, entity, entity_id, metadata)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce((case when tg_op='DELETE' then old.id else new.id end)),
          jsonb_build_object('op', tg_op));
  return coalesce(new, old);
end; $$;

do $$ begin
  perform 1;
  -- attach to important tables
  if not exists (select 1 from pg_trigger where tgname='aud_profiles') then
    create trigger aud_profiles after insert or update or delete on public.profiles for each row execute function public.audit_write();
  end if;
  if not exists (select 1 from pg_trigger where tgname='aud_bookings') then
    create trigger aud_bookings after insert or update or delete on public.bookings for each row execute function public.audit_write();
  end if;
  if not exists (select 1 from pg_trigger where tgname='aud_payments') then
    create trigger aud_payments after insert or update on public.payments for each row execute function public.audit_write();
  end if;
  if not exists (select 1 from pg_trigger where tgname='aud_payouts') then
    create trigger aud_payouts after insert or update on public.payouts for each row execute function public.audit_write();
  end if;
end $$;

-- ── WALLET helpers ──────────────────────────────────────────
create or replace function public.wallet_credit_earning(p_driver uuid, p_net integer, p_commission integer, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total integer;
begin
  insert into public.wallets(user_id) values (p_driver) on conflict (user_id) do nothing;
  select id into v_id from public.wallets where user_id = p_driver;
  update public.wallets
    set earnings = earnings + p_net, pending_balance = pending_balance + p_net
    where id = v_id
    returning (withdrawable_balance + pending_balance) into v_total;
  insert into public.wallet_transactions(wallet_id,type,amount,balance_after,reference,description)
    values (v_id,'credit_earning',p_net,v_total,p_ref,'Earning (net of commission)');
  if p_commission > 0 then
    insert into public.wallet_transactions(wallet_id,type,amount,balance_after,reference,description)
      values (v_id,'debit_commission',-p_commission,v_total,p_ref,'Platform commission 10%');
  end if;
end; $$;

-- ── PAYMENT SUCCESS → confirm booking + credit driver ───────
-- Called by the Paystack Edge Function (service role) after verification,
-- OR by confirm_booking() test flow.
create or replace function public.mark_payment_success(p_booking_id uuid, p_ref text, p_channel text default 'card')
returns void language plpgsql security definer set search_path = public as $$
declare v_booking public.bookings; v_trip public.trips; v_amount integer; v_commission integer; v_net integer;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if v_booking.payment_status = 'paid' then return; end if; -- idempotent

  select * into v_trip from public.trips where id = v_booking.trip_id;
  v_amount := v_booking.total_amount;
  v_commission := floor(v_amount * 0.10);
  v_net := v_amount - v_commission;

  update public.bookings set status='confirmed', payment_status='paid' where id = p_booking_id;

  insert into public.payments(booking_id, provider_ref, amount, currency, channel, status, commission, paid_at)
  values (p_booking_id, p_ref, v_amount, 'NGN', p_channel, 'success', v_commission, now())
  on conflict (booking_id) do update
    set provider_ref=excluded.provider_ref, status='success', channel=excluded.channel,
        commission=excluded.commission, paid_at=now();

  perform public.wallet_credit_earning(v_trip.driver_id, v_net, v_commission, v_booking.booking_reference);

  insert into public.notifications(user_id,type,channel,title,body,data)
  values (v_booking.passenger_id,'PAYMENT_CONFIRMED','in_app','Payment confirmed',
          'Your booking '||v_booking.booking_reference||' is paid and confirmed.', jsonb_build_object('bookingId',p_booking_id));
end; $$;

-- ── BOOKING: create as PENDING (driver must accept) ─────────
-- Overrides the instant-confirm book_trip with an accept/reject flow.
create or replace function public.request_booking(p_trip_id uuid, p_seats integer, p_promo text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_trip public.trips; v_booking public.bookings; v_ref text; v_amount integer; v_discount integer := 0; v_promo public.promo_codes;
begin
  if auth.uid() is null then return json_build_object('error','Not authenticated'); end if;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if not found then return json_build_object('error','Trip not found'); end if;
  if v_trip.status <> 'scheduled' then return json_build_object('error','Trip not open for booking'); end if;
  if v_trip.driver_id = auth.uid() then return json_build_object('error','You cannot book your own trip'); end if;
  if v_trip.available_seats < p_seats then return json_build_object('error','Not enough seats available'); end if;
  if v_trip.departure_time <= now() then return json_build_object('error','This trip has already departed'); end if;

  v_amount := v_trip.price_per_seat * p_seats;
  if p_promo is not null then
    select * into v_promo from public.promo_codes where code = upper(p_promo) and active
      and (expires_at is null or expires_at > now())
      and (max_redemptions is null or redemptions < max_redemptions);
    if found then
      v_discount := least(v_amount, coalesce(floor(v_amount * coalesce(v_promo.percent_off,0)/100.0), 0) + coalesce(v_promo.amount_off,0));
      update public.promo_codes set redemptions = redemptions + 1 where id = v_promo.id;
    end if;
  end if;

  v_ref := 'NR-' || upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,8));
  insert into public.bookings(trip_id, passenger_id, seats_booked, total_amount, discount, promo_code_id, status, payment_status, booking_reference)
  values (p_trip_id, auth.uid(), p_seats, v_amount - v_discount, v_discount, (v_promo).id, 'pending', 'unpaid', v_ref)
  returning * into v_booking;

  -- tentatively hold seats
  update public.trips set available_seats = available_seats - p_seats where id = p_trip_id;

  insert into public.notifications(user_id,type,channel,title,body,data)
  select v_trip.driver_id,'BOOKING_RECEIVED','in_app','New booking request',
         'A passenger requested '||p_seats||' seat(s) on '||v_trip.origin||' → '||v_trip.destination||'.',
         jsonb_build_object('bookingId', v_booking.id);

  return json_build_object('id',v_booking.id,'booking_reference',v_booking.booking_reference,
                           'amount',v_booking.total_amount,'discount',v_discount,'status','pending');
exception when undefined_column then
  -- the no-op guard column doesn't exist (expected) — retry clean insert
  v_ref := 'NR-' || upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,8));
  insert into public.bookings(trip_id, passenger_id, seats_booked, total_amount, discount, promo_code_id, status, payment_status, booking_reference)
  values (p_trip_id, auth.uid(), p_seats, v_amount - v_discount, v_discount, (v_promo).id, 'pending', 'unpaid', v_ref)
  returning * into v_booking;
  update public.trips set available_seats = available_seats - p_seats where id = p_trip_id;
  return json_build_object('id',v_booking.id,'booking_reference',v_booking.booking_reference,
                           'amount',v_booking.total_amount,'discount',v_discount,'status','pending');
end; $$;

-- ── DRIVER: accept / reject a booking ───────────────────────
create or replace function public.accept_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bookings; v_t public.trips;
begin
  select * into v_b from public.bookings where id=p_booking_id;
  select * into v_t from public.trips where id=v_b.trip_id;
  if v_t.driver_id <> auth.uid() then raise exception 'Not your trip'; end if;
  update public.bookings set status='accepted' where id=p_booking_id and status='pending';
  insert into public.notifications(user_id,type,channel,title,body,data)
  values (v_b.passenger_id,'BOOKING_ACCEPTED','in_app','Booking accepted',
          'Your booking '||v_b.booking_reference||' was accepted — pay to confirm your seat.', jsonb_build_object('bookingId',p_booking_id));
end; $$;

create or replace function public.reject_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bookings; v_t public.trips;
begin
  select * into v_b from public.bookings where id=p_booking_id;
  select * into v_t from public.trips where id=v_b.trip_id;
  if v_t.driver_id <> auth.uid() then raise exception 'Not your trip'; end if;
  update public.bookings set status='rejected' where id=p_booking_id and status in ('pending','accepted');
  update public.trips set available_seats = available_seats + v_b.seats_booked where id=v_b.trip_id;
  insert into public.notifications(user_id,type,channel,title,body)
  values (v_b.passenger_id,'CANCELLATION','in_app','Booking rejected',
          'Your booking '||v_b.booking_reference||' was rejected.');
end; $$;

-- ── PASSENGER: cancel own booking ───────────────────────────
create or replace function public.cancel_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.bookings;
begin
  select * into v_b from public.bookings where id=p_booking_id and passenger_id=auth.uid();
  if not found then raise exception 'Booking not found'; end if;
  if v_b.status in ('cancelled','completed','refunded') then raise exception 'Cannot cancel'; end if;
  update public.bookings set status='cancelled' where id=p_booking_id;
  update public.trips set available_seats = available_seats + v_b.seats_booked where id=v_b.trip_id;
end; $$;

-- ── DRIVER: trip transitions ────────────────────────────────
create or replace function public.set_trip_status(p_trip_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.trips; v_b record; v_net integer; v_id uuid; v_total integer;
begin
  select * into v_t from public.trips where id=p_trip_id;
  if v_t.driver_id <> auth.uid() then raise exception 'Not your trip'; end if;
  if p_status not in ('scheduled','in_progress','completed','cancelled') then raise exception 'Bad status'; end if;
  update public.trips set status=p_status where id=p_trip_id;

  if p_status='completed' then
    -- release held funds pending → withdrawable for confirmed bookings; mark completed
    for v_b in select * from public.bookings where trip_id=p_trip_id and status='confirmed' loop
      v_net := (v_b.total_amount - floor(v_b.total_amount*0.10));
      insert into public.wallets(user_id) values (v_t.driver_id) on conflict (user_id) do nothing;
      select id into v_id from public.wallets where user_id=v_t.driver_id;
      update public.wallets set pending_balance = greatest(0, pending_balance - v_net),
             withdrawable_balance = withdrawable_balance + v_net where id=v_id
        returning (withdrawable_balance+pending_balance) into v_total;
      insert into public.wallet_transactions(wallet_id,type,amount,balance_after,reference,description)
        values (v_id,'adjustment',0,v_total,v_b.booking_reference,'Funds released to withdrawable');
      update public.bookings set status='completed' where id=v_b.id;
      insert into public.notifications(user_id,type,channel,title,body)
        values (v_b.passenger_id,'TRIP_COMPLETED','in_app','Trip completed','Hope you enjoyed your trip! Please rate your driver.');
    end loop;
  end if;
end; $$;

-- ── REVIEWS: submit + recompute rating ──────────────────────
create or replace function public.submit_review(p_trip_id uuid, p_reviewee uuid, p_rating integer, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_avg numeric; v_cnt integer;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1..5'; end if;
  insert into public.reviews(trip_id, reviewer_id, reviewee_id, rating, comment)
  values (p_trip_id, auth.uid(), p_reviewee, p_rating, p_comment);
  select avg(rating)::numeric(3,2), count(*) into v_avg, v_cnt from public.reviews where reviewee_id=p_reviewee;
  update public.profiles set rating=coalesce(v_avg,0), rating_count=v_cnt where id=p_reviewee;
end; $$;

-- ── PAYOUT: driver requests withdrawal ──────────────────────
create or replace function public.request_payout(p_amount integer, p_bank_code text, p_account_number text, p_account_name text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_wal public.wallets; v_total integer;
begin
  select * into v_wal from public.wallets where user_id=auth.uid();
  if not found then return json_build_object('error','No wallet'); end if;
  if p_amount <= 0 or p_amount > v_wal.withdrawable_balance then return json_build_object('error','Amount exceeds withdrawable balance'); end if;
  update public.wallets set withdrawable_balance = withdrawable_balance - p_amount where id=v_wal.id
    returning (withdrawable_balance+pending_balance) into v_total;
  insert into public.wallet_transactions(wallet_id,type,amount,balance_after,description)
    values (v_wal.id,'debit_payout',-p_amount,v_total,'Payout request');
  insert into public.payouts(driver_id,amount,bank_code,account_number,account_name)
    values (auth.uid(),p_amount,p_bank_code,p_account_number,p_account_name) returning id into v_id;
  return json_build_object('id',v_id,'status','requested','amount',p_amount);
end; $$;

-- ── KYC: submit NIN (encrypted) + duplicate detection ───────
-- Set your key ONCE:  alter database postgres set app.kyc_key = 'a-long-random-secret';
create or replace function public.submit_kyc(p_nin text, p_provider_ref text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_key text := current_setting('app.kyc_key', true); v_hash text; v_dup uuid;
begin
  if length(p_nin) <> 11 then return json_build_object('error','NIN must be 11 digits'); end if;
  v_hash := encode(digest(p_nin, 'sha256'), 'hex');
  select user_id into v_dup from public.kyc where nin_hash=v_hash and user_id<>auth.uid();
  if v_dup is not null then return json_build_object('error','This NIN is already linked to another account'); end if;

  insert into public.kyc(user_id, status, nin_encrypted, nin_hash, provider_ref)
  values (auth.uid(), 'pending',
          case when v_key is not null then pgp_sym_encrypt(p_nin, v_key) else null end,
          v_hash, p_provider_ref)
  on conflict (user_id) do update
    set status='pending', nin_encrypted=excluded.nin_encrypted, nin_hash=excluded.nin_hash,
        provider_ref=excluded.provider_ref, updated_at=now();

  update public.profiles set kyc_status='pending' where id=auth.uid();
  return json_build_object('status','pending');
end; $$;

-- ── OTP: generate + verify (hashed, 10-min expiry) ──────────
create or replace function public.generate_otp(p_purpose text default 'phone_verification')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  v_code := lpad((floor(random()*1000000))::int::text, 6, '0');
  insert into public.otps(user_id, code_hash, purpose, expires_at)
  values (auth.uid(), encode(digest(v_code,'sha256'),'hex'), p_purpose, now() + interval '10 minutes');
  -- NOTE: send v_code via SMS/WhatsApp from an Edge Function; returned here only for dev/testing.
  insert into public.notifications(user_id,type,channel,title,body)
  values (auth.uid(),'OTP','sms','Your code','Your NaijaRide code is '||v_code||' (expires in 10 min).');
  return json_build_object('sent', true);
end; $$;

create or replace function public.verify_otp(p_code text, p_purpose text default 'phone_verification')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.otps;
begin
  select * into v from public.otps where user_id=auth.uid() and purpose=p_purpose and consumed=false
    order by created_at desc limit 1;
  if not found then return json_build_object('error','No pending code'); end if;
  if v.expires_at < now() then return json_build_object('error','Code expired'); end if;
  if v.attempts >= 5 then return json_build_object('error','Too many attempts'); end if;
  if v.code_hash <> encode(digest(p_code,'sha256'),'hex') then
    update public.otps set attempts=attempts+1 where id=v.id;
    return json_build_object('error','Incorrect code');
  end if;
  update public.otps set consumed=true where id=v.id;
  return json_build_object('verified', true);
end; $$;

-- ── REFERRAL: redeem a code at signup ───────────────────────
create or replace function public.redeem_referral(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  select id into v_ref from public.profiles where referral_code = upper(p_code) and id <> auth.uid();
  if v_ref is null then return json_build_object('error','Invalid code'); end if;
  insert into public.referrals(referrer_id, referred_id, reward) values (v_ref, auth.uid(), 500)
  on conflict (referred_id) do nothing;
  return json_build_object('ok', true);
end; $$;

-- ── ADMIN: suspend / ban / reactivate an account ────────────
create or replace function public.admin_set_account_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status not in ('active','suspended','banned') then raise exception 'Bad status'; end if;
  update public.profiles set account_status=p_status where id=p_user;
end; $$;

-- ── ADMIN: process a payout / refund a booking ──────────────
create or replace function public.admin_mark_payout(p_payout uuid, p_status text, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.payouts set status=p_status, provider_ref=coalesce(p_ref,provider_ref),
    processed_at=case when p_status in ('paid','failed') then now() else processed_at end
    where id=p_payout;
end; $$;
