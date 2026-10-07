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
    // The close button hides the menu, itself included, so it hands the focus back too.
    var closeButton = mobileNav.querySelector('.mobile-nav-close');
    if (closeButton) closeButton.addEventListener('click', function() {
      var menuButton = document.querySelector('.nav-mobile-toggle');
      if (menuButton) menuButton.focus();
    });
  }

  // Close the menus on Escape. A menu that held the focus hands it back to the button
  // that opened it: its links are hidden now, and focus left on one of them is lost.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var focused = document.activeElement;
    if (mobileNav && mobileNav.classList.contains('open')) {
      mobileNav.classList.remove('open');
      var menuButton = document.querySelector('.nav-mobile-toggle');
      if (menuButton && mobileNav.contains(focused)) menuButton.focus();
    }
    document.querySelectorAll('.nav-group.open').forEach(function(g) {
      g.classList.remove('open');
      var toggle = g.querySelector('.nav-group-toggle');
      if (toggle && g.contains(focused)) toggle.focus();
    });
  });
})();
