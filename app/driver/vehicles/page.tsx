'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/shared/navbar';
import { Footer } from '@/components/shared/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { uploadFile } from '@/lib/storage';
import { useAuth } from '@/components/providers/auth-provider';
import {
  Car, Plus, Loader2, Upload, Trash2, Snowflake, CheckCircle2, Clock, XCircle, ImageIcon,
} from 'lucide-react';

type Vehicle = {
  id: string; make: string; model: string; year: number; color: string;
  plate_number: string; total_seats: number; has_ac: boolean;
  photo_url: string | null; status: string; created_at: string;
};

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  approved: { label: 'Approved', cls: 'bg-success/10 text-success', icon: CheckCircle2 },
  pending: { label: 'Under review', cls: 'bg-accent/10 text-accent', icon: Clock },
  rejected: { label: 'Rejected', cls: 'bg-destructive/10 text-destructive', icon: XCircle },
};

export default function VehiclesPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState('4');
  const [hasAc, setHasAc] = useState(true);
  const [photo, setPhoto] = useState<File | null>(null);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
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

  const resetForm = () => {
    setMake(''); setModel(''); setYear(''); setColor('');
    setPlate(''); setSeats('4'); setHasAc(true); setPhoto(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!make || !model || !year || !color || !plate) { toast.error('Please fill in all required fields'); return; }
    const yr = parseInt(year, 10);
    if (yr < 1990 || yr > new Date().getFullYear() + 1) { toast.error('Enter a valid year'); return; }
    if (parseInt(seats, 10) < 1) { toast.error('Seats must be at least 1'); return; }
    if (photo && photo.size > 6 * 1024 * 1024) { toast.error('Photo too large (max 6MB)'); return; }

    setSaving(true);
    try {
      // Photo upload is BEST-EFFORT: if the storage bucket isn't set up yet, we
      // still create the vehicle (without a photo) rather than failing the action.
      let photo_url: string | null = null;
      if (photo) {
        try {
          const { url } = await uploadFile('vehicle-photos', photo, { prefix: 'vehicle' });
          photo_url = url;
        } catch {
          toast.message('Photo not uploaded (storage not configured) — vehicle saved without it.');
        }
      }
      const { error } = await supabase.from('vehicles').insert({
        make, model, year: yr, color,
        plate_number: plate.toUpperCase().trim(),
        total_seats: parseInt(seats, 10), has_ac: hasAc, photo_url,
      });
      if (error) throw error;
      toast.success('Vehicle added — it will be reviewed before it can carry passengers.');
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not add vehicle');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this vehicle? Trips using it are unaffected but you can no longer select it.')) return;
    setBusyId(id);
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Vehicle deleted');
    setVehicles((vs) => vs.filter((v) => v.id !== id));
  };

  if (loading || loadingData) {
    return <div className="min-h-screen"><Navbar /><div className="container py-8 space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-64" /></div></div>;
  }

  return (
    <div className="min-h-screen"><Navbar />
      <div className="container max-w-4xl py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">My Vehicles</h1>
            <p className="text-sm text-muted-foreground">Register your cars. Each vehicle is reviewed before you can publish trips with it.</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/driver')}>Dashboard</Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {vehicles.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center py-14 text-center">
                  <Car className="h-10 w-10 text-muted-foreground" />
                  <p className="mt-3 font-medium">No vehicles yet</p>
                  <p className="text-sm text-muted-foreground">Add your first vehicle using the form to start publishing trips.</p>
                </CardContent>
              </Card>
            ) : vehicles.map((v) => {
              const s = STATUS[v.status] || STATUS.pending;
              return (
                <Card key={v.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
                      {v.photo_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={v.photo_url} alt={`${v.make} ${v.model}`} className="h-full w-full object-cover" />
                        : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{v.make} {v.model} <span className="font-normal text-muted-foreground">({v.year})</span></p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{v.color}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{v.plate_number}</span>
                        <span>{v.total_seats} seats</span>
                        {v.has_ac && <span className="inline-flex items-center gap-1 text-primary"><Snowflake className="h-3 w-3" /> AC</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={`gap-1 ${s.cls}`}><s.icon className="h-3 w-3" /> {s.label}</Badge>
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive" disabled={busyId === v.id} onClick={() => remove(v.id)}>
                        {busyId === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {vehicles.some((v) => v.status === 'approved') && (
              <Button className="w-full gap-2" onClick={() => router.push('/driver/trips/new')}><Plus className="h-4 w-4" /> Publish a trip with an approved vehicle</Button>
            )}
          </div>

          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Plus className="h-5 w-5" /> Add a vehicle</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Make *</Label><Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" required /></div>
                  <div className="space-y-1.5"><Label>Model *</Label><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Corolla" required /></div>
                  <div className="space-y-1.5"><Label>Year *</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2020" required /></div>
                  <div className="space-y-1.5"><Label>Colour *</Label><Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Silver" required /></div>
                </div>
                <div className="space-y-1.5"><Label>Plate number *</Label><Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="LAG-123XY" required /></div>
                <div className="space-y-1.5"><Label>Seats (excluding driver) *</Label><Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} min={1} max={30} required /></div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium"><Snowflake className="h-4 w-4 text-primary" /> Air conditioning</div>
                  <Switch checked={hasAc} onCheckedChange={setHasAc} />
                </div>
                <div className="space-y-1.5">
                  <Label>Photo</Label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50">
                    <Upload className="h-4 w-4" />
                    <span className="truncate">{photo ? photo.name : 'Upload a clear photo of your car (optional)'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
                <Button type="submit" className="w-full gap-2" disabled={saving}>
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Plus className="h-4 w-4" /> Add vehicle</>}
                </Button>
                <p className="text-xs text-muted-foreground">New vehicles start as “Under review”. An admin approves them for safety compliance before they can be used on trips.</p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
}
