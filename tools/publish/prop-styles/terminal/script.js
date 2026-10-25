// The terminal style's one control: show the same pages as a paper printout, which prints
// with far less ink. A link ending in ?paper opens the page that way.
(function () {
  var button = document.querySelector('.mode-toggle');
  function set(on) {
    document.body.classList.toggle('paper', on);
    if (!button) return;
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Show as terminal' : 'Show as printout';
  }
  if (button) {
    button.hidden = false;
    button.addEventListener('click', function () { set(!document.body.classList.contains('paper')); });
  }
  if (new URLSearchParams(window.location.search).has('paper')) set(true);
})();
