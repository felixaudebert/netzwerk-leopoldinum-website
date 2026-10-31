-- Netzwerk Leopoldinum – Bestätigung "mindestens 16 Jahre" speichern
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.

alter table public.anmeldungen
  add column if not exists mindestens16 boolean not null default false;

alter table public.anmeldungen
  drop constraint if exists anmeldungen_mindestens16_check;
alter table public.anmeldungen
  add constraint anmeldungen_mindestens16_check check (mindestens16) not valid;
