#!/usr/bin/env node
/**
 * Static regression checks for HanVerse's responsive/mobile app shell.
 * This is a guardrail, not a replacement for real-device/browser testing.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".netlify") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) htmlFiles.push(full);
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

walk(root);
assert(htmlFiles.length >= 20, `Expected to discover the app's HTML pages; found ${htmlFiles.length}.`);

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const headEnd = html.toLowerCase().indexOf("</head>");
  const documentHead = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 12000);
  const viewportCount = [...documentHead.matchAll(/<meta\s+name=["']viewport["'][^>]*>/gi)].length;
  assert(viewportCount === 1, `${relative}: expected exactly one viewport meta tag in the document head; found ${viewportCount}.`);
}

const css = fs.readFileSync(path.join(root, "hanverse.css"), "utf8");
assert(css.includes("body.has-tabbar:not([data-topnav=\"keep\"]) .nav:not(.nav-auth)"), "Shared CSS must hide the desktop nav only when the tab bar is mounted.");
assert(css.includes("body:not(.has-tabbar) .nav:not(.nav-auth) .nav-links"), "Shared CSS must retain usable fallback navigation on pages without bottom-nav.js.");
assert(css.includes("env(safe-area-inset-bottom"), "Shared CSS must account for mobile safe areas.");
assert(css.includes("max-height: min(70dvh, 620px)"), "The mobile More sheet must be height-constrained and scrollable.");

const bottomNav = fs.readFileSync(path.join(root, "bottom-nav.js"), "utf8");
assert(bottomNav.includes("var loggedIn = signedIn();"), "Bottom navigation must use the same validated session check for its Home destination.");
assert(bottomNav.includes("document.body.classList.add('sheet-open')"), "Opening the More sheet must lock background scrolling.");
assert(bottomNav.includes("'hanverse_token'"), "Bottom navigation logout must clear the bearer token as well as the user profile.");

const parents = fs.readFileSync(path.join(root, "parents.html"), "utf8");
assert(!/<nav[^>]*class=["'][^"']*bottom-nav/i.test(parents), "Family portal must not render a second legacy bottom navigation beside the shared tab bar.");
assert(parents.includes('src="bottom-nav.js'), "Family portal must use the shared app tab bar.");

const learn = fs.readFileSync(path.join(root, "learn.html"), "utf8");
assert(learn.includes("repeat(auto-fit,minmax(min(100%,235px),1fr))"), "Learn course cards must fluidly reflow without relying only on breakpoints.");
assert(learn.includes("repeat(auto-fit,minmax(min(100%,175px),1fr))"), "Learn stats must fluidly reflow at intermediate widths.");
const roadmap = fs.readFileSync(path.join(root, "roadmap.html"), "utf8");
assert(roadmap.includes("repeat(auto-fit,minmax(min(100%,220px),1fr))"), "Roadmap milestones must auto-fit available width.");
const adventures = fs.readFileSync(path.join(root, "adventures.html"), "utf8");
assert(adventures.includes("repeat(auto-fit,minmax(min(100%,230px),1fr))"), "Adventure activity cards must auto-fit available width.");

const admin = fs.readFileSync(path.join(root, "admin.html"), "utf8");
assert(admin.includes("sidebar-backdrop"), "Admin mobile navigation must have a dismissible backdrop.");
assert(admin.includes('aria-expanded="false"'), "Admin mobile menu must expose its expanded state accessibly.");


assert(css.includes("--hv-gutter: clamp("), "Fluid layout must use viewport-aware page gutters.");
assert(css.includes("grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--hv-card-min)), 1fr))"), "Common card grids must auto-fit available width.");
assert(css.includes("font-size: clamp(2rem, 1.35rem + 2.8vw, 4.4rem)"), "Headings must scale fluidly with viewport width.");
assert(css.includes("overscroll-behavior-inline: contain"), "Scrollable tables must not widen the page or hijack vertical scrolling.");
assert(css.includes("HANVERSE PREMIUM RESPONSIVE POLISH"), "Shared premium responsive safeguards must be present.");
assert(css.includes("max-height: min(70dvh, 620px)"), "Floating chat tools must remain within the viewport.");
assert(css.includes("env(safe-area-inset-right"), "Floating tools must respect horizontal safe areas.");
assert(css.includes("overflow-wrap: anywhere"), "Long user-generated text must not force horizontal page overflow.");
assert(css.includes("prefers-reduced-motion: reduce"), "Shared UI must respect reduced-motion preferences.");

if (failures.length) {
  console.error("\nMobile layout regression checks failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log(`✓ Mobile layout regression checks passed for ${htmlFiles.length} HTML pages.`);
