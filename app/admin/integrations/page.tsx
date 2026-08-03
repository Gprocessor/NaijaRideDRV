'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/shared/navbar';
import { Footer } from '@/components/shared/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import {
  Plug, CreditCard, MessageSquare, ShieldCheck, MapPin, CheckCircle2, Circle, ExternalLink,
} from 'lucide-react';

type Integ = { key: string; label: string; connected: boolean; category: string; updated_at: string };

// How to activate each provider — shown inline so the admin knows exactly what to add.
const GUIDE: Record<string, { icon: any; how: string; where: string }> = {
  paystack:     { icon: CreditCard,   how: 'Add PAYSTACK_SECRET_KEY to the Edge Functions + NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY as a repo Variable.', where: 'dashboard.paystack.com' },
  termii_sms:   { icon: MessageSquare, how: 'Set TERMII_API_KEY + TERMII_SENDER_ID on the notify function.', where: 'termii.com' },
  whatsapp:     { icon: MessageSquare, how: 'Set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID on the notify function.', where: 'developers.facebook.com' },
  resend_email: { icon: MessageSquare, how: 'Set RESEND_API_KEY + MAIL_FROM on the notify function.', where: 'resend.com' },
  dojah_nin:    { icon: ShieldCheck,  how: 'Set DOJAH_API_KEY + DOJAH_APP_ID on the verify-nin function.', where: 'dojah.io' },
  google_maps:  { icon: MapPin,       how: 'Add NEXT_PUBLIC_GOOGLE_MAPS_KEY as a repo Variable.', where: 'console.cloud.google.com' },
};

const CATS: Record<string, string> = { payments: 'Payments', notifications: 'Notifications', identity: 'Identity / KYC', maps: 'Maps', other: 'Other' };

export default function IntegrationsPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [rows, setRows] = useState<Integ[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!loading && !user) { router.push('/login'); return; }
    if (!loading && profile && profile.role !== 'admin') { router.push('/dashboard'); return; }
    if (!loading && profile?.role === 'admin') {
      supabase.from('integrations').select('*').order('category').then(({ data }) => { setRows((data || []) as Integ[]); setLoadingData(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile, loading]);

  if (loading || loadingData) {
    return <div className="min-h-screen"><Navbar /><div className="container py-8 space-y-4"><Skeleton className="h-9 w-56" /><Skeleton className="h-64" /></div></div>;
  }

  const connected = rows.filter((r) => r.connected).length;
  const grouped = rows.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {} as Record<string, Integ[]>);

  return (
    <div className="min-h-screen"><Navbar />
      <div className="container py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold sm:text-3xl"><Plug className="h-7 w-7 text-primary" /> Integrations</h1>
            <p className="text-sm text-muted-foreground">Every provider is optional. Add a key when you register — the feature activates automatically.</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/admin')}>Dashboard</Button>
        </div>

        <Card className="mb-6 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary">Connected providers</p>
              <p className="font-display text-3xl font-bold text-primary">{connected}<span className="text-lg text-muted-foreground"> / {rows.length}</span></p>
            </div>
            <p className="max-w-xs text-right text-xs text-muted-foreground">Until connected, each feature runs in a safe simulated mode so you can test the full flow.</p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{CATS[cat] || cat}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((r) => {
                  const g = GUIDE[r.key] || { icon: Plug, how: '', where: '' };
                  return (
                    <Card key={r.key} className={r.connected ? 'border-success/30' : ''}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${r.connected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}><g.icon className="h-5 w-5" /></div>
                            <div><p className="font-semibold leading-tight">{r.label}</p>
                              {r.connected
                                ? <Badge className="mt-1 gap-1 bg-success/10 text-success"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
                                : <Badge className="mt-1 gap-1 bg-muted text-muted-foreground"><Circle className="h-3 w-3" /> Not connected (simulated)</Badge>}
                            </div>
                          </div>
                        </div>
                        {!r.connected && g.how && (
                          <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
                            <p>{g.how}</p>
                            {g.where && <a href={`https://${g.where}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline">Get a key at {g.where} <ExternalLink className="h-3 w-3" /></a>}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">Providers report their status automatically the first time their function runs with a valid key.</p>
      </div>
      <Footer />
    </div>
  );
}
