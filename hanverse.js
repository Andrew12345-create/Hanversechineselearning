/* HanVerse shared behaviour: nav scroll state, mobile menu, current-page highlight.
   Safe to load on every page. Does nothing if the nav is absent. */
(() => {
  const navbar = document.getElementById("navbar");
  const menuBtn = document.getElementById("menu");
  const mobileMenu = document.getElementById("mobileMenu");

  // Highlight the link for the current page (matches href filename).
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav-links a[href], .mobile-menu a[href]").forEach(a => {
    const target = (a.getAttribute("href") || "").split(/[?#]/)[0].toLowerCase();
    if (target && target === here) a.setAttribute("aria-current", "page");
  });

  if (!navbar) return;

  const updateNav = () => navbar.classList.toggle("scrolled", window.scrollY > 40);
  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });

  if (menuBtn && mobileMenu) {
    const setOpen = open => {
      mobileMenu.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    };
    menuBtn.addEventListener("click", () => setOpen(!mobileMenu.classList.contains("open")));
    mobileMenu.querySelectorAll("a").forEach(a => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("keydown", e => { if (e.key === "Escape") setOpen(false); });
  }
})();
