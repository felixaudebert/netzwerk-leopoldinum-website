// Netzwerk Leopoldinum – Verbindung zu Supabase
// Werte aus dem Supabase-Dashboard: Project Settings → API
// (bzw. "Connect" oben im Dashboard). Nur den öffentlichen "anon"/"publishable"
// Schlüssel eintragen – NIEMALS den "service_role"/"secret" Schlüssel.

window.SUPABASE_CONFIG = {
  url: "https://DEIN-PROJEKT.supabase.co",
  anonKey: "DEIN-ANON-KEY",
};
