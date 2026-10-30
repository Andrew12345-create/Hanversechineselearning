/* HanVerse feature client — tiny helpers for the feature-pack API.
   Reads the signed-in user from localStorage (same as nav-user.js). */
(() => {
  let cachedUser = null;
  function currentUserId() {
    if (cachedUser) return cachedUser.user_id;
    try {
      cachedUser = JSON.parse(localStorage.getItem('hanverse_user') || 'null');
    } catch { cachedUser = null; }
    return cachedUser && cachedUser.user_id ? cachedUser.user_id : null;
  }

  function getAuthToken() {
    try {
      const t = localStorage.getItem('hanverse_token');
      if (t) return t;
    } catch {}
    try {
      const u = JSON.parse(localStorage.getItem('hanverse_user') || 'null');
      if (u && u.token) return u.token;
    } catch {}
    return null;
  }

  async function api(path, opts = {}) {
    const token = getAuthToken();
    const res = await fetch(`/api${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Stale pre-token session: clear it so the whole UI falls back to
      // signed-out state, and tell the page so it can show sign-in CTAs.
      try {
        if (localStorage.getItem('hanverse_user')) {
          localStorage.removeItem('hanverse_user');
          localStorage.removeItem('hanverse_token');
          document.dispatchEvent(new CustomEvent('hanverse:session-expired'));
        }
      } catch {}
      console.warn('HanVerse features: session expired — sign in again to continue.');
    }
    if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  window.HanVerseFeatures = {
    currentUserId,
    api,
    /* Privacy-conscious product analytics: sends ONLY the event name to a
       counter endpoint — no ids, no page content, no child data. Honours
       Do-Not-Track. Fire-and-forget; failures are silently ignored. */
    track(event) {
      try {
        if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
        const known = ['page_view','signup_complete','lesson_start','lesson_complete',
          'game_complete','review_session','talk_session','paywall_view',
          'checkout_start','trial_start'];
        if (!known.includes(event)) return;
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event }),
          keepalive: true
        }).catch(() => {});
      } catch {}
    },
    quests: {
      get: uid => api(`/quests/daily/${uid}`),
      claimChest: uid => api('/quests/claim-chest', { method: 'POST', body: { userId: uid } })
    },
    mission: {
      get: uid => api(`/mission/daily/${uid}`),
      claim: uid => api('/mission/claim', { method: 'POST', body: { userId: uid } })
    },
    streak: {
      get: uid => api(`/streak/${uid}`),
      freeze: (uid, payWithGems) => api('/streak/freeze', { method: 'POST', body: { userId: uid, payWithGems } })
    },
    review: {
      deck: uid => api(`/review/deck/${uid}`),
      answer: (uid, word, quality, extra) => api('/review/answer', { method: 'POST', body: { userId: uid, word, quality, ...extra } }),
      enroll: (uid, words) => api('/review/enroll', { method: 'POST', body: { userId: uid, words } }),
      mistakes: uid => api(`/review/mistakes/${uid}`)
    },
    account: {
      delete: uid => api('/account/delete', { method: 'POST', body: { userId: uid } })
    },
    hearts: {
      get: uid => api(`/hearts/${uid}`),
      lose: uid => api('/hearts/lose', { method: 'POST', body: { userId: uid } }),
      refill: (uid, mode = 'gems') => api('/hearts/refill', { method: 'POST', body: { userId: uid, mode } })
    },
    leagues: {
      get: uid => api(`/leaderboard/league/${uid}`)
    },
    achievements: {
      list: uid => api(`/achievements/${uid}`),
      check: uid => api(`/achievements/check/${uid}`, { method: 'POST', body: { userId: uid } })
    },
    goals: {
      setTarget: (uid, targetXp) => api('/goals/target', { method: 'POST', body: { userId: uid, targetXp } })
    },
    placement: {
      grade: answers => api('/placement/grade', { method: 'POST', body: { answers } }),
      submit: (uid, answers) => api('/placement/submit', { method: 'POST', body: { userId: uid, answers } })
    },
    games: {
      session: (uid, game, score, correct, total) => api('/games/session', { method: 'POST', body: { userId: uid, game, score, correct, total } })
    },
    leaderboard: {
      weekly: uid => api(`/leaderboard/weekly/${uid}`),
      optIn: (uid, optIn) => api('/leaderboard/optin', { method: 'POST', body: { userId: uid, optIn } })
    },
    referrals: {
      stats: uid => api(`/referrals/stats/${uid}`)
    },
    trial: {
      start: uid => api('/trial/start', { method: 'POST', body: { userId: uid } }),
      status: uid => api(`/trial/status/${uid}`)
    },
    pet: {
      get: uid => api(`/pet/${uid}`)
    },
    gems: {
      get: uid => api(`/gems/${uid}`)
    },
    classroom: {
      join: (uid, classCode) => api('/classroom/join', { method: 'POST', body: { userId: uid, classCode } }),
      create: (className) => api('/classroom/create', { method: 'POST', body: { className } }),
      roster: (classCode) => api('/classroom/roster/' + encodeURIComponent(classCode)),
      leave: () => api('/classroom/leave', { method: 'POST', body: {} }),
      mine: () => api('/classroom/mine'),
      aggregate: (classCode) => api('/classroom/aggregate/' + encodeURIComponent(classCode)),
      mastery: (classCode) => api('/classroom/mastery/' + encodeURIComponent(classCode)),
      questProgress: (classCode) => api('/classroom/quest-progress/' + encodeURIComponent(classCode)),
      setQuest: (classCode, quest) => api('/classroom/quest', {
        method: 'POST',
        body: { classCode, ...quest }
      }),
      removeMember: (classCode, targetUserId) => api('/classroom/remove-member', {
        method: 'POST',
        body: { classCode, targetUserId }
      })
    }
  };

  /* ---------- Sound engine (WebAudio — no audio files) ---------- */
  let audioCtx = null;
  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  function tone(freq, start, dur, type = 'sine', vol = 0.12) {
    const c = ctx(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
  }
  const enabled = () => {
    try { return localStorage.getItem('hanverse_sound') !== 'off'; } catch { return true; }
  };
  window.HanVerseSound = {
    correct() { if (!enabled()) return; tone(523, 0, .12); tone(784, .1, .18); },
    wrong()   { if (!enabled()) return; tone(220, 0, .18, 'sawtooth', .08); tone(180, .12, .2, 'sawtooth', .08); },
    streak()  { if (!enabled()) return; tone(523, 0, .1); tone(659, .09, .1); tone(784, .18, .1); tone(1047, .27, .25); },
    levelUp() { if (!enabled()) return; [392, 523, 659, 784].forEach((f, i) => tone(f, i * .11, .22, 'triangle', .14)); },
    tap()     { if (!enabled()) return; tone(600, 0, .05, 'sine', .05); },
    chest()   { if (!enabled()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * .08, .3, 'triangle', .12)); },
    setEnabled(on) { try { localStorage.setItem('hanverse_sound', on ? 'on' : 'off'); } catch {} }
  };
  if (typeof document !== 'undefined') {
    window.HanVerseFeatures.track('page_view');
  }
})();
