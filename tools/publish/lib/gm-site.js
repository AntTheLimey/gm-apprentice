'use strict';
// The GM site's folder and the rules it keeps. The GM site is built into its own folder, which the build empties first,
// so that folder must be one the GM site owns: never the player site's, never the vault, never a folder of the GM's own files.
const fs = require('node:fs');
const { readerFrom } = require('./vault-reader');
const os = require('node:os');
const path = require('node:path');

const MARKER_FILE = 'gm-build.json';
// The mark every page of a GM build carries, so deploy can tell a GM folder even when its marker file is gone.
// The one spelling of it: the GM build writes this exact text and the deploy test looks for it.
const GM_META_TAG = '<meta name="gm-apprentice-build" content="gm">';

// The real path of a path that may not exist yet: its nearest existing folder's real path with the rest put back.
// A link in the folder that leads somewhere is compared by where it leads, even when what it leads to is not made yet.
// A path that is not there (or runs through a file, or through a ring of links) is judged by its nearest folder that is;
// any other failure to look is an error, never a quiet answer (#424).
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

function real(p, deps) {
  const realpath = readerFrom(deps).realpath;
  const tail = [];
  let cur = path.resolve(p);
  const MAX_LINK_HOPS = 40;   // a ring of links ends here, and the path is read as written
  for (let hops = 0; ;) {
    try { return path.join(realpath(cur), ...tail); } catch (err) {
      if (!NOT_THERE.has(err.code)) throw err;
      let target = null;
      try {
        // The link the path stops at, when there are hops left to follow it.
        if (fs.lstatSync(cur).isSymbolicLink()) {
          hops += 1;
          if (hops <= MAX_LINK_HOPS) target = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
        }
      } catch { /* not a link */ }
      if (target) { cur = target; continue; }
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = up;
    }
  }
}

// A folder as written: `~/` is the home folder, a relative path is read from `base`.
function resolveGmFolder(folder, base) {
  const text = String(folder).trim();
  if (text === '~') return os.homedir();
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2));
  return path.resolve(base || '.', text);
}

// The player site folder with `-gm` added: the GM site's folder when none is named.
function defaultGmFolder(playerFolder) {
  const trimmed = String(playerFolder).replace(/[\\/]+$/, '');
  return `${trimmed}-gm`;
}

const inside = (child, parent) => child.startsWith(parent + path.sep);

// Whether a page under `dir` carries the GM build's meta tag; the first found ends the search. Used only to refuse a
// deploy, where erring wide is the safe direction: a folder or page that cannot be read counts as a GM page.
function hasGmPage(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return true; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (hasGmPage(full)) return true;
    } else if (e.isFile() && /\.html?$/i.test(e.name)) {
      try { if (fs.readFileSync(full, 'utf8').includes(GM_META_TAG)) return true; } catch { return true; }
    }
  }
  return false;
}

// Why a folder is not the GM site's to empty, or null when it is: it is missing, empty, or holds the marker file at
// its top level. The marker is written first, the moment the folder is empty, so a build that failed part-way still
// leaves it. Pages are never searched: one saved GM page deep in a folder of the GM's own must not make it ours to empty.
function gmOutputReason(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) {
    if (e.code === 'ENOENT') return null;
    return 'cannot be read as a folder';
  }
  if (entries.length === 0 || entries.includes(MARKER_FILE)) return null;
  return 'holds files the GM site did not make';
}

// What shows a folder is a GM build's, for the deploy refusal: the marker file, or a page carrying the GM build tag at
// any depth; null when neither is there.
// `entries` is the folder's listing when the caller has it already.
function gmEvidence(dir, entries) {
  let names = entries;
  if (!names) { try { names = fs.readdirSync(dir); } catch { return null; } }
  if (names.includes(MARKER_FILE)) return MARKER_FILE;
  return hasGmPage(dir) ? 'a page with the GM build tag' : null;
}

// Whether a folder is, or once was, a GM build's: false for a missing or empty folder and for an ordinary player site.
// Deploy refuses such a folder, so the GM site cannot go online by that road.
function isGmOutput(dir) {
  return gmEvidence(dir) !== null;
}

// null when `gmFolder` can be the GM site's folder, otherwise the one reason it cannot, as a line for the GM.
function gmFolderProblem(gmFolder, { playerSiteDir, playerOutputDir, vaultPath, deps }) {
  const shown = `gm_site.folder (${gmFolder})`;
  const gm = real(gmFolder, deps);
  if (gm === path.parse(gm).root) return `${shown} is the filesystem root; the GM site cannot be built there`;
  if (playerSiteDir) {
    const player = real(playerSiteDir, deps);
    if (gm === player) return `${shown} is the player site's folder; the GM site needs a folder of its own`;
    if (inside(gm, player)) return `${shown} is inside the player site's folder; the GM site needs a folder of its own`;
    if (inside(player, gm)) return `${shown} holds the player site's folder; the GM site needs a folder of its own`;
  }
  if (playerOutputDir) {
    const out = real(playerOutputDir, deps);
    if (gm === out) return `${shown} is the player site's output folder; the GM site needs a folder of its own`;
    if (inside(gm, out)) return `${shown} is inside the player site's output folder; the GM site needs a folder of its own`;
    if (inside(out, gm)) return `${shown} holds the player site's output folder; the GM site needs a folder of its own`;
  }
  if (vaultPath) {
    const vault = real(vaultPath, deps);
    if (gm === vault || inside(gm, vault)) return `${shown} is the vault or inside it; the GM site is built outside the vault`;
    if (inside(vault, gm)) return `${shown} holds the vault; the GM site is built outside the vault`;
  }
  // A link at the folder's own path that leads nowhere cannot be made into a folder.
  try {
    if (fs.lstatSync(gmFolder).isSymbolicLink() && !fs.existsSync(gmFolder)) return `${shown} is a link that leads nowhere; use an empty or new folder`;
  } catch { /* nothing there yet */ }
  const why = gmOutputReason(gm);
  if (why) return `${shown} ${why}; use an empty or new folder`;
  return null;
}

// What keeps a GM page out of a search engine, should the folder ever be served beyond the table.
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

// The marker file: { build, tool, built } and a line end. A GM build writes it first, the moment its folder is empty,
// with `now: null` (`built` is null: the build has not finished), so a build that fails part-way leaves a folder the
// next build knows as its own; and again last, with the time it finished.
function writeMarker(dir, { version, now = new Date() } = {}) {
  const marker = { build: 'gm', tool: String(version), built: now === null ? null : now.toISOString() };
  fs.writeFileSync(path.join(dir, MARKER_FILE), `${JSON.stringify(marker)}\n`);
}

// Whether `dir`, or a folder above it, is in a git work tree: a `.git` folder or file on the way up. No git is run.
function insideGitWorkTree(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return true;
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One hidden frontmatter value as HTML, the way a page prints a visible field (renderMetaValue: a link to a page the
// site has is a link, any other its label): a relationship as "<type>: <target>" and its description, a list joined,
// anything else as JSON text.
function hiddenValueHtml(value, render, escapeHtml) {
  if (Array.isArray(value)) return value.map((v) => hiddenValueHtml(v, render, escapeHtml)).join(', ');
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (!('target' in value)) return escapeHtml(JSON.stringify(value));
    const head = `${escapeHtml(value.type == null ? '' : value.type)}: ${render(value.target)}`;
    return value.description ? `${head} — ${render(value.description)}` : head;
  }
  return render(value);
}

// The "Hidden from players" panel: one marked line per value hiddenFieldsOf lists. Empty when it lists nothing.
// `linkMap` and `from` (the page's own address) resolve the links in a value, as on the page itself.
function hiddenPanel(hidden, { linkMap = {}, from = '' } = {}) {
  if (!Array.isArray(hidden) || hidden.length === 0) return '';
  const { escapeHtml, renderMetaValue } = require('./processor');   // here: the settings commands load this file, and processor.js is heavy
  const render = (v) => renderMetaValue(v, linkMap, from);
  const items = hidden.map((h) => {
    const label = escapeAttr(h.label);
    return `<div class="gm-mark gm-mark--${h.kind}" data-gm-kind="${h.kind}" data-gm-label="${label}">`
      + `<p class="gm-mark__label">GM: ${escapeHtml(h.label)}</p><p>${hiddenValueHtml(h.value, render, escapeHtml)}</p></div>`;
  });
  return `<aside class="gm-hidden"><h2 class="gm-hidden__title">Hidden from players</h2>${items.join('')}</aside>`;
}

const STYLE_HREF = /<link\b[^>]*\bhref="([^"]*?)css\/style\.css"/;

// A page as the GM site writes it: noindex, the GM meta tag and gm.css in the head; the band, the reason players do
// not see the page and the hidden-fields panel at the top of <main> (of <body>, on a page with no <main>); and every
// mark rendered. gm.css sits beside style.css, so its address is taken from the page's own style.css link; a page
// the tool makes with no style.css link (a styled prop page) names it in `gmCssHref`.
function gmPage(html, { marks, hiddenBecause = null, hidden = [], linkMap = {}, from = '', gmCssHref = null } = {}) {
  const { renderMarks } = require('./gm-marks');
  let out = String(html);
  const style = STYLE_HREF.exec(out);
  const href = style ? `${style[1]}css/gm.css` : gmCssHref && escapeAttr(gmCssHref);
  const css = href ? `<link rel="stylesheet" href="${href}">` : '';
  const head = `${ROBOTS_META}\n${GM_META_TAG}\n${css}`;
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, () => `${head}\n</head>`) : `${head}\n${out}`;
  const reason = hiddenBecause ? `Players don't see this page: ${hiddenBecause}` : null;
  const top = [
    '<div class="gm-band" role="note">GM copy: not for players</div>',
    reason ? `<div class="gm-band gm-band--hidden gm-mark" data-gm-kind="notes" data-gm-label="${escapeAttr(reason)}">${escapeAttr(reason)}</div>` : '',
    hiddenPanel(hidden, { linkMap, from }),
  ].join('');
  const open = /<main(?=[\s>])[^>]*>/i.exec(out) || /<body(?=[\s>])[^>]*>/i.exec(out);
  out = open ? out.slice(0, open.index + open[0].length) + top + out.slice(open.index + open[0].length) : top + out;
  return renderMarks(out, marks);
}

module.exports = {
  MARKER_FILE, GM_META_TAG, ROBOTS_META, ROBOTS_TXT, real, resolveGmFolder, defaultGmFolder, gmFolderProblem, gmOutputReason,
  isGmOutput, gmEvidence, writeMarker, insideGitWorkTree, hiddenPanel, gmPage,
};
