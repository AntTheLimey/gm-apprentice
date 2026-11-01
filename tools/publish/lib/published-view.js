'use strict';
// A page's published view: its markdown with the parts players do not see taken out (gm-only fences, hidden callouts,
// excluded sections). The build and `explain` both read the Story spine from it, so a recap that is only inside a hidden
// part is no recap in either. One source: nothing else computes it.
const { strippedLines, sectionWithholder, noteFacts, keptFlags, filterSections, stubCut, publishMode } = require('./processor');
const { withoutMarked } = require('./gm-marks');

// Sets `page.publishedMarkdown` (and, on the GM site, `page.gmMarkedPublished`).
// `rules`: { gm, mark, excludeCallouts, excludeSections, pcKeepSections, storyMoments }; `facts`, when given, is
// { stubFacts, stripFacts }: what the player site's strip reports, kept for the note-faults audit.
function publishView(page, rules, facts = null) {
  const { gm, mark, excludeCallouts, excludeSections, pcKeepSections, storyMoments } = rules;
  const source = String(page.markdown || '');
  if (gm) {
    // The GM site keeps two published views. The marked one (every hidden part kept and marked) is the search
    // index's. `publishedMarkdown`, which every excerpt reads (pull-quotes, cards, link previews, listings, recaps),
    // is that text with each marked span dropped, as players see it: an excerpt that cut a mark open would wrap the
    // rest of its page. A PC whose headings a link label changes has neither, as on the player site: its page shows
    // the body, marked. No note-faults facts.
    const gmFm = page.sourceFrontmatter || page.frontmatter;
    page.gmMarkedPublished = page.headingsUnstable ? '' : filterSections(
      strippedLines(source, excludeCallouts, mark, sectionWithholder(excludeSections, gmFm, { pcKeepSections, storyMoments })).lines.join('\n'),
      excludeSections, gmFm, { pcKeepSections, storyMoments, mark });
    page.publishedMarkdown = withoutMarked(page.gmMarkedPublished, mark.marks);
    return;
  }
  const fm = page.sourceFrontmatter || page.frontmatter;
  // A withheld heading inside a hidden block comes back where the block ended, as on the page (#447).
  const stripped = strippedLines(source, excludeCallouts, null, sectionWithholder(excludeSections, fm, { pcKeepSections, storyMoments }));
  if (facts) {
    // A stub's facts were taken when it was cut. A fault that lies wholly in text the page
    // hides anyway (noteFacts) is none; a note withheld whole shows none.
    facts.stripFacts.set(page, facts.stubFacts.get(page) || {
      source, hidden: page.headingsUnstable ? [] : stripped.hidden,
      ...noteFacts(stripped, (lines, restored) => (page.headingsUnstable ? lines.map(() => false) : keptFlags(lines, excludeSections, fm, { pcKeepSections, storyMoments, restored }))),
    });
  }
  const text = stripped.lines.join('\n');
  page.publishedMarkdown = page.headingsUnstable ? '' : filterSections(text, excludeSections, fm,
    { pcKeepSections, storyMoments, restored: stripped.restored });   // its warnings are the page render's to print, once
}

// The player site's fold plan (story-fold.js), for a command that reads the vault without building it (explain, the
// leak gate): the pages it publishes, read as the build reads them before it folds (a paired session note's body
// withheld, a stub cut to its named sections, then the published view), each through a copy so no page is changed.
// The plan is keyed by the pages given. `pairs`: the site's session pairs (session-hub.js pairHubs).
function playerFoldPlan(pages, pairs, publishConfig) {
  const { buildStorySpine } = require('./story-spine');
  const { foldPlan } = require('./story-fold');
  const { pcKeepList, storyMomentsOn } = require('./pc-prose');
  const excludeSections = publishConfig.exclude_sections || [];
  const excludeCallouts = publishConfig.exclude_callouts;
  const rules = { gm: false, excludeCallouts, excludeSections, pcKeepSections: pcKeepList(publishConfig), storyMoments: storyMomentsOn(publishConfig) };
  const original = new Map();
  const views = pages.map((page) => {
    const fm = page.sourceFrontmatter || page.frontmatter || {};
    let markdown = pairs.has(page) ? '' : String(page.markdown || '');
    if (publishMode(fm) === 'stub') {
      const include = Array.isArray(fm.publish_include_sections) ? fm.publish_include_sections : [];
      markdown = stubCut(markdown, include, { excludeSections, excludeCallouts, frontmatter: fm }).text;
    }
    const view = { ...page, markdown };
    publishView(view, rules);
    original.set(view, page);
    return view;
  });
  const viewOf = new Map(views.map((v) => [original.get(v), v]));
  const viewPairs = new Map([...pairs].filter(([hub, wrap]) => viewOf.has(hub) && viewOf.has(wrap)).map(([hub, wrap]) => [viewOf.get(hub), viewOf.get(wrap)]));
  if (pairs.linked) viewPairs.linked = new Set([...pairs.linked].map((w) => viewOf.get(w) || w));
  const plan = new Map();
  for (const [view, unit] of foldPlan(buildStorySpine(views, null, viewPairs))) plan.set(original.get(view), unit);
  return plan;
}

module.exports = { publishView, playerFoldPlan };
