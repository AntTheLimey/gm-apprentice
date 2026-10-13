'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const matter = require('gray-matter');
const { planMove, applyMove, isBoilerplate } = require('../lib/settings/move');
const { runSettings } = require('../lib/settings/cli');
const { readSettings } = require('../lib/settings/read');
const { readState } = require('../lib/settings/state');
const { layoutOf, at, NEW_FILE, OLD_FILE, NOTES_FILE, STATE_FILE } = require('../lib/settings/layout');
const { loadPublishConfig } = require('../lib/config');
const { build } = require('../lib/build');
const { prepareFixture } = require('./helpers/fixture-build');

const FIXTURES = path.join(__dirname, 'fixtures');
const REPO_TESTS = path.join(__dirname, '..', '..', '..', 'tests');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'move-'));
const quiet = () => {};

// A vault with the old file holding `text`, plus optional other files; a site file when `site` is given.
function scratch(text, { site = null, files = {} } = {}) {
  const root = tmp();
  const vault = path.join(root, 'Vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (text !== null) fs.writeFileSync(at(vault, OLD_FILE), text);
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(at(vault, rel), body);
  let config = null;
  if (site) {
    config = path.join(root, 'vault.config.json');
    fs.writeFileSync(config, typeof site === 'string' ? site : JSON.stringify(site, null, 2));
  }
  return { root, vault, config };
}
const old = (publishLines, top = '') => `---\ntype: meta\n${top}publish:\n${publishLines}---\n`;

// Hashes of every file under a folder, by relative path.
function hashes(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(dir, f)] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    }
  }(dir));
  return out;
}

const strip = (c) => { const { faults, origins, legacy, ...rest } = c; return rest; };

// Moves a scratch vault and returns what it was before and after, read the build's way.
function moveAndCompare(s) {
  const site = s.config ? JSON.parse(fs.readFileSync(s.config, 'utf8')) : {};
  const before = strip(loadPublishConfig(s.vault, site, quiet));
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.ok, true);
  const done = applyMove(plan);
  assert.equal(done.moved, true);
  assert.equal(layoutOf(s.vault), 'new');
  assert.equal(fs.existsSync(at(s.vault, OLD_FILE)), false);
  const siteAfter = s.config ? JSON.parse(fs.readFileSync(s.config, 'utf8')) : {};
  const after = strip(loadPublishConfig(s.vault, siteAfter, quiet));
  assert.deepEqual(after, before);
  return { before, after, plan, done, siteAfter };
}

function cliMove(args, extra = {}) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb: 'move', args: [], json: true, ...args, ...extra }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, data: out.length ? JSON.parse(out.join('\n')) : null, err };
}

// ---- The fixtures ----

const fixtureVaults = [];
for (const name of fs.readdirSync(FIXTURES)) {
  const dir = path.join(FIXTURES, name);
  if (fs.existsSync(at(dir, OLD_FILE))) fixtureVaults.push([`fixture ${name}`, dir]);
}
for (const rel of ['benchmark-campaign', 'fixtures/slice-b/index', 'fixtures/slice-a/version-behind', 'fixtures/slice-a/wrapup', 'fixtures/slice-a/leak']) {
  const dir = path.join(REPO_TESTS, ...rel.split('/'));
  if (fs.existsSync(at(dir, OLD_FILE))) fixtureVaults.push([`tests/${rel}`, dir]);
}

test('there are eleven fixture vaults to move', () => {
  assert.equal(fixtureVaults.filter(([n]) => n.startsWith('fixture ')).length, 11);
});

for (const [label, dir] of fixtureVaults) {
  test(`${label} moves and resolves what it resolved before; a second run does nothing`, () => {
    const root = tmp();
    const vault = path.join(root, 'Vault');
    fs.cpSync(dir, vault, { recursive: true });
    const { before } = moveAndCompare({ root, vault, config: null });
    assert.deepEqual(strip(loadPublishConfig(vault, {}, quiet)), before);
    const again = planMove({ vaultPath: vault });
    assert.equal(again.ok, true);
    assert.deepEqual(again.files, { write: [], remove: [] });
    assert.equal(applyMove(again).moved, false);
    const r = cliMove({ vault });
    assert.equal(r.rc, 0);
    assert.equal(r.data.moved, false);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

// ---- Blockers ----

test('a blocker writes nothing and says why in one line', () => {
  const cases = [
    ['not valid YAML', '---\ntype: meta\npublish:\n  mode: [unclosed\n---\n', /not valid YAML/],
    ['a stop fault', old('  exclude_sections: not-a-list-but-"quoted"\n  mode: nonsense\n'), /./],
    ['a hiding name beside publish', `---\ntype: meta\nexclude_sections: [a]\npublish:\n  mode: player\n---\n`, /exclude_sections/],
    ['an unknown name under publish', old('  mode: player\n  themee:\n    genre: horror\n'), /publish\.themee is not a setting; run the Settings check/],
    ['a value that cannot be carried', old('  connections: sideways\n'), /connections/],
    ['an empty switch', old('  site:\n'), /publish\.site/],
  ];
  for (const [label, text, pattern] of cases) {
    const s = scratch(text);
    const before = hashes(s.root);
    const plan = planMove({ vaultPath: s.vault });
    assert.equal(plan.ok, false, label);
    assert.ok(plan.blockers.length >= 1, label);
    assert.ok(plan.blockers.some((b) => pattern.test(b)), `${label}: ${plan.blockers.join(' | ')}`);
    assert.deepEqual(plan.files, { write: [], remove: [] });
    assert.throws(() => applyMove(plan), /blocked/);
    const r = cliMove({ vault: s.vault });
    assert.equal(r.rc, 1, label);
    assert.equal(r.data.ok, false);
    assert.deepEqual(hashes(s.root), before, label);
  }
});

test('a notes file already there is a blocker', () => {
  const s = scratch(old('  mode: player\n'), { files: { [NOTES_FILE]: '---\ntype: meta\n---\nmine\n' } });
  const plan = planMove({ vaultPath: s.vault });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0], /vault-notes\.md already exists/);
});

test('an unreadable site file is a blocker', () => {
  const s = scratch(old('  mode: player\n'), { site: '{ not json' });
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0], /could not be read as JSON/);
});

test('an empty key is not set and not carried, except on a switch, which blocks', () => {
  const s = scratch(old('  mode: player\n  site_title:\n'));
  const { plan } = moveAndCompare(s);
  assert.ok(plan.lines.some((l) => l.includes('`publish.site_title` was empty')));
  assert.ok(!fs.readFileSync(at(s.vault, NEW_FILE), 'utf8').includes('title'));
  const sw = scratch(old('  inbox:\n'));
  const p = planMove({ vaultPath: sw.vault });
  assert.equal(p.ok, false);
  assert.match(p.blockers.join(' '), /publish\.inbox/);
});

// ---- Exactness ----

test('written and left-out settings stay what they were, switches included', () => {
  const s = scratch(old('  site: true\n  site_dir: docs\n  search: false\n  character_sheets: true\n  live_stats: false\n'));
  const { before, after } = moveAndCompare(s);
  assert.deepEqual(after.switches, before.switches);
  assert.deepEqual(after.switches.unset, ['inbox']);
  const text = fs.readFileSync(at(s.vault, NEW_FILE), 'utf8');
  assert.ok(!text.includes('inbox'));
  assert.ok(text.includes('live_stats: false'));
});

test('a setting left at its default is not written, and one written at the default stays written', () => {
  const s = scratch(old('  connections: tree\n'));
  const { after } = moveAndCompare(s);
  assert.equal(after.connections, 'tree');
  assert.match(fs.readFileSync(at(s.vault, NEW_FILE), 'utf8'), /connections: tree/);
});

test('the site file is merged in, then loses its setting keys and keeps the rest', () => {
  const site = {
    vaultPath: './Vault', host: 'cloudflare', siteUrl: 'https://x.example', outputDir: './docs', cloudflarePagesProject: 'p', preserveDirs: ['keep'],
    campaignImage: 'a.png', fourOhFour: { x: 1 }, landingTagline: 'unread', siteTitle: 'From the site', footer: 'Foot', excludeSections: ['Extra Secret'],
    backend: { statusBar: true, inbox: false }, attachmentsDir: 'att', folderMap: { A: 'a' },
  };
  const s = scratch(old('  mode: player\n'), { site });
  const { before, siteAfter, plan } = moveAndCompare(s);
  assert.equal(before.site_title, 'From the site');
  assert.ok(before.exclude_sections.includes('Extra Secret'));
  assert.ok(before.exclude_sections.length > 1, 'the built-in list is still there (#371)');
  assert.deepEqual(siteAfter, {
    vaultPath: './Vault', host: 'cloudflare', siteUrl: 'https://x.example', outputDir: './docs', cloudflarePagesProject: 'p', preserveDirs: ['keep'],
    campaignImage: 'a.png', fourOhFour: { x: 1 }, landingTagline: 'unread',
  });
  assert.ok(plan.lines.some((l) => l.includes('siteTitle')));
  assert.ok(!plan.lines.some((l) => l.includes('landingTagline')), 'landingTagline is left alone and not mentioned');
  assert.deepEqual(readSettings({ vaultPath: s.vault, siteConfig: siteAfter }).faults.filter((f) => f.level === 'stop'), []);
});

test('old spellings are carried to the new name, with a line saying so', () => {
  const s = scratch(old('  backend:\n    statusBar: true\n  character_sheets: true\n  images:\n    maxWidth: 800\n'));
  const { plan, before } = moveAndCompare(s);
  assert.equal(before.switches.liveStats, true);
  const text = fs.readFileSync(at(s.vault, NEW_FILE), 'utf8');
  assert.match(text, /live_stats: true/);
  assert.match(text, /max_width: 800/);
  assert.ok(plan.lines.some((l) => l.includes('`publish.backend.statusBar` is now `player_site.features.live_stats`')));
  assert.ok(plan.lines.some((l) => l.includes('`publish.images.maxWidth` is now `player_site.images.max_width`')));
});

test('retired settings are dropped with a line each', () => {
  const s = scratch(old('  mode: player\n  four_oh_four:\n    style: in-world\n  total_sessions: 5\n'));
  const { plan } = moveAndCompare(s);
  assert.ok(plan.lines.includes('`publish.four_oh_four.style: in-world` is no longer used and was not carried over.'));
  assert.ok(plan.lines.includes('`publish.total_sessions: 5` is no longer used and was not carried over.'));
  assert.ok(!fs.readFileSync(at(s.vault, NEW_FILE), 'utf8').includes('four_oh_four'));
});

test('a vault with no site file moves, and a notes-only vault moves', () => {
  const s = scratch('---\ntype: meta\ndescription: just notes\n---\n\nSome prose of mine.\n');
  moveAndCompare(s);
  assert.equal(fs.readFileSync(at(s.vault, NEW_FILE), 'utf8'), 'version: 1\n');
  const notes = matter(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), {});
  assert.deepEqual(notes.data, { type: 'meta', description: 'just notes' });
  assert.equal(notes.content, '\nSome prose of mine.\n');
});

// ---- Comments, state, notes ----

test('comments on key lines in the publish block are carried to the same key', () => {
  const s = scratch(old([
    '  # how much shows',
    '  mode: player # inline one',
    '  # which headings to hide',
    '  exclude_sections: [Secrets, "GM Notes"] # tail',
    '  exclude_fields:',
    '    - hidden # one',
    '    # before two',
    '    - other',
    '',
  ].join('\n')));
  const { plan } = moveAndCompare(s);
  const text = fs.readFileSync(at(s.vault, NEW_FILE), 'utf8');
  assert.match(text, /# how much shows\n\s+mode: player # inline one/);
  assert.match(text, /# which headings to hide\n\s+sections: \[Secrets, "GM Notes"\] # tail/);
  assert.match(text, /- hidden # one\n\s+# before two\n\s+- other/);
  assert.deepEqual(plan.lines.filter((l) => l.startsWith('a comment could not')), []);
});

test('the groups come out as version, vault, player_site, and a comment above type is kept in the notes', () => {
  const s = scratch('---\n# a note on the type\ntype: meta\ndescription: d\npublish:\n  site_title: T\nsetting_year: 1930\n---\n');
  moveAndCompare(s);
  const text = fs.readFileSync(at(s.vault, NEW_FILE), 'utf8');
  assert.ok(text.startsWith('version: 1\n\nvault:\n  setting_year: 1930\n\nplayer_site:\n  title: T\n'), text);
  assert.match(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), /^---\n# a note on the type\ntype: meta\n/);
});

test('a comment that cannot be placed is listed and kept in the notes, under its key, after the GM\'s own text', () => {
  const s = scratch(old('  # about the theme block\n  theme:\n    genre: horror\n  mode: player\n'));
  const { plan } = moveAndCompare(s);
  assert.ok(plan.lines.some((l) => /a comment could not be carried into the new file \(it sat on publish\.theme\)/.test(l) && l.includes('about the theme block')), plan.lines.join('\n'));
  const notes = fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8');
  assert.match(notes, /## Comments from the old settings file\n\n- `publish\.theme`: about the theme block\n$/);
  // With prose of the GM's own, the prose comes first and is kept exactly.
  const t = scratch(`---\ntype: meta\npublish:\n  # about the theme block\n  theme:\n    genre: horror\n---\nMy own prose.\nNo final newline`);
  moveAndCompare(t);
  const kept = fs.readFileSync(at(t.vault, NOTES_FILE), 'utf8');
  assert.ok(kept.includes('---\nMy own prose.\nNo final newline\n\n## Comments from the old settings file\n'), kept);
});

test('a site-file hiding list merged into the vault\'s says its entries were added, not that it was ignored', () => {
  const s = scratch(old('  exclude_sections: [A]\n'), { site: { vaultPath: './Vault', excludeSections: ['A', 'Z'] } });
  const { plan } = moveAndCompare(s);
  const line = plan.lines.find((l) => l.includes('merged into'));
  assert.ok(line && /merged into publish\.exclude_sections/.test(line) && line.includes('"Z"') && !/ignored/.test(line), plan.lines.join('\n'));
  const t = scratch(old('  site_title: V\n'), { site: { vaultPath: './Vault', siteTitle: 'S' } });
  const plan2 = moveAndCompare(t).plan;
  assert.ok(plan2.lines.some((l) => /siteTitle` in the site folder's vault\.config\.json was not used, because the vault's own settings already had publish\.site_title/.test(l)), plan2.lines.join('\n'));
});

test('setup_progress and the version go to the state file, which keeps what it had', () => {
  const s = scratch(`---\ntype: meta\ngm_apprentice_version: "1.10.20"\npublish:\n  mode: player\n  setup_progress:\n    step: 3\n---\n`, { files: { [STATE_FILE]: '{"other": 1}\n' } });
  moveAndCompare(s);
  assert.deepEqual(readState(s.vault), { other: 1, gm_apprentice_version: '1.10.20', setup: { step: 3 } });
  assert.ok(!fs.readFileSync(at(s.vault, NEW_FILE), 'utf8').includes('setup'));
});

test('a body that is only the scaffold gives no notes file', () => {
  const body = '\n# Vault Configuration\n\nCampaign: The Hollow\n\n## Vault Structure\n\nThe layout this vault started from. Folders may be added or renamed.\n\n```text\nVault/\n  Characters/\n```\n';
  assert.equal(isBoilerplate(body), true);
  const s = scratch(`---\ntype: meta\ngm_apprentice_version: "1.10.29"\npublish:\n  site: false\n---\n${body}`);
  const { plan } = moveAndCompare(s);
  assert.equal(fs.existsSync(at(s.vault, NOTES_FILE)), false);
  assert.ok(!plan.files.write.some((f) => f.endsWith('vault-notes.md')));
});

test('a body with one extra paragraph gives a notes file holding the whole body', () => {
  const body = '\n# Vault Configuration\n\nCampaign: The Hollow\n\n## Vault Structure\n\nThe layout this vault started from.\n\n```text\nVault/\n```\n\nI keep handouts in Props, not Documents.\n';
  assert.equal(isBoilerplate(body), false);
  const s = scratch(`---\ntype: meta\nlast_updated: 2026-01-02\nchangelog:\n  - date: 2026-01-02\n    note: "first"\npublish:\n  site: false\n---\n${body}`);
  moveAndCompare(s);
  const notes = matter(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), {});
  assert.equal(notes.content, body.replace(/^\n/, '') === notes.content ? notes.content : body);
  assert.ok(notes.content.includes('# Vault Configuration') && notes.content.includes('I keep handouts in Props'));
  const original = matter(`---\ntype: meta\nlast_updated: 2026-01-02\nchangelog:\n  - date: 2026-01-02\n    note: "first"\npublish:\n  site: false\n---\n${body}`, {});
  assert.equal(notes.content, original.content);
  assert.deepEqual(notes.data, { type: 'meta', last_updated: original.data.last_updated, changelog: original.data.changelog });
  assert.match(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), /last_updated: 2026-01-02\n/);
});

test('a link in campaign is not carried to vault.campaign but stays in the notes; plain text is carried', () => {
  const s = scratch('---\ntype: meta\ncampaign: "[[Campaign Overview]]"\npublish:\n  mode: player\n---\n');
  moveAndCompare(s);
  assert.ok(!fs.readFileSync(at(s.vault, NEW_FILE), 'utf8').includes('campaign'));
  assert.equal(matter(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), {}).data.campaign, '[[Campaign Overview]]');
  const t = scratch('---\ntype: meta\ncampaign: The Hollow\ngame_system: gurps-4e\npublish:\n  mode: player\n---\n');
  const plan = planMove({ vaultPath: t.vault });
  assert.equal(plan.ok, true);
  applyMove(plan);
  const now = readSettings({ vaultPath: t.vault });
  assert.equal(now.values.vault.campaign, 'The Hollow');
  assert.equal(now.values.vault.system, 'gurps-4e');
  assert.equal(fs.existsSync(at(t.vault, NOTES_FILE)), false);
});

test('--fill gives campaign and system only where unset, and nothing else', () => {
  const s = scratch(old('  mode: player\n'));
  const plan = planMove({ vaultPath: s.vault, fill: { 'vault.campaign': 'Filled', 'vault.system': 'coc-7e' } });
  assert.equal(plan.ok, true);
  applyMove(plan);
  const v = readSettings({ vaultPath: s.vault }).values.vault;
  assert.equal(v.campaign, 'Filled');
  assert.equal(v.system, 'coc-7e');
  const t = scratch(old('  system: gurps-4e\n'));
  const p2 = planMove({ vaultPath: t.vault, fill: { 'vault.system': 'coc-7e' } });
  assert.ok(p2.lines.some((l) => l.includes('vault.system is already set')));
  applyMove(p2);
  assert.equal(readSettings({ vaultPath: t.vault }).values.vault.system, 'gurps-4e');
  const bad = planMove({ vaultPath: scratch(old('  mode: player\n')).vault, fill: { 'player_site.title': 'x' } });
  assert.equal(bad.ok, false);
  assert.match(bad.blockers[0], /--fill takes only vault\.campaign and vault\.system/);
  const worse = planMove({ vaultPath: scratch(old('  mode: player\n')).vault, fill: { 'vault.system': 'not-a-system' } });
  assert.equal(worse.ok, false);
});

// ---- All or nothing ----

test('--check writes nothing', () => {
  const s = scratch(old('  mode: player\n  exclude_sections: [A]\n'), { site: { vaultPath: './Vault', siteTitle: 'T' } });
  const before = hashes(s.root);
  const r = cliMove({ vault: s.vault, config: s.config }, { check: true });
  assert.equal(r.rc, 0);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.moved, false);
  assert.ok(r.data.files.write.length >= 1 && r.data.files.remove.length === 1);
  assert.deepEqual(hashes(s.root), before);
  const real = cliMove({ vault: s.vault, config: s.config });
  assert.equal(real.rc, 0);
  assert.equal(real.data.moved, true);
  assert.equal(layoutOf(s.vault), 'new');
});

test('a failure at the verify step leaves the vault byte for byte as it was', () => {
  const s = scratch(old('  mode: player\n  exclude_sections: [A]\n'), { site: { vaultPath: './Vault', siteTitle: 'T', excludeSections: ['Z'] } });
  const before = hashes(s.root);
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  assert.equal(plan.ok, true);
  const lying = (opts) => {
    const r = readSettings(opts);
    r.values.player_site.title = 'Not what it was';
    return r;
  };
  assert.throws(() => applyMove(plan, { readSettings: lying }), /player_site\.title would not come out the same/);
  assert.deepEqual(hashes(s.root), before);
});

test('a failure part-way through the renames puts every file back', () => {
  const s = scratch(old('  mode: player\n', 'gm_apprentice_version: "1.10.1"\n'), { site: { vaultPath: './Vault', siteTitle: 'T' }, files: { [STATE_FILE]: '{"other": 1}\n' } });
  const before = hashes(s.root);
  for (let failAt = 1; failAt <= 6; failAt++) {
    const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
    assert.equal(plan.ok, true);
    let n = 0;
    const rename = (a, b) => { n += 1; if (n === failAt) throw new Error('disk said no'); fs.renameSync(a, b); };
    if (failAt > 4) { // four renames in all (state one, settings one, site one, old file one): past them the move has finished
      const r = applyMove(plan, { rename });
      assert.equal(r.moved, true);
      assert.equal(n, 4);
      return;
    }
    assert.throws(() => applyMove(plan, { rename }), /did not go through \(disk said no\); nothing was changed/, `fail at rename ${failAt}`);
    assert.deepEqual(hashes(s.root), before, `fail at rename ${failAt}`);
  }
});

test('a file changed after the plan stops the move', () => {
  const s = scratch(old('  mode: player\n'));
  const plan = planMove({ vaultPath: s.vault });
  fs.appendFileSync(at(s.vault, OLD_FILE), 'changed\n');
  assert.throws(() => applyMove(plan), /changed since the move was planned/);
});

// ---- The command ----

test('the command moves a vault, prints plain lines, and is a no-op the second time', () => {
  const s = scratch(old('  mode: player\n'));
  const out = [];
  const rc = runSettings({ verb: 'move', args: [], vault: s.vault, fill: ['vault.campaign=Cmd Campaign'] }, { out: (l) => out.push(l), err: () => {} });
  assert.equal(rc, 0);
  assert.match(out.join('\n'), /Wrote _meta\/vault-config\.yaml/);
  assert.equal(readSettings({ vaultPath: s.vault }).values.vault.campaign, 'Cmd Campaign');
  const again = [];
  assert.equal(runSettings({ verb: 'move', args: [], vault: s.vault }, { out: (l) => again.push(l), err: () => {} }), 0);
  assert.match(again.join('\n'), /already on the new settings file/);
});

test('a blank --fill is a blocker for both fillable names, and nothing is written', () => {
  for (const name of ['vault.campaign', 'vault.system']) {
    for (const pair of [name, `${name}=`, `${name}=   `]) {
      const s = scratch(old('  mode: player\n'));
      const before = hashes(s.vault);
      const out = [];
      const rc = runSettings({ verb: 'move', args: [], vault: s.vault, fill: [pair] }, { out: (l) => out.push(l), err: () => {} });
      assert.equal(rc, 1, pair);
      assert.match(out.join('\n'), new RegExp(`--fill ${name.replace('.', '\\.')} needs a value`), pair);
      assert.deepEqual(hashes(s.vault), before, pair);
      assert.equal(layoutOf(s.vault), 'legacy', pair);
    }
  }
});

// ---- The built site does not change ----

function tree(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out[path.relative(dir, f)] = fs.readFileSync(f);
    }
  }(dir));
  return out;
}

test('the built site of with-landing-config is identical before and after the move', () => {
  const run = (doMove) => {
    const root = tmp();
    const configPath = prepareFixture('with-landing-config', root);
    if (doMove) {
      const vault = path.join(root, 'vault');
      const plan = planMove({ vaultPath: vault, siteConfigPath: configPath });
      assert.deepEqual(plan.blockers, []);
      applyMove(plan);
      assert.equal(layoutOf(vault), 'new');
    }
    const log = console.log; const warn = console.warn;
    console.log = quiet; console.warn = quiet;
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    return { root, files: tree(path.join(root, 'docs')) };
  };
  const a = run(false);
  const b = run(true);
  assert.deepEqual(Object.keys(b.files).sort(), Object.keys(a.files).sort());
  for (const f of Object.keys(a.files)) {
    const norm = (buf, root) => buf.toString('utf8').split(root).join('<root>');
    assert.equal(norm(b.files[f], b.root), norm(a.files[f], a.root), f);
  }
});

// ---- Review fixes, round 1 ----

test('a CRLF old file moves exactly, with a quoted or a flow-list last line, and the notes keep the body\'s CRLF', () => {
  const body = '\r\n## Naming\r\n\r\nMy own words.\r\n';
  for (const last of ['gm_apprentice_version: "1.10.50"', 'tags: [a, b]']) {
    const s = scratch(`---\r\ntype: meta\r\npublish:\r\n  mode: player\r\n${last}\r\n---\r\n${body}`);
    moveAndCompare(s);
    const notes = fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8');
    assert.ok(notes.endsWith(body), last);
  }
  const t = scratch('---\r\ntype: meta\r\npublish:\r\n  exclude_sections: [A, B]\r\n---\r\n');
  moveAndCompare(t);
});

test('an old file with no frontmatter, or an empty one, moves with its whole body in the notes', () => {
  for (const text of ['# Just text\n\nSome prose.\n', '---\n---\n# Just text\n']) {
    const s = scratch(text);
    const { before } = moveAndCompare(s);
    assert.equal(before.mode !== undefined, true);
    assert.equal(fs.readFileSync(at(s.vault, NEW_FILE), 'utf8'), 'version: 1\n');
    const notes = matter(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), {});
    assert.deepEqual(notes.data, { type: 'meta' });
    assert.ok(notes.content.includes('# Just text'));
  }
});

test('a site file that belongs to another vault, or names none, is refused and nothing is written', () => {
  const s = scratch(old('  mode: player\n'), { site: { vaultPath: './Elsewhere', siteTitle: 'Theirs' } });
  fs.mkdirSync(path.join(s.root, 'Elsewhere'));
  const before = hashes(s.root);
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0], /that site folder belongs to another vault: .*Elsewhere/);
  assert.deepEqual(hashes(s.root), before);
  const none = scratch(old('  mode: player\n'), { site: { siteTitle: 'x' } });
  const p2 = planMove({ vaultPath: none.vault, siteConfigPath: none.config });
  assert.equal(p2.ok, false);
  assert.match(p2.blockers[0], /no "vaultPath"/);
  const same = scratch(old('  mode: player\n'), { site: { vaultPath: '../' + path.basename(s.root) + '/Elsewhere' } });
  assert.equal(planMove({ vaultPath: s.vault, siteConfigPath: same.config }).ok, false);
});

test('a site file that does not exist is a blocker, and an unreadable one prints the blocked shape with --json', () => {
  const s = scratch(old('  mode: player\n'));
  const missing = path.join(s.root, 'nope.json');
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: missing });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0], /does not exist/);
  const bad = scratch(old('  mode: player\n'), { site: '{ not json' });
  const withVault = cliMove({ vault: bad.vault, config: bad.config });
  assert.equal(withVault.rc, 1);
  assert.equal(withVault.data.ok, false);
  assert.match(withVault.data.blockers[0], /could not be read as JSON/);
  const byConfig = cliMove({ config: bad.config });
  assert.equal(byConfig.rc, 1);
  assert.equal(byConfig.data.ok, false);
  assert.deepEqual(Object.keys(byConfig.data).sort(), ['blockers', 'files', 'lines', 'moved', 'ok']);
  assert.equal(cliMove({ vault: s.vault, config: missing }).data.ok, false);
});

test('a vault path that is not a folder is one plain error line and exit 1', () => {
  const s = scratch(old('  mode: player\n'));
  const r = cliMove({ vault: path.join(s.root, 'not-there') });
  assert.equal(r.rc, 1);
  assert.equal(r.err.length, 1);
  assert.match(r.err[0], /^Error: .* is not a folder\.$/);
  assert.equal(cliMove({ vault: at(s.vault, OLD_FILE) }).rc, 1);
});

test('the site file keeps its indent and trailing newline when it loses its settings', () => {
  const cases = [['\t', true], [4, false], [2, true], [undefined, false]];
  for (const [indent, newline] of cases) {
    const raw = JSON.stringify({ vaultPath: './Vault', siteTitle: 'T', outputDir: './docs' }, null, indent) + (newline ? '\n' : '');
    const s = scratch(old('  mode: player\n'), { site: raw });
    const { plan } = moveAndCompare(s);
    const expected = JSON.stringify({ vaultPath: './Vault', outputDir: './docs' }, null, indent) + (newline ? '\n' : '');
    assert.equal(fs.readFileSync(s.config, 'utf8'), expected, String(indent));
    assert.ok(plan.lines.some((l) => l.includes('The rest of that file is as it was.')));
  }
  const crlf = JSON.stringify({ vaultPath: './Vault', siteTitle: 'T' }, null, 2).replace(/\n/g, '\r\n') + '\r\n';
  const s = scratch(old('  mode: player\n'), { site: crlf });
  moveAndCompare(s);
  assert.equal(fs.readFileSync(s.config, 'utf8'), '{\r\n  "vaultPath": "./Vault"\r\n}\r\n');
});

test('a campaign named after the vault folder is said, with how to change it; a carried or filled name is not', () => {
  const s = scratch(old('  mode: player\n'));
  const plan = planMove({ vaultPath: s.vault });
  assert.ok(plan.lines.some((l) => l.includes('named after the vault folder ("Vault")') && l.includes('settings set vault.campaign=')), plan.lines.join('\n'));
  const t = scratch(old('  mode: player\n'));
  assert.ok(!planMove({ vaultPath: t.vault, fill: { 'vault.campaign': 'X' } }).lines.some((l) => l.includes('named after the vault folder')));
});

test('a state file that already holds the version or the set-up note keeps it, and a line says which won', () => {
  const s = scratch(`---\ntype: meta\ngm_apprentice_version: "1.0.0"\npublish:\n  setup_progress:\n    step: 9\n---\n`,
    { files: { [STATE_FILE]: '{"gm_apprentice_version": "2.0.0", "setup": {"step": 1}}\n' } });
  const { plan } = moveAndCompare(s);
  assert.deepEqual(readState(s.vault), { gm_apprentice_version: '2.0.0', setup: { step: 1 } });
  assert.ok(plan.lines.some((l) => l.includes('already says gm_apprentice_version "2.0.0", which was kept; the old file\'s "1.0.0" was dropped')));
  assert.ok(plan.lines.some((l) => l.includes('already holds a set-up note, which was kept')));
  const same = scratch('---\ntype: meta\ngm_apprentice_version: "2.0.0"\npublish:\n  mode: player\n---\n', { files: { [STATE_FILE]: '{"gm_apprentice_version": "2.0.0"}\n' } });
  assert.ok(!planMove({ vaultPath: same.vault }).lines.some((l) => l.includes('already says')));
});

test('an alias used before its anchor is the ordinary not-valid-YAML blocker', () => {
  for (const body of ['x: *a\npublish:\n  mode: player\ny: &a 1\n', 'publish:\n  exclude_sections: *a\n  exclude_fields: &a [x]\n']) {
    const s = scratch(`---\ntype: meta\n${body}---\n`);
    const before = hashes(s.root);
    const plan = planMove({ vaultPath: s.vault });
    assert.equal(plan.ok, false);
    assert.match(plan.blockers[0], /^_meta\/vault-config\.md frontmatter is not valid YAML: /);
    assert.deepEqual(hashes(s.root), before);
  }
});

// ---- --vault alone: the site folder the vault names ----

test('--vault alone uses the vault.config.json in the folder the vault names, and moves its settings too', () => {
  const s = scratch(old('  site_dir: ../Site\n'));
  const site = path.join(s.root, 'Site');
  fs.mkdirSync(site);
  const siteFile = path.join(site, 'vault.config.json');
  fs.writeFileSync(siteFile, JSON.stringify({ vaultPath: '../Vault', siteTitle: 'Four', folderMap: { People: 'people' }, excludeSections: ['Spoilers'] }));
  const before = strip(loadPublishConfig(s.vault, JSON.parse(fs.readFileSync(siteFile, 'utf8')), quiet));
  const r = cliMove({ vault: s.vault });
  assert.equal(r.rc, 0);
  assert.equal(layoutOf(s.vault), 'new');
  const siteAfter = JSON.parse(fs.readFileSync(siteFile, 'utf8'));
  assert.deepEqual(siteAfter, { vaultPath: '../Vault' });
  assert.deepEqual(strip(loadPublishConfig(s.vault, siteAfter, quiet)), before);
});

test('--vault alone is blocked, and writes nothing, when the folder the vault names cannot be read', () => {
  const s = scratch(old('  site_dir: ../Missing\n'));
  const before = hashes(s.root);
  const r = cliMove({ vault: s.vault });
  assert.equal(r.rc, 1);
  assert.equal(layoutOf(s.vault), 'legacy');
  assert.deepEqual(hashes(s.root), before);
  const noFile = scratch(old('  site_dir: ../Empty\n'));
  fs.mkdirSync(path.join(noFile.root, 'Empty'));
  assert.equal(cliMove({ vault: noFile.vault }).rc, 1);
  assert.equal(layoutOf(noFile.vault), 'legacy');
  const text = [];
  runSettings({ verb: 'move', args: [], vault: s.vault }, { out: (l) => text.push(l), err: () => {} });
  assert.match(text.join('\n'), /the vault names a site folder at .*Missing that cannot be read; give --config or fix the path/);
});

test('--vault alone moves a vault that names no site folder, as it always did', () => {
  const s = scratch(old('  mode: player\n'));
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  assert.equal(layoutOf(s.vault), 'new');
});

// ---- A target is never missing, a stopped move is cleaned up, case, CRLF notes (M7, M12, M13) ----

test('no file the move replaces is ever missing while it runs', () => {
  const s = scratch(old('  mode: player\n', 'gm_apprentice_version: "1.10.1"\n'), { site: { vaultPath: './Vault', siteTitle: 'T' }, files: { [STATE_FILE]: '{"other": 1}\n' } });
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  const mustStay = [at(s.vault, STATE_FILE), s.config];
  const rename = (a, b) => {
    for (const f of mustStay) assert.equal(fs.existsSync(f), true, `${path.basename(f)} is there before the rename of ${path.basename(a)}`);
    fs.renameSync(a, b);
    for (const f of mustStay) assert.equal(fs.existsSync(f), true, `${path.basename(f)} is there after the rename of ${path.basename(a)}`);
  };
  assert.equal(applyMove(plan, { rename }).moved, true);
});

test('a second move on a moved vault removes the hidden files a stopped move left, and says so', () => {
  const s = scratch(old('  mode: player\n'), { site: { vaultPath: './Vault', siteTitle: 'T' } });
  assert.equal(cliMove({ vault: s.vault, config: s.config }).rc, 0);
  const strays = [path.join(s.vault, '_meta', `.${path.basename(NEW_FILE)}.4242.move.old`), path.join(s.vault, '_meta', `.${path.basename(OLD_FILE)}.4242.move.old`), path.join(s.root, '.vault.config.json.4242.move.new')];
  for (const f of strays) fs.writeFileSync(f, 'x');
  const unrelated = path.join(s.vault, '_meta', '.keep.4242.move.old');
  fs.writeFileSync(unrelated, 'x');
  const check = cliMove({ vault: s.vault, config: s.config, check: true });
  assert.equal(check.rc, 0);
  for (const f of strays) assert.equal(fs.existsSync(f), true, 'a check removes nothing');
  const out = [];
  assert.equal(runSettings({ verb: 'move', args: [], vault: s.vault, config: s.config }, { out: (l) => out.push(l), err: () => {} }), 0);
  assert.match(out.join('\n'), /already on the new settings file/);
  assert.match(out.join('\n'), /Removed hidden files left by an earlier move/);
  for (const f of strays) assert.equal(fs.existsSync(f), false);
  assert.equal(fs.existsSync(unrelated), true, 'a file that is not the move\'s own is left');
});

test('the vault is the same vault when the site file spells its folder in another case', (t) => {
  const s = scratch(old('  mode: player\n'));
  const swapped = path.join(path.dirname(s.vault), 'VAULT');
  if (!fs.existsSync(swapped)) return t.skip('this file system tells Vault from VAULT');
  fs.writeFileSync(path.join(s.root, 'vault.config.json'), JSON.stringify({ vaultPath: './VAULT' }));
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: path.join(s.root, 'vault.config.json') });
  assert.deepEqual(plan.blockers, []);
});

test('the notes file keeps the old file\'s line ending in its frontmatter', () => {
  const s = scratch('---\r\ntype: meta\r\ndescription: Mine\r\npublish:\r\n  mode: player\r\n---\r\nBody\r\n');
  moveAndCompare(s);
  const notes = fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8');
  assert.equal(notes.replace(/\r\n/g, ''), notes.replace(/\r\n/g, '').replace(/\n/g, ''), 'no bare line feed: every line ends in CRLF');
  assert.ok(notes.startsWith('---\r\ntype: meta\r\ndescription: Mine\r\n---\r\nBody'));
});

// ---- A stopped move is mended by running it again (R6) ----

const KILL = path.join(__dirname, 'helpers', 'kill-move.js');
const hiddenLeft = (dir) => {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.move\.(old|new)$/.test(e.name)) found.push(f);
    }
  }(dir));
  return found;
};
const killable = () => scratch(`---\ntype: meta\ngm_apprentice_version: "1.10.1"\ncampaign: Hollow\npublish:\n  mode: player\n  site_title: Hollow Site\n  exclude_sections: [A, B]\n---\nMy own notes.\n`, {
  site: { vaultPath: './Vault', siteTitle: 'T', excludeSections: ['Z'], folderMap: { People: 'people' } },
  files: { [STATE_FILE]: '{"other": 1}\n' },
});

test('a move killed at any point in its commit is finished by running it again', () => {
  const s0 = killable();
  const original = strip(loadPublishConfig(s0.vault, JSON.parse(fs.readFileSync(s0.config, 'utf8')), quiet));
  const expectedSite = { vaultPath: './Vault' };
  let total = 0;
  for (let n = 1; n < 40; n += 1) {
    for (const when of ['before', 'after']) {
      const s = killable();
      const run = require('node:child_process').spawnSync(process.execPath, [KILL, s.vault, s.config, String(n), when], { encoding: 'utf8' });
      if (run.status === 0) { total = Number(run.stdout.trim()); break; }
      assert.equal(run.status, 9, `kill ${when} op ${n}: ${run.stderr}`);
      const again = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
      assert.equal(again.ok, true, `kill ${when} op ${n}: ${again.blockers.join(' | ')}`);
      applyMove(again);
      const label = `killed ${when} operation ${n}`;
      assert.equal(layoutOf(s.vault), 'new', label);
      assert.equal(fs.existsSync(at(s.vault, OLD_FILE)), false, label);
      assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')), expectedSite, label);
      assert.deepEqual(strip(loadPublishConfig(s.vault, expectedSite, quiet)), original, label);
      assert.deepEqual(hiddenLeft(s.root), [], label);
      assert.equal(matter(fs.readFileSync(at(s.vault, NOTES_FILE), 'utf8'), {}).content, 'My own notes.\n', label);
      assert.equal(readState(s.vault).other, 1, label);
      assert.equal(readState(s.vault).gm_apprentice_version, '1.10.1', label);
      // And a third run finds nothing.
      const third = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
      assert.deepEqual(third.files, { write: [], remove: [] }, label);
    }
    if (total) break;
  }
  assert.ok(total >= 5, `the move made ${total} renames and removals`);
});

test('the notes file a stopped move wrote is accepted when it is what this move would write; another is a blocker', () => {
  const s = killable();
  const first = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
  fs.writeFileSync(at(s.vault, NOTES_FILE), fs.readFileSync(at(s.vault, OLD_FILE), 'utf8').includes('My own notes') ? '---\ntype: meta\n---\nMy own notes.\n' : '');
  assert.equal(planMove({ vaultPath: s.vault, siteConfigPath: s.config }).ok, true);
  fs.writeFileSync(at(s.vault, NOTES_FILE), 'something else\n');
  assert.equal(planMove({ vaultPath: s.vault, siteConfigPath: s.config }).ok, false);
  assert.equal(first.ok, true);
});

test('a moved vault whose site file still holds settings the new file has: the second run strips them; settings it has differently stay', () => {
  const s = scratch(old('  mode: player\n  site_title: Mine\n'), { site: { vaultPath: './Vault', siteTitle: 'Mine', folderMap: { A: 'a' } } });
  const sibling = JSON.parse(fs.readFileSync(s.config, 'utf8'));
  assert.equal(cliMove({ vault: s.vault, config: s.config }).rc, 0);
  fs.writeFileSync(s.config, JSON.stringify(sibling));
  const r = cliMove({ vault: s.vault, config: s.config });
  assert.equal(r.rc, 0);
  assert.match(r.data.lines.join('\n'), /Removed the settings from/);
  assert.deepEqual(JSON.parse(fs.readFileSync(s.config, 'utf8')), { vaultPath: './Vault' });
  fs.writeFileSync(s.config, JSON.stringify({ vaultPath: './Vault', siteTitle: 'Different' }));
  const kept = cliMove({ vault: s.vault, config: s.config });
  assert.match(kept.data.lines.join('\n'), /left it as it is|left as it is/);
  assert.equal(JSON.parse(fs.readFileSync(s.config, 'utf8')).siteTitle, 'Different');
});

test('--vault alone on a moved vault finds the site folder the new file names', () => {
  const s = scratch(old('  site_dir: ../Site\n'));
  const site = path.join(s.root, 'Site');
  fs.mkdirSync(site);
  const siteFile = path.join(site, 'vault.config.json');
  fs.writeFileSync(siteFile, JSON.stringify({ vaultPath: '../Vault', siteTitle: 'Four' }));
  const keep = fs.readFileSync(siteFile, 'utf8');
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(siteFile, keep);
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(siteFile, 'utf8')), { vaultPath: '../Vault' });
});

test('an old file left beside the new one: removed when it holds nothing more, kept and listed otherwise, removed on request', () => {
  const s = scratch(old('  mode: player\n  site_title: Mine\n'));
  const text = fs.readFileSync(at(s.vault, OLD_FILE), 'utf8');
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(at(s.vault, OLD_FILE), text);
  const check = cliMove({ vault: s.vault }, { check: true });
  assert.deepEqual(check.data.leftover, { redundant: true, keys: [] });
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  assert.equal(fs.existsSync(at(s.vault, OLD_FILE)), false);
  fs.writeFileSync(at(s.vault, OLD_FILE), old('  mode: player\n  site_title: Mine\n  search: false\n'));
  const kept = cliMove({ vault: s.vault });
  assert.equal(kept.data.leftover.redundant, false);
  assert.deepEqual(kept.data.leftover.keys, ['player_site.features.search']);
  assert.equal(fs.existsSync(at(s.vault, OLD_FILE)), true);
  assert.equal(cliMove({ vault: s.vault }, { discardOld: true }).rc, 0);
  assert.equal(fs.existsSync(at(s.vault, OLD_FILE)), false);
});

test('no settings file but settings in the site file: the move makes the new file from them, with no old file to remove', () => {
  const s = scratch(null, { site: { vaultPath: './Vault', siteTitle: 'Only Here', excludeSections: ['Z'], folderMap: { A: 'a' } } });
  const before = strip(loadPublishConfig(s.vault, JSON.parse(fs.readFileSync(s.config, 'utf8')), quiet));
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config, fill: { 'vault.system': 'coc-7e' } });
  assert.equal(plan.ok, true, plan.blockers.join(' | '));
  assert.deepEqual(plan.files.remove, []);
  assert.equal(applyMove(plan).moved, true);
  assert.equal(layoutOf(s.vault), 'new');
  const siteAfter = JSON.parse(fs.readFileSync(s.config, 'utf8'));
  assert.deepEqual(siteAfter, { vaultPath: './Vault' });
  const after = strip(loadPublishConfig(s.vault, siteAfter, quiet));
  assert.deepEqual({ ...after, system: before.system }, before);
  assert.equal(after.system, 'coc-7e');
  assert.equal(fs.existsSync(at(s.vault, NOTES_FILE)), false);
  assert.equal(planMove({ vaultPath: scratch(null).vault }).files.write.length, 0);
});

// ---- The site's tool must be able to read the new file (held, not blocked) ----

function siteWithPin(spec, { fileName = 'vault.config.json' } = {}) {
  const s = scratch(old('  site_dir: ../Site\n  site: false\n  site_title: V\n'));
  const site = path.join(s.root, 'Site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, fileName), JSON.stringify({ vaultPath: '../Vault', siteTitle: 'Theirs' }));
  if (spec !== null) fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify({ dependencies: { 'gm-apprentice-publish': spec } }));
  return { ...s, site };
}

test('a site whose tool is pinned by something else is held, whatever the site switch says; nothing is written', () => {
  const s = siteWithPin('^1.20.0');
  const before = hashes(s.root);
  const r = cliMove({ vault: s.vault });
  assert.equal(r.rc, 1);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.moved, false);
  assert.equal(r.data.held, 'site-tool');
  assert.equal(r.data.spec, '^1.20.0');
  assert.deepEqual(r.data.blockers, []);
  assert.match(r.data.line, /stays on the old settings file because its site's tool \(\^1\.20\.0\) cannot read the new one\. When that tool is 1\.23\.0 or later, run the update again\./);
  assert.deepEqual(hashes(s.root), before);
  assert.equal(layoutOf(s.vault), 'legacy');
  // --check says the same.
  assert.equal(cliMove({ vault: s.vault }, { check: true }).data.held, 'site-tool');
});

test('a site with no pinned tool moves; a site folder named but missing, or without a vault.config.json, is as it was', () => {
  const free = siteWithPin(null);
  assert.equal(cliMove({ vault: free.vault }).rc, 0);
  assert.equal(layoutOf(free.vault), 'new');
  const missing = scratch(old('  site_dir: ../Missing\n'));
  const r = cliMove({ vault: missing.vault });
  assert.equal(r.rc, 1);
  assert.equal(r.data.held, undefined);
  assert.equal(layoutOf(missing.vault), 'legacy');
  const empty = siteWithPin('^1.20.0', { fileName: 'other.json' });
  const e = cliMove({ vault: empty.vault });
  assert.equal(e.rc, 1);
  assert.equal(e.data.held, undefined, 'no vault.config.json in the folder: no site file to ask about');
});

test('the four cases: ours or not, able to read the new file or not', () => {
  const where = (s) => path.join(s.site, 'vault.config.json');
  const cases = [
    // [label, pin answer, caller updating, expected held]
    ['ours, old, the update repins first', { ok: false, ours: true, spec: 'file:/p', installedBefore: '1.20.0' }, true, undefined],
    ['ours, old, nobody repins', { ok: false, ours: true, spec: 'file:/p', installedBefore: '1.20.0' }, false, 'site-tool-old'],
    ['not ours, installed 1.24.0', { ok: true, ours: false, spec: '^1.20.0', installedBefore: '1.24.0' }, true, undefined],
    ['not ours, installed exactly 1.23.0', { ok: true, ours: false, spec: '1.23.0', installedBefore: '1.23.0' }, false, undefined],
    ['not ours, installed 1.22.9', { ok: true, ours: false, spec: '^1.20.0', installedBefore: '1.22.9' }, true, 'site-tool'],
    ['not ours, nothing installed, spec asks for 1.25.0', { ok: true, ours: false, spec: '^1.25.0', installedBefore: null }, false, undefined],
    ['not ours, nothing installed, spec asks for 1.2.0', { ok: true, ours: false, spec: '^1.2.0', installedBefore: null }, false, 'site-tool'],
    ['not ours, nothing installed, spec says nothing of a version', { ok: true, ours: false, spec: 'github:someone/fork', installedBefore: null }, false, 'site-tool'],
    ['no tool pinned or installed', { ok: true, ours: false, spec: null, installedBefore: null }, false, undefined],
  ];
  for (const [label, pin, updated, held] of cases) {
    const s = siteWithPin(null);
    const plan = planMove({ vaultPath: s.vault, siteConfigPath: where(s), siteToolUpdated: updated }, { pinCheck: () => pin });
    assert.equal(plan.held, held, label);
    assert.equal(plan.ok, held === undefined, label);
  }
});

test('an old copy of the plugin\'s own tool holds the move unless the caller is bringing it up to date', () => {
  const s = siteWithPin('file:/cache/gm-apprentice/1.10.1/tools/publish');
  const calls = [];
  const stale = (dir) => { calls.push(dir); return { ok: false, ours: true, spec: 'file:/cache/gm-apprentice/1.10.1/tools/publish' }; };
  const held = planMove({ vaultPath: s.vault, siteConfigPath: path.join(s.site, 'vault.config.json') }, { pinCheck: stale });
  assert.equal(held.ok, false);
  assert.equal(held.held, 'site-tool-old');
  assert.match(held.line, /older than the plugin's/);
  const updating = planMove({ vaultPath: s.vault, siteConfigPath: path.join(s.site, 'vault.config.json'), siteToolUpdated: true }, { pinCheck: stale });
  assert.equal(updating.ok, true, updating.blockers.join(' | '));
  const current = planMove({ vaultPath: s.vault, siteConfigPath: path.join(s.site, 'vault.config.json') }, { pinCheck: () => ({ ok: true, ours: true, spec: 'file:/x', installedBefore: '1.24.0' }) });
  assert.equal(current.ok, true);
  assert.equal(calls.length, 2);
});

test('a moved vault is tidied even when its site is pinned by something else', () => {
  const s = siteWithPin(null);
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(path.join(s.site, 'package.json'), JSON.stringify({ dependencies: { 'gm-apprentice-publish': '^1.20.0' } }));
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
});

// ---- Every site folder involved is asked, and an installed tool counts whatever package.json says ----

function installTool(dir, version) {
  const pkg = path.join(dir, 'node_modules', 'gm-apprentice-publish');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'gm-apprentice-publish', version }));
}

test('the vault names site A (old tool) and --config names site B (new tool): held, because A is asked too', () => {
  const s = scratch(old('  site_dir: ../SiteA\n'));
  const a = path.join(s.root, 'SiteA');
  const b = path.join(s.root, 'SiteB');
  for (const d of [a, b]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'vault.config.json'), JSON.stringify({ vaultPath: '../Vault' })); }
  installTool(a, '1.22.0');
  installTool(b, '1.23.0');
  const none = () => null;
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: path.join(b, 'vault.config.json') }, { pinCheck: none });
  assert.equal(plan.ok, false);
  assert.equal(plan.held, 'site-tool');
  assert.match(plan.line, /\(1\.22\.0\)/);
  installTool(a, '1.23.0');
  assert.equal(planMove({ vaultPath: s.vault, siteConfigPath: path.join(b, 'vault.config.json') }, { pinCheck: none }).ok, true);
});

test('an old tool installed in a site folder whose package.json does not name it still holds the move; no tool and no pin does not', () => {
  const s = siteWithPin(null);
  installTool(s.site, '1.22.0');
  const r = cliMove({ vault: s.vault });
  assert.equal(r.rc, 1);
  assert.equal(r.data.held, 'site-tool');
  assert.equal(layoutOf(s.vault), 'legacy');
  const free = siteWithPin(null);
  assert.equal(cliMove({ vault: free.vault }).rc, 0);
  const current = siteWithPin(null);
  installTool(current.site, '1.23.0');
  assert.equal(cliMove({ vault: current.vault }).rc, 0);
});

// ---- A moved vault whose site file holds settings the vault resolves differently ----

test('--fold-site-file adds a site hiding list to the vault\'s, keeps the stricter callout rule, drops the rest, in one change', () => {
  const s = scratch(old('  site_dir: ../Site\n  site_title: Mine\n  exclude_sections: [A]\n'));
  const siteDir = path.join(s.root, 'Site');
  fs.mkdirSync(siteDir);
  const file = path.join(siteDir, 'vault.config.json');
  const siteJson = { vaultPath: '../Vault', outputDir: './docs' };
  fs.writeFileSync(file, JSON.stringify(siteJson, null, 4) + '\n');
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  const extra = { ...siteJson, siteTitle: 'Theirs', excludeSections: ['Z'], excludeCallouts: ['spoiler'] };
  fs.writeFileSync(file, JSON.stringify(extra, null, 4) + '\n');
  const before = hashes(s.root);
  const check = cliMove({ vault: s.vault }, { check: true });
  assert.deepEqual(check.data.siteDiffers.sort(), ['player_site.hide.callouts', 'player_site.hide.sections', 'player_site.title']);
  assert.deepEqual(hashes(s.root), before, 'a check writes nothing');
  assert.deepEqual(hashes(s.root), before);
  const plain = cliMove({ vault: s.vault });
  assert.match(plain.data.lines.join('\n'), /left as it is/);
  assert.deepEqual(hashes(s.root), before, 'without the flag the site file is left');
  const done = cliMove({ vault: s.vault }, { foldSiteFile: true });
  assert.equal(done.rc, 0, done.err.join('\n'));
  const got = readSettings({ vaultPath: s.vault }).values.player_site;
  assert.deepEqual(got.hide.sections, ['A', 'Z'], 'the vault\'s own list, plus the site file\'s entry');
  assert.deepEqual(got.hide.callouts, ['spoiler']);
  assert.equal(got.title, 'Mine', 'the vault\'s plain value is the one in use');
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after, JSON.stringify(siteJson, null, 4) + '\n', 'the site file keeps its indentation');
  assert.equal(cliMove({ vault: s.vault }).data.siteDiffers, undefined);
});

test('the vault already hiding every callout keeps that; a failing site write puts the vault\'s file back', () => {
  const s = scratch(old('  site_dir: ../Site\n  exclude_callouts: true\n'));
  const siteDir = path.join(s.root, 'Site');
  fs.mkdirSync(siteDir);
  const file = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault' }));
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault', excludeCallouts: ['x'], excludeSections: ['Z'] }));
  const plan = planMove({ vaultPath: s.vault, siteConfigPath: file, foldSiteFile: true }, { pinCheck: () => null });
  const vaultBefore = fs.readFileSync(at(s.vault, NEW_FILE), 'utf8');
  let n = 0;
  const rename = (a, b) => { n += 1; if (n === 2) throw new Error('disk said no'); fs.renameSync(a, b); };
  assert.throws(() => applyMove(plan, { rename }), /nothing was changed/);
  assert.equal(fs.readFileSync(at(s.vault, NEW_FILE), 'utf8'), vaultBefore);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).excludeSections[0], 'Z');
  assert.equal(applyMove(planMove({ vaultPath: s.vault, siteConfigPath: file, foldSiteFile: true }, { pinCheck: () => null })).moved, false);
  assert.equal(readSettings({ vaultPath: s.vault }).values.player_site.hide.callouts, true);
});

test('a vault with no list of its own keeps the built-in ones when a site hiding list is folded in', () => {
  const s = scratch(old('  site_dir: ../Site\n'));
  const siteDir = path.join(s.root, 'Site');
  fs.mkdirSync(siteDir);
  const file = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault' }));
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault', excludeSections: ['Z'] }));
  assert.equal(cliMove({ vault: s.vault }, { foldSiteFile: true }).rc, 0);
  const got = readSettings({ vaultPath: s.vault }).values.player_site.hide.sections;
  assert.ok(got.includes('Z') && got.includes('GM Notes'));
});

test('a left-over old file that also hides a heading does not hide the site file\'s other entries from the check', () => {
  const s = scratch(old('  site_dir: ../Site\n  exclude_sections: [GM Notes]\n'));
  const siteDir = path.join(s.root, 'Site');
  fs.mkdirSync(siteDir);
  const file = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault' }));
  const oldText = fs.readFileSync(at(s.vault, OLD_FILE), 'utf8');
  assert.equal(cliMove({ vault: s.vault }).rc, 0);
  fs.writeFileSync(at(s.vault, OLD_FILE), oldText);      // a sync brings the old file back
  fs.writeFileSync(file, JSON.stringify({ vaultPath: '../Vault', excludeSections: ['Site Secret'] }));
  const check = cliMove({ vault: s.vault }, { check: true });
  assert.ok((check.data.siteDiffers || []).includes('player_site.hide.sections'), JSON.stringify(check.data));
  assert.equal(cliMove({ vault: s.vault }, { foldSiteFile: true }).rc, 0);
  assert.ok(readSettings({ vaultPath: s.vault }).values.player_site.hide.sections.includes('Site Secret'));
});
