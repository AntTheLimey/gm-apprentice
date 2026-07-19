'use strict';
const { cocRowCells } = require('../../../js/coc-party');
const { avatarHtml } = require('../party-avatar');
const { relativeHref, escapeHtml } = require('../../processor');

// Sort: DEX desc, then name asc. Missing DEX sorts last (−Infinity).
function dexCmp(a, b) {
  const dx = (x) => (typeof x.dex === 'number' ? x.dex : -Infinity);
  return dx(b) - dx(a) || String(a.name).localeCompare(String(b.name));
}

// entries: [{ name, outputPath, portrait, data }] where data is a CoC live blob.
function buildCoCPartyManifest(campaignId, entries) {
  const pcs = (entries || [])
    .filter((e) => e && e.data)
    .map((e) => ({
      pcSlug: e.data.pcSlug,
      name: e.name,
      outputPath: e.outputPath,
      portrait: e.portrait != null ? e.portrait : null,
      player: e.data.player != null ? e.data.player : null,
      dex: e.data.dex != null ? e.data.dex : null,
      hp: e.data.hp || null,
      mp: e.data.mp || null,
      san: e.data.san || null,
      luck: e.data.luck ? e.data.luck.cur : null,
      rep: e.data.rep ? e.data.rep.cur : null,
      conditions: e.data.conditions || {},
    }))
    .sort(dexCmp);
  if (!pcs.length) return null;
  return { campaignId, pcs };
}

function renderCoCBoard(manifest, rosterOutputPath) {
  if (!manifest || !manifest.pcs || !manifest.pcs.length) return null;
  const showRep = manifest.pcs.some((pc) => pc.rep != null);
  const rows = manifest.pcs.map((pc) => {
    const c = cocRowCells(pc, null);   // authored-default initial render
    const href = relativeHref(rosterOutputPath, pc.outputPath);
    const repTd = showRep ? `\n  <td data-gl-party-field="rep">${c.rep}</td>` : '';
    return `<tr class="gl-party-row ${c.rowClass}" data-gl-party="${escapeHtml(pc.pcSlug)}">
  <td class="gl-pc"><a href="${escapeHtml(href)}">${avatarHtml(pc, rosterOutputPath)}<span class="gl-pc-txt"><span class="gl-pc-name">${escapeHtml(pc.name)}</span><span class="gl-pc-sub">${c.player}</span></span></a></td>
  <td data-gl-party-field="dex">${c.dex}</td>
  <td class="gl-vital" data-gl-party-field="hp">${c.hp}</td>
  <td class="gl-vital" data-gl-party-field="san">${c.san}</td>
  <td class="gl-vital" data-gl-party-field="mp">${c.mp}</td>
  <td data-gl-party-field="luck">${c.luck}</td>${repTd}
  <td data-gl-party-field="status">${c.status}</td>
</tr>`;
  }).join('\n');

  const repTh = showRep ? '<th>Rep</th>' : '';
  return `<section class="gl-party" aria-label="Live party status">
  <div class="gl-party-head">
    <h2>Party Status</h2>
    <span class="gl-party-live"><span class="gl-party-dot"></span><span class="gl-party-live-time">live</span></span>
  </div>
  <div class="gl-party-scroll">
  <table class="gl-party-table">
    <thead><tr><th class="gl-pc">Investigator</th><th>DEX</th><th>HP</th><th>SAN</th><th>MP</th><th>Luck</th>${repTh}<th>Status</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
</section>`;
}

module.exports = { buildCoCPartyManifest, renderCoCBoard };
