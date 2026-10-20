'use strict';
// readSettings: reads a vault's settings against the declared list, from whichever layout the
// vault is on (layout.js says which): the new file read here, the old one read by legacy.js. It
// returns values and origins under the list's names, the faults, each with `name` (as written in
// the file) and `setting` (the list's name, or null), `layout`, and `file`. It prints nothing and
// throws only for a file that is not valid YAML or was written by a newer gm-apprentice.
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('yaml');
const { REGISTRY, NOT_PER_SITE, legacyNameOf, siteKeyOf } = require('./registry');
const { TYPES, isMap, getPath, setIn, emptyIsFault } = require('./types');
const { nearest, makeFault, saysHiding: saysHidingName, hidingLasts, startsLikeHide, show } = require('./faults');
const { NEW_FILE, OLD_FILE, layoutOf, at, GROUPS, GM_GROUP, STRICT_PARENTS, stopsUnknown } = require('./layout');
const legacy = require('./legacy');
const { entryFaults } = require('./entry-faults');
const { normalizeExcludeDirs, outputProblem, keepProblem, tidyChecked, sameChecked } = require('./folders');

const LAYOUT_VERSION = 1;
const NEWER_VERSION = "this vault's settings were written by a newer gm-apprentice; update the plugin";
const MAP_ENTRY = { type: 'map', shape: 'settings, one to a line' };
const TOP = ['version', ...GROUPS];

// ---- Shared by both layouts ---------------------------------------------------------------

const clone = (v) => (v !== null && typeof v === 'object' ? structuredClone(v) : v);

function unsetIn(obj, name) {
  const segs = name.split('.');
  let cur = obj;
  for (const s of segs.slice(0, -1)) {
    if (!isMap(cur[s])) return;
    cur = cur[s];
  }
  delete cur[segs[segs.length - 1]];
}

// Reads one chosen raw value `first` ({ raw, origin }) of entry `e` and records it under `setting`
// (the list's name): the value, its origin, and a fault named `written` when it cannot be read.
// `c` is { values, origins, faults, fault } where `fault` makes a fault; `defaultOf(e)` is the
// value the entry takes when unset.
// The rules a value must meet beyond its type (an entry's `check`); each returns why it cannot be used, or null.
const CHECKS = { output: (value, c) => outputProblem(value, c.siteDir), keep: (value) => keepProblem(value) };

function settle(c, e, { written, setting }, first, defaultOf) {
  const { values, origins, faults, fault } = c;
  // A list of maps is read entry by entry: one that cannot be used is left out alone, with a warning naming it.
  const each = TYPES[e.type].readEach ? TYPES[e.type].readEach(first.raw, e) : null;
  let r = each ? { ok: true, value: each.value } : TYPES[e.type].read(first.raw, e);
  if (each) {
    for (const d of each.dropped) {
      const who = d.label ? `"${d.label}"` : `entry ${d.index + 1}`;
      faults.push(fault({ name: written, setting, kind: 'dropped', level: 'warn', value: null, message: `${written} ${who} ${d.why}; it is left out` }));
    }
  }
  const problem = r.ok && e.check ? CHECKS[e.check](r.value, c) : null;
  if (problem) r = { ok: false, problem };
  else if (r.ok && e.check) r = { ok: true, value: tidyChecked(e.check, r.value) };
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
    const shown = first.shown !== undefined ? first.shown : first.raw;
    faults.push(fault({
      name: written, setting, kind: 'not-allowed', level: e.guards || e.stopOnFault ? 'stop' : 'warn', value: shown, entry: e,
      // A value from the site folder's file says so: the GM fixes it there, not in the vault's settings.
      ...(first.origin === 'site-file'
        ? { hint: `${written} in the site folder's vault.config.json is ${shown === null ? 'empty' : show(shown)}; ${problem || `it takes ${TYPES[e.type].takes(e)}`}.` }
        : problem ? { hint: `${written} is ${show(shown)}; ${problem}.` } : {}),
    }));
  }
  return r;
}

// A setting that is also a key of the site folder's file (the entry's `siteFallback`): the key and the value the
// site file holds, or undefined when it holds none (a null is none).
function siteValueOf(site, e) {
  const key = siteKeyOf(e);
  return key !== null && site[key] !== undefined && site[key] !== null ? { key, raw: site[key] } : undefined;
}

const core = { settle, getPath, setIn, clone, emptyIsFault, MAP_ENTRY, siteValueOf };

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

// The settings an unknown block holds, found for the Settings check to fix one by one: for the old `publish:` block
// by the names the list remembers (`was`), for any other stray map (a misplaced group) by the longest end of the
// path that names exactly one setting (`features.hide.drafts` is `hide.drafts`, which is player_site.hide.drafts).
// Returns [{ written: 'publish.exclude_sections', entry, value }]. Anything that names no setting is left out; the
// block's own fault still says the block is wrong.
const SETTING_LEAVES = LIST.filter((e) => !e.container && !e.twinOf && !hasChildren(e.name));
const OLD_VAULT_NAMES = new Map(SETTING_LEAVES.flatMap((e) => (e.was || []).filter((w) => w.in === 'vault' && w.read !== false).map((w) => [w.name, e])));
function strayLeaves(block, prefix, byOldName) {
  const found = [];
  const walkStray = (map, path) => {
    for (const [k, value] of Object.entries(map)) {
      const here = [...path, String(k)];
      const written = `${prefix}.${here.join('.')}`;
      let entry = null;
      if (byOldName) {
        entry = OLD_VAULT_NAMES.get(written) || null;
      } else {
        for (let i = 0; i < here.length && !entry; i++) {
          const tail = here.slice(i).join('.');
          const hits = SETTING_LEAVES.filter((e) => e.name === tail || e.name.endsWith(`.${tail}`));
          if (hits.length === 1) entry = hits[0];
        }
      }
      if (entry) found.push({ written, entry, value });
      else if (isMap(value)) walkStray(value, here);
    }
  };
  walkStray(block, []);
  return found;
}

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

function readNew({ vaultPath, siteConfig, siteDir }) {
  const faults = [];
  const file = { path: at(vaultPath, NEW_FILE), exists: true, hasSiteBlock: false, leftover: fs.existsSync(at(vaultPath, OLD_FILE)) };
  const tree = parseNewFile(vaultPath);
  file.hasSiteBlock = isMap(tree.player_site);
  const values = {};
  const origins = {};
  const fault = makeFault;
  const c = { values, origins, faults, fault, vaultPath, siteDir };

  if (file.leftover) {
    faults.push(makeFault({ name: OLD_FILE, setting: null, kind: 'dropped', level: 'warn', message: `${OLD_FILE} is left over from before the update and is not read` }));
  }
  // A setting still written in the site folder's vault.config.json is not read any more.
  const site = isMap(siteConfig) ? siteConfig : {};
  for (const e of LIST) {
    // The site folder's own five keys are read below, while the vault sets none.
    if (e.siteFallback) continue;
    for (const w of (e.was || []).filter((x) => x.in === 'site' && !x.carryOnly)) {
      const value = getPath(site, w.name.split('.'));
      if (value === undefined) continue;
      // A list that hides things, left in the site folder, would publish what it meant to hide: it stops the build.
      faults.push(makeFault({ name: w.name, setting: e.name, kind: 'old-name', level: e.guards ? 'stop' : 'warn', value, use: e.name, source: 'site',
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
    // A retired name is read by nothing: warned when written, never in the values.
    if (e.retired) {
      if (raw != null) faults.push(makeFault({ name: e.name, setting: null, kind: 'retired', level: 'warn', value: raw, entry: e }));
      continue;
    }
    // A twin the file does not set is not in `values`: the GM site takes the player site's value (resolve.js).
    if (e.twinOf && (raw === undefined || (raw === null && !emptyIsFault(e)))) {
      origins[e.name] = 'inherit';
      continue;
    }
    const fromSite = e.siteFallback ? siteValueOf(site, e) : undefined;
    if (raw === undefined || (raw === null && !emptyIsFault(e))) {
      if (fromSite) {
        // The vault sets none and the site folder's file still holds one: it is used until the next update moves it.
        settle(c, e, { written: fromSite.key, setting: e.name }, { raw: fromSite.raw, origin: 'site-file' }, defaultOf);
        faults.push(makeFault({ name: fromSite.key, setting: e.name, kind: 'dropped', level: 'warn', value: fromSite.raw, use: e.name, source: 'site', siteLeft: true,
          message: `\`${fromSite.key}\` in the site folder's vault.config.json moves to \`${e.name}\` at the next update` }));
        continue;
      }
      setIn(values, e.name, defaultOf(e));
      origins[e.name] = 'default';
      continue;
    }
    settle(c, e, { written: e.name, setting: e.name }, { raw, origin: 'file' }, defaultOf);
    // A twin that cannot be read takes the player site's value, as one that is not set does.
    if (e.twinOf && origins[e.name] === 'fault') unsetIn(values, e.name);
    if (fromSite && !sameChecked(e.check, fromSite.raw, raw, c.siteDir)) {
      faults.push(makeFault({ name: fromSite.key, setting: e.name, kind: 'dropped', level: 'warn', value: fromSite.raw, use: e.name, source: 'site', siteDiffers: true, ...(e.check ? { checks: e.check } : {}),
        message: `\`${fromSite.key}\` in the site folder's vault.config.json (${show(fromSite.raw)}) differs from \`${e.name}\` in the vault's settings (${show(raw)}); the vault's is used` }));
    }
  }

  // What the file holds, against the list.
  function unknown(parent, key, value) {
    const full = `${parent}.${key}`;
    const old = oldNameIn(parent, key);
    if (old) {
      faults.push(makeFault({ name: full, setting: old.name, kind: 'old-name', level: old.guards ? 'stop' : 'warn', value, use: old.name }));
      return;
    }
    // A setting both sites share cannot be written for the GM site alone: a warning naming the one place it is set.
    const shared = parent.startsWith(`${GM_GROUP}.`) || parent === GM_GROUP ? `player_site${parent.slice(GM_GROUP.length)}.${key}` : null;
    if (shared && NOT_PER_SITE.has(shared)) {
      faults.push(makeFault({ name: full, setting: null, kind: 'gm-not-per-site', level: 'warn', value, message: `${full} cannot be set for the GM site alone: ${shared} is the same for both sites` }));
      return;
    }
    const isGuard = (seg) => !!(KNOWN.get(`${parent}.${seg}`) || {}).guards;
    const near = nearest(key, childSegs(parent));
    const hidingNear = nearest(key, childSegs(parent).filter(isGuard));
    const strict = stopsUnknown(parent);
    let level = 'warn';
    // The GM site hides nothing from players: a fault under it never stops the player build.
    const gm = parent === GM_GROUP || parent.startsWith(`${GM_GROUP}.`);
    if (!gm && (strict || (near && isGuard(near)) || saysHiding(key))) level = 'stop';
    // A stop below the top points at a hiding setting only; a warning, or a stop at the top, at the nearest name of any kind.
    let suggest = level === 'stop' && !strict ? hidingNear : near;
    if (startsLikeHide(key) && !strict) suggest = null;
    faults.push(makeFault({ name: full, setting: null, kind: 'unknown-name', level, value, suggest: suggest ? `${parent}.${suggest}` : null }));
    // A group in the wrong place: each setting inside it that has one right place, for the Settings check to carry.
    if (isMap(value)) {
      for (const s of strayLeaves(value, full, false)) {
        faults.push(makeFault({ name: s.written, setting: s.entry.name, kind: 'unknown-name', level: s.entry.guards && !gm ? 'stop' : level, value: s.value, suggest: s.entry.name }));
      }
    }
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
    if (GROUPS.includes(key)) {
      if (value == null) continue;
      if (!isMap(value)) {
        faults.push(makeFault({ name: key, setting: null, kind: 'not-allowed', level: key === GM_GROUP ? 'warn' : 'stop', value, entry: MAP_ENTRY }));
        continue;
      }
      walk(key, value);
      continue;
    }
    if (key === legacy.OLD_BLOCK) {
      faults.push(makeFault({ name: key, setting: null, kind: 'unknown-name', level: 'stop', value, hint: `this file uses the new names; ${key} is the old block` }));
      // Each setting in it that has a place in the new file, so the Settings check can move it there.
      if (isMap(value)) for (const s of strayLeaves(value, key, true)) faults.push(makeFault({ name: s.written, setting: s.entry.name, kind: 'old-name', level: 'stop', value: s.value, use: s.entry.name }));
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
    // A group out of place: each setting in it that has one right place.
    if (isMap(value)) for (const s of strayLeaves(value, key, false)) faults.push(makeFault({ name: s.written, setting: s.entry.name, kind: 'unknown-name', level: 'stop', value: s.value, suggest: s.entry.name }));
  }

  return { values, origins, faults, layout: 'new', file };
}

// ---- The entry point ----------------------------------------------------------------------

function readSettings({ vaultPath, siteConfig = {}, siteDir }) {
  const site = siteConfig || {};
  const layout = layoutOf(vaultPath);
  const read = layout === 'new' ? readNew({ vaultPath, siteConfig: site, siteDir }) : { ...legacy.readLegacy({ vaultPath, siteConfig: site, siteDir }, core), layout };
  read.faults.push(...entryFaults(vaultPath, read.values, read.origins));
  return read;
}

// The settings as the OLD layout reads them, whatever files the vault has: for the move, which compares the old
// files with the new one. `skipOldFile` reads the site folder's file alone.
function readOldLayout({ vaultPath, siteConfig = {}, skipOldFile = false }) {
  return { ...legacy.readLegacy({ vaultPath, siteConfig: siteConfig || {}, skipOldFile }, core), layout: 'legacy' };
}

module.exports = { readSettings, readOldLayout, parseNewFile, LAYOUT_VERSION, NEWER_VERSION };
