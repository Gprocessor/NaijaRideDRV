// Paystack Refund — KEY-OPTIONAL. Calls admin_refund_booking() to reverse internal
// balances always; additionally hits Paystack /refund when a key is present so the
// money returns to the passenger's card. Simulates the card leg without a key.
// Deploy: supabase functions deploy paystack-refund --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { bookingId, amount } = await req.json().catch(() => ({}));
  if (!bookingId) return json({ error: 'bookingId required' }, 400);

  // 1) internal reversal (always)
  const { error } = await admin.rpc('admin_refund_booking', { p_booking: bookingId, p_amount: amount ?? null, p_ref: null });
  if (error) return json({ error: error.message }, 500);

  // 2) card refund (only if key present)
  const { data: p } = await admin.from('payments').select('provider_ref, amount').eq('booking_id', bookingId).maybeSingle();
  if (SECRET && p?.provider_ref) {
    const r = await fetch('https://api.paystack.co/refund', {
      method: 'POST', headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: p.provider_ref, amount: (amount ?? p.amount) * 100 }),
    }).then(r => r.json()).catch(() => null);
    await admin.from('payments').update({ refund_ref: r?.data?.id ? String(r.data.id) : 'PENDING' }).eq('booking_id', bookingId);
    return json({ ok: true, card_refund: Boolean(r?.status) });
  }
  return json({ ok: true, simulated_card_refund: true });
});
