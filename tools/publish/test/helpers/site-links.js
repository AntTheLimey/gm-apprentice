'use strict';
// The links a built site holds that lead nowhere: every relative href/src in every .html file under `dir` whose
// target is not a file there (a folder counts when it holds index.html). Anchors and ?queries are taken off and the
// address is URI-decoded first. Addresses with a scheme (https:, mailto:, data:), protocol-relative and root-relative
// ones, and bare #anchors are not checked.
const fs = require('node:fs');
const path = require('node:path');

function htmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(full);
    return e.name.endsWith('.html') ? [full] : [];
  });
}

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function brokenLinks(dir) {
  const out = [];
  for (const file of htmlFiles(dir)) {
    const html = fs.readFileSync(file, 'utf8');
    const page = path.relative(dir, file).split(path.sep).join('/');
    const re = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let m;
    while ((m = re.exec(html))) {
      const href = unescape(m[1] != null ? m[1] : m[2]).trim();
      if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const bare = href.replace(/[?#][\s\S]*$/, '');
      if (!bare) continue;
      let decoded;
      try { decoded = decodeURI(bare); } catch (e) { out.push({ page, href }); continue; }
      const target = path.resolve(path.dirname(file), decoded);
      const ok = fs.existsSync(target)
        && (fs.statSync(target).isFile() || fs.existsSync(path.join(target, 'index.html')));
      if (!ok) out.push({ page, href });
    }
  }
  return out;
}

module.exports = { brokenLinks, htmlFiles };
