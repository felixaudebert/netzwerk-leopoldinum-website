// Netzwerk Leopoldinum – kleine Interaktionen

// Mobiles Menü
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("site-nav");

toggle.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!open));
  nav.classList.toggle("is-open", !open);
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  });
});

// Eingeloggt? Dann statt der öffentlichen Reiter nur Karte, Leo Kalender und Archiv zeigen.
// Supabase merkt sich die Anmeldung im Browser unter "sb-<projekt>-auth-token".
window.navAktualisieren = () => {
  let eingeloggt = false;
  try {
    eingeloggt = Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k));
  } catch {}
  nav.querySelectorAll("[data-nav]").forEach((a) => {
    a.hidden = (a.dataset.nav === "mitglied") !== eingeloggt;
  });
  // z. B. für die Schlösser an „Jahresberichte“/„Fotoarchiv“ im Archiv (nur für Gäste sichtbar)
  document.documentElement.classList.toggle("ist-eingeloggt", eingeloggt);
  // Das Vorstandskonto hat kein eigenes Profil (setzt mitglieder.js)
  if (window.navOhneProfil) {
    nav.querySelectorAll('a[href="mitglieder.html#profil"]').forEach((a) => (a.hidden = true));
  }
};
window.navAktualisieren();

// „Abmelden“ im Header – auf jeder Seite, für Mitglieder und Vorstand
nav.querySelectorAll("[data-abmelden]").forEach((knopf) => {
  knopf.addEventListener("click", async () => {
    knopf.disabled = true;
    try {
      if (window.sb) await window.sb.auth.signOut();
    } catch (e) {
      console.error(e);
    }
    // Seiten ohne Supabase-Verbindung (Impressum, Datenschutz): Anmeldung im Browser löschen
    try {
      Object.keys(localStorage).filter((k) => /^sb-.+-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch {}
    window.navOhneProfil = false;
    location.href = "index.html";
  });
});

// Header-Schatten beim Scrollen
const header = document.querySelector(".site-header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Abschnitte beim Scrollen einblenden; goldene Linien der Überschriften
// zeichnen sich, sobald man dorthin scrollt
const beobachter = (klasse, optionen) => {
  if (!("IntersectionObserver" in window)) return (el) => el.classList.add(klasse);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add(klasse);
        io.unobserve(entry.target);
      }
    });
  }, optionen);
  return (el) => io.observe(el);
};
const einblenden = beobachter("is-visible", { threshold: 0.12 });
const zeichnen = beobachter("is-drawn", { rootMargin: "0px 0px -15% 0px" });
if ("IntersectionObserver" in window) document.documentElement.classList.add("lines-animate");

// Auch für Inhalte, die erst nachträglich eingefügt werden (z. B. Veranstaltungen)
window.beimScrollenZeigen = (root = document) => {
  root.querySelectorAll(".reveal").forEach(einblenden);
  root.querySelectorAll(".gold-line").forEach(zeichnen);
};
window.beimScrollenZeigen();

// Säulen: je eine Portalhälfte fährt von der Seite ein, sobald die Säule
// in der Bildschirmmitte steht, und bleibt beim Weiterscrollen stehen
const panels = document.querySelectorAll(".pillar-panel");
if (panels.length) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const update = () => {
    const vh = window.innerHeight;
    panels.forEach((panel) => {
      const portal = panel.querySelector(".pillar-portal");
      let p = 1;
      if (!still.matches) {
        // Nur von unten kommend einfahren; ist die Säule erreicht, bleibt das Portal stehen
        const r = panel.getBoundingClientRect();
        const offset = Math.max(0, r.top + r.height / 2 - vh / 2);
        const t = Math.min(1, Math.max(0, 1 - (offset - vh * 0.1) / (vh * 0.5)));
        p = t * t * (3 - 2 * t);   // weicher Übergang
      }
      portal.style.setProperty("--p", p.toFixed(3));
    });
  };

  let ticking = false;
  const request = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  };

  // Sichtbare Breite der Portalhälfte merken, damit der Text daneben mittig steht
  const messen = () => panels.forEach((panel) => {
    panel.style.setProperty("--portal-w", panel.querySelector(".pillar-portal").offsetWidth / 2 + "px");
  });

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", () => { messen(); request(); });
  messen();
  update();
}

// Aktiven Menüpunkt markieren
const navLinks = [...nav.querySelectorAll('a[href^="#"]:not(.btn)')];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
const spy = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navLinks.forEach((a) =>
      a.classList.toggle("is-active", a.getAttribute("href") === "#" + entry.target.id)
    );
  });
}, { rootMargin: "-45% 0px -50% 0px" });
sections.forEach((s) => s && spy.observe(s));

// Jahr im Footer
document.getElementById("year").textContent = new Date().getFullYear();

// Archiv-Seite: Reiter Veranstaltungen / Jahresberichte / Fotoarchiv
// (auch direkt verlinkbar, z. B. veranstaltungen.html#fotoarchiv)
const archivTabs = document.querySelectorAll("[data-archiv-tab]");
if (archivTabs.length) {
  const zeigeArchiv = (name, merken) => {
    archivTabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.archivTab === name)));
    document.querySelectorAll("[data-archiv-panel]").forEach((p) => (p.hidden = p.dataset.archivPanel !== name));
    if (merken) history.replaceState(null, "", "#" + name);
  };
  const ausHash = () => {
    const name = location.hash.slice(1);
    if ([...archivTabs].some((b) => b.dataset.archivTab === name)) zeigeArchiv(name);
  };
  archivTabs.forEach((b) => b.addEventListener("click", () => zeigeArchiv(b.dataset.archivTab, true)));
  window.addEventListener("hashchange", ausHash);
  ausHash();
}
