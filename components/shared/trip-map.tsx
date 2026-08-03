'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MAPS_ENABLED, MAPS_KEY } from '@/lib/config';
import { MapPin, Navigation, ExternalLink } from 'lucide-react';

// Key-optional route map. With NEXT_PUBLIC_GOOGLE_MAPS_KEY set it embeds a live
// Google Map with a driving route between origin and destination. Without a key
// it shows a branded fallback with a "View route" deep link (which needs no key).

const CITY: Record<string, [number, number]> = {
  Lagos: [6.5244, 3.3792], Abuja: [9.0765, 7.3986], 'Port Harcourt': [4.8156, 7.0498],
  Kano: [12.0022, 8.5919], Ibadan: [7.3776, 3.9470], 'Benin City': [6.335, 5.6037],
  Kaduna: [10.5222, 7.4383], Enugu: [6.5244, 7.5105], Onitsha: [6.1450, 6.7887],
  Aba: [5.1066, 7.3667], Jos: [9.8965, 8.8583], Warri: [5.5167, 5.75],
  Owerri: [5.4836, 7.0333], Calabar: [4.9757, 8.3417], Uyo: [5.0333, 7.9167],
  Sokoto: [13.0059, 5.2476], Maiduguri: [11.8333, 13.15], Akure: [7.2508, 5.2103],
  Ilorin: [8.4966, 4.5426], Lokoja: [7.7969, 6.7406],
};

function gmapsDir(origin: string, destination: string) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin + ', Nigeria')}&destination=${encodeURIComponent(destination + ', Nigeria')}&travelmode=driving`;
}

export function TripMap({ origin, destination, height = 220 }: { origin: string; destination: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAPS_ENABLED) return;
    const id = 'gmaps-js';
    if (document.getElementById(id)) { setReady(true); return; }
    const s = document.createElement('script');
    s.id = id;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    s.async = true; s.defer = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!MAPS_ENABLED || !ready || !ref.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    const o = CITY[origin] || [9.082, 8.6753];
    const map = new g.maps.Map(ref.current, { center: { lat: o[0], lng: o[1] }, zoom: 6, disableDefaultUI: true, zoomControl: true });
    const svc = new g.maps.DirectionsService();
    const renderer = new g.maps.DirectionsRenderer({ map, polylineOptions: { strokeColor: '#16a34a', strokeWeight: 5 } });
    svc.route(
      { origin: `${origin}, Nigeria`, destination: `${destination}, Nigeria`, travelMode: g.maps.TravelMode.DRIVING },
      (res: any, status: string) => { if (status === 'OK') renderer.setDirections(res); },
    );
  }, [ready, origin, destination]);

  if (MAPS_ENABLED) {
    return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-lg border border-border/60" />;
  }

  return (
    <a href={gmapsDir(origin, destination)} target="_blank" rel="noopener noreferrer" style={{ height }}
      className="group relative flex w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-secondary/40">
      <div className="relative flex items-center gap-2 text-sm font-medium">
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-primary"><MapPin className="h-3.5 w-3.5" /> {origin}</span>
        <Navigation className="h-4 w-4 text-muted-foreground" />
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-accent"><MapPin className="h-3.5 w-3.5" /> {destination}</span>
      </div>
      <span className="relative mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">View route on Google Maps <ExternalLink className="h-3 w-3" /></span>
    </a>
  );
}
