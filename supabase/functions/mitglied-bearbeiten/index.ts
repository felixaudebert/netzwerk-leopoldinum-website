// Netzwerk Leopoldinum – Angaben eines Mitglieds bearbeiten (nur der Vorstand)
// Ändert Profil (mitglieder) und Antragsdaten (mitglieder_privat), bei geänderter E-Mail auch die
// Login-Adresse, und setzt auf Wunsch den „Vorstandszugang“ (Admin-Rechte im Mitgliederbereich).
//
// Bereitstellen MIT Login-Prüfung: supabase functions deploy mitglied-bearbeiten
// Automatisch vorhanden: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const INFO = "info@netzwerk-leopoldinum.de";
const ROLLEN = ["ehemalige", "schueler", "eltern", "lehrkraft", "sonstiges"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwort = (status: number, daten: Record<string, unknown>) =>
  new Response(JSON.stringify(daten), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Eingabefehler extends Error {}

// ---------- Prüfen und Aufbereiten der Eingaben ----------
const text = (v: unknown, max: number, name: string, pflicht = false) => {
  const s = v == null ? "" : String(v).trim();
  if (!s) {
    if (pflicht) throw new Eingabefehler(`${name} darf nicht leer sein.`);
    return null;
  }
  if (s.length > max) throw new Eingabefehler(`${name} ist zu lang (höchstens ${max} Zeichen).`);
  return s;
};
const datum = (v: unknown, name: string) => {
  const s = text(v, 10, name);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + "T12:00:00Z"))) throw new Eingabefehler(`${name} ist kein gültiges Datum.`);
  return s;
};
const jaNein = (v: unknown) => v === true || v === "true" || v === "on";

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
  if (istVorstand !== true) return antwort(403, { fehler: "Nur der Vorstand darf Mitglieder bearbeiten." });

  let id = "", d: Record<string, unknown> = {};
  try {
    const body = await req.json();
    id = String(body.id ?? "");
    d = body.daten ?? {};
  } catch {
    return antwort(400, { fehler: "Ungültige Anfrage." });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return antwort(400, { fehler: "Ungültige Mitglieds-ID." });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: alt } = await admin.from("mitglieder").select("id, email, freigeschaltet, vorstandszugang").eq("id", id).maybeSingle();
  if (!alt) return antwort(404, { fehler: "Mitglied nicht gefunden." });
  if (alt.email?.toLowerCase() === INFO) return antwort(400, { fehler: "Das Vereinskonto info@ kann hier nicht bearbeitet werden." });

  try {
    // Profil
    const email = text(d.email, 200, "E-Mail", true)!.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Eingabefehler("Die E-Mail-Adresse ist ungültig.");
    const rolle = text(d.rolle, 20, "Rolle");
    if (rolle && !ROLLEN.includes(rolle)) throw new Eingabefehler("Unbekannte Rolle.");
    const jahrgangText = text(d.jahrgang, 4, "Abiturjahrgang");
    const jahrgang = jahrgangText ? Number(jahrgangText) : null;
    if (jahrgang !== null && !(Number.isInteger(jahrgang) && jahrgang >= 1900 && jahrgang <= 2100)) throw new Eingabefehler("Der Abiturjahrgang ist ungültig.");
    const freigeschaltet = jaNein(d.freigeschaltet);
    const vorstandszugang = jaNein(d.vorstandszugang);
    if (id === user.id && alt.vorstandszugang && !vorstandszugang) {
      throw new Eingabefehler("Du kannst dir den Vorstandszugang nicht selbst entziehen.");
    }
    const profil = {
      vorname: text(d.vorname, 100, "Vorname", true),
      nachname: text(d.nachname, 100, "Nachname", true),
      email,
      telefon: text(d.telefon, 40, "Telefon"),
      rolle,
      jahrgang,
      taetigkeit: text(d.taetigkeit, 200, "Beschäftigung"),
      mitglied_seit: datum(d.mitglied_seit, "Mitglied seit"),
      einwilligung: jaNein(d.einwilligung),
      freigeschaltet,
      freigeschaltet_am: freigeschaltet ? (alt.freigeschaltet ? undefined : new Date().toISOString()) : null,
      vorstandszugang,
    };

    // Antragsdaten
    const ibanText = text(d.iban, 40, "IBAN");
    const iban = ibanText ? ibanText.replace(/\s/g, "").toUpperCase() : null;
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new Eingabefehler("Die IBAN ist ungültig.");
    const bicText = text(d.bic, 11, "BIC");
    const bic = bicText ? bicText.replace(/\s/g, "").toUpperCase() : null;
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new Eingabefehler("Die BIC ist ungültig.");
    const beitragText = text(d.beitrag_euro, 10, "Jahresbeitrag");
    const beitrag = beitragText ? Number(beitragText.replace(",", ".")) : null;
    if (beitrag !== null && !(beitrag >= 5 && beitrag < 100000)) throw new Eingabefehler("Der Jahresbeitrag muss mindestens 5 € betragen.");
    const plz = text(d.plz, 12, "PLZ");
    if (plz && plz.length < 3) throw new Eingabefehler("Die PLZ ist zu kurz.");
    const privat = {
      id,
      geburtsdatum: datum(d.geburtsdatum, "Geburtsdatum"),
      strasse: text(d.strasse, 200, "Straße"),
      plz,
      ort: text(d.ort, 100, "Ort"),
      foto_einwilligung: jaNein(d.foto_einwilligung),
      beitrag_euro: beitrag,
      kontoinhaber: text(d.kontoinhaber, 140, "Kontoinhaber"),
      kontoinhaber_anschrift: text(d.kontoinhaber_anschrift, 300, "Anschrift des Kontoinhabers"),
      kreditinstitut: text(d.kreditinstitut, 140, "Kreditinstitut"),
      iban,
      bic,
    };
    const { data: hatPrivat } = await admin.from("mitglieder_privat").select("id").eq("id", id).maybeSingle();
    const privatAngegeben = [privat.geburtsdatum, privat.strasse, privat.plz, privat.ort, iban, beitrag].some((v) => v != null);
    const privatVollstaendig = privat.geburtsdatum && privat.strasse && privat.plz && privat.ort;
    if ((hatPrivat || privatAngegeben) && !privatVollstaendig) {
      throw new Eingabefehler("Bitte Geburtsdatum, Straße, PLZ und Ort vollständig angeben.");
    }

    // 1. Login-Adresse ändern, falls nötig
    if (email !== alt.email?.toLowerCase()) {
      const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
      if (error) {
        throw new Eingabefehler(error.message?.toLowerCase().includes("already")
          ? "Diese E-Mail-Adresse wird schon von einem anderen Konto benutzt."
          : "Die E-Mail-Adresse konnte nicht geändert werden.");
      }
    }
    // 2. Profil
    const { error: e1 } = await admin.from("mitglieder").update(profil).eq("id", id);
    if (e1) {
      console.error(e1);
      throw new Error("Profil");
    }
    // 3. Antragsdaten
    if (hatPrivat || privatVollstaendig) {
      const { error: e2 } = await admin.from("mitglieder_privat").upsert(privat);
      if (e2) {
        console.error(e2);
        throw new Error("Antragsdaten");
      }
    }
  } catch (fehler) {
    if (fehler instanceof Eingabefehler) return antwort(400, { fehler: fehler.message });
    return antwort(500, { fehler: "Speichern hat nicht geklappt. Bitte versuche es noch einmal." });
  }

  const { data: neu } = await admin.from("mitglieder").select("*, mitglieder_privat(*)").eq("id", id).single();
  return antwort(200, { ok: true, mitglied: neu });
});
