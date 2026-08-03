'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Wifi } from 'lucide-react';

// Live seat picker. Loads the seat map (trip_seat_map RPC) and subscribes to
// Supabase Realtime on public.seats for this trip, so seats flip to "taken" the
// instant another passenger books — no refresh. Falls back to a 15s poll if
// realtime is unavailable on the project.
export function SeatMap({
  tripId, maxSelectable, onChange,
}: {
  tripId: string;
  maxSelectable?: number;
  onChange: (selected: number[]) => void;
}) {
  const [seats, setSeats] = useState<{ seat_number: number; is_booked: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [live, setLive] = useState(false);
  const selRef = useRef<number[]>([]);

  const fetchSeats = async () => {
    const { data } = await supabase.rpc('trip_seat_map', { p_trip_id: tripId });
    const rows = (data || []) as { seat_number: number; is_booked: boolean }[];
    setSeats(rows);
    setSelected((cur) => {
      const stillFree = cur.filter((n) => !rows.find((r) => r.seat_number === n && r.is_booked));
      if (stillFree.length !== cur.length) { selRef.current = stillFree; onChange(stillFree); }
      return stillFree;
    });
    setLoading(false);
  };

  useEffect(() => {
    fetchSeats();
    const channel = supabase
      .channel(`seats:${tripId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'seats', filter: `trip_id=eq.${tripId}` },
        (payload: any) => {
          setSeats((cur) => {
            const row = payload.new || payload.old;
            if (!row) return cur;
            const next = cur.map((s) => s.seat_number === row.seat_number ? { ...s, is_booked: !!row.is_booked } : s);
            if (row.is_booked && selRef.current.includes(row.seat_number)) {
              const kept = selRef.current.filter((n) => n !== row.seat_number);
              selRef.current = kept; setSelected(kept); onChange(kept);
            }
            return next;
          });
        })
      .subscribe((status: string) => setLive(status === 'SUBSCRIBED'));
    const poll = setInterval(() => { if (!live) fetchSeats(); }, 15000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const toggle = (n: number, booked: boolean) => {
    if (booked) return;
    setSelected((cur) => {
      let next: number[];
      if (cur.includes(n)) next = cur.filter((x) => x !== n);
      else if (maxSelectable && cur.length >= maxSelectable) next = [...cur.slice(1), n];
      else next = [...cur, n];
      selRef.current = next; onChange(next);
      return next;
    });
  };

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!seats.length) return <p className="text-xs text-muted-foreground">Seat map unavailable — using seat count.</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-secondary border border-border" /> Free</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary" /> Selected</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-muted-foreground/30" /> Taken</span>
        {live && <span className="inline-flex items-center gap-1 text-success"><Wifi className="h-3 w-3" /> Live</span>}
      </div>
      <div className="mx-auto grid max-w-[220px] grid-cols-5 gap-2">
        {seats.map((s) => {
          const isSel = selected.includes(s.seat_number);
          const col = ((s.seat_number - 1) % 4);
          return (
            <button key={s.seat_number} type="button" onClick={() => toggle(s.seat_number, s.is_booked)} disabled={s.is_booked}
              className={[
                'flex h-9 w-9 items-center justify-center rounded-md border text-xs font-semibold transition',
                col === 2 ? 'col-start-4' : col === 3 ? 'col-start-5' : col === 0 ? 'col-start-1' : 'col-start-2',
                s.is_booked ? 'cursor-not-allowed border-transparent bg-muted-foreground/30 text-muted-foreground'
                  : isSel ? 'border-primary bg-primary text-primary-foreground shadow'
                  : 'border-border bg-secondary hover:border-primary/50',
              ].join(' ')}
              title={s.is_booked ? 'Taken' : `Seat ${s.seat_number}`}>
              {s.seat_number}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {selected.length ? `Selected: ${[...selected].sort((a, b) => a - b).join(', ')}` : 'Tap a seat to select'}
      </p>
    </div>
  );
}
