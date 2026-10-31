-- Netzwerk Leopoldinum – Vorstand nur über info@ + E-Mail bei jedem neuen Antrag
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03_mitgliederbereich.sql und 04_mitgliedsantrag.sql wurden ausgeführt.

-- ---------------------------------------------------------------
-- Vorstandsrechte hat nur das (bestätigte) Konto info@netzwerk-leopoldinum.de
-- ---------------------------------------------------------------
create or replace function public.ist_vorstand()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) = 'info@netzwerk-leopoldinum.de'
      and email_confirmed_at is not null
  );
$$;

-- Der Vorstand sieht die Karte auch ohne eigene Freischaltung
create or replace function public.ist_freigeschaltet()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ist_vorstand()
      or exists (select 1 from public.mitglieder where id = auth.uid() and freigeschaltet);
$$;

-- Die alte Spalte wird nicht mehr gebraucht
alter table public.mitglieder drop column if exists ist_vorstand;

-- ---------------------------------------------------------------
-- Neuer Antrag → Edge Function "antrag-mail" schickt ihn an info@
-- (Das Passwort für den Aufruf liegt verschlüsselt im Supabase Vault.)
-- ---------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.antrag_benachrichtigen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  geheim text;
begin
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
  -- Ein Fehler beim Benachrichtigen darf den Antrag nie verhindern
  raise warning 'Antrag-Benachrichtigung fehlgeschlagen: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists bei_neuem_antrag on public.mitglieder_privat;
create trigger bei_neuem_antrag
  after insert on public.mitglieder_privat
  for each row execute function public.antrag_benachrichtigen();
