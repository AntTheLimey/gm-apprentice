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

test('a comment that cannot be placed is listed, not dropped', () => {
  const s = scratch(old('  # about the theme block\n  theme:\n    genre: horror\n  mode: player\n'));
  const { plan } = moveAndCompare(s);
  assert.ok(plan.lines.some((l) => l.startsWith('a comment could not be carried: # about the theme block') || l.startsWith('a comment could not be carried: about the theme block')), plan.lines.join('\n'));
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
  for (let failAt = 1; failAt <= 9; failAt++) {
    const plan = planMove({ vaultPath: s.vault, siteConfigPath: s.config });
    assert.equal(plan.ok, true);
    let n = 0;
    const rename = (a, b) => { n += 1; if (n === failAt) throw new Error('disk said no'); fs.renameSync(a, b); };
    if (failAt > 6) { // six renames in all (state two, settings one, site two, old file one): past them the move has finished
      const r = applyMove(plan, { rename });
      assert.equal(r.moved, true);
      assert.equal(n, 6);
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
