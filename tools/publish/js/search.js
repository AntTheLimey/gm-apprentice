(function() {
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Percent-encode each segment of a search result's href. Mirrors lib/processor.js's
  // encodeHref (#145) — duplicated rather than imported because this file ships to the
  // browser as a static asset and can't `require('../lib/processor')`. doc.href is the raw
  // page.outputPath from search-index.json (lib/search-index.js deliberately stores it
  // unencoded — lunr ref keys and the documents map must match). A raw space merely looked
  // wrong via browser leniency; "#" or "?" in a vault folder/file name actively truncates or
  // corrupts the link.
  function encodeHref(hrefPath) {
    return String(hrefPath)
      .split('/')
      .map(function(segment) {
        return encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');
      })
      .join('/');
  }

  // Fold a query into the index's normal form (#139). lib/search-index.js indexes NFC, so a
  // query typed with decomposed accents can never match an NFC index unless it is folded the
  // same way. Guarded for pre-ES6 engines, where it degrades to the old exact-match behavior
  // rather than throwing. Exported (and asserted in test/search.test.js) because deleting it
  // breaks accented search in the browser while every server-side test stays green.
  function normalizeQuery(raw) {
    var q = String(raw == null ? '' : raw);
    return q.normalize ? q.normalize('NFC') : q;
  }

  // Typo-tolerant search (#267). Each term is matched three ways: exact (boost 10), prefix
  // `term*` (boost 5) and fuzzy edit-distance 1; exact and prefix hits are always listed
  // before fuzzy-only ones (see runSearch). Fuzzy only applies from MIN_FUZZY_LENGTH
  // characters: at edit distance 1 a 3-letter word matches most other 3-letter words
  // ("cat" ~ "bat", "cap", "car") and floods the list with junk, while from 4 characters a
  // one-letter slip in a name ("Aldric" for "Alderic") lands on very few unrelated terms.
  // Built with lunr's query builder rather than a query string, so no user input is ever
  // parsed as lunr syntax; a stray `foo:` or `~` cannot throw.
  var MIN_FUZZY_LENGTH = 4;

  function queryTerms(rawQuery, lunrLib) {
    var tokens = lunrLib.tokenizer(normalizeQuery(rawQuery)).map(function(t) { return t.toString(); });
    var terms = [];
    tokens.forEach(function(t) {
      var term = t.replace(/[*~^:+]/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (term && terms.indexOf(term) === -1) terms.push(term);
    });
    return terms;
  }

  // Lunr sums field scores, and the title field is boosted, so in one combined query a
  // fuzzy-only title hit could outrank an exact hit in a long page body. Run the exact and
  // prefix match first and list its results in score order, then append the fuzzy-only
  // results (those the first pass didn't find), also in score order.
  function runSearch(idx, rawQuery, lunrLib) {
    var terms = queryTerms(rawQuery, lunrLib);
    if (terms.length === 0) return [];
    try {
      var strict = idx.query(function(q) {
        terms.forEach(function(term) {
          q.term(term, { boost: 10 });
          q.term(term, { boost: 5, usePipeline: false, wildcard: lunrLib.Query.wildcard.TRAILING });
        });
      });
      var fuzzyTerms = terms.filter(function(t) { return t.length >= MIN_FUZZY_LENGTH; });
      if (fuzzyTerms.length === 0) return strict;
      var seen = {};
      strict.forEach(function(r) { seen[r.ref] = true; });
      var fuzzy = idx.query(function(q) {
        terms.forEach(function(term) {
          q.term(term, { boost: 10 });
          q.term(term, { boost: 5, usePipeline: false, wildcard: lunrLib.Query.wildcard.TRAILING });
          if (term.length >= MIN_FUZZY_LENGTH) q.term(term, { boost: 1, editDistance: 1 });
        });
      }).filter(function(r) { return !seen[r.ref]; });
      return strict.concat(fuzzy);
    } catch (e) {
      return [];
    }
  }

  // Focus trap for the modal panel. Given the focusable elements in DOM order, the active
  // element and Shift state, returns the element Tab should move to, or null to let the
  // browser move focus normally (focus is inside the list and not on an end). Focus that is
  // outside the list entirely is pulled back in, so Tab can never reach the page behind.
  function tabTarget(list, active, shift) {
    if (!list.length) return null;
    var i = list.indexOf(active);
    if (i === -1) return shift ? list[list.length - 1] : list[0];
    if (shift && i === 0) return list[list.length - 1];
    if (!shift && i === list.length - 1) return list[0];
    return null;
  }

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = {
        esc: esc, encodeHref: encodeHref, normalizeQuery: normalizeQuery,
        queryTerms: queryTerms, runSearch: runSearch, tabTarget: tabTarget, MIN_FUZZY_LENGTH: MIN_FUZZY_LENGTH
      };
    }
    return;
  }

  var searchOverlay = document.createElement('div');
  searchOverlay.className = 'search-overlay';
  searchOverlay.innerHTML =
    '<div class="search-modal" role="dialog" aria-modal="true" aria-label="Search">' +
      '<div class="search-input-wrap">' +
        '<input type="search" class="search-input" placeholder="Search..." aria-label="Search" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<kbd class="search-kbd">Esc</kbd>' +
        '<button type="button" class="search-close" aria-label="Close search">&times;</button>' +
      '</div>' +
      '<div class="search-results" aria-live="polite"></div>' +
    '</div>';
  document.body.appendChild(searchOverlay);

  var input = searchOverlay.querySelector('.search-input');
  var resultsDiv = searchOverlay.querySelector('.search-results');
  var idx = null;
  var docs = null;

  function loadIndex(cb) {
    if (idx) return cb();
    var rootHref = document.querySelector('.nav-brand');
    var base = rootHref ? rootHref.getAttribute('href').replace('index.html', '') : './';
    var script = document.createElement('script');
    script.src = base + 'js/lunr.js';
    script.onload = function() {
      fetch(base + 'search-index.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          idx = lunr.Index.load(data.index);
          docs = data.documents;
          cb();
        })
        .catch(function() {
          resultsDiv.innerHTML = '<div class="search-results-empty">Search unavailable</div>';
        });
    };
    document.head.appendChild(script);
  }

  function search(rawQuery) {
    var query = normalizeQuery(rawQuery);
    if (!idx || !query.trim()) {
      resultsDiv.innerHTML = query.trim() ? '<div class="search-results-empty">Loading...</div>' : '';
      return;
    }

    var results = runSearch(idx, query, lunr);

    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="search-results-empty">No results found</div>';
      return;
    }

    var grouped = {};
    results.slice(0, 20).forEach(function(r) {
      var doc = docs[r.ref];
      if (!doc) return;
      var type = doc.type || 'Other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(doc);
    });

    var rootHref = document.querySelector('.nav-brand');
    var base = rootHref ? rootHref.getAttribute('href').replace('index.html', '') : './';

    var html = '';
    for (var type in grouped) {
      html += '<div class="search-result-group"><h4>' + esc(type) + '</h4>';
      grouped[type].forEach(function(doc) {
        html += '<a class="search-result-item" href="' + esc(base + encodeHref(doc.href)) + '">' +
          '<strong>' + esc(doc.title) + '</strong>' +
          (doc.subtitle ? ' <span style="opacity:0.6">' + esc(doc.subtitle) + '</span>' : '') +
          '</a>';
      });
      html += '</div>';
    }
    resultsDiv.innerHTML = html;
  }

  var debounceTimer;
  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      search(input.value);
    }, 150);
  });

  var triggers = document.querySelectorAll('.nav-search-btn, .nav-search-icon-btn');
  var lastTrigger = null;
  var clickedTrigger = null;

  // Safari does not focus a button on click, so document.activeElement is <body> when
  // openSearch runs. Remember the clicked trigger explicitly (capture phase, so it is set
  // before the inline onclick calls openSearch) and restore focus to it on close.
  Array.prototype.forEach.call(triggers, function(b) {
    b.addEventListener('click', function() { clickedTrigger = b; }, true);
  });

  function setExpanded(open) {
    Array.prototype.forEach.call(triggers, function(b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }

  function closeSearch() {
    if (!searchOverlay.classList.contains('open')) return;
    searchOverlay.classList.remove('open');
    setExpanded(false);
    var back = lastTrigger;
    // A link in a menu that Escape has just closed is hidden; its menu's button stands in.
    if (back && back.offsetParent === null && back.closest) {
      var group = back.closest('.nav-group');
      back = group ? group.querySelector('.nav-group-toggle') : null;
    }
    if (back && back.offsetParent !== null) back.focus();
    lastTrigger = null;
  }

  window.openSearch = function() {
    lastTrigger = clickedTrigger ||
      (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);
    clickedTrigger = null;
    searchOverlay.classList.add('open');
    setExpanded(true);
    input.value = '';
    resultsDiv.innerHTML = '';
    input.focus();
    loadIndex(function() {});
  };

  searchOverlay.querySelector('.search-close').addEventListener('click', closeSearch);

  searchOverlay.addEventListener('click', function(e) {
    if (e.target === searchOverlay) closeSearch();
  });

  document.addEventListener('keydown', function(e) {
    if (!searchOverlay.classList.contains('open')) return;
    if (e.key === 'Escape') { closeSearch(); return; }
    if (e.key !== 'Tab') return;
    var panel = searchOverlay.querySelector('.search-modal');
    var list = Array.prototype.filter.call(
      panel.querySelectorAll('input, button, a[href], [tabindex]'),
      function(el) { return !el.disabled && el.getAttribute('tabindex') !== '-1' && el.offsetParent !== null; });
    var target = tabTarget(list, document.activeElement, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); }
    else if (!list.length) e.preventDefault();
  });
})();
