'use strict';
const { deriveLive } = require('../../../js/gurps-live');
const { rowCells } = require('../../../js/gurps-party');
const { getInitials } = require('../landing-data');
const { relativeHref, escapeHtml } = require('../../processor');

function renderPartyBoard(manifest, rosterOutputPath) {
  if (!manifest || !manifest.pcs || !manifest.pcs.length) return null;
  const rows = manifest.pcs.map((pc, i) => {
    const view = deriveLive(pc, null);           // authored-default initial render
    const c = rowCells(view);
    const href = relativeHref(rosterOutputPath, pc.outputPath);
    const bs = pc.basicSpeed != null ? 'Basic Speed ' + pc.basicSpeed.toFixed(2) : '';
    return `<tr class="gl-party-row ${c.rowClass}" data-gl-party="${escapeHtml(pc.pcSlug)}">
  <td class="gl-rank">${i + 1}</td>
  <td class="gl-pc"><a href="${escapeHtml(href)}"><span class="gl-av">${escapeHtml(getInitials(pc.name))}</span><span class="gl-pc-txt"><span class="gl-pc-name">${escapeHtml(pc.name)}</span><span class="gl-pc-sub">${escapeHtml(bs)} <span data-gl-party-field="enc">${c.enc}</span></span></span></a></td>
  <td class="gl-vital" data-gl-party-field="hp">${c.hp}</td>
  <td class="gl-vital" data-gl-party-field="fp">${c.fp}</td>
  <td class="gl-stat" data-gl-party-field="move">${c.move}</td>
  <td class="gl-stat" data-gl-party-field="dodge">${c.dodge}</td>
  <td class="gl-stat gl-col-st" data-gl-party-field="st">${c.st}</td>
  <td class="gl-status" data-gl-party-field="status">${c.status}</td>
</tr>`;
  }).join('\n');

  return `<section class="gl-party" aria-label="Live party status">
  <div class="gl-party-head">
    <h2>Party Status</h2>
    <span class="gl-party-live"><span class="gl-party-dot"></span><span class="gl-party-live-time">live</span></span>
  </div>
  <div class="gl-party-scroll">
  <table class="gl-party-table">
    <thead><tr><th>#</th><th class="gl-pc">Character</th><th>HP</th><th>FP</th><th>Move</th><th>Dodge</th><th class="gl-col-st">ST</th><th>Status</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
</section>`;
}

module.exports = { renderPartyBoard };
