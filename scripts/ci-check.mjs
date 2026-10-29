#!/usr/bin/env node
/* CI gate for HanVerse — fails the build on the bug classes that have
 * actually bitten us:
 *   1. Unresolved git conflict markers committed verbatim (broke the learn API)
 *   2. JS files that fail node --check (would 500 on Netlify)
 *   3. package-lock.json out of sync with package.json / not valid JSON
 *   4. .env or secret-looking files tracked in git
 * Zero dependencies — run with: node scripts/ci-check.mjs
 */
import { execSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const problems = [];

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

// 1. Conflict markers in tracked text files
const MARKERS = /^<{7} |^={7}$|^>{7} /;
for (const f of tracked) {
  if (!/\.(js|mjs|cjs|json|html|css|toml|md|sql|txt)$/.test(f) || f.includes('package-lock.json')) continue;
  const lines = execSync(`git show :${f}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n');
  lines.forEach((l, i) => { if (MARKERS.test(l)) problems.push(`${f}:${i + 1} conflict marker: ${l.slice(0, 40)}`); });
}

// 2. Syntax-check every tracked JS file
for (const f of tracked) {
  if (!/\.(js|mjs|cjs)$/.test(f) || f.startsWith('node_modules') || f.includes('.tmpcheck')) continue;
  // Skip known browser-only scripts only if node --check chokes on top-level await-free DOM code? node --check is syntax-only, safe for all.
  const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`${f} fails node --check:\n${(r.stderr || '').split('\n').slice(0, 4).join('\n')}`);
}

// 3. Lockfile validity + sync
try {
  const lock = JSON.parse(execSync('git show :package-lock.json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }));
  const pkg = JSON.parse(execSync('git show :package.json', { cwd: ROOT, encoding: 'utf8' }));
  const lockRoot = lock.packages && lock.packages[''];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] || {})) {
      if (!lockRoot || !lockRoot[section] || lockRoot[section][name] !== range) {
        problems.push(`package-lock.json out of sync with package.json (${section}: ${name})`);
      }
    }
  }
} catch (e) {
  problems.push(`package-lock.json/package.json unparseable: ${e.message.split('\n')[0]}`);
}

// 4. Tracked secrets/env files
for (const f of tracked) {
  if (/^\.env/.test(f) && f !== '.env.example') problems.push(`${f} is tracked — .env files must never be committed`);
}

if (problems.length) {
  console.error(`\n❌ ci-check: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}
console.log(`✅ ci-check: ${tracked.length} tracked files clean (markers, syntax, lockfile sync, secrets)`);
