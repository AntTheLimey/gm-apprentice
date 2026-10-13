'use strict';
// readSettings: reads a vault's settings against the declared list, from whichever layout the
// vault is on (layout.js says which): the new file read here, the old one read by legacy.js. It
// returns values and origins under the list's names, the faults, each with `name` (as written in
// the file) and `setting` (the list's name, or null), `layout`, and `file`. It prints nothing and
// throws only for a file that is not valid YAML or was written by a newer gm-apprentice.
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('yaml');
const { REGISTRY, legacyNameOf } = require('./registry');
const { TYPES, isMap, getPath, emptyIsFault } = require('./types');
const { nearest, makeFault, saysHiding: saysHidingName, hidingLasts, startsLikeHide } = require('./faults');
const { NEW_FILE, OLD_FILE, layoutOf, at, GROUPS, GM_GROUP, STRICT_PARENTS, stopsUnknown } = require('./layout');
const legacy = require('./legacy');
const { normalizeExcludeDirs } = require('./folders');

const LAYOUT_VERSION = 1;
const NEWER_VERSION = "this vault's settings were written by a newer gm-apprentice; update the plugin";
const MAP_ENTRY = { type: 'map', shape: 'settings, one to a line' };
const TOP = ['version', ...GROUPS];

// ---- Shared by both layouts ---------------------------------------------------------------

const clone = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v);
function setIn(obj, name, value) {
  const segs = name.split('.');
  let cur = obj;
  for (const s of segs.slice(0, -1)) {
    if (!isMap(cur[s])) cur[s] = {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

// Reads one chosen raw value `first` ({ raw, origin }) of entry `e` and records it under `setting`
// (the list's name): the value, its origin, and a fault named `written` when it cannot be read.
// `c` is { values, origins, faults, fault } where `fault` makes a fault; `defaultOf(e)` is the
// value the entry takes when unset.
function settle(c, e, { written, setting }, first, defaultOf) {
  const { values, origins, faults, fault } = c;
  const r = TYPES[e.type].read(first.raw, e);
  // A list of folders is tidied here for both layouts (the scanner compares exact vault-relative paths).
  if (r.ok && e.same === 'folder' && Array.isArray(r.value)) {
    r.value = normalizeExcludeDirs(r.value, c.vaultPath, (message) => faults.push(fault({ name: written, setting, kind: 'dropped', level: 'warn', value: null, message })), written);
  }
  if (r.ok) {
    setIn(values, setting, r.value);
    origins[setting] = first.origin;
    if (e.keys && isMap(r.value)) {
      for (const k of Object.keys(r.value).filter((k) => !e.keys.includes(k))) {
        const near = nearest(k, e.keys);
        faults.push(fault({ name: `${written}.${k}`, setting: null, kind: 'unknown-name', level: 'warn', value: r.value[k], suggest: near ? `${written}.${near}` : null }));
      }
    }
  } else {
    const kept = e.keepOnFault ? (typeof first.raw === 'string' && first.raw.trim() !== '' ? first.raw : defaultOf(e)) : undefined;
    setIn(values, setting, kept !== undefined ? kept : (e.onFault !== undefined ? e.onFault : defaultOf(e)));
    origins[setting] = 'fault';
    // `shown` is the value as the file wrote it, when what was read is that value merged with another file's.
    faults.push(fault({ name: written, setting, kind: 'not-allowed', level: e.guards ? 'stop' : 'warn', value: first.shown !== undefined ? first.shown : first.raw, entry: e }));
  }
  return r;
}

const core = { settle, getPath, setIn, clone, emptyIsFault, MAP_ENTRY };

// ---- The new layout -----------------------------------------------------------------------

const LIST = REGISTRY.filter((e) => !e.legacyOnly);
const BY_NAME = new Map(LIST.map((e) => [e.name, e]));
const PARENT = Symbol('parent');
const KNOWN = new Map(BY_NAME);
for (const e of LIST) {
  const segs = e.name.split('.');
  for (let i = 1; i < segs.length; i++) {
    const p = segs.slice(0, i).join('.');
    if (!KNOWN.has(p)) KNOWN.set(p, PARENT);
  }
}
const hasChildren = (name) => LIST.some((e) => e.name.startsWith(`${name}.`));
const guardsBelow = (name) => LIST.some((e) => e.guards && (e.name === name || e.name.startsWith(`${name}.`)));
const parentOf = (name) => name.split('.').slice(0, -1).join('.');
const lastOf = (name) => name.split('.').pop();

// The names directly under `parent` that the list holds.
function childSegs(parent) {
  const out = [];
  for (const name of KNOWN.keys()) {
    const rest = name.startsWith(`${parent}.`) ? name.slice(parent.length + 1) : null;
    if (rest && !rest.includes('.')) out.push(rest);
  }
  return out;
}

const GUARD_LASTS = hidingLasts(LIST.filter((e) => e.guards).map((e) => e.name));
const saysHiding = (key) => saysHidingName(key, GUARD_LASTS);

// Old names (the last part of each `was` name) and the setting each belongs to: an old name written
// in the new file, directly under the group or map that holds the setting now, is told its new name.
const OLD_LASTS = LIST.flatMap((e) => (e.was || []).map((w) => ({ last: lastOf(w.name), e })));
function oldNameIn(parent, key) {
  const found = OLD_LASTS.filter((o) => o.last === key && `${parentOf(o.e.name)}.`.startsWith(`${parent}.`));
  found.sort((a, b) => parentOf(a.e.name).length - parentOf(b.e.name).length);
  return found.length ? found[0].e : null;
}

const GM_SITE_NOTE = 'the GM site is not built yet; nothing under gm_site is read';

// The new file as written, as plain data. {} for an empty file; throws for one that is not valid YAML.
function parseNewFile(vaultPath) {
  const doc = parseDocument(fs.readFileSync(at(vaultPath, NEW_FILE), 'utf-8'));
  if (doc.errors.length) {
    throw new Error(`${NEW_FILE} is not valid YAML: ${String(doc.errors[0].message).split('\n')[0].trim().replace(/:$/, '')}`);
  }
  const parsed = doc.toJS();
  if (parsed !== null && !isMap(parsed)) throw new Error(`${NEW_FILE} must hold settings written as name: value`);
  return parsed || {};
}

function readNew({ vaultPath, siteConfig }) {
  const faults = [];
  const file = { path: at(vaultPath, NEW_FILE), exists: true, hasSiteBlock: false, leftover: fs.existsSync(at(vaultPath, OLD_FILE)) };
  const tree = parseNewFile(vaultPath);
  file.hasSiteBlock = isMap(tree.player_site);
  const values = {};
  const origins = {};
  const fault = makeFault;
  const c = { values, origins, faults, fault, vaultPath };

  if (file.leftover) {
    faults.push(makeFault({ name: OLD_FILE, setting: null, kind: 'dropped', level: 'warn', message: `${OLD_FILE} is left over from before the update and is not read` }));
  }
  // A setting still written in the site folder's vault.config.json is not read any more.
  const site = isMap(siteConfig) ? siteConfig : {};
  for (const e of LIST) {
    for (const w of (e.was || []).filter((x) => x.in === 'site')) {
      const value = getPath(site, w.name.split('.'));
      if (value === undefined) continue;
      // A list that hides things, left in the site folder, would publish what it meant to hide: it stops the build.
      faults.push(makeFault({ name: w.name, setting: e.name, kind: 'old-name', level: e.guards ? 'stop' : 'warn', value, use: e.name,
        hint: e.guards
          ? `${w.name} in the site folder's vault.config.json is no longer read, so what it hides would be published; put its entries under ${e.name} in the vault's settings.`
          : `${w.name} in the site folder's vault.config.json is no longer read; it is ${e.name} in the vault's settings.` }));
    }
  }

  // The layout's number.
  if (tree.version !== undefined) {
    const v = TYPES.number.read(tree.version, { integer: true, min: 1 });
    if (typeof tree.version !== 'number' || !v.ok) {
      faults.push(makeFault({ name: 'version', setting: null, kind: 'not-allowed', level: 'stop', value: tree.version, entry: { type: 'number', integer: true, min: 1 } }));
    } else if (v.value > LAYOUT_VERSION) {
      throw new Error(NEWER_VERSION);
    }
  }

  // Every setting that holds a value of its own.
  const defaultOf = (e) => {
    if (e.onWhenSet) { const held = getPath(tree, e.onWhenSet.split('.')); return typeof held === 'string' && held.trim() !== ''; }
    if (e.defaultFromVaultFolder) return path.basename(path.resolve(vaultPath));
    return e.default === undefined ? null : clone(e.default);
  };
  for (const e of LIST) {
    if (e.container || hasChildren(e.name)) continue;
    const raw = getPath(tree, e.name.split('.'));
    if (raw === undefined || (raw === null && !emptyIsFault(e))) {
      setIn(values, e.name, defaultOf(e));
      origins[e.name] = 'default';
      continue;
    }
    settle(c, e, { written: e.name, setting: e.name }, { raw, origin: 'file' }, defaultOf);
  }

  // What the file holds, against the list.
  function unknown(parent, key, value) {
    const full = `${parent}.${key}`;
    const old = oldNameIn(parent, key);
    if (old) {
      faults.push(makeFault({ name: full, setting: old.name, kind: 'old-name', level: old.guards ? 'stop' : 'warn', value, use: old.name }));
      return;
    }
    const isGuard = (seg) => !!(KNOWN.get(`${parent}.${seg}`) || {}).guards;
    const near = nearest(key, childSegs(parent));
    const hidingNear = nearest(key, childSegs(parent).filter(isGuard));
    const strict = stopsUnknown(parent);
    let level = 'warn';
    if (strict || (near && isGuard(near)) || saysHiding(key)) level = 'stop';
    // A stop below the top points at a hiding setting only; a warning, or a stop at the top, at the nearest name of any kind.
    let suggest = level === 'stop' && !strict ? hidingNear : near;
    if (startsLikeHide(key) && !strict) suggest = null;
    faults.push(makeFault({ name: full, setting: null, kind: 'unknown-name', level, value, suggest: suggest ? `${parent}.${suggest}` : null }));
    if (!STRICT_PARENTS.has(parent)) setIn(values, full, clone(value));
  }
  function walk(parent, map) {
    for (const [rawKey, value] of Object.entries(map)) {
      const key = String(rawKey);
      const full = `${parent}.${key}`;
      const known = KNOWN.get(full);
      if (!known) { unknown(parent, key, value); continue; }
      if (known !== PARENT && !known.container && !hasChildren(full)) continue;
      if (value == null) continue;
      if (!isMap(value)) {
        const own = known !== PARENT;
        faults.push(makeFault({ name: full, setting: own ? known.name : null, kind: 'not-allowed', level: guardsBelow(full) ? 'stop' : 'warn', value, entry: own ? known : MAP_ENTRY }));
        continue;
      }
      walk(full, value);
    }
  }
  for (const [rawKey, value] of Object.entries(tree)) {
    const key = String(rawKey);
    if (key === 'version') continue;
    if (key === GM_GROUP) {
      if (value !== null && !(isMap(value) && Object.keys(value).length === 0)) {
        faults.push(makeFault({ name: 'gm_site', setting: null, kind: 'dropped', level: 'warn', message: GM_SITE_NOTE }));
      }
      continue;
    }
    if (GROUPS.includes(key)) {
      if (value == null) continue;
      if (!isMap(value)) {
        faults.push(makeFault({ name: key, setting: null, kind: 'not-allowed', level: 'stop', value, entry: MAP_ENTRY }));
        continue;
      }
      walk(key, value);
      continue;
    }
    if (key === legacy.OLD_BLOCK) {
      faults.push(makeFault({ name: key, setting: null, kind: 'unknown-name', level: 'stop', value, hint: `this file uses the new names; ${key} is the old block` }));
      continue;
    }
    // A setting the old file kept at its top level (beside `publish:`), written there in the new file.
    const topOld = LIST.find((x) => legacyNameOf(x) === key);
    if (topOld) {
      faults.push(makeFault({ name: key, setting: topOld.name, kind: 'old-name', level: 'warn', value, use: topOld.name }));
      continue;
    }
    const near = nearest(key, TOP);
    faults.push(makeFault({ name: key, setting: null, kind: 'unknown-name', level: 'stop', value, suggest: near }));
  }

  return { values, origins, faults, layout: 'new', file };
}

// ---- The entry point ----------------------------------------------------------------------

function readSettings({ vaultPath, siteConfig = {} }) {
  const site = siteConfig || {};
  const layout = layoutOf(vaultPath);
  if (layout === 'new') return readNew({ vaultPath, siteConfig: site });
  return { ...legacy.readLegacy({ vaultPath, siteConfig: site }, core), layout };
}

module.exports = { readSettings, parseNewFile, LAYOUT_VERSION, NEWER_VERSION };
