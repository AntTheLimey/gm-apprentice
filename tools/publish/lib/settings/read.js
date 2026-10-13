'use strict';
// readSettings: walks a vault's settings file (and the site's vault.config.json, where it
// still holds settings) against the declared list. It returns values, where each came from,
// and the faults. It prints nothing and throws only for a file that is not valid YAML.
const fs = require('node:fs');
const path = require('node:path');
const { parseNote } = require('../frontmatter');
const { REGISTRY } = require('./registry');
const { TYPES, isMap } = require('./types');
const { nearest, makeFault } = require('./faults');
const { mergeWithSiteFile, movedKeys } = require('./site-file');

const PUBLISH = 'publish';
const PARENT = Symbol('parent');
// A key written with nothing after it is "not set", except on these, where it is unreadable.
const EMPTY_IS_FAULT = new Set(['publish.site', 'publish.character_sheets', 'publish.live_stats', 'publish.inbox']);
// A name directly under `publish` that says it hides something must never be ignored quietly.
const HIDING_PREFIXES = ['exclude', 'hid'];
// The last part of each hiding setting's name (exclude_sections, mode, fields, ...): a key called
// exactly that, anywhere under `publish`, is a hiding setting in the wrong place.
const GUARD_LASTS = new Set(REGISTRY.filter((e) => e.guards).map((e) => e.name.split('.').pop()));
// `mode` is left out: it is also an everyday word (a colour mode under `theme`), and stopping on it would be a false alarm.
const guardLast = (key) => GUARD_LASTS.has(key) && key !== 'mode';
const saysHiding = (key) => guardLast(key) || HIDING_PREFIXES.some((p) => key.toLowerCase().startsWith(p));
// Beside `publish:` (the left edge of the frontmatter) the same slip is looked for.
const saysHidingBeside = (key) => guardLast(key) || key.startsWith('exclude_');
const MAP_ENTRY = { type: 'map', shape: 'settings, one to a line' };

const BY_NAME = new Map(REGISTRY.map((e) => [e.name, e]));
const hasChildren = (name) => REGISTRY.some((e) => e.name.startsWith(`${name}.`));

// Every name the list knows, with the parent paths between them (theme, theme.fonts, ...).
const KNOWN = new Map(BY_NAME);
for (const e of REGISTRY) {
  const segs = e.name.split('.');
  for (let i = 2; i < segs.length; i++) {
    const p = segs.slice(0, i).join('.');
    if (!KNOWN.has(p)) KNOWN.set(p, PARENT);
  }
}
// Old names written under `publish:` in the vault file, each with the setting that replaced it.
const OLD_PATHS = new Map(REGISTRY.flatMap((e) => (e.oldNames || []).filter((o) => o.name.startsWith('publish.')).map((o) => [o.name, e.name])));

function childSegs(parent) {
  const out = [];
  for (const [name, e] of KNOWN) {
    const rest = name.startsWith(`${parent}.`) ? name.slice(parent.length + 1) : null;
    if (!rest || rest.includes('.')) continue;
    if (e !== PARENT && (e.retired || e.state || (e.container && !e.json))) continue;
    out.push(rest);
  }
  return out;
}

const getPath = (obj, segs) => {
  let cur = obj;
  for (const s of segs) {
    if (!isMap(cur) || !Object.prototype.hasOwnProperty.call(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
};
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

function readSettings({ vaultPath, siteConfig = {} }) {
  const site = siteConfig || {};
  const faults = [];
  const file = { exists: false, hasPublish: false, inline: false };
  let data = {};
  const configFile = path.join(vaultPath, '_meta', 'vault-config.md');
  if (fs.existsSync(configFile)) {
    file.exists = true;
    const text = fs.readFileSync(configFile, 'utf-8');
    try {
      ({ data } = parseNote(text));
    } catch (e) {
      // One line, naming the file: js-yaml's message ends in a code excerpt.
      throw new Error(`_meta/vault-config.md frontmatter is not valid YAML: ${String(e.message).split('\n')[0].trim().replace(/:$/, '')}`);
    }
    data = data || {};
    file.inline = /^publish:[ \t]*\{/m.test(text);
  }
  const publish = isMap(data.publish) ? data.publish : {};
  file.hasPublish = isMap(data.publish);
  if (data.publish && !isMap(data.publish)) {
    faults.push(makeFault({ name: PUBLISH, kind: 'not-allowed', level: 'warn', value: data.publish, entry: MAP_ENTRY }));
  }

  // exclude_callouts is merged "stricter wins" between the two files, so each side is turned
  // into on, off or a list first: a vault `no` must not count as text that hides.
  const calloutsEntry = BY_NAME.get('publish.exclude_callouts');
  const asRead = (v) => { const r = TYPES[calloutsEntry.type].read(v, calloutsEntry); return r.ok ? r.value : v; };
  const mergeVault = { ...publish };
  if (mergeVault.exclude_callouts != null) mergeVault.exclude_callouts = asRead(mergeVault.exclude_callouts);
  const mergeSite = { ...site };
  if (mergeSite.excludeCallouts != null) mergeSite.excludeCallouts = asRead(mergeSite.excludeCallouts);

  const merge = mergeWithSiteFile(mergeVault, mergeSite, vaultPath);
  const { picked, legacy, from } = merge;
  const movedNames = new Set(movedKeys().map((e) => e.publish));
  for (const text of merge.dropped) {
    faults.push(makeFault({ name: 'publish.exclude_dirs', kind: 'dropped', level: 'warn', value: null, message: text }));
  }

  // Where a name's value is written: the merged moved key, else the vault file.
  function rawAt(name) {
    if (name === 'setting_year') return data.setting_year;
    const segs = name.split('.').slice(1);
    if (movedNames.has(segs[0])) return segs.length === 1 ? picked[segs[0]] : getPath(picked[segs[0]], segs.slice(1));
    return getPath(publish, segs);
  }
  function originAt(name) {
    const segs = name.split('.').slice(1);
    if (!movedNames.has(segs[0])) return 'file';
    if (segs.length === 1) return from[segs[0]] || 'file';
    return getPath(publish, segs) !== undefined ? 'file' : 'site-file';
  }

  const values = {};
  const origins = {};
  const defaultOf = (e) => {
    if (e.name === 'publish.site') return typeof publish.site_dir === 'string' && publish.site_dir.trim() !== '';
    return e.default === undefined ? null : clone(e.default);
  };
  const fallbackOf = (e) => (e.onFault !== undefined ? e.onFault : defaultOf(e));
  const notAllowed = (e, raw) => makeFault({ name: e.name, kind: 'not-allowed', level: e.guards ? 'stop' : 'warn', value: raw, entry: e });

  function readEntry(e) {
    const sources = [{ raw: rawAt(e.name), origin: originAt(e.name) }];
    const reportOnly = [];
    for (const o of e.oldNames || []) {
      const raw = o.in === 'site' ? getPath(site, o.name.split('.')) : rawAt(o.name);
      (o.read === false ? reportOnly : sources).push({ raw, origin: 'old-name', old: o });
    }
    const isSet = (s) => s.raw !== undefined && !(s.raw === null && !EMPTY_IS_FAULT.has(e.name));
    const set = sources.filter(isSet);
    // An old name is always reported; its value is read only unless the registry says `read: false`.
    for (const s of [...set, ...reportOnly.filter(isSet)]) {
      if (s.old) faults.push(makeFault({ name: s.old.name, kind: 'old-name', level: 'warn', value: s.raw, use: e.name }));
    }
    if (set.length === 0) {
      setIn(values, e.name, defaultOf(e));
      origins[e.name] = 'default';
      return;
    }
    const first = set[0];
    const r = TYPES[e.type].read(first.raw, e);
    if (r.ok) {
      setIn(values, e.name, r.value);
      origins[e.name] = first.origin;
      if (e.keys && isMap(r.value)) {
        for (const k of Object.keys(r.value).filter((k) => !e.keys.includes(k))) {
          const near = nearest(k, e.keys);
          faults.push(makeFault({ name: `${e.name}.${k}`, kind: 'unknown-name', level: 'warn', value: r.value[k], suggest: near ? `${e.name}.${near}` : null }));
        }
      }
    } else {
      const kept = e.keepOnFault ? (typeof first.raw === 'string' && first.raw.trim() !== '' ? first.raw : defaultOf(e)) : undefined;
      setIn(values, e.name, kept !== undefined ? kept : fallbackOf(e));
      origins[e.name] = 'fault';
      faults.push(notAllowed(e, first.raw));
    }
    // The merge can hide a vault value the type cannot read behind the site file's list.
    if (r.ok && (e.jsonMerge === 'union' || e.jsonMerge === 'stricter')) {
      const vr = getPath(mergeVault, e.name.split('.').slice(1));
      if (vr != null && !TYPES[e.type].read(vr, e).ok) faults.push(notAllowed(e, vr));
    }
  }

  for (const e of REGISTRY) {
    if (e.container || hasChildren(e.name)) continue;
    readEntry(e);
  }

  // Walk what the file holds against the list: parents that are not maps, names not in the
  // list, retired settings. Keys under an unknown name are kept in the values as written.
  function unknown(parent, key, value) {
    const full = `${parent}.${key}`;
    const isGuard = (seg) => !!KNOWN.get(`${parent}.${seg}`).guards;
    const near = nearest(key, childSegs(parent));
    const hidingNear = nearest(key, childSegs(parent).filter(isGuard));
    let level = 'warn';
    let hint;
    let wrongDepth = false;
    if (near && isGuard(near)) level = 'stop';
    else if (parent === PUBLISH && HIDING_PREFIXES.some((p) => key.toLowerCase().startsWith(p))) level = 'stop';
    // Deeper down there is no nearest-name guessing: a key that says it hides, in the wrong map, stops.
    else if (parent !== PUBLISH && saysHiding(key)) { level = 'stop'; wrongDepth = true; }
    // A stop only ever points at a hiding setting; a warning points at the nearest name of any kind.
    let suggest = level === 'stop' ? hidingNear : near;
    suggest = suggest ? `${parent}.${suggest}` : null;
    // `hide` is two edits from `mode` but means neither: a name that starts like "hide" gets no guess.
    if (parent === PUBLISH && key.toLowerCase().startsWith('hid')) suggest = null;
    if (wrongDepth) {
      suggest = BY_NAME.has(`${PUBLISH}.${key}`) ? `${PUBLISH}.${key}` : null;
      if (parent === 'publish.overrides') hint = `${full} is not a setting. The only override is publish.overrides.fields.`;
    }
    faults.push(makeFault({ name: full, kind: 'unknown-name', level, value, suggest, ...(hint ? { hint } : {}) }));
    if (parent !== PUBLISH && parent !== 'publish.overrides') setIn(values, full, clone(value));
  }
  function walk(parent, map) {
    for (const [rawKey, value] of Object.entries(map)) {
      const key = String(rawKey);
      const full = `${parent}.${key}`;
      if (OLD_PATHS.has(full)) continue;
      const known = KNOWN.get(full);
      if (!known) { unknown(parent, key, value); continue; }
      if (known !== PARENT && known.retired) {
        faults.push(makeFault({ name: full, kind: 'retired', level: 'warn', value }));
        continue;
      }
      if (known !== PARENT && !known.container && !hasChildren(full)) continue;
      const child = rawAt(full);
      if (child == null) continue;
      if (!isMap(child)) {
        const e = known === PARENT ? MAP_ENTRY : known;
        faults.push(makeFault({ name: full, kind: 'not-allowed', level: e.guards ? 'stop' : 'warn', value: child, entry: e }));
        continue;
      }
      walk(full, child);
    }
  }
  // A map that only the site file holds (landing, images, ...) is walked too.
  const view = { ...publish };
  for (const k of movedNames) if (view[k] === undefined && picked[k] !== undefined && KNOWN.get(`${PUBLISH}.${k}`)) view[k] = picked[k];
  walk(PUBLISH, view);

  // A hiding setting written beside `publish:` instead of under it hides nothing.
  for (const [rawKey, value] of Object.entries(data)) {
    const key = String(rawKey);
    if (key === PUBLISH || !saysHidingBeside(key)) continue;
    const suggest = BY_NAME.has(`${PUBLISH}.${key}`) ? `${PUBLISH}.${key}` : null;
    faults.push(makeFault({ name: key, kind: 'misplaced', level: 'stop', value, suggest }));
  }

  return { values, origins, faults, legacy, file };
}

module.exports = { readSettings };
