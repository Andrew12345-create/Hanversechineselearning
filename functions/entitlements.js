'use strict';
/* ========================================================================
 * ENTITLEMENT ENGINE — single source of truth for what a user can access.
 *
 * Plans:  free < yct < premium.  An active 7-day trial grants premium-tier
 * access with no card and never renews.  Every check is server-side; no
 * client-provided plan/status/user id is ever trusted.
 *
 * Membership columns (users table):
 *   membership_plan   'free' | 'yct' | 'premium'   (missing → inferred)
 *   membership_status active | cancelled | past_due | expired | incomplete
 *   premium           legacy boolean from the Stripe flow
 *   premium_until     legacy expiry timestamp (null = no expiry)
 *   trial_used        boolean — the one trial has been started
 *   trial_ends_at     trial expiry timestamp
 * ======================================================================== */

const PLAN_RANK = { free: 0, yct: 1, premium: 2 };
const TRIAL_RANK = PLAN_RANK.premium; // active trial == full Premium access

const ACTIVE_STATUSES = new Set(['active']);
const CLOSED_STATUSES = new Set(['cancelled', 'expired', 'incomplete']);

function days(n) { return n; }

/* Resolve the effective plan for a user row (no DB access — pure). */
function computeEntitlement(user, now = new Date()) {
  if (!user) {
    return { plan: 'free', status: 'anonymous', active: false, rank: PLAN_RANK.free, trialActive: false, source: 'none' };
  }

  const membershipPlan = user.membership_plan || 'free';
  const membershipStatus = user.membership_status || 'active';

  // 1. Active 7-day trial → premium-tier access.
  const trialEnds = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  const trialActive =
    !!trialEnds && !Number.isNaN(trialEnds.getTime()) && trialEnds > now;
  if (trialActive) {
    return {
      plan: 'trial', status: 'active', active: true, rank: TRIAL_RANK,
      trialActive: true, trialEndsAt: user.trial_ends_at,
      source: 'trial'
    };
  }

  // 2. Paid membership (Stripe). past_due keeps paid content per dunning
  //    grace, but never for closed statuses.
  if (membershipPlan !== 'free' && !CLOSED_STATUSES.has(membershipStatus)) {
    const expiry = user.premium_until ? new Date(user.premium_until) : null;
    const expiryOk =
      !expiry || (expiry instanceof Date && !Number.isNaN(expiry.getTime()) && expiry > now);
    const statusOk = ACTIVE_STATUSES.has(membershipStatus) || membershipStatus === 'past_due';
    if (statusOk && expiryOk) {
      const plan = PLAN_RANK[membershipPlan] !== undefined ? membershipPlan : 'free';
      return {
        plan, status: membershipStatus, active: true,
        rank: Math.max(PLAN_RANK[plan], PLAN_RANK.free),
        trialActive: false, trialExpired: !trialActive && !!user.trial_used,
        source: 'membership'
      };
    }
    // Membership row exists but expired → fall through to free.
    return {
      plan: 'free', status: membershipStatus === 'past_due' ? 'expired' : membershipStatus,
      active: false, rank: PLAN_RANK.free, trialActive: false,
      trialExpired: !!user.trial_used, source: 'membership'
    };
  }

  // 3. Legacy accounts: premium=true without membership_plan.
  if (membershipPlan === 'free' && user.premium === true) {
    const expiry = user.premium_until ? new Date(user.premium_until) : null;
    const expiryOk =
      !expiry || (expiry instanceof Date && !Number.isNaN(expiry.getTime()) && expiry > now);
    if (expiryOk && membershipStatus === 'active') {
      return {
        plan: 'premium', status: 'active', active: true, rank: PLAN_RANK.premium,
        trialActive: false, source: 'legacy-premium'
      };
    }
    return {
      plan: 'free', status: 'expired', active: false, rank: PLAN_RANK.free,
      trialActive: false, source: 'legacy-premium'
    };
  }

  // 4. Plain free user.
  return {
    plan: 'free', status: CLOSED_STATUSES.has(membershipStatus) ? membershipStatus : 'active',
    active: membershipStatus === 'active', rank: PLAN_RANK.free, trialActive: false,
    trialExpired: !!user.trial_used && !trialActive, source: 'free'
  };
}

/* Does this entitlement satisfy the required tier? */
function hasAccess(entitlement, required) {
  const need = PLAN_RANK[required];
  if (need === undefined) throw new Error(`Unknown required plan: ${required}`);
  if (!entitlement || entitlement.active !== true) return false;
  return entitlement.rank >= need;
}

/* Consistent upgrade-required response body for locked resources. */
function upgradeRequiredPayload(required) {
  return {
    success: false,
    error: 'upgrade_required',
    message: required === 'yct'
      ? 'The YCT Course unlocks every YCT lesson. Upgrade to continue.'
      : 'Premium unlocks this. Upgrade to continue.',
    required_plan: required,
    locked: true
  };
}

export {
  PLAN_RANK, TRIAL_RANK, ACTIVE_STATUSES, CLOSED_STATUSES,
  computeEntitlement, hasAccess, upgradeRequiredPayload, days
};
