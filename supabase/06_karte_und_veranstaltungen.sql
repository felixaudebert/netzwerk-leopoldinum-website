-- Netzwerk Leopoldinum – Kartenpunkte von Hand + Veranstaltungen über den Vorstand
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 05 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.

-- ---------------------------------------------------------------
-- Kartenpunkte, die der Vorstand von Hand anlegt
-- (z. B. Mitglieder mit Papierantrag und ohne eigenes Konto)
-- ---------------------------------------------------------------
create table if not exists public.karte_eintraege (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null check (char_length(name) between 1 and 200),
  taetigkeit       text check (char_length(taetigkeit) <= 200),
  stadt            text not null check (char_length(stadt) <= 100),
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  kontakt_art      text check (kontakt_art in ('email', 'telefon')),
  kontakt_wert     text check (char_length(kontakt_wert) <= 200),
  einwilligung_am  date not null,          -- wann die Person der Karte zugestimmt hat
  notiz            text check (char_length(notiz) <= 500)
);

alter table public.karte_eintraege enable row level security;

drop policy if exists "Vorstand verwaltet Kartenpunkte" on public.karte_eintraege;
create policy "Vorstand verwaltet Kartenpunkte"
  on public.karte_eintraege for all to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

revoke all on public.karte_eintraege from anon, authenticated;
grant select, insert, update, delete on public.karte_eintraege to authenticated;

-- Karte: Mitglieder mit Einwilligung + Kartenpunkte des Vorstands
create or replace function public.mitglieder_karte()
returns table (id uuid, name text, kontakt_art text, kontakt_wert text, taetigkeit text, stadt text, lat double precision, lng double precision)
language sql stable security definer set search_path = '' as $$
  select m.id,
         trim(concat_ws(' ', m.vorname, m.nachname)),
         m.kontakt,
         case when m.kontakt = 'telefon' and m.telefon is not null then m.telefon else m.email end,
         m.taetigkeit,
         m.stadt,
         m.lat,
         m.lng
  from public.mitglieder m
  where public.ist_freigeschaltet()
    and m.freigeschaltet
    and m.auf_karte
    and m.lat is not null and m.lng is not null
  union all
  select k.id, k.name, k.kontakt_art, k.kontakt_wert, k.taetigkeit, k.stadt, k.lat, k.lng
  from public.karte_eintraege k
  where public.ist_freigeschaltet();
$$;

-- ---------------------------------------------------------------
-- Veranstaltungen (Startseite „Aktuelles“ + Archiv auf veranstaltungen.html)
-- Jede/r darf lesen, nur der Vorstand darf schreiben.
-- ---------------------------------------------------------------
create table if not exists public.veranstaltungen (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  datum       date not null,
  titel       text not null check (char_length(titel) between 1 and 150),
  ort         text check (char_length(ort) <= 150),
  text        text not null check (char_length(text) between 1 and 700),   -- kurzer Bericht
  mehr        text check (char_length(mehr) <= 5000),                       -- weitere Absätze (nur Archiv)
  bild        text check (char_length(bild) <= 300),                        -- Pfad im Speicher "veranstaltungen"
  video       text check (char_length(video) <= 300),
  aktuell     boolean not null default true                                 -- unter „Aktuelles“ zeigen
);

alter table public.veranstaltungen enable row level security;

drop policy if exists "Veranstaltungen sind öffentlich" on public.veranstaltungen;
create policy "Veranstaltungen sind öffentlich"
  on public.veranstaltungen for select to anon, authenticated
  using (true);

drop policy if exists "Vorstand verwaltet Veranstaltungen" on public.veranstaltungen;
create policy "Vorstand verwaltet Veranstaltungen"
  on public.veranstaltungen for all to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

revoke all on public.veranstaltungen from anon, authenticated;
grant select on public.veranstaltungen to anon, authenticated;
grant insert, update, delete on public.veranstaltungen to authenticated;

-- Bisheriger Eintrag aus der Webseite (nur beim ersten Ausführen)
insert into public.veranstaltungen (datum, titel, ort, text, mehr, aktuell)
select '2026-10-30', 'Berufsorientierungstag 2026', 'Gymnasium Leopoldinum',
       'Ehemalige kehrten ans Leopoldinum zurück und erzählten offen von ihrem Weg nach dem Abitur – vom Studium über die Ausbildung bis zum Auslandsjahr. In 15 Vorträgen und einer Keynote zur Studienfinanzierung bekamen die Schülerinnen und Schüler Einblicke aus erster Hand.',
       'Die Vorträge waren auf drei Blöcke verteilt und deckten fünf Wege nach dem Abitur ab: Studium an Universität oder Hochschule, Ausbildung mit Praxis im Betrieb und Theorie in der Berufsschule, duales Studium, ein freiwilliges Jahr (FSJ, FÖJ oder BFD) sowie ein Auslandsjahr mit Work & Travel, Au-pair oder Sprachkurs.',
       true
where not exists (select 1 from public.veranstaltungen where titel = 'Berufsorientierungstag 2026');

-- ---------------------------------------------------------------
-- Speicher für Bilder und Videos der Veranstaltungen
-- (öffentlich lesbar, hochladen/löschen nur der Vorstand; max. 50 MB pro Datei)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('veranstaltungen', 'veranstaltungen', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- (Löschen braucht zusätzlich Leserechte über die Schnittstelle)
drop policy if exists "Vorstand sieht Veranstaltungsmedien" on storage.objects;
create policy "Vorstand sieht Veranstaltungsmedien"
  on storage.objects for select to authenticated
  using (bucket_id = 'veranstaltungen' and (select public.ist_vorstand()));

drop policy if exists "Vorstand lädt Veranstaltungsmedien hoch" on storage.objects;
create policy "Vorstand lädt Veranstaltungsmedien hoch"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'veranstaltungen' and (select public.ist_vorstand()));

drop policy if exists "Vorstand ändert Veranstaltungsmedien" on storage.objects;
create policy "Vorstand ändert Veranstaltungsmedien"
  on storage.objects for update to authenticated
  using (bucket_id = 'veranstaltungen' and (select public.ist_vorstand()));

drop policy if exists "Vorstand löscht Veranstaltungsmedien" on storage.objects;
create policy "Vorstand löscht Veranstaltungsmedien"
  on storage.objects for delete to authenticated
  using (bucket_id = 'veranstaltungen' and (select public.ist_vorstand()));
