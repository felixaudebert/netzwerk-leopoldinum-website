// Netzwerk Leopoldinum – Mitglied endgültig löschen (nur der Vorstand)
// Löscht das Login-Konto in Supabase Auth. Dadurch werden automatisch auch gelöscht:
// Profil (mitglieder), Antragsdaten inkl. Bankverbindung (mitglieder_privat), Karriereschritte.
// Hochgeladene Fotos im Fotoarchiv bleiben erhalten (ohne Verweis auf die Person).
//
// Aufruf aus dem Mitgliederbereich mit dem Login des Vorstands (JWT wird geprüft):
//   supabase functions deploy mitglied-loeschen
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const antwort = (status: number, daten: Record<string, unknown>) =>
  new Response(JSON.stringify(daten), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwort(405, { fehler: "Nur POST erlaubt." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";

  // 1. Wer fragt an? Nur das Vorstandskonto (info@) darf löschen.
  const alsAnfragender = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await alsAnfragender.auth.getUser();
  if (!user) return antwort(401, { fehler: "Nicht angemeldet." });
  const { data: istVorstand } = await alsAnfragender.rpc("ist_vorstand");
  if (istVorstand !== true) return antwort(403, { fehler: "Nur der Vorstand darf Mitglieder löschen." });

  // 2. Wen löschen?
  let id = "";
  try {
    id = String((await req.json()).id ?? "");
  } catch {
    return antwort(400, { fehler: "Ungültige Anfrage." });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return antwort(400, { fehler: "Ungültige Mitglieds-ID." });
  if (id === user.id) return antwort(400, { fehler: "Das Vorstandskonto kann sich nicht selbst löschen." });

  // 3. Konto löschen (mit dem Administrator-Schlüssel, der nie den Server verlässt)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ziel } = await admin.auth.admin.getUserById(id);
  if (ziel?.user?.email?.toLowerCase() === "info@netzwerk-leopoldinum.de") {
    return antwort(400, { fehler: "Das Vereinskonto info@ kann nicht gelöscht werden." });
  }
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error && error.status !== 404) {   // 404 = Login-Konto gab es schon nicht mehr
    console.error(error);
    return antwort(500, { fehler: "Das Konto konnte nicht gelöscht werden." });
  }
  // Falls kein Login-Konto (mehr) existierte, aber noch ein Profil: sicherheitshalber entfernen
  await admin.from("mitglieder").delete().eq("id", id);

  return antwort(200, { ok: true });
});
