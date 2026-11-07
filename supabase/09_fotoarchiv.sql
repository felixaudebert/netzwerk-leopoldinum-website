-- Netzwerk Leopoldinum – Fotoarchiv nach Abiturjahrgängen (nur für Mitglieder)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 06 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.
--
-- Ablauf:
--   1. Der Vorstand legt einen Abiturjahrgang an (optional mit Klassenfoto).
--   2. Freigeschaltete Mitglieder laden Fotos hoch (Abiturfeier, Abiturfahrt, Sonstiges).
--      Sie sind zunächst nur für sie selbst und den Vorstand sichtbar.
--   3. Pro Hochladevorgang geht EINE E-Mail an info@ (Edge Function "foto-mail").
--   4. Der Vorstand gibt die Fotos frei – erst dann sehen alle Mitglieder sie.

-- ---------------------------------------------------------------
-- Abiturjahrgänge (vom Vorstand angelegt, mit Klassenfoto als Startbild)
-- ---------------------------------------------------------------
create table if not exists public.abiturjahrgaenge (
  jahr        smallint primary key check (jahr between 1900 and 2100),
  created_at  timestamptz not null default now(),
  klassenfoto text check (char_length(klassenfoto) <= 300)   -- Pfad im Speicher "fotoarchiv"
);

alter table public.abiturjahrgaenge enable row level security;

drop policy if exists "Mitglieder sehen Jahrgänge" on public.abiturjahrgaenge;
create policy "Mitglieder sehen Jahrgänge"
  on public.abiturjahrgaenge for select to authenticated
  using ((select public.ist_freigeschaltet()));

drop policy if exists "Vorstand verwaltet Jahrgänge" on public.abiturjahrgaenge;
create policy "Vorstand verwaltet Jahrgänge"
  on public.abiturjahrgaenge for all to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

revoke all on public.abiturjahrgaenge from anon, authenticated;
grant select, insert, update, delete on public.abiturjahrgaenge to authenticated;

-- ---------------------------------------------------------------
-- Fotos (Mitglieder laden hoch, der Vorstand gibt frei)
-- ---------------------------------------------------------------
create table if not exists public.fotos (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  jahrgang        smallint not null references public.abiturjahrgaenge (jahr) on delete cascade,
  kategorie       text not null check (kategorie in ('abiturfeier', 'abiturfahrt', 'sonstiges')),
  datei           text not null unique check (char_length(datei) <= 300),
  hochgeladen_von uuid references public.mitglieder (id) on delete set null,
  freigegeben     boolean not null default false,
  freigegeben_am  timestamptz
);

create index if not exists fotos_jahrgang on public.fotos (jahrgang, kategorie);
create index if not exists fotos_wartend on public.fotos (freigegeben) where not freigegeben;

alter table public.fotos enable row level security;

-- Freigegebene Fotos sehen alle freigeschalteten Mitglieder, wartende nur der/die Hochladende und der Vorstand
drop policy if exists "Mitglieder sehen Fotos" on public.fotos;
create policy "Mitglieder sehen Fotos"
  on public.fotos for select to authenticated
  using ((select public.ist_vorstand())
         or ((select public.ist_freigeschaltet())
             and (freigegeben or hochgeladen_von = (select auth.uid()))));

drop policy if exists "Vorstand ändert Fotos" on public.fotos;
create policy "Vorstand ändert Fotos"
  on public.fotos for update to authenticated
  using ((select public.ist_vorstand()))
  with check ((select public.ist_vorstand()));

drop policy if exists "Vorstand löscht Fotos" on public.fotos;
create policy "Vorstand löscht Fotos"
  on public.fotos for delete to authenticated
  using ((select public.ist_vorstand()));

-- Neue Fotos nur über fotos_einreichen() (prüft Rechte und schickt die E-Mail)
revoke all on public.fotos from anon, authenticated;
grant select, update, delete on public.fotos to authenticated;

-- Freigabe-Zeitpunkt automatisch setzen
create or replace function public.foto_freigabe_zeit()
returns trigger language plpgsql as $$
begin
  if new.freigegeben and (tg_op = 'INSERT' or not old.freigegeben) then
    new.freigegeben_am := now();
  elsif not new.freigegeben then
    new.freigegeben_am := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bei_foto_freigabe on public.fotos;
create trigger bei_foto_freigabe
  before insert or update on public.fotos
  for each row execute function public.foto_freigabe_zeit();

-- ---------------------------------------------------------------
-- Fotos einreichen: legt die Einträge an und benachrichtigt den Vorstand
-- (Fotos des Vorstands sind sofort freigegeben, dann keine E-Mail)
-- ---------------------------------------------------------------
create or replace function public.fotos_einreichen(jahr smallint, kategorie text, pfade text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ich      uuid := auth.uid();
  vorstand boolean := public.ist_vorstand();
  anzahl   integer := coalesce(array_length(pfade, 1), 0);
  m        record;
  geheim   text;
begin
  if ich is null or not public.ist_freigeschaltet() then
    raise exception 'Nur freigeschaltete Mitglieder dürfen Fotos hochladen.';
  end if;
  if anzahl = 0 or anzahl > 50 then
    raise exception 'Bitte 1 bis 50 Fotos auf einmal hochladen.';
  end if;
  if kategorie not in ('abiturfeier', 'abiturfahrt', 'sonstiges') then
    raise exception 'Unbekannte Kategorie.';
  end if;
  if not exists (select 1 from public.abiturjahrgaenge a where a.jahr = fotos_einreichen.jahr) then
    raise exception 'Diesen Abiturjahrgang gibt es noch nicht.';
  end if;
  -- Mitglieder dürfen nur Dateien aus ihrem eigenen Upload-Ordner einreichen
  if not vorstand and exists (
    select 1 from unnest(pfade) p where p not like 'eingang/' || ich::text || '/%'
  ) then
    raise exception 'Ungültiger Dateipfad.';
  end if;

  insert into public.fotos (jahrgang, kategorie, datei, hochgeladen_von, freigegeben)
  select fotos_einreichen.jahr, fotos_einreichen.kategorie, p, ich, vorstand
  from unnest(pfade) p;

  if not vorstand then
    begin
      select vorname, nachname, email into m from public.mitglieder where id = ich;
      select decrypted_secret into geheim from vault.decrypted_secrets where name = 'antrag_mail_secret';
      if geheim is not null then
        perform net.http_post(
          url := 'https://tjvjufyftfracjftfkdv.supabase.co/functions/v1/foto-mail',
          body := jsonb_build_object(
            'name', trim(concat_ws(' ', m.vorname, m.nachname)),
            'email', m.email,
            'jahrgang', fotos_einreichen.jahr,
            'kategorie', fotos_einreichen.kategorie,
            'anzahl', anzahl),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-antrag-secret', geheim)
        );
      end if;
    exception when others then
      -- Ein Fehler beim Benachrichtigen darf das Hochladen nie verhindern
      raise warning 'Foto-Benachrichtigung fehlgeschlagen: %', sqlerrm;
    end;
  end if;

  return anzahl;
end;
$$;

-- Darf die angemeldete Person diese Datei im Fotoarchiv sehen?
create or replace function public.foto_sichtbar(pfad text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ist_vorstand()
      or (public.ist_freigeschaltet() and (
            exists (select 1 from public.abiturjahrgaenge a where a.klassenfoto = pfad)
         or exists (select 1 from public.fotos f
                    where f.datei = pfad and (f.freigegeben or f.hochgeladen_von = auth.uid()))
         or pfad like 'eingang/' || auth.uid()::text || '/%'));
$$;

revoke execute on function public.fotos_einreichen(smallint, text, text[]), public.foto_sichtbar(text) from public, anon;
grant execute on function public.fotos_einreichen(smallint, text, text[]), public.foto_sichtbar(text) to authenticated;

-- ---------------------------------------------------------------
-- Speicher "fotoarchiv" – NICHT öffentlich (die Webseite holt zeitlich begrenzte Links)
--   klassenfotos/…            Klassenfotos (nur Vorstand)
--   eingang/<mitglied-id>/…   Fotos der Mitglieder
-- Nur JPG/PNG/WebP, max. 15 MB (die Webseite verkleinert Fotos vor dem Hochladen)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotoarchiv', 'fotoarchiv', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Fotoarchiv ansehen" on storage.objects;
create policy "Fotoarchiv ansehen"
  on storage.objects for select to authenticated
  using (bucket_id = 'fotoarchiv' and public.foto_sichtbar(name));

drop policy if exists "Fotoarchiv hochladen" on storage.objects;
create policy "Fotoarchiv hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'fotoarchiv' and (
    (select public.ist_vorstand())
    or ((select public.ist_freigeschaltet())
        and (storage.foldername(name))[1] = 'eingang'
        and (storage.foldername(name))[2] = (select auth.uid())::text)));

drop policy if exists "Fotoarchiv löschen" on storage.objects;
create policy "Fotoarchiv löschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'fotoarchiv' and (
    (select public.ist_vorstand())
    or ((storage.foldername(name))[1] = 'eingang'
        and (storage.foldername(name))[2] = (select auth.uid())::text)));
