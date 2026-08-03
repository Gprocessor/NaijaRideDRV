// Key-optional flags + helpers. Each feature works in a fallback/simulated mode
// until you paste the matching key as a repo Variable, then it activates
// automatically — no code changes. This file MUST export everything any component
// imports from '@/lib/config' (e.g. sos-button.tsx uses callFn), otherwise the
// whole build fails and GitHub Pages keeps serving the last good build.

export const PAYSTACK_ENABLED = Boolean(process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY);
export const MAPS_ENABLED     = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);
export const MAPS_KEY         = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || '';
export const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const ANON             = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
export const BASE             = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Call any deployed Supabase Edge Function (notify, paystack-transfer, etc.).
// The functions detect their own secrets and simulate gracefully when absent,
// so this is always safe to call even before you've added any provider keys.
export async function callFn(name: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON}`,
        apikey: ANON,
      },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    // Never let a missing/undeployed function crash the caller.
    return { ok: false, error: String(e) };
  }
}
