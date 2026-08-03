'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/shared/navbar';
import { Footer } from '@/components/shared/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import { NIGERIAN_CITIES, formatNaira } from '@/lib/constants';
import {
  MapPin, Calendar, Clock, Car, Loader2, Plus, Route, ShieldCheck, AlertCircle,
} from 'lucide-react';

type Vehicle = { id: string; make: string; model: string; year: number; plate_number: string; total_seats: number; status: string };

export default function NewTripPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [vehicleId, setVehicleId] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('');
  const [seats, setSeats] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [luggage, setLuggage] = useState('1 medium bag');
  const [description, setDescription] = useState('');

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, make, model, year, plate_number, total_seats, status')
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setVehicles((data || []) as Vehicle[]);
    setLoadingData(false);
  };

  useEffect(() => {
    if (!loading && !user) { router.push('/login'); return; }
    if (!loading && profile && profile.role !== 'driver') { router.push('/dashboard'); return; }
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, loading]);

  const approvedVehicles = useMemo(() => vehicles.filter((v) => v.status === 'approved'), [vehicles]);
  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === vehicleId), [vehicles, vehicleId]);

  useEffect(() => {
    if (selectedVehicle && !seats) setSeats(String(selectedVehicle.total_seats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const total = (parseInt(price || '0', 10) || 0) * (parseInt(seats || '0', 10) || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) { toast.error('Select a vehicle'); return; }
    if (!origin || !destination) { toast.error('Choose origin and destination'); return; }
    if (origin === destination) { toast.error('Origin and destination must differ'); return; }
    if (!date || !time) { toast.error('Set the departure date and time'); return; }
    const departure = new Date(`${date}T${time}:00`);
    if (isNaN(departure.getTime()) || departure.getTime() <= Date.now()) { toast.error('Departure must be in the future'); return; }
    const p = parseInt(price, 10);
    const s = parseInt(seats, 10);
    if (!p || p <= 0) { toast.error('Enter a valid price per seat'); return; }
    if (!s || s <= 0) { toast.error('Enter available seats'); return; }
    if (selectedVehicle && s > selectedVehicle.total_seats) { toast.error(`This vehicle only has ${selectedVehicle.total_seats} seats`); return; }

    setSubmitting(true);

    // CORE insert — only columns guaranteed to exist in every schema version.
    // pickup_point / dropoff_point (Phase-1 SQL) are added separately as a
    // best-effort update so a missing column can NEVER block trip creation.
    const { data: created, error } = await supabase
      .from('trips')
      .insert({
        vehicle_id: vehicleId,
        origin,
        destination,
        departure_time: departure.toISOString(),
        price_per_seat: p,
        total_seats: s,
        available_seats: s,
        luggage_allowance: luggage || '1 medium bag',
        description: description || null,
      })
      .select('id')
      .single();

    if (error) {
      setSubmitting(false);
      toast.error(error.message || 'Could not publish trip');
      return;
    }

    if ((pickup || dropoff) && created?.id) {
      try {
        await supabase.from('trips').update({ pickup_point: pickup || null, dropoff_point: dropoff || null }).eq('id', created.id);
      } catch { /* columns may not exist yet — safe to ignore */ }
    }

    setSubmitting(false);
    toast.success('Trip published! Passengers can now book it.');
    router.push('/driver');
  };

  if (loading || loadingData) {
    return <div className="min-h-screen"><Navbar /><div className="container max-w-2xl py-8 space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-96" /></div></div>;
  }

  if (approvedVehicles.length === 0) {
    return (
      <div className="min-h-screen"><Navbar />
        <div className="container max-w-2xl py-10">
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <AlertCircle className="h-12 w-12 text-warning" />
              <h1 className="mt-4 font-display text-xl font-bold">You need an approved vehicle first</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {vehicles.length === 0
                  ? 'Add a vehicle and wait for admin approval, then you can publish trips.'
                  : 'Your vehicle(s) are still under review. Once approved, you can publish trips.'}
              </p>
              <div className="mt-5 flex gap-2">
                <Button className="gap-2" onClick={() => router.push('/driver/vehicles')}><Car className="h-4 w-4" /> Manage vehicles</Button>
                <Button variant="outline" onClick={() => router.push('/driver')}>Back to dashboard</Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen"><Navbar />
      <div className="container max-w-2xl py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Publish a Trip</h1>
            <p className="text-sm text-muted-foreground">Create a scheduled intercity trip for passengers to book.</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/driver')}>Dashboard</Button>
        </div>

        {!profile?.is_verified_driver && (
          <Card className="mb-6 border-warning/30 bg-warning/5">
            <CardContent className="flex items-center gap-3 p-4 text-sm">
              <ShieldCheck className="h-5 w-5 text-warning" />
              <span>You aren&apos;t a Verified Driver yet. You can publish, but verified drivers rank higher and earn passenger trust. <button onClick={() => router.push('/driver/verification')} className="font-medium text-primary hover:underline">Get verified →</button></span>
            </CardContent>
          </Card>
        )}

        <form onSubmit={submit} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Route className="h-5 w-5" /> Route & Vehicle</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Vehicle *</Label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger><SelectValue placeholder="Select an approved vehicle" /></SelectTrigger>
                  <SelectContent>
                    {approvedVehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.make} {v.model} ({v.year}) · {v.plate_number} · {v.total_seats} seats</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" /> From *</Label>
                  <Select value={origin} onValueChange={setOrigin}>
                    <SelectTrigger><SelectValue placeholder="Origin city" /></SelectTrigger>
                    <SelectContent>{NIGERIAN_CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-accent" /> To *</Label>
                  <Select value={destination} onValueChange={setDestination}>
                    <SelectTrigger><SelectValue placeholder="Destination city" /></SelectTrigger>
                    <SelectContent>{NIGERIAN_CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Pickup point</Label><Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Ojota bus stop" /></div>
                <div className="space-y-1.5"><Label>Drop-off point</Label><Input value={dropoff} onChange={(e) => setDropoff(e.target.value)} placeholder="e.g. Iwo Road" /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Calendar className="h-5 w-5" /> Schedule & Pricing</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Departure date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
                <div className="space-y-1.5"><Label className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Departure time *</Label><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
                <div className="space-y-1.5"><Label>Price per seat (₦) *</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="6000" min={1} required /></div>
                <div className="space-y-1.5"><Label>Available seats *</Label><Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder={selectedVehicle ? String(selectedVehicle.total_seats) : '4'} min={1} required /></div>
              </div>
              <div className="space-y-1.5"><Label>Luggage allowance</Label><Input value={luggage} onChange={(e) => setLuggage(e.target.value)} placeholder="1 medium bag" /></div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Comfortable AC ride, no smoking, water provided…" /></div>
              {total > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 text-sm">
                  <span className="text-muted-foreground">Potential earnings if fully booked</span>
                  <span className="font-display text-lg font-bold text-primary">{formatNaira(total)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button type="submit" className="flex-1 gap-2" disabled={submitting}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Publishing…</> : <><Plus className="h-4 w-4" /> Publish trip</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/driver')}>Cancel</Button>
          </div>
        </form>
      </div>
      <Footer />
    </div>
  );
}
