// Netzwerk Leopoldinum – schickt jeden neuen Mitgliedsantrag an info@netzwerk-leopoldinum.de
// (Mailtext + druckfertiges PDF im Anhang, siehe pdf.ts)
// Wird von der Datenbank aufgerufen (Trigger "bei_neuem_antrag").
// Benötigte Secrets: ANTRAG_SECRET, SMTP_PASS (Passwort des Postfachs info@)

import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Abschnitt, antragPdf } from "./pdf.ts";

const INFO = "info@netzwerk-leopoldinum.de";
const LOGO = "https://netzwerk-leopoldinum.de/assets/logo.png";

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
  const euro = (n: number) => `${Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;

  // Alle Angaben einmal zusammengestellt – daraus entstehen Mailtext und PDF
  const abschnitte: Abschnitt[] = [
    { titel: "Persönliche Angaben", zeilen: [
      ["Name", name],
      ["Geburtsdatum", datum(p.geburtsdatum)],
      ["Adresse", `${p.strasse}, ${p.plz} ${p.ort}`],
      ["E-Mail", m.email],
      ["Ich bin", ROLLEN[m.rolle] ?? "–"],
      ["Abschlussjahrgang", m.jahrgang ? String(m.jahrgang) : "–"],
      ["Beschäftigung", m.taetigkeit ?? "–"],
    ] },
    { titel: `SEPA-Lastschriftmandat (online erteilt am ${zeit(p.sepa_mandat_am)})`, zeilen: [
      ["Jahresbeitrag", euro(p.beitrag_euro)],
      ["Kontoinhaber", p.kontoinhaber],
      ["Anschrift", p.kontoinhaber_anschrift],
      ["Kreditinstitut", p.kreditinstitut],
      ["BIC", p.bic ?? "–"],
      ["IBAN", p.iban.replace(/(.{4})/g, "$1 ").trim()],
    ] },
    { titel: "Einwilligungen", zeilen: [
      ["Vereinsverwaltung und E-Mail-Informationen", m.einwilligung ? "Ja" : "Nein"],
      ["Fotos und Videos", p.foto_einwilligung ? "Ja" : "Nein"],
    ] },
    { titel: "Nachricht", zeilen: [["Nachricht an den Vorstand", m.nachricht ?? "–"]] },
  ];

  const text = `Neuer Mitgliedsantrag über die Webseite
========================================

Eingegangen am: ${zeit(m.created_at)}
${abschnitte.map((a) => `
${a.titel.toUpperCase()}
${a.zeilen.map(([l, w]) => (a.titel === "Nachricht" ? w : `${(l + ":").padEnd(19)} ${w}`)).join("\n")}
`).join("")}
----------------------------------------
Zum Ausdrucken liegt der Antrag als PDF im Anhang.
Freischalten: Mitgliederbereich → Login mit ${INFO} → „Freischaltungen“.
Antworten auf diese E-Mail gehen direkt an das neue Mitglied.
`;

  // PDF zum Ausdrucken (klappt das nicht, geht die Mail trotzdem raus)
  const anhaenge: { filename: string; content: Uint8Array; contentType: string }[] = [];
  try {
    const logo = await fetch(LOGO, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null);
    const pdf = await antragPdf({
      titel: "Mitgliedsantrag",
      untertitel: `Netzwerk Leopoldinum e.V. · online eingegangen am ${zeit(m.created_at)}`,
      abschnitte,
      vermerke: ["Antrag geprüft (Datum, Kürzel)", "Freigeschaltet am", "Mandatsreferenz", "Erster Beitragseinzug am"],
      fusszeile: `Mitgliedsantrag ${name} · vertraulich, enthält Bankdaten`,
      logo,
    });
    const dateiName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    anhaenge.push({ filename: `Mitgliedsantrag-${dateiName || "neu"}.pdf`, content: pdf, contentType: "application/pdf" });
  } catch (fehler) {
    console.error("PDF konnte nicht erstellt werden:", fehler);
  }

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
    attachments: anhaenge,
  });

  return new Response("ok");
});
