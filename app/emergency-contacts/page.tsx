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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import { ShieldCheck, UserPlus, Trash2, Loader2, Phone, Star, Users } from 'lucide-react';

type Contact = { id: string; name: string; phone: string; relation: string | null; is_primary: boolean };

export default function EmergencyContactsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Contact[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from('emergency_contacts').select('*').order('is_primary', { ascending: false }).order('created_at', { ascending: true });
    setItems((data || []) as Contact[]);
    setLoadingData(false);
  };

  useEffect(() => {
    if (!loading && !user) { router.push('/login'); return; }
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) { toast.error('Name and phone are required'); return; }
    setSaving(true);
    const { error } = await supabase.from('emergency_contacts').insert({
      name: name.trim(), phone: phone.trim(), relation: relation.trim() || null,
      is_primary: items.length === 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Contact added');
    setName(''); setPhone(''); setRelation('');
    load();
  };

  const makePrimary = async (id: string) => {
    setBusyId(id);
    await supabase.from('emergency_contacts').update({ is_primary: false }).neq('id', id);
    const { error } = await supabase.from('emergency_contacts').update({ is_primary: true }).eq('id', id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    load();
  };
  const remove = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    setItems((xs) => xs.filter((x) => x.id !== id));
    toast.success('Removed');
  };

  if (loading || loadingData) {
    return <div className="min-h-screen"><Navbar /><div className="container max-w-2xl py-8 space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-40" /></div></div>;
  }

  return (
    <div className="min-h-screen"><Navbar />
      <div className="container max-w-2xl py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl"><ShieldCheck className="h-7 w-7 text-primary" /> Emergency Contacts</h1>
            <p className="text-sm text-muted-foreground">Trusted people we alert if you trigger an SOS during a trip.</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/profile')}>Profile</Button>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><UserPlus className="h-5 w-5" /> Add a contact</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amaka (sister)" required /></div>
              <div className="space-y-1.5"><Label>Phone *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" required /></div>
              <div className="space-y-1.5"><Label>Relationship</Label><Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Sister, Spouse…" /></div>
              <div className="sm:col-span-2"><Button type="submit" className="w-full gap-2" disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><UserPlus className="h-4 w-4" /> Add contact</>}</Button></div>
            </form>
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <Card className="border-dashed"><CardContent className="flex flex-col items-center py-14 text-center text-sm text-muted-foreground"><Users className="mb-2 h-8 w-8" /> No emergency contacts yet — add at least one before you travel.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {items.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Phone className="h-5 w-5" /></div>
                    <div>
                      <p className="font-semibold">{c.name} {c.is_primary && <Badge className="ml-1 gap-1 bg-primary/10 text-primary"><Star className="h-3 w-3" /> Primary</Badge>}</p>
                      <p className="text-sm text-muted-foreground">{c.phone}{c.relation ? ` · ${c.relation}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!c.is_primary && <Button size="sm" variant="ghost" disabled={busyId === c.id} onClick={() => makePrimary(c.id)}>{busyId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Make primary'}</Button>}
                    <Button size="icon" variant="ghost" className="text-destructive" disabled={busyId === c.id} onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
