'use strict';
// On a disk that does not tell letter case apart (macOS, Windows) git runs with core.ignorecase, and keeps a tracked
// file's old spelling in its index when only its case changes on disk: `git add` records no rename, and the deployed
// site keeps serving the old address (#576). The build renames a kept-folder file or folder to its new spelling; the
// deploy takes each tracked spelling that no longer matches the disk out of the index, so `git add` records the new
// one. A tracked path whose file is gone, or one the disk lists exactly, is left to `git add` as before.
const fs = require('fs');
const path = require('path');
const { canonicalNfc } = require('./unicode');

// { paths, error }: the tracked paths under `outDir` (git's spelling, relative to `siteRoot`) whose file the disk now
// lists under another letter case, in a name or any folder on its path; `error` is git's failure, with no paths.
function staleCaseSpellings(siteRoot, outDir, runCommand) {
  const ls = runCommand('git', ['ls-files', '-z', '--', outDir], { cwd: siteRoot });
  if (ls.code !== 0) return { paths: [], error: ls };
  const listings = new Map();
  const listed = (dir) => {
    if (!listings.has(dir)) {
      let names = null;
      try { names = fs.readdirSync(dir); } catch (e) { if (!e.code) throw e; }
      listings.set(dir, names);
    }
    return listings.get(dir);
  };
  const paths = [];
  for (const rel of String(ls.stdout || '').split('\0').filter(Boolean)) {
    let dir = siteRoot;
    let other = false;
    let there = true;
    for (const part of rel.split('/')) {
      const names = listed(dir);
      const want = canonicalNfc(part);
      const exact = names && names.find((n) => canonicalNfc(n) === want);
      const near = !exact && names && names.find((n) => canonicalNfc(n).toLowerCase() === want.toLowerCase());
      if (!exact && !near) { there = false; break; }
      if (near) other = true;
      dir = path.join(dir, exact || near);
    }
    if (there && other) paths.push(rel);
  }
  return { paths, error: null };
}

module.exports = { staleCaseSpellings };
