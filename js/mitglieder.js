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

let ich = null;        // eigener Eintrag aus "mitglieder"
let karte = null;      // Leaflet-Karte
let markerLayer = null;

// ---------- Hilfen ----------
const zeigeView = (name) => {
  ["laden", "login", "passwort", "bereich"].forEach((v) => {
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
  const { data: { session } } = await sb.auth.getSession();
  if (window.AUTH_LINK_TYP === "invite" || window.AUTH_LINK_TYP === "recovery") {
    if (session) return zeigeView("passwort");
  }
  if (!session) return zeigeView("login");
  await ladeBereich();
}

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") zeigeView("passwort");
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

$("#abmelden").addEventListener("click", async () => {
  await sb.auth.signOut();
  ich = null;
  zeigeView("login");
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
  // Vorstandsrechte hat nur das Konto info@ – das entscheidet die Datenbank
  const { data: vorstand } = await sb.rpc("ist_vorstand");
  ich.vorstand = vorstand === true;
  ich.darfKarte = ich.freigeschaltet || ich.vorstand;
  zeigeView("bereich");
  $("#hallo-name").textContent = ich.vorstand ? "Vorstand" : ich.vorname || "";
  $("#hinweis-wartend").hidden = ich.darfKarte;
  $("#tab-karte").hidden = !ich.darfKarte;
  $("#tab-vorstand").hidden = !ich.vorstand;
  $('[data-tab="profil"]').hidden = ich.vorstand;
  fuelleProfil();
  zeigeTab(ich.vorstand ? "vorstand" : ich.darfKarte ? "karte" : "profil");
}

// ---------- Tabs ----------
function zeigeTab(name) {
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  if (name === "karte") ladeKarte();
  if (name === "vorstand") ladeVorstand();
}

document.querySelectorAll(".tabs [data-tab]").forEach((b) => {
  b.addEventListener("click", () => zeigeTab(b.dataset.tab));
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
}

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

  status(f, "Wird gespeichert …", "info");
  if (neu.stadt !== ich.stadt || (neu.stadt && ich.lat == null)) {
    if (neu.stadt) {
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
  ich = data;
  $("#hallo-name").textContent = ich.vorname || "";
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
  if (m.taetigkeit) box.append(el("p", m.taetigkeit));
  box.append(el("p", m.stadt, "muted"));
  const link = el("a", m.kontakt_wert);
  link.href = (m.kontakt_art === "telefon" ? "tel:" : "mailto:") + m.kontakt_wert;
  box.append(link);
  return box;
}

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
    L.marker([m.lat + dLat, m.lng + dLng]).bindPopup(popup(m)).addTo(markerLayer);
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
  // Das Vorstandskonto selbst nicht in der Liste zeigen
  const liste = data.filter((m) => m.id !== ich.id);
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
    const details = el("button", "Details", "btn btn-sm btn-ghost");
    details.type = "button";
    details.addEventListener("click", () => zeigeDetails(m, tr, details));
    td.append(details);
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

// Antragsdaten (Adresse, Beitrag, SEPA) unter der Zeile auf- und zuklappen
async function zeigeDetails(m, tr, button) {
  const offen = tr.nextElementSibling?.classList.contains("details-row");
  if (offen) {
    tr.nextElementSibling.remove();
    button.textContent = "Details";
    return;
  }
  const { data: p, error } = await sb.from("mitglieder_privat").select("*").eq("id", m.id).maybeSingle();
  const zeile = document.createElement("tr");
  zeile.className = "details-row";
  const td = document.createElement("td");
  td.colSpan = 6;
  if (error) {
    console.error(error);
    td.append(el("p", "Die Antragsdaten konnten nicht geladen werden."));
  } else if (!p) {
    td.append(el("p", "Kein Online-Antrag vorhanden (z. B. eingeladenes Bestandsmitglied).", "muted"));
  } else {
    const dl = document.createElement("dl");
    dl.className = "details";
    const eintraege = [
      ["Geburtsdatum", new Date(p.geburtsdatum).toLocaleDateString("de-DE")],
      ["Adresse", `${p.strasse}, ${p.plz} ${p.ort}`],
      ["Beschäftigung", m.taetigkeit || "–"],
      ["Jahresbeitrag", `${Number(p.beitrag_euro).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`],
      ["Kontoinhaber", `${p.kontoinhaber}, ${p.kontoinhaber_anschrift}`],
      ["IBAN", p.iban.replace(/(.{4})/g, "$1 ").trim()],
      ["Kreditinstitut / BIC", [p.kreditinstitut, p.bic].filter(Boolean).join(" / ")],
      ["SEPA-Mandat erteilt", new Date(p.sepa_mandat_am).toLocaleString("de-DE")],
      ["Foto-Einwilligung", p.foto_einwilligung ? "Ja" : "Nein"],
    ];
    eintraege.forEach(([k, v]) => dl.append(el("dt", k), el("dd", v)));
    td.append(dl);
  }
  zeile.append(td);
  tr.after(zeile);
  button.textContent = "Schließen";
}

start();
