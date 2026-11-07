-- Netzwerk Leopoldinum – Jahresberichte (ein PDF pro Jahr) im Archiv – nur für Mitglieder
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 06 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.

-- ---------------------------------------------------------------
-- Tabelle: höchstens ein Jahresbericht pro Jahr
-- Lesen nur freigeschaltete Mitglieder und der Vorstand, schreiben nur der Vorstand.
-- ---------------------------------------------------------------
create table if not exists public.jahresberichte (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  jahr        smallint not null unique check (jahr between 1900 and 2100),
  titel       text check (char_length(titel) <= 150),        -- optional, sonst "Jahresbericht <Jahr>"
  text        text check (char_length(text) <= 700),         -- optionale Kurzbeschreibung
  datei       text not null check (char_length(datei) <= 300) -- Pfad im Speicher "jahresberichte"
);

alter table public.jahresberichte enable row level security;

drop policy if exists "Jahresberichte sind öffentlich" on public.jahresberichte;
drop policy if exists "Mitglieder lesen Jahresberichte" on public.jahresberichte;
create policy "Mitglieder lesen Jahresberichte"
  on public.jahresberichte for select to authenticated
  using ((select public.ist_freigeschaltet()) or (select public.ist_vorstand()));

drop policy if exists "Vorstand verwaltet Jahresberichte" on public.jahresberichte;
create policy "Vorstand verwaltet Jahresberichte"
  on public.jahresberichte for all to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

revoke all on public.jahresberichte from anon, authenticated;
grant select on public.jahresberichte to authenticated;
grant insert, update, delete on public.jahresberichte to authenticated;

-- ---------------------------------------------------------------
-- Speicher für die PDFs – NICHT öffentlich: Die Webseite holt für freigeschaltete
-- Mitglieder zeitlich begrenzte Links. Hochladen/löschen nur der Vorstand; nur PDF, max. 50 MB.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jahresberichte', 'jahresberichte', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Vorstand sieht Jahresberichte" on storage.objects;
drop policy if exists "Mitglieder sehen Jahresberichte" on storage.objects;
create policy "Mitglieder sehen Jahresberichte"
  on storage.objects for select to authenticated
  using (bucket_id = 'jahresberichte'
         and ((select public.ist_freigeschaltet()) or (select public.ist_vorstand())));

drop policy if exists "Vorstand lädt Jahresberichte hoch" on storage.objects;
create policy "Vorstand lädt Jahresberichte hoch"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'jahresberichte' and (select public.ist_vorstand()));

drop policy if exists "Vorstand ändert Jahresberichte" on storage.objects;
create policy "Vorstand ändert Jahresberichte"
  on storage.objects for update to authenticated
  using (bucket_id = 'jahresberichte' and (select public.ist_vorstand()));

drop policy if exists "Vorstand löscht Jahresberichte" on storage.objects;
create policy "Vorstand löscht Jahresberichte"
  on storage.objects for delete to authenticated
  using (bucket_id = 'jahresberichte' and (select public.ist_vorstand()));
