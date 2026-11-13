const { escapeHtml, relativeHref, encodeHref, renderInline } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');
const { linkSessions } = require('../story-sessions');
const { prologueHtml } = require('./prologue');
const { topLevelElements, openMarks } = require('../story-figures');
const { sessionRowNumbers } = require('../story-spine');

function storyNav(unit) {
  const prev = unit.prevHref
    ? `<a href="${encodeHref(relativeHref(unit.outputPath, unit.prevHref))}">&larr; Previous</a>` : '<span></span>';
  const next = unit.nextHref
    ? `<a href="${encodeHref(relativeHref(unit.outputPath, unit.nextHref))}">Next &rarr;</a>` : '<span></span>';
  return `<div class="story-nav">${prev}${next}</div>`;
}

// A wrap-up section on the Story page, after the recap: its heading as written (links and all), then its body.
function sectionHtml(s) {
  return `<section class="story-section"><h2 id="${escapeHtml(s.id)}">${renderInline(s.title)}</h2>${s.html}</section>`;
}

// Whether players see any words in `html` (a piece of a GM page, where a mark open at its start is `depth` deep):
// its text outside every mark, tags and mark tokens aside.
function seenText(html, depth) {
  let d = depth;
  let seen = '';
  for (const part of String(html).replace(/<[^>]*>/g, '').split(/(\uE000[0-9a-z]*\uE001|\uE002)/)) {
    if (part === '\uE002') d = Math.max(0, d - 1);
    else if (/^\uE000/.test(part)) d++;
    else if (d === 0) seen += part;
  }
  return seen.replace(/&nbsp;|&#160;/g, ' ').trim() !== '';
}

// A complete chapter's recap cut for its page: `opening`, its first top-level paragraph players see, with the pictures
// placed beside it (the figure block just before it); `before`, everything above that, shown as it is; `rest`, what
// follows, for the "Read the whole chapter recap" fold. No paragraph: all of it is `before`. On the GM site a mark
// still open where the opening ends is closed there and opened again at the rest's start, so the fold never cuts one.
function splitOpening(html) {
  const text = String(html || '');
  const blocks = topLevelElements(text);
  const at = blocks.findIndex((b) => b.tag === 'p' && seenText(b.html, openMarks(text.slice(0, b.start)).length));
  if (at < 0) return { before: text, opening: '', rest: '' };
  const prev = blocks[at - 1];
  const withFigure = prev && /^<div class="story-figures[\s"]/.test(prev.html) && !text.slice(prev.start + prev.html.length, blocks[at].start).trim();
  const from = withFigure ? prev.start : blocks[at].start;
  // A plate set after the opening (a scene's picture, full width) stays with it; on the GM site a mark token may stand
  // between the paragraph and the plate (the plate is drawn outside the mark).
  const next = blocks[at + 1];
  const pEnd = blocks[at].start + blocks[at].html.length;
  const plate = next && /^<div class="story-figures story-figures--plate"/.test(next.html)
    && !text.slice(pEnd, next.start).replace(/\uE000[0-9a-z]*\uE001|\uE002/g, '').trim();
  const end = plate ? next.start + next.html.length : pEnd;
  const open = openMarks(text.slice(0, end));
  const rest = text.slice(end);
  // A rest of only mark tokens (a mark that opened in the opening and closes after it) is no rest: it stays with the
  // opening, balanced, and there is no fold.
  if (!rest.trim()) return { before: text.slice(0, from), opening: text.slice(from, end), rest: '' };
  if (!rest.replace(/\uE000[0-9a-z]*\uE001|\uE002/g, '').trim()) return { before: text.slice(0, from), opening: text.slice(from), rest: '' };
  return { before: text.slice(0, from), opening: text.slice(from, end) + '\uE002'.repeat(open.length), rest: open.join('') + rest };
}

// The recap's opening, then the rest folded away (native, no script).
function chapterRecapHtml(html) {
  const { before, opening, rest } = splitOpening(html);
  const more = rest ? `\n      <details class="story-chapter-more"><summary>Read the whole chapter recap</summary>\n      ${rest}\n      </details>` : '';
  return `${before}${opening}${more}`;
}

// A chapter's own Story page, the chapter break (chapter pages): its label, title and dates; while active the marker
// and its Teaser; once complete its overview line and its recap (the opening, the rest folded); then its sessions,
// linked. The wrap-up's sections and moments follow, as on a session's page; on the GM site a wrap-up players do not
// see follows their recap inside one mark, as storyPage does it.
function chapterPage(unit, config, publishConfig, navFor) {
  const held = unit.heldBack && unit.heldBack.open ? unit.heldBack : null;
  const status = ['active', 'complete'].includes(unit.status) ? unit.status : 'unknown';
  const href = (to) => encodeHref(relativeHref(unit.outputPath, to));
  const sessions = (unit.sessions || []).length
    ? `<h2 class="story-chapter-sessions-title">${status === 'active' ? 'Sessions so far' : 'The sessions'}</h2>
      <ol class="story-chapter-sessions">${((numbers) => unit.sessions.map((s, i) => `<li value="${numbers[i]}"><a href="${href(s.outputPath)}">${escapeHtml(s.title)}</a>${s.inGameDate ? ` <span class="story-chapter-date">${escapeHtml(s.inGameDate)}</span>` : ''}</li>`).join(''))(sessionRowNumbers(unit.sessions.map((s) => (s.number == null ? null : s.number))))}</ol>`
    : '';
  const sections = (unit.sections || []).map(sectionHtml).join('\n');
  const told = status === 'active'
    ? `<p class="story-chapter-now">now being played</p>
      ${unit.teaserHtml ? `<div class="story-chapter-teaser">${unit.teaserHtml}</div>` : ''}`
    : status === 'complete'
      ? `${unit.overview ? `<p class="story-chapter-overview">${escapeHtml(unit.overview)}</p>` : ''}
      ${held ? '' : unit.preambleHtml || ''}
      ${held ? chapterRecapHtml(held.recapHtml) : unit.recapHtml ? chapterRecapHtml(unit.recapHtml) : ''}`
      : '';
  const story = held
    ? `${told}
      ${sessions}
      <p>${held.open}</p>
      ${held.ownHtml || ''}
      ${unit.preambleHtml || ''}
      ${held.wrapHasRecap ? `${held.wrapRecapTitle ? `<h2>${renderInline(held.wrapRecapTitle)}</h2>` : ''}
      ${unit.recapHtml || ''}` : ''}
      ${sections}
      ${unit.momentsHtml || ''}
      ${unit.afterHtml || ''}
      <p>${held.close}</p>`
    : `${told}
      ${sessions}
      ${sections}`;
  const content = `
    ${storyNav(unit)}
    <article class="story-prose story-chapter" data-chapter-status="${status}">
      ${unit.label ? `<p class="story-chapter-label">${escapeHtml(unit.label)}</p>` : ''}
      <h1 class="page-title">${escapeHtml(unit.title)}</h1>
      ${unit.dates ? `<p class="story-chapter-dates">${escapeHtml(unit.dates)}</p>` : ''}
      ${story}
    </article>
    ${storyNav(unit)}
    ${held ? '' : unit.momentsHtml || ''}
    ${held ? '' : unit.afterHtml || ''}
    ${unit.playNotesHtml || ''}
    ${unit.gmNoteHtml || ''}`;
  return baseShell({
    pageType: 'story',
    title: unit.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(unit.outputPath),
    navHtml: navFor(unit.outputPath, config),
    rootHref: rootPath(unit.outputPath),
    content,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: clientScripts(unit.outputPath),
  });
}

// The story (the wrap-up's text above its first heading, the recap, then its other sections in written order), Previous/Next, then the moments' cards
// and, on the GM site, what goes after them and the Play Notes link. On the GM site, a wrap-up players do not see on a
// page they do have (`unit.heldBack`, with its mark's `open` and `close` tokens) follows the players' own recap
// whole, inside one mark: the unit's own recap where players' page is made from another wrap-up (`ownHtml`), its recap
// under its heading, its sections, its cards, what goes after them.
function storyPage(unit, config, publishConfig, navFor) {
  if (unit.kind === 'chapter') return chapterPage(unit, config, publishConfig, navFor);
  const held = unit.heldBack && unit.heldBack.open ? unit.heldBack : null;
  const wrapUp = `${unit.preambleHtml || ''}
      ${unit.recapHtml}
      ${(unit.sections || []).map(sectionHtml).join('\n')}`;
  const story = held
    ? `${held.recapHtml}
      <p>${held.open}</p>
      ${held.ownHtml || ''}
      ${unit.preambleHtml || ''}
      ${held.wrapHasRecap ? `${held.wrapRecapTitle ? `<h2>${renderInline(held.wrapRecapTitle)}</h2>` : ''}
      ${unit.recapHtml}` : ''}
      ${(unit.sections || []).map(sectionHtml).join('\n')}
      ${unit.momentsHtml || ''}
      ${unit.afterHtml || ''}
      <p>${held.close}</p>`
    : wrapUp;
  const content = `
    ${storyNav(unit)}
    <article class="story-prose">
      <p class="story-eyebrow">${escapeHtml(unit.chapterTitle)}</p>
      <h1 class="page-title">${escapeHtml(unit.title)}</h1>
      ${story}
    </article>
    ${storyNav(unit)}
    ${held ? '' : unit.momentsHtml || ''}
    ${held ? '' : unit.afterHtml || ''}
    ${unit.playNotesHtml || ''}`;
  return baseShell({
    pageType: 'story',
    title: unit.title,
    siteTitle: config.siteTitle,
    cssHref: cssPath(unit.outputPath),
    navHtml: navFor(unit.outputPath, config),
    rootHref: rootPath(unit.outputPath),
    content,
    footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: clientScripts(unit.outputPath),
  });
}

function characterStoryPage(story, config, publishConfig, navFor) {
  const body = linkSessions(story.html);
  const sheetLink = story.sheetOutputPath
    ? `<p class="story-sheet-link"><a href="${encodeHref(relativeHref(story.outputPath, story.sheetOutputPath))}">View character sheet &rarr;</a></p>` : '';
  const content = `
    <article class="story-prose">
      <h1 class="page-title">${escapeHtml(story.title)}</h1>
      ${sheetLink}
      ${story.prologueHtml ? prologueHtml(story.title, story.prologueHtml) : ''}
      ${body}
    </article>`;
  return baseShell({
    pageType: 'story',
    title: story.title, siteTitle: config.siteTitle,
    cssHref: cssPath(story.outputPath), navHtml: navFor(story.outputPath, config),
    rootHref: rootPath(story.outputPath), content, footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: [...clientScripts(story.outputPath), ...(body !== story.html ? [rootPath(story.outputPath) + 'js/story-links.js'] : [])],
  });
}

module.exports = { storyPage, chapterPage, splitOpening, characterStoryPage };
