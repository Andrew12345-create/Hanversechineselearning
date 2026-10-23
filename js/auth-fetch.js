/* Global auth fetch: attaches the signed-in user's JWT to same-origin API
   requests. Load this early (in <head>) on any page that calls the API so
   server routes can authenticate the caller.
   - Reads the token from localStorage 'hanverse_token' or the stored session.
   - Only touches /api/ and /.netlify/functions/ URLs on this origin.
   - Never overrides an Authorization header the caller already set
     (e.g. admin.html using its separate admin token). */
(function () {
  'use strict';

  if (window.__hanverseAuthFetch) return;
  window.__hanverseAuthFetch = true;

  function getToken() {
    try {
      var t = localStorage.getItem('hanverse_token');
      if (t) return t;
      var raw = localStorage.getItem('hanverse_user');
      if (raw) {
        var u = JSON.parse(raw);
        if (u && u.token) return u.token;
      }
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function isApiUrl(url) {
    if (typeof url !== 'string') return false;
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
      try { return new URL(url).origin === location.origin; } catch (e) { return false; }
    }
    return url.indexOf('/api/') === 0 ||
           url.indexOf('api/') === 0 ||
           url.indexOf('/.netlify/functions/') !== -1;
  }

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!nativeFetch) return;

  window.fetch = function (input, init) {
    try {
      var url = (input && typeof input === 'object' && input.url) ? input.url : input;
      if (isApiUrl(String(url))) {
        var token = getToken();
        if (token) {
          if (input && typeof input === 'object' && !(init && init.headers)) {
            input = new Request(input);
            input.headers.set('Authorization', 'Bearer ' + token);
            return nativeFetch(input, init);
          }
          init = init || {};
          var headers = new Headers(init.headers || undefined);
          if (!headers.has('Authorization')) {
            headers.set('Authorization', 'Bearer ' + token);
            init.headers = headers;
          }
          return nativeFetch(input, init);
        }
      }
    } catch (e) { /* fall through to native fetch */ }
    return nativeFetch(input, init);
  };
})();
