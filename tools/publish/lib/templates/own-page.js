'use strict';

// A page of the GM's own on the site (player_site.own_pages, #850): one an after_build step puts there, such as Dead
// End's star map. The build moves it aside (`map/index.html` -> `map/index.own.html`) and writes in its place a site
// page with the menu bar, the page itself in a frame filling the window below the bar. The GM's page needs no change:
// it keeps the whole frame, sized as its window, and the bar's menus, search and keys stay in the site page, so a
// click, a scroll or Esc there never reaches it. Opened on its own, it works as it always did.
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { escapeHtml } = require('../processor');

// The marker a framed page carries, so a rebuild that finds one at the address renders it again rather than
// framing the frame.
const FRAME_MARK = '<meta name="gm-apprentice-own-page">';

// Where the GM's page is kept: next to the address, `.own.html` for `.html`.
function ownFileOf(address) {
  return address.replace(/\.html?$/i, '') + '.own.html';
}

// In the site page: the frame opens at the address's #fragment (the GM's page may read one, as the star map reads a
// system's name) and follows it when it changes. A link in the GM's page that leaves it opens in the whole window,
// as it would without the frame; a link within it (a #fragment) and a link with a target of its own are left alone.
// A browser that keeps the two pages apart (a file opened from disk) keeps such links in the frame. The frame takes the
// keyboard when it loads, and may go full screen.
const FRAME_SCRIPT = `<script>
(function() {
  var frame = document.querySelector('.own-page-frame');
  if (!frame) return;
  var src = frame.getAttribute('data-src');
  function open() { frame.src = src + location.hash; }
  open();
  window.addEventListener('hashchange', open);
  frame.addEventListener('load', function() {
    // Keys go to the GM's page, as they would with it alone in the window.
    try { frame.contentWindow.focus(); } catch (e) { frame.focus(); }
    var doc;
    try { doc = frame.contentDocument; } catch (e) { return; }
    if (!doc) return;
    doc.addEventListener('click', function(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      var target = a && a.getAttribute('target');
      if (!a || (target && target !== '_self')) return;
      var to = new URL(a.getAttribute('href'), doc.baseURI);
      if (!/^(https?|file):$/.test(to.protocol)) return;
      var here = frame.contentWindow.location;
      if (to.origin === here.origin && to.pathname === here.pathname) return;
      e.preventDefault();
      window.location.href = to.href;
    });
  });
})();
</script>`;

// The site page for an own page at `address`, titled `title`.
function ownPageTemplate(address, title, navFor, config, publishConfig) {
  const own = ownFileOf(address).split('/').pop();
  return baseShell({
    pageType: 'own-page',
    title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(address),
    navHtml: navFor(address, config),
    rootHref: rootPath(address),
    content: `<iframe class="own-page-frame" data-src="${escapeHtml(encodeURIComponent(own))}" title="${escapeHtml(title)}" allow="fullscreen" allowfullscreen></iframe>
${FRAME_SCRIPT}`,
    footer: config.footer,
    genrePreset: publishConfig._genrePreset,
    overridesCss: publishConfig._overridesCss,
    scripts: clientScripts(address),
    bodyAttrs: ' class="own-page"',
  }).replace('<head>\n', `<head>\n  ${FRAME_MARK}\n`);
}

// The title for the site page: the GM's page's own <title>, less a " — Site Title" ending, else its file name.
function ownPageTitle(html, address, siteTitle) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  const decode = (s) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let title = m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
  const suffix = ` — ${siteTitle}`;
  if (siteTitle && title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  if (title) return title;
  const name = address.split('/').filter(Boolean);
  const file = (name.pop() || '').replace(/\.html?$/i, '');
  return file === 'index' && name.length ? name.pop() : file;
}

module.exports = { ownPageTemplate, ownPageTitle, ownFileOf, FRAME_MARK };
