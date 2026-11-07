// Netzwerk Leopoldinum – Fotoarchiv im Archiv (nur für freigeschaltete Mitglieder)
// Übersicht: Abiturjahrgänge (neuester zuerst) mit Klassenfoto als Startbild.
// Ein Jahrgang: Reiter Abiturfeier / Abiturfahrt / Sonstiges, Galerie mit Großansicht.
// Hochladen: alle Mitglieder; neue Fotos sind erst nach Freigabe durch den Vorstand für alle sichtbar.
// Daten: Tabellen "abiturjahrgaenge" und "fotos", Speicher "fotoarchiv" (supabase/09_fotoarchiv.sql).

(async () => {
  const wurzel = document.getElementById("fotoarchiv");
  if (!wurzel) return;
  const { status, vorstand } = await window.archivZugang;
  if (status !== "mitglied") return;   // Gäste/Wartende sehen den Hinweis aus archiv-zugang.js

  const sb = window.sb;
  const $ = (sel) => wurzel.querySelector(sel);
  const KATEGORIEN = { abiturfeier: "Abiturfeier", abiturfahrt: "Abiturfahrt", sonstiges: "Sonstiges" };
  const MAX_FOTOS = 50;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const speicher = () => sb.storage.from("fotoarchiv");

  // Zeitlich begrenzte Links (1 Stunde) für mehrere Dateien auf einmal
  async function links(pfade) {
    const liste = [...new Set(pfade.filter(Boolean))];
    if (!liste.length) return new Map();
    const { data, error } = await speicher().createSignedUrls(liste, 3600);
    if (error) console.error(error);
    return new Map((data || []).filter((l) => l.signedUrl).map((l) => [l.path, l.signedUrl]));
  }

  const platzhalter = () => {
    const box = el("div", "fa-bild fa-bild--leer");
    const logo = el("img");
    logo.src = "assets/logo.png";
    logo.alt = "";
    box.append(logo);
    return box;
  };

  let jahrgaenge = [];      // [{ jahr, klassenfoto }]
  let aktuellesJahr = null;
  let aktuelleKat = "abiturfeier";
  let fotosDesJahres = [];  // sichtbare Fotos des geöffneten Jahrgangs
  let fotoLinks = new Map();

  // ================= Übersicht =================
  async function ladeUebersicht() {
    const [{ data: jg, error }, { data: alleFotos }] = await Promise.all([
      sb.from("abiturjahrgaenge").select("jahr, klassenfoto").order("jahr", { ascending: false }),
      sb.from("fotos").select("jahrgang").eq("freigegeben", true),
    ]);
    if (error) console.error(error);
    jahrgaenge = jg || [];
    const anzahl = {};
    (alleFotos || []).forEach((f) => (anzahl[f.jahrgang] = (anzahl[f.jahrgang] || 0) + 1));

    const raster = $("#fa-jahrgaenge");
    raster.replaceChildren();
    $("#fa-hochladen-oben").hidden = !jahrgaenge.length;
    if (!jahrgaenge.length) {
      raster.append(el("p", "muted", error ? "Das Fotoarchiv konnte gerade nicht geladen werden." : "Noch keine Abiturjahrgänge angelegt."));
      return;
    }

    const url = await links(jahrgaenge.map((j) => j.klassenfoto));
    jahrgaenge.forEach((j) => {
      const karte = el("button", "fa-jahrgang reveal");
      karte.type = "button";
      const link = url.get(j.klassenfoto);
      if (link) {
        const box = el("div", "fa-bild");
        const img = el("img");
        img.src = link;
        img.alt = `Klassenfoto Abitur ${j.jahr}`;
        img.loading = "lazy";
        box.append(img);
        karte.append(box);
      } else {
        karte.append(platzhalter());
      }
      const unten = el("div", "fa-jahrgang-text");
      unten.append(el("strong", "", `Abitur ${j.jahr}`));
      const n = anzahl[j.jahr] || 0;
      unten.append(el("span", "muted", n === 1 ? "1 Foto" : `${n} Fotos`));
      karte.append(unten);
      karte.addEventListener("click", () => oeffneJahrgang(j.jahr));
      raster.append(karte);
    });
    window.beimScrollenZeigen?.(raster);
  }

  // ================= Ein Jahrgang =================
  async function oeffneJahrgang(jahr, kategorie = "abiturfeier") {
    aktuellesJahr = jahr;
    aktuelleKat = kategorie;
    $("#fa-uebersicht").hidden = true;
    $("#fa-detail").hidden = false;
    $("#fa-titel").textContent = `Abitur ${jahr}`;
    wurzel.closest(".archive")?.scrollIntoView({ behavior: "smooth", block: "start" });

    const j = jahrgaenge.find((x) => x.jahr === jahr);
    const { data, error } = await sb.from("fotos").select("*").eq("jahrgang", jahr).order("created_at", { ascending: false });
    if (error) console.error(error);
    fotosDesJahres = data || [];
    fotoLinks = await links([j?.klassenfoto, ...fotosDesJahres.map((f) => f.datei)]);

    const klasse = $("#fa-klassenfoto");
    klasse.replaceChildren();
    const k = fotoLinks.get(j?.klassenfoto);
    if (k) {
      const img = el("img");
      img.src = k;
      img.alt = `Klassenfoto Abitur ${jahr}`;
      klasse.append(img);
      klasse.hidden = false;
    } else {
      klasse.hidden = true;
    }
    zeigeKategorie(kategorie);
  }

  function zeigeKategorie(kat) {
    aktuelleKat = kat;
    wurzel.querySelectorAll("[data-fa-kat]").forEach((b) => {
      const n = fotosDesJahres.filter((f) => f.kategorie === b.dataset.faKat).length;
      b.textContent = `${KATEGORIEN[b.dataset.faKat]}${n ? ` (${n})` : ""}`;
      b.setAttribute("aria-selected", String(b.dataset.faKat === kat));
    });

    const galerie = $("#fa-galerie");
    galerie.replaceChildren();
    const fotos = fotosDesJahres.filter((f) => f.kategorie === kat);
    if (!fotos.length) {
      galerie.append(el("p", "muted fa-leer", `Noch keine Fotos von der Kategorie „${KATEGORIEN[kat]}“. Lade gern welche hoch!`));
      return;
    }
    fotos.forEach((f, i) => {
      const kachel = el("figure", "fa-foto" + (f.freigegeben ? "" : " fa-foto--wartend"));
      const knopf = el("button");
      knopf.type = "button";
      knopf.setAttribute("aria-label", "Foto groß anzeigen");
      const img = el("img");
      img.src = fotoLinks.get(f.datei) || "";
      img.alt = "";
      img.loading = "lazy";
      knopf.append(img);
      knopf.addEventListener("click", () => grossansicht(fotos, i));
      kachel.append(knopf);
      if (!f.freigegeben) kachel.append(el("figcaption", "fa-badge", "Wartet auf Freigabe"));
      if (vorstand) {
        const weg = el("button", "fa-loeschen", "×");
        weg.type = "button";
        weg.setAttribute("aria-label", "Foto löschen");
        weg.addEventListener("click", () => loeschen(f));
        kachel.append(weg);
      }
      galerie.append(kachel);
    });
  }

  async function loeschen(f) {
    if (!confirm("Dieses Foto wirklich löschen?")) return;
    const { error } = await sb.from("fotos").delete().eq("id", f.id);
    if (error) return alert("Das hat nicht geklappt.");
    await speicher().remove([f.datei]);
    oeffneJahrgang(aktuellesJahr, aktuelleKat);
  }

  // ================= Großansicht =================
  const lightbox = $("#fa-lightbox");
  let lbFotos = [];
  let lbIndex = 0;
  function grossansicht(fotos, i) {
    lbFotos = fotos;
    zeigeLb(i);
    lightbox.showModal();
  }
  function zeigeLb(i) {
    lbIndex = (i + lbFotos.length) % lbFotos.length;
    $("#fa-lb-bild").src = fotoLinks.get(lbFotos[lbIndex].datei) || "";
    $("#fa-lb-zaehler").textContent = `${lbIndex + 1} / ${lbFotos.length}`;
    const mehrere = lbFotos.length > 1;
    $("#fa-lb-zurueck").hidden = !mehrere;
    $("#fa-lb-weiter").hidden = !mehrere;
  }
  $("#fa-lb-zurueck").addEventListener("click", () => zeigeLb(lbIndex - 1));
  $("#fa-lb-weiter").addEventListener("click", () => zeigeLb(lbIndex + 1));
  $("#fa-lb-schliessen").addEventListener("click", () => lightbox.close());
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") zeigeLb(lbIndex - 1);
    if (e.key === "ArrowRight") zeigeLb(lbIndex + 1);
  });

  // ================= Hochladen =================
  const dialog = $("#fa-dialog");
  const form = $("#fa-form");
  const meldung = (text, art) => {
    const p = form.querySelector(".form-status");
    p.textContent = text;
    p.className = "form-status is-" + art;
  };

  function hochladenOeffnen() {
    form.reset();
    meldung("", "info");
    const auswahl = form.jahrgang;
    auswahl.replaceChildren(...jahrgaenge.map((j) => new Option(`Abitur ${j.jahr}`, j.jahr)));
    if (aktuellesJahr) auswahl.value = aktuellesJahr;
    form.kategorie.value = aktuelleKat;
    form.querySelector('[type="submit"]').disabled = false;
    $("#fa-hinweis-freigabe").hidden = vorstand;
    dialog.showModal();
  }
  wurzel.querySelectorAll("[data-fa-hochladen]").forEach((b) => b.addEventListener("click", hochladenOeffnen));
  $("#fa-abbrechen").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dateien = [...form.dateien.files];
    if (!dateien.length) return meldung("Bitte wähle mindestens ein Foto aus.", "error");
    if (dateien.length > MAX_FOTOS) return meldung(`Bitte höchstens ${MAX_FOTOS} Fotos auf einmal hochladen.`, "error");
    if (dateien.some((d) => !d.type.startsWith("image/"))) return meldung("Bitte nur Fotos auswählen.", "error");

    const knopf = form.querySelector('[type="submit"]');
    knopf.disabled = true;
    const { data: { session } } = await sb.auth.getSession();
    const ordner = `eingang/${session.user.id}`;
    const jahr = Number(form.jahrgang.value);
    const kategorie = form.kategorie.value;
    const pfade = [];

    try {
      for (const [i, datei] of dateien.entries()) {
        meldung(`Foto ${i + 1} von ${dateien.length} wird hochgeladen …`, "info");
        let blob;
        try {
          blob = await window.verkleinereBild(datei);
        } catch {
          throw new Error(`„${datei.name}“ konnte nicht gelesen werden. Bitte als JPG oder PNG hochladen.`);
        }
        const pfad = `${ordner}/${crypto.randomUUID()}.jpg`;
        const { error } = await speicher().upload(pfad, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (error) throw new Error("Das Hochladen hat nicht geklappt. Bitte versuche es noch einmal.");
        pfade.push(pfad);
      }
      const { error } = await sb.rpc("fotos_einreichen", { jahr, kategorie, pfade });
      if (error) {
        console.error(error);
        throw new Error("Die Fotos konnten nicht gespeichert werden. Bitte versuche es noch einmal.");
      }
    } catch (fehler) {
      if (pfade.length) await speicher().remove(pfade);   // halbfertigen Upload aufräumen
      knopf.disabled = false;
      return meldung(fehler.message, "error");
    }

    const n = pfade.length === 1 ? "Dein Foto ist" : `Deine ${pfade.length} Fotos sind`;
    meldung(vorstand
      ? "Gespeichert – die Fotos sind sofort sichtbar."
      : `Danke! ${n} eingegangen und für alle sichtbar, sobald der Vorstand sie freigegeben hat.`, "success");
    knopf.disabled = false;
    form.dateien.value = "";
    await ladeUebersicht();
    if (!$("#fa-detail").hidden) oeffneJahrgang(jahr, kategorie);
  });

  // ================= Bedienung =================
  wurzel.querySelectorAll("[data-fa-kat]").forEach((b) => b.addEventListener("click", () => zeigeKategorie(b.dataset.faKat)));
  $("#fa-zurueck").addEventListener("click", () => {
    aktuellesJahr = null;
    $("#fa-detail").hidden = true;
    $("#fa-uebersicht").hidden = false;
  });

  await ladeUebersicht();
})();
