-- Netzwerk Leopoldinum – Leo-Kalender: Termine am Leopoldinum (nur für Mitglieder)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 06 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.
--
-- Ferien und Feiertage des bayerischen Schuljahrs kommen automatisch über die
-- Edge Function "schulkalender" (Quelle: OpenHolidays API) – hier stehen nur die
-- zusätzlichen Termine, die der Vorstand einträgt.

create table if not exists public.leo_termine (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  titel         text not null check (char_length(titel) between 1 and 150),
  datum         date not null,
  bis           date check (bis >= datum),                    -- nur bei mehrtägigen Terminen
  uhrzeit       text check (char_length(uhrzeit) <= 40),      -- z. B. "18:00 Uhr" oder "18–21 Uhr"
  ort           text check (char_length(ort) <= 150),
  beschreibung  text check (char_length(beschreibung) <= 1000)
);

create index if not exists leo_termine_datum on public.leo_termine (datum);

alter table public.leo_termine enable row level security;

drop policy if exists "Mitglieder sehen Leo-Termine" on public.leo_termine;
create policy "Mitglieder sehen Leo-Termine"
  on public.leo_termine for select to authenticated
  using ((select public.ist_freigeschaltet()));

drop policy if exists "Vorstand verwaltet Leo-Termine" on public.leo_termine;
create policy "Vorstand verwaltet Leo-Termine"
  on public.leo_termine for all to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

revoke all on public.leo_termine from anon, authenticated;
grant select, insert, update, delete on public.leo_termine to authenticated;
