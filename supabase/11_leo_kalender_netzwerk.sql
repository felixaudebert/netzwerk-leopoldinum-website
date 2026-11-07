-- Netzwerk Leopoldinum – Leo-Kalender: Termine des Netzwerks kennzeichnen
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 10_leo_kalender.sql wurde ausgeführt. Das Skript kann gefahrlos mehrmals laufen.

-- true  = Veranstaltung des Netzwerk Leopoldinum (im Kalender mit Logo)
-- false = normale Veranstaltung am Leopoldinum
alter table public.leo_termine
  add column if not exists netzwerk boolean not null default false;

-- Erste Netzwerk-Termine (nur beim ersten Ausführen)
insert into public.leo_termine (titel, datum, uhrzeit, ort, netzwerk)
select 'Konzert „Erinnerung Verbindet“', '2026-11-20', '18:00 Uhr', 'Aula', true
where not exists (select 1 from public.leo_termine where datum = '2026-11-20' and titel like '%Erinnerung Verbindet%');

insert into public.leo_termine (titel, datum, uhrzeit, ort, netzwerk)
select 'Weihnachtskonzert', '2026-12-22', '18:00 Uhr', 'Michaelikirche, anschließend im Leopoldinum', true
where not exists (select 1 from public.leo_termine where datum = '2026-12-22' and titel = 'Weihnachtskonzert');
