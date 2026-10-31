// Netzwerk Leopoldinum – gemeinsame Supabase-Verbindung (Login + Datenbank)

// Link-Typ aus E-Mails (Einladung, Passwort zurücksetzen) merken, bevor Supabase ihn aus der Adresse entfernt
window.AUTH_LINK_TYP = new URLSearchParams(location.hash.slice(1)).get("type");

const { url, anonKey } = window.SUPABASE_CONFIG;
window.sb = window.supabase.createClient(url, anonKey);
