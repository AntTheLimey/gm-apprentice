'use strict';
// The publish list: `_meta/publish-list.yaml`, read and written with the YAML library.
//
//   publishing:        # paths that publish
//     - Characters/NPCs/Vex.md
//   excluded:          # paths held back on purpose; a reason is optional
//     - path: Sessions/Session 09.md
//       reason: prep
//   needs_decision:    # paths nobody has decided yet
//     - Drafts/Idea.md
//
// A vault whose update has not run still has the Markdown file (`_meta/publish-manifest.md`); it is read by
// manifest-legacy.js, with a notice, until the list is moved.
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

  const reasons = new Map();
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
      else if (key === 'excluded' && item && typeof item === 'object' && !Array.isArray(item) && isText(item.path)) {
        rel = item.path;
        if (isText(item.reason)) reason = item.reason.trim();
      }
      if (rel === null) {
        warn(`${PUBLISH_LIST_FILE}: an entry under "${key}" is not a path${key === 'excluded' ? ' (or a path with a reason)' : ''}; dropped`);
        continue;
      }
      rel = canonicalPath(rel.trim());
      if (!sections[key].includes(rel)) sections[key].push(rel);
      if (reason && !reasons.has(rel)) reasons.set(rel, reason);
    }
  }

  // A path in two lists: publishing wins, then excluded (the order the build checks them in).
  const publishing = sections.publishing;
  const claimed = new Set(publishing);
  const excluded = [];
  for (const rel of sections.excluded) {
    if (claimed.has(rel)) { warn(`${PUBLISH_LIST_FILE}: "${rel}" is under publishing and excluded; it publishes`); reasons.delete(rel); } else excluded.push(rel);
  }
  for (const rel of excluded) claimed.add(rel);
  const needsDecision = [];
  for (const rel of sections.needs_decision) {
    if (claimed.has(rel)) warn(`${PUBLISH_LIST_FILE}: "${rel}" is under needs_decision and also another list; the other list wins`);
    else needsDecision.push(rel);
  }
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
    if (hasOld) sayOnce(warn, `The old publish list ${OLD_LIST_FILE} is left over and not read; ${PUBLISH_LIST_FILE} is the publish list. Remove the old file once you have checked the new one.`);
    return parseNewFile(fs.readFileSync(newFile, 'utf-8'), warn);
  }
  if (!hasOld) return null;
  sayOnce(warn, `The publish list is still in ${OLD_LIST_FILE}; the next update moves it to ${PUBLISH_LIST_FILE}.`);
  const { parseManifest } = require('./manifest-legacy');
  const parsed = parseManifest(fs.readFileSync(oldFile, 'utf-8'));
  return {
    publishing: parsed.publishing,
    excluded: parsed.excluded,
    needsDecision: parsed.needsDecision,
    reasons: new Map(),
    file: 'old',
  };
}

const sortedPaths = (list) => [...new Set(list || [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// The text of a publish list file for `list` (the shape loadManifest returns): paths sorted, each reason beside its path.
function listText(list) {
  const reasons = list.reasons || new Map();
  const doc = {
    publishing: sortedPaths(list.publishing),
    excluded: sortedPaths(list.excluded).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : { path: rel })),
    needs_decision: sortedPaths(list.needsDecision),
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

module.exports = { loadManifest, listText, writePublishList, counts, canonicalPath, resetNotices };
