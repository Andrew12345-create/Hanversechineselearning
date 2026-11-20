// Single source of truth for which page lives on which host.
//
// Two Netlify projects deploy this repo:
//   hanverse        -> the marketing site   (MARKETING_HOST)
//   learn-hanverse  -> the learning app     (APP_HOST)
//
// Netlify redirect `conditions` cannot match on Host, so the split is done at
// build time: scripts/build-split.mjs publishes only that host's pages and
// writes a _redirects file that 301s the other host's pages across. That
// removes the duplicate-content problem without needing an Edge Function.

export const MARKETING_HOST = 'https://hanverse.netlify.app';
export const APP_HOST = 'https://learn-hanverse.netlify.app';

// Public marketing and legal pages. These are the only pages that should ever
// be indexed on the marketing host.
export const MARKETING_PAGES = [
  'index.html',
  'about.html',
  'pricing.html',
  'faq.html',
  'contact.html',
  'terms.html',
  'privacy.html',
  'refund-policy.html',
  'cookie-policy.html',
  'compliance.html'
];

// The learning app. Everything a signed-in learner or parent touches.
export const APP_PAGES = [
  'dictionary.html',
  'explore.html',
  'adventures.html',
  'parents.html',
  'learn.html',
  'lesson.html',
  'roadmap.html',
  'practice.html',
  'talk.html',
  'placement.html',
  'profile.html',
  'dashboard.html',
  'settings.html',
  'payment.html',
  'notifications.html',
  'invite.html',
  'banned.html',
  'vocabulary.html',
  'class.html',
  'worksheets.html',
  'child-profile.html',
  'parent-dashboard.html',
  'admin.html',
  'login.html',
  'signup.html',
  'forgot-password.html',
  'reset-password.html',
  'verify-email.html',
  'panda-wave.html'
];

// Error and offline shells must exist on both hosts, otherwise a 404 on the
// marketing site falls through to Netlify's unbranded default page.
export const SHARED_PAGES = ['404.html', 'offline.html'];

// Pages that must never be indexed, even though they are served. Everything in
// the app except the four content pages a search engine could usefully land on.
export const NOINDEX_PAGES = [
  'dashboard.html',
  'profile.html',
  'settings.html',
  'payment.html',
  'notifications.html',
  'invite.html',
  'banned.html',
  'forgot-password.html',
  'reset-password.html',
  'verify-email.html',
  'login.html',
  'signup.html',
  'learn.html',
  'lesson.html',
  'roadmap.html',
  'practice.html',
  'talk.html',
  'placement.html',
  'vocabulary.html',
  'class.html',
  'worksheets.html',
  'child-profile.html',
  'parent-dashboard.html',
  'admin.html',
  'panda-wave.html'
];

// Pages that are worth advertising to search engines on each host.
export const MARKETING_INDEXABLE = MARKETING_PAGES.filter(page => page !== 'index.html');
export const APP_INDEXABLE = ['dictionary.html', 'explore.html', 'adventures.html', 'parents.html'];

export const hostFor = page =>
  MARKETING_PAGES.includes(page) ? MARKETING_HOST : APP_HOST;

export const pagesFor = target => {
  if (target === 'marketing') return [...MARKETING_PAGES, ...SHARED_PAGES];
  if (target === 'app') return [...APP_PAGES, ...SHARED_PAGES];
  return [...MARKETING_PAGES, ...APP_PAGES, ...SHARED_PAGES];
};
