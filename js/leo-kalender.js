// Netzwerk Leopoldinum – Leo-Kalender (nur für freigeschaltete Mitglieder)
// Grundlage: das laufende bayerische Schuljahr (1. August – 31. Juli) und die fünf kommenden,
// mit Ferien und Feiertagen aus der Edge Function "schulkalender". Dazu die Termine am Leopoldinum, die der Vorstand
// im Mitgliederbereich einträgt (Tabelle "leo_termine", supabase/10_leo_kalender.sql).

(async () => {
  const sb = window.sb;
  const $ = (id) => document.getElementById(id);
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // Datumsangaben als "JJJJ-MM-TT" (ohne Zeitzonen-Fallen)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ausIso = (s) => {
    const [j, m, t] = s.split("-").map(Number);
    return new Date(j, m - 1, t);
  };
  const kurz = (s) => ausIso(s).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  const zeitraum = (von, bis) => (bis && bis !== von ? `${kurz(von)} – ${kurz(bis)}` : kurz(von));
  const heute = iso(new Date());

  // ---------- Zugang ----------
  async function zugang() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return "gast";
      const { data } = await sb.rpc("ist_freigeschaltet");
      return data === true ? "mitglied" : "wartend";
    } catch (e) {
      console.error(e);
      return "gast";
    }
  }

  function hinweis(status) {
    const box = el("div", "mitglieder-hinweis");
    box.innerHTML = `<svg class="mitglieder-hinweis-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
    const text = el("div");
    if (status === "wartend") {
      text.append(el("h3", "", "Gleich ist es so weit"),
        el("p", "", "Dein Konto wird gerade vom Vorstand geprüft. Sobald es freigeschaltet ist, siehst du hier den Leo-Kalender."));
    } else {
      text.append(el("h3", "", "Nur für Mitglieder"),
        el("p", "", "Der Leo-Kalender ist den Mitgliedern des Netzwerk Leopoldinum vorbehalten. " +
          "Werde Mitglied, um ihn zu sehen – oder melde dich an, wenn du schon Mitglied bist."));
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

  const status = await zugang();
  if (status !== "mitglied") {
    $("lk-hinweis").append(hinweis(status));
    return;
  }
  $("lk-inhalt").hidden = false;

  // ---------- Zeitraum: laufendes Schuljahr + die fünf kommenden ----------
  const SCHULJAHRE = 6;
  const jetzt = new Date();
  const startJahr = jetzt.getMonth() >= 7 ? jetzt.getFullYear() : jetzt.getFullYear() - 1;
  const gesamtVon = `${startJahr}-08-01`;
  const gesamtBis = `${startJahr + SCHULJAHRE}-07-31`;
  const sjName = (s) => `${s}/${String(s + 1).slice(2)}`;
  const sjVonMonat = (jahr, monat) => (monat >= 7 ? jahr : jahr - 1);   // August = 7

  // Ferien und Feiertage je Schuljahr – erst laden, wenn man dorthin blättert
  // { schuljahr, ferien: [{name, von, bis}], ferienFestgelegt, ferienFehler, feiertage: [{name, datum}] }
  const geladen = new Map();
  const ladend = new Map();
  function ladeSchuljahr(s) {
    if (geladen.has(s)) return Promise.resolve(geladen.get(s));
    if (!ladend.has(s)) {
      ladend.set(s, sb.functions.invoke(`schulkalender?start=${s}`, { method: "GET" })
        .then(({ data, error }) => {
          if (error) throw error;
          geladen.set(s, data);
          return data;
        })
        .catch((e) => {
          console.error(e);
          return null;   // beim nächsten Blättern erneut versuchen
        })
        .finally(() => ladend.delete(s)));
    }
    return ladend.get(s);
  }
  const alleFerien = () => [...geladen.values()].flatMap((k) => k.ferien || []);
  const alleFeiertage = () => [...geladen.values()].flatMap((k) => k.feiertage || []);

  const { data: termineDaten, error: termineFehler } = await sb
    .from("leo_termine")
    .select("*")
    .lte("datum", gesamtBis)
    .order("datum", { ascending: true });
  if (termineFehler) console.error(termineFehler);
  const termine = (termineDaten || []).filter((t) => (t.bis || t.datum) >= gesamtVon);

  // ---------- Was ist an einem Tag? ----------
  const ferienAm = (tag) => alleFerien().filter((f) => f.von <= tag && tag <= f.bis);
  const feiertagAm = (tag) => alleFeiertage().filter((f) => f.datum === tag);
  const termineAm = (tag) => termine.filter((t) => t.datum <= tag && tag <= (t.bis || t.datum));

  // Kleines Netzwerk-Logo für Termine des Netzwerk Leopoldinum
  const logo = (hell) => {
    const img = el("img", "lk-logo");
    img.src = hell ? "assets/logo-hell.png" : "assets/logo.png";
    img.alt = "Netzwerk Leopoldinum";
    img.title = "Veranstaltung des Netzwerk Leopoldinum";
    return img;
  };

  // ---------- Monatsansicht ----------
  const monate = [];
  for (let d = ausIso(gesamtVon); iso(d) <= gesamtBis; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    monate.push({ jahr: d.getFullYear(), monat: d.getMonth() });
  }
  const heuteIndex = () => Math.max(0, monate.findIndex((m) => m.jahr === jetzt.getFullYear() && m.monat === jetzt.getMonth()));
  let index = heuteIndex();
  let zeichnung = 0;   // verhindert, dass eine langsame Antwort einen neueren Monat überschreibt

  async function zeichne() {
    const nr = ++zeichnung;
    const { jahr, monat } = monate[index];
    const s = sjVonMonat(jahr, monat);
    $("lk-monat").textContent = `${MONATE[monat]} ${jahr}`;
    $("lk-titel").textContent = `Schuljahr ${sjName(s)}`;
    $("lk-zurueck").disabled = index === 0;
    $("lk-weiter").disabled = index === monate.length - 1;

    const k = await ladeSchuljahr(s);
    if (nr !== zeichnung) return;
    $("lk-fehler").hidden = !!k && !k.ferienFehler;
    const offen = $("lk-ferien-offen");
    offen.hidden = !k || k.ferienFehler || k.ferienFestgelegt !== false;
    offen.textContent = `Die Schulferien für das Schuljahr ${sjName(s)} hat das bayerische Kultusministerium noch nicht festgelegt. ` +
      "Feiertage und Termine siehst du trotzdem.";
    zeichneMonat(jahr, monat);
  }

  function zeichneMonat(jahr, monat) {
    const tage = $("lk-tage");
    tage.replaceChildren();
    const erster = new Date(jahr, monat, 1);
    const versatz = (erster.getDay() + 6) % 7;   // Montag = 0
    const anzahl = new Date(jahr, monat + 1, 0).getDate();

    for (let i = 0; i < versatz; i++) tage.append(el("div", "lk-tag lk-tag--leer"));
    for (let t = 1; t <= anzahl; t++) {
      const tag = iso(new Date(jahr, monat, t));
      const fe = ferienAm(tag);
      const ft = feiertagAm(tag);
      const te = termineAm(tag);
      const wochenende = [5, 6].includes((versatz + t - 1) % 7);

      const zelle = el("div", "lk-tag");
      zelle.setAttribute("role", "gridcell");
      if (fe.length) zelle.classList.add("lk-tag--ferien");
      if (ft.length) zelle.classList.add("lk-tag--feiertag");
      if (wochenende) zelle.classList.add("lk-tag--wochenende");
      if (tag === heute) zelle.classList.add("lk-tag--heute");

      const beschreibung = [...ft.map((f) => f.name), ...fe.map((f) => f.name), ...te.map((x) => x.titel)];
      zelle.setAttribute("aria-label", `${t}. ${MONATE[monat]}${beschreibung.length ? ": " + beschreibung.join(", ") : ""}`);
      zelle.append(el("span", "lk-zahl", String(t)));

      const eintraege = el("div", "lk-eintraege");
      // Ferienname am ersten Ferientag, am Monatsersten und an jedem Montag
      const wochenanfang = (versatz + t - 1) % 7 === 0;
      fe.filter((f) => f.von === tag || t === 1 || wochenanfang)
        .forEach((f) => eintraege.append(el("span", "lk-chip lk-chip--ferien", f.name)));
      ft.forEach((f) => eintraege.append(el("span", "lk-chip lk-chip--feiertag", f.name)));
      te.forEach((x) => {
        const chip = el("span", "lk-chip lk-chip--termin" + (x.netzwerk ? " lk-chip--netzwerk" : ""));
        if (x.netzwerk) chip.append(logo(true));
        chip.append(document.createTextNode(x.titel));
        eintraege.append(chip);
      });
      zelle.append(eintraege);

      // Auf dem Handy: nur farbige Punkte
      const punkte = el("div", "lk-punkte");
      if (ft.length) punkte.append(el("span", "lk-punkt lk-punkt--feiertag"));
      te.forEach((x) => punkte.append(el("span", "lk-punkt lk-punkt--termin" + (x.netzwerk ? " lk-punkt--netzwerk" : ""))));
      zelle.append(punkte);

      tage.append(zelle);
    }
    zeichneListe(jahr, monat);
  }

  // ---------- Liste unter dem Kalender ----------
  function zeichneListe(jahr, monat) {
    const von = iso(new Date(jahr, monat, 1));
    const bis = iso(new Date(jahr, monat + 1, 0));
    $("lk-liste-titel").textContent = `Im ${MONATE[monat]}`;

    const punkte = [
      ...alleFerien().filter((f) => f.von <= bis && f.bis >= von)
        .map((f) => ({ art: "ferien", datum: f.von, titel: f.name, wann: zeitraum(f.von, f.bis) })),
      ...alleFeiertage().filter((f) => f.datum >= von && f.datum <= bis)
        .map((f) => ({ art: "feiertag", datum: f.datum, titel: f.name, wann: kurz(f.datum) })),
      ...termine.filter((t) => t.datum <= bis && (t.bis || t.datum) >= von)
        .map((t) => ({ art: "termin", datum: t.datum, titel: t.titel, wann: zeitraum(t.datum, t.bis), t })),
    ].sort((a, b) => a.datum.localeCompare(b.datum));

    const liste = $("lk-liste");
    liste.replaceChildren();
    if (!punkte.length) {
      liste.append(el("li", "lk-leer muted", "Keine Ferien, Feiertage oder Termine in diesem Monat."));
      return;
    }
    punkte.forEach((p) => {
      const netzwerk = p.t?.netzwerk === true;
      const li = el("li", `lk-eintrag lk-eintrag--${p.art}` + (netzwerk ? " lk-eintrag--netzwerk" : ""));
      const kopf = el("div", "lk-eintrag-kopf");
      kopf.append(el("span", "lk-wann", p.wann));
      const art = netzwerk ? "Netzwerk Leopoldinum" : { ferien: "Ferien", feiertag: "Feiertag", termin: "Termin am Leopoldinum" }[p.art];
      kopf.append(el("span", "lk-art", art));
      const titel = el("strong", "lk-eintrag-titel", p.titel);
      if (netzwerk) titel.prepend(logo(false));
      li.append(kopf, titel);
      if (p.t) {
        const details = [p.t.uhrzeit, p.t.ort].filter(Boolean).join(" · ");
        if (details) li.append(el("p", "lk-details", details));
        if (p.t.beschreibung) li.append(el("p", "lk-beschreibung", p.t.beschreibung));
      }
      liste.append(li);
    });
  }

  $("lk-zurueck").addEventListener("click", () => { if (index > 0) { index--; zeichne(); } });
  $("lk-weiter").addEventListener("click", () => { if (index < monate.length - 1) { index++; zeichne(); } });
  $("lk-heute").addEventListener("click", () => {
    index = heuteIndex();
    zeichne();
  });

  zeichne();
})();
