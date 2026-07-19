'use strict';

// Order the initiative table: bought Basic Speed desc, DX tiebreak desc, name asc.
// A missing Basic Speed / DX sorts last (−Infinity), never crashes the sort.
function initiativeCmp(a, b) {
  const bs = (x) => (typeof x.basicSpeed === 'number' ? x.basicSpeed : -Infinity);
  const dx = (x) => (typeof x.dx === 'number' ? x.dx : -Infinity);
  return bs(b) - bs(a) || dx(b) - dx(a) || String(a.name).localeCompare(String(b.name));
}

// entries: [{ name, outputPath, data }] where data is a buildLiveData result (or null).
function buildPartyManifest(campaignId, entries) {
  const pcs = (entries || [])
    .filter((e) => e && e.data)
    .map((e) => ({
      pcSlug: e.data.pcSlug,
      name: e.name,
      outputPath: e.outputPath,
      portrait: e.portrait != null ? e.portrait : null,
      buildVersion: e.data.buildVersion,
      basicSpeed: e.data.basicSpeed != null ? e.data.basicSpeed : null,
      dx: e.data.dx != null ? e.data.dx : null,
      authoredLevel: e.data.authoredLevel,
      levels: e.data.levels,
      items: e.data.items,
      vitals: e.data.vitals,
    }))
    .sort(initiativeCmp);
  if (!pcs.length) return null;
  return { campaignId, pcs };
}

function partyDataScript(manifest, elId) {
  const id = elId || 'gurps-party-data';
  const json = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${id}">${json}</script>`;
}

module.exports = { buildPartyManifest, partyDataScript };
