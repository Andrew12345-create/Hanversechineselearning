(function () {
  const STORAGE_KEY = 'hanverse_notifications_dismissed';
  const LS_USER_KEY = 'hanverse_user';

  function safeJsonParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function getDismissedSet() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = safeJsonParse(raw, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function setDismissedSet(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  async function fetchNotificationsFromDB() {
    const user = safeJsonParse(localStorage.getItem(LS_USER_KEY) || '{}', {});
    const userId = user.user_id || user.userId;
    if (!userId) return [];

    // uses /api/user/:userId since it already joins notifications
    const resp = await fetch(`/api/user/${userId}`);
    const data = await resp.json();
    if (!resp.ok || !data || !Array.isArray(data.notifications)) return [];

    return data.notifications.slice(0, 20);
  }

  function ensureUI() {
    if (document.getElementById('hn-notifications-bell')) return;

    const style = document.createElement('style');
    style.textContent = `
      #hn-toasts-wrap{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;}
      .hn-toast{pointer-events:auto;min-width:280px;max-width:92vw;background:white;border:1px solid #E5E7EB;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,.08);padding:12px 12px 12px 14px;display:flex;gap:10px;align-items:flex-start;animation:hnPop .18s ease-out;}
      @keyframes hnPop{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
      .hn-toast-ic{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#FFE5E5 0%,#FFCDD2 100%);flex:0 0 auto;font-size:18px;}
      .hn-toast-title{font-weight:700;font-size:14px;margin-bottom:2px;}
      .hn-toast-msg{color:#6B7280;font-size:13px;line-height:1.35;}
      .hn-toast-actions{margin-left:auto;display:flex;gap:8px;align-items:center;}
      .hn-toast-btn{border:none;background:#fff0f0;color:#E63946;border-radius:999px;padding:6px 10px;font-weight:700;font-size:12px;cursor:pointer;}
      .hn-toast-btn:hover{background:#FFE5E5;}
      #hn-notifications-drawer{position:fixed;inset:0;z-index:9998;display:none;}
      #hn-notifications-drawer.open{display:block;}
      #hn-notifications-overlay{position:absolute;inset:0;background:rgba(0,0,0,.35);}
      #hn-drawer-panel{position:absolute;right:0;top:0;bottom:0;width:360px;max-width:92vw;background:white;border-left:1px solid #E5E7EB;padding:16px;display:flex;flex-direction:column;}
      #hn-drawer-head{display:flex;gap:12px;align-items:center;margin-bottom:10px;}
      #hn-drawer-title{font-weight:800;font-size:16px;flex:1;}
      #hn-drawer-close{border:none;background:#F4F4F4;border-radius:12px;padding:8px 10px;font-weight:800;cursor:pointer;}
      #hn-drawer-list{overflow:auto;flex:1;}
      .hn-card{border:1px solid #E5E7EB;border-radius:16px;padding:12px;margin-bottom:10px;background:#fff;}
      .hn-card.unread{border-color:#FF6B6B;background:#FFF9F9;}
      .hn-card-row{display:flex;gap:10px;align-items:flex-start;}
      .hn-card-ic{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:#E3F2FD;flex:0 0 auto;}
      .hn-card-title{font-weight:800;font-size:14px;margin-bottom:2px;}
      .hn-card-msg{color:#6B7280;font-size:13px;line-height:1.35;}
      .hn-bell-wrap{position:fixed;top:12px;right:12px;z-index:10000;}
      #hn-notifications-bell{position:relative;border:none;background:white;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,.08);border:1px solid #E5E7EB;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;}
      #hn-notifications-bell .hn-bell-badge{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#E63946;color:white;font-weight:900;font-size:12px;display:none;align-items:center;justify-content:center;}
    `;
    document.head.appendChild(style);

    const bellWrap = document.createElement('div');
    bellWrap.className = 'hn-bell-wrap';
    bellWrap.innerHTML = `
      <button id="hn-notifications-bell" aria-label="Notifications">
        <span style="font-size:18px">🔔</span>
        <span class="hn-bell-badge" id="hn-bell-badge">0</span>
      </button>
    `;
    document.body.appendChild(bellWrap);

    const drawer = document.createElement('div');
    drawer.id = 'hn-notifications-drawer';
    drawer.innerHTML = `
      <div id="hn-notifications-overlay" onclick="window.__hnCloseDrawer && window.__hnCloseDrawer()"></div>
      <div id="hn-drawer-panel">
        <div id="hn-drawer-head">
          <div style="font-size:20px">✨</div>
          <div id="hn-drawer-title">Notifications</div>
          <button id="hn-drawer-close" onclick="window.__hnCloseDrawer && window.__hnCloseDrawer()">Close</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
          <button id="hn-mark-all" class="hn-toast-btn" style="background:#E8F5E9;color:#2E7D32" onclick="window.__hnMarkAllRead && window.__hnMarkAllRead()">Mark all read</button>
        </div>
        <div id="hn-drawer-list"></div>
      </div>
    `;
    document.body.appendChild(drawer);

    window.__hnCloseDrawer = function () {
      const el = document.getElementById('hn-notifications-drawer');
      if (el) el.classList.remove('open');
    };

    window.__hnOpenDrawer = function () {
      const el = document.getElementById('hn-notifications-drawer');
      if (el) el.classList.add('open');
    };

    document.getElementById('hn-notifications-bell').addEventListener('click', () => {
      window.__hnOpenDrawer();
      renderDrawer();
    });
  }

  function pickIcon() {
    const icons = ['🔥', '🏆', '📚', '⏰', '🎉', '💡'];
    return icons[Math.floor(Math.random() * icons.length)];
  }

  function getUnreadNotifications(notifs, dismissedSet) {
    // if notifications table has is_read, we honor it; else treat all as unread except dismissed
    return notifs.filter(n => {
      const id = n.notification_id || n.id || `${n.created_at || ''}${n.title || ''}`;
      const isRead = n.is_read === true || n.is_read === 1 || n.read === true;
      if (dismissedSet.has(String(id))) return false;
      return !isRead;
    });
  }

  let cachedNotifs = [];

  async function renderToasts() {
    ensureUI();

    const wrapId = 'hn-toasts-wrap';
    let wrap = document.getElementById(wrapId);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = wrapId;
      document.body.appendChild(wrap);
    }

    const dismissedSet = getDismissedSet();
    let notifs = cachedNotifs;
    if (!notifs || notifs.length === 0) {
      try {
        notifs = await fetchNotificationsFromDB();
      } catch {
        notifs = [];
      }
    }
    cachedNotifs = notifs;

    const unread = getUnreadNotifications(notifs, dismissedSet);
    const bellBadge = document.getElementById('hn-bell-badge');
    if (bellBadge) {
      const count = unread.length;
      bellBadge.textContent = String(count);
      bellBadge.style.display = count > 0 ? 'flex' : 'none';
    }

    // show up to 3 toasts
    const toShow = unread.slice(0, 3);
    if (toShow.length === 0) return;

    for (const n of toShow) {
      const id = n.notification_id || n.id || `${n.created_at || ''}${n.title || ''}`;
      // avoid re-showing immediately on repeated load: dismiss when shown
      dismissedSet.add(String(id));
      setDismissedSet(dismissedSet);

      const toast = document.createElement('div');
      toast.className = 'hn-toast';
      toast.innerHTML = `
        <div class="hn-toast-ic">${pickIcon()}</div>
        <div>
          <div class="hn-toast-title">${escapeHtml(n.title || 'New notification')}</div>
          <div class="hn-toast-msg">${escapeHtml(n.message || n.body || n.content || '')}</div>
          <div class="hn-toast-msg" style="margin-top:4px;color:#9CA3AF;font-size:12px">${escapeHtml(formatRelativeTime(n.created_at || n.createdAt))}</div>
        </div>
        <div class="hn-toast-actions">
          <button class="hn-toast-btn" onclick="window.__hnDismissToast && window.__hnDismissToast()">OK</button>
        </div>
      `;
      wrap.appendChild(toast);

      window.__hnDismissToast = () => {
        try { toast.remove(); } catch {}
      };

      setTimeout(() => {
        try { toast.remove(); } catch {}
      }, 5500);
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '<')
      .replaceAll('>', '>')
      .replaceAll('"', '"')
      .replaceAll("'", '&#039;');
  }

  async function renderDrawer() {
    ensureUI();
    const list = document.getElementById('hn-drawer-list');
    if (!list) return;

    const dismissedSet = getDismissedSet();

    let notifs = cachedNotifs;
    if (!notifs || notifs.length === 0) {
      try {
        notifs = await fetchNotificationsFromDB();
      } catch {
        notifs = [];
      }
    }
    cachedNotifs = notifs;

    const unread = getUnreadNotifications(notifs, dismissedSet);
    const toRender = (notifs || []).slice(0, 20);

    list.innerHTML = '';

    if (!toRender.length) {
      const empty = document.createElement('div');
      empty.className = 'hn-card';
      empty.innerHTML = `<div style="color:#6B7280;font-weight:700">No notifications yet.</div>`;
      list.appendChild(empty);
      return;
    }

    toRender.forEach(n => {
      const id = n.notification_id || n.id || `${n.created_at || ''}${n.title || ''}`;
      const isDismissed = dismissedSet.has(String(id));
      const isRead = n.is_read === true || n.is_read === 1 || n.read === true || isDismissed;

      const card = document.createElement('div');
      card.className = 'hn-card' + (isRead ? '' : ' unread');
      card.innerHTML = `
        <div class="hn-card-row">
          <div class="hn-card-ic">${pickIcon()}</div>
          <div style="flex:1">
            <div class="hn-card-title">${escapeHtml(n.title || 'Notification')}</div>
            <div class="hn-card-msg">${escapeHtml(n.message || n.body || n.content || '')}</div>
            <div class="hn-card-msg" style="margin-top:6px;color:#9CA3AF;font-size:12px">${escapeHtml(formatRelativeTime(n.created_at || n.createdAt))}</div>
            <div style="margin-top:10px;display:flex;gap:10px;align-items:center;">
              <button class="hn-toast-btn" onclick="window.__hnDismissOne('${String(id).replace(/'/g, "\\'")}')">Dismiss</button>
            </div>
          </div>
        </div>
      `;
      list.appendChild(card);
    });
  }

  window.__hnDismissOne = function (id) {
    const dismissedSet = getDismissedSet();
    dismissedSet.add(String(id));
    setDismissedSet(dismissedSet);
    renderToasts();
    renderDrawer();
  };

  window.__hnMarkAllRead = function () {
    // mark all currently loaded unread as dismissed
    const dismissedSet = getDismissedSet();
    const notifs = cachedNotifs || [];
    for (const n of notifs) {
      const id = n.notification_id || n.id || `${n.created_at || ''}${n.title || ''}`;
      const isRead = n.is_read === true || n.is_read === 1 || n.read === true;
      if (!isRead) dismissedSet.add(String(id));
    }
    setDismissedSet(dismissedSet);
    const bellBadge = document.getElementById('hn-bell-badge');
    if (bellBadge) bellBadge.style.display = 'none';
    const list = document.getElementById('hn-drawer-list');
    if (list) renderDrawer();
  };

  // Expose init
  window.HanverseNotifications = {
    init: async function () {
      ensureUI();
      renderToasts();
    }
  };
})();

