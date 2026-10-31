// Netzwerk Leopoldinum – bestehende Mitglieder einladen
// Liest mitglieder.csv (E-Mail;Vorname;Nachname), schickt jedem eine Einladungs-E-Mail
// und schaltet die Konten direkt frei. Aufruf: npm run einladen

import { readFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SITE_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || SUPABASE_SECRET_KEY.startsWith("sb_secret_DEIN")) {
  console.error("Bitte zuerst SUPABASE_URL und SUPABASE_SECRET_KEY in der Datei .env eintragen.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SECRET_KEY,
  Authorization: "Bearer " + SUPABASE_SECRET_KEY,
  "Content-Type": "application/json",
};

const zeilen = readFileSync("mitglieder.csv", "utf8")
  .split(/\r?\n/)
  .map((z) => z.trim())
  .filter((z) => z && !z.toLowerCase().startsWith("email"));

const redirect = new URL("mitglieder.html", SITE_URL || "http://127.0.0.1:5500/").href;
let ok = 0;

for (const zeile of zeilen) {
  const [email, vorname = "", nachname = ""] = zeile.split(/[;,]/).map((s) => s.trim());
  const res = await fetch(`${SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirect)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, data: { vorname, nachname } }),
  });
  const antwort = await res.json();
  if (!res.ok) {
    console.log(`✗ ${email}: ${antwort.msg || antwort.message || res.status}`);
    continue;
  }
  const frei = await fetch(`${SUPABASE_URL}/rest/v1/mitglieder?id=eq.${antwort.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ freigeschaltet: true, freigeschaltet_am: new Date().toISOString() }),
  });
  console.log(frei.ok ? `✓ ${email} eingeladen und freigeschaltet` : `! ${email} eingeladen, aber Freischaltung fehlgeschlagen`);
  ok++;
}

console.log(`\nFertig: ${ok} von ${zeilen.length} Einladungen verschickt.`);
