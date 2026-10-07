'use strict';
const { dndRowCells } = require('../../../js/dnd-party');
const { avatarHtml } = require('../party-avatar');
const { relativeHref, escapeHtml, encodeHref } = require('../../processor');

// entries: [{ name, outputPath, portrait, data }] where data is a D&D live island.
// The board needs hit points, status and four facts; of the tracks, death saves only.
function buildDndPartyManifest(campaignId, entries) {
  const pcs = (entries || [])
    .filter(e => e && e.data)
    .map(e => ({
      pcSlug: e.data.pcSlug,
      name: e.name,
      outputPath: e.outputPath,
      portrait: e.portrait != null ? e.portrait : null,
      hpMax: e.data.hpMax === undefined ? null : e.data.hpMax,
      defaults: e.data.defaults || null,
      // What the note wrote in words is not live on the PC's page, so the board holds no number for it either.
      tempLive: e.data.tempLive !== false,
      exhaustionLive: e.data.exhaustionLive !== false,
      conditionsLive: e.data.conditionsLive !== false,
      ...(e.data.unreadable ? { unreadable: true } : {}),
      tracks: (e.data.tracks || []).filter(t => t.key === 'ds:s' || t.key === 'ds:f'),
      board: e.data.board || {},
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!pcs.length) return null;
  return { campaignId, pcs };
}

function renderDndBoard(manifest, rosterOutputPath, { live = true } = {}) {
  if (!manifest || !manifest.pcs || !manifest.pcs.length) return null;
  const rows = manifest.pcs.map((pc) => {
    const c = dndRowCells(pc, null);   // the note's values; the script paints over them
    const href = encodeHref(relativeHref(rosterOutputPath, pc.outputPath));
    return `<tr role="row" class="gl-party-row ${c.rowClass}" data-gl-party="${escapeHtml(pc.pcSlug)}">
  <td role="cell" class="gl-pc"><a href="${escapeHtml(href)}">${avatarHtml(pc, rosterOutputPath)}<span class="gl-pc-txt"><span class="gl-pc-name">${escapeHtml(pc.name)}</span><span class="gl-pc-sub">${c.who}</span></span></a></td>
  <td role="cell" data-gl-party-field="ac">${c.ac}</td>
  <td role="cell" class="gl-vital" data-gl-party-field="hp">${c.hp}</td>
  <td role="cell" data-gl-party-field="pp">${c.pp}</td>
  <td role="cell" data-gl-party-field="dc">${c.dc}</td>
  <td role="cell" data-gl-party-field="status">${c.status}</td>
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
    <thead role="rowgroup"><tr role="row"><th role="columnheader" class="gl-pc">Character</th><th role="columnheader">AC</th><th role="columnheader">Hit points</th><th role="columnheader">Passive Perc.</th><th role="columnheader">Spell DC</th><th role="columnheader">Status</th></tr></thead>
    <tbody role="rowgroup">
${rows}
    </tbody>
  </table>
  </div>
</section>`;
}

module.exports = { buildDndPartyManifest, renderDndBoard };
