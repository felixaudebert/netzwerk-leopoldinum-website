// Netzwerk Leopoldinum – schickt jeden neuen Mitgliedsantrag an info@netzwerk-leopoldinum.de
// Wird von der Datenbank aufgerufen (Trigger "bei_neuem_antrag").
// Benötigte Secrets: ANTRAG_SECRET, SMTP_PASS (Passwort des Postfachs info@)

import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const INFO = "info@netzwerk-leopoldinum.de";

const ROLLEN: Record<string, string> = {
  ehemalige: "Ehemalige/r",
  schueler: "Schüler/in",
  eltern: "Elternteil",
  lehrkraft: "Lehrkraft",
  sonstiges: "Sonstiges",
};

const datum = (d: string) => new Date(d).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
const zeit = (d: string) => new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

Deno.serve(async (req) => {
  if (req.headers.get("x-antrag-secret") !== Deno.env.get("ANTRAG_SECRET")) {
    return new Response("Nicht erlaubt", { status: 403 });
  }
  const { id } = await req.json();

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: m, error: e1 } = await sb.from("mitglieder").select("*").eq("id", id).single();
  const { data: p, error: e2 } = await sb.from("mitglieder_privat").select("*").eq("id", id).single();
  if (e1 || e2) {
    console.error(e1 ?? e2);
    return new Response("Antrag nicht gefunden", { status: 404 });
  }

  const name = [m.vorname, m.nachname].filter(Boolean).join(" ");
  const text = `Neuer Mitgliedsantrag über die Webseite
========================================

Eingegangen am: ${zeit(m.created_at)}

PERSÖNLICHE ANGABEN
Name:               ${name}
Geburtsdatum:       ${datum(p.geburtsdatum)}
Adresse:            ${p.strasse}, ${p.plz} ${p.ort}
E-Mail:             ${m.email}
Ich bin:            ${ROLLEN[m.rolle] ?? "–"}
Abschlussjahrgang:  ${m.jahrgang ?? "–"}
Beschäftigung:      ${m.taetigkeit ?? "–"}

SEPA-LASTSCHRIFTMANDAT (online erteilt am ${zeit(p.sepa_mandat_am)})
Jahresbeitrag:      ${Number(p.beitrag_euro).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
Kontoinhaber:       ${p.kontoinhaber}
Anschrift:          ${p.kontoinhaber_anschrift}
Kreditinstitut:     ${p.kreditinstitut}
BIC:                ${p.bic ?? "–"}
IBAN:               ${p.iban.replace(/(.{4})/g, "$1 ").trim()}

EINWILLIGUNGEN
Vereinsverwaltung und E-Mail-Informationen: ${m.einwilligung ? "Ja" : "Nein"}
Fotos und Videos:                           ${p.foto_einwilligung ? "Ja" : "Nein"}

NACHRICHT
${m.nachricht ?? "–"}

----------------------------------------
Freischalten: Mitgliederbereich → Login mit ${INFO} → „Freischaltungen“.
Antworten auf diese E-Mail gehen direkt an das neue Mitglied.
`;

  const transport = nodemailer.createTransport({
    host: "smtp.ionos.de",
    port: 465,
    secure: true,
    auth: { user: INFO, pass: Deno.env.get("SMTP_PASS") },
  });
  await transport.sendMail({
    from: `Netzwerk Leopoldinum Webseite <${INFO}>`,
    to: INFO,
    replyTo: m.email,
    subject: `Neuer Mitgliedsantrag: ${name}`,
    text,
  });

  return new Response("ok");
});
