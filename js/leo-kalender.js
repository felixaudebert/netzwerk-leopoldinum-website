// Netzwerk Leopoldinum – Leo-Kalender (nur für freigeschaltete Mitglieder)
// Grundlage: das laufende bayerische Schuljahr (1. August – 31. Juli) mit Ferien und Feiertagen
// aus der Edge Function "schulkalender". Dazu die Termine am Leopoldinum, die der Vorstand
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

  // ---------- Daten laden ----------
  let kalender = null;   // { schuljahr, von, bis, ferien: [{name, von, bis}], feiertage: [{name, datum}] }
  try {
    const { data, error } = await sb.functions.invoke("schulkalender", { method: "GET" });
    if (error) throw error;
    kalender = data;
  } catch (e) {
    console.error(e);
    $("lk-fehler").hidden = false;
  }

  // Schuljahr bestimmen (falls die Ferien nicht geladen werden konnten, selbst ausrechnen)
  const jetzt = new Date();
  const startJahr = jetzt.getMonth() >= 7 ? jetzt.getFullYear() : jetzt.getFullYear() - 1;
  const sjVon = kalender?.von || `${startJahr}-08-01`;
  const sjBis = kalender?.bis || `${startJahr + 1}-07-31`;
  const schuljahr = kalender?.schuljahr || `${startJahr}/${String(startJahr + 1).slice(2)}`;
  $("lk-titel").textContent = `Schuljahr ${schuljahr}`;
  const ferien = kalender?.ferien || [];
  const feiertage = kalender?.feiertage || [];

  const { data: termineDaten, error: termineFehler } = await sb
    .from("leo_termine")
    .select("*")
    .lte("datum", sjBis)
    .order("datum", { ascending: true });
  if (termineFehler) console.error(termineFehler);
  const termine = (termineDaten || []).filter((t) => (t.bis || t.datum) >= sjVon);

  // ---------- Was ist an einem Tag? ----------
  const ferienAm = (tag) => ferien.filter((f) => f.von <= tag && tag <= f.bis);
  const feiertagAm = (tag) => feiertage.filter((f) => f.datum === tag);
  const termineAm = (tag) => termine.filter((t) => t.datum <= tag && tag <= (t.bis || t.datum));

  // ---------- Monatsansicht ----------
  // Monate des Schuljahrs: August … Juli
  const monate = [];
  for (let d = ausIso(sjVon); iso(d) <= sjBis; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    monate.push({ jahr: d.getFullYear(), monat: d.getMonth() });
  }
  let index = monate.findIndex((m) => m.jahr === jetzt.getFullYear() && m.monat === jetzt.getMonth());
  if (index < 0) index = 0;

  function zeichne() {
    const { jahr, monat } = monate[index];
    $("lk-monat").textContent = `${MONATE[monat]} ${jahr}`;
    $("lk-zurueck").disabled = index === 0;
    $("lk-weiter").disabled = index === monate.length - 1;

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
      te.forEach((x) => eintraege.append(el("span", "lk-chip lk-chip--termin", x.titel)));
      zelle.append(eintraege);

      // Auf dem Handy: nur farbige Punkte
      const punkte = el("div", "lk-punkte");
      if (ft.length) punkte.append(el("span", "lk-punkt lk-punkt--feiertag"));
      te.forEach(() => punkte.append(el("span", "lk-punkt lk-punkt--termin")));
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
      ...ferien.filter((f) => f.von <= bis && f.bis >= von)
        .map((f) => ({ art: "ferien", datum: f.von, titel: f.name, wann: zeitraum(f.von, f.bis) })),
      ...feiertage.filter((f) => f.datum >= von && f.datum <= bis)
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
      const li = el("li", `lk-eintrag lk-eintrag--${p.art}`);
      const kopf = el("div", "lk-eintrag-kopf");
      kopf.append(el("span", "lk-wann", p.wann));
      const art = { ferien: "Ferien", feiertag: "Feiertag", termin: "Termin" }[p.art];
      kopf.append(el("span", "lk-art", art));
      li.append(kopf, el("strong", "lk-eintrag-titel", p.titel));
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
    const i = monate.findIndex((m) => m.jahr === jetzt.getFullYear() && m.monat === jetzt.getMonth());
    index = i < 0 ? 0 : i;
    zeichne();
  });

  zeichne();
})();
