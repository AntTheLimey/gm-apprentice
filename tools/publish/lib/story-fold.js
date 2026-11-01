// The fold plan: which session wrap-up page folds into which Story page unit. Pure; the build applies it.
// A wrap-up page is claimed by at most one unit, and a session unit's claim beats a chapter's
// (the same rule `storyPagesFor` uses). Only pages whose type is a wrap-up type are ever folded.
const { isWrapUp } = require('./session-hub');
const { wikilinkRe, parseWikilink } = require('./wikilink');

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

// A heading that holds an unaliased link to a folded wrap-up prints the Story page's title, so the heading is read by
// that title before it prints too: each such link in a heading line (outside a code fence) is given the title as its
// label. The keep-list of a PC's sections (sheets off) then reads the heading the page shows. Other lines, embeds and
// links with a label of their own are left as written. A link is named as resolveWikiLinks names it.
function labelFoldedHeadings(markdown, linkMap) {
  const text = String(markdown == null ? '' : markdown);
  if (!text.includes('[[')) return text;
  let fence = null;
  return text.split('\n').map((line) => {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = null;
      return line;
    }
    if (fence || !/^\s{0,3}#{1,6}\s/.test(line) || !line.includes('[[')) return line;
    return line.replace(wikilinkRe('g', true), (whole, body) => {
      if (whole[0] === '!') return whole;
      const parsed = parseWikilink(body);
      if (parsed.display.trim()) return whole;
      const key = linkMap[parsed.raw] ? parsed.raw : parsed.name;
      const label = foldLabel(linkMap, key);
      return label && !/[|\]\[]/.test(label) ? `[[${body}|${label}]]` : whole;
    });
  }).join('\n');
}

const foldLabel = (linkMap, key) => (FOLD_LABELS.get(linkMap) || new Map()).get(key);

module.exports = { foldPlan, applyFold, isFolded, foldLabel, labelFoldedHeadings };
