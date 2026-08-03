-- ============================================================
-- NaijaRide — Enable Supabase Realtime for live seat updates (idempotent)
-- Requires the seats table from 07_seatmap_and_messaging.sql.
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='seats') then
    execute 'alter publication supabase_realtime add table public.seats';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trips') then
    execute 'alter publication supabase_realtime add table public.trips';
  end if;
exception when others then raise notice 'realtime step skipped: %', sqlerrm;
end $$;
alter table public.seats replica identity full;
