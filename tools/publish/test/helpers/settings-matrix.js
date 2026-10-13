'use strict';
// The settings matrix: every vault-file / site-file combination whose resolved answer the
// equivalence test pins. `cases()` returns [{ id, publishYaml, siteConfig }] or, for a real
// vault on disk, [{ id, vaultPath, siteConfig }].
//
// `publishYaml` is the text placed between `type: meta` and the closing `---` of
// _meta/vault-config.md, so it carries its own `publish:` line (and, for setting_year, a
// top-level line). `null` means no file at all. The token {{vault}} stands for the temp
// vault's own path (see vaultFor in scripts/capture-settings-golden.js); it is how a case
// names an absolute path inside the vault without baking in a per-run path.
const fs = require('node:fs');
const path = require('node:path');
const { SKINS, FRAME_IDS } = require('../../lib/skins');

const TOOL_ROOT = path.join(__dirname, '../..');
const REPO_ROOT = path.join(TOOL_ROOT, '../..');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'empty';

// A `publish:` block from its lines (each indented two spaces under it).
const pub = (...lines) => `publish:\n${lines.flat().map((l) => `  ${l}`.replace(/\s+$/, '')).join('\n')}\n`;
const BASE = pub('mode: player');

function fixtureVaults() {
  const out = [];
  const fixtures = path.join(TOOL_ROOT, 'test/fixtures');
  for (const name of fs.readdirSync(fixtures).sort()) {
    const dir = path.join(fixtures, name);
    if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, '_meta/vault-config.md'))) {
      out.push({ id: `vault-${slug(name)}`, dir });
    }
  }
  for (const rel of ['tests/benchmark-campaign', 'tests/fixtures/slice-a/leak', 'tests/fixtures/slice-a/version-behind',
    'tests/fixtures/slice-a/wrapup', 'tests/fixtures/slice-b/index']) {
    out.push({ id: `vault-${slug(rel.replace(/^tests\/(fixtures\/)?/, ''))}`, dir: path.join(REPO_ROOT, rel) });
  }
  return out.map(({ id, dir }) => {
    const siteFile = path.join(path.dirname(dir), 'vault.config.json');
    const own = path.join(dir, 'vault.config.json');
    const file = fs.existsSync(own) ? own : (fs.existsSync(siteFile) ? siteFile : null);
    return { id, vaultPath: dir, siteConfig: file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} };
  });
}

function cases() {
  const out = [...fixtureVaults()];
  const add = (id, publishYaml, siteConfig = {}) => out.push({ id, publishYaml, siteConfig });
  // One case per [label, yaml value] under `publish.<key>`.
  const each = (key, values) => { for (const [label, v] of values) add(`${slug(key)}-${slug(label)}`, pub(`${key}: ${v}`)); };

  add('empty-vault', null);
  add('no-publish-key', 'title: nothing here\n');

  const switchValues = [['true', 'true'], ['false', 'false'], ['yes', 'yes'], ['no', 'no'], ['on', 'on'], ['off', 'off'],
    ['quoted-true', '"true"'], ['quoted-yes-upper', '"YES"'], ['padded-on', '" on "'], ['maybe', 'maybe'], ['one', '1'], ['empty', '']];
  for (const key of ['site', 'character_sheets', 'live_stats', 'inbox', 'search']) each(key, switchValues);

  each('mode', [['player', 'player'], ['full', 'full'], ['capital-player', 'Player'], ['padded-full', '" full "'],
    ['players', 'players'], ['empty', ''], ['true', 'true']]);

  const wordCases = (words) => [
    ...words.flatMap((w) => [[w, w], [`${w}-capitalised`, w[0].toUpperCase() + w.slice(1)], [`${w}-padded`, `"  ${w} "`]]),
    ['unknown-word', 'sideways'], ['number', '7'], ['list', '[tree, web]'],
  ];
  each('link_previews', wordCases(['on', 'desktop', 'off', 'yes', 'no', 'true', 'false']));
  each('tohit_calculator', wordCases(['on', 'off', 'yes', 'no', 'true', 'false']));
  each('connections', wordCases(['tree', 'web', 'cards', 'off', 'on', 'yes', 'no', 'true', 'false']));

  const listShapes = [['unset', null], ['empty-list', '[]'], ['two-entries', '[Alpha, Beta]'], ['bare-string', 'Alpha'], ['empty', '']];
  const siteKey = { exclude_sections: 'excludeSections', exclude_fields: 'excludeFields', exclude_dirs: 'excludeDirs' };
  for (const key of Object.keys(siteKey)) {
    for (const [label, v] of listShapes) {
      const yaml = v === null ? BASE : pub(`${key}: ${v}`);
      add(`${key}-${label}`, yaml);
      add(`${key}-${label}-with-site-list`, yaml, { [siteKey[key]]: ['Alpha', 'Gamma'] });
    }
  }
  for (const [label, v] of [['trailing-slash', 'Secrets/'], ['dot-slash', './Secrets'], ['backslash', 'Secrets\\Deep'],
    ['absolute-inside', '{{vault}}/Secrets'], ['absolute-outside', '/somewhere/else/Secrets']]) {
    add(`exclude_dirs-entry-${label}`, pub(`exclude_dirs: [${v}]`));
  }

  for (const key of Object.keys(siteKey)) add(`${key}-entry-number-and-boolean`, pub(`${key}: [Alpha, 3, true]`));

  const calloutVault = [['unset', null], ['true', 'true'], ['false', 'false'], ['list', '[note, tip]'], ['empty', ''],
    ['bare-no', 'no'], ['bare-off', 'off'], ['quoted-false', '"false"'], ['maybe', 'maybe'], ['one', '1'],
    ['list-of-number', '[1]'], ['list-with-number', '[note, 2]']];
  const calloutSite = [['site-true', { excludeCallouts: true }], ['site-list', { excludeCallouts: ['warning'] }], ['site-unset', {}]];
  for (const [vl, v] of calloutVault) {
    for (const [sl, s] of calloutSite) add(`exclude_callouts-${vl}-${sl}`, v === null ? BASE : pub(`exclude_callouts: ${v}`), s);
  }

  each('exclude_drafts', [['true', 'true'], ['false', 'false'], ['quoted-false', '"false"'], ['no', 'no'], ['yes', 'yes'],
    ['maybe', 'maybe'], ['off', 'off'], ['one', '1'], ['list', '[a, b]']]);

  const nested = (key, label, ...lines) => add(`${key}-${label}`, pub(`${key}:`, lines.map((l) => `  ${l}`)));
  nested('images', 'optimize-true', 'optimize: true');
  nested('images', 'optimize-yes', 'optimize: yes');
  nested('images', 'optimize-quoted-true', 'optimize: "true"');
  nested('images', 'max-width-zero', 'max_width: 0');
  nested('images', 'max-width-camel', 'maxWidth: 800');
  nested('images', 'quality-150', 'quality: 150');
  nested('images', 'format-png', 'format: png');

  for (const knob of ['recency_window', 'max_npcs', 'max_locations']) {
    for (const [label, v] of [['zero', '0'], ['three', '3'], ['quoted-three', '"3"'], ['lots', 'lots']]) nested('landing', `${knob}-${label}`, `${knob}: ${v}`);
  }
  nested('landing', 'featured-npcs-list', 'featured_npcs: [Vex, Mara]');
  nested('landing', 'featured-npcs-string', 'featured_npcs: Vex');
  add('landing-site-extra-subkey', pub('landing:', '  max_npcs: 3'), { landing: { max_locations: 2 } });

  for (const g of ['horror', 'sci-fi', 'gothic']) nested('theme', `genre-${g}`, `genre: ${g}`);
  nested('theme', 'palette-one-colour', 'palette:', '  primary: "#112233"');
  for (const s of ['google', 'self-host', 'local', 'gogle']) nested('theme', `fonts-source-${s}`, 'fonts:', `  source: ${s}`);
  for (const [label, v] of [['capital-local', 'Local'], ['capital-self-host', 'Self-Host'], ['padded-google', '" google "']]) {
    nested('theme', `fonts-source-${label}`, 'fonts:', `  source: ${v}`);
  }
  for (const [label, m] of [['dark', 'dark'], ['capital-dark', 'Dark'], ['dim', 'dim']]) nested('theme', `default-mode-${label}`, `default_mode: ${m}`);

  nested('overrides', 'good-fields', 'fields:', '  "Characters/NPCs/Vex.md":', '    include: [secrets]');
  nested('overrides', 'fields-false', 'fields: false');
  nested('overrides', 'fields-list', 'fields: [a, b]');
  nested('overrides', 'include-string', 'fields:', '  "Characters/NPCs/Vex.md":', '    include: secrets');
  nested('overrides', 'exclude-key', 'exclude: [secrets]');

  for (const [key, ids] of [['sheet_skin', [...Object.keys(SKINS), 'none']], ['sheet_frame', ['none', ...FRAME_IDS]]]) {
    each(key, [...[...new Set(ids)].map((id) => [id, id]), ['unknown', 'nonesuch'], ['hundred-chars', 'x'.repeat(100)]]);
  }

  each('pc_prose_sections', [['list', '[Background, Notes]'], ['string', 'Background'], ['list-with-number', '[Background, 3]']]);

  add('backend-vault', pub('backend:', '  statusBar: true'));
  add('backend-site', BASE, { backend: { statusBar: true } });
  add('backend-both-differ', pub('backend:', '  statusBar: false'), { backend: { statusBar: true } });
  each('backend', [['yes', 'yes']]);

  each('folder_map', [['good', '{npcs: Cast}'], ['wrong-type', 'Characters']]);
  each('banners', [['good', '{npcs: banner.png}'], ['wrong-type', '[banner.png]']]);
  each('locations', [['good', '{group_by: region}'], ['wrong-type', 'region']]);
  each('section_titles', [['good', '{npcs: Cast}'], ['wrong-type', 'Cast']]);
  each('four_oh_four', [['good', '{style: plain, message: Gone}'], ['wrong-type', 'Gone']]);

  add('setting-year', `setting_year: 1925\n${BASE}`);

  each('exclude_sectoins', [['list', '[Alpha]']]);
  each('link_preview', [['off', 'off']]);
  nested('theme', 'gnere', 'gnere: horror');
  nested('landing', 'max-npc', 'max_npc: 3');
  each('imagse', [['map', '{optimize: true}']]);

  // Quoted strings: YAML reads a bare True/False as a boolean, so only quotes test the text.
  const quoted = ['"true"', '"false"', '"True"', '"FALSE"', '" false "', '"yes"', '"no"', '"on"', '"off"'];
  for (const key of ['link_previews', 'tohit_calculator', 'connections']) {
    each(key, quoted.map((q) => [`string-${q.replace(/"/g, '').replace(/ /g, 'pad') || 'x'}${/[A-Z]/.test(q) ? '-upper' : ''}`, q]));
  }

  nested('theme', 'default-mode-list', 'default_mode: [dark]');
  nested('theme', 'default-mode-boolean', 'default_mode: true');
  nested('theme', 'default-mode-empty', 'default_mode:');

  // Frontmatter that is not a valid block: the load throws, or the shape is wrong.
  const addRaw = (id, rawFile) => out.push({ id, rawFile, siteConfig: {} });
  addRaw('broken-yaml', '---\ntype: meta\npublish: [unclosed\n  mode: : :\n---\n');
  // A hiding setting in the wrong place: one level too deep, or beside `publish:` (main said nothing).
  nested('theme', 'exclude-sections-too-deep', 'exclude_sections: [Secrets]');
  nested('landing', 'exclude-drafts-too-deep', 'exclude_drafts: true');
  nested('images', 'exclude-fields-too-deep', 'exclude_fields: [secret]');
  add('hide-group', pub('mode: player', 'hide: [GM Notes]'));
  addRaw('beside-publish-exclude-sections', '---\ntype: meta\nexclude_sections: [Secrets]\npublish:\n  mode: player\n---\n');
  addRaw('beside-publish-exclude-drafts', '---\ntype: meta\nexclude_drafts: true\npublish:\n  mode: player\n---\n');
  add('publish-scalar', 'publish: yes\n');
  add('publish-list', 'publish:\n  - mode\n  - full\n');

  // Switch interactions across the two files.
  const dir = '/somewhere/else/Site';
  add('site-dir-site-unset', pub(`site_dir: ${dir}`));
  add('site-dir-site-false', pub(`site_dir: ${dir}`, 'site: false'));
  add('site-dir-site-true', pub(`site_dir: ${dir}`, 'site: true'));
  add('site-dir-empty', pub('site_dir:'));
  add('backend-inbox-vault', pub('backend:', '  inbox: true'));
  add('backend-inbox-site', BASE, { backend: { inbox: true } });
  add('backend-statusbar-site-live-stats-vault-true', pub('live_stats: true'), { backend: { statusBar: false } });
  add('backend-statusbar-site-live-stats-vault-false', pub('live_stats: false'), { backend: { statusBar: true } });
  add('character-sheets-off-live-stats-on', pub('character_sheets: false', 'live_stats: true'));

  // Moved scalars: vault file, site file under the old JSON name, and both with different values.
  for (const [pk, jk, a, b] of [['site_title', 'siteTitle', 'Vault Title', 'Site Title'], ['footer', 'footer', 'Vault footer', 'Site footer'],
    ['attachments_dir', 'attachmentsDir', 'vault-files', 'site-files'], ['system', 'system', 'coc', 'gurps'],
    ['sheet_crest', 'sheet_crest', 'vault-crest.png', 'site-crest.png']]) {
    add(`moved-${slug(pk)}-vault`, pub(`${pk}: ${a}`));
    add(`moved-${slug(pk)}-site`, BASE, { [jk]: b });
    add(`moved-${slug(pk)}-both`, pub(`${pk}: ${a}`), { [jk]: b });
  }
  // The site file's old tagline name is reported and not read (main never put it on a page).
  add('landing-tagline-site-only', BASE, { landingTagline: 'Tagline from the site file' });
  add('landing-tagline-site-and-vault', pub('theme:', '  tagline: Vault tagline'), { landingTagline: 'Tagline from the site file' });
  add('search-enabled-site-true', BASE, { searchEnabled: true });
  add('search-enabled-site-false', BASE, { searchEnabled: false });
  add('search-vault-true-site-false', pub('search: true'), { searchEnabled: false });
  add('search-vault-false-site-true', pub('search: false'), { searchEnabled: true });

  // Image numbers and switch words that cannot be read, and a genre the list does not know.
  nested('images', 'quality-high', 'quality: high');
  nested('images', 'quality-negative', 'quality: -10');
  nested('images', 'quality-empty', 'quality:');
  nested('images', 'max-width-wide', 'max_width: wide');
  nested('images', 'max-width-negative', 'max_width: -800');
  nested('images', 'max-width-fractional', 'max_width: 800.5');
  nested('images', 'optimize-one', 'optimize: 1');
  nested('theme', 'genre-weird', 'genre: weird');
  nested('theme', 'genre-weird-with-palette', 'genre: weird', 'palette:', '  primary: "#112233"');
  nested('theme', 'genre-sci-fi-capitalised', 'genre: Sci-Fi');
  nested('landing', 'zero-window-and-npcs', 'recency_window: 0', 'max_npcs: 0');

  // Both files set a merged map: the vault file wins a sub-key both set, the site file adds the rest.
  add('merge-images', pub('images:', '  quality: 70'), { images: { quality: 50, format: 'png' } });
  add('merge-banners', pub('banners:', '  npcs: a.png'), { banners: { npcs: 'z.png', locations: 'b.png' } });
  add('merge-locations', pub('locations:', '  group_by: region'), { locations: { group_by: 'type', sort: 'name' } });

  // An override key typed in decomposed Unicode (e + combining acute); the build looks pages up composed.
  nested('overrides', 'nfd-key', 'fields:', '  "Characters/NPCs/Rene\u0301.md":', '    include: [secrets]');

  const seen = new Set();
  for (const c of out) {
    if (!/^[a-z0-9_-]+$/.test(c.id)) throw new Error(`case id not safe as a file name: ${c.id}`);
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    seen.add(c.id);
  }
  return out;
}

module.exports = { cases };
