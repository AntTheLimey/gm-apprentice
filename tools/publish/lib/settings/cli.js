'use strict';
// The `settings` command: reads, writes, describes and checks any setting through the
// declared list. `vault-setting` stays below as an alias for the older tool pins and for
// migrate_site.py; it dies with them in 1b.
//
//   settings get [<name>]            what each setting is, and where that came from
//   settings set <name>=<json> ...   write settings (all or none)
//   settings unset <name> ...        remove settings (all or none)
//   settings describe <name>         what one setting does and takes
//   settings check                   the faults in the file
//   settings list                    every name a GM can set
//   settings raw [<name>]            the file as written
const fs = require('node:fs');
const path = require('node:path');
const { parseNote } = require('../frontmatter');
const { REGISTRY, entry, legacyNameOf, resolve } = require('./registry');
const { TYPES, isMap } = require('./types');
const { readSettings, parseNewFile } = require('./read');
const { OLD_FILE, NEW_FILE, layoutOf, at: fileAt } = require('./layout');
const { makeFault, nearest } = require('./faults');
const { row, isLeaf, defaultOf } = require('./describe');
const { OLD_BLOCK, underBlock } = require('./legacy');

const VERBS = ['get', 'set', 'add', 'remove', 'unset', 'describe', 'check', 'list', 'raw'];
const LEAVES = () => REGISTRY.filter((e) => isLeaf(e, REGISTRY));
const SETTABLE_NAMES = () => LEAVES().map((e) => e.name);
// Removed in Part B: the name the old vault file gave a setting, which the commands still take for
// one release. An old name is answered as the setting it became, with a line naming the new one.
const oldOf = (e) => legacyNameOf(e);
const reaches = (e, scope) => inScope(e.name, scope) || (!!oldOf(e) && inScope(oldOf(e), scope));
const firstLine = (e) => String(e.message).split('\n')[0];

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

// Where the old file holds a setting, as the path under `publish:` (setting_year sits beside it).
const pathOf = (e) => (underBlock(oldOf(e)) ? oldOf(e).split('.').slice(1) : [oldOf(e)]);
// Where the old file holds the thing a name points at, as the full path from the top of the file. A name
// the old file used is taken as it stands (so an older spelling of a setting can be taken out by the
// spelling it was written in); a new name goes to the setting's place in the old file.
const filePathOf = (name, r) => ((r.old || r.entry.legacyOnly) ? name : oldOf(r.entry)).split('.');
const noticeFor = (name) => { const r = resolve(name); return r && r.old ? `${name} is now ${r.entry.name}.` : null; };
const noticesFor = (names) => names.map(noticeFor).filter(Boolean);

const getPath = (obj, segs) => segs.reduce((cur, s) => (isMap(cur) && Object.prototype.hasOwnProperty.call(cur, s) ? cur[s] : undefined), obj);

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

function raw(options, name) {
  const { vaultPath } = target(options);
  const data = rawData(vaultPath);
  const r = name ? resolve(name) : null;
  const newLayout = layoutOf(vaultPath) === 'new';
  const at = r ? (newLayout ? r.entry.name.split('.') : (oldOf(r.entry) ? filePathOf(name, r) : null)) : (name ? name.split('.') : null);
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
gm-apprentice-publish settings <get|set|add|remove|unset|describe|check|list|raw> [...] [--json] [--vault <dir>] [--config <path>]

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

  --vault <dir>    The vault (default: the vaultPath in the config)
  --config <path>  The site folder's vault.config.json (default: ./vault.config.json)
  --json           Print JSON
  --help, -h       Show this help

A setting's old name (publish.search and so on) still works for now; the command says what it is called now.

The settings:
${names.join('\n')}
`;
}

// ---- Writing ------------------------------------------------------------------------------

// Removed when the writer reads the new file (the next step): for now it only edits the old one.
const NEW_LAYOUT_READ_ONLY = 'this vault is on the new settings file; writing it arrives with the next step';
const onNewLayout = (options) => layoutOf(target(options).vaultPath) === 'new';

// A plain reason a name cannot be written, or null.
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
  if (!oldOf(e)) return `${name} needs the new settings file; run the update first.`;
  return null;
}

const BESIDE = (name) => `${name} is written beside ${OLD_BLOCK}: in the file, not under it; add the line by hand.`;

// Turns `name=json` pairs into the leaves to write. { errors } and nothing else when any is refused.
// `plain`: a value that is not JSON is taken as the text written (the settings command); the
// older vault-setting command keeps the strict reading. A leaf's path is where the old file holds it.
function plan(pairs, { plain = false } = {}) {
  const errors = [];
  const leaves = [];
  const written = [];
  const empties = [];
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const name = (at < 0 ? pair : pair.slice(0, at)).trim();
    const why = refusal(name);
    if (why) { errors.push(why); continue; }
    const e = resolve(name).entry;
    if (!underBlock(oldOf(e))) { errors.push(BESIDE(name)); continue; }
    if (at < 0) { errors.push(plain ? `${name} needs a value, like ${name}=value.` : `${name} needs a value, like ${name}='"text"'.`); continue; }
    let value;
    const given = pair.slice(at + 1);
    if (plain && given.trim() === '') { errors.push(`${name} has no value; to take it out of the file, use settings unset ${name}.`); continue; }
    try {
      value = JSON.parse(given);
    } catch {
      if (!plain) {
        errors.push(`The value for ${name} is not written as JSON; put text in quotes, for example ${name}='"text"'.`);
        continue;
      }
      value = given.trim();
    }
    if (Array.isArray(value) && value.some((x) => typeof x === 'string' && x.trim() === '')) {
      errors.push(`${name} has a blank entry; remove it.`);
      continue;
    }
    const read = TYPES[e.type].read(value, e);
    if (!read.ok) { errors.push(makeFault({ name, kind: 'not-allowed', level: 'warn', value, entry: e }).message); continue; }
    const out = e.type === 'text' ? value : read.value;
    const segs = pathOf(e);
    const at2 = leaves.findIndex((l) => l.path.join('.') === segs.join('.'));
    if (at2 >= 0) leaves.splice(at2, 1);
    leaves.push({ path: segs, value: out });
    if (!written.includes(name)) written.push(name);
    if (Array.isArray(out) && out.length === 0 && Array.isArray(e.default) && e.default.length > 0) empties.push(name);
  }
  return errors.length ? { errors } : { leaves, written, empties };
}

// `noun` is what the list holds, from the setting's own entry.
const emptyNote = (name, noun = ((resolve(name) || {}).entry || {}).of || 'entries') => `${name} is empty: nothing from the built-in list is hidden. Add the ${noun} you want hidden, or remove the key to use the built-in list again.`;

function set(options, pairs) {
  if (!pairs.length) throw new Error('settings set needs at least one name=value.');
  if (onNewLayout(options)) return { errors: [NEW_LAYOUT_READ_ONLY] };
  const planned = plan(pairs, { plain: true });
  if (planned.errors) return { errors: planned.errors };
  const { setPublishLeaves } = require('../vault-config-edit');
  setPublishLeaves(target(options).vaultPath, planned.leaves);
  const notes = planned.empties.map((n) => emptyNote(n));
  const result = { written: planned.written, notes };
  return { result, lines: [...planned.written.map((n) => `Wrote ${n}.`), ...notes], notices: noticesFor(planned.written) };
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
  if (onNewLayout(options)) return { errors: [NEW_LAYOUT_READ_ONLY] };
  const why = refusal(name);
  if (why) return { errors: [why] };
  const e = resolve(name).entry;
  const { vaultPath, siteConfig } = target(options);
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
    if (e.same === 'folder') {
      const { normalizeExcludeDir } = require('./legacy');
      v = normalizeExcludeDir(v, vaultPath) ?? '';
    }
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
    const planned = plan([`${name}=${JSON.stringify(list)}`]);
    if (planned.errors) return { errors: planned.errors };
    const { setPublishLeaves } = require('../vault-config-edit');
    setPublishLeaves(vaultPath, planned.leaves);
    result.written = [name];
    if (verb === 'remove') {
      const after = getPath(readSettings({ vaultPath, siteConfig }).values, e.name.split('.')) || [];
      for (const x of result.removed) {
        if (Array.isArray(after) && after.some((a) => isSame(a, x))) result.notes.push(`${JSON.stringify(x)} still applies, because vault.config.json also lists it; remove it there too.`);
        else if (e.guards && Array.isArray(e.default) && e.default.some((d) => isSame(d, x))) result.notes.push(`${JSON.stringify(x)} was built in to ${name} and is no longer hidden.`);
      }
    }
    // Not said when the site file's own entries still hide something.
    const stillApplies = verb === 'remove' && result.notes.some((n) => n.includes(' still applies,'));
    if (!stillApplies) result.notes.push(...planned.empties.map((n) => emptyNote(n)));
  }
  const shown = (xs) => xs.map((x) => JSON.stringify(x)).join(', ');
  const done = verb === 'add' ? result.added : result.removed;
  const other = verb === 'add' ? result.already : result.absent;
  const lines = [];
  if (done.length) lines.push(`${verb === 'add' ? 'Added' : 'Removed'} ${shown(done)} ${verb === 'add' ? 'to' : 'from'} ${name}.`);
  if (other.length) lines.push(`${shown(other)} ${other.length > 1 ? 'were' : 'was'} ${verb === 'add' ? 'already in' : 'not in'} ${name}.`);
  lines.push(...result.notes);
  return { result, lines, notices: noticesFor([name]) };
}

function unset(options, names) {
  if (!names.length) throw new Error('settings unset needs at least one name.');
  if (onNewLayout(options)) return { errors: [NEW_LAYOUT_READ_ONLY] };
  const errors = [];
  // A name the list knows is taken out where the old file holds it; any other key under the old
  // block is taken out as written, so a stray key can still be removed.
  const at = new Map();
  for (const name of names) {
    const r = resolve(name);
    if (r && !oldOf(r.entry)) errors.push(`${name} needs the new settings file; run the update first.`);
    else if (r && filePathOf(name, r)[0] !== OLD_BLOCK) errors.push(BESIDE(name));
    else if (r) at.set(name, filePathOf(name, r).slice(1));
    else if (name.startsWith(`${OLD_BLOCK}.`)) at.set(name, name.split('.').slice(1));
    else errors.push(notASetting(name));
  }
  if (errors.length) return { errors };
  const { vaultPath } = target(options);
  const data = rawData(vaultPath);
  const removed = names.filter((n, i) => names.indexOf(n) === i && getPath(data, [OLD_BLOCK, ...at.get(n)]) !== undefined);
  if (removed.length) {
    const { removePublishLeaves } = require('../vault-config-edit');
    removePublishLeaves(vaultPath, removed.map((n) => at.get(n)));
  }
  return { result: { removed }, lines: removed.length ? removed.map((n) => `Removed ${n}.`) : ['Nothing to remove: none of those is in the file.'], notices: noticesFor(names) };
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

// ---- The older `vault-setting` command ---------------------------------------------------

// The thirteen keys the older command printed, built from the file as written. migrate_site.py
// and older pinned site tools call it; both move to `settings` in 1b.
function aliasRead(options) {
  const { vaultPath, siteConfig } = target(options);
  const publish = getPath(rawData(vaultPath), [OLD_BLOCK]);
  const file = isMap(publish) ? publish : {};
  const asked = isMap(file.theme) ? file.theme : {};
  const askedFonts = isMap(asked.fonts) ? asked.fonts : {};
  const asString = (v) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    excludeSectionsOwn: Array.isArray(file.exclude_sections) || Array.isArray(siteConfig.excludeSections),
    excludeFieldsOwn: Array.isArray(file.exclude_fields) || Array.isArray(siteConfig.excludeFields),
    defaultExcludeSections: [...entry('player_site.hide.sections').default],
    defaultExcludeFields: [...entry('player_site.hide.fields').default],
    defaultModeSet: asked.default_mode !== undefined && asked.default_mode !== null,
    fontSource: askedFonts.source || null,
    googleFonts: require('../fonts').googleFontsFor(vaultPath, siteConfig),
    sheetSkin: asString(file.sheet_skin),
    sheetFrame: asString(file.sheet_frame),
    dndbeyondSync: asString(file.dndbeyond_sync),
    linkPreviews: asString(file.link_previews),
    tohitCalculator: asString(file.tohit_calculator),
    connections: asString(file.connections),
  };
}

function runVaultSetting(options, deps = {}) {
  const out = deps.out || console.log;
  const err = deps.err || console.error;
  try {
    let result;
    if (options.set && options.set.length) {
      if (onNewLayout(options)) { err(`Error: ${NEW_LAYOUT_READ_ONLY}`); return 1; }
      const planned = plan(options.set.map((p) => `${OLD_BLOCK}.${p}`));
      if (planned.errors) {
        for (const message of planned.errors) err(`Error: ${message}`);
        return 1;
      }
      const { setPublishLeaves } = require('../vault-config-edit');
      setPublishLeaves(target(options).vaultPath, planned.leaves);
      const bare = (n) => n.slice(OLD_BLOCK.length + 1);
      result = { written: planned.written.map(bare) };
      if (planned.empties.length) result.notes = planned.empties.map((n) => emptyNote(bare(n), 'headings or fields'));
    } else {
      result = aliasRead(options);
    }
    out(options.json ? JSON.stringify(result, null, 2) : Object.entries(result).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n'));
    return 0;
  } catch (e) {
    err(`Error: ${firstLine(e)}`);
    return 1;
  }
}

module.exports = { runSettings, runVaultSetting, helpText };
