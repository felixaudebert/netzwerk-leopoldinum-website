// Netzwerk Leopoldinum – Bestandsmitglieder still übernehmen (ohne E-Mail, ohne Website-Zugang)
// Liest bestandsmitglieder.csv (Semikolon, Kopfzeile:
//   nr;vorname;nachname;strasse;hausnr;plz;ort;tag;monat;jahr;email;mitglied_seit)
// und legt für jede Zeile ein Konto OHNE Passwort an. Es wird keine E-Mail verschickt.
// Den Zugang schaltet der Vorstand später einzeln in der Mitgliederliste frei.
//
// Probelauf (prüft nur, schreibt nichts):  node --env-file=.env scripts/bestand-importieren.mjs --probe
// Import:                                   node --env-file=.env scripts/bestand-importieren.mjs
// Bereits vorhandene E-Mail-Adressen werden übersprungen – das Skript kann gefahrlos erneut laufen.

import { readFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const PROBE = process.argv.includes("--probe");
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Bitte SUPABASE_URL und SUPABASE_SECRET_KEY in .env eintragen.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: "Bearer " + SUPABASE_SECRET_KEY,
  "Content-Type": "application/json",
};

const [kopf, ...zeilen] = readFileSync("bestandsmitglieder.csv", "utf8").split(/\r?\n/).filter((z) => z.trim());
const spalten = kopf.split(";");
const mitglieder = zeilen.map((z) => Object.fromEntries(z.split(";").map((w, i) => [spalten[i], w.trim()])));

const zweistellig = (n) => String(n).padStart(2, "0");
const datum = (j, m, t) => {
  const iso = `${j}-${zweistellig(m)}-${zweistellig(t)}`;
  const d = new Date(iso + "T12:00:00Z");
  return d.getUTCFullYear() === Number(j) && d.getUTCMonth() + 1 === Number(m) && d.getUTCDate() === Number(t) ? iso : null;
};
const seit = (s) => {
  const [t, m, j] = s.split(".");
  return datum(Number(j) < 100 ? 2000 + Number(j) : j, m, t);
};

// ---------- Prüfen ----------
let fehler = 0;
const emails = new Set();
for (const m of mitglieder) {
  const probleme = [];
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(m.email)) probleme.push(`E-Mail „${m.email}“`);
  if (emails.has(m.email.toLowerCase())) probleme.push("E-Mail doppelt");
  emails.add(m.email.toLowerCase());
  m.geburtsdatum = datum(m.jahr, m.monat, m.tag);
  if (!m.geburtsdatum) probleme.push("Geburtsdatum");
  m.seit = seit(m.mitglied_seit);
  if (!m.seit) probleme.push("Mitglied seit");
  if (!m.vorname || !m.nachname || !m.strasse || !m.plz || !m.ort) probleme.push("Pflichtangabe fehlt");
  if (probleme.length) {
    fehler++;
    console.log(`✗ Nr. ${m.nr} ${m.vorname} ${m.nachname}: ${probleme.join(", ")}`);
  }
}
console.log(`Geprüft: ${mitglieder.length} Mitglieder, ${fehler} mit Auffälligkeiten.`);
if (PROBE) process.exit(0);

// ---------- Importieren ----------
let neu = 0, uebersprungen = 0, fehlgeschlagen = 0;
for (const m of mitglieder) {
  const name = `${m.vorname} ${m.nachname}`;
  // 1. Konto ohne Passwort anlegen (verschickt KEINE E-Mail)
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: m.email, email_confirm: true, user_metadata: { vorname: m.vorname, nachname: m.nachname } }),
  });
  const konto = await res.json();
  if (!res.ok) {
    const meldung = konto.msg || konto.message || konto.error_description || res.status;
    if (String(meldung).toLowerCase().includes("already")) {
      uebersprungen++;
      console.log(`– Nr. ${m.nr} ${name}: E-Mail gibt es schon, übersprungen`);
    } else {
      fehlgeschlagen++;
      console.log(`✗ Nr. ${m.nr} ${name}: ${meldung}`);
    }
    continue;
  }

  // 2. Mitgliedseintrag ergänzen (der Datenbank-Trigger hat ihn mit Name und E-Mail angelegt)
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/mitglieder?id=eq.${konto.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      freigeschaltet: true,
      freigeschaltet_am: new Date().toISOString(),
      mitglied_seit: m.seit,
      zugang_offen: true,
    }),
  });

  // 3. Anschrift und Geburtsdatum (ohne Bankdaten – die liegen beim Verein)
  const r3 = await fetch(`${SUPABASE_URL}/rest/v1/mitglieder_privat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: konto.id,
      geburtsdatum: m.geburtsdatum,
      strasse: `${m.strasse} ${m.hausnr}`.trim(),
      plz: m.plz,
      ort: m.ort,
      foto_einwilligung: false,
      sepa_mandat_am: null,
    }),
  });

  if (r2.ok && r3.ok) {
    neu++;
    console.log(`✓ Nr. ${m.nr} ${name}`);
  } else {
    fehlgeschlagen++;
    console.log(`! Nr. ${m.nr} ${name}: Konto angelegt, aber Daten unvollständig (${r2.status}/${r3.status} ${await r3.text()})`);
  }
}
console.log(`\nFertig: ${neu} angelegt, ${uebersprungen} übersprungen, ${fehlgeschlagen} mit Fehler. Es wurden keine E-Mails verschickt.`);
