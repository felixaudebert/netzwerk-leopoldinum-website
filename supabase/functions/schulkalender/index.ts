// Netzwerk Leopoldinum – Ferien und Feiertage des laufenden bayerischen Schuljahrs (für den Leo-Kalender)
// Quelle: OpenHolidays API (openholidaysapi.org). Die Webseite fragt nur diese Funktion –
// so bekommt kein fremder Dienst die IP-Adressen der Mitglieder.
// Öffentliche Daten, daher ohne Login: supabase functions deploy schulkalender --no-verify-jwt
//
// Aufruf: GET …/functions/v1/schulkalender            → laufendes Schuljahr
//         GET …/functions/v1/schulkalender?start=2027 → Schuljahr 2027/28

const API = "https://openholidaysapi.org";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Eintrag = { startDate: string; endDate: string; name: { language: string; text: string }[]; regionalScope?: string };

// Bayerisches Schuljahr: 1. August bis 31. Juli
function schuljahrStart(heute: Date) {
  const jahr = heute.getFullYear();
  return heute.getMonth() >= 7 ? jahr : jahr - 1;   // Monat 7 = August
}

async function hole(pfad: string, von: string, bis: string): Promise<Eintrag[]> {
  const url = `${API}/${pfad}?countryIsoCode=DE&subdivisionCode=DE-BY&languageIsoCode=DE&validFrom=${von}&validTo=${bis}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${pfad}: ${res.status}`);
  return await res.json();
}

const name = (e: Eintrag) => e.name.find((n) => n.language === "DE")?.text ?? e.name[0]?.text ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const angefragt = Number(new URL(req.url).searchParams.get("start"));
  const start = Number.isInteger(angefragt) && angefragt >= 2000 && angefragt <= 2100
    ? angefragt
    : schuljahrStart(new Date());
  const von = `${start}-08-01`;
  const bis = `${start + 1}-07-31`;

  try {
    const [ferien, feiertage] = await Promise.all([
      hole("SchoolHolidays", von, bis),
      hole("PublicHolidays", von, bis),
    ]);
    const antwort = {
      schuljahr: `${start}/${String(start + 1).slice(2)}`,
      von,
      bis,
      ferien: ferien.map((e) => ({ name: name(e), von: e.startDate, bis: e.endDate })),
      // "Local" = nur einzelne Orte (z. B. Augsburger Friedensfest) – gilt nicht in Passau
      feiertage: feiertage
        .filter((e) => e.regionalScope !== "Local")
        .map((e) => ({ name: name(e), datum: e.startDate })),
      quelle: "OpenHolidays API (openholidaysapi.org)",
    };
    return new Response(JSON.stringify(antwort), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" },
    });
  } catch (fehler) {
    console.error(fehler);
    return new Response(JSON.stringify({ fehler: "Ferien und Feiertage konnten nicht geladen werden." }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
