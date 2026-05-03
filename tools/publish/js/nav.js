(function() {
  // Keyboard shortcut: Cmd+K / Ctrl+K for search
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (typeof openSearch === 'function') openSearch();
    }
  });

  // Close mobile nav on link click
  var mobileNav = document.getElementById('mobile-nav');
  if (mobileNav) {
    mobileNav.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() {
        mobileNav.classList.remove('open');
      });
    });
  }

  // Close mobile nav on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (mobileNav) mobileNav.classList.remove('open');
      document.querySelectorAll('.nav-group').forEach(function(g) { g.classList.remove('open'); });
    }
  });
})();
