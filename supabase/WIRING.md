# NaijaRide — Google Maps + Real-time Seat Updates

Two features. The **components + SQL below are complete drop-ins** (this exact code
was build-verified). Because I couldn't access your repo in this session, the small
`app/trip/page.tsx` edits are given as precise snippets — apply them, or re-upload
your repo (as a .zip) and I'll hand back the fully-wired, build-verified page.

## Files (drop in — same paths)
```
lib/config.ts                        Key-optional flags (MAPS_ENABLED, MAPS_KEY, …)
supabase/09_realtime.sql             Enables Realtime on the seats table (run once)
components/shared/seat-map.tsx        LIVE seat picker (Supabase Realtime + poll fallback)
components/shared/trip-map.tsx        Key-optional Google Map (embed with key; deep-link without)
```
> `seat-map.tsx` needs the seats table + `trip_seat_map` / `request_booking_seats`
> from `07_seatmap_and_messaging.sql`. Run that first if you haven't.
> If you already have `lib/config.ts` from the commercial batch, keep the newer one
> (this adds the MAPS_* flags — same shape).

## STEP 1 — SQL
Supabase → SQL Editor → run `supabase/09_realtime.sql`.

## STEP 2 — Wire `app/trip/page.tsx` (4 tiny edits)

**a) Imports** — after the payments/auth imports add:
```tsx
import { SeatMap } from '@/components/shared/seat-map';
import { TripMap } from '@/components/shared/trip-map';
```
And add `Navigation` to your existing `lucide-react` import list.

**b) State** — where you declare `const [seats, setSeats] = useState(1);` add below:
```tsx
const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
const effectiveSeats = selectedSeats.length > 0 ? selectedSeats.length : seats;
```

**c) Booking handler** — replace the single `request_booking` call with:
```tsx
const { data, error } = selectedSeats.length > 0
  ? await supabase.rpc('request_booking_seats', { p_trip_id: trip.id, p_seat_numbers: selectedSeats, p_promo: promo.trim() || null })
  : await supabase.rpc('request_booking', { p_trip_id: trip.id, p_seats: seats, p_promo: promo.trim() || null });
```
Then, anywhere you compute the amount/total/button using `trip.price_per_seat * seats`,
change `seats` → `effectiveSeats`. (e.g. the Paystack call, the Total line, and the
"Pay ₦…" button label.)

**d) UI** — insert the map after the route/description card (before the Vehicle card):
```tsx
<Card>
  <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Navigation className="h-5 w-5" /> Route</CardTitle></CardHeader>
  <CardContent><TripMap origin={trip.origin} destination={trip.destination} /></CardContent>
</Card>
```
And insert the live seat map in the booking sidebar (just before your Promo code block):
```tsx
{trip.available_seats > 0 && (
  <div className="space-y-2">
    <label className="block text-sm font-medium">Pick your seats <span className="font-normal text-muted-foreground">(optional, live)</span></label>
    <div className="rounded-lg border border-border/60 p-3">
      <SeatMap tripId={trip.id} onChange={setSelectedSeats} />
    </div>
    {selectedSeats.length > 0 && <p className="text-xs text-muted-foreground">Booking {selectedSeats.length} specific seat(s). Clear all to book by count.</p>}
  </div>
)}
```

## STEP 3 — Turn Maps ON (whenever you register)
Add repo Variable `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, enable **Maps JavaScript API** +
**Directions API** on it, and re-run the Pages workflow. Until then the fallback
preview + Google Maps deep link work for everyone.

## Apply
```bash
git add supabase/09_realtime.sql lib/config.ts \
        components/shared/seat-map.tsx components/shared/trip-map.tsx app/trip/page.tsx
git commit -m "Google Maps route + real-time live seat updates"
git push
```

## Behaviour
- **Real-time seats:** open a trip in two tabs; book in one → it greys out instantly in
  the other. Concurrent double-booking is still blocked server-side by
  `request_booking_seats`. Auto-falls back to a 15s poll if Realtime is off.
- **Maps (no key):** clean origin→destination preview that deep-links to Google Maps.
- **Maps (with key):** embedded interactive map with the driving route in NaijaRide green.
