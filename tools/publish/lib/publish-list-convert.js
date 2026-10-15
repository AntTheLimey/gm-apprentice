'use strict';
// Moves the publish list from _meta/publish-manifest.md to _meta/publish-list.yaml, all or nothing:
// the new text is written to a temporary file, read back with the real reader, and compared with what
// the old file means; only when the three lists match is it put in place and the old file removed.
// A stop between those two steps leaves both files, which the next run finishes.
const fs = require('fs');
const { listText, readPublishListFile, parseListText, counts } = require('./manifest');
const { parseManifest, parseAnnotatedManifest } = require('./manifest-legacy');
const { writeAtomic } = require('./settings/write');
const path = require('path');
const { PUBLISH_LIST_FILE, OLD_LIST_FILE, PUBLISH_LIST_FROM, at } = require('./settings/layout');
const { siteToolOlderThan } = require('./settings/move');
const { readSettings } = require('./settings/read');
const { packageScripts } = require('./settings/steps');

const TEMP_SUFFIX = '.convert';
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
function holdFor(vault, siteConfigPath, { siteToolUpdated = false, pinCheck } = {}) {
  if (!siteConfigPath) return null;
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

// What the old file means, in the new file's three lists. The build's own reading decides what publishes
// and what is held back. Two shapes the build never published fold into needs_decision, so they stay
// unpublished: a ticked entry under Needs Decision, and an unticked entry under Publishing.
function expectedFrom(oldText) {
  const built = parseManifest(oldText);
  const annotated = parseAnnotatedManifest(oldText);
  const publishing = sorted(built.publishing);
  const taken = new Set(publishing);

  const excluded = sorted(built.excluded.filter((rel) => !taken.has(rel)));
  excluded.forEach((rel) => taken.add(rel));
  const reasons = new Map();
  for (const [list, section] of [[excluded, 'excluded'], [publishing, 'publishing']]) {
    for (const rel of list) {
      const entry = annotated.get(rel);
      if (entry && entry.section === section && entry.annotation) reasons.set(rel, entry.annotation);
    }
  }

  const buildPublishes = new Set(built.publishing);
  const tickedResolved = [];
  const untickedPublishing = [];
  const needs = new Set(built.needsDecision);
  for (const rel of built.resolved) { needs.add(rel); tickedResolved.push(rel); }
  for (const [rel, entry] of annotated) {
    if (entry.section === 'publishing' && !buildPublishes.has(rel)) { needs.add(rel); untickedPublishing.push(rel); }
  }
  const needsDecision = sorted([...needs].filter((rel) => !taken.has(rel)));
  const stays = new Set(needsDecision);
  return {
    publishing,
    excluded,
    needsDecision,
    reasons,
    folded: {
      ticked: sorted(tickedResolved).filter((rel) => stays.has(rel) && !built.needsDecision.includes(rel)).length,
      unticked: sorted(untickedPublishing).filter((rel) => stays.has(rel)).length,
    },
  };
}

// The differences between two lists, as lines for the GM: each path that is in one and not the other.
function differences(expected, got) {
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
  return blockers;
}

const entries = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

function foldLine(folded) {
  const parts = [];
  if (folded.ticked > 0) parts.push(`${entries(folded.ticked)} ticked under Needs Decision`);
  if (folded.unticked > 0) parts.push(`${folded.unticked} unticked under Publishing`);
  if (parts.length === 0) return null;
  return `${parts.join(', and ')}, ${parts.length === 1 && folded.ticked + folded.unticked === 1 ? 'is' : 'are'} now under needs_decision: they were not published before and still are not.`;
}

function setsOf(list) {
  return {
    publishing: list.publishing,
    publishing_reasons: Object.fromEntries(list.publishing.filter((rel) => list.reasons.get(rel)).map((rel) => [rel, list.reasons.get(rel)])),
    excluded: list.excluded.map((rel) => (list.reasons.get(rel) ? { path: rel, reason: list.reasons.get(rel) } : { path: rel })),
    needs_decision: list.needsDecision,
  };
}

/**
 * @param {string} vaultPath
 * @param {{ check?: boolean, siteConfigPath?: string|null, siteToolUpdated?: boolean, deps?: { writeTemp?: Function, readBack?: Function, removeOld?: Function, pinCheck?: Function } }} [options]
 * @returns {{ ok: boolean, converted: boolean, held: false|string, lines: string[], sets: object|null, blockers: string[] }}
 */
function convertPublishList(vaultPath, { check = false, siteConfigPath = null, siteToolUpdated = false, deps = {} } = {}) {
  const oldFile = at(vaultPath, OLD_LIST_FILE);
  const newFile = at(vaultPath, PUBLISH_LIST_FILE);
  const tempFile = `${newFile}${TEMP_SUFFIX}`;
  const writeTemp = deps.writeTemp || ((f, text) => writeAtomic(f, text));
  const removeOld = deps.removeOld || ((f) => fs.rmSync(f));
  const none = { ok: true, converted: false, held: false, lines: [], sets: null, blockers: [] };

  if (!fs.existsSync(oldFile)) return none;
  const hold = holdFor(vaultPath, siteConfigPath, { siteToolUpdated, pinCheck: deps.pinCheck });
  if (hold) return { ...none, held: hold.held, lines: [hold.line] };
  const expected = expectedFrom(fs.readFileSync(oldFile, 'utf-8'));
  const quiet = { warn: () => {} };

  // Both files: the new one stands only when it says what the old one says.
  if (fs.existsSync(newFile)) {
    const have = readPublishListFile(newFile, quiet);
    const blockers = differences(expected, have);
    if (blockers.length > 0) return { ...none, ok: false, blockers, sets: setsOf(have) };
    const lines = ['removed the old publish list, already moved'];
    if (!check) removeOld(oldFile);
    return { ...none, lines, sets: setsOf(have) };
  }

  const text = listText(expected);
  const finish = (back) => {
    const got = deps.readBack ? deps.readBack(back) : back;
    return differences(expected, got);
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
  removeOld(oldFile);
  const lines = [summary(expected, false)];
  const fold = foldLine(expected.folded);
  if (fold) lines.push(fold);
  return { ok: true, converted: true, held: false, lines, sets: setsOf(expected), blockers: [] };
}

function summary(list, wouldDo) {
  const c = counts(list);
  const tail = `${PUBLISH_LIST_FILE}: ${c.publishing} publishing, ${c.excluded} excluded, ${c.needsDecision} needing a decision.`;
  return wouldDo ? `Would move the publish list to ${tail}` : `Moved the publish list to ${tail}`;
}

module.exports = { convertPublishList, setsOf };
