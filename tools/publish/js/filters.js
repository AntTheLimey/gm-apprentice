(function() {
  var nameInput = document.querySelector('.name-filter');
  var pills = document.querySelectorAll('.pill-filter');
  var cards = document.querySelectorAll('[data-entity-type]');
  var countEl = document.querySelector('.index-count');
  var totalCount = cards.length;

  var activeType = 'all';

  function applyFilters() {
    var nameQuery = nameInput ? nameInput.value.toLowerCase().trim() : '';
    var visible = 0;

    cards.forEach(function(card) {
      var type = card.getAttribute('data-entity-type') || '';
      var name = (card.getAttribute('data-entity-name') || '').toLowerCase();

      var typeMatch = activeType === 'all' || type === activeType;
      var nameMatch = !nameQuery || name.includes(nameQuery);

      if (typeMatch && nameMatch) {
        card.style.display = '';
        visible++;
      } else {
        card.style.display = 'none';
      }
    });

    if (countEl) {
      countEl.textContent = 'Showing ' + visible + ' of ' + totalCount;
    }
  }

  pills.forEach(function(pill) {
    pill.addEventListener('click', function() {
      activeType = pill.getAttribute('data-filter') || 'all';
      pills.forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');
      applyFilters();
    });
  });

  if (nameInput) {
    nameInput.addEventListener('input', applyFilters);
  }

  var sortSelect = document.querySelector('.sort-control');
  if (sortSelect) {
    sortSelect.addEventListener('change', function() {
      var container = document.querySelector('.card-grid');
      if (!container) return;
      var items = Array.from(cards);
      var sortBy = sortSelect.value;

      items.sort(function(a, b) {
        if (sortBy === 'type') {
          return (a.getAttribute('data-entity-type') || '').localeCompare(b.getAttribute('data-entity-type') || '');
        }
        if (sortBy === 'status') {
          return (a.getAttribute('data-entity-status') || '').localeCompare(b.getAttribute('data-entity-status') || '');
        }
        return (a.getAttribute('data-entity-name') || '').localeCompare(b.getAttribute('data-entity-name') || '');
      });

      items.forEach(function(item) { container.appendChild(item); });
    });
  }
})();
