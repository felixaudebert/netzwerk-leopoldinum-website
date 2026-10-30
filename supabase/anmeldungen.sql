-- Netzwerk Leopoldinum – Tabelle für Anmeldungen über das Formular
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.

create table if not exists public.anmeldungen (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  vorname     text not null check (char_length(vorname)  between 1 and 100),
  nachname    text not null check (char_length(nachname) between 1 and 100),
  email       text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rolle       text not null check (rolle in ('ehemalige', 'schueler', 'eltern', 'lehrkraft', 'sonstiges')),
  jahrgang    smallint check (jahrgang between 1900 and 2100),
  nachricht   text check (char_length(nachricht) <= 2000),
  einwilligung boolean not null check (einwilligung)
);

-- Row Level Security: Besucher der Webseite dürfen nur neue Einträge anlegen,
-- aber keine Anmeldungen lesen, ändern oder löschen.
alter table public.anmeldungen enable row level security;

drop policy if exists "Webseite darf Anmeldungen anlegen" on public.anmeldungen;
create policy "Webseite darf Anmeldungen anlegen"
  on public.anmeldungen
  for insert
  to anon
  with check (true);

grant insert on table public.anmeldungen to anon;
