'use strict';
// The vault file over the site's vault.config.json: the moved-key table and the merge.
// Dies when the moved keys leave the site file (1b).
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { REGISTRY, entry: settingEntry, legacyNameOf, siteKeyOf } = require('./registry');
const { isMap } = require('./types');

// The list as the old layout knew it: each setting the old vault file held, named as that file
// names it (`name`), with the new name beside (`setting`), the site-file key it was also written
// under (`json`, `jsonKind`, `jsonMerge`) and its other old names (`oldNames`). The legacy reader
// walks this; it is derived from each entry's `was`, never a second list.
const LEGACY = REGISTRY.filter((e) => legacyNameOf(e)).map((e) => {
  const first = legacyNameOf(e);
  const json = siteKeyOf(e);
  const oldNames = (e.was || []).filter((w) => !(w.in === 'vault' && w.name === first) && !(w.in === 'site' && w.name === json));
  return { ...e, name: first, setting: e.name, json: json || undefined, jsonKind: e.legacyKind, jsonMerge: e.legacyMerge, oldNames };
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

// exclude_dirs entries are matched against vault-relative POSIX paths the scanner walks, so
// an entry authored differently fails open. Normalizes backslashes, a trailing slash, a
// leading "./" and an absolute path inside the vault. An absolute path outside the vault is
// dropped (and `say` is told). Returns null for an entry that normalizes to nothing.
function normalizeExcludeDir(entry, vaultPath, say = () => {}) {
  let raw = String(entry).trim().replace(/\\/g, '/');
  if (!raw) return null;
  const looksAbsolute = raw.startsWith('/') || /^[A-Za-z]:\//.test(raw);
  if (looksAbsolute) {
    const resolved = path.resolve(raw);
    const vaultRoot = path.resolve(vaultPath);
    if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
      say(`${legacyNameOf(settingEntry('player_site.hide.folders'))} entry "${entry}" is outside the vault, so it is ignored.`);
      return null;
    }
    raw = path.relative(vaultRoot, resolved).split(path.sep).join('/');
  }
  raw = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  return raw || null;
}

// Normalizes each entry, then drops repeats ignoring case (first spelling wins).
function normalizeExcludeDirs(list, vaultPath, say = () => {}) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const normalized = normalizeExcludeDir(item, vaultPath, say);
    if (normalized == null) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

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
      dirs ? (v) => (Array.isArray(v) ? normalizeExcludeDirs(v, vaultPath, (m) => dropped.push(m)) : v) : (x) => x,
      dirs ? (s) => (normalizeExcludeDir(s, vaultPath) ?? String(s)).toLowerCase() : (s) => String(s).toLowerCase(),
      messages, from,
    );
  }
  return { picked, legacy, from, messages, dropped };
}

module.exports = {
  LEGACY, OLD_BLOCK, underBlock, sansBlock, movedKeys, DEPLOY_KEYS, OLD_SWITCHES, SITE_OLD_ROOTS, hasLegacy, isText, usable, stricterCallouts,
  normalizeExcludeDir, normalizeExcludeDirs, mergeWithSiteFile, mergedMaps,
};
