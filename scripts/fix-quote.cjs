// Repair pass for the version-assets bug: the first pass dropped the closing
// quote on double-quoted references (href="ASSET?v=1> instead of ...?v=1">).
// Re-inserts the missing quote when ?v=1 is NOT followed by ", ', or #
// (the #auth fragment case was already correct). Run once: node scripts/fix-quote.cjs
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
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let total = 0;
for (const asset of ASSETS) {
  const re = new RegExp(
    `((?:src|href)=["'])${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=1(?!["'#])`,
    'g'
  );
  for (const page of pages) {
    const p = path.join(ROOT, page);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(re, (m, attr) => `${attr}${asset}?v=1"`);
    if (after !== before) {
      fs.writeFileSync(p, after);
      const n = (before.match(re) || []).length;
      total += n;
      console.log(`${page}: fixed ${n} broken reference(s) to ${asset}`);
    }
  }
}
console.log(`TOTAL fixed: ${total}`);
