// Netzwerk Leopoldinum – geänderte Seiten per IndexNow an Suchmaschinen melden
// IndexNow geht an Bing (und damit auch an DuckDuckGo, Ecosia, Yahoo), Yandex, Seznam, Naver u. a.
// Google nutzt IndexNow nicht – dort reicht die Sitemap in der Google Search Console.
//
// Aufruf (nach einer Änderung, sobald sie live ist):   node scripts/suchmaschinen-melden.mjs
// Der Schlüssel liegt öffentlich als <schlüssel>.txt im Hauptordner der Webseite (so verlangt es IndexNow).

import { readdirSync, readFileSync } from "node:fs";

const SEITE = "https://netzwerk-leopoldinum.de";
const schluesselDatei = readdirSync(".").find((d) => /^[0-9a-f]{32}\.txt$/.test(d));
if (!schluesselDatei) {
  console.error("Keine IndexNow-Schlüsseldatei (<32 Hex-Zeichen>.txt) im Hauptordner gefunden.");
  process.exit(1);
}
const key = readFileSync(schluesselDatei, "utf8").trim();

// Alle Adressen aus der Sitemap
const urlList = [...readFileSync("sitemap.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SEITE).host, key, keyLocation: `${SEITE}/${schluesselDatei}`, urlList }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} – ${urlList.length} Seiten gemeldet`);
console.log(res.ok ? "Erfolgreich (200/202 = angenommen)." : await res.text());
