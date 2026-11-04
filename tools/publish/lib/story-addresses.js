'use strict';
// Sessions that move chapter keep their old Story address (chapter pages). A session's Story address is made from its
// chapter's title, so moving a session note to another chapter moves its page, and the vault holds no trace of where it
// was. The build keeps a record of every Story address each session has had, beside the site (never in it, which each
// full build empties, and never in the vault), and writes a redirect at each earlier address to the one it has now.
// The record keeps a session's addresses when the Story stops showing it, for when it shows again. A session is known
// by its note's file name (NFC), which a move to another chapter's folder keeps, as links in the vault name it; two
// shown sessions with one file name are told apart by nothing, so neither is recorded nor redirected, an earlier record
// of that name is dropped, and the build says so. The record starts at the first build with it: a move made before
// then is not known.
const fs = require('fs');
const path = require('path');
const { CACHE_FOLDER } = require('./image-optimize');
const { canonicalNfc } = require('./unicode');

const FILE = 'story-addresses.json';
const VERSION = 1;

// Where the record lives: the site folder's own folder, beside the image cache.
const storyAddressesPath = (siteDir) => path.join(siteDir, CACHE_FOLDER, FILE);

// Each session's Story addresses, earliest first, by the session note's file name (NFC). No record (the first build of
// a site with this version) is none, silently. A record that cannot be read (corrupt, unreadable, another version) is
// never overwritten: it is moved aside to a dated .bak beside it and `warn` says so, and the build starts a new record.
// One that cannot be moved aside either answers null: the build then leaves it as it is and writes no record.
// `today` (YYYY-MM-DD) names the .bak.
function readStoryAddresses(siteDir, { warn = () => {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const file = storyAddressesPath(siteDir);
  let problem;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && !Array.isArray(data) && data.version === VERSION && data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions)) {
      const out = new Map();
      for (const [key, list] of Object.entries(data.sessions)) {
        if (Array.isArray(list)) out.set(canonicalNfc(key), list.filter((a) => typeof a === 'string' && a));
      }
      return out;
    }
    problem = data && data.version !== undefined && data.version !== VERSION ? `it is version ${JSON.stringify(data.version)}, not ${VERSION}` : 'it is not a record of Story addresses';
  } catch (e) {
    if (e.code === 'ENOENT') return new Map();
    problem = e.message;
  }
  let bak = `${file}.${today}.bak`;
  for (let n = 2; fs.existsSync(bak); n++) bak = `${file}.${today}-${n}.bak`;
  try {
    fs.renameSync(file, bak);
    warn(`the record of old Story addresses (${file}) could not be read (${problem}); it is kept as ${bak} and a new record starts, so sessions that moved chapter before now will not redirect from their old addresses`);
  } catch (e) {
    warn(`the record of old Story addresses (${file}) could not be read (${problem}), nor moved aside (${e.message}); it is left as it is and not written this build, so sessions that moved chapter will not redirect from their old addresses`);
    return null;
  }
  return new Map();
}

const sessionKey = (unit, relOf) => canonicalNfc(path.posix.basename(String(relOf(unit.sourcePage)).replace(/\\/g, '/')));
const allSessions = (spine) => (spine || []).filter((u) => u.kind === 'session' && u.sourcePage);

// Each shown session's Story page, by its note's file name: [key, unit], where no other shown session has that name.
function shownSessions(spine, relOf) {
  const byKey = new Map();
  for (const unit of allSessions(spine)) {
    const key = sessionKey(unit, relOf);
    byKey.set(key, byKey.has(key) ? null : unit);
  }
  return [...byKey].filter(([, unit]) => unit);
}

// The file names two or more shown sessions share: those sessions keep no old address (the build says so).
function sharedSessionNames(spine, relOf) {
  const seen = new Map();
  for (const unit of allSessions(spine)) {
    const key = sessionKey(unit, relOf);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key);
}

// Keeps `previous` with each shown session's address now added. `relOf(page)` is a note's vault-relative path.
function writeStoryAddresses(siteDir, spine, relOf, previous) {
  const all = new Map([...previous].map(([k, v]) => [k, [...v]]));
  // A name two shown sessions now share is dropped: its old addresses can no longer say which session they were.
  for (const key of sharedSessionNames(spine, relOf)) all.delete(key);
  for (const [key, unit] of shownSessions(spine, relOf)) {
    const list = all.get(key) || [];
    if (!list.includes(unit.outputPath)) list.push(unit.outputPath);
    all.set(key, list);
  }
  const file = storyAddressesPath(siteDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sessions = Object.fromEntries([...all].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  // Whole or not at all: a temporary file beside it, renamed over it.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: VERSION, sessions }, null, 1)}\n`);
  try { fs.renameSync(tmp, file); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}

// The redirects to write: { from, to } for each earlier address of a session the Story shows now, where this build
// writes no page (`taken`, the addresses this build writes).
function movedSessions(previous, spine, relOf, taken) {
  const out = [];
  const seen = new Set();   // an address two sessions once had leads to the first, in reading order
  for (const [key, unit] of shownSessions(spine, relOf)) {
    for (const from of previous.get(key) || []) {
      if (from === unit.outputPath || taken.has(from) || seen.has(from)) continue;
      seen.add(from);
      out.push({ from, to: unit.outputPath });
    }
  }
  return out;
}

module.exports = { storyAddressesPath, readStoryAddresses, writeStoryAddresses, movedSessions, sharedSessionNames };
