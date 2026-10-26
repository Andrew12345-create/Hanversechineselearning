/* nav-user.js — injects the signed-in user chip into the shared nav.
   Styling matches the HanVerse design system (hanverse.css tokens). */
(function () {
  let stored;
  try { stored = localStorage.getItem('hanverse_user'); } catch { return; }
  if (!stored) return;

  let u;
  try { u = JSON.parse(stored); } catch { return; }
  if (!u || !u.user_id) return;

  const C = {
    navy: '#0F2340', ink: '#1E3A5F', muted: '#5D7A9A', line: '#D5E3F0',
    blue: '#2563EB', blueDark: '#1D4ED8', blue50: '#EFF6FF', blue100: '#DBEAFE',
    coral: '#F97316', shadow: '0 16px 48px rgba(15,35,64,.12)'
  };

  const svg = (inner) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    inner + '</svg>';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  const I = {
    user: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    bell: svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    star: svg('<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>')
  };

  const style = document.createElement('style');
  style.textContent = `
.nav-user-chip{cursor:pointer;position:relative;user-select:none;white-space:nowrap}
.nav-user-chip:hover{background:${C.blue50};border-color:var(--blue-mid,#3B82F6)}
.nav-user-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.nav-user-dropdown{
  display:none;position:absolute;top:calc(100% + 10px);right:0;
  background:#fff;border:1px solid ${C.line};border-radius:16px;
  box-shadow:${C.shadow};overflow:hidden;min-width:180px;z-index:9999;
}
.nav-user-dropdown.open{display:block}
.nav-user-dropdown a,.nav-user-dropdown button{
  display:flex;align-items:center;gap:10px;width:100%;padding:11px 16px;text-align:left;
  text-decoration:none;font-weight:700;font-size:13px;color:${C.ink};
  background:none;border:none;cursor:pointer;transition:background .15s,color .15s;
}
.nav-user-dropdown a svg,.nav-user-dropdown button svg{width:16px;height:16px;flex-shrink:0;opacity:.85}
.nav-user-dropdown a.dd-premium{color:${C.coral};font-weight:800}
.nav-user-dropdown a.dd-premium svg{opacity:1}
.nav-user-dropdown a:hover,.nav-user-dropdown button:hover{background:${C.blue50};color:${C.blue}}
.nav-user-dropdown button.dd-logout:hover{background:#FFF7ED;color:${C.coral}}
.nav-pfp-spinner{
  width:16px;height:16px;border:2px solid rgba(37,99,235,.25);
  border-top-color:${C.blue};border-radius:50%;animation:navSpin .7s linear infinite;
}
@keyframes navSpin{to{transform:rotate(360deg)}}
.nav-user-dropdown .dd-divider{height:1px;background:${C.line};margin:4px 0}
`;
  document.head.appendChild(style);

  function attachDropdown(chip) {
    const dropdown = document.createElement('div');
    dropdown.className = 'nav-user-dropdown';
    dropdown.id = 'navUserDropdown';
    dropdown.innerHTML = `
      <a href="https://learn-hanverse.netlify.app/profile.html">${I.user}<span>Profile</span></a>
      <a href="https://learn-hanverse.netlify.app/settings.html">${I.settings}<span>Settings</span></a>
      <a href="https://learn-hanverse.netlify.app/notifications.html">${I.bell}<span>Notifications</span></a>
      <a href="https://learn-hanverse.netlify.app/payment.html" class="dd-premium">${I.star}<span>Go Premium</span></a>
      <div class="dd-divider"></div>
      <button class="dd-logout" id="navLogoutBtn">${I.logout}<span>Log Out</span></button>`;
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', 'false');
    if (!chip.querySelector('.nav-user-caret')) {
      const caret = document.createElement('span');
      caret.className = 'nav-user-caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      chip.appendChild(caret);
    }
    chip.appendChild(dropdown);
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle('open');
      chip.classList.toggle('open', isOpen);
      chip.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    document.addEventListener('click', () => {
      dropdown.classList.remove('open');
      chip.classList.remove('open');
      chip.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        chip.classList.remove('open');
        chip.setAttribute('aria-expanded', 'false');
        chip.focus();
      }
    });
    dropdown.querySelector('#navLogoutBtn').addEventListener('click', () => {
      localStorage.removeItem('hanverse_user');
      window.location.href = 'https://learn-hanverse.netlify.app/login.html';
    });
  }

  function setAvatar(avatarEl, pfp) {
    if (!avatarEl) return;
    avatarEl.id = 'navUserAvatar';
    if (pfp) {
      avatarEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = pfp;
      img.alt = 'Profile picture';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = '🐼';
    }
  }

  function buildChip(username, pfp) {
    const chip = document.createElement('a');
    chip.className = 'nav-user nav-user-chip';
    chip.id = 'navUserChip';
    chip.href = 'https://learn-hanverse.netlify.app/profile.html';

    const avatarEl = document.createElement('span');
    avatarEl.className = 'avatar';
    setAvatar(avatarEl, pfp);

    const nameEl = document.createElement('span');
    nameEl.textContent = username || 'Me';

    chip.appendChild(avatarEl);
    chip.appendChild(nameEl);
    return chip;
  }

  function inject(pfp) {
    const nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) return;
    const username = u.username || u.full_name || 'Me';

    // Case 1: the page already renders the shared chip (learn/profile/...).
    const existing = nav.querySelector('.nav-user');
    if (existing) {
      existing.classList.add('nav-user-chip');
      existing.id = 'navUserChip';
      setAvatar(existing.querySelector('.avatar'), pfp);
      attachDropdown(existing);
      return;
    }

    // Case 2: shared nav with an actions slot.
    const actions = nav.querySelector('.nav-actions');
    if (actions) {
      // Pages that manage their own actions (theme/logout buttons) are left alone.
      if (actions.querySelector('.logout-btn')) return;
      const chip = buildChip(username, pfp);
      if (actions.querySelector('.nav-login,.nav-cta')) actions.replaceChildren(chip);
      else actions.appendChild(chip);
      attachDropdown(chip);
      return;
    }

    // Case 3: legacy navs (.nav-buttons / .logout-btn) or bare <nav>.
    const chip = buildChip(username, pfp);
    const navBtns = nav.querySelector('.nav-buttons');
    const logoutBtn = nav.querySelector('.logout-btn');
    if (navBtns) navBtns.replaceWith(chip);
    else if (logoutBtn) logoutBtn.replaceWith(chip);
    else nav.appendChild(chip);
    attachDropdown(chip);
  }

  function showBanOverlay(reason) {
    if (document.getElementById('hanverseBanOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'hanverseBanOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(15,35,64,.92);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#fff;border:2px solid ${C.coral};border-radius:26px;padding:48px 40px;max-width:460px;width:90%;text-align:center;box-shadow:${C.shadow};">
        <div style="font-size:64px;margin-bottom:16px;">🚫</div>
        <h2 style="color:${C.coral};font-size:26px;font-weight:900;margin-bottom:12px;font-family:'Nunito',sans-serif;">You've Been Banned</h2>
        <p style="color:${C.muted};font-size:14px;line-height:1.8;">Your account has been suspended from HanVerse.</p>
        ${reason ? `<p style="color:${C.ink};font-size:14px;background:#FFF7ED;border:1px solid #FFEDD5;border-radius:12px;padding:12px 16px;margin:16px 0;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
        <p style="color:${C.muted};font-size:12px;margin-top:16px;">If you believe this is a mistake, contact support.</p>
        <button onclick="localStorage.removeItem('hanverse_user');window.location.href='https://learn-hanverse.netlify.app/login.html';" style="margin-top:24px;padding:12px 28px;background:${C.coral};color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;">Log Out</button>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', e => e.stopImmediatePropagation(), true);
    document.addEventListener('click', e => { if (!overlay.contains(e.target)) e.stopImmediatePropagation(); }, true);
  }

  function run() {
    inject(null);

    const avatarEl = document.getElementById('navUserAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = '<div class="nav-pfp-spinner"></div>';
    }

    const API_BASE = '/.netlify/functions/server';
    fetch(`${API_BASE}/user/${u.user_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const user = data && data.user;
        setAvatar(document.getElementById('navUserAvatar'), user && user.profile_picture);
        if (user && user.is_banned) {
          showBanOverlay(user.banned_reason);
        }
      })
      .catch(() => {
        setAvatar(document.getElementById('navUserAvatar'), null);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
