'use strict';
// The players' page (plan 5b Task 7). It GETs the players' view, keeps an event stream open for the next
// one, and draws each with render.js. It holds no GM data and no dice, and asks for no other route.
// `?probe=1` writes what it measured to `document.body.dataset.probe` (the tests read it).
(function () {
  const R = window.RunSheetPlayersRender;
  const screen = document.getElementById('screen');
  const probing = /[?&]probe=1(?:&|$)/.test(location.search);
  const errors = [];
  let view = null;
  let ticket = 0;

  function setOffline(off) { document.body.classList.toggle('offline', off); }

  function measure() {
    const px = (sel, f) => {
      const all = Array.from(document.querySelectorAll(sel), f).filter((n) => n > 0);
      return all.length ? Math.min(...all) : null;
    };
    const faceMinPx = px('.face', (e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height));
    const nameMinPx = px('.nm, .on', (e) => parseFloat(getComputedStyle(e).fontSize));
    document.body.dataset.probe = JSON.stringify({
      panels: document.querySelectorAll('.panel').length,
      campaign: view ? view.campaign : null,
      faceMinPx: faceMinPx == null ? null : Math.round(faceMinPx * 10) / 10,
      nameMinPx: nameMinPx == null ? null : Math.round(nameMinPx * 10) / 10,
      errors,
    });
  }

  function draw(next) {
    view = next;
    screen.innerHTML = R.renderPlayers(view);
    // a long order runs past its panel (nobody scrolls a screen on the wall): it is moved so the turn
    // being taken stays in sight, a third of the way down
    for (const li of screen.querySelectorAll('.ord li.cur')) {
      const box = li.closest('.ord');
      if (!box || box.scrollHeight <= box.clientHeight) continue;
      box.scrollTop += li.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
    }
    if (view && view.campaign) document.title = `${view.campaign} - players' screen`;
    if (probing) measure();
  }

  async function load() {
    const mine = ++ticket;
    try {
      const res = await fetch('/api/players/view', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const next = await res.json();
      if (mine === ticket) { draw(next); setOffline(false); }
    } catch (e) {
      if (mine === ticket) setOffline(true);
    }
  }

  function listen() {
    const es = new EventSource('/api/players/events');
    es.addEventListener('hello', () => { setOffline(false); load(); });
    es.addEventListener('view', (ev) => {
      ticket++; // an answer still on its way is older than this
      try { draw(JSON.parse(ev.data)); setOffline(false); } catch (e) { errors.push(String(e)); }
    });
    es.addEventListener('error', () => setOffline(true));
  }

  window.addEventListener('error', (ev) => { errors.push(String(ev.message)); if (probing) measure(); });
  window.addEventListener('unhandledrejection', (ev) => { errors.push(String(ev.reason)); if (probing) measure(); });
  if (probing) measure();
  load();
  listen();
}());
