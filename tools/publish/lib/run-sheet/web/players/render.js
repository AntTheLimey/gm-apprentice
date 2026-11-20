'use strict';
// The players' screen as markup (plan 5b Task 7). UMD like the other run-sheet scripts: `module.exports`
// under node, `window.RunSheetPlayersRender` in a page. The players' page draws with it, and so does the
// GM page's preview (Task 9), so the two always look alike.
//
// `renderPlayers(view) -> html string`. The view is the players' own (server-filtered); everything in it
// that is a word goes through `esc`, and a picture is used only when it is the players' own picture
// route. Nothing here knows a GM key, a dice roll or a vault path.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RunSheetPlayersRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const PIC = /^\/players\/pic\/[0-9a-f]{20}$/;
  const picOf = (p) => (typeof p === 'string' && PIC.test(p) ? p : null);
  const LAYOUTS = ['none', 'n1', 'n2', 'n4', 'n6', 'n8', 'n9'];

  // A face and a name, as a tile. No picture: a plain silhouette.
  function face(who, cls) {
    const pic = picOf(who && who.pic);
    return `<div class="tile ${cls}">${pic ? `<img class="face" src="${pic}" alt="">` : '<span class="face ph" aria-hidden="true"></span>'}<span class="nm">${esc(who && who.name)}</span></div>`;
  }

  function orderRow(r) {
    const mark = r.current ? '▸' : '';
    const bits = [];
    if (r.hp) bits.push(`<span class="hp">${esc(r.hp)}</span>`);
    for (const st of Array.isArray(r.statuses) ? r.statuses : []) bits.push(`<span class="st">${esc(st)}</span>`);
    return `<li class="${r.current ? 'cur' : ''} ${r.out ? 'out' : ''} ${r.lair ? 'lair' : ''}">`
      + `<span class="mk" aria-hidden="true">${mark}</span><span class="ini">${r.ini == null ? '' : esc(r.ini)}</span>`
      + `<span class="on">${esc(r.name)}${r.current ? '<span class="sr"> (their turn)</span>' : ''}</span>`
      + (bits.length ? `<span class="vit">${bits.join('')}</span>` : '') + '</li>';
  }

  function order(o) {
    const head = o.round == null ? 'Roll initiative' : `Round ${esc(o.round)}`;
    return `<section class="ord"><header><span class="rd">${head}</span>${o.paused ? '<span class="paused">Paused</span>' : ''}</header>`
      + `<ol>${(o.rows || []).map(orderRow).join('')}</ol></section>`;
  }

  function panel(p) {
    const bg = picOf(p.backdrop);
    const cap = p.caption ? `<div class="cap">${esc(p.caption)}</div>` : '';
    const scene = `<div class="scene">${bg ? `<img class="bg" src="${bg}" alt="">` : ''}`
      + `<div class="pcs">${(p.pcs || []).map((x) => face(x, 'pc')).join('')}</div><div class="gap"></div>`
      + `<div class="ppl">${(p.people || []).map((x) => face(x, 'person')).join('')}</div>${cap}</div>`;
    return `<article class="panel${p.order ? ' fighting' : ''}">${scene}${p.order ? order(p.order) : ''}</article>`;
  }

  function renderPlayers(view) {
    const v = view && typeof view === 'object' ? view : {};
    const layout = LAYOUTS.includes(v.layout) ? v.layout : 'none';
    const panels = Array.isArray(v.panels) ? v.panels : [];
    if (!panels.length) return `<div class="mon none"><div class="empty">${esc(v.campaign)}</div></div>`;
    return `<div class="mon ${layout}">${panels.map(panel).join('')}</div>`;
  }

  return { renderPlayers, esc };
}));
