'use strict';
// The move: a vault from the old layout (settings in the frontmatter of _meta/vault-config.md,
// some of them in the site folder's vault.config.json) to the new one (_meta/vault-config.yaml,
// _meta/vault-state.json, and _meta/vault-notes.md for the GM's own prose). All or nothing, and
// exact: the new files are written to a scratch copy of the vault's _meta folder and read back
// through the real reader, and everything the old files resolved to must come back the same
// before a single file of the vault is touched. The vault is then changed by renames, the old
// files kept aside until the last one succeeds, and put back if any step fails.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const YAML = require('yaml');
const { REGISTRY, legacyNameOf } = require('./registry');
const { TYPES, isMap, getPath, firstLine } = require('./types');
const { isLeaf } = require('./describe');
const { formatFault } = require('./faults');
const { OLD_FILE, NEW_FILE, STATE_FILE, NOTES_FILE, SETTING_GROUPS, FIRST_TOOL_READING_NEW_FILE, layoutOf, at } = require('./layout');
const read = require('./read');
const { OLD_BLOCK, VERSION_KEY, FILE_KEYS, SETUP_NOTE, hasLegacy } = require('./legacy');
const { readState, stateText } = require('./state');
const { splitFront, writeAtomic } = require('./write');
const { parseNote } = require('../frontmatter');

const { Scalar, Pair, YAMLMap, isScalar, isMap: isYMap, isNode } = YAML;
const LEAVES = REGISTRY.filter((e) => isLeaf(e, REGISTRY));
const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));
const FILLABLE = ['vault.campaign', 'vault.system'];
const COMMENTS_HEADING = 'Comments from the old settings file';
const PLAIN = { lineWidth: 0, flowCollectionPadding: false };

const showValue = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const keyText = (pair) => String(isScalar(pair.key) ? pair.key.value : pair.key);
const normalise = (text) => String(text).replace(/\r\n/g, '\n');

// The scaffold's own body: the heading, the Campaign line, and the Vault Structure section holding
// one sentence and one fenced block. The block's content varies, so only its shape is matched.
const BOILERPLATE = /^# Vault Configuration\n\nCampaign: [^\n]*\n\n## Vault Structure\n\n[^\n]+\n\n```text\n(?:(?!```)[\s\S])*\n```$/;
const isBoilerplate = (body) => {
  const text = normalise(body).trim();
  return text === '' || BOILERPLATE.test(text);
};

// A node's value as the plain data it reads as.
const plainOf = (node, doc) => (isNode(node) ? node.toJS(doc) : node);

// The pair at `segs` in a parsed old document: { pair, parent } or null.
function pairAt(doc, segs) {
  let map = doc && doc.contents;
  let found = null;
  for (let i = 0; i < segs.length; i++) {
    if (!isYMap(map)) return null;
    const pair = map.items.find((p) => keyText(p) === segs[i]);
    if (!pair) return null;
    found = { pair, parent: map };
    map = pair.value;
  }
  return found;
}

// The comment above a key: on the key itself, or, for the first key of a map, on the map.
function commentAbove({ pair, parent }) {
  if (pair.key && pair.key.commentBefore) return pair.key.commentBefore;
  if (parent.items[0] === pair && parent.commentBefore) return parent.commentBefore;
  return undefined;
}

// Every comment line a document holds, trimmed, for counting what is carried.
function commentLines(doc) {
  const out = [];
  const add = (text) => { if (text) for (const l of String(text).split('\n')) if (l.trim()) out.push(l.trim()); };
  add(doc.commentBefore);
  add(doc.comment);
  YAML.visit(doc, { Node(_, node) { add(node.commentBefore); add(node.comment); } });
  return out;
}

// Every comment line a document holds, with the key it sat on (dotted, as the old file wrote it).
function commentOwners(doc) {
  const out = [];
  const add = (text, key) => { if (text) for (const l of String(text).split('\n')) if (l.trim()) out.push({ text: l.trim(), key }); };
  add(doc.commentBefore, null);
  add(doc.comment, null);
  YAML.visit(doc, {
    Node(_, node, path) {
      const names = path.filter((x) => YAML.isPair(x)).map(keyText);
      const key = names.join('.') || null;
      // A comment above the first key of a map is held by the map; it sat on that first key.
      const first = isYMap(node) && node.items.length ? [...names, keyText(node.items[0])].join('.') : key;
      add(node.commentBefore, first);
      add(node.comment, key);
    },
  });
  return out;
}

// Splits the old file into its frontmatter text and body, through the same library the writer uses.
function split(whole) {
  const m = splitFront(whole);
  // The frontmatter is parsed with plain line ends (a CRLF file leaves a lone \r on its last line); the body stays as it is.
  return m.content === whole ? { front: null, body: whole } : { front: m.matter.replace(/\r\n?/g, '\n'), body: m.content };
}

// The site file's JSON written back in the style it had: its indent, its line ends, and whether it ended in a line end.
function jsonLike(value, text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.trimEnd().split(/\r?\n/);
  let indent = 2;
  if (lines.length < 2) indent = undefined;
  else {
    const second = lines[1];
    const lead = second.slice(0, second.length - second.trimStart().length);
    indent = lead.startsWith('\t') ? '\t' : (lead.length || 2);
  }
  const out = JSON.stringify(value, null, indent);
  return (eol === '\n' ? out : out.replace(/\n/g, eol)) + (/\n$/.test(text) ? eol : '');
}


// The site folder's file with every key that is a setting now taken out (the rest is not ours):
// { siteAfter, siteOut (the new text, or null when no key was there), removedKeys }.
function stripSiteKeys(siteText) {
  const siteAfter = JSON.parse(siteText);
  const removedKeys = [];
  for (const e of REGISTRY) {
    for (const w of (e.was || []).filter((x) => x.in === 'site' && x.read !== false)) {
      const segs = w.name.split('.');
      const parent = getPath(siteAfter, segs.slice(0, -1));
      if (segs.length === 1 ? Object.prototype.hasOwnProperty.call(siteAfter, segs[0]) : (isMap(parent) && Object.prototype.hasOwnProperty.call(parent, segs[segs.length - 1]))) {
        delete (segs.length === 1 ? siteAfter : parent)[segs[segs.length - 1]];
        if (segs.length > 1 && Object.keys(parent).length === 0) delete siteAfter[segs[0]];
        removedKeys.push(w.name);
      }
    }
  }
  return { siteAfter, siteOut: removedKeys.length ? jsonLike(siteAfter, siteText) : null, removedKeys };
}

// ---- The site's tool ------------------------------------------------------------------------

// What `update-pin --check --json` says of the site folder: { ok, ours, spec, installedBefore }, or null when it says
// nothing usable. The same code the update uses; asked by running the command, so there is one rule.
function pinCheck(siteDir) {
  const bin = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
  const run = spawnSync(process.execPath, [bin, 'update-pin', '--check', '--json', '--site', siteDir], { encoding: 'utf8' });
  try {
    const said = JSON.parse(run.stdout);
    return said && typeof said === 'object' ? said : null;
  } catch {
    return null;
  }
}

// The numbers of a version in a text ("1.22.0", "^1.20.0", ">=1.4.2 <2"), or null.
const versionIn = (text) => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const atLeast = (have, want) => {
  for (let i = 0; i < 3; i++) if (have[i] !== want[i]) return have[i] > want[i];
  return true;
};

// null when the vault may move, else { held, spec, line }. Whether the site's tool can READ the new file decides: the
// tool installed in the site folder, or, if none is installed, the version its package.json asks for; a tool that
// cannot be told cannot read. Who owns the pin only decides whether the update can repin it first (`updated`).
//   held: 'site-tool'      a tool the plugin does not manage, older than FIRST_TOOL_READING_NEW_FILE (or unknown)
//   held: 'site-tool-old'  the plugin's own tool, old, and the caller is not bringing it up to date
// A held vault is not wrong: it stays on the old file until its site's tool is new enough. A site with no tool
// pinned or installed is built by the plugin's own, so it moves. `pin` is the update-pin answer.
function holdFrom(pin, { updated = false, siteDir = '' } = {}) {
  if (!pin || (!pin.spec && !pin.installedBefore)) return null;
  // (A plugin path's number is the plugin's, not the tool's, so only a pin that is not ours is read for one.)
  const installed = versionIn(pin.installedBefore) || (pin.ours ? null : versionIn(pin.spec));
  if (installed && atLeast(installed, versionIn(FIRST_TOOL_READING_NEW_FILE))) return null;
  if (pin.ours && updated) return null;
  const shown = pin.installedBefore || pin.spec;
  if (!pin.ours) {
    return { held: 'site-tool', spec: shown, line: `This vault stays on the old settings file because its site's tool (${shown}) cannot read the new one. When that tool is ${FIRST_TOOL_READING_NEW_FILE} or later, run the update again.` };
  }
  return { held: 'site-tool-old', spec: shown, line: `This vault stays on the old settings file for now: its site's publish tool (${shown}) is older than the plugin's and cannot read the new file. Update it first (gm-apprentice-publish update-pin --site "${siteDir}"), then move the vault.` };
}

// The version the tool INSTALLED in a site folder says it is, whatever the folder's package.json says; null if none.
function installedIn(siteDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(siteDir, 'node_modules', 'gm-apprentice-publish', 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

// One site folder: the pin's answer, with the installed tool's own version read directly (an old tool installed in a
// folder whose package.json does not name it still builds that site). A folder with no tool installed and no pin at
// all has nothing that could build it, so it holds nothing.
function siteToolHold(siteDir, { updated = false, pinCheck: ask = pinCheck } = {}) {
  const pin = { ...(ask(siteDir) || {}) };
  const installed = installedIn(siteDir);
  if (installed) {
    pin.installedBefore = installed;
    if (!pin.spec) pin.ours = false;
  }
  return holdFrom(pin, { updated, siteDir });
}

// Every site folder involved: the one the vault's settings name (when it holds a vault.config.json) and the one the
// caller gave. Held if any cannot read the new file; the first that cannot is the one said.
function siteToolHoldAll(vault, siteDirs, options) {
  const seen = new Set();
  const dirs = [];
  for (const d of siteDirs.filter(Boolean)) {
    let key = path.resolve(d);
    try { key = fs.realpathSync.native(key); } catch { /* as given */ }
    if (!seen.has(key)) { seen.add(key); dirs.push(path.resolve(d)); }
  }
  for (const d of dirs) {
    const held = siteToolHold(d, options);
    if (held) return held;
  }
  return null;
}

// The site folder the vault's own settings name, when it holds a vault.config.json; null otherwise.
function namedSiteDir(vault) {
  let raw;
  try {
    raw = getPath(read.readSettings({ vaultPath: vault, siteConfig: {} }).values, ['player_site', 'folder']);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const dir = require('../lines-cli').siteDirPath(vault, raw);
  return fs.existsSync(path.join(dir, 'vault.config.json')) ? dir : null;
}

// ---- Planning -----------------------------------------------------------------------------

const INTERNAL = Symbol('move');

// A library error about the old file's YAML (an alias used before its anchor, say) is the ordinary blocker.
function planMove(options, deps = {}) {
  try {
    return planMoveNow(options, deps);
  } catch (e) {
    if (/alias/i.test(String(e.message)) || String(e.name).startsWith('YAML')) {
      return { ok: false, lines: [], blockers: [`${OLD_FILE} frontmatter is not valid YAML: ${firstLine(e.message)}`], files: { write: [], remove: [] } };
    }
    throw e;
  }
}

function planMoveNow({ vaultPath, siteConfigPath = null, fill = {}, discardOld = false, siteToolUpdated = false }, deps = {}) {
  const vault = path.resolve(vaultPath);
  let isDir = false;
  try { isDir = fs.statSync(vault).isDirectory(); } catch { /* said below */ }
  if (!isDir) throw new Error(`${vault} is not a folder.`);
  const plan = (extra) => ({ ok: true, lines: [], blockers: [], files: { write: [], remove: [] }, ...extra });
  const layout = layoutOf(vault);
  if (layout === 'new') return mendNew(vault, siteConfigPath, plan, { discardOld });
  // No settings file at all: there is still something to move when the site folder's file holds settings
  // (an old layout with an empty old file). Otherwise there is nothing.
  let noOld = false;
  if (layout === 'none') {
    let siteNow = null;
    try { siteNow = siteConfigPath ? JSON.parse(fs.readFileSync(path.resolve(siteConfigPath), 'utf8')) : null; } catch { /* said by the plan below */ }
    if (!hasLegacy(siteNow)) return plan({ lines: ['This vault has no settings file; nothing to move.'] });
    noOld = true;
  }

  const blockers = [];
  const blocked = () => ({ ok: false, lines: [], blockers: [...new Set(blockers)], files: { write: [], remove: [] } });

  for (const name of Object.keys(fill)) {
    if (!FILLABLE.includes(name)) blockers.push(`--fill takes only ${FILLABLE.join(' and ')}; ${name} is not one of them.`);
  }
  for (const name of FILLABLE) {
    if (Object.prototype.hasOwnProperty.call(fill, name) && String(fill[name]).trim() === '') blockers.push(`--fill ${name} needs a value, as --fill ${name}=<value>.`);
  }
  let state;
  try { state = readState(vault); } catch (e) { blockers.push(firstLine(e.message)); state = {}; }

  // The site folder's file, when there is one. It must belong to this vault.
  let site = {};
  let siteText = null;
  let siteFile = null;
  if (siteConfigPath) {
    const wanted = path.resolve(siteConfigPath);
    if (!fs.existsSync(wanted)) {
      blockers.push(`${wanted} does not exist.`);
    } else {
      siteFile = wanted;
      siteText = fs.readFileSync(siteFile, 'utf8');
      try {
        site = JSON.parse(siteText);
        if (!isMap(site)) throw new Error('it must hold an object');
      } catch (e) {
        blockers.push(`${siteFile} could not be read as JSON: ${firstLine(e.message)}`);
        site = {};
      }
      if (isMap(site)) {
        if (typeof site.vaultPath !== 'string' || site.vaultPath.trim() === '') {
          blockers.push(`${siteFile} has no "vaultPath", so it cannot be told which vault it belongs to.`);
        } else {
          const theirs = path.resolve(path.dirname(siteFile), site.vaultPath);
          // Real paths, in the file system's own spelling, so a difference of case on macOS or Windows is the same vault.
          const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
          if (real(theirs) !== real(vault)) blockers.push(`that site folder belongs to another vault: ${theirs}`);
        }
      }
    }
  }

  // The site is built with its own copy of the publish tool, and an older copy reads a moved vault as having no
  // settings at all. So the vault moves only when that tool is the plugin's own and reads the new file.
  if (siteFile && !blockers.length) {
    const held = siteToolHoldAll(vault, [path.dirname(siteFile), namedSiteDir(vault)], { updated: siteToolUpdated, pinCheck: deps.pinCheck });
    if (held) return { ok: false, lines: [], blockers: [], ...held, files: { write: [], remove: [] } };
  }

  // The old layout, read the way the build reads it.
  const { loadPublishConfig } = require('../config');
  let old;
  let oldPc;
  try {
    old = read.readSettings({ vaultPath: vault, siteConfig: site });
    oldPc = loadPublishConfig(vault, site, () => {});
  } catch (e) {
    blockers.push(firstLine(e.message));
    return blocked();
  }
  for (const f of oldPc.faults) {
    if (f.kind === 'unknown-name' && f.name.startsWith(`${OLD_BLOCK}.`)) blockers.push(`${f.name} is not a setting; run the Settings check before moving.`);
    else if (f.level === 'stop' || f.kind === 'not-allowed') blockers.push(firstLine(f.message || formatFault(f)));
  }

  const oldText = noOld ? '' : fs.readFileSync(at(vault, OLD_FILE), 'utf8');
  const { front, body } = split(oldText);
  let doc = null;
  if (front !== null) {
    doc = YAML.parseDocument(front);
    if (doc.errors.length) blockers.push(`${OLD_FILE} frontmatter is not valid YAML: ${firstLine(doc.errors[0].message).replace(/:$/, '')}`);
    else if (doc.contents !== null && !isYMap(doc.contents)) blockers.push(`${OLD_FILE} frontmatter must hold settings written as name: value`);
  }
  const data = (parseNoteSafe(oldText) || {});

  // What is planned beyond the resolved values: the two top-level carries and the fill.
  const planned = {};
  const lines = [];
  const claimed = new Set([...FILE_KEYS, OLD_BLOCK]);
  for (const e of REGISTRY) if (!e.legacyOnly && legacyNameOf(e) && !legacyNameOf(e).includes('.')) claimed.add(legacyNameOf(e));
  const fillOf = (name) => (Object.prototype.hasOwnProperty.call(fill, name) ? String(fill[name]) : undefined);

  const campaign = BY_NAME.get('vault.campaign');
  if (typeof data.campaign === 'string' && data.campaign.trim() !== '' && !data.campaign.trim().startsWith('[[')) {
    planned['vault.campaign'] = data.campaign;
    claimed.add('campaign');
  } else if (fillOf('vault.campaign') !== undefined) {
    const r = TYPES[campaign.type].read(fillOf('vault.campaign'), campaign);
    if (r.ok) planned['vault.campaign'] = r.value;
    else blockers.push(`--fill vault.campaign=${fillOf('vault.campaign')} is not usable; it takes ${TYPES[campaign.type].takes(campaign)}.`);
  }
  const system = BY_NAME.get('vault.system');
  if (old.origins['vault.system'] === 'default') {
    const fromGame = TYPES[system.type].read(data.game_system, system);
    if (typeof data.game_system === 'string' && fromGame.ok && fromGame.value !== null) {
      planned['vault.system'] = fromGame.value;
      claimed.add('game_system');
    } else if (fillOf('vault.system') !== undefined) {
      const r = TYPES[system.type].read(fillOf('vault.system'), system);
      if (r.ok && r.value !== null) planned['vault.system'] = r.value;
      else blockers.push(`--fill vault.system=${fillOf('vault.system')} is not usable; it takes ${TYPES[system.type].takes(system)}.`);
    }
  } else if (fillOf('vault.system') !== undefined) {
    lines.push('vault.system is already set, so --fill vault.system was not used.');
  }
  if (fillOf('vault.campaign') !== undefined && planned['vault.campaign'] !== undefined && claimed.has('campaign')) {
    lines.push(`${OLD_FILE} already names the campaign, so --fill vault.campaign was not used.`);
  }

  if (blockers.length) return blocked();
  if (planned['vault.campaign'] === undefined) {
    lines.push(`The campaign is named after the vault folder ("${path.basename(vault)}"). To change it: settings set vault.campaign="..."`);
  }

  // The values to write: every setting not left at its default, in the list's order.
  const toWrite = [];
  for (const e of LEAVES) {
    if (Object.prototype.hasOwnProperty.call(planned, e.name)) { toWrite.push({ e, value: planned[e.name], planned: true }); continue; }
    if (old.origins[e.name] === 'default') continue;
    toWrite.push({ e, value: getPath(old.values, e.name.split('.')) });
  }

  // The new file.
  const newDoc = new YAML.Document();
  newDoc.contents = new YAMLMap();
  const versionKey = new Scalar('version');
  newDoc.contents.items.push(new Pair(versionKey, new Scalar(1)));
  const mapFor = (segs) => {
    let map = newDoc.contents;
    segs.forEach((seg, i) => {
      let pair = map.items.find((p) => keyText(p) === seg);
      if (!pair) {
        const key = new Scalar(seg);
        pair = new Pair(key, new YAMLMap());
        map.items.push(pair);
      }
      map = pair.value;
    });
    return map;
  };
  for (const { e, value, planned: isPlanned } of toWrite) {
    const segs = e.name.split('.');
    const last = segs[segs.length - 1];
    const key = new Scalar(last);
    let valueNode = null;
    const where = !isPlanned && old.origins[e.name] === 'file' && legacyNameOf(e) ? pairAt(doc, legacyNameOf(e).split('.')) : null;
    if (where && where.pair.value && isNode(where.pair.value) && isDeepStrictEqual(plainOf(where.pair.value, doc), value)) {
      valueNode = where.pair.value.clone();
      const above = commentAbove(where);
      if (above) key.commentBefore = above;
    }
    if (!valueNode) valueNode = newDoc.createNode(JSON.parse(JSON.stringify(value)));
    mapFor(segs.slice(0, -1)).items.push(new Pair(key, valueNode));
  }
  // The groups in the list's order (the vault's, then the site's), each set off by a blank line.
  const rank = (p) => (keyText(p) === 'version' ? -1 : SETTING_GROUPS.indexOf(keyText(p)));
  newDoc.contents.items.sort((a, b) => rank(a) - rank(b));
  for (const p of newDoc.contents.items) if (keyText(p) !== 'version') p.key.spaceBefore = true;
  const configText = newDoc.toString(PLAIN);

  // The notes: the top-level keys that are neither settings nor state, and the body unless it is the scaffold's own.
  const extra = doc && doc.contents ? doc.contents.items.filter((p) => !claimed.has(keyText(p))) : [];
  const keepBody = !isBoilerplate(body);
  const notesDoc = new YAML.Document();
  notesDoc.contents = new YAMLMap();
  const typeKey = new Scalar('type');
  const oldType = doc && doc.contents && doc.contents.items.find((p) => keyText(p) === 'type');
  if (oldType && oldType.key.commentBefore) typeKey.commentBefore = oldType.key.commentBefore;
  notesDoc.contents.items.push(new Pair(typeKey, new Scalar('meta')));
  for (const p of extra) notesDoc.contents.items.push(new Pair(p.key.clone(), isNode(p.value) ? p.value.clone() : p.value));

  // Comments: counted off, so one that could not be placed is said, and kept in the notes, never dropped quietly.
  const owners = doc ? commentOwners(doc) : [];
  const unplaced = (withNotes) => {
    const rest = [...owners];
    for (const kept of [...commentLines(newDoc), ...(withNotes ? commentLines(notesDoc) : [])]) {
      const at2 = rest.findIndex((o) => o.text === kept);
      if (at2 >= 0) rest.splice(at2, 1);
    }
    return rest;
  };
  const notesAnyway = extra.length > 0 || keepBody;
  let left = unplaced(notesAnyway);
  const writeNotes = notesAnyway || left.length > 0;
  if (!notesAnyway && writeNotes) left = unplaced(true);
  for (const c of left) lines.push(`a comment could not be carried into the new file${c.key ? ` (it sat on ${c.key})` : ''}, so it is kept in ${NOTES_FILE}: ${c.text}`);

  // The notes file's frontmatter ends its lines the way the old file did (the body keeps its own).
  const eol = oldText.includes('\r\n') ? '\r\n' : '\n';
  let notesBody = keepBody ? body : '';
  if (left.length) {
    const section = [`## ${COMMENTS_HEADING}`, '', ...left.map((c) => `- ${c.key ? `\`${c.key}\`` : 'at the top of the file'}: ${c.text}`), ''].join(eol);
    notesBody = keepBody ? `${body}${/\n$/.test(body) ? '' : eol}${eol}${section}` : section;
  }
  const notesText = writeNotes ? `---${eol}${notesDoc.toString(PLAIN).replace(/\n/g, eol)}---${eol}${notesBody}` : null;

  // A notes file that is already there is the one a stopped move wrote, when it is exactly what this move would write.
  const notesFile = at(vault, NOTES_FILE);
  const notesPresent = fs.existsSync(notesFile);
  if (notesPresent && fs.readFileSync(notesFile, 'utf8') !== notesText) {
    blockers.push(`${NOTES_FILE} already exists; the notes from ${OLD_FILE} would have nowhere to go. Move it aside first.`);
  }

  // State.
  const patch = {};
  if (data[VERSION_KEY] != null && state[VERSION_KEY] === undefined) patch[VERSION_KEY] = data[VERSION_KEY];
  const note = getPath(data, SETUP_NOTE.split('.'));
  if (isMap(note) && state.setup === undefined) patch.setup = note;
  else if (note != null && !isMap(note)) lines.push(`${SETUP_NOTE} is not a note the set-up guide wrote, so it was not carried over.`);
  if (data[VERSION_KEY] != null && state[VERSION_KEY] !== undefined && !isDeepStrictEqual(state[VERSION_KEY], data[VERSION_KEY])) {
    lines.push(`${STATE_FILE} already says ${VERSION_KEY} ${JSON.stringify(state[VERSION_KEY])}, which was kept; the old file's ${JSON.stringify(data[VERSION_KEY])} was dropped.`);
  }
  if (isMap(note) && state.setup !== undefined && !isDeepStrictEqual(state.setup, note)) {
    lines.push(`${STATE_FILE} already holds a set-up note, which was kept; the old file's ${SETUP_NOTE} was dropped.`);
  }
  const stateAfter = { ...state, ...patch };
  const stateOut = Object.keys(patch).length ? stateText(stateAfter) : null;

  // What the old file said about names: carried, dropped, empty.
  for (const f of oldPc.faults) {
    const e = f.setting ? BY_NAME.get(f.setting) : null;
    if (f.kind === 'retired') lines.push(`\`${f.name}: ${showValue(f.value)}\` is no longer used and was not carried over.`);
    if (f.kind === 'old-name' && e) {
      const w = (e.was || []).find((x) => x.name === f.name);
      if (!w || w.read === false) continue;
      const where = w.in === 'site' ? ' in the site folder\'s vault.config.json' : '';
      lines.push(old.origins[e.name] === 'old-name'
        ? `\`${f.name}\`${where} is now \`${e.name}\`; its value was carried over.`
        : `\`${f.name}\`${where} is an old name for \`${e.name}\`, which is set, so it was not carried over.`);
    }
  }
  for (const rec of old.legacy) {
    if (rec.status !== 'ignored') continue;
    lines.push(rec.stillApplied && rec.stillApplied.length
      ? `\`${rec.key}\` in the site folder's vault.config.json was merged into ${OLD_BLOCK}.${rec.publishKey}, which the vault's own settings already had: ${rec.stillApplied.length === 1 ? 'its entry' : 'its entries'} ${rec.stillApplied.map((x) => JSON.stringify(x)).join(', ')} ${rec.stillApplied.length === 1 ? 'was' : 'were'} added; the key was removed.`
      : `\`${rec.key}\` in the site folder's vault.config.json was not used, because the vault's own settings already had ${OLD_BLOCK}.${rec.publishKey}; it was removed.`);
  }
  for (const e of LEAVES) {
    const name = legacyNameOf(e);
    if (name && old.origins[e.name] === 'default' && !Object.prototype.hasOwnProperty.call(planned, e.name) && getPath(data, name.split('.')) === null) {
      lines.push(`\`${name}\` was empty and was not carried over.`);
    }
  }

  // The site folder's file loses every key that is a setting now; the rest is not ours.
  let siteAfter = site;
  let siteOut = null;
  let removedKeys = [];
  if (siteFile) {
    ({ siteAfter, siteOut, removedKeys } = stripSiteKeys(siteText));
  }

  if (blockers.length) return blocked();
  const m = {
    vault, siteFile, noOld, notesPresent, oldText, siteText, stateBefore: fs.existsSync(at(vault, STATE_FILE)) ? fs.readFileSync(at(vault, STATE_FILE), 'utf8') : null,
    configText, notesText, stateOut, siteOut, siteAfter, removedKeys, old, oldPc, planned, stateAfter, data, claimed, notesBody,
    extraKeys: new Set(extra.map(keyText)), carried: lines,
  };
  try {
    verify(m, deps);
  } catch (e) {
    blockers.push(firstLine(e.message));
    return blocked();
  }

  const result = {
    ok: true,
    lines: [...describeFiles(m, false), ...lines],
    blockers: [],
    files: {
      write: [at(vault, NEW_FILE), ...(notesText && !notesPresent ? [at(vault, NOTES_FILE)] : []), ...(stateOut ? [at(vault, STATE_FILE)] : []), ...(siteOut ? [siteFile] : [])],
      remove: noOld ? [] : [at(vault, OLD_FILE)],
    },
  };
  Object.defineProperty(result, INTERNAL, { value: { ...m, lines }, enumerable: false });
  return result;
}

// The hidden files a stopped move leaves beside the vault's settings files and the site folder's file.
function leftovers(vault, siteConfigPath) {
  const found = [];
  const scan = (dir, names) => {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { /* no folder, nothing left in it */ }
    const mine = new RegExp(`^\\.(${names.map((n) => n.replace(/\./g, '\\.')).join('|')})\\.\\d+\\.move\\.(old|new)$`);
    for (const f of entries.sort()) if (mine.test(f)) found.push(path.join(dir, f));
  };
  scan(path.dirname(at(vault, NEW_FILE)), [NEW_FILE, OLD_FILE, NOTES_FILE, STATE_FILE].map((f) => path.basename(f)));
  if (siteConfigPath) scan(path.dirname(path.resolve(siteConfigPath)), [path.basename(siteConfigPath)]);
  return found;
}

// Removes the hidden files; the lines say which went and which would not.
function removeStale(files, deps = {}) {
  if (!files.length) return [];
  const gone = [];
  const lines = [];
  for (const f of files) {
    try { (deps.remove || ((x) => fs.rmSync(x, { force: true })))(f); gone.push(path.basename(f)); } catch { lines.push(`${path.basename(f)} could not be removed; you can delete it.`); }
  }
  if (gone.length) lines.push(`Removed ${gone.length === 1 ? 'a hidden file' : 'hidden files'} left by an earlier move: ${gone.join(', ')}.`);
  return lines;
}

// ---- A vault that is already moved: what a stopped move (or an older plugin) left behind ------

const scratchDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gm-move-'));

// Whether `got` has everything `want` has: equal, or a list holding all of its entries, or a map holding all of its
// keys with values that do. The new file also holds what the site folder's file added to a list or map.
function covers(got, want) {
  if (Array.isArray(want) && Array.isArray(got)) return want.every((w) => got.some((g) => isDeepStrictEqual(g, w)));
  if (isMap(want) && isMap(got)) return Object.keys(want).every((k) => Object.prototype.hasOwnProperty.call(got, k) && covers(got[k], want[k]));
  return isDeepStrictEqual(got, want);
}

// Whether the old file beside the new one holds anything the new file does not: { redundant, keys, why }.
// It holds nothing more when every setting it sets, and the campaign and system it names, resolve the same
// in the new file, and its own notes are in the notes file as the move would have written them.
function oldFileHolds(vault) {
  const root = scratchDir();
  try {
    // The notes and the plain-text carries come from planning the move of a copy of the old file alone.
    const copy = path.join(root, path.basename(vault) || 'vault');
    fs.mkdirSync(path.dirname(at(copy, OLD_FILE)), { recursive: true });
    fs.copyFileSync(at(vault, OLD_FILE), at(copy, OLD_FILE));
    const p = planMove({ vaultPath: copy });
    if (!p.ok) return { redundant: false, keys: [], why: p.blockers[0] };
    const m = p[INTERNAL];
    if (!m) return { redundant: true, keys: [] };
    const before = read.readOldLayout({ vaultPath: vault, siteConfig: {} });
    const now = read.readSettings({ vaultPath: vault, siteConfig: {} });
    const keys = [];
    for (const e of LEAVES) {
      const segs = e.name.split('.');
      const planned = Object.prototype.hasOwnProperty.call(m.planned, e.name);
      if (!planned && before.origins[e.name] === 'default') continue;
      const want = planned ? m.planned[e.name] : getPath(before.values, segs);
      if (!covers(getPath(now.values, segs), want)) keys.push(e.name);
    }
    const notesFile = at(vault, NOTES_FILE);
    const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : null;
    if (m.notesText !== null && notes !== m.notesText) keys.push('its own notes');
    return { redundant: keys.length === 0, keys };
  } catch (e) {
    return { redundant: false, keys: [], why: firstLine(e.message) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The settings in `site` (the site folder's file) that the new file resolves differently, by their names.
function siteDiffers(vault, site) {
  const siteOnly = read.readOldLayout({ vaultPath: vault, siteConfig: site, skipOldFile: true });
  const now = read.readSettings({ vaultPath: vault, siteConfig: {} });
  // A left-over old file that sets a setting beat the site folder's file on it, as it did in the move itself.
  const beaten = fs.existsSync(at(vault, OLD_FILE)) ? read.readOldLayout({ vaultPath: vault, siteConfig: {} }).origins : {};
  const differs = [];
  for (const e of LEAVES) {
    if (siteOnly.origins[e.name] === 'default' || (beaten[e.name] && beaten[e.name] !== 'default')) continue;
    const segs = e.name.split('.');
    if (!covers(getPath(now.values, segs), getPath(siteOnly.values, segs))) differs.push(e.name);
  }
  return differs;
}

function mendNew(vault, siteConfigPath, plan, { discardOld = false } = {}) {
  const lines = [`This vault is already on the new settings file (${NEW_FILE}); nothing to move.`];
  const mend = { cleanup: leftovers(vault, siteConfigPath), removeOld: null, siteFile: null, siteText: null, siteOut: null, removedKeys: [] };
  const remove = [...mend.cleanup];
  const write = [];
  let leftover = null;
  if (mend.cleanup.length) lines.push(`${mend.cleanup.length === 1 ? 'A hidden file' : 'Hidden files'} left by an earlier move will be removed: ${mend.cleanup.map((f) => path.basename(f)).join(', ')}.`);

  const oldPath = at(vault, OLD_FILE);
  if (fs.existsSync(oldPath)) {
    const held = oldFileHolds(vault);
    leftover = { redundant: held.redundant, keys: held.keys };
    if (held.redundant || discardOld) {
      mend.removeOld = { file: oldPath, text: fs.readFileSync(oldPath, 'utf8') };
      remove.push(oldPath);
      lines.push(held.redundant
        ? `${OLD_FILE} is left over from before the update and holds nothing the new file lacks; it will be removed.`
        : `${OLD_FILE} is left over and holds ${held.keys.join(', ')} that the new file does not; you asked for it to be discarded, so it will be removed.`);
    } else {
      lines.push(held.why
        ? `${OLD_FILE} is left over and could not be compared with the new file (${held.why}); it was left.`
        : `${OLD_FILE} is left over and holds what the new file does not (${held.keys.join(', ')}); it was left. Check them, then remove it.`);
    }
  }

  if (siteConfigPath && fs.existsSync(path.resolve(siteConfigPath))) {
    const siteFile = path.resolve(siteConfigPath);
    const siteText = fs.readFileSync(siteFile, 'utf8');
    let site = null;
    try { site = JSON.parse(siteText); } catch { /* not ours to mend */ }
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    const mine = isMap(site) && typeof site.vaultPath === 'string' && real(path.resolve(path.dirname(siteFile), site.vaultPath)) === real(vault);
    if (mine) {
      const { siteOut, removedKeys } = stripSiteKeys(siteText);
      if (siteOut !== null) {
        const differs = siteDiffers(vault, site);
        if (differs.length) {
          lines.push(`${siteFile} still holds settings the new file has differently (${differs.join(', ')}); it was left as it is.`);
        } else {
          Object.assign(mend, { siteFile, siteText, siteOut, removedKeys });
          write.push(siteFile);
          lines.push(`Will remove the settings from ${siteFile}: ${removedKeys.join(', ')}. The new file already holds them; the rest of that file is as it was.`);
        }
      }
    }
  }
  const done = plan({ lines, files: { write, remove } });
  if (leftover) done.leftover = leftover;
  if (write.length || remove.length) Object.defineProperty(done, INTERNAL, { value: { mend }, enumerable: false });
  return done;
}

function applyMend(plan, mend, deps = {}) {
  const same = (file, text) => fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  if ((mend.siteFile && !same(mend.siteFile, mend.siteText)) || (mend.removeOld && !same(mend.removeOld.file, mend.removeOld.text))) {
    throw new Error('the settings files changed since the move was planned; nothing was changed. Run it again.');
  }
  const lines = [plan.lines[0]];
  if (mend.siteOut !== null) {
    writeAtomic(mend.siteFile, mend.siteOut, { rename: deps.rename });
    lines.push(`Removed the settings from ${mend.siteFile}: ${mend.removedKeys.join(', ')}. The rest of that file is as it was.`);
  }
  if (mend.removeOld) {
    (deps.remove || ((x) => fs.rmSync(x, { force: true })))(mend.removeOld.file);
    lines.push(`Removed ${OLD_FILE}, left over from before the update.`);
  }
  lines.push(...removeStale(mend.cleanup, deps));
  return { moved: false, lines };
}

function parseNoteSafe(text) {
  try { return parseNote(text).data; } catch { return null; }
}

// ---- Verifying ----------------------------------------------------------------------------

// Writes the new files into a scratch vault (same folder name), reads them through the real reader and
// compares with what the old files resolved to. Throws a line naming the first difference.
function verify(m, deps = {}) {
  const readSettings = deps.readSettings || read.readSettings;
  const { loadPublishConfig } = require('../config');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-move-'));
  try {
    const vault = path.join(scratch, path.basename(m.vault) || 'vault');
    const put = (rel, text) => {
      const file = at(vault, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    };
    put(NEW_FILE, m.configText);
    if (m.notesText !== null) put(NOTES_FILE, m.notesText);
    if (Object.keys(m.stateAfter).length) put(STATE_FILE, stateText(m.stateAfter));

    const now = readSettings({ vaultPath: vault, siteConfig: m.siteAfter });
    if (now.layout !== 'new') throw new Error('the new settings file was not read as the new layout');
    const pc = loadPublishConfig(vault, m.siteAfter, () => {});
    for (const f of [...now.faults, ...pc.faults]) {
      if (f.level === 'stop' || f.kind === 'not-allowed' || f.kind === 'unknown-name') throw new Error(`${f.name} would not read back (${firstLine(f.message)})`);
    }
    for (const e of LEAVES) {
      const segs = e.name.split('.');
      let want = Object.prototype.hasOwnProperty.call(m.planned, e.name) ? m.planned[e.name] : getPath(m.old.values, segs);
      const wantDefault = !Object.prototype.hasOwnProperty.call(m.planned, e.name) && m.old.origins[e.name] === 'default';
      if (!isDeepStrictEqual(getPath(now.values, segs), want)) throw new Error(`${e.name} would not come out the same after the move`);
      if ((now.origins[e.name] === 'default') !== wantDefault) throw new Error(`${e.name} would change between written and left out`);
    }
    const strip = (c) => { const { faults, origins, legacy, ...rest } = c; return rest; };
    const before = strip(m.oldPc);
    // The one place a carry or a fill shows in the build's object.
    if (Object.prototype.hasOwnProperty.call(m.planned, 'vault.system')) before.system = m.planned['vault.system'];
    const after = strip(pc);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!isDeepStrictEqual(before[key], after[key])) throw new Error(`${key} in the site's settings would not come out the same after the move`);
    }
    if (m.siteOut !== null && !isDeepStrictEqual(JSON.parse(m.siteOut), m.siteAfter)) throw new Error('the site folder\'s file would not read back the same');
    if (m.notesText !== null) {
      let note;
      try { note = parseNote(m.notesText); } catch (e) { throw new Error(`${NOTES_FILE} would not read back (${firstLine(e.message)})`); }
      const expected = { type: 'meta' };
      for (const [k, v] of Object.entries(m.data)) if (m.extraKeys.has(k)) expected[k] = v;
      if (!isDeepStrictEqual(note.data, expected)) throw new Error(`the notes from ${OLD_FILE} would not read back the same`);
      if (note.content !== m.notesBody) throw new Error(`the text of ${OLD_FILE} would not be kept exactly`);
    }
    if (!isDeepStrictEqual(readState(vault), m.stateAfter)) throw new Error(`${STATE_FILE} would not read back the same`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function describeFiles(m, done) {
  const out = [];
  out.push(`${done ? 'Wrote' : 'Will write'} ${NEW_FILE}.`);
  if (m.notesText !== null && !m.notesPresent) out.push(`${done ? 'Wrote' : 'Will write'} ${NOTES_FILE} (what ${OLD_FILE} held besides settings, kept as it was).`);
  if (m.stateOut !== null) out.push(`${done ? 'Wrote' : 'Will write'} ${STATE_FILE}.`);
  if (m.siteOut !== null) out.push(`${done ? 'Removed' : 'Will remove'} the settings from ${m.siteFile}: ${m.removedKeys.join(', ')}. The rest of that file is as it was.`);
  if (!m.noOld) out.push(`${done ? 'Removed' : 'Will remove'} ${OLD_FILE}.`);
  return out;
}

// ---- Applying -----------------------------------------------------------------------------

function applyMove(plan, deps = {}) {
  const m = plan[INTERNAL];
  if (!plan.ok) throw new Error(`the move is blocked: ${plan.blockers[0]}`);
  if (m && m.mend) return applyMend(plan, m.mend, deps);
  if (!m) return { moved: false, lines: plan.lines };

  // Nothing may have changed since the plan was made.
  const same = (file, text) => (text === null ? !fs.existsSync(file) : fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text);
  if (!same(at(m.vault, OLD_FILE), m.noOld ? null : m.oldText) || (m.siteFile && !same(m.siteFile, m.siteText)) || !same(at(m.vault, STATE_FILE), m.stateBefore)) {
    throw new Error('the settings files changed since the move was planned; nothing was changed. Run it again.');
  }
  if (fs.existsSync(at(m.vault, NEW_FILE)) || (fs.existsSync(at(m.vault, NOTES_FILE)) !== m.notesPresent)) {
    throw new Error('a new settings file appeared since the move was planned; nothing was changed.');
  }
  verify(m, deps);

  const rename = deps.rename || fs.renameSync;
  const remove = deps.remove || ((f) => fs.rmSync(f, { force: true }));
  const tag = `${process.pid}.move`;
  const sibling = (file, kind) => path.join(path.dirname(file), `.${path.basename(file)}.${tag}${kind}`);

  // Commit order: notes and state first, the new settings file (which makes the vault read as moved)
  // next, then the site folder's file, then the old file goes aside. A file that is already there is
  // copied aside and then replaced by one rename, so no target is ever missing, even for a moment.
  const targets = [];
  if (m.notesText !== null && !m.notesPresent) targets.push({ file: at(m.vault, NOTES_FILE), text: m.notesText });
  if (m.stateOut !== null) targets.push({ file: at(m.vault, STATE_FILE), text: m.stateOut });
  targets.push({ file: at(m.vault, NEW_FILE), text: m.configText });
  if (m.siteOut !== null) targets.push({ file: m.siteFile, text: m.siteOut });
  for (const t of targets) { t.tmp = sibling(t.file, '.new'); t.bak = sibling(t.file, '.old'); t.existed = fs.existsSync(t.file); }
  const oldFile = at(m.vault, OLD_FILE);
  const oldBak = sibling(oldFile, '.old');

  const undo = [];
  const baks = [];
  try {
    for (const t of targets) {
      fs.mkdirSync(path.dirname(t.file), { recursive: true });
      fs.writeFileSync(t.tmp, t.text);
      if (t.existed) fs.chmodSync(t.tmp, fs.statSync(t.file).mode & 0o7777);
    }
    for (const t of targets) {
      if (t.existed) {
        fs.copyFileSync(t.file, t.bak);
        baks.push(t.bak);
        undo.push(() => fs.renameSync(t.bak, t.file));
      } else {
        undo.push(() => fs.rmSync(t.file, { force: true }));
      }
      rename(t.tmp, t.file);
    }
    if (!m.noOld) {
      rename(oldFile, oldBak);
      undo.push(() => fs.renameSync(oldBak, oldFile));
      baks.push(oldBak);
    }
  } catch (e) {
    const stuck = [];
    for (const step of undo.reverse()) {
      try { step(); } catch (e2) { stuck.push(firstLine(e2.message)); }
    }
    for (const t of targets) {
      for (const f of [t.tmp, t.bak]) { try { fs.rmSync(f, { force: true }); } catch { /* the scratch name is hidden and harmless */ } }
    }
    if (stuck.length) {
      throw new Error(`the move failed (${firstLine(e.message)}) and could not put everything back (${stuck.join('; ')}); the old files are kept beside the new ones under hidden names ending in .old`);
    }
    throw new Error(`the move did not go through (${firstLine(e.message)}); nothing was changed`);
  }
  const lines = [...describeFiles(m, true), ...m.lines];
  for (const bak of baks) {
    try { remove(bak); } catch { lines.push(`${path.basename(bak)} could not be removed; you can delete it.`); }
  }
  // Hidden files an earlier, stopped move left (this one's own are gone).
  lines.push(...removeStale(leftovers(m.vault, m.siteFile), deps));
  return { moved: true, lines };
}

module.exports = { planMove, applyMove, isBoilerplate, siteToolHold, holdFrom, siteToolHoldAll };
