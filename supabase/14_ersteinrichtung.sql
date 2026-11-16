-- Netzwerk Leopoldinum – Ersteinrichtung: Datenschutz bestätigen + Entscheidung zur Mitgliederkarte
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Voraussetzung: 03 bis 13 wurden ausgeführt. Das Skript kann gefahrlos mehrmals laufen.
--
-- Jedes Mitglied muss, bevor es den Mitgliederbereich nutzen kann,
--   1. die Datenschutzerklärung akzeptieren und
--   2. entscheiden, ob (und mit welchen Angaben) es auf der Mitgliederkarte erscheint.
-- Bei Einladungen geschieht das zusammen mit dem Festlegen des Passworts (Edge Function "zugang-aktivieren"),
-- bei allen anderen Konten beim nächsten Login (mitglieder.html zeigt dann nur dieses Formular).
-- Bis dahin liefert ist_freigeschaltet() false – Karte, Leo-Kalender, Fotoarchiv und Jahresberichte bleiben gesperrt.

-- ---------------------------------------------------------------
-- Nachweise (Zeitpunkte setzt nur der Server)
-- ---------------------------------------------------------------
alter table public.mitglieder add column if not exists datenschutz_akzeptiert_am timestamptz;
alter table public.mitglieder add column if not exists karte_entschieden_am timestamptz;

-- Online-Antrag: Dort wurde die Einwilligung (mit Link zur Datenschutzerklärung) bereits angekreuzt.
-- (Bestandsmitglieder aus dem Import haben einwilligung = false und bestätigen beim ersten Login.)
create or replace function public.antrag_datenschutz()
returns trigger language plpgsql as $$
begin
  if new.einwilligung and new.datenschutz_akzeptiert_am is null then
    new.datenschutz_akzeptiert_am := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bei_neuem_mitglied_datenschutz on public.mitglieder;
create trigger bei_neuem_mitglied_datenschutz
  before insert on public.mitglieder
  for each row execute function public.antrag_datenschutz();

-- Bestehende Konten nachtragen:
--   * Online-Anträge (mit SEPA-Mandat) haben der Datenschutzerklärung schon im Antrag zugestimmt.
--   * Wer bereits auf der Karte ist, hat sich für die Karte entschieden.
update public.mitglieder m
   set datenschutz_akzeptiert_am = m.created_at
 where m.datenschutz_akzeptiert_am is null
   and m.einwilligung
   and exists (select 1 from public.mitglieder_privat p where p.id = m.id and p.iban is not null);

update public.mitglieder
   set karte_entschieden_am = coalesce(karte_einwilligung_am, now())
 where karte_entschieden_am is null
   and auf_karte;

-- ---------------------------------------------------------------
-- Ersteinrichtung speichern (prüft alle Angaben an einer Stelle)
-- ---------------------------------------------------------------
create or replace function public.einrichtung_speichern(
  p_mitglied    uuid,
  p_datenschutz boolean,
  p_auf_karte   boolean,
  p_stadt       text default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_taetigkeit  text default null,
  p_kontakt     text default 'email',
  p_telefon     text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  stadt_klar text := nullif(trim(coalesce(p_stadt, '')), '');
  taetigkeit_klar text := nullif(trim(coalesce(p_taetigkeit, '')), '');
  telefon_klar text := nullif(trim(coalesce(p_telefon, '')), '');
begin
  if not coalesce(p_datenschutz, false) then
    raise exception 'Bitte akzeptiere die Datenschutzerklärung.';
  end if;
  if p_auf_karte is null then
    raise exception 'Bitte entscheide, ob du auf der Mitgliederkarte erscheinen möchtest.';
  end if;

  if p_auf_karte then
    if stadt_klar is null or p_lat is null or p_lng is null then
      raise exception 'Für die Karte brauchen wir deine Stadt.';
    end if;
    if coalesce(p_kontakt, '') not in ('email', 'telefon') then
      raise exception 'Bitte wähle, ob andere Mitglieder dich per E-Mail oder Telefon erreichen.';
    end if;
    if p_kontakt = 'telefon' and telefon_klar is null then
      raise exception 'Bitte gib eine Telefonnummer ein oder wähle E-Mail als Kontakt.';
    end if;

    update public.mitglieder
       set datenschutz_akzeptiert_am = now(),
           einwilligung = true,
           karte_entschieden_am = now(),
           auf_karte = true,
           stadt = stadt_klar,
           lat = p_lat,
           lng = p_lng,
           kontakt = p_kontakt,
           telefon = coalesce(telefon_klar, telefon),
           taetigkeit = coalesce(taetigkeit_klar, taetigkeit)
     where id = p_mitglied;
  else
    update public.mitglieder
       set datenschutz_akzeptiert_am = now(),
           einwilligung = true,
           karte_entschieden_am = now(),
           auf_karte = false
     where id = p_mitglied;
  end if;

  if not found then
    raise exception 'Mitglied nicht gefunden.';
  end if;
end;
$$;

-- Für eingeloggte Mitglieder: immer nur das eigene Konto
create or replace function public.einrichtung_abschliessen(
  p_datenschutz boolean,
  p_auf_karte   boolean,
  p_stadt       text default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_taetigkeit  text default null,
  p_kontakt     text default 'email',
  p_telefon     text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  perform public.einrichtung_speichern(auth.uid(), p_datenschutz, p_auf_karte, p_stadt, p_lat, p_lng,
                                       p_taetigkeit, p_kontakt, p_telefon);
end;
$$;

-- Muss das angemeldete Mitglied die Ersteinrichtung noch abschließen? (Vereinskonto info@ nie)
create or replace function public.einrichtung_offen()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.mitglieder
    where id = auth.uid()
      and lower(email) <> 'info@netzwerk-leopoldinum.de'
      and (datenschutz_akzeptiert_am is null or karte_entschieden_am is null)
  );
$$;

-- ---------------------------------------------------------------
-- Freigeschaltet = vom Vorstand freigeschaltet UND Ersteinrichtung abgeschlossen
-- ---------------------------------------------------------------
create or replace function public.ist_freigeschaltet()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.ist_vorstand()
      or exists (
        select 1 from public.mitglieder
        where id = auth.uid()
          and freigeschaltet
          and datenschutz_akzeptiert_am is not null
          and karte_entschieden_am is not null
      );
$$;

-- ---------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------
-- einrichtung_speichern nimmt eine beliebige Mitglieds-ID → nur für den Server (Edge Function)
revoke execute on function public.einrichtung_speichern(uuid, boolean, boolean, text, double precision, double precision, text, text, text)
  from public, anon, authenticated;
grant execute on function public.einrichtung_speichern(uuid, boolean, boolean, text, double precision, double precision, text, text, text)
  to service_role;

revoke execute on function public.einrichtung_abschliessen(boolean, boolean, text, double precision, double precision, text, text, text),
  public.einrichtung_offen() from public, anon;
grant execute on function public.einrichtung_abschliessen(boolean, boolean, text, double precision, double precision, text, text, text),
  public.einrichtung_offen() to authenticated;
