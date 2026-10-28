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
    if (!KEYS.includes(key) && key !== 'accepted') warn(`${PUBLISH_LIST_FILE}: "${key}" is not a section of the publish list (${KEYS.join(', ')}); ignored`);
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
  // accepted: findings of the leak gate the GM accepted, each tied to its page and its exact (normalised) text. Written
  // by `leaks accept`, never by hand.
  const accepted = [];
  if (top.accepted !== null && top.accepted !== undefined) {
    if (!Array.isArray(top.accepted)) warn(`${PUBLISH_LIST_FILE}: "accepted" must be a list; ignored`);
    else {
      for (const item of top.accepted) {
        if (item && typeof item === 'object' && isText(item.page) && isText(item.text)) {
          accepted.push({ page: item.page.trim(), text: item.text.trim(), note: isText(item.note) ? item.note.trim() : '' });
        } else warn(`${PUBLISH_LIST_FILE}: an entry under "accepted" has no page or no text; dropped`);
      }
    }
  }
  // A file holding only `accepted:` (a vault that never had a publish list, whose GM accepted a finding) is not a
  // publish list for page decisions: loadManifest answers null for it.
  const acceptedOnly = 'accepted' in top && !KEYS.some((key) => key in top);
  return { publishing, excluded, needsDecision, reasons, accepted, acceptedOnly, file: 'new' };
}

// Reads the publish list of a vault: null when there is none, otherwise
// { publishing, excluded, needsDecision (path lists), reasons (Map path -> reason), accepted, file: 'new' | 'old' }.
// `file` names the file read, so a caller can tell a vault the update has not moved. An invalid YAML file throws.
// A file holding only `accepted:` is no publish list for page decisions: null here. loadPublishList is the whole read.
function loadManifest(vaultPath, options) {
  const list = loadPublishList(vaultPath, options);
  return list && list.acceptedOnly ? null : list;
}

// The file as it stands, an accepted-only one included (the leak gate and `leaks accept` read and write it this way).
function loadPublishList(vaultPath, { warn = console.warn } = {}) {
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
  // The reasons the old reader finds, beside an entry of any list, for the list that entry is in.
  const annotated = parseAnnotatedManifest(text);
  const reasons = new Map();
  for (const [list, section] of [[parsed.publishing, 'publishing'], [parsed.excluded, 'excluded']]) {
    for (const rel of list) {
      const entry = annotated.get(rel);
      if (entry && entry.section === section && entry.annotation && !reasons.has(rel)) reasons.set(rel, entry.annotation);
    }
  }
  for (const rel of parsed.needsDecision) {
    const entry = annotated.get(rel);
    if (entry && entry.section === 'needsDecision' && entry.decisionNote && !reasons.has(rel)) reasons.set(rel, entry.decisionNote);
  }
  return {
    publishing: parsed.publishing,
    excluded: parsed.excluded,
    needsDecision: parsed.needsDecision,
    reasons,
    accepted: [],
    file: 'old',
  };
}

const sortedPaths = (list) => [...new Set(list || [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// The text of a publish list file for `list` (the shape loadManifest returns): paths sorted, each reason beside its path.
function listText(list) {
  const accepted = (list.accepted || []).slice().sort((a, b) => (a.page < b.page ? -1 : a.page > b.page ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const acceptedDoc = accepted.map((a) => ({ page: a.page, text: a.text, note: a.note || '' }));
  // An accepted-only list stays accepted-only, even emptied: three empty lists would make it a publish list.
  if (list.acceptedOnly) return YAML.stringify({ accepted: acceptedDoc }, { lineWidth: 0 });
  const reasons = list.reasons || new Map();
  const doc = {
    publishing: sortedPaths(list.publishing).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : rel)),
    excluded: sortedPaths(list.excluded).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : { path: rel })),
    needs_decision: sortedPaths(list.needsDecision).map((rel) => (reasons.get(rel) ? { path: rel, reason: reasons.get(rel) } : rel)),
  };
  if (accepted.length) doc.accepted = acceptedDoc;
  return YAML.stringify(doc, { lineWidth: 0 });
}

// Writes the accepted findings into the vault's publish list, keeping its three lists. A vault still on the old Markdown
// list is refused: only the update and `manifest convert` move a list. A vault with no list gets a file holding only
// `accepted:`, which is not a publish list for page decisions (amendment 7a).
function writeAccepted(vaultPath, accepted) {
  const list = loadPublishList(vaultPath, { warn: () => {} });
  if (list && list.file !== 'new') {
    throw new Error(`This vault's publish list is not in ${PUBLISH_LIST_FILE} yet. Run the update (or gm-apprentice-publish manifest convert --vault <vault>) first.`);
  }
  const base = list || { publishing: [], excluded: [], needsDecision: [], reasons: new Map(), acceptedOnly: true };
  writeAtomic(at(vaultPath, PUBLISH_LIST_FILE), listText({ ...base, accepted }));
}

// Moves paths from `publishing` to the end of `needs_decision` in the vault's publish list, each entry as written (its
// reason and the comment above it go with it, the first entry's too); every other line of the file, comments, order,
// indentation and line ends included, is kept. A path also under `excluded` or `needs_decision` only leaves
// publishing: it stays where the GM had it (under excluded it is off the site, the GM's older choice). Read back before
// it is written, by the reader's own rule for a path in two lists: the lists must be what was asked, or nothing is
// written. A path that is not under publishing throws, naming it, the file untouched.
// Returns [{ path, now: 'needs_decision' | 'excluded' }], one for each path, in the order asked.
function moveToNeedsDecision(vaultPath, rels) {
  const file = at(vaultPath, PUBLISH_LIST_FILE);
  const raw = fs.readFileSync(file, 'utf-8');
  const crlf = raw.includes('\r\n');
  const text = raw.replace(/\r\n/g, '\n');
  const before = parseNewFile(text, () => {});
  const wanted = [...new Set(rels.map(canonicalPath))];
  const missing = wanted.filter((rel) => !before.publishing.includes(rel));
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not under publishing in ${PUBLISH_LIST_FILE}; nothing was changed`);
  const doc = YAML.parseDocument(text);
  const pathOf = (node) => canonicalPath(String(YAML.isMap(node) ? node.get('path') : YAML.isScalar(node) ? node.value : '').trim());
  const seqPaths = (key) => { const seq = doc.get(key, true); return new Set(YAML.isSeq(seq) ? seq.items.map(pathOf) : []); };
  const inExcluded = seqPaths('excluded');
  const inDecide = seqPaths('needs_decision');
  const publishing = doc.get('publishing', true);
  const moving = publishing.items.filter((node) => wanted.includes(pathOf(node)));
  // The first entry's comment is kept on the list, not the entry: it goes with the entry.
  if (moving.length && publishing.items[0] === moving[0] && publishing.commentBefore) {
    moving[0].commentBefore = [publishing.commentBefore, moving[0].commentBefore].filter(Boolean).join('\n');
    publishing.commentBefore = undefined;
  }
  publishing.items = publishing.items.filter((node) => !moving.includes(node));
  // Only a path in neither other list goes to needs_decision, once.
  const placed = new Set();
  const toDecide = moving.filter((node) => {
    const rel = pathOf(node);
    if (inExcluded.has(rel) || inDecide.has(rel) || placed.has(rel)) return false;
    placed.add(rel);
    return true;
  });
  if (toDecide.length) {
    let decide = doc.get('needs_decision', true);
    if (!YAML.isSeq(decide)) {
      decide = doc.createNode([]);
      doc.set('needs_decision', decide);
    }
    decide.flow = false;
    decide.items.push(...toDecide);
  }
  // The file's own indentation: a list written flush under its key stays flush; an indented one keeps its width.
  const indented = /^[a-z_]+:[^\S\n]*\n( +)- /m.exec(text);
  const flush = /^[a-z_]+:[^\S\n]*\n- /m.test(text);
  const out = doc.toString({ lineWidth: 0, indentSeq: !(flush && !indented), indent: indented ? indented[1].length : 2 });
  // What the reader must make of the result: the lists as they now stand in the file, read by its own rule.
  const expected = {
    publishing: before.publishing.filter((rel) => !wanted.includes(rel)),
    excluded: [...new Set([...inExcluded].filter((rel) => !before.publishing.includes(rel) || wanted.includes(rel)))],
    needs_decision: [...inDecide, ...toDecide.map(pathOf)],
  };
  const want = parseNewFile(YAML.stringify(expected), () => {});
  const after = parseNewFile(out, () => {});
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  for (const key of ['publishing', 'excluded', 'needsDecision']) {
    if (!same(after[key], want[key])) throw new Error(`${PUBLISH_LIST_FILE} did not read back as asked after moving ${wanted.join(', ')} (${key} differs); nothing was changed`);
  }
  writeAtomic(file, crlf ? out.replace(/\n/g, '\r\n') : out);
  return wanted.map((rel) => ({ path: rel, now: inExcluded.has(rel) ? 'excluded' : 'needs_decision' }));
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

module.exports = { readPublishListFile, parseListText, loadManifest, loadPublishList, writeAccepted, listText, writePublishList, moveToNeedsDecision, counts, canonicalPath, resetNotices };
