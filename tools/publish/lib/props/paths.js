'use strict';

// Real-path walks shared by prop plans and prop styles: a path is used only when every folder
// entered and the file found resolve inside each root, so a symlink cannot lead out.
const fs = require('fs');
const path = require('path');
const { canonicalNfc } = require('../unicode');

function within(real, root) {
  return real === root || real.startsWith(root + path.sep);
}

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// Walk `segments` down from `base`. Each directory entered and the file found must
// real-path inside every root. Returns { full } or { why: 'missing' | 'outside' | 'case', name }.
function findUnder(base, segments, roots) {
  let dir = base;
  const spelled = [];
  for (let i = 0; i < segments.length; i++) {
    const realDir = realOrNull(dir);
    if (!realDir) return { why: 'missing' };
    if (!roots.every((r) => within(realDir, r))) return { why: 'outside' };
    let names;
    try { names = fs.readdirSync(dir); } catch { return { why: 'missing' }; }
    const want = canonicalNfc(segments[i]);
    const exact = names.find((n) => canonicalNfc(n) === want);
    if (!exact) {
      const folded = names.find((n) => canonicalNfc(n).toLowerCase() === want.toLowerCase());
      if (folded) return { why: 'case', name: [...spelled, folded, ...segments.slice(i + 1)].join('/') };
      return { why: 'missing' };
    }
    spelled.push(exact);
    dir = path.join(dir, exact);
  }
  const real = realOrNull(dir);
  if (!real) return { why: 'missing' };
  if (!roots.every((r) => within(real, r))) return { why: 'outside' };
  if (!fs.statSync(real).isFile()) return { why: 'missing' };
  return { full: dir, real };
}

module.exports = { within, realOrNull, findUnder };
