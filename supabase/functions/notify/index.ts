// Unified notifications — KEY-OPTIONAL. Sends via whichever providers are
// configured (Termii SMS, WhatsApp Cloud, Resend email); otherwise no-ops safely
// and always writes an in-app notification. Reports which providers are live to
// the `integrations` table so the admin Integrations page shows green/grey.
//
// Deploy:  supabase functions deploy notify --no-verify-jwt
// Optional secrets (add later): TERMII_API_KEY, TERMII_SENDER_ID,
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, RESEND_API_KEY, MAIL_FROM
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TERMII = Deno.env.get('TERMII_API_KEY') ?? '';
const TERMII_FROM = Deno.env.get('TERMII_SENDER_ID') ?? 'NaijaRide';
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WA_PHONE = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'NaijaRide <onboarding@resend.dev>';
const admin = createClient(URL_, ROLE);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function ng(phone?: string | null): string | null {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '234' + p.slice(1);
  return p || null;
}
async function sms(to: string, text: string) {
  if (!TERMII || !to) return false;
  await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, from: TERMII_FROM, sms: text, type: 'plain', channel: 'generic', api_key: TERMII }),
  }).catch(() => {});
  return true;
}
async function whatsapp(to: string, text: string) {
  if (!WA_TOKEN || !WA_PHONE || !to) return false;
  await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  }).catch(() => {});
  return true;
}
async function email(to: string, subject: string, html: string) {
  if (!RESEND || !to) return false;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html }),
  }).catch(() => {});
  return true;
}

// keep the integrations registry honest
async function reportFlags() {
  await admin.rpc('set_integration', { p_key: 'termii_sms', p_connected: Boolean(TERMII) }).catch(() => {});
  await admin.rpc('set_integration', { p_key: 'whatsapp', p_connected: Boolean(WA_TOKEN && WA_PHONE) }).catch(() => {});
  await admin.rpc('set_integration', { p_key: 'resend_email', p_connected: Boolean(RESEND) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  await reportFlags();
  const { channels, phone, emailTo, subject, text, html, userId, type } = await req.json().catch(() => ({}));
  const want: string[] = channels || ['sms', 'whatsapp', 'email'];
  const sent: string[] = [];
  const n = ng(phone);
  if (want.includes('sms') && n && await sms(n, text)) sent.push('sms');
  if (want.includes('whatsapp') && n && await whatsapp(n, text)) sent.push('whatsapp');
  if (want.includes('email') && emailTo && await email(emailTo, subject || 'NaijaRide', html || `<p>${text}</p>`)) sent.push('email');
  if (userId) {
    await admin.from('notifications').insert({ user_id: userId, type: type || 'INFO', channel: 'in_app', title: subject || 'NaijaRide', body: text || '' }).catch(() => {});
  }
  return json({ ok: true, sent, simulated: sent.length === 0 });
});
