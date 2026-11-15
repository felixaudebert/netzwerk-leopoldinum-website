-- Netzwerk Leopoldinum – Vorstandszugang für einzelne Mitglieder
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 05 und 12 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.
--
-- Vorstandsrechte (Vorstandsbereich, Mitgliederliste, Freischaltungen …) hat
--   * das Vereinskonto info@netzwerk-leopoldinum.de und
--   * jedes Mitglied, bei dem der Vorstand „Vorstandszugang“ gesetzt hat.
-- Das Feld lässt sich nur über die Edge Function "mitglied-bearbeiten" ändern (nur Vorstand),
-- Mitglieder selbst haben darauf keinen Schreibzugriff.

alter table public.mitglieder add column if not exists vorstandszugang boolean not null default false;

create or replace function public.ist_vorstand()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and (
        lower(u.email) = 'info@netzwerk-leopoldinum.de'
        or exists (select 1 from public.mitglieder m where m.id = u.id and m.vorstandszugang)
      )
  );
$$;
