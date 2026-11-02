// The fold plan: which session wrap-up page folds into which Story page unit. Pure; the build applies it.
// A wrap-up page is claimed by at most one unit, and a session unit's claim beats a chapter's
// (the same rule `storyPagesFor` uses). Only pages whose type is a wrap-up type are ever folded.
const { isWrapUp } = require('./session-hub');
const { wikilinkRe, parseWikilink } = require('./wikilink');
const { fenceStep } = require('./processor');
const { canonicalNfc } = require('./unicode');

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

// Each link-map key that names a folded page's address, and the unit it now leads to. Pure: read before the pages move.
function foldedKeys(plan, linkMap) {
  const moved = new Map();   // old output path -> unit
  for (const [page, unit] of plan) moved.set(page.foldedFrom || page.outputPath, unit);
  const keys = new Map();
  for (const key of Object.keys(linkMap)) {
    const unit = moved.get(linkMap[key]);
    if (unit) keys.set(key, unit);
  }
  return keys;
}

// The title each such key prints as, an unaliased link to it (the Story page's title), without moving any page: what
// the leak gate reads a link by, as the page prints it.
const foldLabelsOf = (plan, linkMap) => new Map([...foldedKeys(plan, linkMap)].map(([key, unit]) => [key, unit.title]));

// Moves each folded page onto its unit's address and repoints every link-map key that named the old address.
function applyFold(plan, linkMap) {
  const keys = foldedKeys(plan, linkMap);
  for (const [page, unit] of plan) {
    page.foldedFrom = page.outputPath;
    page.outputPath = unit.outputPath;
    page.outputDir = 'story';
    page.displayTitle = unit.title;
    page.foldedInto = unit;
  }
  const labels = new Map();
  for (const [key, unit] of keys) {
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
// The build rewrites a PC page's `markdown` (and `storyMarkdown`) with it in place, before anything reads them: only a
// `|label` is added inside a line, so every line keeps its number (a fault's line stays the line in the note), and text
// quoted from the heading (a finding's context) shows the session's title, as the page does.
function labelFoldedHeadings(markdown, linkMap) {
  return labelFoldedLinks(markdown, linkMap, { headingsOnly: true });
}

// Each unaliased link (not an embed) to a folded wrap-up given its label, the Story page's title: by `labels` (key ->
// title, foldLabelsOf) when given, else by the link map's own fold. With `headingsOnly`, only heading lines outside a
// code fence; otherwise every line. A link is named as resolveWikiLinks names it.
function labelFoldedLinks(markdown, linkMap, { headingsOnly = false, labels = null } = {}) {
  const text = String(markdown == null ? '' : markdown);
  if (!text.includes('[[')) return text;
  const labelOf = (key) => (labels ? labels.get(canonicalNfc(key)) : foldLabel(linkMap, key));
  const relabel = (line) => line.replace(wikilinkRe('g', true), (whole, body) => {
    if (whole[0] === '!') return whole;
    const parsed = parseWikilink(body);
    if (parsed.display.trim()) return whole;
    const key = linkMap[parsed.raw] ? parsed.raw : parsed.name;
    const label = labelOf(key);
    return label && !/[|\]\[]/.test(label) ? `[[${body}|${label}]]` : whole;
  });
  if (!headingsOnly) return relabel(text);
  let fence = null;
  return text.split('\n').map((line) => {
    const step = fenceStep(line.replace(/\r$/, ''), fence);   // a CRLF note's line ends in \r
    fence = step.fenceDelim;
    if (step.isFenceLine) return line;
    if (fence !== null || !/^\s{0,3}#{1,6}\s/.test(line) || !line.includes('[[')) return line;
    return relabel(line);
  }).join('\n');
}

// Its keys are the link map's own, in NFC (unicode.js), so a key is read in NFC however its accents were typed.
const foldLabel = (linkMap, key) => (FOLD_LABELS.get(linkMap) || new Map()).get(canonicalNfc(key));

module.exports = { foldPlan, applyFold, foldLabelsOf, isFolded, foldLabel, labelFoldedHeadings, labelFoldedLinks };
