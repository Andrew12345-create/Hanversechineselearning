# HanVerse SEO launch-blocker implementation report

## Scope

This local-only change resolves the four confirmed learning-app SEO and technical issues from the launch-readiness audit. It does not deploy or verify production after the changes.

## Confirmed issues and changes

1. The learning-app root URL was included in `sitemap.xml` even though `netlify.toml` permanently redirects it to the marketing homepage. The root URL was removed.
2. The sitemap listed app shells and personalised experiences without deliberate index controls. `sitemap.xml` now lists only `https://learn-hanverse.netlify.app/explore.html`, the public culture page. `explore.html` now has an absolute self-referencing canonical URL.
3. The generic dynamic `lesson.html` shell was sitemap-listed and indexable. It was removed from the sitemap and now has `noindex, nofollow`. The existing server-side lesson entitlement and quiz-answer protection remain unchanged.
4. `worksheets.html` referenced `assets/mascot/hanpan.png`, which does not exist. It now uses the verified `Hanverse-logo2.png` favicon. Other HTML favicon references were checked and lowercase references were normalized to the tracked asset casing.

## Indexing decisions

| Page | Decision | Reason |
| --- | --- | --- |
| `explore.html` | Indexable, self-canonical, in sitemap | Public Chinese culture content with a stable page purpose. |
| `learn.html` | Noindex | Personalised learning dashboard. |
| `roadmap.html` | Noindex | Account-specific progress experience. |
| `practice.html` | Noindex | Interactive app/game shell rather than a stable resource page. |
| `placement.html` | Noindex | Interactive assessment flow. |
| `lesson.html` | Noindex | Generic dynamic lesson shell; content and paid access remain server-authorized. |
| `talk.html` | Noindex | Interactive authenticated/personalised AI practice experience. |

## Files modified

- `sitemap.xml`
- `explore.html`
- `learn.html`
- `roadmap.html`
- `practice.html`
- `placement.html`
- `lesson.html`
- `talk.html`
- `worksheets.html`
- Favicon-casing corrections in `banned.html`, `class.html`, `notifications.html`, `offline.html`, `parents.html`, `payment.html`, `profile.html`, and `settings.html`
- `scripts/test-launch-seo.mjs`

## Verification

Run locally:

```bash
node scripts/test-launch-seo.mjs
node scripts/ci-check.mjs
```

The launch SEO test validates sitemap XML structure and entries, sitemap exclusions, redirect-source exclusion, canonical presence, reviewed title/description uniqueness, required noindex directives, generic lesson exclusion, and exact favicon asset existence.

## Remaining work before launch

- Deploy the local commit, then verify the deployed sitemap and canonical/noindex response HTML with a crawler or Search Console.
- Submit the marketing sitemap to Search Console. Do not submit the learning-app root URL.
- Add stable public educational landing pages only when they have unique, crawlable content and accurate metadata.
- Complete authenticated staging tests for payments, subscription lifecycle, parent/child access, and teacher workflows before a production launch.
