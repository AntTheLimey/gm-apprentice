'use strict';
// The Story page's body (#543), cut from its unit's wrap-up: the published view on the player site, the marked view
// on the GM site. The recap the page leads with is left out; Memorable Moments is handed back apart (its cards are
// story-moments.js's); every other section stays in written order. On the GM site a hidden run (a top-level mark
// opened on a line of its own whose span holds a `##` heading: a fenced GM Notes, a `hide.sections` section) is lifted
// out whole, its tokens kept: written before the moments it stays in place among the sections; after them, or in a
// wrap-up with no moments, it goes after the cards; a run that holds the moments heading marks the moments, and its
// other sections go after. The marked preamble (a Source callout above the first heading) goes first after.
const { extractSections, findHeadings, renderMarkdown, renderInline, escapeHtml } = require('./processor');
const { unmark } = require('./gm-marks');

const OPEN_LINE = /^\uE000[0-9a-z]+\uE001$/;
const TOKEN = /\uE000[0-9a-z]+\uE001|\uE002/g;
const CLOSE = '\uE002';
const MOMENTS = 'memorable moments';

const isMoments = (title) => unmark(title).toLowerCase().includes(MOMENTS);
// The anchor extractSections gives a section: the title's own words.
const anchorOf = (title) => unmark(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// A section body's markdown without the blank lines around it.
const bodyText = (lines) => lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

// The top-level, titled level 2 headings of these lines (the ones extractSections cuts at), in order.
function topHeadings(lines) {
  const { headingAt } = findHeadings(lines.join('\n'));
  return [...headingAt]
    .filter(([, h]) => !h.nested && h.level === 2 && h.title !== '')
    .map(([line, h]) => ({ line, end: h.end, title: h.title }))
    .sort((a, b) => a.line - b.line);
}

// The hidden runs of the marked text's lines: { start, end } (inclusive). A run opens where depth goes 0 -> 1 on a
// line that is one open token alone, and ends on the line where depth returns to 0 (or at the end, if it never does).
function hiddenRuns(lines) {
  const runs = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (depth === 0 && OPEN_LINE.test(lines[i].trim())) start = i;
    for (const m of lines[i].matchAll(TOKEN)) depth = m[0] === CLOSE ? Math.max(0, depth - 1) : depth + 1;
    if (start >= 0 && depth === 0) { runs.push({ start, end: i }); start = -1; }
  }
  if (start >= 0) runs.push({ start, end: lines.length - 1 });
  return runs.filter((r) => topHeadings(lines.slice(r.start, r.end + 1).map(unmark)).length > 0);
}

// A hidden run's sections, each with its line in the text: { at, title, body } (body: markdown lines). The run's
// open line, and its close line when that is the token alone, are taken off; any text above its first heading joins
// that section's body.
function runSections(lines, run) {
  let last = run.end;
  if (last > run.start && lines[last].trim() === CLOSE) last--;
  const inner = lines.slice(run.start + 1, last + 1);
  const heads = topHeadings(inner.map(unmark));
  return heads.map((h, k) => ({
    at: run.start + 1 + h.line,
    title: h.title,
    body: [...(k === 0 ? inner.slice(0, h.line) : []), ...inner.slice(h.end, k + 1 < heads.length ? heads[k + 1].line : inner.length)],
  }));
}

const EMPTY = () => ({ recap: null, sections: [], moments: null, after: [] });

// `warn` (a function) is told, naming the note (`name`), when its headings cannot be read; the page then keeps no
// body from it.
function storySections(text, { resolve = (md) => md, marks = null, recapTitle = null, warn = null, name = 'a wrap-up' } = {}) {
  const lines = String(resolve(String(text == null ? '' : text)) || '').replace(/\r/g, '').split('\n');
  try {
    return cut(lines, marks, recapTitle);
  } catch (err) {
    if (warn) warn(`could not read the headings of ${name} (${err.message}); its sections are left off its Story page`);
    return EMPTY();
  }
}

function cut(lines, marks, recapTitle) {
  const out = EMPTY();
  const runs = marks ? hiddenRuns(lines) : [];
  const moments = topHeadings(lines).find((h) => isMoments(h.title));
  const momentsLine = moments ? moments.line : -1;
  const kept = lines.map((_, i) => i).filter((i) => !runs.some((r) => i >= r.start && i <= r.end));
  const rest = kept.map((i) => lines[i]);
  const restHeads = topHeadings(rest).map((h) => ({ ...h, at: kept[h.line] }));
  const rendered = extractSections(rest.join('\n'), { preamble: !!marks });
  const placed = [];   // { at, section } for `sections`, in written order once sorted
  const after = [];    // { at, title, id, html }: a section after the cards (no title: the preamble)
  // The sections outside every hidden run, as extractSections renders them (its preamble first, when it has one).
  const offset = rendered.length - restHeads.length;
  if (offset > 0) after.push({ at: -1, html: rendered[0].html });
  restHeads.forEach((h, k) => {
    const section = rendered[k + offset];
    if (!out.recap && recapTitle != null && unmark(h.title) === recapTitle) {
      out.recap = { title: section.title, html: section.html };
    } else if (!out.moments && h.at === momentsLine) {
      const next = restHeads[k + 1];
      out.moments = { title: unmark(h.title), markdown: bodyText(rest.slice(h.end, next ? next.line : rest.length)), hidden: null };
    } else {
      placed.push({ at: h.at, section: { ...section } });
    }
  });
  // The hidden runs: the heading and the body each wrapped in the run's own mark, so every piece is balanced.
  for (const run of runs) {
    const open = lines[run.start].trim();
    const pieces = runSections(lines, run);
    const holdsMoments = pieces.some((p) => p.at === momentsLine);
    for (const p of pieces) {
      if (p.at === momentsLine && !out.moments) {
        out.moments = { title: unmark(p.title), markdown: bodyText(p.body), hidden: { open, close: CLOSE } };
        continue;
      }
      const section = { title: open + p.title + CLOSE, id: anchorOf(p.title),
        html: `<p>${open}</p>\n${renderMarkdown(p.body.join('\n'))}<p>${CLOSE}</p>\n` };
      if (!holdsMoments && momentsLine >= 0 && p.at < momentsLine) placed.push({ at: p.at, section });
      else after.push({ at: p.at, ...section });
    }
  }
  out.sections = placed.sort((a, b) => a.at - b.at).map((p) => p.section);
  after.sort((a, b) => a.at - b.at);
  // One page, one anchor each: a second `loot` (a hidden Loot beside a visible one) becomes `loot-2`, in page order.
  const used = new Map();
  for (const s of [...out.sections, ...after.filter((a) => a.title !== undefined)]) {
    const n = (used.get(s.id) || 0) + 1;
    used.set(s.id, n);
    if (n > 1) s.id = `${s.id}-${n}`;
  }
  out.after = after.map((a) => ({
    html: a.title === undefined ? a.html : `<h2 id="${escapeHtml(a.id)}">${renderInline(a.title)}</h2>\n${a.html}`,
  }));
  return out;
}

module.exports = { storySections };
