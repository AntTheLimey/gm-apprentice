'use strict';
// On a disk that does not tell letter case apart (macOS, Windows) git runs with core.ignorecase, and keeps a tracked
// file's old spelling in its index when only its case changes on disk: `git add` records no rename, and the deployed
// site keeps serving the old address (#576). The build renames a kept-folder file or folder to its new spelling; the
// deploy takes each tracked spelling that no longer matches the disk out of the index, so `git add` records the new
// one. A repo without core.ignorecase is never touched: there, git sees a case change as any other.
const fs = require('fs');
const path = require('path');
const { canonicalNfc } = require('./unicode');

// Big enough for the file list of any site (spawnSync's default is 1 MiB).
const LIST_BUFFER = 64 * 1024 * 1024;

// { caseBlind, paths, pending, error }. `caseBlind`: the repo has core.ignorecase on; with it off nothing else is
// asked. `paths`: the tracked paths under `outDir` (git's spelling, relative to `siteRoot`) whose file the disk now
// lists under another letter case, in a name or a folder on its path. `pending`: the index already holds a case-only
// rename HEAD does not have (a deploy whose commit failed after the old spellings left the index), so the commit must
// still take the whole index. `error`: git's failure.
function caseRenames(siteRoot, outDir, runCommand) {
  const cfg = runCommand('git', ['config', '--bool', 'core.ignorecase'], { cwd: siteRoot });
  if (String(cfg.stdout || '').trim() !== 'true') return { caseBlind: false, paths: [], pending: false, error: null };
  const list = (args) => runCommand('git', args, { cwd: siteRoot, maxBuffer: LIST_BUFFER });
  const ls = list(['ls-files', '-z', '--', outDir]);
  if (ls.code !== 0) return { caseBlind: true, paths: [], pending: false, error: ls };
  const tracked = String(ls.stdout || '').split('\0').filter(Boolean);
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
  for (const rel of tracked) {
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
  // HEAD against the index: a path HEAD has that the index holds only under another case. A repo with no commit yet
  // has no HEAD, and nothing pending.
  const head = list(['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', outDir]);
  let pending = false;
  if (head.code === 0) {
    const inIndex = new Set(tracked.map(canonicalNfc));
    const lower = new Set(tracked.map((p) => canonicalNfc(p).toLowerCase()));
    pending = String(head.stdout || '').split('\0').filter(Boolean)
      .some((p) => !inIndex.has(canonicalNfc(p)) && lower.has(canonicalNfc(p).toLowerCase()));
  }
  return { caseBlind: true, paths, pending, error: null };
}

// Paths in runs short enough for any command line (Windows caps one at 32,767 characters).
function batches(paths, limit = 8000) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const p of paths) {
    if (cur.length && len + p.length + 12 > limit) { out.push(cur); cur = []; len = 0; }
    cur.push(p);
    len += p.length + 12;
  }
  if (cur.length) out.push(cur);
  return out;
}

// The files under `dir` a case rename left under its temporary name (build.js renameCase), as site paths.
const CASE_TEMP = /\.case-\d+(?:-\d+)?\.tmp$/;
function caseTemps(dir, rel = '') {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (!e.code) throw e; return []; }
  const out = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (CASE_TEMP.test(e.name)) out.push(r);
    else if (e.isDirectory()) out.push(...caseTemps(path.join(dir, e.name), r));
  }
  return out;
}

module.exports = { caseRenames, batches, caseTemps, CASE_TEMP };
