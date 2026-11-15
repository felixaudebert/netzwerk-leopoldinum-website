// Netzwerk Leopoldinum – Einladungslink einlösen und eigenes Passwort festlegen
// Aufruf von mitglieder.html?zugang=<token> (ohne Login, der Link selbst ist der Nachweis).
//   { token }            → prüft den Link, antwortet mit Vorname und E-Mail
//   { token, passwort }  → setzt das Passwort, macht den Link ungültig, antwortet mit der E-Mail
//
// Bereitstellen OHNE Login-Prüfung: supabase functions deploy zugang-aktivieren --no-verify-jwt
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwort = (status: number, daten: Record<string, unknown>) =>
  new Response(JSON.stringify(daten), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sha256 = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort(405, { fehler: "Nur POST erlaubt." });

  let token = "", passwort: string | undefined;
  try {
    const daten = await req.json();
    token = String(daten.token ?? "");
    passwort = daten.passwort == null ? undefined : String(daten.passwort);
  } catch {
    return antwort(400, { fehler: "Ungültige Anfrage." });
  }
  if (!/^[0-9a-f]{64}$/.test(token)) return antwort(400, { fehler: "Dieser Link ist ungültig." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: einladung } = await admin
    .from("zugang_einladungen")
    .select("mitglied_id, gueltig_bis, eingeloest_am, mitglieder(email, vorname)")
    .eq("token_hash", await sha256(token))
    .maybeSingle();

  if (!einladung) return antwort(404, { fehler: "Dieser Link ist ungültig oder wurde durch eine neuere Einladung ersetzt." });
  if (einladung.eingeloest_am) return antwort(410, { fehler: "Dieser Link wurde bereits benutzt. Melde dich einfach mit deinem Passwort an." });
  if (new Date(einladung.gueltig_bis) < new Date()) {
    return antwort(410, { fehler: "Dieser Link ist abgelaufen. Bitte melde dich bei info@netzwerk-leopoldinum.de, dann schicken wir dir einen neuen." });
  }
  const m = Array.isArray(einladung.mitglieder) ? einladung.mitglieder[0] : einladung.mitglieder;
  if (!m) return antwort(404, { fehler: "Dieses Mitglied gibt es nicht mehr." });

  // Nur prüfen
  if (passwort === undefined) return antwort(200, { ok: true, vorname: m.vorname, email: m.email });

  if (passwort.length < 8) return antwort(400, { fehler: "Das Passwort muss mindestens 8 Zeichen lang sein." });
  const { error } = await admin.auth.admin.updateUserById(einladung.mitglied_id, { password: passwort, email_confirm: true });
  if (error) {
    console.error(error);
    return antwort(400, { fehler: error.message?.includes("weak") ? "Dieses Passwort ist zu schwach. Bitte wähle ein anderes." : "Das Passwort konnte nicht gespeichert werden." });
  }
  const jetzt = new Date().toISOString();
  await admin.from("zugang_einladungen").update({ eingeloest_am: jetzt }).eq("mitglied_id", einladung.mitglied_id);
  await admin.from("mitglieder").update({ zugang_offen: false, zugang_aktiviert_am: jetzt }).eq("id", einladung.mitglied_id);

  return antwort(200, { ok: true, email: m.email });
});
