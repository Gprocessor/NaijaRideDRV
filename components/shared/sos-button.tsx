'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { callFn } from '@/lib/config';
import { toast } from 'sonner';
import { ShieldAlert, X, Loader2, PhoneCall } from 'lucide-react';

// Always-available emergency button for signed-in users. Records an SOS (raise_sos),
// alerts admins + the trip driver in-app, and best-effort SMS to the user's
// emergency contacts via the `notify` function (simulates if no SMS key yet).
export function SosButton() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const trigger = async () => {
    setBusy(true);
    let lat: number | undefined, lng: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000 }));
      lat = pos.coords.latitude; lng = pos.coords.longitude;
    } catch { /* location optional */ }

    const { data, error } = await supabase.rpc('raise_sos', { p_booking: null, p_lat: lat ?? null, p_lng: lng ?? null, p_note: null });
    if (error) { setBusy(false); toast.error(error.message); return; }

    // best-effort: SMS the user's emergency contacts (auto-simulates without a key)
    try {
      const { data: contacts } = await supabase.from('emergency_contacts').select('name, phone');
      const where = lat ? ` Location: https://maps.google.com/?q=${lat},${lng}` : '';
      await Promise.all((contacts || []).map((c: any) =>
        callFn('notify', { channels: ['sms', 'whatsapp'], phone: c.phone, text: `🚨 ${profile?.full_name || 'Your contact'} raised an SOS on NaijaRide.${where}` })));
    } catch { /* ignore */ }

    setBusy(false); setOpen(false);
    toast.success('SOS sent — admins and your emergency contacts have been alerted.');
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-transform hover:scale-105"
        aria-label="Emergency SOS"
        title="Emergency SOS"
      >
        <ShieldAlert className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold text-destructive"><ShieldAlert className="h-5 w-5" /> Emergency SOS</h3>
              <button onClick={() => !busy && setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">This alerts NaijaRide support, your current driver, and your emergency contacts with your location. Use only in a genuine emergency.</p>
            <button onClick={trigger} disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-destructive py-3 font-bold text-white transition hover:brightness-95 disabled:opacity-60">
              {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> Sending…</> : <><PhoneCall className="h-5 w-5" /> Send SOS now</>}
            </button>
            <button onClick={() => !busy && setOpen(false)} className="mt-2 w-full rounded-xl py-2 text-sm text-muted-foreground hover:bg-secondary">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
