// Link previews: a small card beside a link to another page of the site.
// The cards come from previews.json at the site root; every value is set as
// text, never as markup. If the file cannot be had, every link behaves as before.
(function () {
  'use strict';

  var GAP = 8;
  var MARGIN = 12;
  var OPEN_DELAY = 300;
  var CLOSE_DELAY = 150;
  var SKIP = 'nav, .breadcrumbs, [data-no-preview], .link-preview, svg';

  function decode(s) {
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  function pathKey(url, rootUrl) {
    var path = decode(url.pathname);
    var base = decode(new URL(rootUrl).pathname);
    if (path === null || base === null || path.indexOf(base) !== 0) return null;
    return path.slice(base.length);
  }

  // The output path a link points at, or null when it is not another page of this site.
  function keyFor(href, pageUrl, rootUrl) {
    var url, page;
    try {
      url = new URL(href, pageUrl);
      page = new URL(pageUrl);
      if (url.origin !== page.origin || url.origin !== new URL(rootUrl).origin) return null;
    } catch (e) { return null; }
    var key = pathKey(url, rootUrl);
    if (!key || key === pathKey(page, rootUrl)) return null;
    return key;
  }

  function placeCard(link, card, view) {
    var maxLeft = view.width - card.width - MARGIN;
    var left = Math.max(MARGIN, Math.min(link.left, maxLeft));
    var top = link.bottom + GAP;
    if (top + card.height > view.height && link.top - GAP - card.height >= 0) {
      top = link.top - GAP - card.height;
    }
    return { left: left + view.scrollX, top: top + view.scrollY };
  }

  function qualifies(anchor) {
    if (!anchor || !anchor.closest) return false;
    if (!anchor.closest('main.content')) return false;
    return !anchor.closest(SKIP);
  }

  function tapAction(state, link, pointerType, mode) {
    return pointerType === 'touch' && mode === 'on' && state.owner !== link ? 'open' : 'follow';
  }

  var api = { keyFor: keyFor, placeCard: placeCard, qualifies: qualifies, tapAction: tapAction };

  function init(doc, win) {
    var main = doc.querySelector('main.content');
    var mode = main && main.dataset && main.dataset.previews;
    if (mode !== 'on' && mode !== 'desktop') return;

    var brand = doc.querySelector('.nav-brand');
    var href = brand && brand.getAttribute('href');
    var base = href ? href.replace('index.html', '') : './';
    var pageUrl = win.location.href;
    var rootUrl;
    try { rootUrl = new URL(base || './', pageUrl).href; } catch (e) { return; }

    var state = {
      cards: null, loading: null, failed: false,
      card: null, owner: null, touch: false, prior: null,
      hover: null, openT: 0, closeT: 0, lastPointer: 'mouse'
    };

    function load() {
      if (state.cards || state.failed) return state.loading || Promise.resolve();
      if (state.loading) return state.loading;
      try {
        state.loading = fetch(base + 'previews.json')
          .then(function (r) {
            if (!r || r.ok === false) throw new Error('no previews');
            return r.text ? r.text().then(JSON.parse) : r.json();
          })
          .then(function (data) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad previews');
            state.cards = data;
          })
          .catch(function () { state.failed = true; });
      } catch (e) {
        state.failed = true;
        state.loading = Promise.resolve();
      }
      return state.loading;
    }

    function linkOf(target) {
      var a = target && target.closest ? target.closest('a[href]') : null;
      return a && qualifies(a) && keyOf(a) ? a : null;
    }

    function keyOf(link) {
      return keyFor(link.getAttribute('href'), pageUrl, rootUrl);
    }

    function cardFor(link) {
      if (!state.cards) return null;
      var key = keyOf(link);
      if (!key || !Object.prototype.hasOwnProperty.call(state.cards, key)) return null;
      var card = state.cards[key];
      return validCard(card) ? card : null;
    }

    function isText(v) { return v === undefined || typeof v === 'string'; }

    function validCard(c) {
      if (!c || typeof c !== 'object' || typeof c.t !== 'string' || typeof c.k !== 'string') return false;
      if (!isText(c.x) || !isText(c.i)) return false;
      if (c.f === undefined) return true;
      return Array.isArray(c.f) && c.f.every(function (f) {
        return Array.isArray(f) && typeof f[0] === 'string' && typeof f[1] === 'string';
      });
    }

    function imageSrc(path) {
      var parts = path.split('/');
      var ok = parts.every(function (p) { return p && p !== '.' && p !== '..'; });
      return ok ? base + parts.map(encodeURIComponent).join('/') : null;
    }

    function text(tag, cls, value) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (value !== undefined) e.textContent = String(value);
      return e;
    }

    function build(data, link, withOpen) {
      var card = text('div', 'link-preview');
      card.setAttribute('id', 'link-preview');
      card.setAttribute('role', 'tooltip');
      var head = text('div', 'lp-head');
      var src = data.i ? imageSrc(data.i) : null;
      if (src) {
        var img = text('img', 'lp-img');
        img.setAttribute('src', src);
        img.setAttribute('alt', '');
        img.setAttribute('loading', 'lazy');
        head.appendChild(img);
      }
      var who = text('div');
      who.appendChild(text('p', 'lp-name', data.t));
      var kind = text('div', 'lp-kind');
      kind.appendChild(text('span', null, data.k));
      if (data.d) kind.appendChild(text('span', 'lp-draft', 'Draft'));
      who.appendChild(kind);
      head.appendChild(who);
      card.appendChild(head);
      if (data.f && data.f.length) {
        var dl = text('dl', 'lp-facts');
        data.f.forEach(function (f) {
          dl.appendChild(text('dt', null, f[0]));
          dl.appendChild(text('dd', null, f[1]));
        });
        card.appendChild(dl);
      }
      if (data.x) card.appendChild(text('p', 'lp-text', data.x));
      if (withOpen) {
        var open = text('a', 'lp-open', 'Open page');
        open.setAttribute('href', link.getAttribute('href'));
        card.appendChild(open);
      }
      return card;
    }

    function clearTimers() {
      clearTimeout(state.openT);
      clearTimeout(state.closeT);
      state.openT = 0;
      state.closeT = 0;
    }

    function close() {
      clearTimers();
      if (state.owner) {
        if (state.prior === null) state.owner.removeAttribute('aria-describedby');
        else state.owner.setAttribute('aria-describedby', state.prior);
      }
      if (state.card && state.card.parentNode) state.card.parentNode.removeChild(state.card);
      state.card = null;
      state.owner = null;
      state.touch = false;
      state.prior = null;
    }

    function show(link, touch) {
      var data = cardFor(link);
      if (!data) return;
      close();
      var card = build(data, link, touch);
      doc.body.appendChild(card);
      var r = card.getBoundingClientRect();
      var l = link.getBoundingClientRect();
      var pos = placeCard(l, { width: r.width || 0, height: r.height || 0 }, {
        width: win.innerWidth || 0, height: win.innerHeight || 0,
        scrollX: win.pageXOffset || 0, scrollY: win.pageYOffset || 0
      });
      card.style.left = pos.left + 'px';
      card.style.top = pos.top + 'px';
      state.prior = link.getAttribute('aria-describedby');
      link.setAttribute('aria-describedby', 'link-preview');
      state.card = card;
      state.owner = link;
      state.touch = !!touch;
      card.addEventListener('pointerover', function () {
        clearTimeout(state.closeT);
        state.hover = link;
      });
      card.addEventListener('pointerout', function (e) {
        var to = e.relatedTarget;
        if (to && (card.contains(to) || (state.owner && state.owner.contains(to)))) return;
        state.hover = null;
        scheduleClose();
      });
    }

    function scheduleClose() {
      if (!state.card || state.touch) return;
      clearTimeout(state.closeT);
      state.closeT = setTimeout(close, CLOSE_DELAY);
    }

    main.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      state.lastPointer = 'mouse';
      var link = linkOf(e.target);
      if (!link || state.hover === link) return;
      state.hover = link;
      clearTimeout(state.closeT);
      clearTimeout(state.openT);
      if (state.owner === link) return;
      if (state.card && state.cards && !cardFor(link)) close();
      var swap = !!state.card;
      var go = function () {
        if (state.hover !== link) return;
        load().then(function () { if (state.hover === link) show(link, false); });
      };
      if (swap && state.cards) go();
      else state.openT = setTimeout(go, OPEN_DELAY);
    });

    main.addEventListener('pointerout', function (e) {
      if (e.pointerType === 'touch') return;
      var link = linkOf(e.target);
      if (!link || link !== state.hover) return;
      var to = e.relatedTarget;
      if (to && (link.contains(to) || (state.card && state.card.contains(to)))) return;
      state.hover = null;
      clearTimeout(state.openT);
      scheduleClose();
    });

    main.addEventListener('focusin', function (e) {
      var link = linkOf(e.target);
      if (!link || !link.matches || !link.matches(':focus-visible')) return;
      load().then(function () {
        if (doc.activeElement === link) show(link, false);
      });
    });

    main.addEventListener('focusout', function (e) {
      if (state.card && !state.touch && linkOf(e.target) === state.owner) close();
    });

    main.addEventListener('pointercancel', function () { state.lastPointer = 'mouse'; });

    main.addEventListener('pointerdown', function (e) {
      state.lastPointer = e.pointerType || 'mouse';
      var link = linkOf(e.target);
      if (state.lastPointer === 'touch' && link && keyOf(link)) load();
    });

    main.addEventListener('click', function (e) {
      var pointer = state.lastPointer;
      state.lastPointer = 'mouse';
      if (e.detail === 0) pointer = 'keyboard';
      var link = linkOf(e.target);
      if (!link || pointer !== 'touch' || !state.cards) return;
      if (!cardFor(link)) return;
      if (tapAction(state, link, pointer, mode) !== 'open') return;
      e.preventDefault();
      show(link, true);
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.card) close();
    });

    doc.addEventListener('pointerdown', function (e) {
      if (!state.card || !state.touch) return;
      var t = e.target;
      if (t && ((state.card.contains && state.card.contains(t)) || (state.owner.contains && state.owner.contains(t)))) return;
      close();
    });

    win.addEventListener('scroll', function () {
      if (state.card && state.touch) close();
    }, { passive: true });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined') init(document, window);
})();
