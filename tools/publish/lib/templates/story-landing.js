const { escapeHtml, relativeHref } = require('../processor');
const { baseShell, cssPath, rootPath, clientScripts } = require('./base');

const OUT = 'story.html';
const GROUP_LABELS = { current: 'Current', retired: 'Retired', fallen: 'Fallen' };

function storyLanding(spine, characterStories, config, publishConfig, navFor) {
  let saga = '';
  if (spine.length) {
    const begin = relativeHref(OUT, spine[0].outputPath);
    const items = spine.map(u => `<li><a href="${relativeHref(OUT, u.outputPath)}">${escapeHtml(u.title)}</a></li>`).join('');
    saga = `<section class="story-branch"><h2>The Campaign Saga</h2>
      <p><a class="story-begin" href="${begin}">Begin reading &rarr;</a></p><ol class="story-toc">${items}</ol></section>`;
  }
  let chars = '';
  if (characterStories.length) {
    const groups = ['current', 'retired', 'fallen'].map(g => {
      const inG = characterStories.filter(c => c.group === g);
      if (!inG.length) return '';
      const links = inG.map(c => `<li><a href="${relativeHref(OUT, c.outputPath)}">${escapeHtml(c.title)}</a></li>`).join('');
      return `<h3>${GROUP_LABELS[g]}</h3><ul>${links}</ul>`;
    }).join('');
    chars = `<section class="story-branch"><h2>Character Stories</h2>${groups}</section>`;
  }
  const content = `<h1 class="page-title">Story</h1>${saga}${chars}`;
  return baseShell({
    title: 'Story', siteTitle: config.siteTitle, cssHref: cssPath(OUT), navHtml: navFor(OUT, config),
    rootHref: rootPath(OUT), content, footer: config.footer,
    genrePreset: (publishConfig || {})._genrePreset, scripts: clientScripts(OUT),
  });
}

module.exports = { storyLanding };
