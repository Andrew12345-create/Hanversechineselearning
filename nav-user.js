/* nav-user.js — injects user chip into every page nav */
(function () {
  const stored = localStorage.getItem('hanverse_user');
  if (!stored) return;

  let u;
  try { u = JSON.parse(stored); } catch { return; }
  if (!u || !u.user_id) return;

  const style = document.createElement('style');
  style.textContent = `
.nav-user-chip{
  position:relative;
  display:inline-flex;
  align-items:center;
  gap:9px;
  padding:6px 14px 6px 6px;
  border-radius:999px;
  background:rgba(255,255,255,.9);
  border:1.5px solid rgba(0,0,0,.07);
  box-shadow:0 4px 14px rgba(0,0,0,.08);
  cursor:pointer;
  font-weight:700;
  font-size:.82rem;
  color:#1A1A2E;
  transition:.2s;
  user-select:none;
  white-space:nowrap;
}
.nav-user-chip:hover{
  box-shadow:0 6px 20px rgba(0,0,0,.13);
  transform:translateY(-1px);
}
.nav-user-avatar{
  width:34px;
  height:34px;
  border-radius:50%;
  background:linear-gradient(135deg,#F4D35E,#6DBBF1);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  flex-shrink:0;
  overflow:hidden;
}
.nav-user-avatar img{
  width:100%;
  height:100%;
  object-fit:cover;
  border-radius:50%;
  display:block;
}
.nav-user-dropdown{
  display:none;
  position:absolute;
  top:calc(100% + 10px);
  right:0;
  background:white;
  border-radius:16px;
  box-shadow:0 16px 40px rgba(0,0,0,.15);
  overflow:hidden;
  min-width:160px;
  z-index:9999;
}
.nav-user-dropdown.open{ display:block; }
.nav-user-dropdown a,
.nav-user-dropdown button{
  display:block;
  width:100%;
  padding:13px 20px;
  text-align:left;
  text-decoration:none;
  font-family:'Poppins',sans-serif;
  font-weight:600;
  font-size:.85rem;
  color:#1A1A2E;
  background:none;
  border:none;
  cursor:pointer;
  transition:.15s;
}
.nav-user-dropdown a:hover,
.nav-user-dropdown button:hover{
  background:#F8FAFC;
  color:#E63946;
}
.nav-pfp-spinner{
  width:18px;
  height:18px;
  border:2px solid rgba(255,255,255,.4);
  border-top-color:#F4D35E;
  border-radius:50%;
  animation:navSpin .7s linear infinite;
}
@keyframes navSpin{
  to{transform:rotate(360deg);}
}
.nav-user-dropdown .dd-divider{
  height:1px;
  background:#F0F0F0;
  margin:4px 0;
}
`;
  document.head.appendChild(style);

  function buildChip(username, pfp) {
    const chip = document.createElement('div');
    chip.className = 'nav-user-chip';
    chip.id = 'navUserChip';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'nav-user-avatar';
    avatarEl.id = 'navUserAvatar';
    if (pfp) {
      const img = document.createElement('img');
      img.src = pfp;
      img.alt = 'pfp';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = '🐼';
    }

    const nameEl = document.createElement('span');
    nameEl.textContent = username || 'Me';

    const dropdown = document.createElement('div');
    dropdown.className = 'nav-user-dropdown';
    dropdown.id = 'navUserDropdown';
    dropdown.innerHTML = `
      <a href="profile.html">👤 &nbsp;Profile</a>
      <div class="dd-divider"></div>
      <button id="navLogoutBtn">🚪 &nbsp;Log Out</button>
    `;

    chip.appendChild(avatarEl);
    chip.appendChild(nameEl);
    chip.appendChild(dropdown);

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => dropdown.classList.remove('open'));

    return chip;
  }

  function inject(pfp) {
    const nav = document.querySelector('nav');
    if (!nav) return;

    const username = u.username || u.full_name || 'Me';
    const chip = buildChip(username, pfp);

    const navBtns = nav.querySelector('.nav-buttons');
    const logoutBtn = nav.querySelector('.logout-btn');
    if (navBtns) navBtns.replaceWith(chip);
    else if (logoutBtn) logoutBtn.replaceWith(chip);
    else nav.appendChild(chip);

    document.getElementById('navLogoutBtn').addEventListener('click', () => {
      localStorage.removeItem('hanverse_user');
      window.location.href = 'login.html';
    });
  }

  function run() {
    inject(null);

    const avatarEl = document.getElementById('navUserAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = '<div class="nav-pfp-spinner"></div>';
    }

    fetch('/api/user/' + u.user_id)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const pfp = data && data.user && data.user.profile_picture;
        const el = document.getElementById('navUserAvatar');
        if (!el) return;
        if (pfp) {
          el.innerHTML = '';
          const img = document.createElement('img');
          img.src = pfp;
          img.alt = 'pfp';
          el.appendChild(img);
        } else {
          el.innerHTML = '\uD83D\uDC3C';
        }
      })
      .catch(() => {
        const el = document.getElementById('navUserAvatar');
        if (el) el.innerHTML = '\uD83D\uDC3C';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
