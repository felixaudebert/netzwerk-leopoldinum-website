// Netzwerk Leopoldinum – Anmeldeformular → Supabase

const form = document.getElementById("anmelde-form");
const status = document.getElementById("anmelde-status");
const { url, anonKey } = window.SUPABASE_CONFIG || {};

const showStatus = (text, type) => {
  status.textContent = text;
  status.className = "form-status is-" + type;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);

  // Spam-Schutz: verstecktes Feld, das nur Bots ausfüllen
  if (data.get("website")) return;

  if (!url || url.includes("DEIN-PROJEKT")) {
    showStatus("Das Formular ist noch nicht mit der Datenbank verbunden (js/config.js).", "error");
    return;
  }

  const eintrag = {
    vorname: data.get("vorname").trim(),
    nachname: data.get("nachname").trim(),
    email: data.get("email").trim(),
    rolle: data.get("rolle"),
    jahrgang: data.get("jahrgang") ? Number(data.get("jahrgang")) : null,
    nachricht: data.get("nachricht").trim() || null,
    einwilligung: data.get("einwilligung") === "on",
  };

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  showStatus("Wird gesendet …", "info");

  try {
    const res = await fetch(url + "/rest/v1/anmeldungen", {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: "Bearer " + anonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(eintrag),
    });
    if (!res.ok) throw new Error(await res.text());
    form.reset();
    showStatus("Danke für deine Anmeldung! Wir melden uns bei dir.", "success");
  } catch (err) {
    console.error("Anmeldung fehlgeschlagen:", err);
    showStatus("Leider hat das nicht geklappt. Bitte versuche es später noch einmal.", "error");
  } finally {
    button.disabled = false;
  }
});
