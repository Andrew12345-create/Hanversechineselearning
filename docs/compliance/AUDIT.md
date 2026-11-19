# HanVerse — Child Data Protection & Cybersecurity Compliance Audit

**Framework:** Kenya Data Protection Act 2019; Data Protection (General) Regulations 2021; ODPC children's data guidance; OWASP Top 10.
**Scope:** `C:\Users\user\Documents\Andrew\Hanverse`, branch `main`.
**Status date:** 2026-11-19.

Every row below was checked against the code in this repository, not against intent. `Verified by` names the artefact that proves the claim. Where a requirement is not met, it says so.

Legend: **Met** · **Partial** · **Gap** · **External** (cannot be closed in code).

---

## 2. Roles and access control

| Requirement | Status | Verified by |
|---|---|---|
| RBAC on the backend | Met | `users.role` (`server.js:136`), `verifyAdminToken` rechecks `is_admin`/`is_banned` per request |
| Not relying on hidden UI | Met | every protected route calls `requireUser` / `verifyAdminToken` server-side |
| Permission checked on every protected request | Met | 165 write routes across `functions/*.js`; `test-launch-hardening` asserts limiter + auth coverage |
| Parents access only linked children | Met | `guardianOwnsChild()` in `compliance.js`; `canAccessUser()` in `server.js` |
| Teachers access only assigned students | Met | `class_assignments` scoping; `test-class-assignments` (11 checks) |
| Admin privileges restricted | Met | `verifyAdminToken` + `admin_audit` |
| Privileged actions logged | Met | `auditAdmin` / `auditAdminWithClient`, `admin_audit` table |
| Least privilege | Partial | admin is a single role; no granular scopes beyond `audit.read` |
| 401/403 on unauthorised API calls | Met | verified live: 9 compliance routes return 401 unauthenticated |

## 3. Child data protection and parental consent

| Requirement | Status | Verified by |
|---|---|---|
| Separate parent/student registration | Met | `test-under-13-onboarding` (13 checks) |
| Parent-first flow for under-13 | Met | `88c2003`, `test-under-13-onboarding` |
| Consent recorded with purpose, date, version | **Met (new)** | `consent_records` table: `purpose`, `policy_version`, `granted_at`, `withdrawn_at` |
| Consent history preserved | **Met (new)** | withdrawal sets `withdrawn_at`; no `DELETE FROM consent_records` anywhere |
| Optional permissions separated | **Met (new)** | `OPTIONAL_PURPOSES` excludes `core_service`; photographs, audio, AI, marketing are independent rows |
| Withdrawal triggers restriction | Partial | withdrawal is recorded and audited; downstream features do not yet read the flag |
| Parent can request access/deletion | **Met (new)** | `POST /compliance/deletion-requests`, `GET /compliance/deletion-requests` |
| Consent changes recorded | **Met (new)** | `security_events` rows `consent_recorded` / `consent_withdrawn` |

## 4. Data minimisation

| Requirement | Status | Verified by |
|---|---|---|
| Every field has a documented purpose | Partial | `RETENTION_SCHEDULE` documents categories; no per-field register yet |
| No home address / live location | Met | not collected in any registration form |
| No student photographs by default | Met | avatar is a generated pet/emoji, not a photo upload |
| Voice not stored unnecessarily | Met | Web Speech API transcribes in-browser; no audio upload route |
| No social media accounts | Met | absent from schema |
| Optional collection clearly identified | **Met (new)** | consent purposes split essential vs optional |

## 5. Authentication

| Requirement | Status | Verified by |
|---|---|---|
| No plaintext passwords | Met | bcrypt, 9 call sites |
| Argon2id or bcrypt | Met | bcrypt |
| Secure password reset | Met | `reset-password.html` + expiring token |
| Email verification for parents | Met | `email_verifications`, `verify-email.html` |
| Rate limiting on login | Met | `authLimiter`, 15 references in `server.js` |
| Brute-force protection | Met | `authLimiter` + `admin_auth_attempts` |
| Session invalidation on logout | Met | `POST /auth/logout` |
| **Admin MFA** | **Met (new)** | TOTP RFC 6238 in `compliance.js`; `/admin/mfa/enroll`, `/admin/mfa/confirm`; `admin_mfa` table |
| Revoke active sessions | **Met (new)** | `users.token_version`; `POST /auth/logout-all`; `requireUser` rejects stale `tv` |
| Tokens not in URLs | Met | `Authorization: Bearer` only |

## 6. Encryption and storage

| Requirement | Status | Verified by |
|---|---|---|
| HTTPS enforced | Met | Netlify TLS; `_headers` HSTS |
| TLS 1.2+ | Met | Netlify terminates at TLS 1.3 |
| Encryption at rest | External | Neon encrypts volumes; no application-level field encryption |
| Encrypted backups | External | Neon-managed |
| Secrets in env, not repo | Met | `ci-check` scans for secrets; `.env` gitignored |
| No credentials in frontend bundles | Met | `ci-check` secret scan |
| DB access restricted | External | Neon role/network policy |
| Sensitive data kept out of logs | Partial | `security_events.detail` is truncated to 500 chars; no PII scrubber |

## 7. Web application security

| Control | Status | Verified by |
|---|---|---|
| SQL injection | Met | parameterised queries throughout; no string-concatenated user input |
| XSS | Partial | 29 `escapeHTML`-family definitions across pages; CSP allows `'unsafe-inline'` |
| CSRF | Met | bearer tokens, no cookie auth |
| Broken access control | Met | server-side checks on every route |
| Security misconfiguration | Met | helmet, CORS allow-list |
| Vulnerable dependencies | Partial | `npm audit` not wired into CI |
| SSRF | Met | no user-supplied outbound URL fetch |
| File upload | Met | no upload endpoint exists |
| CSP | Met | `_headers` |
| CORS restrictions | Met | `ALLOWED_ORIGINS` allow-list |
| Body size limits | **Met (new)** | 100kb global, 2mb only on `/admin/lessons` |
| Directory listing | Met | Netlify static hosting |

## 8. AI and third-party integrations

| Requirement | Status | Verified by |
|---|---|---|
| Document what is sent to AI providers | Partial | `ai-routes.js` sends lesson context; no published data-flow register |
| Provider retention reviewed | External | requires Gemini/OpenAI DPA review |
| No training on submitted data | External | contractual |
| Minimal identifiers sent | Met | prompts carry lesson ids, not names |
| Parental permission for AI | **Met (new)** | `ai_tutor` is an independent consent purpose |
| Human oversight of AI assessment | Met | AI explains, does not grade; `secure-grading.js` grades server-side |
| Biometrics avoided | Met | no facial recognition or voiceprint storage |

## 9. Child safeguarding

| Requirement | Status | Verified by |
|---|---|---|
| Profiles not public by default | Met | `share_leaderboard` defaults false |
| Full names not public | Met | leaderboard shows username |
| No unrestricted messaging | Met | `parent_messages` only; no child-to-child channel |
| Moderation | Partial | community feed is class-scoped; no automated moderation |
| Report inappropriate content | Gap | no report button or `content_reports` table |
| Escalation process | Partial | `incidents` table exists for admin use |
| Leaderboard minimises data | Met | username + score only |

## 10. Retention, deletion, backups

| Requirement | Status | Verified by |
|---|---|---|
| Formal retention schedule | **Met (new)** | `retention_policy` table, 6 categories seeded, `GET /admin/compliance/retention` |
| No indefinite retention | **Met (new)** | `POST /admin/compliance/retention/purge`, dry-run by default |
| Secure account deletion | **Met (new)** | `deletion_requests` with pending → approved → completed |
| Deletion tracked | **Met (new)** | `resolved_by`, `resolved_at`, `security_events` |
| Backup deletion schedule | External | Neon retention policy |
| Deletion within legal timelines | Partial | workflow exists; no SLA timer or alert |

## 11. Monitoring and incident response

| Requirement | Status | Verified by |
|---|---|---|
| Unusual login monitoring | Met | `admin_auth_attempts`, `authLimiter` |
| Privileged actions recorded | Met | `admin_audit` |
| Suspicious API monitoring | **Met (new)** | `security_events` + `GET /admin/compliance/summary` |
| Secure audit logs | Met | append-only tables |
| Breach response plan | Gap | not written |
| 72-hour ODPC notification | Gap | no runbook |

## 12. Legal documentation

| Document | Status |
|---|---|
| Privacy Policy | Met — `privacy.html` |
| Terms and Conditions | Met — `terms.html` |
| Refund Policy | Met — `refund-policy.html` |
| Cookie Policy | Met — `cookie-policy.html` |
| Parental Consent Policy | Gap |
| Child Safeguarding Policy | Gap |
| Data Retention Policy | Partial — machine-readable schedule exists, no prose policy |
| Information Security Policy | Gap |
| Data Breach Response Plan | Gap |
| Data Processing Agreements | External |
| Records of Processing Activities | Gap |
| DPIA | Gap |
| ODPC registration assessment | External |

## 13. Security testing

| Test | Status |
|---|---|
| Authentication | Met — `test-admin-security`, `test-under-13-onboarding` |
| Authorisation | Met — `test-admin-fixes`, `test-parent-classroom` |
| API security | Met — `test-launch-hardening` |
| SQL injection | Partial — parameterised by construction, no automated probe |
| XSS | Partial — `test-bug-batch` covers escaping |
| CSRF | Met by design (bearer tokens) |
| File upload | n/a — no upload endpoint |
| Session | **Met (new)** — `test-compliance` covers `token_version` |
| Dependency scanning | Gap — `npm audit` not in CI |
| Penetration testing | External |
| Backup recovery | External |

## 15. Pre-launch checklist

| Item | Status |
|---|---|
| Legal requirements assessed | Partial — this document |
| ODPC registration addressed | External |
| Data collection inventory | Partial |
| Privacy Policy published | Met |
| Terms published | Met |
| Parental consent implemented and tested | **Met (new)** |
| Parent/student permissions tested | Met |
| Secure authentication | Met |
| Encryption | Met (transport), External (at rest) |
| DB access restricted | External |
| API security tested | Met |
| Third-party integrations reviewed | Gap |
| AI privacy assessed | Partial |
| Retention policy implemented | **Met (new)** |
| Account deletion tested | **Met (new)** |
| Backup and recovery tested | External |
| Incident response plan approved | Gap |
| Security testing completed | Partial |
| Child safeguarding implemented | Partial |
| Final compliance review | Gap |

---

## What this change added

`functions/compliance.js` (new), mounted at `/api`:

- `GET/POST /compliance/consents`, `POST /compliance/consents/:id/withdraw`
- `POST/GET /compliance/deletion-requests`
- `GET/PATCH /admin/compliance/deletion-requests`
- `GET /admin/compliance/retention`, `POST /admin/compliance/retention/purge`
- `POST /auth/logout-all`
- `GET /admin/mfa/status`, `POST /admin/mfa/enroll`, `POST /admin/mfa/confirm`
- `GET /admin/compliance/summary`

`functions/server.js`: mounts the module, converges the schema at boot, and `requireUser` now rejects a token whose `tv` claim is behind `users.token_version`.

Verified against the live Neon database: `consent_records`, `deletion_requests`, `retention_policy`, `security_events`, `admin_mfa` all present; `users.token_version` present; 6 retention rows seeded.

## What remains open

1. **Report-a-concern flow** — no `content_reports` table or UI. Safeguarding escalation has no intake.
2. **Breach response runbook and 72-hour ODPC procedure** — prose only, not written.
3. **Parental Consent, Child Safeguarding, Information Security, Retention prose policies, ROPA, DPIA** — not written.
4. **Consent enforcement downstream** — withdrawal is recorded but no feature reads the flag yet.
5. **`npm audit` in CI** — dependency scanning is manual.
6. **CSP `'unsafe-inline'`** — required by 28 inline `onclick` handlers in `parents.html` alone.
7. **External items** — ODPC registration, DPAs, penetration test, Neon backup policy, legal review.
