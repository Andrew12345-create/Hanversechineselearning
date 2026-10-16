/* nav-user.js — injects the signed-in user chip into the shared nav.
   Styling matches the HanVerse design system (hanverse.css tokens). */
(function () {
  const stored = localStorage.getItem('hanverse_user');
  if (!stored) return;

  let u;
  try { u = JSON.parse(stored); } catch { return; }
  if (!u || !u.user_id) return;

  const C = {
    navy: '#0F2340', ink: '#1E3A5F', muted: '#5D7A9A', line: '#D5E3F0',
    blue: '#2563EB', blueDark: '#1D4ED8', blue50: '#EFF6FF', blue100: '#DBEAFE',
    coral: '#F97316', shadow: '0 16px 48px rgba(15,35,64,.12)'
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
  display:block;width:100%;padding:12px 18px;text-align:left;text-decoration:none;
  font-weight:700;font-size:13px;color:${C.ink};background:none;border:none;cursor:pointer;
  transition:background .15s,color .15s;
}
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
      <a href="profile.html">👤 &nbsp;Profile</a>
      <div class="dd-divider"></div>
      <button class="dd-logout" id="navLogoutBtn">🚪 &nbsp;Log Out</button>`;
    chip.appendChild(dropdown);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.querySelector('#navLogoutBtn').addEventListener('click', () => {
      localStorage.removeItem('hanverse_user');
      window.location.href = 'login.html';
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
    chip.href = 'profile.html';

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
        ${reason ? `<p style="color:${C.ink};font-size:14px;background:#FFF7ED;border:1px solid #FFEDD5;border-radius:12px;padding:12px 16px;margin:16px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
        <p style="color:${C.muted};font-size:12px;margin-top:16px;">If you believe this is a mistake, contact support.</p>
        <button onclick="localStorage.removeItem('hanverse_user');window.location.href='login.html';" style="margin-top:24px;padding:12px 28px;background:${C.coral};color:#fff;border:none;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;">Log Out</button>
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
