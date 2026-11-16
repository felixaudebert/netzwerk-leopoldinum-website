// Netzwerk Leopoldinum – Mitgliederbereich: Login, Profil, Karte, Freischaltung

const sb = window.sb;
const $ = (sel, root = document) => root.querySelector(sel);

const ROLLEN = {
  ehemalige: "Ehemalige/r",
  schueler: "Schüler/in",
  eltern: "Elternteil",
  lehrkraft: "Lehrkraft",
  sonstiges: "Sonstiges",
};

const INFO_KONTO = "info@netzwerk-leopoldinum.de";   // Vereinskonto (Vorstand, ohne eigenes Profil)
let ich = null;        // eigener Eintrag aus "mitglieder"
let karte = null;      // Leaflet-Karte
let markerLayer = null;

// ---------- Hilfen ----------
const zeigeView = (name) => {
  ["laden", "login", "passwort", "einrichtung", "bereich"].forEach((v) => {
    $("#view-" + v).hidden = v !== name;
  });
};

const status = (form, text, type) => {
  const el = $(".form-status", form);
  el.textContent = text;
  el.className = "form-status is-" + type;
};

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

// ---------- Start ----------
async function start() {
  // Einladungslink aus der E-Mail „Dein Zugang zum Mitgliederbereich“
  const zugangToken = new URLSearchParams(location.search).get("zugang");
  if (zugangToken) return zeigeZugang(zugangToken);
  const { data: { session } } = await sb.auth.getSession();
  if (window.AUTH_LINK_TYP === "invite" || window.AUTH_LINK_TYP === "recovery") {
    if (session) return zeigeView("passwort");
  }
  if (!session) return zeigeView("login");
  await ladeBereich();
}

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") zeigeView("passwort");
  // Menü oben (öffentliche Reiter ↔ Karte/Leo Kalender/Archiv/Mein Profil) nach dem Ein- oder Ausloggen umschalten
  setTimeout(() => window.navAktualisieren?.(), 0);
});

// Fehlermeldung aus einer Edge Function lesen ({ fehler: "…" })
async function funktionsFehler(error, standard) {
  try {
    return (await error?.context?.json())?.fehler || standard;
  } catch {
    return standard;
  }
}

// ---------- Ersteinrichtung: Passwort (nur Einladung), Datenschutz, Mitgliederkarte ----------
// Ablauf 1 – Einladungslink (mitglieder.html?zugang=…): alles in einem Formular, gespeichert von der
//            Edge Function "zugang-aktivieren" (erst Datenschutz + Karte, dann das Passwort).
// Ablauf 2 – eingeloggt, aber noch nicht eingerichtet (z. B. Online-Antrag oder Konto von vor dieser Änderung):
//            ladeBereich() zeigt nur dieses Formular, gespeichert über die Datenbankfunktion einrichtung_abschliessen.
// Die Datenbank sperrt Karte, Leo-Kalender und Archiv, bis beides erledigt ist (supabase/14_ersteinrichtung.sql).
let einrichtungToken = null;   // gesetzt bei Ablauf 1
let einrichtungBekannt = {};   // bisherige Stadt mit Koordinaten (unveränderte Stadt nicht neu suchen)

const einrichtungMeldung = (text, art) => {
  $("#einrichtung-status").textContent = text;
  $("#einrichtung-status").className = "form-status is-" + art;
};

function fuelleEinrichtung(daten, mitPasswort) {
  const f = $("#einrichtung-form");
  $("#einrichtung-titel").textContent = `Willkommen, ${daten.vorname || ""}!`.replace(" !", "!");
  $("#einrichtung-text").hidden = false;
  $("#einrichtung-text").textContent = mitPasswort
    ? "Lege dein Passwort fest und triff zwei kurze Entscheidungen – dann steht dir der Mitgliederbereich offen."
    : "Bevor es losgeht, brauchen wir noch zwei Angaben von dir. Das dauert nur eine Minute.";
  $("#einrichtung-zugang").hidden = !mitPasswort;
  f.passwort.disabled = f.passwort2.disabled = !mitPasswort;
  f.passwort.required = f.passwort2.required = mitPasswort;
  document.querySelectorAll(".einrichtung-nr").forEach((s, i) => (s.textContent = `${i + (mitPasswort ? 2 : 1)}. `));
  $("#einrichtung-email").value = daten.email || "";

  // Online-Antrag: Datenschutz wurde schon im Antrag angekreuzt
  f.datenschutz.checked = !!daten.datenschutz_akzeptiert_am;
  // Wer schon auf der Karte ist, sieht „Ja“ vorausgewählt und bestätigt nur noch
  f.querySelectorAll('[name="auf_karte"]').forEach((r) => (r.checked = daten.auf_karte === true && r.value === "ja"));
  f.stadt.value = daten.stadt || "";
  f.taetigkeit.value = daten.taetigkeit || "";
  f.telefon.value = daten.telefon || "";
  f.kontakt.value = daten.kontakt === "telefon" ? "telefon" : "email";
  einrichtungBekannt = daten.lat != null ? { stadt: daten.stadt, lat: daten.lat, lng: daten.lng } : {};
  einrichtungFelderZeigen();
  f.hidden = false;
  einrichtungMeldung("", "info");
}

function einrichtungFelderZeigen() {
  const f = $("#einrichtung-form");
  const ja = f.querySelector('[name="auf_karte"][value="ja"]').checked;
  $("#einrichtung-karte").hidden = !ja;
  $("#einrichtung-telefon-feld").hidden = !(ja && f.kontakt.value === "telefon");
}

$("#einrichtung-form").addEventListener("change", (e) => {
  if (e.target.name === "auf_karte" || e.target.name === "kontakt") einrichtungFelderZeigen();
});

// Ablauf 1: Einladungslink prüfen und Formular mit Passwort zeigen
async function zeigeZugang(token) {
  einrichtungToken = token;
  zeigeView("einrichtung");
  einrichtungMeldung("Einladung wird geprüft …", "info");
  const { data, error } = await sb.functions.invoke("zugang-aktivieren", { body: { token } });
  if (error || !data?.ok) {
    $("#einrichtung-titel").textContent = "Link nicht mehr gültig";
    $("#einrichtung-text").hidden = true;
    $("#einrichtung-login").hidden = false;
    return einrichtungMeldung(await funktionsFehler(error, "Dieser Link ist ungültig."), "error");
  }
  fuelleEinrichtung(data, true);
}

// Ablauf 2: eingeloggt, Einrichtung noch offen
function zeigeEinrichtung() {
  einrichtungToken = null;
  zeigeView("einrichtung");
  fuelleEinrichtung(ich, false);
}

$("#einrichtung-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const fehler = (text, feld) => {
    einrichtungMeldung(text, "error");
    feld?.focus();
  };

  if (einrichtungToken) {
    if (f.passwort.value.length < 8) return fehler("Das Passwort muss mindestens 8 Zeichen lang sein.", f.passwort);
    if (f.passwort.value !== f.passwort2.value) return fehler("Die Passwörter stimmen nicht überein.", f.passwort2);
  }
  if (!f.datenschutz.checked) return fehler("Bitte akzeptiere die Datenschutzerklärung.", f.datenschutz);
  const wahl = f.querySelector('[name="auf_karte"]:checked')?.value;
  if (!wahl) {
    return fehler("Bitte entscheide, ob du auf der Mitgliederkarte erscheinen möchtest.", f.querySelector('[name="auf_karte"]'));
  }

  const einrichtung = { p_datenschutz: true, p_auf_karte: wahl === "ja" };
  if (wahl === "ja") {
    const stadt = f.stadt.value.trim();
    const telefon = f.telefon.value.trim();
    if (!stadt) return fehler("Für die Karte brauchen wir deine Stadt.", f.stadt);
    if (f.kontakt.value === "telefon" && !telefon) {
      return fehler("Bitte gib eine Telefonnummer ein oder wähle E-Mail als Kontakt.", f.telefon);
    }
    Object.assign(einrichtung, {
      p_stadt: stadt,
      p_taetigkeit: f.taetigkeit.value.trim() || null,
      p_kontakt: f.kontakt.value,
      p_telefon: telefon || null,
    });
  }

  const knopfEinrichtung = $("#einrichtung-knopf");
  knopfEinrichtung.disabled = true;
  einrichtungMeldung("Wird gespeichert …", "info");
  try {
    // Stadt → Koordinaten (nur wenn neu oder geändert)
    if (wahl === "ja") {
      const ort = einrichtungBekannt.stadt === einrichtung.p_stadt && einrichtungBekannt.lat != null
        ? einrichtungBekannt
        : await findeStadt(einrichtung.p_stadt).catch(() => null);
      if (!ort) return fehler("Diese Stadt haben wir nicht gefunden. Bitte prüfe die Schreibweise.", f.stadt);
      einrichtungBekannt = { stadt: einrichtung.p_stadt, lat: ort.lat, lng: ort.lng };
      Object.assign(einrichtung, { p_lat: ort.lat, p_lng: ort.lng });
    }

    if (!einrichtungToken) {
      const { error } = await sb.rpc("einrichtung_abschliessen", einrichtung);
      if (error) {
        console.error(error);
        return fehler(error.code === "P0001" ? error.message : "Speichern hat nicht geklappt. Bitte versuche es noch einmal.");
      }
      f.reset();
      return await ladeBereich();
    }

    const passwort = f.passwort.value;
    const { data: fertig, error } = await sb.functions.invoke("zugang-aktivieren", {
      body: { token: einrichtungToken, passwort, einrichtung },
    });
    if (error || !fertig?.ok) return fehler(await funktionsFehler(error, "Deine Angaben konnten nicht gespeichert werden."));
    einrichtungToken = null;
    f.reset();
    await sb.auth.signOut().catch(() => {});
    const { error: loginFehler } = await sb.auth.signInWithPassword({ email: fertig.email, password: passwort });
    history.replaceState(null, "", location.pathname);
    if (loginFehler) {
      zeigeView("login");
      $("#login-email").value = fertig.email;
      return status($("#login-form"), "Dein Zugang ist eingerichtet. Bitte melde dich jetzt an.", "success");
    }
    window.navAktualisieren?.();
    await ladeBereich();
  } finally {
    knopfEinrichtung.disabled = false;
  }
});

// ---------- Login ----------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  status(form, "Einen Moment …", "info");
  const { error } = await sb.auth.signInWithPassword({
    email: data.get("email").trim(),
    password: data.get("passwort"),
  });
  if (error) {
    status(
      form,
      error.message.includes("not confirmed")
        ? "Bitte bestätige zuerst deine E-Mail-Adresse über den Link in unserer E-Mail."
        : "E-Mail oder Passwort ist falsch.",
      "error"
    );
    return;
  }
  form.reset();
  status(form, "", "info");
  await ladeBereich();
});

$("#zeige-vergessen").addEventListener("click", () => {
  $("#vergessen-form").hidden = false;
  $("#vergessen-email").value = $("#login-email").value;
  $("#vergessen-email").focus();
});

$("#vergessen-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  await sb.auth.resetPasswordForEmail($("#vergessen-email").value.trim(), {
    redirectTo: new URL("mitglieder.html", location.href).href,
  });
  // Immer dieselbe Antwort, damit niemand testen kann, welche Adressen registriert sind
  status(form, "Falls ein Konto mit dieser Adresse existiert, haben wir dir einen Link geschickt.", "success");
});

$("#passwort-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = new FormData(form);
  if (data.get("passwort") !== data.get("passwort2")) {
    status(form, "Die beiden Passwörter stimmen nicht überein.", "error");
    return;
  }
  const { error } = await sb.auth.updateUser({ password: data.get("passwort") });
  if (error) {
    status(form, "Das hat nicht geklappt. Bitte wähle ein Passwort mit mindestens 8 Zeichen.", "error");
    return;
  }
  form.reset();
  window.AUTH_LINK_TYP = null;
  await ladeBereich();
});

// ---------- Bereich nach dem Login ----------
async function ladeBereich() {
  const { data: { user } } = await sb.auth.getUser();
  const { data, error } = await sb.from("mitglieder").select("*").eq("id", user.id).single();
  if (error) {
    console.error(error);
    zeigeView("login");
    status($("#login-form"), "Dein Konto konnte nicht geladen werden. Bitte melde dich bei info@netzwerk-leopoldinum.de.", "error");
    return;
  }
  ich = data;
  // Vorstandsrechte: das Vereinskonto info@ und Mitglieder mit „Vorstandszugang“ – das entscheidet die Datenbank
  const { data: vorstand } = await sb.rpc("ist_vorstand");
  ich.vorstand = vorstand === true;
  ich.infoKonto = (ich.email || "").toLowerCase() === INFO_KONTO;   // Vereinskonto ohne eigenes Profil
  ich.darfKarte = ich.freigeschaltet || ich.vorstand;
  // Header-Punkt „Vorstand“ auf allen Seiten zeigen (js/main.js liest das; die Daten selbst schützt die Datenbank)
  try {
    if (ich.vorstand) localStorage.setItem("nl-vorstand", "1");
    else localStorage.removeItem("nl-vorstand");
  } catch {}
  // Das Vereinskonto info@ hat kein eigenes Profil (Vorstandsmitglieder mit eigenem Konto schon)
  window.navOhneProfil = ich.infoKonto;
  window.navAktualisieren?.();

  // Ersteinrichtung noch offen (Datenschutz nicht bestätigt oder keine Entscheidung zur Karte)?
  // Dann gibt es nur dieses Formular – auch für Vorstandsmitglieder mit eigenem Konto, nicht für info@.
  ich.einrichtungOffen = !ich.infoKonto && (!ich.datenschutz_akzeptiert_am || !ich.karte_entschieden_am);
  if (ich.einrichtungOffen) return zeigeEinrichtung();

  zeigeView("bereich");
  if (ich.vorstand) zaehleWartendeFotos();
  $("#hallo-name").textContent = ich.infoKonto ? "Vorstand" : ich.vorname || "";
  $("#hinweis-wartend").hidden = ich.darfKarte;
  document.querySelectorAll(".nur-vorstand").forEach((b) => (b.hidden = !ich.vorstand));
  fuelleProfil();
  // „Karte“ und „Mein Profil“ im Menü führen zu mitglieder.html#karte bzw. #profil
  const wunsch = tabAusHash();
  zeigeTab(wunsch || (ich.infoKonto ? "vorstand" : ich.darfKarte ? "karte" : "profil"));
}

// ---------- Tabs ----------
// Welcher Bereich laut Adresse (#karte, #profil) gewünscht ist – sofern erlaubt
function tabAusHash() {
  if (!ich || ich.einrichtungOffen) return null;
  if (location.hash === "#karte" && ich.darfKarte) return "karte";
  if (location.hash === "#profil" && !ich.infoKonto) return "profil";
  if (location.hash === "#vorstand" && ich.vorstand) return "vorstand";
  return null;
}

// Reiter des Vorstandsbereichs (Header „Vorstand“)
const VORSTANDS_REITER = ["vorstand", "mitgliederliste", "kartenpunkte", "veranstaltungen", "jahresberichte", "fotoarchiv", "leotermine"];

function zeigeTab(name) {
  const imVorstand = VORSTANDS_REITER.includes(name);
  // Reiterleiste und Überschrift nur im Vorstandsbereich
  $(".tabs").hidden = !imVorstand;
  $("#bereich-titel").textContent = imVorstand ? "Vorstandsbereich" : "Mitgliederbereich";
  // Adresse mitführen, damit die Menü-Links „Karte“/„Mein Profil“/„Vorstand“ immer umschalten
  const hash = imVorstand ? "#vorstand" : name === "karte" || name === "profil" ? `#${name}` : "";
  if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
  document.querySelectorAll('.site-nav a[href^="mitglieder.html#"]').forEach((a) => {
    a.classList.toggle("is-active", a.getAttribute("href") === `mitglieder.html${hash}` && hash !== "");
  });
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  if (name === "karte") ladeKarte();
  if (name === "vorstand") ladeVorstand();
  if (name === "kartenpunkte") ladePunkte();
  if (name === "veranstaltungen") ladeEvents();
  if (name === "jahresberichte") ladeBerichte();
  if (name === "fotoarchiv") ladeFotoVerwaltung();
  if (name === "mitgliederliste") ladeMitgliederliste();
  if (name === "leotermine") ladeTermine();
}

document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
  b.addEventListener("click", () => zeigeTab(b.dataset.tab));
});

window.addEventListener("hashchange", () => {
  const wunsch = tabAusHash();
  if (wunsch) zeigeTab(wunsch);
});

// ---------- Profil ----------
function fuelleProfil() {
  const f = $("#profil-form");
  f.vorname.value = ich.vorname || "";
  f.nachname.value = ich.nachname || "";
  $("#p-email").value = ich.email;
  f.telefon.value = ich.telefon || "";
  f.taetigkeit.value = ich.taetigkeit || "";
  f.stadt.value = ich.stadt || "";
  f.kontakt.value = ich.kontakt;
  f.auf_karte.checked = ich.auf_karte;
  ladeKarriere();
}

// ---------- Vorherige Karriereschritte ----------
const MONATE = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
let schrittNr = 0;

// "2018-03-01" → "März 2018"
const monatJahr = (datum) => {
  const [j, m] = datum.split("-");
  return `${MONATE[Number(m) - 1]} ${j}`;
};

function optionen(select, werte, leer) {
  select.append(new Option(leer, ""));
  werte.forEach(([wert, text]) => select.append(new Option(text, wert)));
}

function neuerSchritt(daten = {}) {
  const frag = $("#karriere-vorlage").content.cloneNode(true);
  const box = frag.querySelector(".karriere-schritt");
  const nr = ++schrittNr;
  box.querySelectorAll("[data-feld]").forEach((feld) => (feld.id = `ks${nr}-${feld.dataset.feld}`));
  box.querySelectorAll("label[data-for]").forEach((l) => (l.htmlFor = `ks${nr}-${l.dataset.for}`));

  const jahrHeute = new Date().getFullYear();
  const jahre = Array.from({ length: jahrHeute - 1949 }, (_, i) => String(jahrHeute - i)).map((j) => [j, j]);
  const monate = MONATE.map((m, i) => [String(i + 1), m]);
  ["von", "bis"].forEach((teil) => {
    optionen(box.querySelector(`[data-feld="${teil}-monat"]`), monate, "Monat");
    optionen(box.querySelector(`[data-feld="${teil}-jahr"]`), jahre, "Jahr");
  });

  const feld = (name) => box.querySelector(`[data-feld="${name}"]`);
  feld("taetigkeit").value = daten.taetigkeit || "";
  feld("stadt").value = daten.stadt || "";
  ["von", "bis"].forEach((teil) => {
    if (!daten[teil]) return;
    const [j, m] = daten[teil].split("-");
    feld(`${teil}-monat`).value = String(Number(m));
    feld(`${teil}-jahr`).value = j;
  });
  // Bekannte Koordinaten merken, damit unveränderte Städte nicht neu gesucht werden
  if (daten.lat != null) Object.assign(box.dataset, { stadt: daten.stadt, lat: daten.lat, lng: daten.lng });

  box.querySelector(".karriere-entfernen").addEventListener("click", () => box.remove());
  $("#karriere-liste").append(frag);
  return box;
}

async function ladeKarriere() {
  $("#karriere-liste").replaceChildren();
  const { data, error } = await sb
    .from("karriereschritte")
    .select("taetigkeit, stadt, lat, lng, von, bis")
    .eq("mitglied_id", ich.id)
    .order("von", { ascending: false });
  if (error) return console.error(error);
  data.forEach((k) => neuerSchritt(k));
}

$("#karriere-plus").addEventListener("click", () => {
  neuerSchritt().querySelector('[data-feld="taetigkeit"]').focus();
});

// Liest alle Karriereschritte aus dem Formular; gibt bei Fehlern einen Hinweistext zurück
function leseKarriere() {
  const heute = new Date();
  const diesenMonat = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-01`;
  const schritte = [];
  for (const box of document.querySelectorAll("#karriere-liste .karriere-schritt")) {
    const w = (name) => box.querySelector(`[data-feld="${name}"]`).value.trim();
    const datum = (teil) =>
      w(`${teil}-jahr`) && w(`${teil}-monat`) ? `${w(`${teil}-jahr`)}-${w(`${teil}-monat`).padStart(2, "0")}-01` : null;
    const schritt = { taetigkeit: w("taetigkeit"), stadt: w("stadt"), von: datum("von"), bis: datum("bis"), box };
    const leer = !schritt.taetigkeit && !schritt.stadt && !w("von-monat") && !w("von-jahr") && !w("bis-monat") && !w("bis-jahr");
    if (leer) continue; // komplett leere Einträge einfach ignorieren
    if (!schritt.taetigkeit || !schritt.stadt || !schritt.von || !schritt.bis) {
      return { fehler: "Bitte fülle bei jedem Karriereschritt Tätigkeit, Stadt und den Zeitraum (von – bis) aus.", box };
    }
    if (schritt.von > schritt.bis) return { fehler: "Bei einem Karriereschritt liegt „Von“ nach „Bis“.", box };
    if (schritt.bis > diesenMonat) return { fehler: "Vorherige Karriereschritte können nicht in der Zukunft enden.", box };
    schritte.push(schritt);
  }
  return { schritte };
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Stadt → Koordinaten (OpenStreetMap Nominatim)
async function findeStadt(stadt) {
  const res = await fetch(
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=de&q=" + encodeURIComponent(stadt)
  );
  const treffer = await res.json();
  if (!treffer.length) return null;
  return { lat: Number(treffer[0].lat), lng: Number(treffer[0].lon) };
}

$("#profil-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const neu = {
    vorname: f.vorname.value.trim(),
    nachname: f.nachname.value.trim(),
    telefon: f.telefon.value.trim() || null,
    taetigkeit: f.taetigkeit.value.trim() || null,
    stadt: f.stadt.value.trim() || null,
    kontakt: f.kontakt.value,
    auf_karte: f.auf_karte.checked,
  };

  if (neu.kontakt === "telefon" && !neu.telefon) {
    status(f, "Bitte gib eine Telefonnummer ein oder wähle E-Mail als Kontakt.", "error");
    return;
  }
  if (neu.auf_karte && !neu.stadt) {
    status(f, "Für die Karte brauchen wir deine Stadt.", "error");
    return;
  }

  const karriere = leseKarriere();
  if (karriere.fehler) {
    status(f, karriere.fehler, "error");
    karriere.box?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  status(f, "Wird gespeichert …", "info");

  // Städte der Karriereschritte in Koordinaten umwandeln (nur neue oder geänderte;
  // Nominatim erlaubt höchstens eine Anfrage pro Sekunde)
  const gefunden = new Map();
  let ersteSuche = true;
  for (const k of karriere.schritte) {
    const d = k.box.dataset;
    if (d.lat && d.stadt === k.stadt) {
      Object.assign(k, { lat: Number(d.lat), lng: Number(d.lng) });
      continue;
    }
    if (!gefunden.has(k.stadt)) {
      if (!ersteSuche) await warte(1100);
      ersteSuche = false;
      gefunden.set(k.stadt, await findeStadt(k.stadt).catch(() => null));
    }
    const ort = gefunden.get(k.stadt);
    if (!ort) {
      status(f, `Die Stadt „${k.stadt}“ haben wir nicht gefunden. Bitte prüfe die Schreibweise.`, "error");
      k.box.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    Object.assign(k, ort);
  }

  if (neu.stadt !== ich.stadt || (neu.stadt && ich.lat == null)) {
    if (neu.stadt) {
      if (!ersteSuche) await warte(1100);
      const ort = await findeStadt(neu.stadt).catch(() => null);
      if (!ort) {
        status(f, "Diese Stadt haben wir nicht gefunden. Bitte prüfe die Schreibweise.", "error");
        return;
      }
      Object.assign(neu, ort);
    } else {
      Object.assign(neu, { lat: null, lng: null });
    }
  }

  const { data, error } = await sb.from("mitglieder").update(neu).eq("id", ich.id).select().single();
  if (error) {
    console.error(error);
    status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
    return;
  }
  ich = { ...data, vorstand: ich.vorstand, infoKonto: ich.infoKonto, darfKarte: ich.darfKarte };
  $("#hallo-name").textContent = ich.vorname || "";

  const { error: kFehler } = await sb.rpc("karriere_speichern", {
    schritte: karriere.schritte.map(({ box, ...k }) => k),
  });
  if (kFehler) {
    console.error(kFehler);
    status(f, "Dein Profil ist gespeichert, die Karriereschritte aber nicht. Bitte versuche es noch einmal.", "error");
    return;
  }
  await ladeKarriere();
  status(f, "Gespeichert.", "success");
  if (karte) ladeKarte();
});

// ---------- Karte ----------
// Kleiner, fester Versatz pro Mitglied, damit Punkte in derselben Stadt nicht übereinander liegen
function versatz(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return [((h & 0xff) / 255 - 0.5) * 0.04, (((h >> 8) & 0xff) / 255 - 0.5) * 0.06];
}

function popup(m) {
  const box = el("div", null, "map-popup");
  box.append(el("strong", m.name));
  if (m.aktuell === false) box.append(el("p", "Vorheriger Karriereschritt", "map-popup-label"));
  if (m.taetigkeit) box.append(el("p", m.taetigkeit));
  const zeitraum = m.von && m.bis ? ` · ${monatJahr(m.von)} – ${monatJahr(m.bis)}` : "";
  box.append(el("p", m.stadt + zeitraum, "muted"));
  const link = el("a", m.kontakt_wert);
  link.href = (m.kontakt_art === "telefon" ? "tel:" : "mailto:") + m.kontakt_wert;
  box.append(link);
  return box;
}

// Punkte auf der Karte: gold = aktueller Standort, blau = vorheriger Karriereschritt
const pin = (art, groesse) =>
  L.divIcon({
    className: "",
    html: `<span class="pin pin--${art}"></span>`,
    iconSize: [groesse, groesse],
    iconAnchor: [groesse / 2, groesse / 2],
    popupAnchor: [0, -groesse / 2],
  });
const PIN_AKTUELL = pin("aktuell", 22);
const PIN_FRUEHER = pin("frueher", 16);

async function ladeKarte() {
  if (!ich || !ich.darfKarte) return;
  if (!karte) {
    karte = L.map("karte").setView([48.57, 13.46], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(karte);
    markerLayer = L.layerGroup().addTo(karte);
  }
  setTimeout(() => karte.invalidateSize(), 0);

  const { data, error } = await sb.rpc("mitglieder_karte");
  if (error) {
    console.error(error);
    return;
  }
  markerLayer.clearLayers();
  data.forEach((m) => {
    const [dLat, dLng] = versatz(m.id);
    const aktuell = m.aktuell !== false;
    L.marker([m.lat + dLat, m.lng + dLng], {
      icon: aktuell ? PIN_AKTUELL : PIN_FRUEHER,
      zIndexOffset: aktuell ? 1000 : 0, // aktuelle Standorte liegen oben
      title: aktuell ? m.name : `${m.name} (früher)`,
    })
      .bindPopup(popup(m))
      .addTo(markerLayer);
  });
  $("#karte-leer").hidden = data.length > 0;
}

// ---------- Vorstand: Freischaltungen ----------
async function ladeVorstand() {
  const { data, error } = await sb
    .from("mitglieder")
    .select("id, created_at, email, vorname, nachname, rolle, jahrgang, nachricht, taetigkeit, freigeschaltet")
    .order("freigeschaltet", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const tbody = $("#vorstand-liste");
  tbody.replaceChildren();
  // Das Vereinskonto info@ nicht in der Liste zeigen
  const liste = data.filter((m) => (m.email || "").toLowerCase() !== INFO_KONTO);
  if (!liste.length) {
    const tr = document.createElement("tr");
    const td = el("td", "Noch keine Mitglieder.", "muted");
    td.colSpan = 6;
    tr.append(td);
    tbody.append(tr);
  }
  liste.forEach((m) => {
    const tr = document.createElement("tr");
    const angaben = [ROLLEN[m.rolle], m.jahrgang && "Abi " + m.jahrgang].filter(Boolean).join(", ");
    const angabenTd = el("td", angaben || "–");
    if (m.nachricht) angabenTd.append(el("div", "„" + m.nachricht + "“", "muted"));
    tr.append(
      el("td", [m.vorname, m.nachname].filter(Boolean).join(" ") || "–"),
      el("td", m.email),
      angabenTd,
      el("td", new Date(m.created_at).toLocaleDateString("de-DE")),
      el("td", m.freigeschaltet ? "Freigeschaltet" : "Wartet", m.freigeschaltet ? "badge badge--ok" : "badge badge--wait")
    );
    const td = document.createElement("td");
    td.className = "actions";
    if (m.id !== ich.id) {
      const btn = el("button", m.freigeschaltet ? "Sperren" : "Freischalten", "btn btn-sm " + (m.freigeschaltet ? "btn-ghost" : "btn-gold"));
      btn.type = "button";
      btn.addEventListener("click", async () => {
        if (m.freigeschaltet && !confirm(`${m.vorname || m.email} wirklich sperren?`)) return;
        btn.disabled = true;
        const { error } = await sb.rpc("freischalten", { mitglied: m.id, wert: !m.freigeschaltet });
        if (error) {
          console.error(error);
          alert("Das hat nicht geklappt.");
        }
        ladeVorstand();
      });
      td.append(btn);
    }
    tr.append(td);
    tbody.append(tr);
  });
}

// ---------- Vorstand: gemeinsame Hilfen ----------
const knopf = (text, cls, aktion) => {
  const b = el("button", text, "btn btn-sm " + cls);
  b.type = "button";
  b.addEventListener("click", aktion);
  return b;
};

const leereZeile = (tbody, text, spalten) => {
  const tr = document.createElement("tr");
  const td = el("td", text, "muted");
  td.colSpan = spalten;
  tr.append(td);
  tbody.append(tr);
};

const datumDe = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE");

// ---------- Vorstand: Kartenpunkte von Hand ----------
const punktForm = $("#punkt-form");
let punktAlt = null;   // Eintrag, der gerade bearbeitet wird (null = neuer Punkt)

function punktFormular(p = null) {
  punktAlt = p;
  punktForm.reset();
  $("#punkt-titel").textContent = p ? "Kartenpunkt bearbeiten" : "Neuer Kartenpunkt";
  $("#punkt-abbrechen").hidden = !p;
  status(punktForm, "", "info");
  if (!p) return;
  const f = punktForm;
  f.name.value = p.name;
  f.stadt.value = p.stadt;
  f.taetigkeit.value = p.taetigkeit || "";
  f.kontakt_art.value = p.kontakt_art || "";
  f.kontakt_wert.value = p.kontakt_wert || "";
  f.einwilligung_am.value = p.einwilligung_am;
  f.notiz.value = p.notiz || "";
  f.bestaetigung.checked = true;
  f.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function ladePunkte() {
  const { data, error } = await sb.from("karte_eintraege").select("*").order("name");
  const tbody = $("#punkte-liste");
  tbody.replaceChildren();
  if (error) {
    console.error(error);
    return leereZeile(tbody, "Die Kartenpunkte konnten nicht geladen werden.", 5);
  }
  if (!data.length) leereZeile(tbody, "Noch keine Kartenpunkte von Hand eingetragen.", 5);
  data.forEach((p) => {
    const tr = document.createElement("tr");
    const name = el("td", p.name);
    if (p.taetigkeit) name.append(el("div", p.taetigkeit, "muted"));
    if (p.notiz) name.append(el("div", "Notiz: " + p.notiz, "muted"));
    const td = document.createElement("td");
    td.className = "actions";
    td.append(
      knopf("Bearbeiten", "btn-ghost", () => punktFormular(p)),
      knopf("Löschen", "btn-ghost", async () => {
        if (!confirm(`${p.name} wirklich von der Karte entfernen?`)) return;
        const { error } = await sb.from("karte_eintraege").delete().eq("id", p.id);
        if (error) alert("Das hat nicht geklappt.");
        if (punktAlt?.id === p.id) punktFormular();
        ladePunkte();
        if (karte) ladeKarte();
      })
    );
    tr.append(name, el("td", p.stadt), el("td", p.kontakt_wert || "–"), el("td", datumDe(p.einwilligung_am)), td);
    tbody.append(tr);
  });
}

$("#punkt-abbrechen").addEventListener("click", () => punktFormular());

punktForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const neu = {
    name: f.name.value.trim(),
    stadt: f.stadt.value.trim(),
    taetigkeit: f.taetigkeit.value.trim() || null,
    kontakt_art: f.kontakt_art.value || null,
    kontakt_wert: f.kontakt_wert.value.trim() || null,
    einwilligung_am: f.einwilligung_am.value,
    notiz: f.notiz.value.trim() || null,
  };
  if (neu.kontakt_art && !neu.kontakt_wert) {
    status(f, "Bitte gib die E-Mail-Adresse oder Telefonnummer ein – oder wähle „Keiner“.", "error");
    return;
  }
  if (!neu.kontakt_art) neu.kontakt_wert = null;

  status(f, "Wird gespeichert …", "info");
  if (!punktAlt || neu.stadt !== punktAlt.stadt) {
    const ort = await findeStadt(neu.stadt).catch(() => null);
    if (!ort) {
      status(f, "Diese Stadt haben wir nicht gefunden. Bitte prüfe die Schreibweise.", "error");
      return;
    }
    Object.assign(neu, ort);
  }

  const tabelle = sb.from("karte_eintraege");
  const { error } = punktAlt
    ? await tabelle.update(neu).eq("id", punktAlt.id)
    : await tabelle.insert(neu);
  if (error) {
    console.error(error);
    status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
    return;
  }
  punktFormular();
  status(f, "Gespeichert – der Punkt ist jetzt auf der Karte.", "success");
  ladePunkte();
  if (karte) ladeKarte();
});

// ---------- Vorstand: Veranstaltungen ----------
const eventForm = $("#event-form");
const speicher = () => sb.storage.from("veranstaltungen");
const MEDIEN = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };
let eventAlt = null;   // Veranstaltung, die gerade bearbeitet wird (null = neue)

const zaehler = () => {
  $("#v-text-zaehler").textContent = `(${eventForm.text.value.length}/700 Zeichen)`;
};
eventForm.text.addEventListener("input", zaehler);

function eventFormular(v = null) {
  eventAlt = v;
  eventForm.reset();
  $("#event-titel").textContent = v ? "Veranstaltung bearbeiten" : "Neue Veranstaltung";
  $("#event-abbrechen").hidden = !v;
  const medium = v && (v.video ? "ein Video" : v.bild ? "ein Bild" : null);
  $("#v-medien-aktuell").hidden = !medium;
  $("#v-medien-aktuell").textContent = medium ? `Hinterlegt ist ${medium}. Eine neue Datei ersetzt es.` : "";
  $("#v-entfernen-feld").hidden = !medium;
  status(eventForm, "", "info");
  if (v) {
    const f = eventForm;
    f.datum.value = v.datum;
    f.ort.value = v.ort || "";
    f.titel.value = v.titel;
    f.text.value = v.text;
    f.mehr.value = v.mehr || "";
    f.aktuell.checked = v.aktuell;
    f.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  zaehler();
}

const dateienLoeschen = async (pfade) => {
  const weg = pfade.filter(Boolean);
  if (!weg.length) return;
  const { error } = await speicher().remove(weg);
  if (error) console.error(error);
};

async function ladeEvents() {
  const { data, error } = await sb.from("veranstaltungen").select("*")
    .order("datum", { ascending: false })
    .order("created_at", { ascending: false });
  const tbody = $("#events-liste");
  tbody.replaceChildren();
  if (error) {
    console.error(error);
    return leereZeile(tbody, "Die Veranstaltungen konnten nicht geladen werden.", 5);
  }
  if (!data.length) leereZeile(tbody, "Noch keine Veranstaltungen eingetragen.", 5);
  // Welche Einträge stehen gerade wirklich auf der Startseite? (die drei neuesten mit Häkchen)
  const aufStartseite = new Set(data.filter((v) => v.aktuell).slice(0, 3).map((v) => v.id));
  data.forEach((v) => {
    const tr = document.createElement("tr");
    const titel = el("td", v.titel);
    if (v.ort) titel.append(el("div", v.ort, "muted"));
    const startseite = aufStartseite.has(v.id) ? ["Ja", "badge badge--ok"]
      : v.aktuell ? ["Verdrängt", "badge badge--wait"] : ["Nein", "badge"];
    const td = document.createElement("td");
    td.className = "actions";
    td.append(
      knopf("Bearbeiten", "btn-ghost", () => eventFormular(v)),
      knopf(v.aktuell ? "Von Startseite nehmen" : "Auf Startseite", v.aktuell ? "btn-ghost" : "btn-gold", async () => {
        const { error } = await sb.from("veranstaltungen").update({ aktuell: !v.aktuell }).eq("id", v.id);
        if (error) alert("Das hat nicht geklappt.");
        ladeEvents();
      }),
      knopf("Löschen", "btn-ghost", async () => {
        if (!confirm(`„${v.titel}“ wirklich löschen? Sie verschwindet dann auch aus dem Archiv.`)) return;
        const { error } = await sb.from("veranstaltungen").delete().eq("id", v.id);
        if (error) return alert("Das hat nicht geklappt.");
        await dateienLoeschen([v.bild, v.video]);
        if (eventAlt?.id === v.id) eventFormular();
        ladeEvents();
      })
    );
    tr.append(
      el("td", datumDe(v.datum)),
      titel,
      el("td", v.video ? "Video" : v.bild ? "Bild" : "–"),
      el("td", startseite[0], startseite[1]),
      td
    );
    tbody.append(tr);
  });
}

$("#event-abbrechen").addEventListener("click", () => eventFormular());

eventForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const datei = f.medien.files[0];
  if (datei && !MEDIEN[datei.type]) {
    status(f, "Bitte ein Bild (JPG, PNG, WebP) oder Video (MP4, WebM) auswählen.", "error");
    return;
  }
  if (datei && datei.size > 50 * 1024 * 1024) {
    status(f, "Die Datei ist größer als 50 MB. Bitte verkleinern oder ein kürzeres Video wählen.", "error");
    return;
  }

  let bild = eventAlt?.bild || null;
  let video = eventAlt?.video || null;
  const alteDateien = [];
  if (f.medien_entfernen.checked || datei) {
    alteDateien.push(bild, video);
    bild = video = null;
  }

  let neueDatei = null;
  if (datei) {
    status(f, "Datei wird hochgeladen …", "info");
    neueDatei = `${crypto.randomUUID()}.${MEDIEN[datei.type]}`;
    const { error } = await speicher().upload(neueDatei, datei, { contentType: datei.type, cacheControl: "31536000" });
    if (error) {
      console.error(error);
      status(f, "Das Hochladen hat nicht geklappt. Bitte versuche es noch einmal.", "error");
      return;
    }
    if (datei.type.startsWith("video/")) video = neueDatei;
    else bild = neueDatei;
  }

  status(f, "Wird gespeichert …", "info");
  const neu = {
    datum: f.datum.value,
    titel: f.titel.value.trim(),
    ort: f.ort.value.trim() || null,
    text: f.text.value.trim(),
    mehr: f.mehr.value.trim() || null,
    bild,
    video,
    aktuell: f.aktuell.checked,
  };
  const tabelle = sb.from("veranstaltungen");
  const { error } = eventAlt
    ? await tabelle.update(neu).eq("id", eventAlt.id)
    : await tabelle.insert(neu);
  if (error) {
    console.error(error);
    await dateienLoeschen([neueDatei]);
    status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
    return;
  }
  await dateienLoeschen(alteDateien);
  eventFormular();
  status(f, "Gespeichert. Ob sie auf der Startseite steht, siehst du unten in der Liste.", "success");
  ladeEvents();
});

// ---------- Vorstand: Jahresberichte ----------
const berichtForm = $("#bericht-form");
const berichtSpeicher = () => sb.storage.from("jahresberichte");
let berichtAlt = null;   // Jahresbericht, der gerade bearbeitet wird (null = neuer)

function berichtFormular(b = null) {
  berichtAlt = b;
  berichtForm.reset();
  $("#bericht-titel").textContent = b ? `Jahresbericht ${b.jahr} bearbeiten` : "Neuer Jahresbericht";
  $("#bericht-abbrechen").hidden = !b;
  $("#j-datei-aktuell").hidden = !b;
  $("#j-datei-pflicht").hidden = !!b;
  status(berichtForm, "", "info");
  if (b) {
    berichtForm.jahr.value = b.jahr;
    berichtForm.titel.value = b.titel || "";
    berichtForm.text.value = b.text || "";
    berichtForm.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    berichtForm.jahr.value = new Date().getFullYear() - 1;   // meist geht es um das Vorjahr
  }
}

const berichtDateienLoeschen = async (pfade) => {
  const weg = pfade.filter(Boolean);
  if (!weg.length) return;
  const { error } = await berichtSpeicher().remove(weg);
  if (error) console.error(error);
};

async function ladeBerichte() {
  if (!berichtAlt && !berichtForm.jahr.value) berichtFormular();
  const { data, error } = await sb.from("jahresberichte").select("*").order("jahr", { ascending: false });
  const tbody = $("#berichte-liste");
  tbody.replaceChildren();
  if (error) {
    console.error(error);
    return leereZeile(tbody, "Die Jahresberichte konnten nicht geladen werden.", 4);
  }
  if (!data.length) leereZeile(tbody, "Noch keine Jahresberichte eingetragen.", 4);
  // Der Speicher ist privat: zeitlich begrenzte Links (1 Stunde) für die PDFs holen
  const { data: links } = data.length
    ? await berichtSpeicher().createSignedUrls(data.map((b) => b.datei), 3600)
    : { data: [] };
  data.forEach((b) => {
    const tr = document.createElement("tr");
    const titel = el("td", b.titel || `Jahresbericht ${b.jahr}`);
    if (b.text) titel.append(el("div", b.text, "muted"));
    const pdf = document.createElement("td");
    const link = el("a", "Öffnen");
    link.href = links?.find((l) => l.path === b.datei)?.signedUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";
    pdf.append(link);
    const td = document.createElement("td");
    td.className = "actions";
    td.append(
      knopf("Bearbeiten", "btn-ghost", () => berichtFormular(b)),
      knopf("Löschen", "btn-ghost", async () => {
        if (!confirm(`Jahresbericht ${b.jahr} wirklich löschen? Er verschwindet dann auch aus dem Archiv.`)) return;
        const { error } = await sb.from("jahresberichte").delete().eq("id", b.id);
        if (error) return alert("Das hat nicht geklappt.");
        await berichtDateienLoeschen([b.datei]);
        if (berichtAlt?.id === b.id) berichtFormular();
        ladeBerichte();
      })
    );
    tr.append(el("td", String(b.jahr)), titel, pdf, td);
    tbody.append(tr);
  });
}

$("#bericht-abbrechen").addEventListener("click", () => berichtFormular());

berichtForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const jahr = Number(f.jahr.value);
  const datei = f.datei.files[0];

  if (!Number.isInteger(jahr) || jahr < 1900 || jahr > 2100) {
    status(f, "Bitte ein gültiges Jahr eingeben.", "error");
    return;
  }
  if (!berichtAlt && !datei) {
    status(f, "Bitte wähle die PDF-Datei aus.", "error");
    return;
  }
  if (datei && datei.type !== "application/pdf") {
    status(f, "Bitte nur PDF-Dateien hochladen.", "error");
    return;
  }
  if (datei && datei.size > 50 * 1024 * 1024) {
    status(f, "Die Datei ist größer als 50 MB. Bitte verkleinere das PDF.", "error");
    return;
  }

  // Pro Jahr nur ein Bericht
  if (!berichtAlt || berichtAlt.jahr !== jahr) {
    const { data: schon } = await sb.from("jahresberichte").select("id").eq("jahr", jahr).maybeSingle();
    if (schon) {
      status(f, `Für ${jahr} gibt es schon einen Jahresbericht. Bearbeite ihn unten in der Liste, um das PDF zu ersetzen.`, "error");
      return;
    }
  }

  let pfad = berichtAlt?.datei || null;
  let neueDatei = null;
  if (datei) {
    status(f, "PDF wird hochgeladen …", "info");
    neueDatei = `${jahr}-${crypto.randomUUID()}.pdf`;
    const { error } = await berichtSpeicher().upload(neueDatei, datei, { contentType: "application/pdf", cacheControl: "31536000" });
    if (error) {
      console.error(error);
      status(f, "Das Hochladen hat nicht geklappt. Bitte versuche es noch einmal.", "error");
      return;
    }
    pfad = neueDatei;
  }

  status(f, "Wird gespeichert …", "info");
  const neu = { jahr, titel: f.titel.value.trim() || null, text: f.text.value.trim() || null, datei: pfad };
  const tabelle = sb.from("jahresberichte");
  const { error } = berichtAlt
    ? await tabelle.update(neu).eq("id", berichtAlt.id)
    : await tabelle.insert(neu);
  if (error) {
    console.error(error);
    await berichtDateienLoeschen([neueDatei]);
    status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
    return;
  }
  if (neueDatei && berichtAlt?.datei) await berichtDateienLoeschen([berichtAlt.datei]);
  berichtFormular();
  status(f, "Gespeichert – der Jahresbericht steht jetzt im Archiv.", "success");
  ladeBerichte();
});

// ---------- Vorstand: Fotoarchiv (Freigaben + Abiturjahrgänge) ----------
const fotoSpeicher = () => sb.storage.from("fotoarchiv");
const KATEGORIE_NAME = { abiturfeier: "Abiturfeier", abiturfahrt: "Abiturfahrt", sonstiges: "Sonstiges" };
const jahrgangForm = $("#jahrgang-form");
let jahrgangAlt = null;

async function fotoLinks(pfade) {
  const liste = [...new Set(pfade.filter(Boolean))];
  if (!liste.length) return new Map();
  const { data } = await fotoSpeicher().createSignedUrls(liste, 3600);
  return new Map((data || []).filter((l) => l.signedUrl).map((l) => [l.path, l.signedUrl]));
}

// Anzahl wartender Fotos im Reiter anzeigen, z. B. „Fotoarchiv (3)“
async function zaehleWartendeFotos() {
  const { count } = await sb.from("fotos").select("id", { count: "exact", head: true }).eq("freigegeben", false);
  $("#tab-fotoarchiv-vorstand").textContent = count ? `Fotoarchiv (${count})` : "Fotoarchiv";
}

async function ladeFotoVerwaltung() {
  await Promise.all([ladeFreigaben(), ladeJahrgaenge()]);
}

async function ladeFreigaben() {
  const box = $("#fa-freigaben");
  const { data, error } = await sb
    .from("fotos")
    .select("id, created_at, jahrgang, kategorie, datei, mitglieder(vorname, nachname)")
    .eq("freigegeben", false)
    .order("created_at", { ascending: true });
  box.replaceChildren();
  zaehleWartendeFotos();
  if (error) {
    console.error(error);
    box.append(el("p", "Die Fotos konnten nicht geladen werden.", "muted"));
    return;
  }
  $("#fa-alle-freigeben").hidden = data.length < 2;
  if (!data.length) {
    box.append(el("p", "Keine Fotos warten auf Freigabe.", "muted"));
    return;
  }
  const url = await fotoLinks(data.map((f) => f.datei));
  data.forEach((f) => {
    const karte = el("figure", null, "fa-freigabe");
    const bild = el("a");
    bild.href = url.get(f.datei) || "#";
    bild.target = "_blank";
    bild.rel = "noopener";
    const img = el("img");
    img.src = url.get(f.datei) || "";
    img.alt = "";
    img.loading = "lazy";
    bild.append(img);
    const text = el("figcaption");
    const wer = f.mitglieder ? [f.mitglieder.vorname, f.mitglieder.nachname].filter(Boolean).join(" ") : "Unbekannt";
    text.append(
      el("strong", `Abitur ${f.jahrgang} · ${KATEGORIE_NAME[f.kategorie]}`),
      el("span", `von ${wer}, ${datumDe(f.created_at.slice(0, 10))}`, "muted")
    );
    const aktionen = el("div", null, "actions");
    aktionen.append(
      knopf("Freigeben", "btn-gold", async () => {
        const { error } = await sb.from("fotos").update({ freigegeben: true }).eq("id", f.id);
        if (error) return alert("Das hat nicht geklappt.");
        ladeFreigaben();
      }),
      knopf("Ablehnen", "btn-ghost", async () => {
        if (!confirm("Dieses Foto ablehnen und löschen?")) return;
        const { error } = await sb.from("fotos").delete().eq("id", f.id);
        if (error) return alert("Das hat nicht geklappt.");
        await fotoSpeicher().remove([f.datei]);
        ladeFreigaben();
      })
    );
    text.append(aktionen);
    karte.append(bild, text);
    box.append(karte);
  });
}

$("#fa-alle-freigeben").addEventListener("click", async () => {
  if (!confirm("Alle wartenden Fotos freigeben?")) return;
  const { error } = await sb.from("fotos").update({ freigegeben: true }).eq("freigegeben", false);
  if (error) return alert("Das hat nicht geklappt.");
  ladeFreigaben();
});

function jahrgangFormular(j = null) {
  jahrgangAlt = j;
  jahrgangForm.reset();
  $("#jahrgang-titel").textContent = j ? `Abitur ${j.jahr}: Klassenfoto ändern` : "Neuer Abiturjahrgang";
  $("#jahrgang-abbrechen").hidden = !j;
  $("#ag-foto-aktuell").hidden = !j?.klassenfoto;
  jahrgangForm.jahr.disabled = !!j;
  jahrgangForm.jahr.value = j ? j.jahr : new Date().getFullYear();
  status(jahrgangForm, "", "info");
  if (j) jahrgangForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function ladeJahrgaenge() {
  if (!jahrgangAlt && !jahrgangForm.jahr.value) jahrgangFormular();
  const [{ data, error }, { data: fotos }] = await Promise.all([
    sb.from("abiturjahrgaenge").select("*").order("jahr", { ascending: false }),
    sb.from("fotos").select("jahrgang, freigegeben"),
  ]);
  const tbody = $("#jahrgaenge-liste");
  tbody.replaceChildren();
  if (error) {
    console.error(error);
    return leereZeile(tbody, "Die Jahrgänge konnten nicht geladen werden.", 4);
  }
  if (!data.length) leereZeile(tbody, "Noch keine Abiturjahrgänge angelegt.", 4);
  const url = await fotoLinks(data.map((j) => j.klassenfoto));
  data.forEach((j) => {
    const tr = document.createElement("tr");
    const fotoTd = document.createElement("td");
    if (url.get(j.klassenfoto)) {
      const img = el("img", null, "fa-mini");
      img.src = url.get(j.klassenfoto);
      img.alt = `Klassenfoto ${j.jahr}`;
      fotoTd.append(img);
    } else {
      fotoTd.append(el("span", "–", "muted"));
    }
    const eigene = (fotos || []).filter((f) => f.jahrgang === j.jahr);
    const wartend = eigene.filter((f) => !f.freigegeben).length;
    const anzahl = el("td", String(eigene.length - wartend));
    if (wartend) anzahl.append(el("div", `${wartend} wartend`, "muted"));
    const td = document.createElement("td");
    td.className = "actions";
    td.append(
      knopf(j.klassenfoto ? "Klassenfoto ändern" : "Klassenfoto hinzufügen", "btn-ghost", () => jahrgangFormular(j)),
      knopf("Löschen", "btn-ghost", async () => {
        if (!confirm(`Abitur ${j.jahr} mit allen ${eigene.length} Fotos wirklich löschen? Das lässt sich nicht rückgängig machen.`)) return;
        const { data: alle } = await sb.from("fotos").select("datei").eq("jahrgang", j.jahr);
        const { error } = await sb.from("abiturjahrgaenge").delete().eq("jahr", j.jahr);
        if (error) return alert("Das hat nicht geklappt.");
        const dateien = [j.klassenfoto, ...(alle || []).map((f) => f.datei)].filter(Boolean);
        for (let i = 0; i < dateien.length; i += 100) await fotoSpeicher().remove(dateien.slice(i, i + 100));
        if (jahrgangAlt?.jahr === j.jahr) jahrgangFormular();
        ladeFotoVerwaltung();
      })
    );
    tr.append(el("td", `Abitur ${j.jahr}`), fotoTd, anzahl, td);
    tbody.append(tr);
  });
}

$("#jahrgang-abbrechen").addEventListener("click", () => jahrgangFormular());

jahrgangForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const jahr = jahrgangAlt ? jahrgangAlt.jahr : Number(f.jahr.value);
  const datei = f.foto.files[0];
  if (!Number.isInteger(jahr) || jahr < 1900 || jahr > 2100) return status(f, "Bitte einen gültigen Jahrgang eingeben.", "error");
  if (jahrgangAlt && !datei) return status(f, "Bitte wähle ein neues Klassenfoto aus.", "error");
  if (datei && !datei.type.startsWith("image/")) return status(f, "Bitte ein Foto auswählen.", "error");

  if (!jahrgangAlt) {
    const { data: schon } = await sb.from("abiturjahrgaenge").select("jahr").eq("jahr", jahr).maybeSingle();
    if (schon) return status(f, `Abitur ${jahr} gibt es schon. Ändere das Klassenfoto unten in der Liste.`, "error");
  }

  let pfad = jahrgangAlt?.klassenfoto || null;
  let neu = null;
  if (datei) {
    status(f, "Klassenfoto wird hochgeladen …", "info");
    let blob;
    try {
      blob = await window.verkleinereBild(datei, 3000, 0.88);
    } catch {
      return status(f, "Das Foto konnte nicht gelesen werden. Bitte als JPG oder PNG hochladen.", "error");
    }
    neu = `klassenfotos/${jahr}-${crypto.randomUUID()}.jpg`;
    const { error } = await fotoSpeicher().upload(neu, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (error) {
      console.error(error);
      return status(f, "Das Hochladen hat nicht geklappt. Bitte versuche es noch einmal.", "error");
    }
    pfad = neu;
  }

  status(f, "Wird gespeichert …", "info");
  const tabelle = sb.from("abiturjahrgaenge");
  const { error } = jahrgangAlt
    ? await tabelle.update({ klassenfoto: pfad }).eq("jahr", jahr)
    : await tabelle.insert({ jahr, klassenfoto: pfad });
  if (error) {
    console.error(error);
    if (neu) await fotoSpeicher().remove([neu]);
    return status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
  }
  if (neu && jahrgangAlt?.klassenfoto) await fotoSpeicher().remove([jahrgangAlt.klassenfoto]);
  jahrgangFormular();
  status(f, `Gespeichert – Abitur ${jahr} steht jetzt im Fotoarchiv.`, "success");
  ladeJahrgaenge();
});

// ---------- Vorstand: Leo-Kalender (Termine am Leopoldinum) ----------
const terminForm = $("#termin-form");
let terminAlt = null;

function terminFormular(t = null) {
  terminAlt = t;
  terminForm.reset();
  $("#termin-titel").textContent = t ? "Termin bearbeiten" : "Neuer Termin";
  $("#termin-abbrechen").hidden = !t;
  status(terminForm, "", "info");
  if (t) {
    const f = terminForm;
    f.art.value = t.netzwerk ? "netzwerk" : "leopoldinum";
    f.titel.value = t.titel;
    f.datum.value = t.datum;
    f.bis.value = t.bis || "";
    f.uhrzeit.value = t.uhrzeit || "";
    f.ort.value = t.ort || "";
    f.beschreibung.value = t.beschreibung || "";
    f.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function ladeTermine() {
  const { data, error } = await sb.from("leo_termine").select("*").order("datum", { ascending: false });
  const tbody = $("#termine-liste");
  tbody.replaceChildren();
  if (error) {
    console.error(error);
    return leereZeile(tbody, "Die Termine konnten nicht geladen werden.", 4);
  }
  if (!data.length) leereZeile(tbody, "Noch keine Termine eingetragen.", 4);
  data.forEach((t) => {
    const tr = document.createElement("tr");
    const wann = el("td", datumDe(t.datum) + (t.bis && t.bis !== t.datum ? ` – ${datumDe(t.bis)}` : ""));
    const titel = el("td", t.titel);
    if (t.netzwerk) titel.append(el("div", "Netzwerk Leopoldinum", "badge badge--wait"));
    if (t.beschreibung) titel.append(el("div", t.beschreibung, "muted"));
    const td = document.createElement("td");
    td.className = "actions";
    td.append(
      knopf("Bearbeiten", "btn-ghost", () => terminFormular(t)),
      knopf("Löschen", "btn-ghost", async () => {
        if (!confirm(`„${t.titel}“ wirklich aus dem Leo-Kalender löschen?`)) return;
        const { error } = await sb.from("leo_termine").delete().eq("id", t.id);
        if (error) return alert("Das hat nicht geklappt.");
        if (terminAlt?.id === t.id) terminFormular();
        ladeTermine();
      })
    );
    tr.append(wann, titel, el("td", [t.uhrzeit, t.ort].filter(Boolean).join(" · ") || "–"), td);
    tbody.append(tr);
  });
}

$("#termin-abbrechen").addEventListener("click", () => terminFormular());

terminForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const neu = {
    netzwerk: f.art.value === "netzwerk",
    titel: f.titel.value.trim(),
    datum: f.datum.value,
    bis: f.bis.value || null,
    uhrzeit: f.uhrzeit.value.trim() || null,
    ort: f.ort.value.trim() || null,
    beschreibung: f.beschreibung.value.trim() || null,
  };
  if (neu.bis && neu.bis < neu.datum) return status(f, "„Bis“ darf nicht vor dem Datum liegen.", "error");
  if (neu.bis === neu.datum) neu.bis = null;

  status(f, "Wird gespeichert …", "info");
  const tabelle = sb.from("leo_termine");
  const { error } = terminAlt ? await tabelle.update(neu).eq("id", terminAlt.id) : await tabelle.insert(neu);
  if (error) {
    console.error(error);
    return status(f, "Speichern hat nicht geklappt. Bitte versuche es noch einmal.", "error");
  }
  terminFormular();
  status(f, "Gespeichert – der Termin steht jetzt im Leo-Kalender.", "success");
  ladeTermine();
});

// ---------- Vorstand: Mitgliederliste ----------
let mlDaten = [];   // alle Mitglieder inkl. Antragsdaten (mitglieder_privat)

const mlPrivat = (m) => (Array.isArray(m.mitglieder_privat) ? m.mitglieder_privat[0] : m.mitglieder_privat) || null;
const mlName = (m) => [m.vorname, m.nachname].filter(Boolean).join(" ") || "(ohne Namen)";
const euro = (n) => Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const ibanFormat = (iban) => (iban || "").replace(/(.{4})/g, "$1 ").trim();
const ibanVerdeckt = (iban) => (iban ? `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}` : "–");
const jaNein = (wert) => (wert ? "Ja" : "Nein");

async function ladeMitgliederliste() {
  const tbody = $("#ml-liste");
  const { data, error } = await sb
    .from("mitglieder")
    .select("*, mitglieder_privat(*)")
    .order("nachname", { ascending: true, nullsFirst: false });
  if (error) {
    console.error(error);
    tbody.replaceChildren();
    return leereZeile(tbody, "Die Mitgliederliste konnte nicht geladen werden.", 9);
  }
  mlDaten = data.filter((m) => (m.email || "").toLowerCase() !== INFO_KONTO);   // das Vereinskonto info@ nicht zeigen

  // Filter: nur Jahrgänge, die bei Mitgliedern tatsächlich eingetragen sind (neueste zuerst)
  const auswahl = $("#ml-jahrgang");
  const gewaehlt = auswahl.value;
  const jahre = [...new Set(mlDaten.map((m) => m.jahrgang).filter(Boolean))].sort((a, b) => b - a);
  auswahl.replaceChildren(new Option("Alle Mitglieder", ""),
    ...jahre.map((j) => new Option(`Abitur ${j} (${mlDaten.filter((m) => m.jahrgang === j).length})`, String(j))));
  if (jahre.includes(Number(gewaehlt))) auswahl.value = gewaehlt;
  zeigeMitgliederliste();
}

function mlGefiltert() {
  const suche = $("#ml-suche").value.trim().toLowerCase();
  const jahr = Number($("#ml-jahrgang").value) || null;
  const stat = $("#ml-status").value;
  return mlDaten.filter((m) => {
    if (jahr && m.jahrgang !== jahr) return false;
    if (stat === "frei" && !m.freigeschaltet) return false;
    if (stat === "wartend" && m.freigeschaltet) return false;
    if (stat === "ohne-zugang" && !(m.zugang_offen && !m.zugang_eingeladen_am)) return false;
    if (stat === "eingeladen" && !(m.zugang_offen && m.zugang_eingeladen_am)) return false;
    if (!suche) return true;
    const p = mlPrivat(m);
    return [mlName(m), m.email, p?.ort, m.stadt].filter(Boolean).join(" ").toLowerCase().includes(suche);
  });
}

function mlDetails(m) {
  const p = mlPrivat(m);
  const box = el("div", null, "ml-details");
  const gruppe = (titel, zeilen) => {
    const g = el("div", null, "ml-gruppe");
    g.append(el("h4", titel));
    const dl = document.createElement("dl");
    zeilen.forEach(([k, v]) => {
      if (v == null || v === "") v = "–";
      dl.append(el("dt", k));
      const dd = document.createElement("dd");
      if (v instanceof Node) dd.append(v); else dd.textContent = v;
      dl.append(dd);
    });
    g.append(dl);
    return g;
  };

  // IBAN zunächst verdeckt (z. B. beim Teilen des Bildschirms), per Klick sichtbar
  let iban = "–";
  if (p?.iban) {
    iban = el("span", ibanVerdeckt(p.iban));
    const zeigen = el("button", "anzeigen", "ml-zeigen");
    zeigen.type = "button";
    zeigen.addEventListener("click", () => {
      const offen = zeigen.textContent === "verbergen";
      iban.firstChild.textContent = offen ? ibanVerdeckt(p.iban) : ibanFormat(p.iban);
      zeigen.textContent = offen ? "anzeigen" : "verbergen";
    });
    iban.append(" ", zeigen);
  }

  box.append(
    gruppe("Person", [
      ["Name", mlName(m)],
      ["Geburtsdatum", p?.geburtsdatum ? datumDe(p.geburtsdatum) : null],
      ["Ich bin …", ROLLEN[m.rolle]],
      ["Abiturjahrgang", m.jahrgang],
      ["Beschäftigung / Tätigkeit", m.taetigkeit],
    ]),
    gruppe("Kontakt", [
      ["E-Mail", m.email],
      ["Telefon", m.telefon],
      ["Anschrift", p ? `${p.strasse}, ${p.plz} ${p.ort}` : null],
      ["Stadt (Profil)", m.stadt],
    ]),
    gruppe("Beitrag und SEPA", p ? [
      ["Jahresbeitrag", p.beitrag_euro != null ? euro(p.beitrag_euro) : "nicht in der Datenbank"],
      ["Kontoinhaber", p.kontoinhaber],
      ["Anschrift Kontoinhaber", p.kontoinhaber_anschrift],
      ["Kreditinstitut", p.kreditinstitut],
      ["IBAN", p.iban ? iban : "nicht in der Datenbank"],
      ["BIC", p.bic],
      ["Mandat erteilt am", p.sepa_mandat_am ? datumDe(p.sepa_mandat_am.slice(0, 10)) : null],
    ] : [["Hinweis", "Keine Antragsdaten (z. B. eingeladenes Bestandsmitglied oder Papierantrag)."]]),
    gruppe("Mitgliedschaft und Einwilligungen", [
      ["Mitglied seit", m.mitglied_seit ? datumDe(m.mitglied_seit) : null],
      ["Im System seit", datumDe(m.created_at.slice(0, 10))],
      ["Website-Zugang", !m.zugang_offen ? "Eingerichtet" + (m.zugang_aktiviert_am ? ` am ${datumDe(m.zugang_aktiviert_am.slice(0, 10))}` : "")
        : m.zugang_eingeladen_am ? `Eingeladen am ${datumDe(m.zugang_eingeladen_am.slice(0, 10))}, noch nicht eingerichtet` : "Noch nicht freigeschaltet"],
      ["Freigeschaltet", m.freigeschaltet ? (m.freigeschaltet_am ? `Ja, am ${datumDe(m.freigeschaltet_am.slice(0, 10))}` : "Ja") : "Nein, wartet"],
      ["Vorstandszugang", m.vorstandszugang ? "Ja – hat Zugang zum Vorstandsbereich" : "Nein"],
      ["Einwilligung Datenverarbeitung (Antrag)", jaNein(m.einwilligung)],
      ["Datenschutzerklärung akzeptiert", m.datenschutz_akzeptiert_am ? `Ja, am ${datumDe(m.datenschutz_akzeptiert_am.slice(0, 10))}` : "Noch nicht"],
      ["Entscheidung zur Karte", m.karte_entschieden_am ? `Getroffen am ${datumDe(m.karte_entschieden_am.slice(0, 10))}` : "Noch nicht"],
      ["Fotos und Videos", p ? jaNein(p.foto_einwilligung) : null],
      ["Auf der Mitgliederkarte", m.auf_karte ? `Ja (Kontakt: ${m.kontakt === "telefon" ? "Telefon" : "E-Mail"})` : "Nein"],
      ["Nachricht bei Anmeldung", m.nachricht],
    ])
  );
  const unten = el("div", null, "ml-details-aktionen");
  unten.append(
    knopf("Bearbeiten", "btn-gold", () => box.replaceWith(mlFormular(m))),
    knopf("Mitglied löschen", "btn-danger", () => mlLoeschenOeffnen(m))
  );
  box.append(unten);
  return box;
}

// ---------- Mitglied bearbeiten (Edge Function "mitglied-bearbeiten") ----------
function mlFormular(m) {
  const p = mlPrivat(m) || {};
  const form = document.createElement("form");
  form.className = "ml-formular";
  form.noValidate = true;
  let nr = 0;
  const feld = (name, beschriftung, wert, art = "text", optionen) => {
    const id = `mlf-${m.id.slice(0, 8)}-${++nr}`;
    const box = el("div", null, "field");
    const label = el("label", beschriftung);
    label.htmlFor = id;
    let eingabe;
    if (art === "select") {
      eingabe = document.createElement("select");
      optionen.forEach(([w, t]) => eingabe.append(new Option(t, w)));
    } else {
      eingabe = document.createElement("input");
      eingabe.type = art;
    }
    eingabe.id = id;
    eingabe.name = name;
    eingabe.value = wert ?? "";
    box.append(label, eingabe);
    return box;
  };
  const haken = (name, beschriftung, wert, hinweis) => {
    const id = `mlf-${m.id.slice(0, 8)}-${++nr}`;
    const box = el("div", null, "field field--check");
    const eingabe = document.createElement("input");
    eingabe.type = "checkbox";
    eingabe.id = id;
    eingabe.name = name;
    eingabe.checked = !!wert;
    const label = el("label", beschriftung);
    label.htmlFor = id;
    if (hinweis) label.append(el("small", " " + hinweis, "muted"));
    box.append(eingabe, label);
    return box;
  };
  const gruppe = (titel, ...felder) => {
    const g = el("fieldset", null, "ml-gruppe ml-gruppe--formular");
    g.append(el("legend", titel), ...felder);
    return g;
  };

  form.append(
    gruppe("Person",
      feld("vorname", "Vorname *", m.vorname),
      feld("nachname", "Nachname *", m.nachname),
      feld("geburtsdatum", "Geburtsdatum", p.geburtsdatum, "date"),
      feld("rolle", "Ich bin …", m.rolle, "select", [["", "–"], ...Object.entries(ROLLEN)]),
      feld("jahrgang", "Abiturjahrgang", m.jahrgang, "number"),
      feld("taetigkeit", "Beschäftigung / Tätigkeit", m.taetigkeit)),
    gruppe("Kontakt",
      feld("email", "E-Mail * (zugleich Login-Adresse)", m.email, "email"),
      feld("telefon", "Telefon", m.telefon, "tel"),
      feld("strasse", "Straße und Hausnummer", p.strasse),
      feld("plz", "PLZ", p.plz),
      feld("ort", "Ort", p.ort)),
    gruppe("Beitrag und SEPA",
      feld("beitrag_euro", "Jahresbeitrag in €", p.beitrag_euro, "text"),
      feld("kontoinhaber", "Kontoinhaber", p.kontoinhaber),
      feld("kontoinhaber_anschrift", "Anschrift Kontoinhaber", p.kontoinhaber_anschrift),
      feld("kreditinstitut", "Kreditinstitut", p.kreditinstitut),
      feld("iban", "IBAN", ibanFormat(p.iban)),
      feld("bic", "BIC", p.bic)),
    gruppe("Mitgliedschaft",
      feld("mitglied_seit", "Mitglied seit", m.mitglied_seit, "date"),
      haken("freigeschaltet", "Freigeschaltet", m.freigeschaltet, "(Zugang zu Karte, Archiv und Kalender)"),
      haken("vorstandszugang", "Vorstandszugang", m.vorstandszugang,
        "– Vereinsverwaltung: Zugang zum Vorstandsbereich mit allen Mitgliederdaten"),
      haken("einwilligung", "Einwilligung Datenverarbeitung liegt vor", m.einwilligung),
      haken("foto_einwilligung", "Foto-Einwilligung liegt vor", p.foto_einwilligung))
  );

  const aktionen = el("div", null, "ml-details-aktionen form-actions");
  const speichern = el("button", "Speichern", "btn btn-gold btn-sm");
  speichern.type = "submit";
  const abbrechen = knopf("Abbrechen", "btn-ghost", () => form.replaceWith(mlDetails(m)));
  const meldung = el("p", null, "form-status");
  aktionen.append(speichern, abbrechen, meldung);
  form.append(aktionen);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const daten = Object.fromEntries(new FormData(form));
    ["freigeschaltet", "vorstandszugang", "einwilligung", "foto_einwilligung"].forEach((n) => (daten[n] = form.elements[n].checked));
    if (daten.vorstandszugang && !m.vorstandszugang &&
      !confirm(`${mlName(m)} bekommt damit Zugang zum Vorstandsbereich – inklusive aller Mitgliederdaten und Bankverbindungen. Fortfahren?`)) return;
    if (!daten.vorstandszugang && m.vorstandszugang &&
      !confirm(`${mlName(m)} den Vorstandszugang entziehen?`)) return;
    speichern.disabled = true;
    meldung.textContent = "Wird gespeichert …";
    meldung.className = "form-status is-info";
    const { data, error } = await sb.functions.invoke("mitglied-bearbeiten", { body: { id: m.id, daten } });
    if (error || !data?.ok) {
      speichern.disabled = false;
      meldung.textContent = await funktionsFehler(error, "Speichern hat nicht geklappt.");
      meldung.className = "form-status is-error";
      return;
    }
    // Liste aktualisieren und die Details dieses Mitglieds wieder öffnen
    const i = mlDaten.findIndex((x) => x.id === m.id);
    if (i >= 0) mlDaten[i] = data.mitglied;
    zeigeMitgliederliste();
    document.querySelector(`#ml-liste tr[data-id="${m.id}"] .ml-details-knopf`)?.click();
    const anzahl = $("#ml-anzahl");
    anzahl.textContent = `Gespeichert: ${mlName(data.mitglied)}. ` + anzahl.textContent;
  });
  return form;
}

function zeigeMitgliederliste() {
  const tbody = $("#ml-liste");
  tbody.replaceChildren();
  const liste = mlGefiltert();
  const jahr = $("#ml-jahrgang").value;
  $("#ml-anzahl").textContent = `${liste.length} ${liste.length === 1 ? "Mitglied" : "Mitglieder"}` +
    (jahr ? ` im Abiturjahrgang ${jahr}` : "") + (liste.length !== mlDaten.length ? ` (von ${mlDaten.length})` : "");
  if (!liste.length) return leereZeile(tbody, mlDaten.length ? "Keine Mitglieder passen zum Filter." : "Noch keine Mitglieder.", 9);

  liste.forEach((m) => {
    const p = mlPrivat(m);
    const tr = document.createElement("tr");
    tr.dataset.id = m.id;
    const details = document.createElement("tr");
    details.className = "ml-detailzeile";
    details.hidden = true;
    const td = document.createElement("td");
    td.colSpan = 9;
    details.append(td);

    const knopfTd = document.createElement("td");
    const k = knopf("Details", "btn-ghost", () => {
      if (!td.firstChild) td.append(mlDetails(m));
      details.hidden = !details.hidden;
      k.textContent = details.hidden ? "Details" : "Schließen";
    });
    k.classList.add("ml-details-knopf");
    knopfTd.append(k);

    const nameTd = el("td", mlName(m));
    if (m.vorstandszugang) nameTd.append(" ", el("span", "Vorstand", "ml-vorstand"));
    tr.append(
      nameTd,
      el("td", m.jahrgang ? String(m.jahrgang) : "–"),
      el("td", ROLLEN[m.rolle] || "–"),
      el("td", m.email),
      el("td", p?.ort || m.stadt || "–"),
      el("td", datumDe(m.mitglied_seit || m.created_at.slice(0, 10))),
      el("td", m.freigeschaltet ? "Freigeschaltet" : "Wartet", m.freigeschaltet ? "badge badge--ok" : "badge badge--wait"),
      mlZugangZelle(m),
      knopfTd
    );
    tbody.append(tr, details);
  });
}

// Spalte „Website-Zugang“: Status und Button zum Freischalten (Edge Function "zugang-freischalten")
function mlZugangZelle(m) {
  const td = el("td", null, "ml-zugang");
  if (!m.zugang_offen) {
    td.append(el("span", "Eingerichtet", "badge badge--ok"));
    return td;
  }
  if (m.zugang_eingeladen_am) td.append(el("div", `Eingeladen am ${datumDe(m.zugang_eingeladen_am.slice(0, 10))}`, "muted"));
  const k = knopf(m.zugang_eingeladen_am ? "Erneut senden" : "Website-Zugang freischalten",
    m.zugang_eingeladen_am ? "btn-ghost" : "btn-gold", async () => {
      const erneut = !!m.zugang_eingeladen_am;
      if (!confirm(`${erneut ? "Neue Einladung" : "Einladung"} an ${mlName(m)} (${m.email}) senden?` +
        (erneut ? "\nDer bisherige Link wird damit ungültig." : ""))) return;
      k.disabled = true;
      k.textContent = "Wird gesendet …";
      const { data, error } = await sb.functions.invoke("zugang-freischalten", { body: { id: m.id } });
      if (error || !data?.ok) {
        alert(await funktionsFehler(error, "Die Einladung konnte nicht verschickt werden."));
        k.disabled = false;
        k.textContent = erneut ? "Erneut senden" : "Website-Zugang freischalten";
        return;
      }
      m.zugang_eingeladen_am = new Date().toISOString();
      td.replaceWith(mlZugangZelle(m));
    });
  td.append(k);
  return td;
}

["#ml-suche", "#ml-jahrgang", "#ml-status"].forEach((sel) => $(sel).addEventListener("input", zeigeMitgliederliste));

// CSV (für Excel: Semikolon und UTF-8 mit BOM)
function mlCsv(liste, dateiname) {
  const spalten = ["Vorname", "Nachname", "E-Mail", "Telefon", "Geburtsdatum", "Straße", "PLZ", "Ort", "Ich bin",
    "Abiturjahrgang", "Beschäftigung", "Jahresbeitrag", "Kontoinhaber", "Anschrift Kontoinhaber", "Kreditinstitut",
    "IBAN", "BIC", "SEPA-Mandat am", "Mitglied seit", "Im System seit", "Freigeschaltet", "Website-Zugang", "Foto-Einwilligung", "Auf der Karte"];
  const zeilen = liste.map((m) => {
    const p = mlPrivat(m) || {};
    return [m.vorname, m.nachname, m.email, m.telefon, p.geburtsdatum && datumDe(p.geburtsdatum), p.strasse, p.plz, p.ort,
      ROLLEN[m.rolle], m.jahrgang, m.taetigkeit, p.beitrag_euro != null ? String(p.beitrag_euro).replace(".", ",") : "",
      p.kontoinhaber, p.kontoinhaber_anschrift, p.kreditinstitut, p.iban, p.bic,
      p.sepa_mandat_am && datumDe(p.sepa_mandat_am.slice(0, 10)), m.mitglied_seit && datumDe(m.mitglied_seit),
      datumDe(m.created_at.slice(0, 10)), jaNein(m.freigeschaltet),
      !m.zugang_offen ? "eingerichtet" : m.zugang_eingeladen_am ? "eingeladen" : "noch nicht freigeschaltet", p.foto_einwilligung == null ? "" : jaNein(p.foto_einwilligung), jaNein(m.auf_karte)];
  });
  const zelle = (v) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\ufeff" + [spalten, ...zeilen].map((z) => z.map(zelle).join(";")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = dateiname;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const heuteIso = () => new Date().toISOString().slice(0, 10);

// Export der aktuell gefilterten Liste
$("#ml-csv").addEventListener("click", () => {
  const jahr = $("#ml-jahrgang").value;
  mlCsv(mlGefiltert(), `mitgliederliste${jahr ? "-abitur-" + jahr : ""}-${heuteIso()}.csv`);
});

// ---------- Mitglied endgültig löschen (Edge Function "mitglied-loeschen") ----------
const loeschDialog = $("#ml-loeschen-dialog");
const loeschForm = $("#ml-loeschen-form");
let mlZuLoeschen = null;
const dateiName = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");

function mlLoeschenOeffnen(m) {
  mlZuLoeschen = m;
  loeschForm.reset();
  status(loeschForm, "", "info");
  $("#ml-loeschen-name").textContent = `${mlName(m)} (${m.email})`;
  $("#ml-bestaetigung-soll").textContent = mlName(m);
  loeschForm.querySelector('[type="submit"]').disabled = false;
  loeschDialog.showModal();
}

$("#ml-loeschen-abbrechen").addEventListener("click", () => loeschDialog.close());

loeschForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const m = mlZuLoeschen;
  if (!m) return;
  if (loeschForm.bestaetigung.value.trim() !== mlName(m)) {
    return status(loeschForm, "Der eingegebene Name stimmt nicht überein.", "error");
  }
  const knopfLoeschen = loeschForm.querySelector('[type="submit"]');
  knopfLoeschen.disabled = true;
  if (loeschForm.sichern.checked) mlCsv([m], `mitglied-${dateiName(mlName(m))}-geloescht-${heuteIso()}.csv`);

  status(loeschForm, "Wird gelöscht …", "info");
  const { data, error } = await sb.functions.invoke("mitglied-loeschen", { body: { id: m.id } });
  if (error || !data?.ok) {
    let meldung = "Das Löschen hat nicht geklappt. Bitte versuche es noch einmal.";
    try {
      meldung = (await error?.context?.json())?.fehler || meldung;
    } catch {}
    console.error(error);
    knopfLoeschen.disabled = false;
    return status(loeschForm, meldung, "error");
  }
  loeschDialog.close();
  mlZuLoeschen = null;
  await ladeMitgliederliste();
  $("#ml-anzahl").textContent = `${mlName(m)} wurde gelöscht. ` + $("#ml-anzahl").textContent;
});

start();
