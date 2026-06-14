# TODO

## Verification + UX improvements
- [x] Update `TODO.md` created.
- [ ] Update `functions/server.js` so verification/reset emails always use `https://hanverse.netlify.app` in production (unless `FRONTEND_URL` is explicitly set).
- [ ] Update `login.html` to provide interactive “not verified” UX (resend verification inline with loading + success/error).
- [ ] Update `signup.html` to provide interactive “verify your email” CTA after successful signup.
- [ ] Ensure `verify.html` redirects to `login.html` on success (no localhost).
- [ ] Quick local sanity test: signup -> check email link target.
- [ ] Deploy to Netlify and verify end-to-end.


