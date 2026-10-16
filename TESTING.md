# HanVerse — Manual Test Checklist

Automated checks can't reach the login server, payments, or the live community
socket, so please tap through these on a real phone (and one desktop browser).
Tick items as you go; report anything that looks wrong with the page name.

## 1. First visit / logged out
- [ ] Open the site on your phone → Home page loads, blue pill nav floats on top.
- [ ] Tap the ☰ hamburger → mobile menu opens with Home / Learn / Practice / Explore / Roadmap.
- [ ] Tap a link in it → menu closes and page loads.
- [ ] Nav links all work (no 404s): Learn, Explore, Practice, Roadmap, Parents.

## 2. Account
- [ ] Sign up with a fresh email → account created, verification banner appears.
- [ ] Verify email via the link → "verified" state on login.
- [ ] Log in → nav shows your avatar chip with your name.
- [ ] Tap the chip → dropdown with Profile / Log Out works, closes on outside tap or Esc.
- [ ] Log out → returns to login page, logged-out nav returns.
- [ ] Forgot / reset password end-to-end.
- [ ] Invite link: open an invite URL, sign up through it (referral is recorded).

## 3. Learning
- [ ] Learn page loads your courses while logged in (stats + course cards, not the error box).
- [ ] Open a lesson → heading clears the nav on desktop AND mobile.
- [ ] Complete a lesson step → XP pop, mascot reacts, next step loads.
- [ ] Finish a lesson → celebration shows, XP recorded on profile.
- [ ] Practice page → score bar shows Score / Streak / Lives / Combo, games start and score.
- [ ] Talk to Panda → sends a message, replies arrive, mic button prompts if denied.
- [ ] Roadmap → milestones render, level selector works.

## 4. Community (live features)
- [ ] In a lesson, open the community drawer → connects ("Learning community live").
- [ ] Other learners appear (test with two devices if possible).

## 5. Profile & settings
- [ ] Profile: XP, level progress, badges, heatmap, recent words all render.
- [ ] Theme toggle ☾ → dark mode applies everywhere **including the nav bar**; reload keeps it.
- [ ] Settings: change nickname/avatar → reflected in nav chip.
- [ ] Ask Panda box on profile sends a question and shows a reply.

## 6. Parents
- [ ] Parent dashboard loads a child's stats while logged in as a parent.

## 7. Payments (use test mode)
- [ ] Upgrade flow on payment.html → checkout opens, success returns you logged-in.
- [ ] Premium badge/state reflects on profile.

## 8. Install / offline (PWA — after deploying to Netlify)
- [ ] On Android Chrome: banner or menu "Add to Home screen" → installs with the HanVerse icon.
- [ ] Open installed app → standalone (no browser bar).
- [ ] Load a page once, turn on airplane mode, reopen → HanPan offline page or cached view, no raw browser error.
- [ ] Back online → everything works again.

## 9. Admin
- [ ] admin.html unlocks with the admin password.
- [ ] Dashboard metrics populate; Users / Lessons / Broadcasts sections open.
- [ ] Send a test broadcast → arrives on a learner account.
- [ ] Generated broadcast email preview shows the blue HanVerse header.

## 10. Share preview
- [ ] Paste a page URL into WhatsApp / Telegram → HanVerse title, description and logo appear.

---

Notes for the reviewer:
- Nothing here requires tools — just a phone, a desktop, and the deployed site.
- Flows marked "live" (community, broadcasts) need two devices or a friend to test fully.
- If a section shows the HanPan error box where data should be, note the page and
  what you clicked — that usually means the server function returned an error.
