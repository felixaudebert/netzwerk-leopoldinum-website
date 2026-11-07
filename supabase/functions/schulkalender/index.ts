// Netzwerk Leopoldinum – Ferien und Feiertage eines bayerischen Schuljahrs (für den Leo-Kalender)
// Ferien: OpenHolidays API (openholidaysapi.org) – Bayern legt sie nur einige Jahre im Voraus fest.
// Feiertage: hier selbst berechnet (feste Daten + Ostern), damit sie für jedes Jahr vollständig sind.
// Die Webseite fragt nur diese Funktion – so bekommt kein fremder Dienst die IP-Adressen der Mitglieder.
// Öffentliche Daten, daher ohne Login: supabase functions deploy schulkalender --no-verify-jwt
//
// Aufruf: GET …/functions/v1/schulkalender            → laufendes Schuljahr
//         GET …/functions/v1/schulkalender?start=2027 → Schuljahr 2027/28

const API = "https://openholidaysapi.org";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Eintrag = { startDate: string; endDate: string; name: { language: string; text: string }[] };

// Bayerisches Schuljahr: 1. August bis 31. Juli
function schuljahrStart(heute: Date) {
  const jahr = heute.getFullYear();
  return heute.getMonth() >= 7 ? jahr : jahr - 1;   // Monat 7 = August
}

const iso = (j: number, m: number, t: number) => {
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.toISOString().slice(0, 10);
};

// Ostersonntag (gregorianisch, Algorithmus nach Meeus/Jones/Butcher)
function ostern(j: number) {
  const a = j % 19, b = Math.floor(j / 100), c = j % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return { monat, tag };
}

// Gesetzliche Feiertage in Bayern (wie in Passau; ohne das Augsburger Friedensfest)
function feiertageBayern(j: number) {
  const o = ostern(j);
  const plus = (tage: number) => iso(j, o.monat, o.tag + tage);
  return [
    { name: "Neujahr", datum: iso(j, 1, 1) },
    { name: "Heilige Drei Könige", datum: iso(j, 1, 6) },
    { name: "Karfreitag", datum: plus(-2) },
    { name: "Ostermontag", datum: plus(1) },
    { name: "Tag der Arbeit", datum: iso(j, 5, 1) },
    { name: "Christi Himmelfahrt", datum: plus(39) },
    { name: "Pfingstmontag", datum: plus(50) },
    { name: "Fronleichnam", datum: plus(60) },
    { name: "Mariä Himmelfahrt", datum: iso(j, 8, 15) },
    { name: "Tag der Deutschen Einheit", datum: iso(j, 10, 3) },
    { name: "Allerheiligen", datum: iso(j, 11, 1) },
    { name: "1. Weihnachtsfeiertag", datum: iso(j, 12, 25) },
    { name: "2. Weihnachtsfeiertag", datum: iso(j, 12, 26) },
  ];
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

  const feiertage = [...feiertageBayern(start), ...feiertageBayern(start + 1)]
    .filter((f) => f.datum >= von && f.datum <= bis)
    .sort((a, b) => a.datum.localeCompare(b.datum));

  let ferien: { name: string; von: string; bis: string }[] = [];
  let ferienFehler = false;
  try {
    const url = `${API}/SchoolHolidays?countryIsoCode=DE&subdivisionCode=DE-BY&languageIsoCode=DE&validFrom=${von}&validTo=${bis}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`SchoolHolidays: ${res.status}`);
    ferien = ((await res.json()) as Eintrag[]).map((e) => ({ name: name(e), von: e.startDate, bis: e.endDate }));
  } catch (fehler) {
    console.error(fehler);
    ferienFehler = true;
  }

  const antwort = {
    schuljahr: `${start}/${String(start + 1).slice(2)}`,
    von,
    bis,
    ferien,
    // Weihnachtsferien als Zeichen, dass das Ministerium die Ferien dieses Schuljahrs festgelegt hat
    ferienFestgelegt: ferien.some((f) => f.name.startsWith("Weihnachtsferien")),
    ferienFehler,
    feiertage,
    quelle: "Ferien: OpenHolidays API (openholidaysapi.org); Feiertage: berechnet",
  };
  return new Response(JSON.stringify(antwort), {
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": ferienFehler ? "no-store" : "public, max-age=21600",
    },
  });
});
