'use strict';
// The faults in what a list setting holds, entry by entry, or between two settings, found once after the values are read
// so that every consumer (the Settings check, `settings get`, the build) reports them the same way. The value is left as
// written; the build leaves the bad entry out. A note a menu link names that has no page depends on the vault's notes, so
// the build finds that one.
const { canonicalNfc } = require('../unicode');
const { makeFault } = require('./faults');
const { nameIn } = require('./layout');
const { sameRule } = require('./same-rule');
const { resolveGmFolder, gmFolderProblem } = require('../gm-site');

// A step that is blank is never run.
const isBlankStep = (command) => String(command).trim() === '';

// Two menu entries with the same label (as written, Unicode-normalised) and group (any case) are one entry.
const menuKey = (item) => `${canonicalNfc(String(item.label).trim())}\n${String(item.group || '').trim().toLowerCase()}`;

const words = (list) => new Set((list || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean));

const HIDE_LISTS = ['player_site.hide.sections', 'player_site.hide.fields'];

// A hide list the vault wrote itself replaces the built-in one, so a built-in entry it lacks is shown on any page that has
// it, and the leak gate stays silent (the list is the GM's). One warning per list, naming each missing entry and what it is
// for, unless the GM recorded the entry in `player_site.hide.declined`. A vault on the built-in list is never told.
// A name in declined that is no built-in entry of either list does nothing, so it is warned about (a typo guard).
function hideListGaps(values, origins, get, add, faults) {
  const { REGISTRY } = require('./registry');
  const declinedList = get('player_site.hide.declined');
  const decl = Array.isArray(declinedList) ? declinedList.filter((k) => typeof k === 'string') : [];
  const known = new Set();
  for (const setting of HIDE_LISTS) {
    const e = REGISTRY.find((x) => x.name === setting);
    const same = sameRule(e);
    for (const k of decl) if (e.default.some((d) => same(d, k))) known.add(k);
    if (origins[setting] !== 'file') continue;
    const own = Array.isArray(get(setting)) ? get(setting) : [];
    const missing = e.default.filter((d) => !own.some((o) => same(o, d)) && !decl.some((k) => same(k, d)));
    if (!missing.length) continue;
    const name = nameIn(setting);
    const list = missing.map((m) => `${m} (${e.whys[m]})`).join('; ');
    faults.push(makeFault({ name, setting, kind: 'hide-list-gap', level: 'warn', entries: missing,
      message: `${name} is your own list and lacks ${missing.length === 1 ? 'a built-in entry' : `${missing.length} built-in entries`}, so the site shows ${missing.length === 1 ? 'it' : 'them'} on any page that has ${missing.length === 1 ? 'it' : 'them'}: ${list}. Add ${missing.length === 1 ? 'it' : 'them'}, or record ${missing.length === 1 ? 'it' : 'the ones you mean to leave out'} in ${nameIn('player_site.hide.declined')}` }));
  }
  const strays = decl.filter((k) => !known.has(k));
  if (strays.length) {
    add('player_site.hide.declined', (name) => `${name} holds ${strays.map((k) => `"${k}"`).join(', ')}, which ${strays.length === 1 ? 'is' : 'are'} in neither built-in list (${nameIn('player_site.hide.sections')}, ${nameIn('player_site.hide.fields')}); ${strays.length === 1 ? 'it does' : 'they do'} nothing`);
  }
}

// `values` and `origins` are the reader's, `deps` the reader's own file access (the folder checks look through it), under the list's names. Returns the faults, all warnings but one: a GM site on a vault kept by a player.
function entryFaults(vaultPath, values, origins, deps) {
  const faults = [];
  const add = (setting, message) => {
    const name = nameIn(setting);
    faults.push(makeFault({ name, setting, kind: 'dropped', level: 'warn', message: message(name) }));
  };
  const get = (setting) => setting.split('.').reduce((o, k) => (o == null ? undefined : o[k]), values);

  for (const setting of ['player_site.before_build', 'player_site.after_build']) {
    const list = get(setting);
    if (Array.isArray(list) && list.some(isBlankStep)) add(setting, (name) => `${name} has a blank entry; it was left out`);
  }

  const menu = get('player_site.menu_extra');
  if (Array.isArray(menu)) {
    const seen = new Set();
    for (const item of menu) {
      const key = menuKey(item);
      if (seen.has(key)) add('player_site.menu_extra', (name) => `${name} lists "${item.label}" twice${item.group ? ` under ${item.group}` : ''}; the second is left out`);
      seen.add(key);
    }
  }

  // Only a word the GM wrote: a built-in word that their narrower out_of_play list no longer holds is dropped quietly.
  if (origins['vault.statuses.fallen'] !== 'default') {
    const out = words(get('vault.statuses.out_of_play'));
    for (const word of words(get('vault.statuses.fallen'))) {
      if (!out.has(word)) {
        add('vault.statuses.fallen', (name) => `${name} holds "${word}", which is not in ${nameIn('vault.statuses.out_of_play')}; it does not count as fallen`);
      }
    }
  }

  hideListGaps(values, origins, get, add, faults);

  // A vault kept by a player has no GM site.
  if (get('gm_site.publish') === true && get('vault.kept_by') === 'player') {
    const on = nameIn('gm_site.publish');
    const kept = nameIn('vault.kept_by');
    faults.push(makeFault({ name: on, setting: 'gm_site.publish', kind: 'gm-kept-by-player', level: 'stop',
      message: `${on} is on, but this vault is kept by a player (\`${kept}: player\`), so it has no GM site; turn ${on} off` }));
  }

  // The GM site's folder must be one it can own: not the player site's, not inside it or holding it, not the vault.
  const gmFolder = get('gm_site.folder');
  const playerFolder = get('player_site.folder');
  if (typeof gmFolder === 'string' && gmFolder.trim() && typeof playerFolder === 'string' && playerFolder.trim()) {
    const playerDir = resolveGmFolder(playerFolder, vaultPath);
    const problem = gmFolderProblem(resolveGmFolder(gmFolder, playerDir), { playerSiteDir: playerDir, vaultPath, deps });
    if (problem) add('gm_site.folder', () => problem);
  }
  return faults;
}

module.exports = { entryFaults, isBlankStep, menuKey, words };
