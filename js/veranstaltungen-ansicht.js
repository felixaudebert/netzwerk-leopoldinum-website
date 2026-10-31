// Netzwerk Leopoldinum – Veranstaltungen anzeigen
// Startseite: „Aktuelles“ (#aktuelles-liste), Unterseite: Archiv nach Jahren (#chronik).
// Die Einträge pflegt der Vorstand im Mitgliederbereich (Tabelle "veranstaltungen" in Supabase).

(async () => {
  const aktuell = document.getElementById("aktuelles-liste");
  const chronik = document.getElementById("chronik");
  if (!aktuell && !chronik) return;

  const AKTUELLES_MAX = 3;   // so viele Einträge zeigt die Startseite höchstens
  const sb = window.sb;
  const heute = new Date().toISOString().slice(0, 10);
  const datumText = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  const medienUrl = (pfad) => sb.storage.from("veranstaltungen").getPublicUrl(pfad).data.publicUrl;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };

  // Bild, Video oder Platzhalter mit Logo
  const medien = (v, hell) => {
    const box = el("div", "event-media");
    if (v.video) {
      const video = el("video");
      video.src = medienUrl(v.video);
      video.controls = true;
      video.preload = "metadata";
      if (v.bild) video.poster = medienUrl(v.bild);
      box.append(video);
    } else if (v.bild) {
      const img = el("img");
      img.src = medienUrl(v.bild);
      img.alt = v.titel;
      img.loading = "lazy";
      box.append(img);
    } else {
      box.classList.add("event-media--leer");
      const logo = el("img");
      logo.src = hell ? "assets/logo-hell.png" : "assets/logo.png";
      logo.alt = "";
      box.append(logo);
    }
    return box;
  };

  const eintrag = (v, { hell, mitMehr }) => {
    const art = el("article", "event reveal");
    const body = el("div", "event-body");
    const meta = el("p", "event-meta");
    meta.append(
      el("span", "event-tag", v.datum >= heute ? "Vorschau" : "Rückblick"),
      document.createTextNode(datumText(v.datum) + (v.ort ? " · " + v.ort : ""))
    );
    body.append(meta, el("h3", "", v.titel), el("p", "", v.text));
    if (mitMehr && v.mehr) {
      v.mehr.split(/\n\s*\n/).filter((a) => a.trim())
        .forEach((absatz) => body.append(el("p", "event-more", absatz.trim())));
    }
    art.append(medien(v, hell), body);
    return art;
  };

  let abfrage = sb.from("veranstaltungen").select("*")
    .order("datum", { ascending: false })
    .order("created_at", { ascending: false });
  if (!chronik) abfrage = abfrage.eq("aktuell", true).limit(AKTUELLES_MAX);
  const { data: alle, error } = await abfrage;
  if (error) console.error(error);
  const liste = alle || [];

  if (aktuell) {
    const neu = liste.filter((v) => v.aktuell).slice(0, AKTUELLES_MAX);
    if (!neu.length) aktuell.append(el("p", "", error ? "Die Neuigkeiten konnten gerade nicht geladen werden." : "Bald gibt es hier Neues aus dem Netzwerk."));
    neu.forEach((v) => aktuell.append(eintrag(v, { hell: true, mitMehr: false })));
    window.beimScrollenZeigen?.(aktuell);
  }

  if (chronik) {
    const jahre = [...new Set(liste.map((v) => v.datum.slice(0, 4)))];
    if (!jahre.length) chronik.append(el("p", "", error ? "Die Veranstaltungen konnten gerade nicht geladen werden." : "Noch keine Veranstaltungen eingetragen."));
    jahre.forEach((jahr) => {
      const block = el("section", "year");
      const head = el("div", "section-head year-head");
      head.append(el("h2", "year-label", jahr), el("span", "gold-line"));
      block.append(head);
      liste.filter((v) => v.datum.startsWith(jahr))
        .forEach((v) => block.append(eintrag(v, { hell: false, mitMehr: true })));
      chronik.append(block);
    });
    window.beimScrollenZeigen?.(chronik);
  }
})();
