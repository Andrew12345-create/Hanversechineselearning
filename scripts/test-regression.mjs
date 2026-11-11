#!/usr/bin/env node
/**
 * Deterministic, credential-free regression suite for the learning branch.
 * These checks inspect source or exercise pure logic; they do not connect to
 * Neon, Stripe, Brevo, OpenAI, or any production service.
 */
import { spawnSync } from 'node:child_process';

const tests = [
  'scripts/test-admin-security.mjs',
  'scripts/test-admin-fixes.mjs',
  'scripts/test-analytics-privacy.mjs',
  'scripts/test-assignment-controls.mjs',
  'scripts/test-class-assignments.mjs',
  'scripts/test-entitlements.mjs',
  'scripts/test-goals-and-parent-controls.mjs',
  'scripts/test-mastery-bests.mjs',
  'scripts/test-new-games.mjs',
  'scripts/test-parent-classroom.mjs',
  'scripts/test-tone-adaptivity.mjs',
  'scripts/test-trial-emails.mjs',
  'scripts/test-under-13-onboarding.mjs',
  'scripts/test-warmup-isolation.mjs'
];

let failed = 0;
for (const test of tests) {
  console.log(`\n\n===== ${test} =====`);
  const result = spawnSync(process.execPath, [test], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env, CI: '1' }
  });
  if (result.error) {
    console.error(`Could not start ${test}: ${result.error.message}`);
    failed++;
  } else if (result.status !== 0) {
    console.error(`FAILED: ${test} (exit ${result.status ?? 'unknown'})`);
    failed++;
  }
}
console.log(`\nRegression suite: ${tests.length - failed}/${tests.length} test files passed.`);
process.exitCode = failed ? 1 : 0;
