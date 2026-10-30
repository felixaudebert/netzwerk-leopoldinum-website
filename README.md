# Netzwerk Leopoldinum – Landing Page

Statische Webseite (HTML, CSS, etwas JavaScript), ohne Build-Schritt.

## Aufbau

```
index.html        Inhalt der Seite (alle Abschnitte)
css/styles.css    Gestaltung – Farben und Schriften oben in :root
js/main.js        Mobiles Menü, Einblend-Animation, aktiver Menüpunkt
assets/           Logo, Portal-Zeichnung, Vorstandsfotos, QR-Code
```

## In VS Code bearbeiten

1. Ordner `netzwerk-leopoldinum-website` in VS Code öffnen.
2. Erweiterung **Live Server** installieren, dann `index.html` mit Rechtsklick → „Open with Live Server“ öffnen.
   Jede Änderung ist sofort im Browser sichtbar.

## Noch offen (in `index.html` mit `TODO` markiert)

- Kontakt-E-Mail-Adresse (derzeit Platzhalter `kontakt@netzwerk-leopoldinum.de`)
- Impressum und Datenschutz verlinken (für eine öffentliche Seite Pflicht)
- Angebote „Alumni-Treffen“, „Mentoring“, „Vorträge & Einblicke“ prüfen

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
| Blau    | `#495e85` | Abschnitt Angebote, Namen  |
| Dunkel  | `#484540` | Text, Abschnitt Mitmachen  |
| Weiß    | `#ffffff` | Hintergrund                |

Schriften: League Spartan (Überschriften) und Didact Gothic (Text), über Google Fonts.

## Veröffentlichen

Der Ordner kann wie der Tagesplan direkt auf GitHub Pages hochgeladen werden
(`index.html` muss im Hauptverzeichnis des Repositorys liegen).
