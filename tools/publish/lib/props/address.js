'use strict';

// Where a prop's file lands on the site, and which addresses it may never take.
const path = require('path');
const { slugify } = require('../scanner');
const { canonicalNfc } = require('../unicode');
const { DIR_LABELS } = require('../templates/base');

const PROP_FILE_EXTS = new Set(['.html', '.htm', '.svg', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

// What `has()` says of an address a built page holds.
const PAGE_TAKER = 'a page the site builds';

const RESERVED_FILES = ['index.html', '404.html', 'story.html', 'timeline.html', 'previews.json', 'search-index.json', 'robots.txt', 'gm-build.json', 'NOTICE.txt', '.nojekyll', 'props/index.html'];
const RESERVED_PREFIXES = ['css/', 'js/', 'images/', 'fonts/', 'story/', 'props/styles/'];

// Two addresses are the same file when they match after NFC and case folding.
function addressKey(a) {
  return canonicalNfc(a).toLowerCase();
}

// `.htm` and `.html` are one extension.
function normExt(ext) {
  const e = String(ext).toLowerCase();
  return e === '.htm' ? '.html' : e;
}

function defaultPropAddress(noteRel, fileExt) {
  const name = path.posix.basename(String(noteRel).replace(/\\/g, '/')).replace(/\.md$/i, '');
  return `props/${slugify(canonicalNfc(name).replace(/_/g, ' '))}${normExt(fileExt)}`;
}

// The one other default a prop tries when a built page holds its default (a note kept in a
// Props/ folder has its page at props/<slug>.html): props/<slug>-prop<ext>.
function fallbackPropAddress(address) {
  const ext = path.posix.extname(address);
  return `${address.slice(0, address.length - ext.length)}-prop${ext}`;
}

function addressShapeProblem(address, fileExt) {
  const a = String(address);
  const notRelative = 'is not a relative site path';
  if (a.startsWith('/') || a.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(a)) return notRelative;
  const segments = a.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return notRelative;
  if (normExt(path.posix.extname(a)) !== normExt(fileExt)) return `must end in ${normExt(fileExt)}`;
  return null;
}

// `has(address, { explicit })` says why an address is taken, or null. A kept folder
// (`player_site.keep`) refuses only a default address: an explicit `prop_address` there
// replaces the kept file.
function takenAddresses({ pageOutputs = [], keptDirs = [] } = {}) {
  const files = new Map();
  for (const f of RESERVED_FILES) files.set(addressKey(f), 'a file the site needs');
  for (const dir of Object.keys(DIR_LABELS)) files.set(addressKey(`${dir}/index.html`), `the ${dir} index page`);
  for (const p of pageOutputs) files.set(addressKey(p), PAGE_TAKER);
  const prefixes = RESERVED_PREFIXES.map(addressKey);
  const kept = keptDirs.map((d) => addressKey(d).replace(/\/+$/, ''));
  return {
    has(address, { explicit = false } = {}) {
      const key = addressKey(address);
      if (files.has(key)) return files.get(key);
      const prefix = prefixes.find((p) => key.startsWith(p));
      if (prefix) return `inside the site's ${prefix} folder`;
      if (!explicit) {
        const dir = kept.find((d) => key.startsWith(`${d}/`));
        if (dir) return `inside the kept folder ${dir}`;
      }
      return null;
    },
  };
}

module.exports = { PROP_FILE_EXTS, PAGE_TAKER, addressKey, defaultPropAddress, fallbackPropAddress, addressShapeProblem, takenAddresses, RESERVED_FILES, RESERVED_PREFIXES };
