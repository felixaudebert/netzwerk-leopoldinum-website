-- Netzwerk Leopoldinum – Bestandsmitglieder übernehmen + Website-Zugang per Einladung
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 06 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.
--
-- Ablauf:
--   1. scripts/bestand-importieren.mjs legt die Bestandsmitglieder still an
--      (Konto ohne Passwort, keine E-Mail, zugang_offen = true).
--   2. Der Vorstand klickt in der Mitgliederliste „Website-Zugang freischalten“ →
--      Edge Function "zugang-freischalten" schickt eine Einladung mit persönlichem Link (30 Tage gültig).
--   3. Über den Link legt das Mitglied sein Passwort fest (Edge Function "zugang-aktivieren").

-- ---------------------------------------------------------------
-- Zusätzliche Angaben zu Mitgliedern
-- ---------------------------------------------------------------
alter table public.mitglieder add column if not exists mitglied_seit date;               -- laut Mitgliederliste des Vereins
alter table public.mitglieder add column if not exists zugang_offen boolean not null default false;  -- true = noch kein Website-Zugang
alter table public.mitglieder add column if not exists zugang_eingeladen_am timestamptz;  -- letzte Einladung verschickt
alter table public.mitglieder add column if not exists zugang_aktiviert_am timestamptz;   -- Passwort festgelegt

-- ---------------------------------------------------------------
-- Antragsdaten: Bestandsmitglieder haben (noch) keine Bankdaten in der Datenbank
-- und teils ausländische Postleitzahlen (z. B. A-1080, CH-8125)
-- ---------------------------------------------------------------
alter table public.mitglieder_privat alter column beitrag_euro drop not null;
alter table public.mitglieder_privat alter column kontoinhaber drop not null;
alter table public.mitglieder_privat alter column kontoinhaber_anschrift drop not null;
alter table public.mitglieder_privat alter column kreditinstitut drop not null;
alter table public.mitglieder_privat alter column iban drop not null;
alter table public.mitglieder_privat alter column sepa_mandat_am drop not null;

alter table public.mitglieder_privat drop constraint if exists mitglieder_privat_plz_check;
alter table public.mitglieder_privat add constraint mitglieder_privat_plz_check
  check (char_length(plz) between 3 and 12);

-- Antrags-E-Mail an info@ nur für echte Online-Anträge (mit SEPA-Mandat), nicht beim Import
create or replace function public.antrag_benachrichtigen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  geheim text;
begin
  if new.iban is null then
    return new;
  end if;
  select decrypted_secret into geheim from vault.decrypted_secrets where name = 'antrag_mail_secret';
  if geheim is not null then
    perform net.http_post(
      url := 'https://tjvjufyftfracjftfkdv.supabase.co/functions/v1/antrag-mail',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-antrag-secret', geheim)
    );
  end if;
  return new;
exception when others then
  raise warning 'Antrag-Benachrichtigung fehlgeschlagen: %', sqlerrm;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Einladungs-Links (nur der Server/Edge Functions haben Zugriff)
-- Gespeichert wird nur ein Hash des Links, nie der Link selbst.
-- ---------------------------------------------------------------
create table if not exists public.zugang_einladungen (
  mitglied_id  uuid primary key references public.mitglieder (id) on delete cascade,
  token_hash   text not null unique,
  erstellt_am  timestamptz not null default now(),
  gueltig_bis  timestamptz not null,
  eingeloest_am timestamptz
);

alter table public.zugang_einladungen enable row level security;
revoke all on public.zugang_einladungen from anon, authenticated;
