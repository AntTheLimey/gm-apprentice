// The fold plan: which session wrap-up page folds into which Story page unit. Pure; the build applies it.
// A wrap-up page is claimed by at most one unit, and a session unit's claim beats a chapter's
// (the same rule `storyPagesFor` uses). Only pages whose type is a wrap-up type are ever folded.
const { isWrapUp } = require('./session-hub');

const FOLD_LABELS = new WeakMap();   // link map -> Map of patched key -> title of the Story page it now points at

function foldPlan(spine) {
  const plan = new Map();
  for (const unit of spine || []) {
    const page = unit.wrapUpPage;
    if (!page || !isWrapUp(page)) continue;
    if (unit.kind === 'session' || !plan.has(page)) plan.set(page, unit);
  }
  return plan;
}

// Moves each folded page onto its unit's address and repoints every link-map key that named the old address.
function applyFold(plan, linkMap) {
  const moved = new Map();   // old output path -> unit
  for (const [page, unit] of plan) {
    page.foldedFrom = page.outputPath;
    page.outputPath = unit.outputPath;
    page.outputDir = 'story';
    page.displayTitle = unit.title;
    page.foldedInto = unit;
    moved.set(page.foldedFrom, unit);
  }
  const labels = new Map();
  for (const key of Object.keys(linkMap)) {
    const unit = moved.get(linkMap[key]);
    if (!unit) continue;
    linkMap[key] = unit.outputPath;
    labels.set(key, unit.title);
  }
  FOLD_LABELS.set(linkMap, labels);
  return labels;
}

const isFolded = (page) => !!(page && page.foldedInto);

const foldLabel = (linkMap, key) => (FOLD_LABELS.get(linkMap) || new Map()).get(key);

module.exports = { foldPlan, applyFold, isFolded, foldLabel };
