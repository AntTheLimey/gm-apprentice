'use strict';
// Sessions that move chapter keep their old Story address (chapter pages). A session's Story address is made from its
// chapter's title, so moving a session note to another chapter moves its page, and the vault holds no trace of where it
// was. The build keeps a record of every Story address each session has had, beside the site (never in it, which each
// full build empties, and never in the vault), and writes a redirect at each earlier address to the one it has now.
// The record keeps a session's addresses when the Story stops showing it, for when it shows again.
const fs = require('fs');
const path = require('path');
const { CACHE_FOLDER } = require('./image-optimize');
const { canonicalNfc } = require('./unicode');

const FILE = 'story-addresses.json';
const VERSION = 1;

// Where the record lives: the site folder's own folder, beside the image cache.
const storyAddressesPath = (siteDir) => path.join(siteDir, CACHE_FOLDER, FILE);

// Each session's Story addresses, earliest first, by the session note's vault-relative path (NFC). A missing or
// unreadable record is none: the build then writes no redirect, and starts a new record.
function readStoryAddresses(siteDir) {
  let data;
  try { data = JSON.parse(fs.readFileSync(storyAddressesPath(siteDir), 'utf8')); } catch (e) { return new Map(); }
  const sessions = data && data.version === VERSION && data.sessions && typeof data.sessions === 'object' ? data.sessions : {};
  const out = new Map();
  for (const [key, list] of Object.entries(sessions)) {
    if (Array.isArray(list)) out.set(canonicalNfc(key), list.filter((a) => typeof a === 'string' && a));
  }
  return out;
}

const sessionUnits = (spine) => (spine || []).filter((u) => u.kind === 'session' && u.sourcePage);

// Keeps `previous` with each shown session's address now added. `relOf(page)` is a note's vault-relative path.
function writeStoryAddresses(siteDir, spine, relOf, previous) {
  const all = new Map([...previous].map(([k, v]) => [k, [...v]]));
  for (const unit of sessionUnits(spine)) {
    const key = canonicalNfc(relOf(unit.sourcePage));
    const list = all.get(key) || [];
    if (!list.includes(unit.outputPath)) list.push(unit.outputPath);
    all.set(key, list);
  }
  const file = storyAddressesPath(siteDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sessions = Object.fromEntries([...all].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(file, `${JSON.stringify({ version: VERSION, sessions }, null, 1)}\n`);
}

// The redirects to write: { from, to } for each earlier address of a session the Story shows now, where this build
// writes no page (`taken`, the addresses this build writes).
function movedSessions(previous, spine, relOf, taken) {
  const out = [];
  const seen = new Set();   // an address two sessions once had leads to the first, in reading order
  for (const unit of sessionUnits(spine)) {
    for (const from of previous.get(canonicalNfc(relOf(unit.sourcePage))) || []) {
      if (from === unit.outputPath || taken.has(from) || seen.has(from)) continue;
      seen.add(from);
      out.push({ from, to: unit.outputPath });
    }
  }
  return out;
}

module.exports = { storyAddressesPath, readStoryAddresses, writeStoryAddresses, movedSessions };
