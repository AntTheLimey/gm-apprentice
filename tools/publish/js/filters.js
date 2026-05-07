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
  // --- NPC sortable table ---
  var table = document.querySelector('.sortable-table');
  if (table) {
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    var headers = thead ? thead.querySelectorAll('th[data-sort-col]') : [];
    var npcNameInput = document.querySelector('.name-filter');
    var npcFilters = document.querySelectorAll('.npc-filter');
    var npcRows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
    var npcCount = countEl;
    var npcTotal = npcRows.length;

    function getCellText(row, colIdx) {
      var td = row.children[colIdx];
      if (!td) return '';
      var sortAttr = td.getAttribute('data-sort');
      if (sortAttr !== null) return sortAttr;
      return (td.textContent || '').trim().toLowerCase();
    }

    function sortTable(colIdx, dir) {
      npcRows.sort(function(a, b) {
        var aVal = getCellText(a, colIdx);
        var bVal = getCellText(b, colIdx);
        var aNum = Number(aVal), bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) return dir * (aNum - bNum);
        return dir * aVal.localeCompare(bVal);
      });
      npcRows.forEach(function(row) { tbody.appendChild(row); });
    }

    headers.forEach(function(th, idx) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', function() {
        var isAsc = th.classList.contains('sort-asc');
        headers.forEach(function(h) { h.classList.remove('sort-active', 'sort-asc', 'sort-desc'); });
        th.classList.add('sort-active');
        if (isAsc) {
          th.classList.add('sort-desc');
          sortTable(idx, -1);
        } else {
          th.classList.add('sort-asc');
          sortTable(idx, 1);
        }
      });
    });

    function applyNpcFilters() {
      var nameQ = npcNameInput ? npcNameInput.value.toLowerCase().trim() : '';
      var filterValues = {};
      npcFilters.forEach(function(sel) {
        var col = sel.getAttribute('data-col');
        filterValues[col] = sel.value;
      });
      var visible = 0;
      npcRows.forEach(function(row) {
        var name = (row.getAttribute('data-entity-name') || '').toLowerCase();
        var status = row.getAttribute('data-entity-status') || '';
        var session = row.getAttribute('data-session') || '';
        var nameMatch = !nameQ || name.includes(nameQ);
        var statusMatch = !filterValues.status || status === filterValues.status;
        var sessionMatch = !filterValues.session || session === filterValues.session;
        if (nameMatch && statusMatch && sessionMatch) {
          row.style.display = '';
          visible++;
        } else {
          row.style.display = 'none';
        }
      });
      if (npcCount) npcCount.textContent = 'Showing ' + visible + ' of ' + npcTotal;
    }

    npcFilters.forEach(function(sel) { sel.addEventListener('change', applyNpcFilters); });
    if (npcNameInput) npcNameInput.addEventListener('input', applyNpcFilters);
  }
})();
