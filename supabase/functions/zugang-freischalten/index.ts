// Netzwerk Leopoldinum – Website-Zugang für ein (Bestands-)Mitglied freischalten (nur der Vorstand)
// Erstellt einen persönlichen Einladungslink (30 Tage gültig) und schickt ihn per E-Mail an das Mitglied.
// Über den Link legt das Mitglied sein Passwort fest (Edge Function "zugang-aktivieren").
//
// Bereitstellen MIT Login-Prüfung: supabase functions deploy zugang-freischalten
// Secrets: SMTP_PASS (wie antrag-mail); automatisch vorhanden: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const INFO = "info@netzwerk-leopoldinum.de";
const SEITE = "https://netzwerk-leopoldinum.de";
const GUELTIG_TAGE = 30;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwort = (status: number, daten: Record<string, unknown>) =>
  new Response(JSON.stringify(daten), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort(405, { fehler: "Nur POST erlaubt." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const alsAnfragender = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await alsAnfragender.auth.getUser();
  if (!user) return antwort(401, { fehler: "Nicht angemeldet." });
  const { data: istVorstand } = await alsAnfragender.rpc("ist_vorstand");
  if (istVorstand !== true) return antwort(403, { fehler: "Nur der Vorstand darf Zugänge freischalten." });

  let id = "";
  try {
    id = String((await req.json()).id ?? "");
  } catch {
    return antwort(400, { fehler: "Ungültige Anfrage." });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return antwort(400, { fehler: "Ungültige Mitglieds-ID." });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: m, error: e1 } = await admin
    .from("mitglieder").select("id, email, vorname, zugang_offen").eq("id", id).single();
  if (e1 || !m) return antwort(404, { fehler: "Mitglied nicht gefunden." });
  if (!m.zugang_offen) return antwort(400, { fehler: "Dieses Mitglied hat bereits einen Website-Zugang." });

  // Persönlicher Link: nur der Hash wird gespeichert; eine neue Einladung macht die alte ungültig
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const gueltigBis = new Date(Date.now() + GUELTIG_TAGE * 24 * 60 * 60 * 1000);
  const { error: e2 } = await admin.from("zugang_einladungen").upsert({
    mitglied_id: id,
    token_hash: await sha256(token),
    erstellt_am: new Date().toISOString(),
    gueltig_bis: gueltigBis.toISOString(),
    eingeloest_am: null,
  });
  if (e2) {
    console.error(e2);
    return antwort(500, { fehler: "Die Einladung konnte nicht erstellt werden." });
  }

  const link = `${SEITE}/mitglieder.html?zugang=${token}`;
  const bis = gueltigBis.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const text = `Hallo ${m.vorname || ""},

ab sofort steht dir der Mitgliederbereich auf der Webseite des Netzwerk Leopoldinum offen –
mit der Mitgliederkarte, dem Leo-Kalender, dem Fotoarchiv und den Jahresberichten.

Lege über diesen persönlichen Link dein eigenes Passwort fest:
${link}

Der Link ist bis zum ${bis} gültig. Danach meldest du dich jederzeit unter
${SEITE}/mitglieder.html mit deiner E-Mail-Adresse (${m.email}) und deinem Passwort an.

Wenn du Fragen hast, antworte einfach auf diese E-Mail.

Viele Grüße
der Vorstand des Netzwerk Leopoldinum e.V.
`;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.ionos.de",
      port: 465,
      secure: true,
      auth: { user: INFO, pass: Deno.env.get("SMTP_PASS") },
    });
    await transport.sendMail({
      from: `Netzwerk Leopoldinum <${INFO}>`,
      to: m.email,
      replyTo: INFO,
      subject: "Dein Zugang zum Mitgliederbereich des Netzwerk Leopoldinum",
      text,
    });
  } catch (fehler) {
    console.error(fehler);
    // Grund vom Mailserver mitgeben (ohne Zugangsdaten), damit sich Fehler eingrenzen lassen
    const f = fehler as { code?: string; responseCode?: number; command?: string; message?: string };
    const grund = [f.code, f.responseCode, f.command, (f.message || "").slice(0, 160)].filter(Boolean).join(" · ");
    return antwort(502, { fehler: `Die E-Mail konnte nicht verschickt werden (${grund || "unbekannter Fehler"}).` });
  }

  await admin.from("mitglieder").update({ zugang_eingeladen_am: new Date().toISOString() }).eq("id", id);
  return antwort(200, { ok: true, gueltig_bis: gueltigBis.toISOString() });
});
