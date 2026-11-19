#!/usr/bin/env node
// Release gate for the public site: runs the static audit and fails the
// suite when it finds undefined tokens, duplicate ids or functions, broken
// internal links, debug logging, missing alt text or sitemap drift.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const run = spawnSync(process.execPath, [join(here, 'audit-site.mjs')], {
  cwd: root,
  encoding: 'utf8'
});

const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
if (run.status !== 0) {
  console.error(output);
  console.error('\n✖ site audit found problems');
  process.exit(1);
}

const summary = output.split('\n').filter(Boolean).find(line => /pages,/.test(line)) || 'clean';
console.log(`  ok  public site audit — ${summary}`);
console.log('\n1/1 checks passed');
