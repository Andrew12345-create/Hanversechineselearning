#!/usr/bin/env node
// Aggregate test entrypoint. Runs every scripts/test-*.mjs suite in sequence,
// then the repository CI check, and fails if any of them fails.
//
// Usage:
//   npm test
//   npm test -- --filter=admin
//   npm test -- --bail

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const filterArg = args.find(a => a.startsWith('--filter='));
const filter = filterArg ? filterArg.slice('--filter='.length) : '';
const bail = args.includes('--bail');

const suites = readdirSync(here)
  .filter(name => /^test-.*\.mjs$/.test(name))
  .filter(name => name !== 'test-all.mjs')
  .filter(name => !name.includes('sync-conflict'))
  .filter(name => (filter ? name.includes(filter) : true))
  .sort();

if (!suites.length) {
  console.error(`No test suites matched${filter ? ` filter "${filter}"` : ''}.`);
  process.exit(1);
}

const results = [];
const started = Date.now();

for (const suite of suites) {
  const label = suite.replace(/\.mjs$/, '');
  process.stdout.write(`\n▶ ${label}\n`);
  const run = spawnSync(process.execPath, [join(here, suite)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    timeout: 180000
  });
  const ok = run.status === 0;
  if (run.error && run.error.code === 'ETIMEDOUT') {
    process.stdout.write(`\n✖ ${label} timed out after 180s\n`);
  }
  results.push({ label, ok, status: run.status });
  if (!ok && bail) break;
}

process.stdout.write('\n▶ ci-check\n');
const ci = spawnSync(process.execPath, [join(here, 'ci-check.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
results.push({ label: 'ci-check', ok: ci.status === 0, status: ci.status });

const failed = results.filter(r => !r.ok);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

process.stdout.write(`\n${'='.repeat(52)}\n`);
for (const r of results) {
  process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}\n`);
}
process.stdout.write(`${'='.repeat(52)}\n`);
process.stdout.write(`${results.length - failed.length}/${results.length} suites passed in ${seconds}s\n`);

if (failed.length) {
  process.stdout.write(`\nFailed: ${failed.map(f => f.label).join(', ')}\n`);
  process.exit(1);
}
