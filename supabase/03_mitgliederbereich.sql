-- Netzwerk Leopoldinum – Mitgliederbereich (Login, Profile, Freischaltung, Karte)
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Das Skript kann gefahrlos mehrmals ausgeführt werden.

-- ---------------------------------------------------------------
-- Tabelle: ein Eintrag pro Mitglied (verknüpft mit dem Login-Konto)
-- ---------------------------------------------------------------
create table if not exists public.mitglieder (
  id            uuid primary key references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  email         text not null,
  vorname       text check (char_length(vorname)  <= 100),
  nachname      text check (char_length(nachname) <= 100),
  telefon       text check (char_length(telefon)  <= 40),
  rolle         text check (rolle in ('ehemalige', 'schueler', 'eltern', 'lehrkraft', 'sonstiges')),
  jahrgang      smallint check (jahrgang between 1900 and 2100),
  nachricht     text check (char_length(nachricht) <= 2000),
  taetigkeit    text check (char_length(taetigkeit) <= 200),
  stadt         text check (char_length(stadt) <= 100),
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  kontakt       text not null default 'email' check (kontakt in ('email', 'telefon')),
  auf_karte     boolean not null default false,
  karte_einwilligung_am timestamptz,
  mindestens16  boolean not null default false,
  einwilligung  boolean not null default false,
  freigeschaltet    boolean not null default false,
  freigeschaltet_am timestamptz,
  ist_vorstand  boolean not null default false
);

alter table public.mitglieder enable row level security;

-- ---------------------------------------------------------------
-- Hilfsfunktionen (prüfen Rechte des angemeldeten Mitglieds)
-- ---------------------------------------------------------------
create or replace function public.ist_vorstand()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mitglieder where id = auth.uid() and ist_vorstand);
$$;

create or replace function public.ist_freigeschaltet()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mitglieder where id = auth.uid() and freigeschaltet);
$$;

-- ---------------------------------------------------------------
-- Neues Login-Konto → automatisch Mitglieder-Eintrag anlegen
-- (Angaben aus dem Formular "Mitglied werden" werden übernommen)
-- ---------------------------------------------------------------
create or replace function public.neues_konto()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.mitglieder (id, email, vorname, nachname, rolle, jahrgang, nachricht, mindestens16, einwilligung)
  values (
    new.id,
    new.email,
    left(nullif(trim(m->>'vorname'), ''), 100),
    left(nullif(trim(m->>'nachname'), ''), 100),
    case when m->>'rolle' in ('ehemalige', 'schueler', 'eltern', 'lehrkraft', 'sonstiges') then m->>'rolle' end,
    case when m->>'jahrgang' ~ '^\d{4}$' and (m->>'jahrgang')::int between 1900 and 2100 then (m->>'jahrgang')::smallint end,
    left(nullif(trim(m->>'nachricht'), ''), 2000),
    coalesce((m->>'mindestens16')::boolean, false),
    coalesce((m->>'einwilligung')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists bei_neuem_konto on auth.users;
create trigger bei_neuem_konto
  after insert on auth.users
  for each row execute function public.neues_konto();

-- Zeitpunkt der Einwilligung für die Karte festhalten
create or replace function public.karte_einwilligung()
returns trigger language plpgsql as $$
begin
  if new.auf_karte and not old.auf_karte then
    new.karte_einwilligung_am := now();
  elsif not new.auf_karte then
    new.karte_einwilligung_am := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bei_karte_aenderung on public.mitglieder;
create trigger bei_karte_aenderung
  before update on public.mitglieder
  for each row execute function public.karte_einwilligung();

-- ---------------------------------------------------------------
-- Zugriffsregeln
-- ---------------------------------------------------------------
-- Jedes Mitglied sieht seinen eigenen Eintrag, der Vorstand sieht alle.
drop policy if exists "Eigenes Profil oder Vorstand lesen" on public.mitglieder;
create policy "Eigenes Profil oder Vorstand lesen"
  on public.mitglieder for select to authenticated
  using (id = (select auth.uid()) or (select public.ist_vorstand()));

-- Jedes Mitglied darf nur sein eigenes Profil ändern …
drop policy if exists "Eigenes Profil ändern" on public.mitglieder;
create policy "Eigenes Profil ändern"
  on public.mitglieder for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- … und dabei nur diese Felder (nicht "freigeschaltet" oder "ist_vorstand").
revoke all on public.mitglieder from anon, authenticated;
grant select on public.mitglieder to authenticated;
grant update (vorname, nachname, telefon, taetigkeit, stadt, lat, lng, kontakt, auf_karte)
  on public.mitglieder to authenticated;

-- ---------------------------------------------------------------
-- Karte: nur freigeschaltete Mitglieder sehen andere freigeschaltete
-- Mitglieder, die der Anzeige auf der Karte zugestimmt haben.
-- ---------------------------------------------------------------
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
    and m.lat is not null and m.lng is not null;
$$;

-- Vorstand: Mitglied freischalten oder sperren
create or replace function public.freischalten(mitglied uuid, wert boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.ist_vorstand() then
    raise exception 'Nur der Vorstand darf Mitglieder freischalten.';
  end if;
  update public.mitglieder
     set freigeschaltet = wert,
         freigeschaltet_am = case when wert then now() end
   where id = mitglied;
end;
$$;

revoke execute on function public.mitglieder_karte(), public.freischalten(uuid, boolean),
  public.ist_vorstand(), public.ist_freigeschaltet() from public, anon;
grant execute on function public.mitglieder_karte(), public.freischalten(uuid, boolean),
  public.ist_vorstand(), public.ist_freigeschaltet() to authenticated;
