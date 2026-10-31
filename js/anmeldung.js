// Netzwerk Leopoldinum – Formular "Mitglied werden" → Konto in Supabase anlegen

const form = document.getElementById("anmelde-form");
const status = document.getElementById("anmelde-status");

const showStatus = (text, type) => {
  status.textContent = text;
  status.className = "form-status is-" + type;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);

  // Spam-Schutz: verstecktes Feld, das nur Bots ausfüllen
  if (data.get("website")) return;

  if (data.get("passwort") !== data.get("passwort2")) {
    showStatus("Die beiden Passwörter stimmen nicht überein.", "error");
    return;
  }

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  showStatus("Wird gesendet …", "info");

  const { error } = await window.sb.auth.signUp({
    email: data.get("email").trim(),
    password: data.get("passwort"),
    options: {
      emailRedirectTo: new URL("mitglieder.html", location.href).href,
      data: {
        vorname: data.get("vorname").trim(),
        nachname: data.get("nachname").trim(),
        rolle: data.get("rolle"),
        jahrgang: data.get("jahrgang") || null,
        nachricht: data.get("nachricht").trim() || null,
        mindestens16: data.get("mindestens16") === "on",
        einwilligung: data.get("einwilligung") === "on",
      },
    },
  });

  button.disabled = false;
  if (error) {
    console.error("Anmeldung fehlgeschlagen:", error);
    showStatus(
      error.message.includes("Password")
        ? "Das Passwort ist zu schwach. Bitte nimm mindestens 8 Zeichen."
        : "Leider hat das nicht geklappt. Bitte versuche es später noch einmal.",
      "error"
    );
    return;
  }
  form.reset();
  showStatus(
    "Danke für deine Anmeldung! Bitte bestätige jetzt deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich im Mitgliederbereich einloggen – der Vorstand schaltet dich dort frei.",
    "success"
  );
});
