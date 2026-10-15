'use strict';
// The publish list: `_meta/publish-list.yaml`, read and written with the YAML library.
//
//   publishing:        # paths that publish; like excluded, an entry may be { path, reason }
//     - Characters/NPCs/Vex.md
//   excluded:          # paths held back on purpose; a reason is optional
//     - path: Sessions/Session 09.md
//       reason: prep
//   needs_decision:    # paths nobody has decided yet; an entry may be { path, reason } here too
//     - Drafts/Idea.md
//
// Only `excluded` reasons settle anything; the others are the GM's notes, kept.
// A vault whose update has not run still has the Markdown file (`_meta/publish-manifest.md`); it is read and
// written by manifest-legacy.js, with a notice, until the update or `manifest convert` moves the list.
const fs = require('fs');
const YAML = require('yaml');
const { canonicalNfc } = require('./unicode');
const { writeAtomic } = require('./settings/write');
const { PUBLISH_LIST_FILE, OLD_LIST_FILE, at } = require('./settings/layout');

// Normalize a vault-relative path to NFC for equality comparisons (#139). build.js compares
// list entries against scanned paths with exact-string `Set.has()`, so without a shared
// normal form a list entry can silently fail to match the page it names. Both sides of
// every such comparison must run through this helper. See lib/unicode.js for why the two
// normal forms of one visible name differ, and for the other comparison boundaries.
function canonicalPath(entry) {
  return canonicalNfc(entry);
}

const KEYS = ['publishing', 'excluded', 'needs_decision'];

// The notices said once per process, so a build that reads the list twice does not repeat them.
const said = new Set();
function resetNotices() { said.clear(); }
function sayOnce(warn, message) {
  if (said.has(message)) return;
  said.add(message);
  warn(message);
}

const isText = (x) => typeof x === 'string' && x.trim() !== '';

function parseNewFile(text, warn) {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length) {
    throw new Error(`${PUBLISH_LIST_FILE} is not valid YAML: ${doc.errors[0].message.split('\n')[0]}`);
  }
  const data = doc.toJS();
  if (data !== null && data !== undefined && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error(`${PUBLISH_LIST_FILE} is not valid YAML: expected the sections ${KEYS.join(', ')}`);
  }
  const top = data || {};
  for (const key of Object.keys(top)) {
    if (!KEYS.includes(key)) warn(`${PUBLISH_LIST_FILE}: "${key}" is not a section of the publish list (${KEYS.join(', ')}); ignored`);
  }

  const reasonsBy = { publishing: new Map(), excluded: new Map(), needs_decision: new Map() };
  const sections = {};
  for (const key of KEYS) {
    const raw = top[key];
    sections[key] = [];
    if (raw === null || raw === undefined) continue;
    if (!Array.isArray(raw)) {
      warn(`${PUBLISH_LIST_FILE}: "${key}" must be a list of paths; ignored`);
      continue;
    }
    for (const item of raw) {
      let rel = null;
      let reason = null;
      if (isText(item)) rel = item;
      else if (item && typeof item === 'object' && !Array.isArray(item) && isText(item.path)) {
        rel = item.path;
        if (isText(item.reason)) reason = item.reason.trim();
      }
      if (rel === null) {
        warn(`${PUBLISH_LIST_FILE}: an entry under "${key}" is not a path (or a path with a reason); dropped`);
        continue;
      }
      rel = canonicalPath(rel.trim());
      if (!sections[key].includes(rel)) sections[key].push(rel);
      if (reason && !reasonsBy[key].has(rel)) reasonsBy[key].set(rel, reason);
    }
  }

  // A path in two lists: publishing wins, then excluded (the order the build checks them in).
  const publishing = sections.publishing;
  const claimed = new Set(publishing);
  const excluded = [];
  for (const rel of sections.excluded) {
    if (claimed.has(rel)) { warn(`${PUBLISH_LIST_FILE}: "${rel}" is under publishing and excluded; it publishes`); } else excluded.push(rel);
  }
  for (const rel of excluded) claimed.add(rel);
  const reasons = new Map();
  for (const rel of publishing) if (reasonsBy.publishing.has(rel)) reasons.set(rel, reasonsBy.publishing.get(rel));
  for (const rel of excluded) if (reasonsBy.excluded.has(rel)) reasons.set(rel, reasonsBy.excluded.get(rel));
  const needsDecision = [];
  for (const rel of sections.needs_decision) {
    if (claimed.has(rel)) warn(`${PUBLISH_LIST_FILE}: "${rel}" is under needs_decision and also another list; the other list wins`);
    else needsDecision.push(rel);
  }
  for (const rel of needsDecision) if (reasonsBy.needs_decision.has(rel)) reasons.set(rel, reasonsBy.needs_decision.get(rel));
  return { publishing, excluded, needsDecision, reasons, file: 'new' };
}

// Reads the publish list of a vault: null when there is none, otherwise
// { publishing, excluded, needsDecision (path lists), reasons (Map path -> reason), file: 'new' | 'old' }.
// `file` names the file read, so a caller can tell a vault the update has not moved. An invalid YAML file throws.
function loadManifest(vaultPath, { warn = console.warn } = {}) {
  const newFile = at(vaultPath, PUBLISH_LIST_FILE);
  const oldFile = at(vaultPath, OLD_LIST_FILE);
  const hasNew = fs.existsSync(newFile);
  const hasOld = fs.existsSync(oldFile);
  if (hasNew) {
    if (hasOld) sayOnce(warn, `The old publish list ${OLD_LIST_FILE} is left over and not read; ${PUBLISH_LIST_FILE} is the publish list. The next update (or manifest convert) checks the two agree and sets the old file aside.`);
    return parseNewFile(fs.readFileSync(newFile, 'utf-8'), warn);
  }
  if (!hasOld) return null;
  sayOnce(warn, `The publish list is still in ${OLD_LIST_FILE}; the update moves it to ${PUBLISH_LIST_FILE}, or says what holds it back.`);
  const { parseManifest, parseAnnotatedManifest } = require('./manifest-legacy');
  const text = fs.readFileSync(oldFile, 'utf-8');
  const parsed = parseManifest(text);
  // The reasons the old reader finds: beside a Publishing or Excluded entry, for the list that entry is in.
  const annotated = parseAnnotatedManifest(text);
  const reasons = new Map();
  for (const [list, section] of [[parsed.publishing, 'publishing'], [parsed.excluded, 'excluded']]) {
    for (const rel of list) {
      const entry = annotated.get(rel);
      if (entry && entry.section === section && entry.annotation && !reasons.has(rel)) reasons.set(rel, entry.annotation);
    }
  }
  return {
    publishing: parsed.publishing,
    excluded: parsed.excluded,
    needsDecision: parsed.needsDecision,
    reasons,
    file: 'old',
  };
}

const sortedPaths = (list) => [...new Set(list || [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// The text of a publish list file for `list` (the shape loadManifest returns): paths sorted, each reason beside its path.
function listText(list) {
  const reasons = list.reasons || new Map();
  const doc = {
    publishing: sortedPaths(list.publishing).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : rel)),
    excluded: sortedPaths(list.excluded).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : { path: rel })),
    needs_decision: sortedPaths(list.needsDecision).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : rel)),
  };
  return YAML.stringify(doc, { lineWidth: 0 });
}

function writePublishList(vaultPath, list) {
  writeAtomic(at(vaultPath, PUBLISH_LIST_FILE), listText(list));
}

function counts(list) {
  return {
    publishing: (list.publishing || []).length,
    excluded: (list.excluded || []).length,
    needsDecision: (list.needsDecision || []).length,
  };
}

// Reads one publish list file by its full path (the conversion reads its temporary copy this way). Throws when invalid.
function readPublishListFile(file, { warn = console.warn } = {}) {
  return parseNewFile(fs.readFileSync(file, 'utf-8'), warn);
}

// The same reading, for text already in hand.
function parseListText(text, { warn = console.warn } = {}) {
  return parseNewFile(text, warn);
}

module.exports = { readPublishListFile, parseListText, loadManifest, listText, writePublishList, counts, canonicalPath, resetNotices };
