'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { entry } = require('../lib/settings');
const { cases } = require('./helpers/settings-matrix');
const { snapshot, vaultFor } = require('../scripts/capture-settings-golden');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/settings-golden.json'), 'utf8'));

// Each line: the row of the plan's "Intended differences" table, the case ids it covers, the
// fields of publishConfig that may differ (compared on neither side for those cases), and why.
// Adding a line needs Ant's yes. A difference that fits no row is a bug in the reader or the loaders.
const withSite = (base) => ['site-true', 'site-list', 'site-unset'].map((x) => `${base}-${x}`);
const INTENDED = [
  // Not a publishConfig field: the `siteOp` message is compared with one trailing colon cut from each side.
  { row: 'siteOp', why: 'the invalid-YAML message is the reader\'s one line; the old text ended in a stray colon',
    ids: ['broken-yaml'], fields: [], trailingColon: true },
  { row: 1, why: 'exclude_drafts "false", no, off read as off (was: any text hides)',
    ids: ['exclude-drafts-quoted-false', 'exclude-drafts-no', 'exclude-drafts-off'], fields: ['exclude_drafts'] },
  { row: 1, why: 'exclude_drafts yes, maybe, 1 or a list read as true (was the text itself; representation only)',
    ids: ['exclude-drafts-yes', 'exclude-drafts-maybe', 'exclude-drafts-one', 'exclude-drafts-list'], fields: ['exclude_drafts'] },
  { row: 2, why: 'exclude_callouts no, off, "false" read as off, and the site-file merge follows from that (the callouts merge record, `legacy`, gains or changes stillApplied)',
    ids: [...withSite('exclude_callouts-bare-no'), ...withSite('exclude_callouts-bare-off'), ...withSite('exclude_callouts-quoted-false')],
    fields: ['exclude_callouts', 'legacy'] },
  { row: 2, why: 'exclude_callouts maybe or 1 reads as hide-all (hides the same or more)',
    ids: [...withSite('exclude_callouts-maybe'), ...withSite('exclude_callouts-one')], fields: ['exclude_callouts'] },
  { row: 3, why: 'images.optimize "yes" and "true" read as on', ids: ['images-optimize-yes', 'images-optimize-quoted-true'], fields: ['images'] },
  { row: 4, why: 'landing numbers: "3" is 3; an unreadable value is the default, with a fault',
    ids: ['landing-recency_window-quoted-three', 'landing-recency_window-lots', 'landing-max_npcs-quoted-three', 'landing-max_npcs-lots',
      'landing-max_locations-quoted-three', 'landing-max_locations-lots'], fields: ['landing'] },
  { row: '4/13 applied to images', why: 'an image number that cannot be read (words, negative, fractional width) is the default, with a fault',
    ids: ['images-quality-high', 'images-quality-negative', 'images-max-width-wide', 'images-max-width-negative', 'images-max-width-fractional'], fields: ['images'] },
  { row: 14, why: 'an empty images.quality is "not set": the default', ids: ['images-quality-empty'], fields: ['images'] },
  { row: 3, why: 'images.optimize 1 is not a switch word: off, with a fault (main also built it as off)', ids: ['images-optimize-one'], fields: ['images'] },
  { row: 5, why: 'images.maxWidth is still honoured, under its new name, with an old-name fault', ids: ['images-max-width-camel'], fields: ['images'] },
  { row: 6, why: 'quoted true/false/yes/no/on/off for link_previews read as the switch word',
    ids: ['link-previews-false-padded', 'link-previews-string-false', 'link-previews-string-false-upper', 'link-previews-string-padfalsepad'], fields: ['link_previews'] },
  { row: 6, why: 'quoted true/false/yes/no/on/off for connections read as the switch word',
    ids: ['connections-false-padded', 'connections-string-false', 'connections-string-false-upper', 'connections-string-padfalsepad'], fields: ['connections'] },
  { row: 7, why: 'theme.default_mode written as a list is refused: system', ids: ['theme-default-mode-list'], fields: ['theme'] },
  { row: 8, why: 'theme.fonts.source forgives case and padding; an unknown source is a fault',
    ids: ['theme-fonts-source-gogle', 'theme-fonts-source-capital-local', 'theme-fonts-source-capital-self-host', 'theme-fonts-source-padded-google'], fields: ['theme'] },
  { row: 9, why: 'genre aliases are resolved by the reader, and an unknown genre reads as none, with a fault (the palette is still compared: a written genre with no palette is none either way)',
    ids: ['theme-genre-sci-fi', 'theme-genre-gothic', 'theme-genre-sci-fi-capitalised', 'theme-genre-weird', 'theme-genre-weird-with-palette'], fields: ['theme.genre'] },
  { row: 10, why: 'a landing list written as a bare string is the default, with a fault', ids: ['landing-featured-npcs-string'], fields: ['landing'] },
  { row: 10, why: 'section_titles written as a bare string is the default, with a fault', ids: ['section-titles-wrong-type'], fields: ['section_titles'] },
  { row: 10, why: 'four_oh_four written as a bare string is the default, with a fault', ids: ['four-oh-four-wrong-type'], fields: ['four_oh_four'] },
  { row: 11, why: 'list entries come back as text (3 is "3")', ids: ['exclude_sections-entry-number-and-boolean'], fields: ['exclude_sections'] },
  { row: 11, why: 'list entries come back as text (3 is "3")', ids: ['exclude_fields-entry-number-and-boolean'], fields: ['exclude_fields'] },
  { row: 11, why: 'list entries come back as text (3 is "3")', ids: ['pc-prose-sections-list-with-number'], fields: ['pc_prose_sections'] },
  { row: 11, why: 'list entries come back as text (3 is "3")',
    ids: [...withSite('exclude_callouts-list-of-number'), ...withSite('exclude_callouts-list-with-number')].filter((id) => !id.endsWith('site-true')),
    fields: ['exclude_callouts'] },
];

// Cases whose warnings may differ in WHICH settings they name, each with its row. Warnings
// are compared as the set of setting names; a row that adds a fault or removes a warning is
// listed here by case id, nothing else may differ.
const WARNS = [
  { row: 14, why: 'an empty key is "not set": no warning, same safe default',
    ids: ['search-empty', 'mode-empty', ...['exclude_sections', 'exclude_fields', 'exclude_dirs'].flatMap((k) => [`${k}-empty`, `${k}-empty-with-site-list`])] },
  { row: 6, why: 'quoted true/false for link_previews and connections is the switch word: nothing to warn about',
    ids: ['link-previews-true-padded', 'link-previews-false-padded', 'connections-true-padded', 'connections-false-padded',
      'link-previews-string-true', 'link-previews-string-false', 'link-previews-string-true-upper', 'link-previews-string-false-upper', 'link-previews-string-padfalsepad',
      'connections-string-true', 'connections-string-false', 'connections-string-true-upper', 'connections-string-false-upper', 'connections-string-padfalsepad'] },
  { row: 13, why: 'a hiding value that cannot be read is a stop fault, named',
    ids: [...withSite('exclude_callouts-maybe'), ...withSite('exclude_callouts-one'), 'exclude-drafts-maybe', 'exclude-drafts-one', 'exclude-drafts-list'] },
  { row: '4/13 applied to images', why: 'an unreadable image number or switch is a fault',
    ids: ['images-quality-high', 'images-quality-negative', 'images-max-width-wide', 'images-max-width-negative', 'images-max-width-fractional', 'images-optimize-one'] },
  { row: 9, why: 'an unknown genre is a fault', ids: ['theme-genre-weird', 'theme-genre-weird-with-palette'] },
  { row: 4, why: 'an unreadable landing number is the default, with a fault',
    ids: ['landing-recency_window-lots', 'landing-max_npcs-lots', 'landing-max_locations-lots'] },
  { row: 5, why: 'images.maxWidth carries an old-name fault', ids: ['images-max-width-camel'] },
  { row: 8, why: 'an unknown font source is a fault', ids: ['theme-fonts-source-gogle'] },
  { row: 7, why: 'default_mode written as a list is a fault', ids: ['theme-default-mode-list'] },
  { row: 10, why: 'a wrong-shaped landing list, section_titles or four_oh_four is a fault; the retired four_oh_four.style is named',
    ids: ['landing-featured-npcs-string', 'section-titles-wrong-type', 'four-oh-four-wrong-type', 'four-oh-four-good'] },
  { row: 12, why: 'a misspelt or unknown name is a fault (was silent)',
    ids: ['section-titles-good', 'merge-locations', 'exclude-sectoins-list', 'link-preview-off', 'theme-gnere', 'landing-max-npc', 'imagse-map'] },
  { row: 12, why: 'an old name in the site file is a fault even when the vault file names the switch too',
    ids: ['backend-both-differ', 'backend-statusbar-site-live-stats-vault-true', 'backend-statusbar-site-live-stats-vault-false'] },
  { row: 'I6', why: 'a hiding setting one level too deep, beside publish:, or a publish.hide group stops (main said nothing; the resolved values are the same)',
    ids: ['theme-exclude-sections-too-deep', 'landing-exclude-drafts-too-deep', 'images-exclude-fields-too-deep', 'overrides-exclude-key', 'hide-group',
      'beside-publish-exclude-sections', 'beside-publish-exclude-drafts'] },
  { row: 'I2', why: 'a site file landingTagline is reported as an old name (main named it only in the closing warning) and is not read',
    ids: ['landing-tagline-site-only', 'landing-tagline-site-and-vault'] },
  { row: 11, why: 'a number in pc_prose_sections is read as text: nothing to warn about', ids: ['pc-prose-sections-list-with-number'] },
  { row: '10 (same kind, not named there)', why: 'a map written as the wrong type (folder_map, banners, locations) is a fault; the value is unchanged',
    ids: ['folder-map-wrong-type', 'banners-wrong-type', 'locations-wrong-type'] },
  { row: 'wording', why: 'the same warning, now carrying the full setting name', ids: ['exclude_dirs-entry-absolute-outside'] },
  { row: 'Task 4 ruling D', why: 'an image format that is not webp is kept as written and warned about at load', ids: ['images-format-png', 'merge-images'] },
  { row: 'artifact', why: 'publish written as a bare word: the old warning named publish.search by accident', ids: ['publish-scalar'] },
];


const allowed = (id) => INTENDED.filter((d) => d.ids.includes(id));
const warnAllowed = (id) => WARNS.some((d) => d.ids.includes(id));

// The setting a message is about: its first name. A name in the site's vault.config.json that
// the new messages give bare (`backend.statusBar`) is spelt the way the old build did.
const NAME = /(publish\.[A-Za-z_.]+|setting_year|vault\.config\.json [A-Za-z.]+|^(?:backend\.[A-Za-z]+|landingTagline))/;
const namesOf = (messages) => new Set(messages.map((m) => (m.match(NAME) || [])[0]).filter(Boolean)
  .map((n) => n.replace(/\.$/, '')).map((n) => (/^(backend\.|landingTagline)/.test(n) ? `vault.config.json ${n}` : n)));
// What the old build printed from switches.notes and sheetLook.notes now comes through the
// warn argument, so the old side counts those names too.
const oldNames = (want) => {
  const pc = want.publishConfig || {};
  const notes = [...((pc.switches || {}).notes || []), ...((pc.sheetLook || {}).notes || [])];
  return namesOf([...want.warnings, ...notes.map((n) => (n.key.startsWith('vault.config.json') ? n.key : `publish.${n.key}`))]);
};

const all = cases();

test('every golden entry has a case', () => {
  const ids = new Set(all.map((c) => c.id));
  const orphans = Object.keys(GOLDEN).filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `golden entries with no case: ${orphans.join(', ')}`);
});

// Shape changes, dropped from both sides on every case: the reader's own faults and origins,
// the notes the build used to print (switches.notes, sheetLook.notes) and, fifth, four_oh_four.style:
// main's defaults put it in every golden and the setting is retired (row 10).
// Main applied landing.max_events (4) at the use site, so its goldens have no value for it; the
// golden side is given the list's default before comparing, and the field is compared like any other.
const strip = (o, skip, isGolden = false, trailingColon = false) => {
  // An absolute site folder resolves with a drive letter and backslashes on Windows.
  const copy = JSON.parse(JSON.stringify(o), (k, v) => (k === 'siteDir' && typeof v === 'string' ? v.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/') : v));
  delete copy.warnings;
  if (trailingColon && copy.siteOp && typeof copy.siteOp.threw === 'string') copy.siteOp.threw = copy.siteOp.threw.replace(/:$/, '');
  const pc = copy.publishConfig;
  if (pc) {
    delete pc.faults; delete pc.origins;
    if (pc.switches) delete pc.switches.notes;
    if (pc.sheetLook) delete pc.sheetLook.notes;
    if (isGolden && pc.landing && typeof pc.landing === 'object' && pc.landing.max_events === undefined) pc.landing.max_events = entry('publish.landing.max_events').default;
    if (pc.four_oh_four && typeof pc.four_oh_four === 'object') delete pc.four_oh_four.style;
    // A field may be dotted (`theme.genre`) so the rest of its group is still compared.
    for (const f of skip) {
      const segs = f.split('.');
      const last = segs.pop();
      const holder = segs.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), pc);
      if (holder && typeof holder === 'object') delete holder[last];
    }
  }
  return copy;
};

for (const c of all) {
  test(`settings resolve as before: ${c.id}`, () => {
    assert.ok(Object.hasOwn(GOLDEN, c.id), `no golden entry for case "${c.id}"; run scripts/capture-settings-golden.js`);
    const want = GOLDEN[c.id];
    const got = snapshot(vaultFor(c), c.siteConfig || {});
    const skip = allowed(c.id).flatMap((d) => d.fields);
    const colon = allowed(c.id).some((d) => d.trailingColon);
    assert.deepEqual(strip(got, skip, false, colon), strip(want, skip, true, colon));
    if (!warnAllowed(c.id)) assert.deepEqual([...namesOf(got.warnings)].sort(), [...oldNames(want)].sort(), 'the settings warned about differ');
  });
}

test('every INTENDED and WARNS case id is a real case, listed once', () => {
  const ids = new Set(all.map((c) => c.id));
  for (const list of [INTENDED, WARNS]) {
    for (const d of list) for (const id of d.ids) assert.ok(ids.has(id), `${id} is not a case`);
  }
});
