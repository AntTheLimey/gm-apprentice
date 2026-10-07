'use strict';
const { deriveLive } = require('../../../js/gurps-live');
const { rowCells } = require('../../../js/gurps-party');
const { relativeHref, escapeHtml, encodeHref } = require('../../processor');
const { avatarHtml } = require('../party-avatar');

function renderPartyBoard(manifest, rosterOutputPath, { live = true } = {}) {
  if (!manifest || !manifest.pcs || !manifest.pcs.length) return null;
  // Rows arrive pre-sorted by Basic Speed (initiative order); the Speed column
  // surfaces that ordering value, so no separate rank number is needed.
  const rows = manifest.pcs.map((pc) => {
    const view = deriveLive(pc, null);           // authored-default initial render
    const c = rowCells(view);
    const href = encodeHref(relativeHref(rosterOutputPath, pc.outputPath));
    const speed = pc.basicSpeed != null ? Number(pc.basicSpeed).toFixed(2) : '—';
    return `<tr role="row" class="gl-party-row ${c.rowClass}" data-gl-party="${escapeHtml(pc.pcSlug)}">
  <td role="cell" class="gl-pc"><a href="${escapeHtml(href)}">${avatarHtml(pc, rosterOutputPath)}<span class="gl-pc-txt"><span class="gl-pc-name">${escapeHtml(pc.name)}</span><span class="gl-pc-sub" data-gl-party-field="enc">${c.enc}</span></span></a></td>
  <td role="cell" class="gl-speed">${escapeHtml(speed)}</td>
  <td role="cell" class="gl-vital" data-gl-party-field="hp">${c.hp}</td>
  <td role="cell" class="gl-vital" data-gl-party-field="fp">${c.fp}</td>
  <td role="cell" class="gl-stat" data-gl-party-field="move">${c.move}</td>
  <td role="cell" class="gl-stat" data-gl-party-field="dodge">${c.dodge}</td>
  <td role="cell" class="gl-stat gl-col-st" data-gl-party-field="st">${c.st}</td>
  <td role="cell" class="gl-status" data-gl-party-field="status">${c.status}</td>
</tr>`;
  }).join('\n');

  const liveIndicator = live
    ? '<span class="gl-party-live"><span class="gl-party-dot"></span><span class="gl-party-live-time">live</span></span>'
    : '';
  return `<section class="gl-party" aria-label="${live ? 'Live party status' : 'Party status'}">
  <div class="gl-party-head">
    <h2>Party Status</h2>
    ${liveIndicator}
  </div>
  <div class="gl-party-scroll">
  <table class="gl-party-table" role="table">
    <thead role="rowgroup"><tr role="row"><th role="columnheader" class="gl-pc">Character</th><th role="columnheader" class="gl-col-speed">Speed</th><th role="columnheader">HP</th><th role="columnheader">FP</th><th role="columnheader">Move</th><th role="columnheader">Dodge</th><th role="columnheader" class="gl-col-st">ST</th><th role="columnheader">Status</th></tr></thead>
    <tbody role="rowgroup">
${rows}
    </tbody>
  </table>
  </div>
</section>`;
}

module.exports = { renderPartyBoard };
