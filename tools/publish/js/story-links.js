// Story pages: the copy-link icon on a session heading. The link itself sets the address bar to
// #session-N; this also copies the full link and shows "Copied" for a moment.
(function () {
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* fall through */ }
      document.body.removeChild(box);
      return ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.story-anchor') : null;
    if (!a) return;
    var url = location.href.split('#')[0] + a.getAttribute('href');
    copy(url).then(function () {
      var label = a.getAttribute('aria-label');
      a.classList.add('copied');
      a.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        a.classList.remove('copied');
        a.setAttribute('aria-label', label);
      }, 1500);
    }, function () { /* the address bar still holds the link */ });
  });
})();
