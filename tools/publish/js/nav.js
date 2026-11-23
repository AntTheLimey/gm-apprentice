(function() {
  // Keyboard shortcut: Cmd+K / Ctrl+K for search
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (typeof openSearch === 'function') openSearch();
    }
  });

  // The menu buttons say aria-expanded, so a screen reader knows whether their menu is open.
  var mobileNav = document.getElementById('mobile-nav');
  var menuButton = document.querySelector('.nav-mobile-toggle');
  // A link standing in for a menu button (the lone Story entry) opens nothing, so it says nothing.
  function sayExpanded(btn, open) {
    if (btn && btn.tagName !== 'A') btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function setMobileOpen(open) {
    if (!mobileNav) return;
    if (open) mobileNav.classList.add('open'); else mobileNav.classList.remove('open');
    if (menuButton) menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeGroups() {
    document.querySelectorAll('.nav-group').forEach(function(g) {
      g.classList.remove('open');
      sayExpanded(g.querySelector('.nav-group-toggle'), false);
    });
  }

  // Only a header marked data-nav="js" leaves its menu clicks to this script. A page an older
  // build wrote has them inline (a sheets-only build leaves such pages alone), and binding
  // them here too would toggle each menu twice.
  var topNav = document.querySelector('.top-nav');
  var marked = !!topNav && topNav.getAttribute('data-nav') === 'js';

  // A long title and many menu entries can be wider than a tablet (#863). The stylesheet cuts the title short first;
  // when that leaves it under 9rem, or the bar still runs past the window, the bar takes the phone menu instead.
  // Measured with the menu shown, again whenever the window's width changes, and once the site's fonts have loaded.
  function fitBar() {
    if (!topNav) return;
    topNav.classList.remove('nav-crowded');
    var groups = topNav.querySelector('.nav-groups');
    if (!groups || getComputedStyle(groups).display === 'none') return;
    var brand = topNav.querySelector('.nav-brand');
    var floor = 9 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    var cut = !!brand && brand.scrollWidth > brand.clientWidth && brand.clientWidth < floor;
    if (cut || topNav.scrollWidth > topNav.clientWidth) {
      closeGroups();
      topNav.classList.add('nav-crowded');
    }
  }
  fitBar();
  var fitWidth = window.innerWidth;
  window.addEventListener('resize', function() {
    if (window.innerWidth === fitWidth) return;
    fitWidth = window.innerWidth;
    fitBar();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitBar);

  if (marked) document.querySelectorAll('.nav-group-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var group = btn.parentElement;
      var wasOpen = group.classList.contains('open');
      closeGroups();
      if (!wasOpen) {
        group.classList.add('open');
        sayExpanded(btn, true);
      }
    });
  });
  if (marked) document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-group')) closeGroups();
  });

  if (marked && menuButton) menuButton.addEventListener('click', function() { setMobileOpen(true); });
  if (marked && mobileNav) {
    // Close mobile nav on link click
    mobileNav.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() { setMobileOpen(false); });
    });
    // The close button hides the menu, itself included, so it hands the focus back too.
    var closeButton = mobileNav.querySelector('.mobile-nav-close');
    if (closeButton) closeButton.addEventListener('click', function() {
      setMobileOpen(false);
      if (menuButton) menuButton.focus();
    });
  }

  // Close the menus on Escape. A menu that held the focus hands it back to the button
  // that opened it: its links are hidden now, and focus left on one of them is lost.
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var focused = document.activeElement;
    if (mobileNav && mobileNav.classList.contains('open')) {
      setMobileOpen(false);
      if (menuButton && mobileNav.contains(focused)) menuButton.focus();
    }
    document.querySelectorAll('.nav-group.open').forEach(function(g) {
      g.classList.remove('open');
      var toggle = g.querySelector('.nav-group-toggle');
      sayExpanded(toggle, false);
      if (toggle && g.contains(focused)) toggle.focus();
    });
  });
})();
