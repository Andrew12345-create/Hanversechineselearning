/* =====================================================
   Hanverse Notifications — real, DB-backed.
   Bell on every learner page:
     • desktop: docks into the shared top nav (before the user chip)
     • mobile (<= 1024px): floats top-right
   Drawer + toasts read /api/notifications/:userId; read state is
   persisted server-side (notifications table), not in localStorage.
   Opt a page out with <body data-notifications="off">.
   ===================================================== */
(function () {
  'use strict';

  var API_BASE = (window.location.hostname === 'localhost')
    ? '/.netlify/functions/server'
    : '/api';

  var SKIP = /login|signup|verify-email|reset-password|forgot-password|banned|admin|offline|parent-dashboard/i;
  if (SKIP.test(location.pathname)) return;

  function currentUser() {
    try {
      var raw = localStorage.getItem('hanverse_user');
      var u = raw ? JSON.parse(raw) : null;
      return (u && (u.user_id || u.userId)) ? u : null;
    } catch (e) { return null; }
  }

  function uid() { var u = currentUser(); return u ? (u.user_id || u.userId) : null; }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function relativeTime(ts) {
    if (!ts) return '';
    var mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.floor(mins / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  var TYPE_META = {
    achievement: { icon: '🏆', tint: '#EFF6FF' },
    streak:      { icon: '🔥', tint: '#FFF7ED' },
    reminder:    { icon: '⏰', tint: '#F5F3FF' },
    system:      { icon: '🐼', tint: '#ECFEFF' }
  };

  var BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  var state = { items: [], unread: 0, loaded: false, fam: [], famUnread: 0, famLoaded: false, lastFamAt: 0, linkReqs: [] };

  /* ── API ── */
  function api(path, options) {
    return fetch(API_BASE + path, Object.assign({
      credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json' }
    }, options || {})).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d && d.error || 'HTTP ' + r.status);
        return d;
      });
    });
  }

  function refresh() {
    var id = uid();
    if (!id) return Promise.resolve(null);
    return Promise.all([
      api('/notifications/' + encodeURIComponent(id)),
      refreshFamily().catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0];
      if (!d || !d.success) return null;
      state.items = Array.isArray(d.notifications) ? d.notifications : [];
      state.unread = Number(d.unread) || 0;
      state.loaded = true;
      paint();
      return state;
    }).catch(function () { return null; });
  }

  function markAllRead() {
    var id = uid();
    if (!id) return Promise.resolve();
    return api('/notifications/' + encodeURIComponent(id) + '/read-all', { method: 'POST' })
      .then(refresh).catch(function () {});
  }

  function markOne(id) {
    var userId = uid();
    if (!userId) return Promise.resolve();
    return api('/notifications/' + encodeURIComponent(userId) + '/' + encodeURIComponent(id) + '/read', { method: 'POST' })
      .then(refresh).catch(function () {});
  }

  /* ── FAMILY THREAD (parent → child messages) ── */
  function refreshFamily() {
    if (!uid()) return Promise.resolve(null);
    return api('/family/messages').then(function (d) {
      if (!d || !d.success) return null;
      var arrived = state.famLoaded && d.messages.length > state.fam.length &&
        String(d.messages[0].message_id) !== String(state.fam[0] && state.fam[0].message_id);
      state.fam = Array.isArray(d.messages) ? d.messages : [];
      state.famUnread = Number(d.unread) || 0;
      state.famLoaded = true;
      if (arrived) familyArrived();
      if (ui.family && !ui.family.hidden) renderFamily();
      paint();
      // Family link requests (Reconnect) — pick up new ones for the drawer.
      return api('/family/link-requests').then(function (r) {
        var prev = state.linkReqs ? state.linkReqs.length : 0;
        state.linkReqs = (r && r.requests) || [];
        if (state.linkReqs.length > prev) {
          try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
          if (ui.view === 'family') renderFamily();
        }
        return d;
      }).catch(function () { return d; });
    });
  }

  function respondLink(linkId, verb, btn) {
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    api('/family/link-requests/' + encodeURIComponent(linkId) + '/' + verb, { method: 'POST' })
      .then(function () {
        state.linkReqs = (state.linkReqs || []).filter(function (r) { return String(r.link_id) !== String(linkId); });
        renderFamily();
      })
      .catch(function () { btn.disabled = false; btn.textContent = old; });
  }

  function familyArrived() {
    try { if (navigator.vibrate) navigator.vibrate([30, 60, 30]); } catch (e) {}
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !familyArrived.ac) familyArrived.ac = new AC();
      var ac = familyArrived.ac;
      if (ac && ac.state === 'suspended') ac.resume();
      if (ac) {
        [880, 1174.7].forEach(function (f, i) {
          var o = ac.createOscillator(), g = ac.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.001, ac.currentTime + i * 0.14);
          g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + i * 0.14 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.14 + 0.18);
          o.connect(g); g.connect(ac.destination);
          o.start(ac.currentTime + i * 0.14); o.stop(ac.currentTime + i * 0.14 + 0.2);
        });
      }
    } catch (e) {}
  }

  /* ── FAMILY VIEW inside the drawer ── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dayLabel(ts) {
    var d = new Date(ts), t = new Date(), y = new Date(t); y.setDate(t.getDate() - 1);
    var same = function (a, b) { return a.toDateString() === b.toDateString(); };
    if (same(d, t)) return 'Today';
    if (same(d, y)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function ensureFamily(d) {
    ui.view = 'notifications';
    ui.family = d.querySelector('#hn-family');
  }

  function showView(v) {
    ui.view = v;
    var head = ui.drawer.querySelector('.hn-head');
    var title = ui.drawer.querySelector('#hn-drawer-title');
    var markAll = ui.drawer.querySelector('#hn-mark-all');
    ui.list.hidden = v === 'family';
    ui.family.hidden = v !== 'family';
    if (v === 'family') {
      title.textContent = 'Family 💬';
      markAll.hidden = true;
      renderFamily();
      refreshFamily().then(function () { markFamRead(); });
    } else {
      title.textContent = 'Notifications';
      markAll.hidden = false;
      renderList();
    }
    var back = head.querySelector('#hn-back');
    if (!back && v === 'family') {
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'hn-btn hn-btn-ghost';
      back.id = 'hn-back';
      back.textContent = '‹ Back';
      back.addEventListener('click', function () { showView('notifications'); });
      head.insertBefore(back, head.firstChild);
    }
    if (back) back.hidden = v !== 'family';
  }

  function renderFamily() {
    if (!ui.family || ui.view !== 'family') return;
    var msgs = state.fam || [];
    var html = '';
    if (state.linkReqs && state.linkReqs.length) {
      state.linkReqs.forEach(function (rq) {
        html +=
          '<div class="fam-req" role="group" aria-label="Family link request">' +
            '<div class="fam-req-title">🔗 ' + esc(rq.parent_name || 'A parent') + ' wants to connect with you</div>' +
            '<div class="fam-req-sub">Accept to share your progress and get their messages.</div>' +
            '<div class="fam-req-actions">' +
              '<button type="button" class="fam-req-btn yes" data-link-accept="' + rq.link_id + '">Accept</button>' +
              '<button type="button" class="fam-req-btn no" data-link-decline="' + rq.link_id + '">Not now</button>' +
            '</div>' +
          '</div>';
      });
    }
    if (!msgs.length) {
      html += '<div class="hn-empty"><span>👨\u200d👩\u200d👧</span>' +
        'No family messages yet. When your parent sends encouragement, it lands here!</div>';
    } else {
      var lastDay = null;
      msgs.slice().reverse().forEach(function (m) {
        var day = dayLabel(m.created_at);
        if (day !== lastDay) {
          html += '<div class="fam-day">' + esc(day) + '</div>';
          lastDay = day;
        }
        var unread = !(m.is_read === true || m.is_read === 1);
        html +=
          '<div class="fam-msg' + (unread ? ' unread' : '') + '">' +
            '<div class="fam-ava">👨\u200d👩</div>' +
            '<div class="fam-bubble">' +
              '<div class="fam-subject">' + esc(m.subject) + '</div>' +
              '<div class="fam-body">' + esc(m.content) + '</div>' +
              '<div class="fam-time">' + esc(m.parent_name || 'Parent') + ' · ' +
                new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
                (unread ? ' <span class="fam-new">NEW</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
      });
    }
    html +=
      '<div class="fam-note">🐼 Messages from your parent appear here the moment they send them.</div>';
    ui.family.innerHTML = html;
  }

  function markFamRead() {
    var unread = (state.fam || []).filter(function (m) { return !(m.is_read === true || m.is_read === 1); });
    if (!unread.length) return;
    Promise.all(unread.map(function (m) {
      return api('/messages/' + encodeURIComponent(m.message_id) + '/read', { method: 'POST' });
    })).then(function () {
      state.famUnread = 0;
      state.fam = state.fam.map(function (m) { m.is_read = true; return m; });
      paint();
      if (ui.view === 'family') renderFamily();
    }).catch(function () {});
  }

  /* ── UI ── */
  var ui = {};

  function injectStyles() {
    if (document.getElementById('hn-style')) return;
    var s = document.createElement('style');
    s.id = 'hn-style';
    s.textContent = [
      '#hn-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;',
      'border-radius:999px;border:1px solid rgba(213,227,240,.9);background:rgba(255,255,255,.7);color:#1E3A5F;',
      'cursor:pointer;transition:background .18s,color .18s,transform .18s;flex-shrink:0;font-family:inherit;}',
      '#hn-bell svg{width:19px;height:19px;display:block;}',
      '#hn-bell:hover{background:#EFF6FF;color:#2563EB;}',
      '#hn-bell:focus-visible{outline:3px solid #7DD3FC;outline-offset:2px;}',
      '#hn-bell .hn-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;',
      'border-radius:999px;background:#E63946;color:#fff;font-weight:900;font-size:10.5px;line-height:18px;',
      'text-align:center;display:none;box-shadow:0 2px 8px rgba(230,57,70,.4);}',
      '#hn-float-bell{position:fixed;top:calc(12px + env(safe-area-inset-top, 0px));right:12px;z-index:1200;}',
      '#hn-float-bell #hn-bell{width:46px;height:46px;background:rgba(255,255,255,.94);box-shadow:0 10px 26px rgba(15,35,64,.16);}',
      '.fam-req{background:linear-gradient(135deg,#ECFDF5,#EFF6FF);border:1px solid #A7F3D0;border-radius:16px;padding:12px;margin-bottom:10px;}',
      '.fam-req-title{font-weight:900;font-size:.85rem;color:#065F46;}',
      '.fam-req-sub{font-size:.72rem;color:#065F46;opacity:.8;margin:4px 0 10px;}',
      '.fam-req-actions{display:flex;gap:8px;}',
      '.fam-req-btn{flex:1;border:0;border-radius:999px;padding:10px 0;font-weight:900;font-size:.78rem;cursor:pointer;font-family:inherit;}',
      '.fam-req-btn.yes{background:#10B981;color:#fff;}',
      '.fam-req-btn.no{background:rgba(255,255,255,.7);color:#64748B;}',
      '.fam-req-btn:disabled{opacity:.6;cursor:default;}',
      '[data-theme="dark"] #hn-bell{background:rgba(18,40,58,.85);border-color:rgba(36,68,88,.85);color:#D9E6F2;}',
      '[data-theme="dark"] #hn-bell:hover{background:#123B56;color:#93C5FD;}',
      '#hn-drawer{position:fixed;inset:0;z-index:1300;display:none;}',
      '#hn-drawer.open{display:block;}',
      '#hn-drawer-overlay{position:absolute;inset:0;background:rgba(15,35,64,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}',
      '#hn-panel{position:absolute;right:0;top:0;bottom:0;width:min(400px,100vw);background:#fff;',
      'box-shadow:-18px 0 50px rgba(15,35,64,.22);display:flex;flex-direction:column;padding:18px 16px calc(16px + env(safe-area-inset-bottom, 0px));',
      'transform:translateX(100%);transition:transform .3s cubic-bezier(.22,.9,.35,1);}',
      '#hn-drawer.open #hn-panel{transform:translateX(0);}',
      '.hn-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;}',
      '.hn-head h2{font-size:18px;font-weight:900;color:#0F2340;margin:0;flex:1;font-family:Nunito,Inter,sans-serif;}',
      '.hn-btn{border:0;border-radius:999px;padding:9px 14px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit;transition:transform .15s,box-shadow .15s;}',
      '.hn-btn:focus-visible{outline:3px solid #7DD3FC;outline-offset:2px;}',
      '.hn-btn-primary{background:#2563EB;color:#fff;box-shadow:0 8px 18px rgba(37,99,235,.22);}',
      '.hn-btn-primary:hover{background:#1D4ED8;}',
      '.hn-btn-ghost{background:#F5F9FF;color:#1E3A5F;}',
      '.hn-btn-ghost:hover{background:#EFF6FF;}',
      '#hn-list{overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px;}',
      '.hn-item{display:flex;gap:12px;padding:13px 14px;border:1px solid rgba(213,227,240,.9);border-radius:18px;background:#fff;}',
      '.hn-item.unread{border-color:#BFDBFE;background:#F5F9FF;}',
      '.hn-item-ic{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;}',
      '/* family thread */',
      '.fam-entry{cursor:pointer;transition:background .15s;}',
      '.fam-entry:hover{background:var(--blue-50,#EFF6FF);}',
      '#hn-family{padding:6px 16px 18px;overflow-y:auto;}',
      '#hn-family[hidden],#hn-list[hidden]{display:none!important;}',
      '.fam-day{text-align:center;font-size:11px;font-weight:800;color:#64748B;margin:12px 0 8px;letter-spacing:.04em;text-transform:uppercase;}',
      '.fam-msg{display:flex;gap:8px;margin:8px 0;}',
      '.fam-ava{width:36px;height:36px;border-radius:12px;background:#ECFDF5;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}',
      '.fam-bubble{background:#F8FAFC;border:1px solid rgba(213,227,240,.7);border-radius:4px 18px 18px 18px;padding:10px 14px;max-width:85%;}',
      '.fam-msg.unread .fam-bubble{background:#EFF6FF;border-color:#BFDBFE;}',
      '.fam-subject{font-weight:800;font-size:14px;color:#0F2340;}',
      '.fam-body{font-size:14px;color:#334155;line-height:1.55;margin-top:2px;white-space:pre-wrap;}',
      '.fam-time{font-size:11px;color:#94A3B8;margin-top:6px;font-weight:600;}',
      '.fam-new{background:#2563EB;color:#fff;font-size:9px;font-weight:900;border-radius:999px;padding:2px 7px;letter-spacing:.06em;vertical-align:1px;}',
      '.fam-note{text-align:center;font-size:12px;color:#94A3B8;margin:16px 8px 4px;line-height:1.5;}',
      '.hn-item-title{font-weight:800;font-size:13.5px;color:#0F2340;}',
      '.hn-item-msg{font-size:12.5px;color:#5D7A9A;line-height:1.5;margin-top:2px;overflow-wrap:break-word;}',
      '.hn-item-time{font-size:11px;color:#8BA8C4;margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;}',
      '.hn-item-btn{border:0;background:none;color:#2563EB;font-weight:800;font-size:11px;cursor:pointer;padding:2px 6px;border-radius:8px;font-family:inherit;}',
      '.hn-item-btn:hover{background:#EFF6FF;}',
      '.hn-empty{text-align:center;padding:44px 12px;color:#5D7A9A;font-weight:700;font-size:13.5px;}',
      '.hn-empty span{display:block;font-size:44px;margin-bottom:10px;}',
      '@media (prefers-reduced-motion: reduce){#hn-panel{transition:none;}}',
      '[data-theme="dark"] #hn-panel{background:#12283A;}',
      '[data-theme="dark"] .hn-head h2,[data-theme="dark"] .hn-item-title{color:#F1F5F9;}',
      '[data-theme="dark"] .hn-item{background:#0E2233;border-color:rgba(36,68,88,.85);}',
      '[data-theme="dark"] .hn-item.unread{background:#123B56;border-color:#1D4ED8;}',
      '[data-theme="dark"] .hn-item-msg{color:#A9BDCC;}',
      '[data-theme="dark"] .hn-btn-ghost{background:#123B56;color:#D9E6F2;}',
      '[data-theme="dark"] .hn-item-btn{color:#93C5FD;}'
    ].join('');
    document.head.appendChild(s);
  }

  function bellMarkup() {
    return '<button type="button" id="hn-bell" aria-label="Notifications" aria-haspopup="dialog" aria-expanded="false">' +
      BELL_SVG + '<span class="hn-badge" id="hn-badge"></span></button>';
  }

  function mountBell() {
    if (ui.bell) return;
    injectStyles();
    var hudSlot = document.getElementById('hud-bell-slot');
    var mobile = window.matchMedia('(max-width: 1024px)').matches;

    if (hudSlot && mobile) {
      /* Docked into the mobile HUD strip (injected by bottom-nav.js). */
      ui.bell = hudSlot;
      ui.floating = false;
      ui.bell.innerHTML = bellMarkup();
    } else {
      var nav = document.querySelector('nav.nav');
      if (nav && !mobile) {
        ui.bell = document.createElement('span');
        ui.bell.style.display = 'inline-flex';
        ui.floating = false;
        ui.bell.innerHTML = bellMarkup();
        var actions = nav.querySelector('.nav-actions');
        var chip = nav.querySelector('.nav-user-chip');
        if (actions && actions.parentNode === nav) nav.insertBefore(ui.bell, actions);
        else if (chip) nav.insertBefore(ui.bell, chip);
        else nav.appendChild(ui.bell);
        ui.bell.style.marginRight = '10px';
      } else {
        var wrap = document.createElement('div');
        wrap.id = 'hn-float-bell';
        wrap.innerHTML = bellMarkup();
        document.body.appendChild(wrap);
        ui.bell = wrap;
        ui.floating = true;
      }
    }
    ui.bellBtn = document.getElementById('hn-bell');
    ui.badge = document.getElementById('hn-badge');
    ui.bellBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openDrawer();
    });
  }

  function remount() {
    if (!uid()) return;
    if (ui.bell) {
      if (ui.bellBtn) ui.bellBtn.blur();
      var wasFloating = ui.floating;
      ui.bell.innerHTML = '';
      if (wasFloating) ui.bell.remove();
      ui.bell = null; ui.bellBtn = null; ui.badge = null;
    }
    mountBell();
    paint();
  }
  document.addEventListener('hanverse:hud-ready', remount);

  function ensureDrawer() {
    if (ui.drawer) return;
    var d = document.createElement('div');
    d.id = 'hn-drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', 'Notifications');
    d.innerHTML =
      '<div id="hn-drawer-overlay"></div>' +
      '<div id="hn-panel">' +
        '<div class="hn-head">' +
          '<h2 id="hn-drawer-title">Notifications</h2>' +
          '<button type="button" class="hn-btn hn-btn-ghost" id="hn-mark-all">Mark all read</button>' +
          '<button type="button" class="hn-btn hn-btn-primary" id="hn-close">Done</button>' +
        '</div>' +
        '<div id="hn-list" aria-live="polite"></div>' +
        '<div id="hn-family" hidden></div>' +
      '</div>';
    document.body.appendChild(d);
    ui.drawer = d;
    ui.list = d.querySelector('#hn-list');
    d.querySelector('#hn-drawer-overlay').addEventListener('click', closeDrawer);
    d.querySelector('#hn-close').addEventListener('click', closeDrawer);
    d.querySelector('#hn-mark-all').addEventListener('click', markAllRead);
    d.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-link-accept],[data-link-decline]') : null;
      if (!t) return;
      if (t.hasAttribute('data-link-accept')) respondLink(t.getAttribute('data-link-accept'), 'accept', t);
      else respondLink(t.getAttribute('data-link-decline'), 'decline', t);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.classList.contains('open')) closeDrawer();
    });
    ensureFamily(d);
  }

  function openDrawer() {
    ensureDrawer();
    ui.drawer.classList.add('open');
    ui.bellBtn.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new CustomEvent('hanverse:drawer-open'));
    refresh();
  }

  function closeDrawer() {
    if (!ui.drawer) return;
    ui.drawer.classList.remove('open');
    if (ui.bellBtn) ui.bellBtn.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new CustomEvent('hanverse:drawer-close'));
  }

  function paint() {
    if (!ui.bellBtn) return;
    var total = state.unread + state.famUnread;
    if (ui.badge) {
      ui.badge.textContent = total > 9 ? '9+' : String(total);
      ui.badge.style.display = total > 0 ? 'block' : 'none';
    }
    if (ui.drawer && ui.drawer.classList.contains('open')) {
      if (ui.view === 'family') renderFamily(); else renderList();
    }
  }

  function renderList() {
    if (!ui.list) return;
    ui.list.innerHTML = '';
    /* Family entry — pinned to the top of the notifications list. */
    var li = document.createElement('div');
    li.className = 'hn-item fam-entry';
    li.setAttribute('role', 'button');
    li.tabIndex = 0;
    li.innerHTML =
      '<div class="hn-item-ic" style="background:#ECFDF5">💬</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="hn-item-title">Family messages</div>' +
        '<div class="hn-item-msg">' + (state.famUnread > 0
          ? state.famUnread + ' unread from your parent'
          : 'You\u2019re all caught up') + '</div>' +
      '</div>' +
      '<span style="color:var(--blue);font-weight:800">›</span>';
    var openFam = function () { showView('family'); };
    li.addEventListener('click', openFam);
    li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFam(); } });
    ui.list.appendChild(li);
    if (!state.items.length) {
      ui.list.insertAdjacentHTML('beforeend',
        '<div class="hn-empty"><span>🐼</span>All quiet! Lesson reminders and achievements land here.</div>');
      return;
    }
    state.items.forEach(function (n) {
      var meta = TYPE_META[n.type] || TYPE_META.system;
      var el = document.createElement('div');
      el.className = 'hn-item' + ((n.is_read === true || n.is_read === 1) ? '' : ' unread');
      el.innerHTML =
        '<div class="hn-item-ic" style="background:' + meta.tint + '">' + meta.icon + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="hn-item-title">' + escapeHtml(n.title) + '</div>' +
          '<div class="hn-item-msg">' + escapeHtml(n.message) + '</div>' +
          '<div class="hn-item-time"><span>' + escapeHtml(relativeTime(n.created_at)) + '</span>' +
          ((n.is_read === true || n.is_read === 1) ? '' :
            '<button type="button" class="hn-item-btn" data-id="' + escapeHtml(n.notification_id) + '">Mark read</button>') +
          '</div>' +
        '</div>';
      var btn = el.querySelector('.hn-item-btn');
      if (btn) btn.addEventListener('click', function () { markOne(btn.getAttribute('data-id')); });
      ui.list.appendChild(el);
    });
  }

  /* Toasts for unread items on first load (max 3, auto-dismiss). */
  var toastWrap = null;
  function ensureToastWrap() {
    if (toastWrap && toastWrap.isConnected) return toastWrap;
    /* Family toasts open the thread; everything else just dismisses. */
    toastWrap = document.createElement('div');
    toastWrap.style.cssText = 'position:fixed;top:74px;left:50%;transform:translateX(-50%);z-index:1299;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:min(92vw,420px);';
    toastWrap.addEventListener('click', function (e) {
      var t = e.target.closest('.hn-toast');
      if (!t || e.target.closest('.hn-toast-close')) return;
      closeDrawer();
      showView('family');
      t.remove();
    });
    document.body.appendChild(toastWrap);
    return toastWrap;
  }
  function showToast(n) {
    if (!ensureToastWrap()) return;
    var meta = TYPE_META[n.type] || TYPE_META.system;
    var t = document.createElement('div');
    t.className = 'hn-toast';
    t.setAttribute('role', 'status');
    t.style.cssText = 'pointer-events:auto;display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid rgba(213,227,240,.9);border-radius:16px;box-shadow:0 14px 34px rgba(15,35,64,.18);padding:12px 14px;width:100%;';
    t.innerHTML =
      '<div class="hn-item-ic" style="background:' + meta.tint + ';width:36px;height:36px;font-size:17px">' + meta.icon + '</div>' +
      '<div style="flex:1;min-width:0"><div class="hn-item-title">' + escapeHtml(n.title) + '</div>' +
      '<div class="hn-item-msg">' + escapeHtml(n.message) + '</div></div>';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.className = 'hn-toast-close';
    close.style.cssText = 'border:0;background:none;color:#8BA8C4;font-size:16px;cursor:pointer;padding:2px 4px;';
    close.textContent = '✕';
    close.addEventListener('click', function () { t.remove(); });
    t.appendChild(close);
    toastWrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  function boot() {
    if (document.body && document.body.dataset.notifications === 'off') return;
    if (!uid()) return;
    mountBell();
    refresh().then(function (s) {
      if (!s) return;
      /* Only toast notifications that arrived after the visitor's last
         session — replaying every unread on every page load covered the
         page header for six seconds each time. */
      var lastSeen = 0;
      try { lastSeen = Number(localStorage.getItem('hn_notif_last_seen')) || 0; } catch (e) {}
      var fresh = state.items.filter(function (n) {
        return !(n.is_read === true || n.is_read === 1) &&
          new Date(n.created_at || 0).getTime() > lastSeen;
      }).slice(0, 2);
      fresh.forEach(showToast);
      try { localStorage.setItem('hn_notif_last_seen', String(Date.now())); } catch (e) {}
    });
    /* Smart polling: notifications every 60s; family thread every 20s while
       the tab is visible, an instant check on refocus, paused when hidden. */
    window.setInterval(refresh, 60000);
    window.setInterval(function () {
      if (document.visibilityState === 'visible') refreshFamily().catch(function () {});
    }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { refresh(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('resize', function () {
    if (!ui.bell) return;
    var mobile = window.matchMedia('(max-width: 1024px)').matches;
    if (mobile !== !!ui.floating) remount();
  });

  window.HanverseNotifications = {
    init: boot,
    refresh: refresh,
    refreshFamily: refreshFamily,
    markAllRead: markAllRead,
    get count() { return state.unread + state.famUnread; },
    get familyCount() { return state.famUnread; }
  };
})();
