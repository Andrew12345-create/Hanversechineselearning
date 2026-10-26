// One-shot cache-busting pass: appends ?v=1 to shared asset references
// (src=/href= attributes) in every root-level HTML page, skipping URLs that
// already carry a query string. Fragments (#auth) keep working: the query is
// inserted before the fragment. Run: node scripts/version-assets.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = [
  'hanverse.css', 'hanverse.js', 'nav-user.js', 'bottom-nav.js',
  'shared-nav.js', 'features-client.js', 'notifications-client.js',
  'notifications.js', 'panda-chat.css', 'panda-chat.js',
  'js/auth-fetch.js', 'js/api.js', 'js/offline-manager.js'
];

const pages = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .sort();

const report = {};
for (const asset of ASSETS) {
  // src="ASSET" or href="ASSET" or src="ASSET#frag" — never touch an existing query.
  const re = new RegExp(`((?:src|href)=["'])(${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})([#"'])`, 'g');
  report[asset] = 0;
  for (const page of pages) {
    const p = path.join(ROOT, page);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(re, (m, attr, name, tail) => {
      if (tail === '#') return `${attr}${name}?v=1#`; // keep fragment, insert query
      return `${attr}${name}?v=1"`; // tail was the closing quote — keep it!
    });
    if (after !== before) {
      fs.writeFileSync(p, after);
      report[asset]++;
    }
  }
}

let total = 0;
for (const [asset, n] of Object.entries(report)) {
  if (n) { console.log(`${asset}: versioned in ${n} page(s)`); total += n; }
  else console.log(`${asset}: no unversioned references found`);
}
console.log(`TOTAL rewrites: ${total} across ${pages.length} pages`);
