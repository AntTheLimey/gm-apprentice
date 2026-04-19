const { relativePath, escapeHtml } = require('../processor');
const { DIR_LABELS } = require('./base');

function generateNav(pages) {
  const sections = {};

  for (const page of pages) {
    const dir = page.outputDir || 'campaign';
    if (!sections[dir]) sections[dir] = [];
    sections[dir].push(page);
  }

  // Return a function that produces nav HTML relative to a given page
  return function navFor(currentOutputPath) {
    let html = '';
    for (const [dir, label] of Object.entries(DIR_LABELS)) {
      const dirPages = [];
      for (const [secDir, secPages] of Object.entries(sections)) {
        if (secDir === dir || secDir.startsWith(dir + '/')) {
          dirPages.push(...secPages);
        }
      }
      if (dirPages.length === 0) continue;
      html += `<h2>${escapeHtml(label)}</h2>\n<ul>\n`;
      for (const p of [...dirPages].sort((a, b) => a.title.localeCompare(b.title))) {
        const currentDir = currentOutputPath.substring(0, currentOutputPath.lastIndexOf('/'));
        const href = relativePath(currentDir, p.outputPath);
        html += `<li><a href="${href}">${escapeHtml(p.title)}</a></li>\n`;
      }
      html += `</ul>\n`;
    }
    return html;
  };
}

module.exports = { generateNav };
