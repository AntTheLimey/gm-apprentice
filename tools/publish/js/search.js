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

  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { esc: esc, encodeHref: encodeHref };
    return;
  }

  var searchOverlay = document.createElement('div');
  searchOverlay.className = 'search-overlay';
  searchOverlay.innerHTML =
    '<div class="search-modal">' +
      '<div class="search-input-wrap">' +
        '<input type="text" class="search-input" placeholder="Search..." autocomplete="off">' +
        '<kbd class="search-kbd">Esc</kbd>' +
      '</div>' +
      '<div class="search-results"></div>' +
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
    // Match the index's normal form (#139): the index is built NFC, so a query typed with
    // decomposed accents must be folded the same way or it can never match.
    var query = String(rawQuery == null ? '' : rawQuery);
    query = query.normalize ? query.normalize('NFC') : query;
    if (!idx || !query.trim()) {
      resultsDiv.innerHTML = query.trim() ? '<div class="search-results-empty">Loading...</div>' : '';
      return;
    }

    var results;
    try {
      results = idx.search(query + '*');
    } catch(e) {
      results = idx.search(query);
    }

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

  window.openSearch = function() {
    searchOverlay.classList.add('open');
    input.value = '';
    resultsDiv.innerHTML = '';
    input.focus();
    loadIndex(function() {});
  };

  searchOverlay.addEventListener('click', function(e) {
    if (e.target === searchOverlay) {
      searchOverlay.classList.remove('open');
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && searchOverlay.classList.contains('open')) {
      searchOverlay.classList.remove('open');
    }
  });
})();
