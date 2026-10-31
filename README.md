# Netzwerk Leopoldinum – Landing Page

Statische Webseite (HTML, CSS, etwas JavaScript), ohne Build-Schritt.

**Neu im Projekt?** Zuerst [UEBERGABE.md](UEBERGABE.md) lesen – Zugänge, Dienste, Abläufe und offene Punkte.

## Aufbau

```
index.html                    Startseite (alle Abschnitte)
veranstaltungen.html          Angebote und alle Veranstaltungen nach Jahren
css/styles.css                Gestaltung – Farben und Schriften oben in :root
js/main.js                    Menü, Einblend-Animation, Portalhälften, Goldfaden
js/veranstaltungen-ansicht.js lädt Veranstaltungen aus Supabase für „Aktuelles“ und das Archiv
js/mitglieder.js              Mitgliederbereich inkl. Vorstand (Freischaltungen, Kartenpunkte, Veranstaltungen)
assets/           Logo, Portal-Zeichnung, Vorstandsfotos, QR-Code
```

## In VS Code bearbeiten

1. Ordner `netzwerk-leopoldinum-website` in VS Code öffnen.
2. Erweiterung **Live Server** installieren, dann `index.html` mit Rechtsklick → „Open with Live Server“ öffnen.
   Jede Änderung ist sofort im Browser sichtbar.

## Noch offen (in `index.html` mit `TODO` markiert)

- Kontakt-E-Mail-Adresse (derzeit Platzhalter `kontakt@netzwerk-leopoldinum.de`)
- Impressum und Datenschutz verlinken (für eine öffentliche Seite Pflicht)
- Angebote auf `veranstaltungen.html` prüfen

## Veranstaltungen und Kartenpunkte (Vorstand)

Im Mitgliederbereich (Login mit info@) gibt es dafür eigene Reiter:

- **Veranstaltungen:** neue Berichte/Ankündigungen mit Bild oder Video anlegen, bearbeiten, löschen.
  Unter „Aktuelles“ stehen die drei neuesten mit Häkchen „Startseite“; im Archiv bleiben alle.
- **Kartenpunkte:** Personen ohne eigenes Konto (z. B. Papierantrag) mit ihrer Einwilligung auf die Karte setzen.

Einmalig nötig: `supabase/06_karte_und_veranstaltungen.sql` im Supabase SQL Editor ausführen.

## Anmeldeformular (Supabase)

Das Formular im Abschnitt „Anmelden“ speichert Einträge in der Supabase-Tabelle `anmeldungen`.

- `supabase/anmeldungen.sql` – Tabelle + Zugriffsregeln, einmal im Supabase SQL Editor ausführen
- `js/config.js` – Projekt-URL und öffentlicher anon-Schlüssel
- `js/anmeldung.js` – sendet das Formular an Supabase

Der anon-Schlüssel ist öffentlich und darf im Code stehen; die Tabelle erlaubt Besuchern nur das
Anlegen neuer Einträge. Anmeldungen sieht man im Dashboard unter **Table Editor → anmeldungen**.

## Lokal starten

```
npm install
npm run dev
```

## Farben

| Name    | Wert      | Verwendung                 |
|---------|-----------|----------------------------|
| Gold    | `#c7aa62` | Linien, Akzente, Buttons   |
| Blau    | `#495e85` | Abschnitt Aktuelles, Namen |
| Dunkel  | `#484540` | Text, Abschnitt Mitmachen  |
| Weiß    | `#ffffff` | Hintergrund                |

Schriften: League Spartan (Überschriften) und Didact Gothic (Text), lokal in `assets/fonts/` (keine Verbindung zu Google).

## Veröffentlichen

Der Ordner kann wie der Tagesplan direkt auf GitHub Pages hochgeladen werden
(`index.html` muss im Hauptverzeichnis des Repositorys liegen).
