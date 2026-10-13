'use strict';
// Everything true only of the old layout (settings in the frontmatter of the old vault file, over
// the site's vault.config.json): the moved-key table, the merge, and the reader that walks the old
// file. Dated for removal two releases after 1b, when the site-file fallback ends.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { parseNote } = require('../frontmatter');
const { REGISTRY, entry: settingEntry, legacyNameOf, siteKeyOf } = require('./registry');
const { TYPES, isMap } = require('./types');
const { nearest, makeFault, saysHiding: saysHidingName, hidingLasts, HIDING_PREFIXES, startsLikeHide } = require('./faults');
const { OLD_FILE, at } = require('./layout');
const { normalizeExcludeDir, normalizeExcludeDirs } = require('./folders');

// The folders list as the old file names it, for the notes the tidying makes.
const FOLDERS_LABEL = legacyNameOf(settingEntry('player_site.hide.folders'));

// The list as the old layout knew it: each setting the old vault file held, named as that file
// names it (`name`), with the new name beside (`setting`), the site-file key it was also written
// under (`json`, `jsonKind`, `jsonMerge`) and its other old names (`oldNames`). The legacy reader
// walks this; it is derived from each entry's `was`, never a second list.
const LEGACY = REGISTRY.filter((e) => legacyNameOf(e)).map((e) => {
  const first = legacyNameOf(e);
  const json = siteKeyOf(e);
  const oldNames = (e.was || []).filter((w) => !(w.in === 'vault' && w.name === first) && !(w.in === 'site' && w.name === json));
  // An entry that exists only in the old file has no new name: its faults carry `setting: null`.
  return { ...e, name: first, setting: e.legacyOnly ? null : e.name, json: json || undefined, jsonKind: e.legacyKind, jsonMerge: e.legacyMerge, oldNames };
});

// The block the old vault file keeps its settings under, taken from the names themselves.
const OLD_BLOCK = legacyNameOf(settingEntry('player_site.title')).split('.')[0];
const underBlock = (name) => name.startsWith(`${OLD_BLOCK}.`);
const sansBlock = (name) => name.slice(OLD_BLOCK.length + 1);

// The old vault.config.json keys that now live under `publish:`, in the registry's order.
const movedKeys = () => LEGACY.filter((e) => e.json).map((e) => ({ json: e.json, publish: sansBlock(e.name), kind: e.jsonKind }));

// The six keys that stay in vault.config.json.
const DEPLOY_KEYS = ['vaultPath', 'outputDir', 'host', 'siteUrl', 'cloudflarePagesProject', 'preserveDirs'];

// Old switch names in the site file, from the registry: { statusBar: 'live_stats', inbox: 'inbox' }.
const OLD_SWITCHES = Object.fromEntries(LEGACY.flatMap((e) => (e.oldNames || [])
  .filter((o) => o.in === 'site' && o.name.startsWith('backend.'))
  .map((o) => [o.name.slice('backend.'.length), sansBlock(e.name)])));

// The first part of each old name written in the site file (`backend`, `landingTagline`).
// Sorted, so a warning that names several always names them in the same order.
const SITE_OLD_ROOTS = new Set(LEGACY.flatMap((e) => (e.oldNames || []).filter((o) => o.in === 'site').map((o) => o.name.split('.')[0])).sort());

// True while the site file still holds anything the migration would move.
function hasLegacy(site) {
  return !!site && typeof site === 'object' && ([...SITE_OLD_ROOTS].some((k) => site[k] !== undefined)
    || movedKeys().some((e) => site[e.json] !== undefined));
}

// What the reader does with a list entry is String(entry), so text, numbers and booleans
// can be carried over; null, a map or list, a non-finite number and an empty string cannot.
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const usable = (v) => isText(v) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// exclude_callouts is `true` (strip every callout), a list of types, or off. When both files
// set it, the stricter wins: true beats a list, a list beats off, two lists are unioned
// (the vault file's first). An upgrade must never be what publishes a callout.
function stricterCallouts(fromVault, fromSite) {
  const stripsAll = (v) => !!v && !Array.isArray(v);
  if (stripsAll(fromVault)) return fromVault;
  if (stripsAll(fromSite)) return fromSite;
  if (Array.isArray(fromVault) && Array.isArray(fromSite)) {
    const have = new Set(fromVault.map((t) => String(t).toLowerCase()));
    return [...fromVault, ...fromSite.filter((t) => !have.has(String(t).toLowerCase()) && have.add(String(t).toLowerCase()))];
  }
  if (Array.isArray(fromSite)) return fromSite;
  return fromVault;
}

// The settings that merge per sub-key across the two files: with both set, a sub-key only
// the site file has still applies, and the vault file wins a sub-key both set.
const mergedMaps = () => new Set(LEGACY.filter((e) => e.jsonMerge === 'perKey').map((e) => sansBlock(e.name)));

// Vault file value when set, else the site file's, recording which was used. A moved key is
// "set" when it is not undefined: an explicit false or null is a value, not silence.
// The three exclude lists (and exclude_callouts, which takes the stricter of the two) are the
// exception to "the vault file wins outright": a site-file entry the vault list lacks is still
// applied until the migration moves it, and the record names them as `stillApplied`.
// `notes` collects what the old code printed; `from` records which file the value came from.
function pick(publish, json, entry, legacy, normalize, keyOf, notes, from) {
  const stricter = entry.merge === 'stricter';
  const fromVault = stricter && publish[entry.publish] === null ? undefined : publish[entry.publish];
  const fromSite = json[entry.json];
  const vaultMalformed = entry.kind === 'list' && fromVault !== undefined && !Array.isArray(fromVault);
  if (vaultMalformed) {
    const what = fromVault === null ? 'empty' : `${typeof fromVault}`;
    notes.push(`${OLD_BLOCK}.${entry.publish} must be a list, but is ${what}. Using the built-in default instead of the vault file's value.`);
  }
  let value = fromVault !== undefined ? fromVault : fromSite;
  from[entry.publish] = fromVault !== undefined ? 'file' : (fromSite !== undefined ? 'site-file' : undefined);
  if (fromSite !== undefined) {
    const rec = { key: entry.json, publishKey: entry.publish, status: fromVault !== undefined ? 'ignored' : 'used' };
    if (entry.kind === 'list' && !Array.isArray(fromSite)) rec.notAList = true;
    if (entry.kind === 'list' && Array.isArray(fromSite) && fromSite.length && !fromSite.some(usable)) rec.unmovable = true;
    if (entry.kind === 'list' && fromVault !== undefined && Array.isArray(fromSite)) {
      const base = vaultMalformed ? entry.builtIn : fromVault;
      const have = new Set(base.map((s) => keyOf(s)));
      const stillApplied = [];
      for (const s of fromSite) {
        const k = keyOf(s);
        if (!have.has(k)) { have.add(k); stillApplied.push(s); }
      }
      if (stillApplied.length) {
        rec.stillApplied = stillApplied;
        value = [...base, ...stillApplied];
      } else if (vaultMalformed) {
        value = [...base];
      }
    }
    // The vault file sets no list: the site file's entries add to the built-in list, never replace it (#371).
    if (entry.merge === 'union' && entry.kind === 'list' && fromVault === undefined && Array.isArray(fromSite) && Array.isArray(entry.builtIn)) {
      const have = new Set(entry.builtIn.map((s) => keyOf(s)));
      value = [...entry.builtIn, ...fromSite.filter((s) => !have.has(keyOf(s)) && have.add(keyOf(s)))];
    }
    if (mergedMaps().has(entry.publish) && fromVault !== undefined && isMap(fromSite)) {
      const base = isMap(fromVault) ? fromVault : {};
      const extra = Object.keys(fromSite).filter((k) => !(k in base));
      if (extra.length) {
        rec.stillApplied = extra;
        value = { ...base, ...Object.fromEntries(extra.map((k) => [k, fromSite[k]])) };
      }
    }
    if (stricter && fromVault !== undefined) {
      value = stricterCallouts(fromVault, fromSite);
      if (!isDeepStrictEqual(value, fromVault)) {
        const had = new Set((Array.isArray(fromVault) ? fromVault : []).map((t) => String(t).toLowerCase()));
        rec.stillApplied = Array.isArray(value) ? value.filter((t) => !had.has(String(t).toLowerCase())) : [value];
      }
    }
    legacy.push(rec);
  }
  return normalize(value);
}

// One pass over the moved keys, in order, so `legacy` reads the same way every time.
// Returns { picked, legacy, from, messages, dropped }: `picked` by publish name; `from` says
// 'file' or 'site-file' for each; `messages` are the not-a-list notices; `dropped` are
// exclude_dirs entries that were thrown away.
function mergeWithSiteFile(publish, siteConfig, vaultPath) {
  const json = siteConfig || {};
  const legacy = [];
  const picked = {};
  const from = {};
  const messages = [];
  const dropped = [];
  for (const e of LEGACY.filter((x) => x.json)) {
    const entry = { json: e.json, publish: sansBlock(e.name), kind: e.jsonKind, merge: e.jsonMerge, same: e.same };
    const dirs = entry.same === 'folder';
    const builtIn = LEGACY.find((e) => sansBlock(e.name) === entry.publish).default;
    picked[entry.publish] = pick(
      publish, json, { ...entry, builtIn }, legacy,
      dirs ? (v) => (Array.isArray(v) ? normalizeExcludeDirs(v, vaultPath, (m) => dropped.push(m), FOLDERS_LABEL) : v) : (x) => x,
      dirs ? (s) => (normalizeExcludeDir(s, vaultPath, undefined, FOLDERS_LABEL) ?? String(s)).toLowerCase() : (s) => String(s).toLowerCase(),
      messages, from,
    );
  }
  return { picked, legacy, from, messages, dropped };
}

// ---- The reader for the old file ----------------------------------------------------------

const PUBLISH = OLD_BLOCK;
const PARENT = Symbol('parent');
const SITE_SWITCH = legacyNameOf(settingEntry('player_site.publish'));
const SITE_FOLDER = legacyNameOf(settingEntry('player_site.folder'));
// The old container of the field exceptions (it holds nothing but `fields`) and the name that replaced it.
const OVERRIDES = new Set(REGISTRY.filter((e) => e.legacyOnly && e.guards).map((e) => e.name));
const OVERRIDE_FIELDS = legacyNameOf(settingEntry('player_site.hide.field_exceptions'));
// A name that says it hides something must never be ignored quietly (faults.js has the one rule).
const GUARD_LASTS = hidingLasts(LEGACY.filter((e) => e.guards).map((e) => e.name));
const saysHiding = (key) => saysHidingName(key, GUARD_LASTS);
// Beside `publish:` (the left edge of the frontmatter) the same slip is looked for.
const saysHidingBeside = (key) => saysHidingName(key, GUARD_LASTS, { beside: true });
// Top-level keys of the old file that are not settings and are not reported: the notes the file
// kept beside its settings, which the move carries over or the notes file keeps.
// The old file's own bookkeeping keys (the plugin version moves to the state file) and the notes it kept
// beside its settings. This is the one list of the old file's top-level keys that are not settings.
const VERSION_KEY = 'gm_apprentice_version';
const FILE_KEYS = ['type', VERSION_KEY];
const NOTE_KEYS = ['campaign', 'game_system', 'description', 'last_updated', 'changelog', 'chapter_naming', 'session_naming'];
const NOT_SETTINGS = new Set([...FILE_KEYS, ...NOTE_KEYS]);
// The old file's set-up note (an entry the list marks as bookkeeping): moves to the state file.
const SETUP_NOTE = REGISTRY.find((e) => e.state && e.legacyOnly).name;

// The old layout's view of the list, plus the entries that exist only in the old file.
const BY_NAME = new Map(LEGACY.map((e) => [e.name, e]));
const hasChildren = (name) => LEGACY.some((e) => e.name.startsWith(`${name}.`));

// The list's name for a key the list does not know, found under `parent` in the old file (such keys
// are kept in the values as written). The parent is placed through its own entry, or through a
// setting under it whose new name ends the same way as its old one; null when neither places it.
function settingPathOf(parent, key) {
  const own = BY_NAME.get(parent);
  if (own && own.setting) return `${own.setting}.${key}`;
  for (const e of LEGACY) {
    if (!e.setting || !e.name.startsWith(`${parent}.`)) continue;
    const tail = e.name.slice(parent.length + 1);
    if (e.setting.endsWith(`.${tail}`)) return `${e.setting.slice(0, -(tail.length + 1))}.${key}`;
  }
  return null;
}

// Every name the list knows, with the parent paths between them (theme, theme.fonts, ...).
const KNOWN = new Map(BY_NAME);
for (const e of LEGACY) {
  const segs = e.name.split('.');
  for (let i = 2; i < segs.length; i++) {
    const p = segs.slice(0, i).join('.');
    if (!KNOWN.has(p)) KNOWN.set(p, PARENT);
  }
}
// Old names written under `publish:` in the vault file, each with the setting that replaced it.
const OLD_PATHS = new Map(LEGACY.flatMap((e) => (e.oldNames || []).filter((o) => underBlock(o.name)).map((o) => [o.name, e.name])));

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

// Reads the old file and the site's vault.config.json. `core` is read.js's shared pieces.
// Returns { values, origins, faults, legacy, file } like readSettings (without `layout`).
function readLegacy({ vaultPath, siteConfig }, core) {
  const { settle, getPath, setIn, clone, emptyIsFault, MAP_ENTRY } = core;
  const site = siteConfig || {};
  const faults = [];
  const fault = makeFault;
  const file = { path: at(vaultPath, OLD_FILE), exists: false, hasPublish: false, inline: false, leftover: false };
  let data = {};
  if (fs.existsSync(file.path)) {
    file.exists = true;
    const text = fs.readFileSync(file.path, 'utf-8');
    try {
      ({ data } = parseNote(text));
    } catch (e) {
      // One line, naming the file: js-yaml's message ends in a code excerpt.
      throw new Error(`${OLD_FILE} frontmatter is not valid YAML: ${String(e.message).split('\n')[0].trim().replace(/:$/, '')}`);
    }
    data = data || {};
    file.inline = new RegExp(`^${PUBLISH}:[ \\t]*\\{`, 'm').test(text);
  }
  const publish = isMap(data[PUBLISH]) ? data[PUBLISH] : {};
  file.hasPublish = isMap(data[PUBLISH]);
  if (data[PUBLISH] && !isMap(data[PUBLISH])) {
    faults.push(fault({ name: PUBLISH, setting: null, kind: 'not-allowed', level: 'warn', value: data[PUBLISH], entry: MAP_ENTRY }));
  }

  // exclude_callouts is merged "stricter wins" between the two files, so each side is turned
  // into on, off or a list first: a vault `no` must not count as text that hides.
  const calloutsEntry = LEGACY.find((e) => e.jsonMerge === 'stricter');
  const calloutsKey = sansBlock(calloutsEntry.name);
  const asRead = (v) => { const r = TYPES[calloutsEntry.type].read(v, calloutsEntry); return r.ok ? r.value : v; };
  const mergeVault = { ...publish };
  if (mergeVault[calloutsKey] != null) mergeVault[calloutsKey] = asRead(mergeVault[calloutsKey]);
  const mergeSite = { ...site };
  if (mergeSite[calloutsEntry.json] != null) mergeSite[calloutsEntry.json] = asRead(mergeSite[calloutsEntry.json]);

  const merge = mergeWithSiteFile(mergeVault, mergeSite, vaultPath);
  const { picked, legacy, from } = merge;
  const movedNames = new Set(movedKeys().map((e) => e.publish));
  const DIRS_ENTRY = LEGACY.find((e) => e.same === 'folder');
  for (const text of merge.dropped) {
    faults.push(fault({ name: DIRS_ENTRY.name, setting: DIRS_ENTRY.setting, kind: 'dropped', level: 'warn', value: null, message: text }));
  }

  // Where a name's value is written: the merged moved key, else the vault file.
  function rawAt(name) {
    if (!underBlock(name)) return data[name];
    const segs = name.split('.').slice(1);
    if (movedNames.has(segs[0])) return segs.length === 1 ? picked[segs[0]] : getPath(picked[segs[0]], segs.slice(1));
    return getPath(publish, segs);
  }
  function originAt(name) {
    const segs = name.split('.').slice(1);
    if (!underBlock(name) || !movedNames.has(segs[0])) return 'file';
    if (segs.length === 1) return from[segs[0]] || 'file';
    return getPath(publish, segs) !== undefined ? 'file' : 'site-file';
  }

  const values = {};
  const origins = {};
  const c = { values, origins, faults, fault, vaultPath };
  const defaultOf = (e) => {
    if (e.name === SITE_SWITCH) { const dir = getPath(publish, sansBlock(SITE_FOLDER).split('.')); return typeof dir === 'string' && dir.trim() !== ''; }
    return e.default === undefined ? null : clone(e.default);
  };
  const notAllowed = (e, raw) => fault({ name: e.name, setting: e.setting, kind: 'not-allowed', level: e.guards ? 'stop' : 'warn', value: raw, entry: e });

  function readEntry(e) {
    const sources = [{ raw: rawAt(e.name), origin: originAt(e.name) }];
    const reportOnly = [];
    for (const o of e.oldNames || []) {
      const raw = o.in === 'site' ? getPath(site, o.name.split('.')) : rawAt(o.name);
      (o.read === false ? reportOnly : sources).push({ raw, origin: 'old-name', old: o });
    }
    const isSet = (s) => s.raw !== undefined && !(s.raw === null && !emptyIsFault(e));
    const set = sources.filter(isSet);
    // An old name is always reported; its value is read only unless the registry says `read: false`.
    for (const s of [...set, ...reportOnly.filter(isSet)]) {
      if (s.old) faults.push(fault({ name: s.old.name, setting: e.setting, kind: 'old-name', level: 'warn', value: s.raw, use: e.name }));
    }
    if (set.length === 0) {
      setIn(values, e.setting, defaultOf(e));
      origins[e.setting] = 'default';
      return;
    }
    // Read from the merged value, but a fault shows the value as the site file wrote it (as it always did).
    const first = set[0].origin === 'site-file' && e.json ? { ...set[0], shown: site[e.json] } : set[0];
    const r = settle(c, e, { written: e.name, setting: e.setting }, first, defaultOf);
    // The merge can hide a vault value the type cannot read behind the site file's list.
    if (r.ok && (e.jsonMerge === 'union' || e.jsonMerge === 'stricter')) {
      const vr = getPath(mergeVault, sansBlock(e.name).split('.'));
      if (vr != null && !TYPES[e.type].read(vr, e).ok) faults.push(notAllowed(e, vr));
    }
  }

  // The retired names and the tool's bookkeeping hold no value to read; the walk below reports them.
  for (const e of LEGACY) {
    if (e.container || e.legacyOnly || hasChildren(e.name)) continue;
    readEntry(e);
  }
  // A setting the old file never had reads as its default.
  for (const e of REGISTRY) {
    if (e.legacyOnly || legacyNameOf(e) || e.container) continue;
    setIn(values, e.name, e.default === undefined ? null : clone(e.default));
    origins[e.name] = 'default';
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
    if (parent === PUBLISH && startsLikeHide(key)) suggest = null;
    if (wrongDepth) {
      suggest = BY_NAME.has(`${PUBLISH}.${key}`) ? `${PUBLISH}.${key}` : null;
      if (OVERRIDES.has(parent)) hint = `${full} is not a setting. The only override is ${OVERRIDE_FIELDS}.`;
    }
    faults.push(fault({ name: full, setting: null, kind: 'unknown-name', level, value, suggest, ...(hint ? { hint } : {}) }));
    const placed = parent !== PUBLISH && !OVERRIDES.has(parent) ? settingPathOf(parent, key) : null;
    if (placed) setIn(values, placed, clone(value));
  }
  function walk(parent, map) {
    for (const [rawKey, value] of Object.entries(map)) {
      const key = String(rawKey);
      const full = `${parent}.${key}`;
      if (OLD_PATHS.has(full)) continue;
      const known = KNOWN.get(full);
      if (!known) { unknown(parent, key, value); continue; }
      if (known !== PARENT && known.retired) {
        faults.push(fault({ name: full, setting: null, kind: 'retired', level: 'warn', value }));
        continue;
      }
      if (known !== PARENT && !known.container && !hasChildren(full)) continue;
      const child = rawAt(full);
      if (child == null) continue;
      if (!isMap(child)) {
        const e = known === PARENT ? MAP_ENTRY : known;
        faults.push(fault({ name: full, setting: known !== PARENT && known.setting ? known.setting : null, kind: 'not-allowed', level: e.guards ? 'stop' : 'warn', value: child, entry: e }));
        continue;
      }
      walk(full, child);
    }
  }
  // A map that only the site file holds (landing, images, ...) is walked too.
  const view = { ...publish };
  for (const k of movedNames) if (view[k] === undefined && picked[k] !== undefined && KNOWN.get(`${PUBLISH}.${k}`)) view[k] = picked[k];
  walk(PUBLISH, view);

  // A hiding setting written beside `publish:` instead of under it hides nothing; any other
  // top-level name the list does not know is reported too, except the notes the file keeps.
  const topNames = [PUBLISH, ...LEGACY.filter((e) => !underBlock(e.name) && !e.legacyOnly).map((e) => e.name)];
  for (const [rawKey, value] of Object.entries(data)) {
    const key = String(rawKey);
    if (key === PUBLISH) continue;
    if (saysHidingBeside(key)) {
      const suggest = BY_NAME.has(`${PUBLISH}.${key}`) ? `${PUBLISH}.${key}` : null;
      faults.push(fault({ name: key, setting: null, kind: 'misplaced', level: 'stop', value, suggest }));
    } else if (!topNames.includes(key) && !NOT_SETTINGS.has(key)) {
      faults.push(fault({ name: key, setting: null, kind: 'unknown-name', level: 'warn', value, suggest: nearest(key, topNames) }));
    }
  }

  return { values, origins, faults, legacy, file };
}

module.exports = {
  readLegacy, OLD_BLOCK, VERSION_KEY, FILE_KEYS, NOT_SETTINGS, SETUP_NOTE, sansBlock, movedKeys, DEPLOY_KEYS, OLD_SWITCHES, SITE_OLD_ROOTS, hasLegacy, usable, stricterCallouts,
  mergedMaps,
};
