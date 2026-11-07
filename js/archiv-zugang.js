// Netzwerk Leopoldinum – Archiv: Jahresberichte und Fotoarchiv nur für Mitglieder
// Gäste sehen an den Reitern ein Schloss und im Bereich einen Hinweis „Mitglied werden“.
// Freigeschaltete Mitglieder (und der Vorstand) sehen die Inhalte.
// Die eigentliche Sperre liegt in der Datenbank (supabase/08_jahresberichte.sql) –
// diese Datei entscheidet nur, was angezeigt wird.

// Ergebnis der Zugangsprüfung auch für js/fotoarchiv.js: { status, vorstand }
let zugangFertig;
window.archivZugang = new Promise((r) => (zugangFertig = r));

(async () => {
  const bereiche = document.querySelectorAll("[data-nur-mitglieder]");
  if (!bereiche.length) return;
  const sb = window.sb;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };

  // ---------- Zugang prüfen: status "gast" | "wartend" | "mitglied", dazu vorstand ja/nein ----------
  async function zugang() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return { status: "gast", vorstand: false };
      const [frei, vorstand] = await Promise.all([sb.rpc("ist_freigeschaltet"), sb.rpc("ist_vorstand")]);
      const istVorstand = vorstand.data === true;
      return { status: frei.data === true || istVorstand ? "mitglied" : "wartend", vorstand: istVorstand };
    } catch (e) {
      console.error(e);
      return { status: "gast", vorstand: false };
    }
  }

  // ---------- Hinweis für Nicht-Mitglieder ----------
  function hinweis(was, status) {
    const box = el("div", "mitglieder-hinweis reveal");
    box.innerHTML = `<svg class="mitglieder-hinweis-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
    const text = el("div");
    if (status === "wartend") {
      text.append(
        el("h3", "", "Gleich ist es so weit"),
        el("p", "", `Dein Konto wird gerade vom Vorstand geprüft. Sobald es freigeschaltet ist, siehst du hier die ${was}.`)
      );
    } else {
      text.append(
        el("h3", "", "Nur für Mitglieder"),
        el("p", "", `Die ${was} sind den Mitgliedern des Netzwerk Leopoldinum vorbehalten. ` +
          "Werde Mitglied, um sie zu sehen – oder melde dich an, wenn du schon Mitglied bist.")
      );
      const knoepfe = el("div", "mitglieder-hinweis-aktionen");
      const werden = el("a", "btn btn-gold btn-sm", "Mitglied werden");
      werden.href = "index.html#anmelden";
      const login = el("a", "btn btn-blue btn-sm", "Anmelden");
      login.href = "mitglieder.html";
      knoepfe.append(werden, login);
      text.append(knoepfe);
    }
    box.append(text);
    return box;
  }

  const ergebnis = await zugang();
  zugangFertig(ergebnis);
  const { status } = ergebnis;
  const istMitglied = status === "mitglied";

  // Das Schloss an den Reitern blendet css/styles.css für Eingeloggte aus (.ist-eingeloggt, setzt js/main.js)
  if (status !== "gast") {
    document.querySelectorAll("[data-nur-mitglieder-tab]").forEach((tab) => tab.removeAttribute("title"));
  }

  bereiche.forEach((bereich) => {
    const inhalt = bereich.querySelector("[data-mitglieder-inhalt]");
    if (istMitglied) {
      if (inhalt) inhalt.hidden = false;
    } else {
      bereich.prepend(hinweis(bereich.dataset.nurMitglieder, status));
    }
  });
  window.beimScrollenZeigen?.(document);

  if (istMitglied) await ladeJahresberichte();

  // ---------- Jahresberichte (ein PDF pro Jahr, neuestes zuerst) ----------
  async function ladeJahresberichte() {
    const liste = document.getElementById("jahresberichte-liste");
    if (!liste) return;

    const { data, error } = await sb.from("jahresberichte").select("*").order("jahr", { ascending: false });
    if (error) console.error(error);
    const berichte = data || [];
    if (!berichte.length) {
      liste.append(el("p", "muted", error ? "Die Jahresberichte konnten gerade nicht geladen werden." : "Noch keine Jahresberichte eingetragen."));
      return;
    }

    // Der Speicher ist privat: zeitlich begrenzte Links (1 Stunde) für die PDFs holen
    const { data: links, error: linkFehler } = await sb.storage
      .from("jahresberichte")
      .createSignedUrls(berichte.map((b) => b.datei), 3600);
    if (linkFehler) console.error(linkFehler);
    const url = (pfad) => links?.find((l) => l.path === pfad)?.signedUrl;

    berichte.forEach((b) => {
      const block = el("section", "year");
      const head = el("div", "section-head year-head");
      head.append(el("h2", "year-label", String(b.jahr)), el("span", "gold-line"));

      const karte = el("article", "report reveal");
      karte.innerHTML = `<svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>
        <path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>`;
      const body = el("div", "report-body");
      body.append(el("h3", "", b.titel || `Jahresbericht ${b.jahr}`));
      if (b.text) body.append(el("p", "", b.text));

      const link = url(b.datei);
      if (link) {
        const aktionen = el("div", "report-actions");
        const ansehen = el("a", "btn btn-gold btn-sm", "PDF ansehen");
        ansehen.href = link;
        ansehen.target = "_blank";
        ansehen.rel = "noopener";
        const laden = el("a", "btn btn-ghost btn-sm", "Herunterladen");
        laden.href = link + "&download=" + encodeURIComponent(`Jahresbericht-${b.jahr}.pdf`);
        aktionen.append(ansehen, laden);
        body.append(aktionen);
      } else {
        body.append(el("p", "muted", "Das PDF konnte gerade nicht geladen werden."));
      }

      karte.append(body);
      block.append(head, karte);
      liste.append(block);
    });
    window.beimScrollenZeigen?.(liste);
  }
})();
