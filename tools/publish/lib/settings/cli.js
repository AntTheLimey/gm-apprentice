'use strict';
// The `settings` command: reads, writes, describes and checks any setting through the
// declared list.
//
//   settings get [<name>]            what each setting is, and where that came from
//   settings set <name>=<json> ...   write settings (all or none)
//   settings unset <name> ...        remove settings (all or none)
//   settings describe <name>         what one setting does and takes
//   settings check                   the faults in the file
//   settings list                    every name a GM can set
//   settings raw [<name>]            the file as written
//   settings setup-note get|set|clear  the publish set-up note
//   settings move                    take a vault from the old settings file to the new one
const fs = require('node:fs');
const path = require('node:path');
const { parseNote } = require('../frontmatter');
const { REGISTRY, legacyNameOf, resolve } = require('./registry');
const { applyChanges, refusalsFor } = require('./write');
const { isMap, getPath, firstLine } = require('./types');
const { readSettings, parseNewFile } = require('./read');
const { OLD_FILE, NEW_FILE, STATE_FILE, layoutOf, at: fileAt } = require('./layout');
const { nearest } = require('./faults');
const { row, isLeaf } = require('./describe');
const { OLD_BLOCK, SETUP_NOTE } = require('./legacy');
const { normalizeExcludeDir, normalizeExcludeDirs } = require('./folders');
const { readState, writeState } = require('./state');
const { planMove, applyMove } = require('./move');

const VERBS = ['get', 'set', 'add', 'remove', 'unset', 'describe', 'check', 'list', 'raw', 'setup-note', 'move'];
const LEAVES = () => REGISTRY.filter((e) => isLeaf(e, REGISTRY));
const SETTABLE_NAMES = () => LEAVES().map((e) => e.name);
// Removed in Part B: the name the old vault file gave a setting, which the commands still take for
// one release. An old name is answered as the setting it became, with a line naming the new one.
const oldOf = (e) => legacyNameOf(e);
const oldNamesOf = (e) => (e.legacyOnly ? [e.name] : (e.was || []).filter((w) => w.in === 'vault').map((w) => w.name));
const reaches = (e, scope) => inScope(e.name, scope) || oldNamesOf(e).some((n) => inScope(n, scope));

// ---- Finding the vault and the site file --------------------------------------------------

// { vaultPath, siteConfig }. --vault is the vault; --config is the site folder's
// vault.config.json. With only --config, the vault is the one that file names.
function target(options) {
  const { loadVaultConfig } = require('../config');
  if (options.vault) {
    const config = options.config ? path.resolve(options.config) : null;
    return { vaultPath: path.resolve(options.vault), siteConfig: config && fs.existsSync(config) ? loadVaultConfig(config) : {} };
  }
  const config = path.resolve(options.config || './vault.config.json');
  const siteConfig = loadVaultConfig(config);
  if (!siteConfig.vaultPath) throw new Error(`${config} has no "vaultPath"`);
  return { vaultPath: path.resolve(path.dirname(config), siteConfig.vaultPath), siteConfig };
}

// The settings file as written: the whole new file, or the frontmatter of the old one; {} with no file.
function rawData(vaultPath) {
  if (layoutOf(vaultPath) === 'new') return parseNewFile(vaultPath);
  const file = fileAt(vaultPath, OLD_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    return parseNote(fs.readFileSync(file, 'utf8')).data || {};
  } catch (e) {
    throw new Error(`${OLD_FILE} frontmatter is not valid YAML: ${String(e.message).split('\n')[0].trim().replace(/:$/, '')}`);
  }
}

// Where the old file holds the thing a name points at, as the full path from the top of the file. A name
// the old file used is taken as it stands (so an older spelling of a setting can be taken out by the
// spelling it was written in); a new name goes to the setting's place in the old file.
const filePathOf = (name, r) => ((r.old || r.entry.legacyOnly) ? name : oldOf(r.entry)).split('.');
const noticeFor = (name) => { const r = resolve(name); return r && r.old ? `${name} is now ${r.entry.name}.` : null; };
const noticesFor = (names) => names.map(noticeFor).filter(Boolean);

// ---- Faults ------------------------------------------------------------------------------

function faultJson(f) {
  const out = { name: f.name, level: f.level, kind: f.kind, message: f.message };
  if (f.setting) out.setting = f.setting;
  if (f.suggest) out.suggest = f.suggest;
  if (f.use) out.use = f.use;
  return out;
}
// Stops first, otherwise in the order found.
const sortedFaults = (faults) => [...faults.filter((f) => f.level === 'stop'), ...faults.filter((f) => f.level !== 'stop')];
const faultLine = (f) => `${f.level === 'stop' ? 'Stop' : 'Warning'}: ${f.message}`;

// ---- Reading ------------------------------------------------------------------------------

const ORIGIN_WORDS = { default: 'default', file: 'vault file', 'site-file': 'site file', 'old-name': 'old name', fault: 'not readable, using this' };
const inScope = (name, scope) => !scope || name === scope || name.startsWith(`${scope}.`);

// A value as plain output prints it: whole, since a reader may act on it. Lists and maps
// are written out in full as JSON; only a fault message cuts what it echoes.
function plainValue(v) {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function get(options, names) {
  const { vaultPath, siteConfig } = target(options);
  const leaves = LEAVES();
  for (const name of names) if (!leaves.some((e) => reaches(e, name))) throw new Error(notASetting(name));
  const read = readSettings({ vaultPath, siteConfig });
  const shown = names.length ? [...new Set(names.flatMap((name) => leaves.filter((e) => reaches(e, name))))] : leaves;
  const now = {};
  // Removed in Part B: the old shape main's vault scripts read, keyed by the old file's names.
  const settings = {};
  for (const e of shown) {
    const one = { value: getPath(read.values, e.name.split('.')) ?? null, origin: read.origins[e.name] };
    now[e.name] = one;
    if (oldOf(e)) settings[oldOf(e)] = one;
  }
  const asked = (f) => !names.length || names.some((name) => inScope(f.name, name) || inScope(f.use || '', name) || inScope(f.suggest || '', name) || inScope(f.setting || '', name));
  const faults = sortedFaults(read.faults.filter(asked));
  const result = {
    file: read.file,
    settings,
    faults: faults.map(faultJson),
    byNewName: { values: Object.fromEntries(Object.entries(now).map(([n, s]) => [n, s.value])), origins: Object.fromEntries(Object.entries(now).map(([n, s]) => [n, s.origin])) },
  };
  const lines = Object.entries(now).map(([n, s]) => `${n}: ${plainValue(s.value)} (${ORIGIN_WORDS[s.origin] || s.origin})`);
  if (faults.length) lines.push('', ...faults.map(faultLine));
  return { result, lines, notices: noticesFor(names) };
}

function check(options) {
  const { vaultPath, siteConfig } = target(options);
  const faults = sortedFaults(readSettings({ vaultPath, siteConfig }).faults);
  return {
    result: { faults: faults.map(faultJson) },
    lines: faults.length ? faults.map(faultLine) : ['Every setting in the file reads cleanly.'],
    rc: faults.some((f) => f.level === 'stop') ? 1 : 0,
  };
}

// Where a name that is not a setting points in the file: the same name on the new layout; on the old
// one, a group of the new layout (player_site.theme) is the part of the old file that holds its settings.
function groupPathOf(name, newLayout) {
  const own = name.split('.');
  if (newLayout) return own;
  const under = LEAVES().filter((e) => e.name.startsWith(`${name}.`) && oldOf(e)).map((e) => oldOf(e).split('.'));
  if (!under.length) return own;
  const head = [];
  for (let i = 0; i < under[0].length; i++) { if (under.every((p) => p[i] === under[0][i] && i < p.length - 1)) head.push(under[0][i]); else break; }
  return head.length ? head : null;
}

function raw(options, name) {
  const { vaultPath } = target(options);
  const data = rawData(vaultPath);
  const r = name ? resolve(name) : null;
  const newLayout = layoutOf(vaultPath) === 'new';
  const at = r ? (newLayout ? r.entry.name.split('.') : (oldOf(r.entry) ? filePathOf(name, r) : null)) : (name ? groupPathOf(name, newLayout) : null);
  const value = name ? (at ? getPath(data, at) : undefined) : data;
  const result = value === undefined ? null : value;
  return { result, lines: [JSON.stringify(result, null, 2)], notices: name ? noticesFor([name]) : [] };
}

// ---- Describing ---------------------------------------------------------------------------

function notASetting(name) {
  const old = LEAVES().map(oldOf).filter(Boolean);
  const near = nearest(name, [...SETTABLE_NAMES(), ...old]);
  return `${name} is not a setting.${near ? ` Did you mean ${near}?` : ''}`;
}

// What the old file called a setting, for the line beneath its name.
const wasLine = (e) => {
  const names = (e.was || []).map((w) => (w.in === 'site' ? `${w.name} (in vault.config.json)` : w.name));
  return names.length ? `Was: ${names.join(', ')}` : null;
};

function describe(name) {
  const own = resolve(name);
  const holds = LEAVES().filter((e) => e.name.startsWith(`${name}.`) || (!!oldOf(e) && oldOf(e).startsWith(`${name}.`))).map((e) => e.name);
  if (holds.length && !(own && isLeaf(own.entry, REGISTRY))) {
    return { result: { name, holds }, lines: [`${name} holds other settings: ${holds.join(', ')}.`], notices: noticesFor([name]) };
  }
  const e = own && own.entry;
  if (!e || !isLeaf(e, REGISTRY)) throw new Error(notASetting(name));
  const r = row(e);
  const lines = [r.name];
  if (wasLine(e)) lines.push(`  ${wasLine(e)}`);
  lines.push(`  ${r.does || '(no description)'}`, `  takes: ${r.takes}`, `  default: ${plainValue(r.default)}`);
  if (r.guards) lines.push('  hides things from players: a mistake here stops the build');
  return { result: r, lines, notices: noticesFor([name]) };
}

function list() {
  const names = LEAVES().map((e) => {
    const r = row(e);
    return { name: r.name, takes: r.takes, default: r.default, was: wasLine(e) };
  });
  // Removed in Part B: the same rows under the old file's names, which the vault scripts still ask by.
  const olds = LEAVES().filter(oldOf).map((e) => { const r = row(e); return { name: oldOf(e), takes: r.takes, default: r.default, now: e.name }; });
  return {
    result: { names: [...names, ...olds] },
    lines: names.flatMap((n) => [`${n.name}: ${n.takes} (default ${plainValue(n.default)})`, ...(n.was ? [`  ${n.was}`] : [])]),
  };
}

// The help for the command, from the list: no setting is named anywhere else.
function helpText() {
  const names = LEAVES().map((e) => `  ${e.name}  ${row(e).takes}`);
  return `
gm-apprentice-publish settings <get|set|add|remove|unset|describe|check|list|raw|setup-note|move> [...] [--json] [--create] [--vault <dir>] [--config <path>]

Reads, writes, describes and checks the settings in the vault's settings file (${NEW_FILE}; ${OLD_FILE} on a vault not yet updated).

  settings get [<name> ...]        What each setting is now and where that came from; a
                                   group name (player_site.landing) gives every setting under it
  settings set <name>=<value> ... Write settings, all or none: settings set player_site.features.connections=web
                                   A list or map is written as JSON: settings set 'player_site.landing.quick_links=["A","B"]'
  settings add <name> <entry> ...  Add entries to a list setting, keeping what it holds now
                                   (the built-in list included): settings add player_site.hide.sections Rumours "Player Handout"
  settings remove <name> <entry> ...  Take entries out of a list setting
  settings unset <name> ...        Remove settings from the file, all or none
  settings describe <name>         What one setting does, what it takes, its default
  settings check                   The faults in the file; exits 1 when one stops the build
  settings list                    Every setting that can be set
  settings raw [<name>]            The file as written, or the value at one name
  settings move [--check] [--fill name=value ...]
                                   Take a vault from the old settings file to the new one, all or nothing
                                   (--check only shows what it would do; --fill gives vault.campaign or vault.system when the vault has none)
                                   Do not run it by hand yet: the next release runs it for you, and teaches the
                                   plugin's own scripts to read the new file at the same time
  settings setup-note get [<key>]  The publish set-up guide's note to itself (${STATE_FILE}; the old settings file on a
                                   vault not yet updated). Also: setup-note set <key>=<value> ... and setup-note clear

  --vault <dir>    The vault (default: the vaultPath in the config)
  --config <path>  The site folder's vault.config.json (default: ./vault.config.json)
  --create         With set: make the settings file when the vault has none yet
  --json           Print JSON
  --help, -h       Show this help

A setting's old name (publish.search and so on) still works for now, with a line saying what it is called now.

The settings:
${names.join('\n')}
`;
}

// ---- Writing ------------------------------------------------------------------------------

// A plain reason a name cannot be written, or null. The writer checks every change again.
function refusal(name) {
  const r = resolve(name);
  const e = r && r.entry;
  // A setting that sits inside `parent`, named the way `name` is named, as the example to point at.
  const example = (parent) => {
    const child = LEAVES().find((x) => x.name.startsWith(`${parent.name}.`) || (!!oldOf(x) && !!oldOf(parent) && oldOf(x).startsWith(`${oldOf(parent)}.`)));
    return child && (name === parent.name ? child.name : (oldOf(child) || child.name));
  };
  if (!e) {
    const child = LEAVES().find((x) => x.name.startsWith(`${name}.`) || (!!oldOf(x) && oldOf(x).startsWith(`${name}.`)));
    if (child) return `${name} holds other settings; set the setting itself, for example ${name.startsWith(`${OLD_BLOCK}.`) ? oldOf(child) : child.name}.`;
    return notASetting(name);
  }
  if (e.state || e.settable === false) return `${name} is kept by the tool and cannot be set here.`;
  if (e.retired) return `${name} is no longer used and cannot be set.`;
  const child = example(e);
  if (child && !e.open) return `${name} holds other settings; set the setting itself, for example ${child}.`;
  if (e.container || e.legacyOnly) return `${name} only holds other settings and cannot be set.`;
  return null;
}

// Hands the changes to the writer. { ok } or { errors } (one line for each refusal).
function write(options, changes) {
  const { vaultPath, siteConfig } = target(options);
  try {
    return { ok: applyChanges(vaultPath, changes, { create: !!options.create, siteConfig }) };
  } catch (e) {
    if (e.refusals) return { errors: e.refusals };
    throw e;
  }
}

// `name=value` as given on the command line; a value that is not JSON is the text written.
function splitPair(pair) {
  const at = pair.indexOf('=');
  return { name: (at < 0 ? pair : pair.slice(0, at)).trim(), given: at < 0 ? '' : pair.slice(at + 1), hasValue: at >= 0 };
}
function valueOf(given) {
  try {
    return JSON.parse(given);
  } catch {
    return given.trim();
  }
}

// Turns `name=value` pairs into set changes. { errors } and nothing else when any is refused.
// A value that is not JSON is taken as the text written.
function plan(options, pairs) {
  const { vaultPath } = target(options);
  const errors = [];
  const changes = [];
  const written = [];
  const empties = [];
  for (const pair of pairs) {
    const { name, given, hasValue } = splitPair(pair);
    const why = refusal(name);
    if (why) { errors.push(why); continue; }
    const e = resolve(name).entry;
    if (!hasValue) { errors.push(`${name} needs a value, like ${name}=value.`); continue; }
    if (given.trim() === '') { errors.push(`${name} has no value; to take it out of the file, use settings unset ${name}.`); continue; }
    let value = valueOf(given);
    // A list of folders is written tidied, as the reader tidies it (one function: folders.js).
    if (e.same === 'folder' && Array.isArray(value) && value.every((x) => typeof x === 'string' && x.trim() !== '')) {
      if (value.some((x) => normalizeExcludeDir(x, vaultPath) === null)) { errors.push(`${name} has an entry that is not a folder inside the vault; remove it.`); continue; }
      value = normalizeExcludeDirs(value, vaultPath);
    }
    const at2 = changes.findIndex((c) => c.name === e.name);
    if (at2 >= 0) changes.splice(at2, 1);
    changes.push({ op: 'set', name: e.name, label: name, value });
    if (!written.includes(name)) written.push(name);
    if (Array.isArray(value) && value.length === 0 && Array.isArray(e.default) && e.default.length > 0) empties.push(name);
  }
  if (errors.length && changes.length) errors.push(...refusalsFor(target(options).vaultPath, changes));
  return errors.length ? { errors } : { changes, written, empties };
}

// `noun` is what the list holds, from the setting's own entry.
const emptyNote = (name, noun = ((resolve(name) || {}).entry || {}).of || 'entries') => `${name} is empty: nothing from the built-in list is hidden. Add the ${noun} you want hidden, or remove the key to use the built-in list again.`;

function set(options, pairs) {
  if (!pairs.length) throw new Error('settings set needs at least one name=value.');
  const planned = plan(options, pairs);
  if (planned.errors) return { errors: planned.errors };
  const done = write(options, planned.changes);
  if (done.errors) return done;
  const notes = planned.empties.map((n) => emptyNote(n));
  const result = { written: planned.written, notes };
  // The line names what is now in the file: an older spelling given is replaced by the primary one.
  const lines = planned.written.map((n) => {
    const r = resolve(n);
    if (!r.old) return `Wrote ${n}.`;
    const at = planned.changes.findIndex((c) => c.name === r.entry.name);
    return `Wrote ${done.ok.wrote[at] || n}.`;
  });
  return { result, lines: [...lines, ...done.ok.notes, ...notes], notices: noticesFor(planned.written) };
}

// Whether two entries of a list setting are one entry, by the rule the build itself uses for
// that list (the entry's `same`), each asked of the code where the rule lives.
function sameRule(e, vaultPath) {
  if (e.same === 'heading') {
    const { headingKey } = require('../heading-key');
    return (a, b) => (headingKey(a) || a) === (headingKey(b) || b);
  }
  if (e.same === 'folder') {
    const { dirIsExcluded } = require('../scanner');
    return (a, b) => dirIsExcluded(a, [b]) && dirIsExcluded(b, [a]);
  }
  if (e.same === 'callout') return (a, b) => a.toLowerCase() === b.toLowerCase(); // the build lower-cases both sides
  if (e.same === 'name') {
    const { canonicalNfc } = require('../unicode');
    return (a, b) => canonicalNfc(a) === canonicalNfc(b);
  }
  return (a, b) => a === b;
}

// add and remove: the setting's current resolved list, changed, written whole through the same
// validation and writer as set.
function changeList(options, verb, args) {
  const [name, ...items] = args;
  if (!name || !items.length) throw new Error(`settings ${verb} needs a setting name and at least one entry in quotes.`);
  const why = refusal(name);
  if (why) return { errors: [why] };
  const e = resolve(name).entry;
  const { vaultPath, siteConfig } = target(options);
  // The lines name the setting as the vault's file writes it.
  const shownAs = layoutOf(vaultPath) === 'legacy' ? name : e.name;
  const isSame = sameRule(e, vaultPath);
  const texts = [];
  for (const item of items) {
    let v;
    try { v = JSON.parse(item); } catch { v = undefined; }
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) texts.push(...v);
    else if (v === null || typeof v === 'object') {
      return { errors: [`${item.length > 60 ? `${item.slice(0, 60)}…` : item} is not an entry; write each entry as plain text or in quotes, or give a list of text like '["A","B"]'.`] };
    } else texts.push(typeof v === 'string' ? v : item.trim());
  }
  const entries = [];
  for (let v of texts) {
    if (e.same === 'folder') v = normalizeExcludeDir(v, vaultPath) ?? '';
    if (v.trim() === '') return { errors: [`${name} has a blank entry; remove it.`] };
    entries.push(v);
  }
  const read = readSettings({ vaultPath, siteConfig });
  let current = getPath(read.values, e.name.split('.'));
  const isList = e.type === 'list' || (e.type === 'switchOrList' && (Array.isArray(current) || current === false || current === true));
  if (!isList) return { errors: [`${name} is not a list, so entries cannot be ${verb === 'add' ? 'added to' : 'removed from'} it.`] };
  if (read.origins[e.name] === 'fault') return { errors: [`${name} in the file cannot be read; fix it with settings set first.`] };
  if (current === true) return { errors: [`${name} is on, which hides every one of its kind, so a list cannot be changed; use settings set ${name} to give a list or turn it off.`] };
  if (current === false) current = [];
  const unique = entries.filter((x, i) => entries.findIndex((y) => isSame(x, y)) === i);
  const result = { written: [], notes: [] };
  let list = null;
  if (verb === 'add') {
    const found = unique.map((x) => ({ x, at: current.find((c) => isSame(c, x)) }));
    result.added = found.filter((f) => f.at === undefined).map((f) => f.x);
    result.already = [...new Set(found.filter((f) => f.at !== undefined).map((f) => f.at))];
    if (result.added.length) list = [...current, ...result.added];
  } else {
    result.removed = current.filter((c) => unique.some((x) => isSame(c, x)));
    result.absent = unique.filter((x) => !current.some((c) => isSame(c, x)));
    if (result.removed.length) list = current.filter((c) => !result.removed.includes(c));
  }
  result.list = list || current;
  if (list) {
    const done = write(options, [{ op: verb, name: e.name, label: name, entries: verb === 'add' ? result.added : result.removed, same: isSame, base: current }]);
    if (done.errors) return done;
    result.written = [shownAs];
    if (verb === 'remove') {
      const after = getPath(readSettings({ vaultPath, siteConfig }).values, e.name.split('.')) || [];
      for (const x of result.removed) {
        if (Array.isArray(after) && after.some((a) => isSame(a, x))) result.notes.push(`${JSON.stringify(x)} still applies, because vault.config.json also lists it; remove it there too.`);
        else if (e.guards && Array.isArray(e.default) && e.default.some((d) => isSame(d, x))) result.notes.push(`${JSON.stringify(x)} was built in to ${shownAs} and is no longer hidden.`);
      }
    }
    // Not said when the site file's own entries still hide something.
    const stillApplies = verb === 'remove' && result.notes.some((n) => n.includes(' still applies,'));
    if (!stillApplies && list.length === 0 && Array.isArray(e.default) && e.default.length > 0) result.notes.push(emptyNote(shownAs));
  }
  const shown = (xs) => xs.map((x) => JSON.stringify(x)).join(', ');
  const done = verb === 'add' ? result.added : result.removed;
  const other = verb === 'add' ? result.already : result.absent;
  const lines = [];
  if (done.length) lines.push(`${verb === 'add' ? 'Added' : 'Removed'} ${shown(done)} ${verb === 'add' ? 'to' : 'from'} ${shownAs}.`);
  if (other.length) lines.push(`${shown(other)} ${other.length > 1 ? 'were' : 'was'} ${verb === 'add' ? 'already in' : 'not in'} ${shownAs}.`);
  lines.push(...result.notes);
  return { result, lines, notices: noticesFor([name]) };
}

function unset(options, names) {
  if (!names.length) throw new Error('settings unset needs at least one name.');
  const { vaultPath } = target(options);
  const legacy = layoutOf(vaultPath) === 'legacy';
  const shownAs = (n) => (legacy ? n : given.get(n));
  const errors = [];
  const changes = [];
  const given = new Map();
  for (const name of names) {
    if (given.has(name)) continue;
    const r = resolve(name);
    const holds = LEAVES().filter((x) => x.name.startsWith(`${name}.`) || (!!oldOf(x) && oldOf(x).startsWith(`${name}.`))).map((x) => (name.startsWith(`${OLD_BLOCK}.`) ? oldOf(x) : x.name));
    if (r && !r.entry.legacyOnly && !r.entry.container) { changes.push({ op: 'unset', name: r.entry.name, label: name, ...(r.old && legacy ? { spelling: name } : {}) }); given.set(name, r.entry.name); }
    else if (holds.length) errors.push(`${name} holds other settings; unset each setting in it: ${holds.join(', ')}.`);
    // A key under the old block the list does not know is taken out as written, so a stray key can still be removed.
    else if (legacy && name.startsWith(`${OLD_BLOCK}.`)) { changes.push({ op: 'unset-raw', path: name.split('.') }); given.set(name, name); }
    else errors.push(notASetting(name));
  }
  if (errors.length) return { errors };
  const done = write(options, changes);
  if (done.errors) return done;
  const gone = new Set(done.ok.changed);
  const removed = [...given.keys()].filter((n) => gone.has(given.get(n)));
  const lines = removed.length ? [] : ['Nothing to remove: none of those is in the file.'];
  for (const n of removed) {
    const spellings = done.ok.removed.filter((w) => w === n || given.get(n) === w || (resolve(w) && resolve(w).entry.name === given.get(n)));
    lines.push(spellings.length > 1 ? `Removed ${spellings.join(' and ')} (the same setting).` : `Removed ${shownAs(n)}.`);
  }
  return { result: { removed }, lines, notices: noticesFor(names) };
}

// ---- The set-up note ----------------------------------------------------------------------

// The publish set-up guide's note to itself. On the new layout (or none) it is `setup` in the state
// file; on the old layout it is publish.setup_progress in the old settings file, written through the
// same writer, which allows that one state entry for this command only.
const NOTE_NAME = SETUP_NOTE;
const NOTE_PATH = NOTE_NAME.split('.');

function readNote(vaultPath) {
  const note = layoutOf(vaultPath) === 'legacy' ? getPath(rawData(vaultPath), NOTE_PATH) : readState(vaultPath).setup;
  return isMap(note) ? note : null;
}

function writeNote(vaultPath, note) {
  if (layoutOf(vaultPath) !== 'legacy') {
    writeState(vaultPath, { setup: note });
    return;
  }
  const change = note === null ? { op: 'unset', name: NOTE_NAME } : { op: 'set', name: NOTE_NAME, value: note };
  try {
    applyChanges(vaultPath, [change], { allowState: true });
  } catch (e) {
    if (e.refusals) throw new Error(e.refusals[0]);
    throw e;
  }
}

function setupNote(options, args) {
  const [sub, ...rest] = args;
  if (!['get', 'set', 'clear'].includes(sub)) throw new Error('settings setup-note needs get, set or clear.');
  const { vaultPath } = target(options);
  const note = readNote(vaultPath);
  if (sub === 'get') {
    if (rest.length > 1) throw new Error('settings setup-note get takes at most one key.');
    if (rest.length) {
      const value = note && Object.prototype.hasOwnProperty.call(note, rest[0]) ? note[rest[0]] : null;
      return { result: value, lines: [value === null ? `The set-up note has no ${rest[0]}.` : plainValue(value)] };
    }
    const entries = note ? Object.entries(note) : [];
    return { result: note || {}, lines: entries.length ? entries.map(([k, v]) => `${k}: ${plainValue(v)}`) : ['No set-up note.'] };
  }
  if (sub === 'clear') {
    if (rest.length) throw new Error('settings setup-note clear takes no keys.');
    if (note) writeNote(vaultPath, null);
    return { result: {}, lines: [note ? 'Cleared the set-up note.' : 'No set-up note.'] };
  }
  if (!rest.length) throw new Error('settings setup-note set needs at least one key=value.');
  const merged = { ...(note || {}) };
  const errors = [];
  for (const pair of rest) {
    const { name, given, hasValue } = splitPair(pair);
    if (!name) errors.push(`${pair} needs a key, like key=value.`);
    else if (!hasValue || given.trim() === '') errors.push(`${name} needs a value, like ${name}=value.`);
    else merged[name] = valueOf(given);
  }
  if (errors.length) return { errors };
  writeNote(vaultPath, merged);
  return { result: merged, lines: rest.map((p) => `Noted ${splitPair(p).name}.`) };
}

// ---- The move ------------------------------------------------------------------------------

// `--fill name=value` pairs as an object; a pair with no `=` is refused by the plan (its name is not fillable).
function fillOf(pairs) {
  const out = {};
  for (const pair of pairs || []) {
    const { name, given } = splitPair(pair);
    out[name] = given;
  }
  return out;
}

// The site folder an old-layout vault names (player_site.folder), and its vault.config.json: { dir, file, exists }.
// null when the vault is not on the old layout, names no folder, or its settings cannot be read (the plan says so).
function siteFileNamedBy(vaultPath) {
  if (layoutOf(vaultPath) !== 'legacy') return null;
  let raw;
  try {
    raw = getPath(readSettings({ vaultPath, siteConfig: {} }).values, ['player_site', 'folder']);
  } catch {
    return null;
  }
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const dir = require('../lines-cli').siteDirPath(vaultPath, raw);
  const file = path.join(dir, 'vault.config.json');
  return { dir, file, exists: fs.existsSync(file) };
}

function move(options) {
  // The vault is --vault, or the one the site folder's file names. A site file that cannot say is a blocker, not a crash.
  let siteConfigPath = options.config ? path.resolve(options.config) : (options.vault ? null : path.resolve('./vault.config.json'));
  const stopped = (blockers) => ({ result: { ok: false, moved: false, lines: [], blockers, files: { write: [], remove: [] } }, lines: ['Nothing was changed. The move is blocked:', ...blockers.map((b) => `  ${b}`)], rc: 1 });
  let vaultPath;
  if (options.vault) {
    vaultPath = path.resolve(options.vault);
  } else {
    let site;
    try {
      site = JSON.parse(fs.readFileSync(siteConfigPath, 'utf8'));
    } catch (e) {
      return stopped([e.code === 'ENOENT' ? `${siteConfigPath} does not exist.` : `${siteConfigPath} could not be read as JSON: ${firstLine(e)}`]);
    }
    if (!isMap(site) || typeof site.vaultPath !== 'string' || site.vaultPath.trim() === '') return stopped([`${siteConfigPath} has no "vaultPath"`]);
    vaultPath = path.resolve(path.dirname(siteConfigPath), site.vaultPath);
  }
  // With only --vault, the site folder is the one the vault's own settings name; the move must see its file.
  if (!siteConfigPath) {
    const named = siteFileNamedBy(vaultPath);
    if (named && !named.exists) return stopped([`the vault names a site folder at ${named.dir} that cannot be read; give --config or fix the path`]);
    if (named) siteConfigPath = named.file;
  }
  const plan = planMove({ vaultPath, siteConfigPath, fill: fillOf(options.fill) });
  const base = (moved, lines) => ({ ok: plan.ok, moved, lines, blockers: plan.blockers, files: plan.files });
  if (!plan.ok) {
    return { result: base(false, plan.lines), lines: ['Nothing was changed. The move is blocked:', ...plan.blockers.map((b) => `  ${b}`)], rc: 1 };
  }
  if (options.check) {
    const lines = plan.files.remove.length ? ['Nothing was changed (check only). This is what the move will do:', ...plan.lines] : plan.lines;
    return { result: base(false, plan.lines), lines };
  }
  const done = applyMove(plan);
  return { result: base(done.moved, done.lines), lines: done.lines };
}

// ---- The command --------------------------------------------------------------------------

// options: { verb, args, vault, config, json }. Returns the exit code.
function runSettings(options, deps = {}) {
  const out = deps.out || console.log;
  const err = deps.err || console.error;
  try {
    const args = options.args || [];
    if (!VERBS.includes(options.verb)) throw new Error(`settings needs one of ${VERBS.join(', ')}.`);
    let done;
    if (options.verb === 'get') done = get(options, args);
    else if (options.verb === 'set') done = set(options, args);
    else if (options.verb === 'add' || options.verb === 'remove') done = changeList(options, options.verb, args);
    else if (options.verb === 'setup-note') done = setupNote(options, args);
    else if (options.verb === 'move') done = move(options);
    else if (options.verb === 'unset') done = unset(options, args);
    else if (options.verb === 'describe') {
      if (!args[0]) throw new Error('settings describe needs a setting name.');
      done = describe(args[0]);
    } else if (options.verb === 'check') done = check(options);
    else if (options.verb === 'list') done = list();
    else done = raw(options, args[0]);
    if (done.errors) {
      for (const message of done.errors) err(`Error: ${message}`);
      return 1;
    }
    // The notice that an old name is now called something else: on stderr for --json, which is read by a program.
    const notices = done.notices || [];
    if (options.json) {
      for (const line of notices) err(line);
      out(JSON.stringify(done.result, null, 2));
    } else {
      out([...notices, ...done.lines].join('\n'));
    }
    return done.rc || 0;
  } catch (e) {
    err(`Error: ${firstLine(e)}`);
    return 1;
  }
}

module.exports = { runSettings, helpText };
