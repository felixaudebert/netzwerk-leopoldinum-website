-- Netzwerk Leopoldinum – vollständiger Mitgliedsantrag mit SEPA-Lastschriftmandat
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03_mitgliederbereich.sql wurde bereits ausgeführt.

-- ---------------------------------------------------------------
-- Sensible Angaben getrennt speichern (nur Mitglied selbst + Vorstand)
-- (Abschlussjahrgang und Beschäftigung stehen in "mitglieder": jahrgang, taetigkeit)
-- ---------------------------------------------------------------
create table if not exists public.mitglieder_privat (
  id                 uuid primary key references public.mitglieder (id) on delete cascade,
  geburtsdatum       date not null,
  strasse            text not null check (char_length(strasse) <= 200),
  plz                text not null check (plz ~ '^\d{4,5}$'),
  ort                text not null check (char_length(ort) <= 100),
  foto_einwilligung  boolean not null default false,
  beitrag_euro       numeric(7, 2) not null check (beitrag_euro >= 5),
  kontoinhaber       text not null check (char_length(kontoinhaber) <= 140),
  kontoinhaber_anschrift text not null check (char_length(kontoinhaber_anschrift) <= 300),
  kreditinstitut     text not null check (char_length(kreditinstitut) <= 140),
  bic                text check (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  iban               text not null check (iban ~ '^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$'),
  sepa_mandat_am     timestamptz not null default now()
);

alter table public.mitglieder_privat enable row level security;

drop policy if exists "Eigene Daten oder Vorstand lesen" on public.mitglieder_privat;
create policy "Eigene Daten oder Vorstand lesen"
  on public.mitglieder_privat for select to authenticated
  using (id = (select auth.uid()) or (select public.ist_vorstand()));

revoke all on public.mitglieder_privat from anon, authenticated;
grant select on public.mitglieder_privat to authenticated;

-- ---------------------------------------------------------------
-- Neues Konto: Angaben aus dem Antrag übernehmen und prüfen
-- ---------------------------------------------------------------
create or replace function public.neues_konto()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  geb date;
  alter_jahre int;
  beitrag numeric;
  mindestbeitrag numeric;
  iban_klar text;
begin
  insert into public.mitglieder (id, email, vorname, nachname, rolle, jahrgang, nachricht, taetigkeit, stadt, mindestens16, einwilligung)
  values (
    new.id,
    new.email,
    left(nullif(trim(m->>'vorname'), ''), 100),
    left(nullif(trim(m->>'nachname'), ''), 100),
    case when m->>'rolle' in ('ehemalige', 'schueler', 'eltern', 'lehrkraft', 'sonstiges') then m->>'rolle' end,
    case when m->>'jahrgang' ~ '^\d{4}$' and (m->>'jahrgang')::int between 1900 and 2100 then (m->>'jahrgang')::smallint end,
    left(nullif(trim(m->>'nachricht'), ''), 2000),
    left(nullif(trim(m->>'beschaeftigung'), ''), 200),
    left(nullif(trim(m->>'ort'), ''), 100),
    false,
    coalesce((m->>'einwilligung')::boolean, false)
  )
  on conflict (id) do nothing;

  -- Nur bei Anmeldung über das Online-Formular (Einladungen haben keinen Antrag)
  if m ? 'geburtsdatum' then
    geb := (m->>'geburtsdatum')::date;
    alter_jahre := extract(year from age(current_date, geb));
    if alter_jahre < 16 then
      raise exception 'Mitglied muss mindestens 16 Jahre alt sein.';
    end if;
    beitrag := (m->>'beitrag_euro')::numeric;
    mindestbeitrag := case when alter_jahre <= 30 then 5 else 25 end;
    if beitrag < mindestbeitrag then
      raise exception 'Beitrag liegt unter dem Mindestbeitrag.';
    end if;
    if not coalesce((m->>'sepa_mandat')::boolean, false) then
      raise exception 'SEPA-Mandat fehlt.';
    end if;
    iban_klar := upper(regexp_replace(m->>'iban', '\s', '', 'g'));

    insert into public.mitglieder_privat (id, geburtsdatum, strasse, plz, ort,
      foto_einwilligung, beitrag_euro, kontoinhaber, kontoinhaber_anschrift, kreditinstitut, bic, iban)
    values (
      new.id, geb,
      trim(m->>'strasse'), trim(m->>'plz'), trim(m->>'ort'),
      coalesce((m->>'foto_einwilligung')::boolean, false),
      beitrag,
      trim(m->>'kontoinhaber'), trim(m->>'kontoinhaber_anschrift'), trim(m->>'kreditinstitut'),
      nullif(upper(regexp_replace(coalesce(m->>'bic', ''), '\s', '', 'g')), ''),
      iban_klar
    );

    update public.mitglieder set mindestens16 = true where id = new.id;

    -- Sensible Angaben nicht zusätzlich in den Konto-Infos aufbewahren
    update auth.users
       set raw_user_meta_data = raw_user_meta_data
         - array['geburtsdatum', 'strasse', 'plz', 'iban', 'bic', 'kreditinstitut',
                 'kontoinhaber', 'kontoinhaber_anschrift', 'beitrag_euro', 'sepa_mandat', 'nachricht']
     where id = new.id;
  end if;

  return new;
end;
$$;
