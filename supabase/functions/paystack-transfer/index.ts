// Paystack Transfers — KEY-OPTIONAL driver payouts. With PAYSTACK_SECRET_KEY set,
// it resolves the bank account and disburses; without it, it SIMULATES success so
// the whole payout flow is testable end-to-end. Admin-triggered.
//
// Deploy: supabase functions deploy paystack-transfer --no-verify-jwt
// Secrets (optional): PAYSTACK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const pay = (p: string, o: RequestInit = {}) => fetch(`https://api.paystack.co${p}`, { ...o, headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...(o.headers || {}) } }).then(r => r.json());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  await admin.rpc('set_integration', { p_key: 'paystack', p_connected: Boolean(SECRET) }).catch(() => {});
  const { payoutId } = await req.json().catch(() => ({}));
  if (!payoutId) return json({ error: 'payoutId required' }, 400);

  const { data: po } = await admin.from('payouts').select('*').eq('id', payoutId).single();
  if (!po) return json({ error: 'payout not found' }, 404);
  if (po.status === 'paid') return json({ ok: true, already: true });

  // SIMULATED mode (no key yet) — mark processing→paid so you can test the flow.
  if (!SECRET) {
    await admin.from('payouts').update({ status: 'paid', processed_at: new Date().toISOString(), provider_ref: 'SIM-' + Date.now() }).eq('id', payoutId);
    return json({ ok: true, simulated: true, status: 'paid' });
  }

  try {
    // 1) resolve account name (best-effort)
    let accountName = po.account_name;
    if (po.account_number && po.bank_code) {
      const r = await pay(`/bank/resolve?account_number=${po.account_number}&bank_code=${po.bank_code}`);
      if (r.status) accountName = r.data.account_name;
    }
    // 2) create transfer recipient
    const rec = await pay('/transferrecipient', { method: 'POST', body: JSON.stringify({ type: 'nuban', name: accountName || 'NaijaRide Driver', account_number: po.account_number, bank_code: po.bank_code, currency: 'NGN' }) });
    if (!rec.status) throw new Error(rec.message || 'recipient failed');
    // 3) initiate transfer (kobo)
    const tr = await pay('/transfer', { method: 'POST', body: JSON.stringify({ source: 'balance', amount: po.amount * 100, recipient: rec.data.recipient_code, reason: 'NaijaRide payout' }) });
    if (!tr.status) throw new Error(tr.message || 'transfer failed');
    await admin.from('payouts').update({ status: tr.data.status === 'success' ? 'paid' : 'processing', transfer_code: tr.data.transfer_code, provider_ref: tr.data.reference, account_name: accountName, processed_at: new Date().toISOString() }).eq('id', payoutId);
    return json({ ok: true, status: tr.data.status });
  } catch (e) {
    await admin.from('payouts').update({ status: 'failed', failure_reason: String(e) }).eq('id', payoutId);
    return json({ error: String(e) }, 500);
  }
});
