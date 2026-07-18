// tools/publish/lib/templates/coc/live-data.js
// Build-time: parsed CoC model -> the live-tracking blob consumed by
// js/coc-live.js. Authored values here are the vault fallback (used only when
// KV and localStorage are both empty). The mount (pc.js via live-mount.js)
// decides the script + island id; this module owns only the data.
function buildCoCLiveData(model, meta) {
  if (!meta) return null;
  const d = (model && model.derived) || {};
  const hp = d.hp || {}, mp = d.mp || {}, san = d.sanity || {}, luck = d.luck || {};
  const rep = model && model.reputation;
  return {
    campaignId: meta.campaignId,
    pcSlug: meta.pcSlug,
    buildVersion: meta.buildVersion, // informational; never gates hydration
    hp: { cur: hp.cur, max: hp.max },
    mp: { cur: mp.cur, max: mp.max },
    san: { cur: san.cur, max: san.max, start: san.start },
    luck: { cur: luck.cur },
    rep: rep ? { cur: rep.current } : null,
    conditions: (model && model.conditions) || {},
    skills: (model && model.skills || []).map((s) => s.name),
  };
}

module.exports = { buildCoCLiveData };
