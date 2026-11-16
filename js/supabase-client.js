// Netzwerk Leopoldinum – gemeinsame Supabase-Verbindung (Login + Datenbank)

// Links aus E-Mails (Einladung, Bestätigung, Passwort) landen teils auf der Startseite → weiter zum Mitgliederbereich
const imMitgliederbereich = location.pathname.endsWith("mitglieder.html");
if (/access_token|error_description/.test(location.hash) && !imMitgliederbereich) {
  location.replace("mitglieder.html" + location.hash);
}

// Link-Typ aus E-Mails (Einladung, Passwort zurücksetzen) merken, bevor Supabase ihn aus der Adresse entfernt
window.AUTH_LINK_TYP = new URLSearchParams(location.hash.slice(1)).get("type");

const { url, anonKey } = window.SUPABASE_CONFIG;
window.sb = window.supabase.createClient(url, anonKey, {
  auth: { detectSessionInUrl: imMitgliederbereich },
});

// Ersteinrichtung (Datenschutz + Entscheidung zur Mitgliederkarte) noch offen? Dann zuerst dorthin.
// Die Datenbank sperrt die Inhalte ohnehin; so landet das Mitglied direkt beim richtigen Formular.
// (Nur auf den Seiten mit Mitgliederinhalten, die Startseite bleibt frei zugänglich.)
if (/(leo-kalender|veranstaltungen)\.html$/.test(location.pathname)) {
  window.sb.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return;
    const { data } = await window.sb.rpc("einrichtung_offen");
    if (data === true) location.replace("mitglieder.html");
  }).catch((e) => console.error(e));
}
