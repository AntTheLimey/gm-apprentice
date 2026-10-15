'use strict';
// The faults in what a list setting holds, entry by entry, or between two settings, found once after the values are read
// so that every consumer (the Settings check, `settings get`, the build) reports them the same way. The value is left as
// written; the build leaves the bad entry out. A note a menu link names that has no page depends on the vault's notes, so
// the build finds that one.
const { canonicalNfc } = require('../unicode');
const { makeFault } = require('./faults');
const { nameIn } = require('./layout');

// A step that is blank is never run.
const isBlankStep = (command) => String(command).trim() === '';

// Two menu entries with the same label (as written, Unicode-normalised) and group (any case) are one entry.
const menuKey = (item) => `${canonicalNfc(String(item.label).trim())}\n${String(item.group || '').trim().toLowerCase()}`;

const words = (list) => new Set((list || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean));

// `values` and `origins` are the reader's, under the list's names. Returns the faults, all warnings but one: a GM site on a vault kept by a player.
function entryFaults(vaultPath, values, origins) {
  const faults = [];
  const add = (setting, message) => {
    const name = nameIn(vaultPath, setting);
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
        add('vault.statuses.fallen', (name) => `${name} holds "${word}", which is not in ${nameIn(vaultPath, 'vault.statuses.out_of_play')}; it does not count as fallen`);
      }
    }
  }

  // A vault kept by a player has no GM site.
  if (get('gm_site.publish') === true && get('vault.kept_by') === 'player') {
    const on = nameIn(vaultPath, 'gm_site.publish');
    const kept = nameIn(vaultPath, 'vault.kept_by');
    faults.push(makeFault({ name: on, setting: 'gm_site.publish', kind: 'gm-kept-by-player', level: 'stop',
      message: `${on} is on, but this vault is kept by a player (\`${kept}: player\`), so it has no GM site; turn ${on} off` }));
  }
  return faults;
}

module.exports = { entryFaults, isBlankStep, menuKey, words };
