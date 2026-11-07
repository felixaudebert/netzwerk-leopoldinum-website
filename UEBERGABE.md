# Übergabe – Webseite Netzwerk Leopoldinum e.V.

Alles, was jemand wissen muss, um die Webseite weiterzuführen. Stand: 31.10.2026.

> **Achtung: Dieses Repository ist öffentlich.** Hier stehen **niemals** Passwörter, Schlüssel oder
> Mitgliederdaten – nur, *wie* etwas heißt und *wo* es liegt. Alle Geheimnisse gehören in den
> Passwortmanager des Vereins. Felder mit ☐ bitte ausfüllen bzw. abhaken.

---

## 1. Überblick in einem Satz pro Teil

| Teil | Was | Wo |
|---|---|---|
| Webseite | Statisches HTML/CSS/JavaScript, kein Build-Schritt | dieses Repository |
| Hosting | IONOS Deploy Now (Server in Deutschland) | IONOS-Kundenkonto |
| Veröffentlichen | Jeder Push auf GitHub lädt automatisch zu IONOS hoch | `.github/workflows/` |
| Datenbank, Login, Dateien | Supabase (Server in Irland, EU) | Supabase-Dashboard |
| E-Mail | Postfach info@netzwerk-leopoldinum.de bei IONOS | IONOS-Kundenkonto |
| Antrags-Benachrichtigung | Supabase Edge Function `antrag-mail` → Mail an info@ | `supabase/functions/antrag-mail/` |

Ablauf eines Mitgliedsantrags: Formular auf der Startseite → Supabase legt Konto an (`auth.users`) →
Trigger schreibt `mitglieder` + `mitglieder_privat` → Trigger ruft `antrag-mail` → Mail an info@ →
Vorstand schaltet im Mitgliederbereich frei.

---

## 2. Zugänge und Konten

| Dienst | Wofür | Konto / Besitzer | Eintrag im Passwortmanager |
|---|---|---|---|
| **GitHub** | Code, automatisches Veröffentlichen | Repo `felixaudebert/netzwerk-leopoldinum-website` (privates Konto von Felix Audebert) | ☐ |
| **Supabase** | Datenbank, Login, Dateispeicher | Projekt `tjvjufyftfracjftfkdv` („felixaudebert's Project“) | ☐ |
| **IONOS** | Hosting, Domain, E-Mail | Kundennummer: ☐ | ☐ |
| **info@netzwerk-leopoldinum.de** | Vereinspostfach **und einziger Vorstandszugang** zum Mitgliederbereich | – | ☐ |

☐ **Empfehlung:** GitHub-Repository in eine Vereins-Organisation übertragen oder mindestens ein zweites
Vorstandsmitglied als Admin eintragen (GitHub → Settings → Collaborators). Ebenso im Supabase-Dashboard
(Organization → Team) und bei IONOS eine zweite Person berechtigen. Sonst hängt alles an einer Person.

☐ Zwei-Faktor-Anmeldung: Wiederherstellungscodes aller Konten im Passwortmanager hinterlegt.

---

## 3. Geheimnisse – wo sie liegen und wie man sie ersetzt

Alle Werte **nur im Passwortmanager**, nie im Repository.

| Name | Wofür | Hinterlegt in | Bei Verlust |
|---|---|---|---|
| Supabase **Secret Key** (`sb_secret_…`) | Einladungs-Skript `npm run einladen` | lokale Datei `.env` (`SUPABASE_SECRET_KEY`) | Supabase → Project Settings → API Keys → neuen Secret Key erzeugen |
| Supabase **Datenbank-Passwort** | Direkter Datenbankzugriff (selten nötig) | – | Supabase → Project Settings → Database → Reset |
| **SMTP-Passwort** (= Passwort von info@) | Login-E-Mails und Antrags-Mails | Supabase → Authentication → SMTP **und** Edge Functions → Secrets → `SMTP_PASS` | Bei IONOS ändern, dann an **beiden** Stellen in Supabase eintragen |
| **`antrag_mail_secret`** | Datenbank darf `antrag-mail` aufrufen | Supabase → Integrations → Vault | Neuen Zufallswert setzen – **identisch** auch als `ANTRAG_SECRET` (siehe nächste Zeile) |
| **`ANTRAG_SECRET`** | Gegenstück zum Vault-Secret | Supabase → Edge Functions → Secrets | muss exakt gleich `antrag_mail_secret` sein, sonst kommen keine Antrags-Mails |
| **`IONOS_API_KEY`**, **`IONOS_SSH_KEY`** | Automatischer Upload zu IONOS | GitHub → Settings → Secrets and variables → Actions (Werte dort nicht mehr lesbar) | In IONOS Deploy Now neu erzeugen bzw. Projekt neu mit GitHub verbinden |

Nicht geheim (stehen bewusst im Code): Supabase-Adresse und der öffentliche „publishable“ Schlüssel in
`js/config.js`. Die Datenbank schützt sich über Zugriffsregeln (Row Level Security), nicht über diesen Schlüssel.

---

## 4. Supabase

- **Projekt:** `tjvjufyftfracjftfkdv` – https://tjvjufyftfracjftfkdv.supabase.co – Region West EU (Irland)
- **Tarif:** ☐ (Free/Pro) – im kostenlosen Tarif pausiert Supabase Projekte nach längerer Inaktivität und es gibt keine verlässlichen Backups (siehe Abschnitt 10).
- **Auftragsverarbeitungsvertrag (AVV/DPA):** abgeschlossen am ☐, abgelegt unter ☐

### Tabellen

| Tabelle | Inhalt | Wer darf was |
|---|---|---|
| `mitglieder` | Profil je Konto (Name, Rolle, Jahrgang, Stadt, Koordinaten, Kartenfreigabe, Freischaltung) | Mitglied: eigenes lesen/ändern · Vorstand: alle lesen |
| `mitglieder_privat` | Antragsdaten: Geburtsdatum, Adresse, Beitrag, **IBAN/SEPA-Mandat**, Foto-Einwilligung | Mitglied: eigenes lesen · Vorstand: alle lesen |
| `karte_eintraege` | Kartenpunkte, die der Vorstand von Hand einträgt (Personen ohne Konto) | nur Vorstand |
| `veranstaltungen` | „Aktuelles“ und Archiv | alle lesen · Vorstand schreiben |
| `anmeldungen` | **Altlast** aus der ersten Version (vor den Benutzerkonten), wird nicht mehr benutzt | ☐ prüfen, ob leer, dann löschen |

### Funktionen in der Datenbank
- `ist_vorstand()` – Vorstand ist **ausschließlich** das bestätigte Konto info@netzwerk-leopoldinum.de
- `ist_freigeschaltet()`, `freischalten(mitglied, wert)`, `mitglieder_karte()`
- Trigger: `neues_konto` (Konto → Mitgliedseintrag), `karte_einwilligung` (Zeitstempel), `antrag_benachrichtigen` (ruft `antrag-mail`)

### Dateispeicher (Storage)
- Bucket `veranstaltungen` – öffentlich lesbar, Hochladen/Löschen nur Vorstand, max. 50 MB, JPG/PNG/WebP/MP4/WebM

### Edge Function `antrag-mail`
- Code: `supabase/functions/antrag-mail/index.ts`
- Secrets: `ANTRAG_SECRET`, `SMTP_PASS` (automatisch vorhanden: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Versand über `smtp.ionos.de`, Port 465 (SSL), Absender und Empfänger info@
- Bereitgestellt mit der Supabase CLI: `supabase functions deploy antrag-mail` (Projekt ist lokal verknüpft, siehe `supabase/.temp/`)

### Edge Function `foto-mail`
- Code: `supabase/functions/foto-mail/index.ts` – meldet neu hochgeladene Fotos (eine E-Mail pro Upload) an info@
- Wird von der Datenbankfunktion `fotos_einreichen` aufgerufen; nutzt **dieselben** Secrets wie `antrag-mail` (`ANTRAG_SECRET`, `SMTP_PASS`, Vault `antrag_mail_secret`)
- Bereitstellen: `supabase functions deploy foto-mail --no-verify-jwt`

### Edge Function `schulkalender`
- Code: `supabase/functions/schulkalender/index.ts` – liefert Ferien und Feiertage des **laufenden bayerischen Schuljahrs** (1.8.–31.7.) für den Leo-Kalender
- Quelle: OpenHolidays API (openholidaysapi.org); die Funktion fragt dort an, damit die Browser der Mitglieder keine Verbindung zu einem fremden Dienst aufbauen
- Keine Secrets nötig, wechselt jedes Jahr am 1. August automatisch ins neue Schuljahr
- Bereitstellen: `supabase functions deploy schulkalender --no-verify-jwt`

### SQL-Skripte (im SQL Editor ausgeführt, in dieser Reihenfolge)

| Skript | Inhalt | Ausgeführt am |
|---|---|---|
| `anmeldungen.sql` | erste Anmelde-Tabelle (Altlast) | ☐ |
| `02_mindestalter.sql` | Mindestalter in `anmeldungen` (Altlast) | ☐ |
| `03_mitgliederbereich.sql` | Konten, Profile, Karte, Freischaltung | ☐ |
| `04_mitgliedsantrag.sql` | vollständiger Antrag inkl. SEPA | ☐ |
| `05_vorstand_und_benachrichtigung.sql` | Vorstand nur info@, Antrags-Mail | ☐ |
| `06_karte_und_veranstaltungen.sql` | Kartenpunkte von Hand, Veranstaltungen, Speicher | ☐ |
| `07_karriereschritte.sql` | Vorherige Karriereschritte im Profil und auf der Karte | ☐ |
| `08_jahresberichte.sql` | Jahresberichte (PDF pro Jahr) im Archiv, Speicher | ☐ |
| `09_fotoarchiv.sql` | Fotoarchiv nach Abiturjahrgängen, Freigabe, E-Mail an info@ | ☐ |
| `10_leo_kalender.sql` | Termine am Leopoldinum für den Leo-Kalender | ☐ |

Alle Skripte können gefahrlos erneut ausgeführt werden.

### Einstellungen nur im Dashboard (nicht im Code – bitte festhalten)
- ☐ Authentication → URL Configuration → **Site URL**: `https://netzwerk-leopoldinum.de/` (prüfen)
- ☐ Authentication → URL Configuration → **Redirect URLs**: mindestens `https://netzwerk-leopoldinum.de/mitglieder.html` (+ ggf. `http://127.0.0.1:5500/…` zum Testen)
- ☐ Authentication → **SMTP**: eigener Server `smtp.ionos.de`, Port 465, Benutzer info@…, Absendername: ☐
- ☐ Authentication → **E-Mail-Vorlagen** angepasst? (Bestätigung, Einladung, Passwort) – ja/nein: ☐
- ☐ Authentication → E-Mail-Bestätigung erforderlich: an/aus ☐

---

## 5. Hosting und Veröffentlichen (IONOS Deploy Now)

- **Domain:** netzwerk-leopoldinum.de (bei IONOS) · DNS-Einträge: ☐ (Screenshot aus IONOS ablegen)
- **Deploy-Now-Projekt-ID:** `82a52578-c60a-4082-a8ad-a9515a717d34`
- **Ablauf:** Jeder Push auf GitHub startet „Deploy Now: Orchestration“ → Build → Upload zu IONOS.
  Status: GitHub → Reiter **Actions**.
- **Wichtig:** Der Build kopiert nur eine feste Liste von Dateien
  (`.github/workflows/netzwerk-leopoldinum-website-build.yaml`, Zeile `cp -r …`).
  **Neue HTML-Seiten müssen dort ergänzt werden**, sonst fehlen sie online.
- Die beiden anderen Workflow-Dateien stammen von IONOS und sollen nicht bearbeitet werden.
- AVV mit IONOS: ☐

---

## 6. E-Mail

- Postfach **info@netzwerk-leopoldinum.de** bei IONOS
- Wird benutzt für: Kontakt auf der Webseite, Absender aller Login-E-Mails (über Supabase), Empfang neuer Anträge, **Vorstandslogin**
- Wer hat Zugriff auf das Postfach: ☐

---

## 7. Lokal arbeiten

```bash
npm install          # einmalig
npm run dev          # Vorschau auf http://127.0.0.1:5500
```

- Bearbeiten z. B. in VS Code; Änderungen mit `git commit` und `git push` veröffentlichen (geht automatisch online).
- `.env` (nicht im Repository) nach Vorlage `.env.example` anlegen – nur für das Einladungs-Skript nötig.
- **Bestandsmitglieder einladen:** `mitglieder.csv` nach Vorlage `mitglieder.example.csv` (`E-Mail;Vorname;Nachname`)
  anlegen, dann `npm run einladen`. Jede Person bekommt eine Einladungs-Mail und ist direkt freigeschaltet.
  `mitglieder.csv` wird nicht hochgeladen und sollte danach gelöscht werden.
- Eingebundene Bibliotheken liegen lokal in `assets/vendor/` (Supabase JS v2, Leaflet 1.9.4), Schriften in `assets/fonts/` – bewusst keine externen Server.

---

## 8. Abläufe für den Vorstand

Login unter **mitglieder.html** mit info@netzwerk-leopoldinum.de.

| Aufgabe | Wo |
|---|---|
| Neue Anträge prüfen, freischalten, sperren, Antragsdaten/SEPA ansehen | Reiter **Freischaltungen** |
| Person ohne Konto auf die Karte setzen (nur mit Einwilligung) | Reiter **Kartenpunkte** |
| Bericht/Ankündigung für „Aktuelles“ anlegen, bearbeiten, löschen | Reiter **Veranstaltungen** |
| Beiträge per SEPA einziehen | außerhalb der Webseite (Bank) – Daten aus „Details“ |
| **Mitglied endgültig löschen** (Austritt) | Supabase → Authentication → Users → Nutzer löschen (löscht automatisch Profil und Antragsdaten) |

„Aktuelles“ zeigt die drei neuesten Veranstaltungen mit Häkchen „Startseite“; alle bleiben im Archiv
(veranstaltungen.html). Fotos mit erkennbaren Personen nur mit Foto-Einwilligung hochladen.

---

## 9. Grundsatzentscheidungen (und warum)

- **Vorstandsrechte nur über das gemeinsame Konto info@** – einfach weiterzugeben, kein Rechte-Chaos bei Vorstandswechsel.
- **Jeder Antrag muss vom Vorstand freigeschaltet werden**, bevor die Mitgliederkarte sichtbar ist.
- **Mindestalter 16**; Mindestbeitrag 5 €/Jahr bis 30 Jahre, 25 €/Jahr ab 31 (Stand Mai 2025).
- **Online-SEPA-Mandat** wird in Supabase gespeichert – vom Verein bewusst so entschieden.
- **Mitgliederkarte**: nur Stadt (keine Adresse), nur mit Einwilligung, nur für freigeschaltete Mitglieder.
- **Hosting in Deutschland (IONOS)**, Datenbank in der EU; keine Google Fonts, keine CDNs, kein Tracking.

---

## 10. Datensicherung

☐ Regelmäßig (z. B. monatlich) exportieren: Supabase → Table Editor → Tabelle → Export als CSV –
`mitglieder`, `mitglieder_privat`, `karte_eintraege`, `veranstaltungen`.
Die Exporte enthalten IBANs → **nur verschlüsselt** speichern. Ablageort: ☐

Bilder/Videos der Veranstaltungen liegen im Storage-Bucket `veranstaltungen` (bei Bedarf dort herunterladen).

---

## 11. Vereins- und Datenschutzunterlagen (außerhalb des Codes)

- Netzwerk Leopoldinum e.V., c/o Gymnasium Leopoldinum, Michaeligasse 15, 94032 Passau
- Vereinsregister: Amtsgericht Passau, VR 201203
- Vertreten durch (Impressum): Benedikt Haas · Verantwortlich nach § 18 MStV: Felix Audebert
- Gläubiger-ID (SEPA): DE33ZZZ00002818680
- ☐ AVV Supabase · ☐ AVV IONOS – Ablageort: ☐
- ☐ Papier-Einwilligungen für von Hand eingetragene Kartenpunkte und Fotos – Ablageort: ☐
- Bei Änderungen an Impressum/Datenschutz: `impressum.html`, `datenschutz.html`

---

## 12. Offene Punkte

- ☐ **Vor dem offiziellen Start:** Suchmaschinen-Sperre entfernen – `<meta name="robots" …>` in allen HTML-Seiten
  (mit `TODO` markiert) und `Disallow: /` in `robots.txt`.
- ☐ Angebote auf `veranstaltungen.html` prüfen (mit `TODO` markiert).
- ☐ Tabelle `anmeldungen` (Altlast) prüfen und löschen.
- ☐ `assets/qr-mitglied.png` wird seit dem Entfernen von „Mitmachen“ nicht mehr benutzt – löschen oder wieder einbauen.
- ☐ Hinweis „Vorstandswahl 2027“ stand früher unter „Mitmachen“ – ggf. als Veranstaltung/Vorschau eintragen.
- ☐ Repository und Konten auf mehrere Personen bzw. den Verein übertragen (Abschnitt 2).
