const isMobileOrTablet = (ua = '') => /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|tablet|kindle|silk|playbook/i.test(ua);
const pathname = window.location.pathname;
const search = window.location.search || '';
const currentFile = pathname.split('/').pop();

if (isMobileOrTablet(navigator.userAgent)) {
  let appUrl;
  if (!currentFile || currentFile === 'index.html') {
    appUrl = '/index-app.html' + search;
  } else if (!currentFile.endsWith('-app.html') && currentFile.endsWith('.html')) {
    appUrl = pathname.replace(/\.html$/, '-app.html') + search;
  } else {
    appUrl = null;
  }

  if (appUrl) {
    fetch(appUrl, { method: 'HEAD' }).then(response => {
      if (response.ok) {
        console.log('Mobile device detected. Redirecting to app version:', appUrl);
        window.location.replace(appUrl);
      } else {
        console.log('Mobile device detected but no app version found for', appUrl);
      }
    }).catch(() => {
      console.log('Mobile device detected. App version redirect failed or unavailable.');
    });
  }
}
