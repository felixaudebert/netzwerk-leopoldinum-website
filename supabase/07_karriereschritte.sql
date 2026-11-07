-- Netzwerk Leopoldinum – Vorherige Karriereschritte im Profil und auf der Karte
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 06 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.

-- ---------------------------------------------------------------
-- Tabelle: beliebig viele frühere Stationen pro Mitglied
-- (Zeitraum monatsgenau: "von" und "bis" sind jeweils der 1. des Monats)
-- ---------------------------------------------------------------
create table if not exists public.karriereschritte (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  mitglied_id  uuid not null references public.mitglieder (id) on delete cascade,
  taetigkeit   text not null check (char_length(taetigkeit) between 1 and 200),
  stadt        text not null check (char_length(stadt) between 1 and 100),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  von          date not null,
  bis          date not null,
  check (von <= bis)
);

create index if not exists karriereschritte_mitglied on public.karriereschritte (mitglied_id);

alter table public.karriereschritte enable row level security;

-- Lesen: eigene Einträge, der Vorstand alle. Schreiben nur über karriere_speichern().
drop policy if exists "Eigene Karriereschritte oder Vorstand lesen" on public.karriereschritte;
create policy "Eigene Karriereschritte oder Vorstand lesen"
  on public.karriereschritte for select to authenticated
  using (mitglied_id = (select auth.uid()) or (select public.ist_vorstand()));

revoke all on public.karriereschritte from anon, authenticated;
grant select on public.karriereschritte to authenticated;

-- ---------------------------------------------------------------
-- Speichern: ersetzt alle eigenen Karriereschritte in einem Schritt
-- (entweder klappt alles oder nichts wird geändert)
-- ---------------------------------------------------------------
create or replace function public.karriere_speichern(schritte jsonb)
returns setof public.karriereschritte
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if jsonb_typeof(schritte) <> 'array' or jsonb_array_length(schritte) > 50 then
    raise exception 'Ungültige Karriereschritte.';
  end if;

  delete from public.karriereschritte where mitglied_id = auth.uid();

  insert into public.karriereschritte (mitglied_id, taetigkeit, stadt, lat, lng, von, bis)
  select auth.uid(),
         trim(s->>'taetigkeit'),
         trim(s->>'stadt'),
         (s->>'lat')::double precision,
         (s->>'lng')::double precision,
         date_trunc('month', (s->>'von')::date)::date,
         date_trunc('month', (s->>'bis')::date)::date
  from jsonb_array_elements(schritte) s;

  return query
    select * from public.karriereschritte where mitglied_id = auth.uid() order by von desc;
end;
$$;

-- ---------------------------------------------------------------
-- Karte: aktuelle Standorte + frühere Stationen (Spalten "aktuell", "von", "bis" sind neu)
-- ---------------------------------------------------------------
drop function if exists public.mitglieder_karte();
create function public.mitglieder_karte()
returns table (id uuid, name text, kontakt_art text, kontakt_wert text, taetigkeit text, stadt text,
               lat double precision, lng double precision, aktuell boolean, von date, bis date)
language sql stable security definer set search_path = '' as $$
  -- aktuelle Standorte der Mitglieder mit Einwilligung
  select m.id,
         trim(concat_ws(' ', m.vorname, m.nachname)),
         m.kontakt,
         case when m.kontakt = 'telefon' and m.telefon is not null then m.telefon else m.email end,
         m.taetigkeit,
         m.stadt,
         m.lat,
         m.lng,
         true, null::date, null::date
  from public.mitglieder m
  where public.ist_freigeschaltet()
    and m.freigeschaltet
    and m.auf_karte
    and m.lat is not null and m.lng is not null
  union all
  -- frühere Karriereschritte derselben Mitglieder
  select k.id,
         trim(concat_ws(' ', m.vorname, m.nachname)),
         m.kontakt,
         case when m.kontakt = 'telefon' and m.telefon is not null then m.telefon else m.email end,
         k.taetigkeit,
         k.stadt,
         k.lat,
         k.lng,
         false, k.von, k.bis
  from public.karriereschritte k
  join public.mitglieder m on m.id = k.mitglied_id
  where public.ist_freigeschaltet()
    and m.freigeschaltet
    and m.auf_karte
  union all
  -- Kartenpunkte, die der Vorstand von Hand angelegt hat
  select e.id, e.name, e.kontakt_art, e.kontakt_wert, e.taetigkeit, e.stadt, e.lat, e.lng,
         true, null::date, null::date
  from public.karte_eintraege e
  where public.ist_freigeschaltet();
$$;

revoke execute on function public.mitglieder_karte(), public.karriere_speichern(jsonb) from public, anon;
grant execute on function public.mitglieder_karte(), public.karriere_speichern(jsonb) to authenticated;
