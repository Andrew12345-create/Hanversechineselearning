#!/usr/bin/env node
/* Entitlement engine tests — pure logic, zero dependencies, zero network.
 *
 *   node scripts/test-entitlements.mjs
 *
 * Covers: plan resolution (free/yct/premium/trial), trial lifecycle,
 * subscription statuses, legacy accounts, access hierarchy, and the
 * consistent upgrade-required payload.
 */
'use strict';
import { computeEntitlement, hasAccess, upgradeRequiredPayload, PLAN_RANK } from '../functions/entitlements.js';

let pass = 0, failCount = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : failCount++;
}

const FUTURE = new Date('2030-01-01');
const PAST = new Date('2020-01-01');

// --- plan resolution ---
eq('free user resolves free', computeEntitlement({ membership_plan: 'free', membership_status: 'active' }).plan, 'free');
eq('yct member resolves yct', computeEntitlement({ membership_plan: 'yct', membership_status: 'active', premium_until: FUTURE }).plan, 'yct');
eq('premium member resolves premium', computeEntitlement({ membership_plan: 'premium', membership_status: 'active', premium_until: FUTURE }).plan, 'premium');

// --- access hierarchy: FREE < YCT < PREMIUM ---
const yct = computeEntitlement({ membership_plan: 'yct', membership_status: 'active', premium_until: FUTURE });
const prem = computeEntitlement({ membership_plan: 'premium', membership_status: 'active', premium_until: FUTURE });
eq('free cannot access yct', hasAccess(computeEntitlement({ membership_plan: 'free', membership_status: 'active' }), 'yct'), false);
eq('yct accesses yct content', hasAccess(yct, 'yct'), true);
eq('yct cannot access premium content', hasAccess(yct, 'premium'), false);
eq('premium accesses yct content', hasAccess(prem, 'yct'), true);
eq('premium accesses premium content', hasAccess(prem, 'premium'), true);

// --- subscription statuses ---
eq('past_due keeps paid access (grace)', computeEntitlement({ membership_plan: 'premium', membership_status: 'past_due', premium_until: FUTURE }).plan, 'premium');
eq('cancelled returns to free', computeEntitlement({ membership_plan: 'premium', membership_status: 'cancelled' }).plan, 'free');
eq('expired returns to free', computeEntitlement({ membership_plan: 'yct', membership_status: 'expired' }).plan, 'free');
eq('incomplete (failed payment) is free', computeEntitlement({ membership_plan: 'premium', membership_status: 'incomplete' }).plan, 'free');
eq('lapsed premium_until returns to free', computeEntitlement({ membership_plan: 'premium', membership_status: 'active', premium_until: PAST }).plan, 'free');

// --- trial lifecycle: premium access, no card, auto-expiry, history preserved ---
const trial = computeEntitlement({ trial_used: true, trial_ends_at: FUTURE.toISOString() });
eq('active trial resolves trial plan', trial.plan, 'trial');
eq('active trial source is trial', trial.source, 'trial');
eq('active trial grants premium access', hasAccess(trial, 'premium'), true);
const trialDone = computeEntitlement({ trial_used: true, trial_ends_at: PAST.toISOString() });
eq('expired trial returns to free', trialDone.plan, 'free');
eq('expired trial keeps used flag', trialDone.trialExpired, true);
eq('expired trial loses premium access', hasAccess(trialDone, 'yct'), false);
eq('never-trialed user has no trial state', computeEntitlement({ trial_used: false }).trialActive, false);

// --- legacy accounts (premium boolean, no membership_plan) ---
eq('legacy premium=true resolves premium', computeEntitlement({ premium: true }).plan, 'premium');
eq('legacy premium with lapsed expiry is free', computeEntitlement({ premium: true, premium_until: PAST }).plan, 'free');

// --- server-side only: no client trust surface ---
eq('anonymous user is unentitled', computeEntitlement(null).status, 'anonymous');
eq('anonymous cannot access paid', hasAccess(computeEntitlement(null), 'yct'), false);
eq('banned flag not required by pure fn (route-level)', hasAccess(computeEntitlement({ membership_plan: 'premium', membership_status: 'active', premium_until: FUTURE }), 'premium'), true);
eq('unknown plan string falls back safe', computeEntitlement({ membership_plan: 'vip-from-client', membership_status: 'active' }).plan, 'free');

// --- upgrade-required payload is consistent ---
const up = upgradeRequiredPayload('yct');
eq('upgrade payload names required plan', up.required_plan, 'yct');
eq('upgrade payload success false', up.success, false);
eq('upgrade payload locked flag', up.locked, true);
eq('rank order free<yct<premium', PLAN_RANK.free < PLAN_RANK.yct && PLAN_RANK.yct < PLAN_RANK.premium, true);

console.log(`\n${failCount ? `❌ ${failCount} FAILURE(S)` : '✅ all entitlement tests passed'} (${pass} passed)`);
process.exit(failCount ? 1 : 0);
