'use client';

// PUBLIC page — no auth. A passenger shares .../trip-share?token=<qr_token> with
// next-of-kin so they can watch the trip: route, driver, vehicle, status. Data is
// fetched via the token-gated public_trip_status() RPC (RLS-safe, read-only).

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase/client';
import { formatDateTime } from '@/lib/constants';
import { ShieldCheck, MapPin, Car, User, Phone, Clock, CheckCircle2, RefreshCw } from 'lucide-react';

type Status = {
  reference: string; status: string; origin: string; destination: string;
  departure_time: string; pickup: string | null; dropoff: string | null;
  driver_name: string; driver_phone: string | null; vehicle: string | null; plate: string | null;
  passenger_name: string;
};

const STATUS_UI: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-accent/10 text-accent' },
  in_progress: { label: 'On the way', cls: 'bg-primary/10 text-primary' },
  completed: { label: 'Arrived', cls: 'bg-success/10 text-success' },
  confirmed: { label: 'Confirmed', cls: 'bg-primary/10 text-primary' },
  cancelled: { label: 'Cancelled', cls: 'bg-destructive/10 text-destructive' },
};

function Inner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    const { data } = await supabase.rpc('public_trip_status', { p_token: token });
    const row = (data && data[0]) as Status | undefined;
    if (!row) setNotFound(true); else setS(row);
    setLoading(false);
  };

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); /* eslint-disable-next-line */ }, [token]);

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 text-center">
          <p className="font-display text-2xl font-extrabold">Naija<span className="text-primary">Ride</span></p>
          <p className="text-sm text-muted-foreground">Live trip status</p>
        </div>

        {loading ? <Skeleton className="h-80 w-full" />
        : notFound ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">This trip link is invalid or has expired.</CardContent></Card>
        ) : s ? (
          <Card className="overflow-hidden">
            <div className="bg-primary px-6 py-5 text-primary-foreground">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide opacity-90">Ref {s.reference}</span>
                <Badge className={`${STATUS_UI[s.status]?.cls || 'bg-white/20'} border-0`}>{STATUS_UI[s.status]?.label || s.status}</Badge>
              </div>
              <p className="mt-3 font-display text-2xl font-bold">{s.origin} → {s.destination}</p>
              <p className="mt-1 flex items-center gap-1 text-sm opacity-90"><Clock className="h-4 w-4" /> {formatDateTime(s.departure_time)}</p>
            </div>
            <CardContent className="space-y-4 p-6">
              <Row icon={User} label="Passenger" value={s.passenger_name} />
              <Row icon={MapPin} label="Pickup" value={s.pickup || s.origin} />
              <Row icon={MapPin} label="Drop-off" value={s.dropoff || s.destination} />
              <div className="rounded-xl border border-border/60 p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Verified driver</p>
                <p className="mt-1 font-semibold">{s.driver_name}</p>
                {s.driver_phone && (
                  <a href={`tel:${s.driver_phone}`} className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"><Phone className="h-3.5 w-3.5" /> {s.driver_phone}</a>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><Car className="h-4 w-4" /> {s.vehicle || '—'}{s.plate ? ` · ${s.plate}` : ''}</p>
              </div>
              {s.status === 'completed'
                ? <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" /> Trip completed safely</p>
                : <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3" /> Auto-refreshing every 30s</p>}
            </CardContent>
          </Card>
        ) : null}

        <p className="mt-6 text-center text-xs text-muted-foreground">Shared with you by a NaijaRide traveller for safety.</p>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><Icon className="h-4 w-4" /></div>
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>
    </div>
  );
}

export default function TripSharePage() {
  return <Suspense fallback={<div className="min-h-screen" />}><Inner /></Suspense>;
}
