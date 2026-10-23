/* HanVerse shared behaviour: nav scroll state, mobile menu, current-page highlight.
   Safe to load on every page. Does nothing if the nav is absent. */

// PWA: manifest + service worker (offline support). Swallowed on http:// or file://.
(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = 'manifest.json';
  document.head.appendChild(manifest);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err =>
        console.warn('[HanVerse] SW registration skipped:', err)
      );
    });
  }
})();

(() => {
  const navbar = document.getElementById("navbar");

  // Highlight the link for the current page (matches href filename).
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav-links a[href]").forEach(a => {
    const target = (a.getAttribute("href") || "").split(/[?#]/)[0].toLowerCase();
    if (target && target === here) a.setAttribute("aria-current", "page");
  });

  if (!navbar) return;

  const updateNav = () => navbar.classList.toggle("scrolled", window.scrollY > 40);
  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });
})();
