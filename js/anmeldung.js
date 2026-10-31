// Netzwerk Leopoldinum – Mitgliedsantrag mit SEPA-Mandat → Konto in Supabase anlegen

const form = document.getElementById("anmelde-form");
const status = document.getElementById("anmelde-status");
const f = form.elements;

const showStatus = (text, type) => {
  status.textContent = text;
  status.className = "form-status is-" + type;
};

// ---------- Hilfen ----------
function alterAm(geburtsdatum, stichtag = new Date()) {
  const g = new Date(geburtsdatum);
  let a = stichtag.getFullYear() - g.getFullYear();
  const m = stichtag.getMonth() - g.getMonth();
  if (m < 0 || (m === 0 && stichtag.getDate() < g.getDate())) a--;
  return a;
}

const mindestbeitrag = (alter) => (alter <= 30 ? 5 : 25);

// IBAN-Prüfziffer (Modulo 97)
function ibanGueltig(iban) {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const umgestellt = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rest = 0;
  for (const ziffer of umgestellt) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

// ---------- Vorausfüllen ----------
let anschriftGeaendert = false;
let inhaberGeaendert = false;
f.kontoinhaber_anschrift.addEventListener("input", () => (anschriftGeaendert = true));
f.kontoinhaber.addEventListener("input", () => (inhaberGeaendert = true));

function vorausfuellen() {
  if (!inhaberGeaendert) {
    f.kontoinhaber.value = [f.vorname.value.trim(), f.nachname.value.trim()].filter(Boolean).join(" ");
  }
  if (!anschriftGeaendert) {
    const ort = [f.plz.value.trim(), f.ort.value.trim()].filter(Boolean).join(" ");
    f.kontoinhaber_anschrift.value = [f.strasse.value.trim(), ort].filter(Boolean).join(", ");
  }
}
["vorname", "nachname", "strasse", "plz", "ort"].forEach((n) => f[n].addEventListener("input", vorausfuellen));

f.geburtsdatum.addEventListener("change", () => {
  const hinweis = document.getElementById("beitrag-hinweis");
  if (!f.geburtsdatum.value) return (hinweis.textContent = "");
  const min = mindestbeitrag(alterAm(f.geburtsdatum.value));
  f.beitrag.min = min;
  if (!f.beitrag.value) f.beitrag.value = min;
  hinweis.textContent = `Dein Mindestbeitrag: ${min} € pro Jahr`;
});

f.iban.addEventListener("blur", () => {
  const s = f.iban.value.replace(/\s/g, "").toUpperCase();
  f.iban.value = s.replace(/(.{4})/g, "$1 ").trim();
  f.iban.setCustomValidity(s && !ibanGueltig(s) ? "Diese IBAN ist ungültig. Bitte prüfe sie noch einmal." : "");
});

// ---------- Absenden ----------
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);

  // Spam-Schutz: verstecktes Feld, das nur Bots ausfüllen
  if (data.get("website")) return;

  const alter = alterAm(data.get("geburtsdatum"));
  if (alter < 16) {
    showStatus("Eine Mitgliedschaft ist ab 16 Jahren möglich.", "error");
    return;
  }
  if (Number(data.get("beitrag")) < mindestbeitrag(alter)) {
    showStatus(`Der Mindestbeitrag für dich beträgt ${mindestbeitrag(alter)} € pro Jahr.`, "error");
    return;
  }
  if (!ibanGueltig(data.get("iban"))) {
    showStatus("Die IBAN ist ungültig. Bitte prüfe sie noch einmal.", "error");
    return;
  }
  if (data.get("passwort") !== data.get("passwort2")) {
    showStatus("Die beiden Passwörter stimmen nicht überein.", "error");
    return;
  }

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  showStatus("Wird gesendet …", "info");

  const text = (name) => data.get(name).trim();
  const { error } = await window.sb.auth.signUp({
    email: text("email"),
    password: data.get("passwort"),
    options: {
      emailRedirectTo: new URL("mitglieder.html", location.href).href,
      data: {
        vorname: text("vorname"),
        nachname: text("nachname"),
        geburtsdatum: data.get("geburtsdatum"),
        rolle: data.get("rolle"),
        strasse: text("strasse"),
        plz: text("plz"),
        ort: text("ort"),
        jahrgang: data.get("jahrgang") || null,
        beschaeftigung: text("beschaeftigung") || null,
        beitrag_euro: Number(data.get("beitrag")),
        kontoinhaber: text("kontoinhaber"),
        kontoinhaber_anschrift: text("kontoinhaber_anschrift"),
        kreditinstitut: text("kreditinstitut"),
        bic: text("bic") || null,
        iban: data.get("iban").replace(/\s/g, "").toUpperCase(),
        sepa_mandat: data.get("sepa_mandat") === "on",
        einwilligung: data.get("einwilligung") === "on",
        foto_einwilligung: data.get("foto_einwilligung") === "on",
        nachricht: text("nachricht") || null,
      },
    },
  });

  button.disabled = false;
  if (error) {
    console.error("Antrag fehlgeschlagen:", error);
    showStatus(
      error.message.includes("Password")
        ? "Das Passwort ist zu schwach. Bitte nimm mindestens 8 Zeichen."
        : "Leider hat das nicht geklappt. Bitte prüfe deine Angaben oder schreib uns an info@netzwerk-leopoldinum.de.",
      "error"
    );
    return;
  }
  form.reset();
  anschriftGeaendert = inhaberGeaendert = false;
  showStatus(
    "Danke für deinen Mitgliedsantrag! Bitte bestätige jetzt deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich im Mitgliederbereich einloggen – der Vorstand schaltet dich dort frei.",
    "success"
  );
});
