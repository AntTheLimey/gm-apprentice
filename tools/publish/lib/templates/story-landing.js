const path = require('path');
const { escapeHtml, relativeHref, encodeHref } = require('../processor');
const { topLevelElements } = require('../story-figures');
const { baseShell, cssPath, rootPath, clientScripts, noPreviewAttr } = require('./base');

const OUT = 'story.html';
const GROUP_LABELS = { current: 'Current', retired: 'Retired', fallen: 'Fallen' };

// A chapter's Teaser as the contents page shows it: its pictures left to the chapter page, and each relative address
// (written for a page in story/) read again from story.html.
function teaserForContents(html, fromPath) {
  const kept = topLevelElements(html).filter((b) => /^<div class="story-figures[\s"]/.test(b.html));
  let out = String(html);
  for (const b of kept.reverse()) out = out.slice(0, b.start) + out.slice(b.start + b.html.length);
  return out.replace(/(\s(?:href|src)=")([^"]*)"/g, (whole, attr, url) => {
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('#')) return whole;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), url));
    return `${attr}${relativeHref(OUT, target)}"`;
  });
}

// The Story So Far: like a book's contents (chapter pages). Each chapter shown, oldest first, as a heading linked to its
// chapter page: its label and dates, then the Teaser while it is active (with the "now being played" marker) or its
// overview once complete, then its sessions; a chapter told as one account (no session pages, a recap) links its own
// page instead. The page ends with a line each preset words in CSS: the story continues while a chapter is active.
// A session row's number: its `session_number`, else its place in the chapter. One digit is marked, so a preset can
// pad it (scifi's 01).
const numberHtml = (n) => `<span class="n"${n < 10 ? ' data-digits="1"' : ''}>${n}</span>`;

function contentsHtml(spine) {
  const href = (to) => encodeHref(relativeHref(OUT, to));
  const chapters = spine.filter((u) => u.kind === 'chapter');
  const entries = chapters.map((c) => {
    const status = ['active', 'complete'].includes(c.status) ? c.status : 'unknown';
    const told = status === 'active'
      ? `<p class="story-chapter-now">now being played</p>${c.teaserHtml ? `<div class="story-chapter-teaser">${teaserForContents(c.teaserHtml, c.outputPath)}</div>` : ''}`
      : status === 'complete' && c.overview ? `<p class="story-chapter-overview">${escapeHtml(c.overview)}</p>` : '';
    const sessions = c.sessions.length
      ? `<ol class="story-contents-sessions">${c.sessions.map((x, i) => `<li>${numberHtml(x.number == null ? i + 1 : x.number)}<a href="${href(x.outputPath)}">${escapeHtml(x.title)}</a><span class="d">${x.inGameDate ? escapeHtml(x.inGameDate) : ''}</span></li>`).join('')}</ol>`
      : c.recapHtml ? `<p class="story-contents-one">Told as one account · <a href="${href(c.outputPath)}">read it</a></p>` : '';
    return `<div class="story-contents-chapter" data-chapter-status="${status}">
      ${c.label ? `<p class="story-chapter-label">${escapeHtml(c.label)}</p>` : ''}
      <h3><a href="${href(c.outputPath)}">${escapeHtml(c.title)}</a></h3>
      ${c.dates ? `<p class="story-chapter-dates">${escapeHtml(c.dates)}</p>` : ''}
      ${told}
      ${sessions}
    </div>`;
  }).join('\n');
  const ending = chapters.some((c) => c.status === 'active') ? 'continues' : 'ended';
  return `<section class="story-contents"${noPreviewAttr()}><h2>The Story So Far</h2>
      <p><a class="story-begin" href="${href(spine[0].outputPath)}">Begin reading &rarr;</a></p>
      ${entries}
      <p class="story-contents-end" data-ending="${ending}"></p></section>`;
}

function storyLanding(spine, characterStories, config, publishConfig, navFor, npcStories = []) {
  const saga = spine.length ? contentsHtml(spine) : '';
  let chars = '';
  if (characterStories.length || npcStories.length) {
    const groups = ['current', 'retired', 'fallen'].map(g => {
      const inG = characterStories.filter(c => c.group === g);
      if (!inG.length) return '';
      const links = inG.map(c => `<li><a href="${encodeHref(relativeHref(OUT, c.outputPath))}">${escapeHtml(c.title)}</a></li>`).join('');
      return `<h3>${GROUP_LABELS[g]}</h3><ul>${links}</ul>`;
    }).join('');
    // The marker is the one Dead End's old add-crew-stories step looks for, so that step, if
    // left in place, finds the list already there and adds none.
    const npcs = npcStories.length
      ? `<!-- crew-stories --><h3>NPC stories</h3><ul>${npcStories.map(c => `<li><a href="${encodeHref(relativeHref(OUT, c.outputPath))}">${escapeHtml(c.title)}</a></li>`).join('')}</ul>`
      : '';
    chars = `<section class="story-branch"${noPreviewAttr()}><h2>Character Stories</h2>${groups}${npcs}</section>`;
  }
  const content = `<h1 class="page-title">Story</h1>${saga}${chars}`;
  return baseShell({
    pageType: 'story',
    title: 'Story', siteTitle: config.siteTitle, cssHref: cssPath(OUT), navHtml: navFor(OUT, config),
    rootHref: rootPath(OUT), content, footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset,
    overridesCss: (publishConfig || {})._overridesCss,
    scripts: clientScripts(OUT),
  });
}

module.exports = { storyLanding };
