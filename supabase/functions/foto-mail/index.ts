// Netzwerk Leopoldinum – meldet neu hochgeladene Fotos (Fotoarchiv) an info@netzwerk-leopoldinum.de
// Wird von der Datenbank aufgerufen (Funktion "fotos_einreichen", eine E-Mail pro Hochladevorgang).
// Benötigte Secrets (dieselben wie bei "antrag-mail"): ANTRAG_SECRET, SMTP_PASS

import nodemailer from "npm:nodemailer@6.9.16";

const INFO = "info@netzwerk-leopoldinum.de";

const KATEGORIEN: Record<string, string> = {
  abiturfeier: "Abiturfeier",
  abiturfahrt: "Abiturfahrt",
  sonstiges: "Sonstiges",
};

Deno.serve(async (req) => {
  if (req.headers.get("x-antrag-secret") !== Deno.env.get("ANTRAG_SECRET")) {
    return new Response("Nicht erlaubt", { status: 403 });
  }
  const { name, email, jahrgang, kategorie, anzahl } = await req.json();

  const wer = name || email || "Ein Mitglied";
  const fotos = anzahl === 1 ? "1 neues Foto" : `${anzahl} neue Fotos`;
  const text = `Neue Fotos im Fotoarchiv warten auf Freigabe
============================================

Von:          ${wer}${email ? ` <${email}>` : ""}
Jahrgang:     Abitur ${jahrgang}
Kategorie:    ${KATEGORIEN[kategorie] ?? kategorie}
Anzahl:       ${fotos}
Eingegangen:  ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}

Die Fotos sind erst sichtbar, wenn der Vorstand sie freigibt.

----------------------------------------
Freigeben: Mitgliederbereich → Login mit ${INFO} → „Fotoarchiv“.
Antworten auf diese E-Mail gehen direkt an das Mitglied.
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
    ...(email ? { replyTo: email } : {}),
    subject: `Fotoarchiv: ${fotos} von ${wer} (Abitur ${jahrgang})`,
    text,
  });

  return new Response("ok");
});
