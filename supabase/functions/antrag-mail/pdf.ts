// Netzwerk Leopoldinum – Mitgliedsantrag als druckfertiges PDF (A4, eine Seite, bei Bedarf mehr)
// Wird von index.ts aufgerufen und als Anhang an die Mail an info@ gehängt.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

export type Abschnitt = { titel: string; zeilen: [string, string][] };
export type AntragDaten = {
  titel: string;
  untertitel: string;
  abschnitte: Abschnitt[];
  vermerke: string[];        // leere Felder zum handschriftlichen Ausfüllen durch den Vorstand
  fusszeile: string;
  logo?: Uint8Array | null;  // PNG
};

const BLAU = rgb(0.05, 0.2, 0.38);
const GOLD = rgb(0.72, 0.56, 0.24);
const GRAU = rgb(0.4, 0.4, 0.4);
const LINIE = rgb(0.82, 0.82, 0.82);

const A4 = [595.28, 841.89] as const;
const RAND = 56;
const LABEL_BREITE = 150;

export async function antragPdf(d: AntragDaten): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.titel);
  pdf.setAuthor("Netzwerk Leopoldinum e.V.");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Standardschrift kennt nur WinAnsi-Zeichen (inkl. Umlaute, ß, €) – alles andere (z. B. Emojis) weglassen
  const erlaubt = new Set(normal.getCharacterSet());
  const sauber = (s: string) =>
    [...String(s ?? "").replace(/\r/g, "").replace(/\t/g, " ")]
      .map((c) => (c === "\n" || erlaubt.has(c.codePointAt(0)!) ? c : ""))
      .join("");

  let seite: PDFPage = pdf.addPage([...A4]);
  let y = A4[1] - RAND;
  const breite = A4[0] - 2 * RAND;

  const neueSeite = () => {
    seite = pdf.addPage([...A4]);
    y = A4[1] - RAND;
  };
  const platz = (hoehe: number) => {
    if (y - hoehe < RAND) neueSeite();
  };

  // Zeilenumbruch nach Wortgrenzen (lange Wörter wie IBAN notfalls hart trennen)
  const umbrechen = (text: string, font: PDFFont, groesse: number, max: number) => {
    const zeilen: string[] = [];
    for (const absatz of sauber(text).split("\n")) {
      let zeile = "";
      for (const wort of absatz.split(/ +/)) {
        const versuch = zeile ? `${zeile} ${wort}` : wort;
        if (font.widthOfTextAtSize(versuch, groesse) <= max) {
          zeile = versuch;
          continue;
        }
        if (zeile) zeilen.push(zeile);
        zeile = wort;
        while (font.widthOfTextAtSize(zeile, groesse) > max) {
          let n = zeile.length;
          while (n > 1 && font.widthOfTextAtSize(zeile.slice(0, n), groesse) > max) n--;
          zeilen.push(zeile.slice(0, n));
          zeile = zeile.slice(n);
        }
      }
      zeilen.push(zeile);
    }
    return zeilen;
  };

  // ---------- Kopf ----------
  let textLinks = RAND;
  if (d.logo) {
    try {
      const bild = await pdf.embedPng(d.logo);
      const h = 44;
      const w = (bild.width / bild.height) * h;
      seite.drawImage(bild, { x: A4[0] - RAND - w, y: y - h + 6, width: w, height: h });
    } catch (e) {
      console.error("Logo nicht eingebunden:", e);
    }
  }
  seite.drawText(sauber(d.titel), { x: textLinks, y: y - 14, size: 18, font: fett, color: BLAU });
  seite.drawText(sauber(d.untertitel), { x: textLinks, y: y - 32, size: 10, font: normal, color: GRAU });
  y -= 50;
  seite.drawRectangle({ x: RAND, y, width: breite, height: 2, color: GOLD });
  y -= 22;

  // ---------- Abschnitte ----------
  const groesse = 10;
  const zeilenHoehe = 14;
  for (const a of d.abschnitte) {
    platz(40);
    seite.drawText(sauber(a.titel).toUpperCase(), { x: RAND, y, size: 10.5, font: fett, color: BLAU });
    y -= 6;
    seite.drawLine({ start: { x: RAND, y }, end: { x: RAND + breite, y }, thickness: 0.6, color: LINIE });
    y -= 15;
    for (const [label, wert] of a.zeilen) {
      const zeilen = umbrechen(wert || "–", normal, groesse, breite - LABEL_BREITE);
      const labelZeilen = umbrechen(label, fett, 9, LABEL_BREITE - 10);
      const n = Math.max(zeilen.length, labelZeilen.length);
      platz(n * zeilenHoehe);
      labelZeilen.forEach((z, i) =>
        seite.drawText(z, { x: RAND, y: y - i * zeilenHoehe, size: 9, font: fett, color: GRAU }));
      zeilen.forEach((z, i) =>
        seite.drawText(z, { x: RAND + LABEL_BREITE, y: y - i * zeilenHoehe, size: groesse, font: normal }));
      y -= n * zeilenHoehe + 3;
    }
    y -= 12;
  }

  // ---------- Vermerke des Vorstands (zum Ausfüllen von Hand) ----------
  if (d.vermerke.length) {
    platz(28 + d.vermerke.length * 24);
    seite.drawText("VERMERKE DES VORSTANDS", { x: RAND, y, size: 10.5, font: fett, color: BLAU });
    y -= 6;
    seite.drawLine({ start: { x: RAND, y }, end: { x: RAND + breite, y }, thickness: 0.6, color: LINIE });
    y -= 20;
    for (const v of d.vermerke) {
      seite.drawText(sauber(v), { x: RAND, y, size: 9, font: fett, color: GRAU });
      seite.drawLine({
        start: { x: RAND + LABEL_BREITE, y: y - 2 }, end: { x: RAND + breite, y: y - 2 }, thickness: 0.6, color: GRAU,
      });
      y -= 24;
    }
  }

  // ---------- Fußzeile auf jeder Seite ----------
  const seiten = pdf.getPages();
  seiten.forEach((s, i) => {
    const text = sauber(`${d.fusszeile} · Seite ${i + 1} von ${seiten.length}`);
    s.drawText(text, { x: RAND, y: RAND - 30, size: 8, font: normal, color: GRAU });
  });

  return await pdf.save();
}
