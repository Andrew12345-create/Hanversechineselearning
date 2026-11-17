#!/usr/bin/env node
/* Regression test: analytics must be counter-only (no PII, no attribution).
 *
 * Verifies, from the actual shipped source:
 *   1. features-client.js sends only a whitelisted event name — never the
 *      user id, token, username, or page URL.
 *   2. Do-Not-Track is honoured.
 *   3. The server route ignores unknown event names.
 *   4. The analytics_counters table schema has no user_id/ip columns.
 *   5. The summary endpoint sits behind requireAdmin.
 *
 * Run: node scripts/test-analytics-privacy.mjs
 */
'use strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const client = readFileSync(path.join(root, 'features-client.js'), 'utf8');
const server = readFileSync(path.join(root, 'functions/features.js'), 'utf8');

// 1. Client payload contains only { event: <name> }.
const trackFn = client.match(/track\(event\) \{[\s\S]*?\n    \},/);
check('track() exists in features-client.js', Boolean(trackFn));
if (trackFn) {
  const body = trackFn[0];
  check('client sends only the event name', /body:\s*JSON\.stringify\(\{\s*event\s*\}\)/.test(body.replace(/\s+/g, ' ')));
  check('client never sends user id/token', !/currentUserId|getAuthToken|hanverse_user|hanverse_token/.test(body));
  check('client honours Do-Not-Track', /doNotTrack/.test(body));
}

// 2. Server rejects unknown events.
const evtRoute = server.match(/router\.post\('\/analytics\/event'[\s\S]*?\n  \}\);/);
check('analytics/event route exists', Boolean(evtRoute));
if (evtRoute) {
  check('unknown events are ignored (204 / no insert)', /ANALYTICS_EVENTS\.has\(name\)/.test(evtRoute[0]));
  check('route stores nothing but the counter increment', !/req\.body\.(userId|user_id|ip|url|text)/.test(evtRoute[0]));
}

// 3. Table schema: no user/ip columns.
// The SQL literal ends with `)` followed by a backtick — capture up to that.
const table = server.match(/CREATE TABLE IF NOT EXISTS analytics_counters \(([\s\S]*?)\)`/);
check('analytics_counters table exists', Boolean(table));
if (table) {
  const cols = table[1].toLowerCase();
  check('schema has no user_id/ip/payload columns', !/user_id|ip|payload|url|text|jsonb/.test(cols));
}

// 4. Summary is admin-gated.
check('summary endpoint admin-gated', /router\.get\('\/analytics\/summary',\s*requireAdmin/.test(server));

console.log(failures ? `\n❌ ${failures} failure(s)` : '\n✅ analytics privacy verified');
process.exit(failures ? 1 : 0);
