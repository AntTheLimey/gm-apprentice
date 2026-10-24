'use strict';
// Moves the publish list from _meta/publish-manifest.md to _meta/publish-list.yaml, all or nothing:
// the new text is written to a temporary file, read back with the real reader, and compared with what
// the old file means and with every entry line in it; only when nothing is lost is it put in place and the
// old file set aside as _meta/publish-manifest.md.converted (kept, never read: it is not a .md file).
// A stop between those two steps leaves both files, which the next run finishes.
// Only the update and `manifest convert` call this: every other writer keeps the vault on the file it is on.
const fs = require('fs');
const { listText, readPublishListFile, parseListText, counts } = require('./manifest');
const { parseManifest, stripInlineComment } = require('./manifest-legacy');
const { writeAtomic } = require('./settings/write');
const { uncommentedLines } = require('./processor');
const path = require('path');
const { PUBLISH_LIST_FILE, OLD_LIST_FILE, PUBLISH_LIST_FROM, at } = require('./settings/layout');
const { siteToolOlderThan, siteFileNamedBy } = require('./settings/move');
const { readSettings } = require('./settings/read');
const { packageScripts } = require('./settings/steps');

const TEMP_SUFFIX = '.convert';
const KEPT_SUFFIX = '.converted';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (list) => [...new Set(list)].sort(byText);

// ---- Holding the move back ----------------------------------------------------------------------------------

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;

// The build steps of a site, as the commands to run: the vault's settings for both sites, and the site folder's
// package.json `prebuild` and `postbuild` (read by an older tool, and carried into the settings by the update).
function stepCommands(vault, siteDir, siteJson) {
  const commands = [];
  try {
    const { values } = readSettings({ vaultPath: vault, siteConfig: siteJson, siteDir });
    for (const group of ['player_site', 'gm_site']) {
      for (const slot of ['before_build', 'after_build']) {
        const list = values && values[group] && values[group][slot];
        if (Array.isArray(list)) commands.push(...list.filter((c) => typeof c === 'string'));
      }
    }
  } catch { /* unreadable settings hold nothing here */ }
  commands.push(...Object.values(packageScripts(siteDir)));
  return commands;
}

// The first build step that names the old list file, or null: the command itself, or a file inside the site folder
// that it names as a word (`node scripts/add-props.mjs` -> scripts/add-props.mjs). The reason is the step's own text.
function stepReadingOldList(vault, siteDir, siteJson) {
  let root;
  try { root = fs.realpathSync.native(siteDir); } catch { return null; }
  const seen = new Set();
  for (const command of stepCommands(vault, siteDir, siteJson)) {
    if (command.includes(path.basename(OLD_LIST_FILE))) return command.trim();
    for (const raw of command.split(/\s+/)) {
      const word = raw.replace(/^["']+|["']+$/g, '');
      if (!word || seen.has(word)) continue;
      seen.add(word);
      try {
        const real = fs.realpathSync.native(path.resolve(siteDir, word));
        const inside = path.relative(root, real);
        if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) continue;
        const stat = fs.statSync(real);
        if (!stat.isFile() || stat.size > MAX_SCRIPT_BYTES) continue;
        if (fs.readFileSync(real, 'utf8').includes(path.basename(OLD_LIST_FILE))) return inside.split(path.sep).join('/');
      } catch { /* not a file in the folder */ }
    }
  }
  return null;
}

// null when the list may move, else { held, line }. The site's tool older than PUBLISH_LIST_FROM reads a moved vault
// as having no list; a build step that reads the old file would find none. Left behind, not wrong: told every pass.
// With no site config given, the site folder the vault's own settings name is asked.
function holdFor(vault, siteConfigPath, { siteToolUpdated = false, pinCheck } = {}) {
  if (!siteConfigPath) {
    const named = siteFileNamedBy(vault);
    if (!named || !named.exists) return null;
    siteConfigPath = named.file;
  }
  const siteDir = path.dirname(siteConfigPath);
  const old = siteToolOlderThan(siteDir, PUBLISH_LIST_FROM, { updated: siteToolUpdated, ...(pinCheck ? { pinCheck } : {}) });
  if (old) {
    return { held: 'site-tool', line: `stays in ${OLD_LIST_FILE} until the site's publish tool is ${PUBLISH_LIST_FROM} or later` };
  }
  let siteJson = {};
  try { siteJson = JSON.parse(fs.readFileSync(siteConfigPath, 'utf8')); } catch { /* none */ }
  const script = stepReadingOldList(vault, siteDir, siteJson);
  if (script) {
    return { held: 'site-step', line: `stays in ${OLD_LIST_FILE}: your build step ${script} reads it. Change the script to ask \`gm-apprentice-publish manifest list --json\`, then run the update again.` };
  }
  return null;
}

// ---- What the old file says ---------------------------------------------------------------------------------

const SECTION_OF = [['Publishing', 'publishing'], ['Needs Decision', 'needsDecision'], ['Excluded', 'excluded']];
const WITH_REASON = /^(.*?\.\w+)(?:\s+(?:—|–|--)\s+(.*))?$/;

// Every entry line in the old file's three sections, read line by line on its own (not through the readers, so the
// check below sees what they miss): { rel, section, reason }. An entry line is a checkbox line, an indented bullet
// (a `- Reason:` group's paths), or a plain bullet that ends in a file name. A `- Reason:` line names the reason
// of the entries after it in its section, as the old annotated reader read it. A line a `%%` or `<!-- -->` comment
// hides is no entry, as the readers have it (#498); `commented: true` reads a line the comments hide whole as well,
// its comment marks taken out (a comment beside an entry leaves the entry, so that is no commented-out one).
function entryLines(oldText, { commented = false } = {}) {
  const body = String(oldText).replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const shown = uncommentedLines(body);
  const keptAt = new Map(shown.from.map((n, i) => [n, shown.lines[i]]));
  const read = commented ? body.split('\n').map((l, n) => (keptAt.has(n) ? keptAt.get(n) : l.replace(/%%|<!--|-->/g, ''))) : shown.lines;
  const found = [];
  let section = null;
  let groupReason = null;
  for (const line of read) {
    const heading = /^## (.+)/.exec(line);
    if (heading) {
      const title = heading[1].trim();
      const hit = SECTION_OF.find(([prefix]) => title.startsWith(prefix));
      section = hit ? hit[1] : null;
      groupReason = null;
      continue;
    }
    if (!section) continue;
    const group = /^\s*[-*+]\s+reason:\s*(.*)$/i.exec(line);
    if (group) { groupReason = group[1].trim() || null; continue; }
    let raw = null;
    const box = /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/.exec(line);
    if (box) raw = box[1].trim();
    else if (/^\s+[-*+]\s+\S/.test(line)) raw = line.replace(/^\s+[-*+]\s+/, '').trim();
    else if (/^[-*+]\s+\S/.test(line) && WITH_REASON.test(line.replace(/^[-*+]\s+/, '').trim())) raw = line.replace(/^[-*+]\s+/, '').trim();
    if (!raw) continue;
    const split = WITH_REASON.exec(raw);
    const reason = (split && split[2] ? split[2].trim() : null) || groupReason;
    found.push({ rel: stripInlineComment(raw), section, reason: reason || null });
  }
  return found;
}

// What the old file means, in the new file's three lists. The build's own reading decides what publishes.
// Every other entry line is kept, with its reason: one under Excluded is excluded (ticked or not: it never
// published and the GM's intent is plain); any other folds into needs_decision, so it stays unpublished
// (a ticked entry under Needs Decision, an unticked one under Publishing).
function expectedFrom(oldText) {
  const built = parseManifest(oldText);
  const lines = entryLines(oldText);
  const publishing = sorted(built.publishing);
  const taken = new Set(publishing);

  const underExcluded = lines.filter((l) => l.section === 'excluded').map((l) => l.rel);
  const excluded = sorted([...built.excluded, ...underExcluded].filter((rel) => !taken.has(rel)));
  excluded.forEach((rel) => taken.add(rel));
  const needsDecision = sorted([...built.needsDecision, ...built.resolved, ...lines.map((l) => l.rel)].filter((rel) => !taken.has(rel)));

  // A path's reason: from a line in the section of the list it ends up in, else from any line naming it.
  const listOf = new Map([...publishing.map((r) => [r, 'publishing']), ...excluded.map((r) => [r, 'excluded']), ...needsDecision.map((r) => [r, 'needsDecision'])]);
  const reasons = new Map();
  for (const own of [true, false]) {
    for (const l of lines) {
      if (!l.reason || reasons.has(l.rel) || (l.section === listOf.get(l.rel)) !== own) continue;
      reasons.set(l.rel, l.reason);
    }
  }

  const stays = new Set(needsDecision);
  const builtExcluded = new Set(built.excluded);
  const publishes = new Set(built.publishing);
  const once = (list) => [...new Set(list)];
  return {
    publishing,
    excluded,
    needsDecision,
    reasons,
    folded: {
      ticked: once(built.resolved).filter((rel) => stays.has(rel) && !built.needsDecision.includes(rel)).length,
      unticked: once(lines.filter((l) => l.section === 'publishing' && !publishes.has(l.rel)).map((l) => l.rel)).filter((rel) => stays.has(rel)).length,
      excludedKept: once(underExcluded).filter((rel) => !builtExcluded.has(rel) && excluded.includes(rel)).length,
      commented: once(entryLines(oldText, { commented: true }).map((l) => l.rel)).filter((rel) => !listOf.has(rel)).length,
    },
  };
}

// Each entry line of the old file whose path is in none of the new file's lists. Built from the lines themselves,
// so a reader that misses a shape cannot hide the loss.
function lostFromOld(oldText, got) {
  const have = new Set([...(got.publishing || []), ...(got.excluded || []), ...(got.needsDecision || [])]);
  return sorted(entryLines(oldText).map((l) => l.rel).filter((rel) => !have.has(rel)));
}

// The differences, as lines for the GM: each path in one list and not the other, each reason that did not come
// through, and each entry line of the old file the new one does not have.
function differences(oldText, expected, got) {
  const blockers = [];
  const lists = [['publishing', 'publishing'], ['excluded', 'excluded'], ['needsDecision', 'needs_decision']];
  for (const [key, label] of lists) {
    const want = new Set(expected[key]);
    const have = new Set(got[key] || []);
    for (const rel of want) if (!have.has(rel)) blockers.push(`${rel}: expected under ${label}, not there`);
    for (const rel of have) if (!want.has(rel)) blockers.push(`${rel}: found under ${label}, not expected`);
  }
  for (const [rel, reason] of expected.reasons) {
    if ((got.reasons || new Map()).get(rel) !== reason) blockers.push(`${rel}: the reason "${reason}" did not come through`);
  }
  for (const rel of lostFromOld(oldText, got)) {
    const line = `${rel}: in ${OLD_LIST_FILE}, in no list of ${PUBLISH_LIST_FILE}`;
    if (!blockers.some((b) => b.startsWith(`${rel}: expected`))) blockers.push(line);
  }
  return blockers;
}

const entries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

function foldLines(folded) {
  const out = [];
  const parts = [];
  if (folded.ticked > 0) parts.push(`${entries(folded.ticked)} ticked under Needs Decision`);
  if (folded.unticked > 0) parts.push(`${folded.unticked} unticked under Publishing`);
  if (parts.length > 0) {
    out.push(`${parts.join(', and ')}, ${parts.length === 1 && folded.ticked + folded.unticked === 1 ? 'is' : 'are'} now under needs_decision: they were not published before and still are not.`);
  }
  if (folded.excludedKept > 0) {
    out.push(`${entries(folded.excludedKept)} unticked under Excluded ${folded.excludedKept === 1 ? 'is' : 'are'} now under excluded: ${folded.excludedKept === 1 ? 'it was' : 'they were'} not published before and still ${folded.excludedKept === 1 ? 'is' : 'are'} not.`);
  }
  if (folded.commented > 0) {
    out.push(`${entries(folded.commented)} commented out with %% or <!-- --> ${folded.commented === 1 ? 'is' : 'are'} left out: ${folded.commented === 1 ? 'it was' : 'they were'} hidden in Obsidian and ${folded.commented === 1 ? 'is' : 'are'} not published.`);
  }
  return out;
}

const reasonsFor = (list, rels) => Object.fromEntries(rels.filter((rel) => list.reasons.get(rel)).map((rel) => [rel, list.reasons.get(rel)]));

function setsOf(list) {
  return {
    publishing: list.publishing,
    publishing_reasons: reasonsFor(list, list.publishing),
    excluded: list.excluded.map((rel) => (list.reasons.get(rel) ? { path: rel, reason: list.reasons.get(rel) } : { path: rel })),
    needs_decision: list.needsDecision,
    needs_decision_reasons: reasonsFor(list, list.needsDecision),
  };
}

// Sets the old file aside under a name nothing reads, never over an earlier kept copy. Returns the name used.
function setAside(oldFile) {
  let kept = `${oldFile}${KEPT_SUFFIX}`;
  for (let n = 2; fs.existsSync(kept); n++) kept = `${oldFile}${KEPT_SUFFIX}.${n}`;
  fs.renameSync(oldFile, kept);
  return kept;
}

const keptLine = (vaultPath, kept) => `The old file is kept as ${path.relative(vaultPath, kept).split(path.sep).join('/')}.`;

/**
 * @param {string} vaultPath
 * @param {{ check?: boolean, siteConfigPath?: string|null, siteToolUpdated?: boolean, deps?: { writeTemp?: Function, readBack?: Function, moveOld?: Function, pinCheck?: Function } }} [options]
 * @returns {{ ok: boolean, converted: boolean, held: false|string, lines: string[], sets: object|null, blockers: string[] }}
 */
function convertPublishList(vaultPath, { check = false, siteConfigPath = null, siteToolUpdated = false, deps = {} } = {}) {
  const oldFile = at(vaultPath, OLD_LIST_FILE);
  const newFile = at(vaultPath, PUBLISH_LIST_FILE);
  const tempFile = `${newFile}${TEMP_SUFFIX}`;
  const writeTemp = deps.writeTemp || ((f, text) => writeAtomic(f, text));
  const moveOld = deps.moveOld || setAside;
  const none = { ok: true, converted: false, held: false, lines: [], sets: null, blockers: [] };

  if (!fs.existsSync(oldFile)) return none;
  const hold = holdFor(vaultPath, siteConfigPath, { siteToolUpdated, pinCheck: deps.pinCheck });
  if (hold) return { ...none, held: hold.held, lines: [hold.line] };
  const oldText = fs.readFileSync(oldFile, 'utf-8');
  const expected = expectedFrom(oldText);
  const quiet = { warn: () => {} };

  // Both files: the new one stands only when it says what the old one says.
  if (fs.existsSync(newFile)) {
    const have = readPublishListFile(newFile, quiet);
    const blockers = differences(oldText, expected, have);
    if (blockers.length > 0) return { ...none, ok: false, blockers, sets: setsOf(have) };
    const lines = ['the publish list was already moved; the old file is set aside'];
    if (!check) lines.push(keptLine(vaultPath, moveOld(oldFile)));
    return { ...none, lines, sets: setsOf(have) };
  }

  const text = listText(expected);
  const finish = (back) => {
    const got = deps.readBack ? deps.readBack(back) : back;
    return differences(oldText, expected, got);
  };

  if (check) {
    const blockers = finish(parseListText(text, quiet));
    return { ...none, ok: blockers.length === 0, blockers, lines: blockers.length ? [] : [summary(expected, true)], sets: setsOf(expected) };
  }

  let placed = false;
  try {
    writeTemp(tempFile, text);
    const blockers = finish(readPublishListFile(tempFile, quiet));
    if (blockers.length > 0) return { ...none, ok: false, blockers };
    fs.renameSync(tempFile, newFile);
    placed = true;
  } finally {
    if (!placed) fs.rmSync(tempFile, { force: true });
  }
  const kept = moveOld(oldFile);
  const lines = [summary(expected, false), ...foldLines(expected.folded), keptLine(vaultPath, kept)];
  return { ok: true, converted: true, held: false, lines, sets: setsOf(expected), blockers: [] };
}

function summary(list, wouldDo) {
  const c = counts(list);
  const tail = `${PUBLISH_LIST_FILE}: ${c.publishing} publishing, ${c.excluded} excluded, ${c.needsDecision} needing a decision.`;
  return wouldDo ? `Would move the publish list to ${tail}` : `Moved the publish list to ${tail}`;
}

module.exports = { convertPublishList, setsOf, lostFromOld, holdFor };
