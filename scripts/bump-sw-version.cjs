#!/usr/bin/env node
/* Netlify build step: stamp the service worker's VERSION with the deploy
 * time so every deploy gets a fresh cache namespace without anyone having
 * to hand-edit sw.js (the manual step that always gets skipped). */
'use strict';
const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'sw.js');
const stamp =
  process.env.COMMIT_REF?.slice(0, 7) ||
  process.env.NETLIFY_BUILD_ID ||
  String(Date.now());
const version = `v2-${stamp}`;

let sw = fs.readFileSync(swPath, 'utf8');
if (/const VERSION = 'v\d[^']*';/.test(sw)) {
  sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
} else {
  console.error('✗ bump-sw-version: VERSION constant not found in sw.js');
  process.exit(1);
}
fs.writeFileSync(swPath, sw);
console.log(`✓ sw.js VERSION → ${version}`);
