// NIN verification — KEY-OPTIONAL. With DOJAH_API_KEY + DOJAH_APP_ID it verifies the
// NIN against NIMC (via Dojah) and, on a match, marks the KYC verified + sets the
// Verified Driver badge. Without a key it keeps today's behaviour (status 'pending'
// for manual admin review). Called by the driver after submit_kyc.
// Deploy: supabase functions deploy verify-nin --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const KEY = Deno.env.get('DOJAH_API_KEY') ?? '';
const APP = Deno.env.get('DOJAH_APP_ID') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  await admin.rpc('set_integration', { p_key: 'dojah_nin', p_connected: Boolean(KEY && APP) }).catch(() => {});
  const { userId, nin, firstName, lastName } = await req.json().catch(() => ({}));
  if (!userId || !nin) return json({ error: 'userId and nin required' }, 400);

  // No provider key → leave as pending for manual review (current behaviour).
  if (!KEY || !APP) return json({ ok: true, simulated: true, status: 'pending' });

  try {
    const r = await fetch(`https://api.dojah.io/api/v1/kyc/nin?nin=${encodeURIComponent(nin)}`, {
      headers: { Authorization: KEY, AppId: APP },
    }).then(r => r.json());
    const entity = r?.entity;
    if (!entity) return json({ ok: false, status: 'pending', reason: 'No record' });

    // light name match if provided
    const ok = !firstName || (entity.first_name || '').toUpperCase().includes(String(firstName).toUpperCase());
    if (ok) {
      await admin.from('kyc').update({ status: 'verified', selfie_match: true, verified_at: new Date().toISOString(), provider_ref: 'dojah' }).eq('user_id', userId);
      await admin.from('profiles').update({ kyc_status: 'verified', is_verified_driver: true }).eq('id', userId);
      await admin.from('notifications').insert({ user_id: userId, type: 'DRIVER_APPROVAL', channel: 'in_app', title: 'Verification approved ✅', body: 'Your NIN was verified — you now have the Verified Driver badge.' });
      return json({ ok: true, status: 'verified' });
    }
    return json({ ok: false, status: 'pending', reason: 'Name mismatch' });
  } catch (e) { return json({ error: String(e) }, 500); }
});
