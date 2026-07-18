// tools/publish/js/coc-sheet.js
(function () {
  function init() {
    // tabs
    var tabs = document.querySelectorAll('.foliotab');
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tab-panel').forEach(function (p) { p.setAttribute('hidden', ''); });
        b.classList.add('active');
        var t = document.getElementById(b.getAttribute('data-target'));
        if (t) t.removeAttribute('hidden');
      });
    });
    // condition chips
    document.querySelectorAll('.cond-chip').forEach(function (c) {
      c.addEventListener('click', function () { c.classList.toggle('on'); });
    });
    // ± steppers
    document.querySelectorAll('.sb-num').forEach(function (box) {
      var b = box.querySelector('b'); var max = parseInt(box.getAttribute('data-max'), 10);
      box.querySelectorAll('.step').forEach(function (s) {
        s.addEventListener('click', function () {
          var v = parseInt(b.textContent, 10) || 0; v += s.classList.contains('up') ? 1 : -1;
          if (v < 0) v = 0; if (!isNaN(max) && v > max) v = max; b.textContent = v;
          if (b.hasAttribute('data-san')) {
            var f = document.querySelector('.statusbar .fill'); if (f) f.style.width = Math.round(v / max * 100) + '%';
          }
        });
      });
    });
    // tap-to-set pip tracks
    document.querySelectorAll('.pips').forEach(function (track) {
      var pips = track.querySelectorAll('.pip'); var key = track.getAttribute('data-track');
      var out = document.querySelector('[data-' + key + ']');
      pips.forEach(function (p, i) {
        p.addEventListener('click', function () {
          var target = i + 1, filled = track.querySelectorAll('.pip.on').length;
          if (filled === target) target = i;
          pips.forEach(function (q, j) { q.classList.toggle('on', j < target); });
          if (out) out.textContent = target;
        });
      });
    });
    // experience checkbox (local toggle only)
    document.querySelectorAll('.skill .exp').forEach(function (b) {
      b.addEventListener('click', function () { b.parentElement.classList.toggle('checked'); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
