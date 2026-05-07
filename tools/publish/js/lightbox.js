(function() {
  var overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = '<button class="lightbox-close" aria-label="Close">&times;</button><img src="" alt="">';
  document.body.appendChild(overlay);

  var img = overlay.querySelector('img');
  var closeBtn = overlay.querySelector('.lightbox-close');

  function open(src, alt) {
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    img.src = '';
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });

  document.querySelectorAll('.content img').forEach(function(el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function() {
      open(el.src, el.alt);
    });
  });

  window._lightbox = { open: open, close: close };
})();
