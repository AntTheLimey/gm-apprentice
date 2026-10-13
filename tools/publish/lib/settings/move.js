'use strict';
// The move: a vault from the old layout (settings in the frontmatter of _meta/vault-config.md,
// some of them in the site folder's vault.config.json) to the new one (_meta/vault-config.yaml,
// _meta/vault-state.json, and _meta/vault-notes.md for the GM's own prose). All or nothing, and
// exact: the new files are written to a scratch copy of the vault's _meta folder and read back
// through the real reader, and everything the old files resolved to must come back the same
// before a single file of the vault is touched. The vault is then changed by renames, the old
// files kept aside until the last one succeeds, and put back if any step fails.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const YAML = require('yaml');
const matter = require('gray-matter');
const { REGISTRY, legacyNameOf } = require('./registry');
const { TYPES, isMap } = require('./types');
const { isLeaf } = require('./describe');
const { formatFault } = require('./faults');
const { OLD_FILE, NEW_FILE, STATE_FILE, NOTES_FILE, layoutOf, at } = require('./layout');
const read = require('./read');
const { OLD_BLOCK } = require('./legacy');
const { readState, stateText } = require('./state');
const { parseNote } = require('../frontmatter');

const { Scalar, Pair, YAMLMap, isScalar, isMap: isYMap, isNode } = YAML;
const LEAVES = REGISTRY.filter((e) => isLeaf(e, REGISTRY));
const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));
const FILLABLE = ['vault.campaign', 'vault.system'];
const PLAIN = { lineWidth: 0, flowCollectionPadding: false };

const firstLine = (text) => String(text).split('\n')[0].trim();
const getPath = (obj, segs) => segs.reduce((cur, s) => (isMap(cur) && Object.prototype.hasOwnProperty.call(cur, s) ? cur[s] : undefined), obj);
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

// Splits the old file into its frontmatter text and body, through the same library the writer uses.
function split(whole) {
  const m = matter(whole, { engines: { yaml: () => ({}) } });
  return m.content === whole ? { front: null, body: whole } : { front: m.matter, body: m.content };
}

// ---- Planning -----------------------------------------------------------------------------

const INTERNAL = Symbol('move');

function planMove({ vaultPath, siteConfigPath = null, fill = {} }, deps = {}) {
  const vault = path.resolve(vaultPath);
  const plan = (extra) => ({ ok: true, lines: [], blockers: [], files: { write: [], remove: [] }, ...extra });
  const layout = layoutOf(vault);
  if (layout === 'new') return plan({ lines: [`This vault is already on the new settings file (${NEW_FILE}); nothing to move.`] });
  if (layout === 'none') return plan({ lines: ['This vault has no settings file; nothing to move.'] });

  const blockers = [];
  const blocked = () => ({ ok: false, lines: [], blockers: [...new Set(blockers)], files: { write: [], remove: [] } });

  for (const name of Object.keys(fill)) {
    if (!FILLABLE.includes(name)) blockers.push(`--fill takes only ${FILLABLE.join(' and ')}; ${name} is not one of them.`);
  }
  const notesFile = at(vault, NOTES_FILE);
  if (fs.existsSync(notesFile)) blockers.push(`${NOTES_FILE} already exists; the notes from ${OLD_FILE} would have nowhere to go. Move it aside first.`);
  let state;
  try { state = readState(vault); } catch (e) { blockers.push(firstLine(e.message)); state = {}; }

  // The site folder's file, when there is one.
  let site = {};
  let siteText = null;
  const siteFile = siteConfigPath && fs.existsSync(path.resolve(siteConfigPath)) ? path.resolve(siteConfigPath) : null;
  if (siteFile) {
    siteText = fs.readFileSync(siteFile, 'utf8');
    try {
      site = JSON.parse(siteText);
      if (!isMap(site)) throw new Error('it must hold an object');
    } catch (e) {
      blockers.push(`${siteFile} could not be read as JSON: ${firstLine(e.message)}`);
      site = {};
    }
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

  const oldText = fs.readFileSync(at(vault, OLD_FILE), 'utf8');
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
  const claimed = new Set(['type', OLD_BLOCK, 'gm_apprentice_version']);
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
  const GROUP_ORDER = ['vault', 'player_site'];
  const rank = (p) => (keyText(p) === 'version' ? -1 : GROUP_ORDER.indexOf(keyText(p)));
  newDoc.contents.items.sort((a, b) => rank(a) - rank(b));
  for (const p of newDoc.contents.items) if (keyText(p) !== 'version') p.key.spaceBefore = true;
  const configText = newDoc.toString(PLAIN);

  // The notes: the top-level keys that are neither settings nor state, and the body unless it is the scaffold's own.
  let notesDoc = null;
  let notesBody = '';
  const extra = doc && doc.contents ? doc.contents.items.filter((p) => !claimed.has(keyText(p))) : [];
  const keepBody = !isBoilerplate(body);
  if (extra.length || keepBody) {
    notesDoc = new YAML.Document();
    notesDoc.contents = new YAMLMap();
    const typeKey = new Scalar('type');
    const oldType = doc.contents && doc.contents.items.find((p) => keyText(p) === 'type');
    if (oldType && oldType.key.commentBefore) typeKey.commentBefore = oldType.key.commentBefore;
    notesDoc.contents.items.push(new Pair(typeKey, new Scalar('meta')));
    for (const p of extra) notesDoc.contents.items.push(new Pair(p.key.clone(), isNode(p.value) ? p.value.clone() : p.value));
    notesBody = keepBody ? body : '';
  }
  const notesText = notesDoc ? `---\n${notesDoc.toString(PLAIN)}---\n${notesBody}` : null;

  // Comments: counted off, so one that could not be placed is said, never dropped quietly.
  const left = doc ? commentLines(doc) : [];
  for (const kept of [...commentLines(newDoc), ...(notesDoc ? commentLines(notesDoc) : [])]) {
    const at2 = left.indexOf(kept);
    if (at2 >= 0) left.splice(at2, 1);
  }
  for (const text of left) lines.push(`a comment could not be carried: ${text}`);

  // State.
  const patch = {};
  if (data.gm_apprentice_version != null && state.gm_apprentice_version === undefined) patch.gm_apprentice_version = data.gm_apprentice_version;
  const note = getPath(data, [OLD_BLOCK, 'setup_progress']);
  if (isMap(note) && state.setup === undefined) patch.setup = note;
  else if (note != null && !isMap(note)) lines.push(`${OLD_BLOCK}.setup_progress is not a note the set-up guide wrote, so it was not carried over.`);
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
    if (rec.status === 'ignored') lines.push(`\`${rec.key}\` in the site folder's vault.config.json was ignored, because the vault's own settings already had ${OLD_BLOCK}.${rec.publishKey}; it was removed.`);
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
  const removedKeys = [];
  if (siteFile) {
    siteAfter = JSON.parse(siteText);
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
    if (removedKeys.length) siteOut = `${JSON.stringify(siteAfter, null, 2)}\n`;
  }

  const m = {
    vault, siteFile, oldText, siteText, stateBefore: fs.existsSync(at(vault, STATE_FILE)) ? fs.readFileSync(at(vault, STATE_FILE), 'utf8') : null,
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
      write: [at(vault, NEW_FILE), ...(notesText ? [at(vault, NOTES_FILE)] : []), ...(stateOut ? [at(vault, STATE_FILE)] : []), ...(siteOut ? [siteFile] : [])],
      remove: [at(vault, OLD_FILE)],
    },
  };
  Object.defineProperty(result, INTERNAL, { value: { ...m, lines }, enumerable: false });
  return result;
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
      // A setting the old layout never had: the new reader gives the campaign the vault folder's name when unset.
      if (e.name === 'vault.campaign' && m.old.origins[e.name] === 'default' && want === null) want = path.basename(path.resolve(m.vault));
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
  if (m.notesText !== null) out.push(`${done ? 'Wrote' : 'Will write'} ${NOTES_FILE} (what ${OLD_FILE} held besides settings, kept as it was).`);
  if (m.stateOut !== null) out.push(`${done ? 'Wrote' : 'Will write'} ${STATE_FILE}.`);
  if (m.siteOut !== null) out.push(`${done ? 'Removed' : 'Will remove'} the settings from ${m.siteFile}: ${m.removedKeys.join(', ')}. The rest of that file is as it was.`);
  out.push(`${done ? 'Removed' : 'Will remove'} ${OLD_FILE}.`);
  return out;
}

// ---- Applying -----------------------------------------------------------------------------

function applyMove(plan, deps = {}) {
  const m = plan[INTERNAL];
  if (!plan.ok) throw new Error(`the move is blocked: ${plan.blockers[0]}`);
  if (!m) return { moved: false, lines: plan.lines };

  // Nothing may have changed since the plan was made.
  const same = (file, text) => (text === null ? !fs.existsSync(file) : fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text);
  if (!same(at(m.vault, OLD_FILE), m.oldText) || (m.siteFile && !same(m.siteFile, m.siteText)) || !same(at(m.vault, STATE_FILE), m.stateBefore)) {
    throw new Error('the settings files changed since the move was planned; nothing was changed. Run it again.');
  }
  if (fs.existsSync(at(m.vault, NEW_FILE)) || fs.existsSync(at(m.vault, NOTES_FILE))) {
    throw new Error('a new settings file appeared since the move was planned; nothing was changed.');
  }
  verify(m, deps);

  const rename = deps.rename || fs.renameSync;
  const remove = deps.remove || ((f) => fs.rmSync(f, { force: true }));
  const tag = `${process.pid}.move`;
  const sibling = (file, kind) => path.join(path.dirname(file), `.${path.basename(file)}.${tag}${kind}`);

  // Commit order: notes and state first, the new settings file (which makes the vault read as moved)
  // next, then the site folder's file, then the old file goes aside.
  const targets = [];
  if (m.notesText !== null) targets.push({ file: at(m.vault, NOTES_FILE), text: m.notesText });
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
        rename(t.file, t.bak);
        undo.push(() => fs.renameSync(t.bak, t.file));
        baks.push(t.bak);
      }
      rename(t.tmp, t.file);
      if (!t.existed) undo.push(() => fs.rmSync(t.file, { force: true }));
    }
    rename(oldFile, oldBak);
    undo.push(() => fs.renameSync(oldBak, oldFile));
    baks.push(oldBak);
  } catch (e) {
    const stuck = [];
    for (const step of undo.reverse()) {
      try { step(); } catch (e2) { stuck.push(firstLine(e2.message)); }
    }
    for (const t of targets) { try { fs.rmSync(t.tmp, { force: true }); } catch { /* the scratch name is hidden and harmless */ } }
    if (stuck.length) {
      throw new Error(`the move failed (${firstLine(e.message)}) and could not put everything back (${stuck.join('; ')}); the old files are kept beside the new ones under hidden names ending in .old`);
    }
    throw new Error(`the move did not go through (${firstLine(e.message)}); nothing was changed`);
  }
  const lines = [...describeFiles(m, true), ...m.lines];
  for (const bak of baks) {
    try { remove(bak); } catch { lines.push(`${path.basename(bak)} could not be removed; you can delete it.`); }
  }
  return { moved: true, lines };
}

module.exports = { planMove, applyMove, isBoilerplate };
