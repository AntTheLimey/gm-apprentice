'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runSettings, runVaultSetting, helpText } = require('../lib/settings/cli.js');
const { REGISTRY, legacyNameOf } = require('../lib/settings');

const wrap = (publish) => `---\ntype: meta\npublish:\n${publish}---\n`;

function scratch(text, site) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (text !== null) fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), text);
  fs.writeFileSync(path.join(root, 'vault.config.json'), JSON.stringify(site || { vaultPath: './vault' }));
  return { root, vault, config: path.join(root, 'vault.config.json') };
}
const file = (s) => path.join(s.vault, '_meta', 'vault-config.md');
const text = (s) => fs.readFileSync(file(s), 'utf8');

function run(s, verb, args = [], extra = {}) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault: s.vault, json: true, ...extra }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, data: out.length ? JSON.parse(out.join('\n')) : null, out: out.join('\n'), err };
}

test('get on a block with none of the settings gives defaults and says the block is there', () => {
  const s = scratch(wrap('  mode: player\n'));
  const { rc, data } = run(s, 'get');
  assert.equal(rc, 0);
  assert.deepEqual(data.settings['publish.connections'], { value: 'tree', origin: 'default' });
  assert.equal(data.file.hasPublish, true);
  assert.deepEqual(data.faults, []);
});

test('get of a group gives exactly the names under it', () => {
  const s = scratch(wrap('  landing:\n    max_npcs: 3\n'));
  const { data } = run(s, 'get', ['publish.landing']);
  assert.deepEqual(Object.keys(data.settings), REGISTRY.map((e) => legacyNameOf(e)).filter((n) => n && n.startsWith('publish.landing.')));
  assert.deepEqual(data.settings['publish.landing.max_npcs'], { value: 3, origin: 'file' });
  assert.deepEqual(run(s, 'get', ['publish.connections']).data.settings, { 'publish.connections': { value: 'tree', origin: 'default' } });
});

test('get of a name that is not a setting exits 1 with a suggestion', () => {
  const s = scratch(wrap(''));
  const { rc, err } = run(s, 'get', ['publish.conections']);
  assert.equal(rc, 1);
  assert.deepEqual(err, ['Error: publish.conections is not a setting. Did you mean publish.connections?']);
});

test('get with a fault lists it, stops first, and still exits 0', () => {
  const s = scratch(wrap('  connections: graph\n  exclude_sectoins: [x]\n'));
  const { rc, data } = run(s, 'get');
  assert.equal(rc, 0);
  assert.deepEqual(data.settings['publish.connections'], { value: 'tree', origin: 'fault' });
  assert.deepEqual(data.faults.map((f) => f.name), ['publish.exclude_sectoins', 'publish.connections']);
  assert.deepEqual(data.faults[0], { name: 'publish.exclude_sectoins', level: 'stop', kind: 'unknown-name', message: 'publish.exclude_sectoins is not a setting. Did you mean publish.exclude_sections?', suggest: 'publish.exclude_sections' });
  assert.equal(data.faults[1].level, 'warn');
  assert.ok(data.faults.every((f) => !('entry' in f)));
});

test('an old name is a fault that carries the name to use', () => {
  const s = scratch(wrap('  images:\n    maxWidth: 800\n'));
  const f = run(s, 'check').data.faults.find((x) => x.kind === 'old-name');
  assert.equal(f.use, 'publish.images.max_width');
});

test('plain output is one line per setting, faults last under a blank line', () => {
  const s = scratch(wrap('  connections: graph\n  exclude_sectoins: [x]\n  inbox: true\n'));
  const out = [];
  runSettings({ verb: 'get', args: [], vault: s.vault }, { out: (l) => out.push(l) });
  const lines = out.join('\n').split('\n');
  assert.ok(lines.includes('player_site.features.inbox: true (vault file)'));
  assert.ok(lines.includes('player_site.features.search: true (default)'));
  const blank = lines.indexOf('');
  assert.ok(blank > 0);
  assert.match(lines[blank + 1], /^Stop: publish\.exclude_sectoins is not a setting/);
  assert.match(lines[blank + 2], /^Warning: publish\.connections \(now player_site\.features\.connections\) is "graph"/);
  assert.equal(lines.length, blank + 3);
});

test('set writes one line, keeps a comment above it, and get then says file', () => {
  const s = scratch(wrap('  # how the links look\n  mode: player\n'));
  const { rc, data } = run(s, 'set', ['publish.connections="web"']);
  assert.equal(rc, 0);
  assert.deepEqual(data, { written: ['publish.connections'], notes: [] });
  assert.equal(text(s), wrap('  # how the links look\n  mode: player\n  connections: web\n'));
  assert.deepEqual(run(s, 'get', ['publish.connections']).data.settings['publish.connections'], { value: 'web', origin: 'file' });
});

test('set writes the value the type read: a different case, and a word for a switch', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'set', ['publish.connections="Web"', 'publish.search="off"']).rc, 0);
  assert.match(text(s), /^ {2}connections: web$/m);
  assert.match(text(s), /^ {2}search: false$/m);
});

test('set writes text as given', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'set', ['publish.footer="  Made by me  "']).rc, 0);
  assert.equal(require('../lib/frontmatter').parseNote(text(s)).data.publish.footer, '  Made by me  ');
});

test('set refuses a value the setting does not take, and leaves the file', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  const { rc, err } = run(s, 'set', ['publish.connections="graph"']);
  assert.equal(rc, 1);
  assert.deepEqual(err, ['Error: publish.connections is "graph"; it takes tree, web, cards or off.']);
  assert.equal(text(s), before);
});

test('set refuses a name that is not a setting, an old name, a bookkeeping name, a retired one, a parent', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  const refused = [
    ['publish.zebra=1', 'Error: publish.zebra is not a setting.'],
    ['vault.kept_by=player', 'Error: vault.kept_by needs the new settings file; run the update first.'],
    ['vault.campaign=Gone', 'Error: vault.campaign needs the new settings file; run the update first.'],
    ['publish.setup_progress={}', 'Error: publish.setup_progress is kept by the tool and cannot be set here.'],
    ['publish.wrap_up={}', 'Error: publish.wrap_up is no longer used and cannot be set.'],
    ['publish.landing={"max_npcs":3}', 'Error: publish.landing holds other settings; set the setting itself, for example publish.landing.max_npcs.'],
    ['publish.backend={}', 'Error: publish.backend only holds other settings and cannot be set.'],
    ['publish.connections', 'Error: publish.connections needs a value, like publish.connections=value.'],
    ['publish.connections=', 'Error: publish.connections has no value; to take it out of the file, use settings unset publish.connections.'],
  ];
  for (const [arg, line] of refused) {
    const { rc, err } = run(s, 'set', [arg]);
    assert.equal(rc, 1, arg);
    assert.deepEqual(err, [line], arg);
    assert.equal(text(s), before, arg);
  }
});

test('set takes a whole map for an open map, and a number for a number', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'set', ['publish.folder_map={"npcs":"People"}', 'publish.landing.max_npcs=3']).rc, 0);
  const publish = require('../lib/frontmatter').parseNote(text(s)).data.publish;
  assert.deepEqual(publish.folder_map, { npcs: 'People' });
  assert.deepEqual(publish.landing, { max_npcs: 3 });
  assert.equal(run(s, 'set', ['publish.landing.max_npcs=-1']).rc, 1);
});

test('two sets where the second is refused write nothing, and every refusal is named', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  const { rc, err } = run(s, 'set', ['publish.connections="web"', 'publish.connections="graph"', 'publish.zebra=1']);
  assert.equal(rc, 1);
  assert.equal(err.length, 2);
  assert.equal(text(s), before);
});

test('set of an empty built-in list writes it and says it hides nothing', () => {
  const s = scratch(wrap('  mode: player\n'));
  const { rc, data } = run(s, 'set', ['publish.exclude_sections=[]']);
  assert.equal(rc, 0);
  assert.deepEqual(data.notes, ['publish.exclude_sections is empty: nothing from the built-in list is hidden. Add the headings you want hidden, or remove the key to use the built-in list again.']);
  assert.match(text(s), /exclude_sections: \[\]/);
});

test('set refuses a list with a blank entry, for every list setting, and writes nothing', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  for (const arg of ['publish.exclude_sections=["a",""]', 'publish.exclude_fields=["  "]', 'publish.landing.featured_npcs=["x",""]', 'publish.exclude_callouts=[" "]']) {
    const { rc, err } = run(s, 'set', [arg]);
    assert.equal(rc, 1, arg);
    assert.deepEqual(err, [`Error: ${arg.split('=')[0]} has a blank entry; remove it.`], arg);
    assert.equal(text(s), before, arg);
  }
  const viaAlias = alias(s, ['exclude_sections=["a",""]']);
  assert.equal(viaAlias.rc, 1);
  assert.equal(text(s), before);
});

test('describe of a name that only holds settings lists them', () => {
  const s = scratch(wrap(''));
  for (const name of ['player_site.landing', 'player_site.theme', 'player_site.theme.fonts', 'publish.theme.fonts']) {
    const { rc, data } = run(s, 'describe', [name]);
    assert.equal(rc, 0, name);
    assert.equal(data.name, name);
    assert.ok(data.holds.length > 0 && data.holds.every((n) => n.startsWith('player_site.')), name);
    assert.deepEqual(Object.keys(data), ['name', 'holds']);
  }
  const out = [];
  runSettings({ verb: 'describe', args: ['player_site.theme.fonts'], vault: s.vault }, { out: (l) => out.push(l) });
  assert.match(out[0], /^player_site\.theme\.fonts holds other settings: player_site\.theme\.fonts\./);
  assert.equal(run(s, 'describe', ['publish.zebra']).rc, 1);
});

test('a fault already in the file does not block a set, and set replaces a faulted value', () => {
  const s = scratch(wrap('  exclude_sectoins: [x]\n  connections: graph\n'));
  assert.equal(run(s, 'set', ['publish.inbox=true']).rc, 0);
  assert.equal(run(s, 'set', ['publish.connections="cards"']).rc, 0);
  assert.equal(run(s, 'check').data.faults.length, 1);
});

test('unset removes the line, several at once, and names only what was there', () => {
  const s = scratch(wrap('  mode: player\n  connections: web\n  theme:\n    tagline: Hi\n  exclude_sectoins: [x]\n'));
  assert.deepEqual(run(s, 'unset', ['publish.connections']).data, { removed: ['publish.connections'] });
  assert.doesNotMatch(text(s), /connections/);
  assert.deepEqual(run(s, 'unset', ['publish.theme.tagline', 'publish.exclude_sectoins', 'publish.inbox']).data, { removed: ['publish.theme.tagline', 'publish.exclude_sectoins'] });
  assert.equal(text(s), wrap('  mode: player\n'));
  assert.deepEqual(run(s, 'unset', ['publish.connections']).data, { removed: [] });
});

test('unset refuses a name outside publish and writes nothing', () => {
  const s = scratch(wrap('  connections: web\n'));
  const before = text(s);
  assert.equal(run(s, 'unset', ['publish.connections', 'type']).rc, 1);
  assert.equal(text(s), before);
});

test('describe says what a hiding setting does, takes and defaults to', () => {
  const s = scratch(wrap(''));
  const { rc, data } = run(s, 'describe', ['player_site.hide.sections']);
  assert.equal(rc, 0);
  assert.equal(data.name, 'player_site.hide.sections');
  assert.equal(data.guards, true);
  assert.equal(data.kind, 'list');
  assert.ok(data.does.length > 10);
  assert.match(data.takes, /^a list of /);
  assert.ok(data.default.includes('GM Notes'));
  assert.deepEqual(Object.keys(data), ['name', 'kind', 'does', 'takes', 'default', 'guards', 'oldNames']);
  const other = run(s, 'describe', ['player_site.images.max_width']).data;
  assert.equal(other.guards, false);
  assert.deepEqual(other.oldNames, ['publish.images.max_width', 'publish.images.maxWidth']);
  // The old name answers as the setting it became, and the line saying so goes to stderr.
  const viaOld = run(s, 'describe', ['publish.images.maxWidth']);
  assert.equal(viaOld.data.name, 'player_site.images.max_width');
  assert.deepEqual(viaOld.err, ['publish.images.maxWidth is now player_site.images.max_width.']);
  });

test('a setting with only words for when it is left out returns those words as its default', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'describe', ['publish.footer']).data.default, 'No footer');
});

test('check exits 1 on a stop, 0 on a warning, and 0 with no faults', () => {
  assert.equal(run(scratch(wrap('  exclude_sectoins: [x]\n')), 'check').rc, 1);
  const warn = run(scratch(wrap('  connections: graph\n')), 'check');
  assert.equal(warn.rc, 0);
  assert.equal(warn.data.faults.length, 1);
  const clean = run(scratch(wrap('  mode: player\n')), 'check');
  assert.equal(clean.rc, 0);
  assert.deepEqual(clean.data, { faults: [] });
});

test('list names every setting that can be set, and none that cannot', () => {
  const { data } = run(scratch(wrap('')), 'list');
  const names = data.names.map((n) => n.name);
  assert.ok(names.includes('player_site.features.connections'));
  assert.ok(names.includes('vault.setting_year') && names.includes('vault.kept_by'));
  for (const gone of ['player_site.landing', 'publish.landing', 'publish.setup_progress', 'publish.wrap_up', 'publish.backend']) assert.ok(!names.includes(gone), gone);
  assert.deepEqual(data.names.find((n) => n.name === 'player_site.features.connections'), { name: 'player_site.features.connections', takes: 'tree, web, cards or off', default: 'tree', was: 'Was: publish.connections' });
  // Removed in Part B: the same rows under the old names, which the vault scripts still ask by.
  assert.deepEqual(data.names.find((n) => n.name === 'publish.connections'), { name: 'publish.connections', takes: 'tree, web, cards or off', default: 'tree', now: 'player_site.features.connections' });
  assert.ok(names.includes('setting_year'));
});

test('raw returns the file as written, the value at a name, or null', () => {
  const s = scratch(wrap('  wrap_up:\n    next: Sunday\n  mode: player\n'));
  assert.deepEqual(run(s, 'raw', ['publish.wrap_up']).data, { next: 'Sunday' });
  assert.equal(run(s, 'raw', ['publish.nothing']).data, null);
  assert.equal(run(s, 'raw').data.publish.mode, 'player');
  assert.deepEqual(run(scratch(null), 'raw').data, {});
});

test('a file that is not valid YAML gives one line and exit 1 on every verb', () => {
  const s = scratch('---\npublish:\n  a: [unclosed\n---\n');
  for (const [verb, args] of [['get', []], ['check', []], ['raw', []], ['set', ['publish.inbox=true']], ['unset', ['publish.inbox']]]) {
    const { rc, err } = run(s, verb, args);
    assert.equal(rc, 1, verb);
    assert.equal(err.length, 1, verb);
    assert.match(err[0], /^Error: /, verb);
    assert.ok(!err[0].includes('\n'), verb);
  }
});

test('no value is echoed at more than about 60 characters', () => {
  const long = 'x'.repeat(200);
  const s = scratch(wrap(`  connections: ${long}\n  exclude_sections: [${long}, {a: 1}]\n`));
  const { data, rc } = run(s, 'check');
  assert.equal(rc, 1);
  for (const f of data.faults) assert.ok(f.message.length < 200, f.message);
  const { err } = run(s, 'set', [`publish.connections=${JSON.stringify(long)}`]);
  assert.ok(err[0].length < 200);
});

test('--vault and --config together: the old keys in the site file take part', () => {
  const s = scratch(wrap('  mode: player\n'), { vaultPath: './vault', excludeSections: ['Old Notes'] });
  const both = run(s, 'get', ['publish.exclude_sections'], { config: s.config });
  assert.equal(both.data.settings['publish.exclude_sections'].origin, 'site-file');
  // The site file's list adds to the built-in list (#371).
  assert.deepEqual(both.data.settings['publish.exclude_sections'].value.slice(-1), ['Old Notes']);
  assert.ok(both.data.settings['publish.exclude_sections'].value.includes('GM Notes'));
  assert.equal(run(s, 'get', ['publish.exclude_sections']).data.settings['publish.exclude_sections'].origin, 'default');
  const onlyConfig = run(s, 'get', ['publish.exclude_sections'], { vault: undefined, config: s.config });
  assert.equal(onlyConfig.data.settings['publish.exclude_sections'].origin, 'site-file');
});

test('a verb that does not exist is refused', () => {
  const { rc, err } = run(scratch(wrap('')), 'frobnicate');
  assert.equal(rc, 1);
  assert.match(err[0], /^Error: settings needs one of get, set/);
});

test('the help is built from the list and names every setting that can be set', () => {
  const help = helpText();
  for (const n of run(scratch(wrap('')), 'list').data.names.filter((x) => !x.now)) assert.ok(help.includes(n.name), n.name);
  const bin = fs.readFileSync(path.join(__dirname, '..', 'bin', 'gm-publish.js'), 'utf8');
  assert.ok(!bin.includes('publish.connections'));
});

test('the command line: settings get, set and --help', () => {
  const s = scratch(wrap('  mode: player\n'));
  const bin = path.join(__dirname, '..', 'bin', 'gm-publish.js');
  const go = (...a) => spawnSync(process.execPath, [bin, 'settings', ...a], { encoding: 'utf8' });
  const set = go('set', 'publish.connections="cards"', '--vault', s.vault, '--json');
  assert.equal(set.status, 0, set.stderr);
  assert.deepEqual(JSON.parse(set.stdout).written, ['publish.connections']);
  const got = go('get', 'publish.connections', '--json', '--vault', s.vault);
  assert.equal(JSON.parse(got.stdout).settings['publish.connections'].value, 'cards');
  assert.equal(set.stderr.trim(), 'publish.connections is now player_site.features.connections.');
  const viaConfig = go('get', 'player_site.features.connections', '--config', s.config);
  assert.equal(viaConfig.stdout.trim(), 'player_site.features.connections: cards (vault file)');
  assert.match(go('--help').stdout, /player_site\.features\.connections/);
  assert.equal(go('bogus', '--vault', s.vault).status, 1);
});

// ---- The older vault-setting command, against what it printed before it was replaced ----

const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vault-setting-before.json'), 'utf8'));

function alias(s, set) {
  const out = [];
  const err = [];
  const rc = runVaultSetting({ config: s.config, vault: s.vault, set, json: true }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.length ? JSON.parse(out.join('\n')) : null, err };
}

for (const c of before.get) {
  test(`vault-setting prints what it always did: ${c.name}`, () => {
    const s = scratch(c.config, c.site);
    const got = alias(s, []);
    assert.equal(got.rc, c.rc);
    assert.deepEqual(got.out, c.json);
    assert.deepEqual(Object.keys(got.out), Object.keys(c.json));
  });
}

for (const c of before.set) {
  test(`vault-setting --set does what it always did: ${c.name}`, () => {
    const s = scratch(c.config, null);
    const got = alias(s, c.set);
    assert.equal(got.rc, c.rc);
    if (c.rc === 0) {
      assert.deepEqual(got.out, c.out);
      assert.equal(text(s), c.after);
    } else {
      // Refused as before, the file left alone; the line says it in plain words now.
      assert.equal(got.err.length >= 1, true);
      assert.match(got.err[0], /^Error: /);
      assert.equal(text(s), c.config);
    }
  });
}

// ---- get several, whole values, add and remove ----

test('get takes several names and groups, in the order asked', () => {
  const s = scratch(wrap('  mode: player\n  landing:\n    max_npcs: 3\n'));
  const { rc, data } = run(s, 'get', ['player_site.hide.mode', 'player_site.landing', 'player_site.publish']);
  assert.equal(rc, 0);
  assert.deepEqual(Object.keys(data.settings).slice(0, 2), ['publish.mode', 'publish.landing.max_npcs']);
  assert.ok(Object.keys(data.settings).includes('publish.site'));
  assert.ok(!('publish.connections' in data.settings));
  const out = [];
  runSettings({ verb: 'get', args: ['player_site.publish', 'player_site.hide.mode'], vault: s.vault }, { out: (l) => out.push(l) });
  assert.match(out[0], /^player_site\.publish: /);
  assert.match(out[0].split('\n')[1], /^player_site\.hide\.mode: player/);
  // The same through the old names: the same lines, after one line saying what each is now called.
  const old = [];
  runSettings({ verb: 'get', args: ['publish.site', 'publish.mode'], vault: s.vault }, { out: (l) => old.push(l) });
  assert.deepEqual(old[0].split('\n'), ['publish.site is now player_site.publish.', 'publish.mode is now player_site.hide.mode.', ...out[0].split('\n')]);
});

test('an old name gives the same answer as the new one, and says what it is now called', () => {
  const s = scratch(wrap('  search: false\n'));
  const viaNew = run(s, 'get', ['player_site.features.search']);
  const viaOld = run(s, 'get', ['publish.search']);
  assert.deepEqual(viaOld.data.byNewName, viaNew.data.byNewName);
  assert.deepEqual(viaNew.data.byNewName, { values: { 'player_site.features.search': false }, origins: { 'player_site.features.search': 'file' } });
  assert.deepEqual(viaNew.err, []);
  assert.deepEqual(viaOld.err, ['publish.search is now player_site.features.search.']);
  // The shape the vault scripts read: names as the old file has them.
  assert.deepEqual(viaOld.data.settings, { 'publish.search': { value: false, origin: 'file' } });
});

test('set by an old or new name writes the old file at the old place, and an old name says what it is now', () => {
  const s = scratch(wrap('  mode: player\n'));
  const viaOld = run(s, 'set', ['publish.search=off']);
  assert.equal(viaOld.rc, 0);
  assert.deepEqual(viaOld.err, ['publish.search is now player_site.features.search.']);
  assert.match(text(s), /^publish:\n(?:.*\n)*? {2}search: false$/m);
  const viaNew = run(s, 'set', ['player_site.features.connections=web']);
  assert.deepEqual(viaNew.err, []);
  assert.match(text(s), / {2}connections: web/);
  assert.deepEqual(run(s, 'unset', ['player_site.features.search']).data, { removed: ['player_site.features.search'] });
  assert.doesNotMatch(text(s), /search:/);
});

test('unset takes out an older spelling by the spelling written, and raw reads it the same way', () => {
  const s = scratch(wrap('  images:\n    maxWidth: 800\n  backend:\n    inbox: true\n'));
  assert.equal(run(s, 'raw', ['publish.images.maxWidth']).data, 800);
  assert.equal(run(s, 'raw', ['player_site.images.max_width']).data, null);
  assert.deepEqual(run(s, 'unset', ['publish.images.maxWidth', 'publish.backend.inbox']).data, { removed: ['publish.images.maxWidth', 'publish.backend.inbox'] });
  assert.doesNotMatch(text(s), /maxWidth|inbox/);
});

test('the two settings the old file never had are refused by set and unset, and read as their defaults', () => {
  const s = scratch(wrap('  mode: player\n'));
  assert.deepEqual(run(s, 'unset', ['vault.kept_by']).err, ['Error: vault.kept_by needs the new settings file; run the update first.']);
  const got = run(s, 'get', ['vault']);
  assert.deepEqual(got.data.byNewName.values['vault.kept_by'], 'gm');
  assert.equal(got.data.byNewName.values['vault.campaign'], null);
});

test('get with one name that is not a setting prints nothing and exits 1', () => {
  const s = scratch(wrap(''));
  const out = [];
  const err = [];
  const rc = runSettings({ verb: 'get', args: ['publish.mode', 'publish.zebra'], vault: s.vault }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(rc, 1);
  assert.deepEqual(out, []);
  assert.deepEqual(err, ['Error: publish.zebra is not a setting.']);
});

test('plain output prints lists whole, in get, describe and list', () => {
  const s = scratch(wrap(''));
  const all = JSON.stringify(REGISTRY.find((e) => e.name === 'player_site.hide.sections').default);
  const plain = (verb, args) => { const out = []; runSettings({ verb, args, vault: s.vault }, { out: (l) => out.push(l) }); return out.join('\n'); };
  assert.ok(plain('get', ['publish.exclude_sections']).includes(all));
  assert.ok(plain('describe', ['publish.exclude_sections']).includes(`default: ${all}`));
  assert.ok(plain('list', []).includes(`(default ${all})`));
});

const SECTIONS = REGISTRY.find((e) => e.name === 'player_site.hide.sections').default;
const listOf = (s, name = 'publish.exclude_sections') => run(s, 'get', [name]).data.settings[name];

test('add to an unset hiding list keeps the built-in entries and adds the new one', () => {
  const s = scratch(wrap('  # mine\n  mode: player\n'));
  const { rc, data } = run(s, 'add', ['publish.exclude_sections', '"Rumours"']);
  assert.equal(rc, 0);
  assert.deepEqual(data, { written: ['publish.exclude_sections'], notes: [], added: ['Rumours'], already: [], list: [...SECTIONS, 'Rumours'] });
  assert.match(text(s), /# mine\n/);
  assert.deepEqual(listOf(s), { value: [...SECTIONS, 'Rumours'], origin: 'file' });
});

test('add of an entry already there changes nothing and exits 0; add twice is idempotent', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  const same = run(s, 'add', ['publish.exclude_sections', `"${SECTIONS[0]}"`]);
  assert.equal(same.rc, 0);
  assert.deepEqual([same.data.written, same.data.added, same.data.already], [[], [], [SECTIONS[0]]]);
  assert.equal(text(s), before);
  run(s, 'add', ['publish.exclude_sections', '"Rumours"', '"Rumours"']);
  const once = text(s);
  const again = run(s, 'add', ['publish.exclude_sections', '"Rumours"']);
  assert.deepEqual([again.rc, again.data.written, again.data.already], [0, [], ['Rumours']]);
  assert.equal(text(s), once);
});

test('add keeps the entries the site file holds when --config is given', () => {
  const s = scratch(wrap('  mode: player\n'), { vaultPath: './vault', excludeSections: ['Old Notes'] });
  const { data } = run(s, 'add', ['publish.exclude_sections', '"Rumours"'], { config: s.config });
  assert.ok(data.list.includes('Old Notes') && data.list.includes('Rumours'));
  assert.ok(require('../lib/frontmatter').parseNote(text(s)).data.publish.exclude_sections.includes('Old Notes'));
});

test('remove takes a custom entry out, and reports one that was not there', () => {
  const s = scratch(wrap('  exclude_sections: [Rumours, Plans]\n'));
  const { rc, data } = run(s, 'remove', ['publish.exclude_sections', '"Rumours"', '"Nope"']);
  assert.equal(rc, 0);
  assert.deepEqual(data, { written: ['publish.exclude_sections'], notes: [], removed: ['Rumours'], absent: ['Nope'], list: ['Plans'] });
  assert.deepEqual(run(s, 'remove', ['publish.exclude_sections', '"Nope"']).data.written, []);
});

test('remove of a built-in entry from a hiding list says it is no longer hidden; the last entry gives the empty-list note', () => {
  const s = scratch(wrap('  mode: player\n'));
  const { data } = run(s, 'remove', ['publish.exclude_sections', `"${SECTIONS[0]}"`]);
  assert.deepEqual(data.notes, [`"${SECTIONS[0]}" was built in to publish.exclude_sections and is no longer hidden.`]);
  assert.deepEqual(data.list, SECTIONS.slice(1));
  const t = scratch(wrap('  exclude_sections: [Plans]\n'));
  const last = run(t, 'remove', ['publish.exclude_sections', '"Plans"']);
  assert.deepEqual(last.data.list, []);
  assert.match(last.data.notes[0], /is empty: nothing from the built-in list is hidden/);
  const u = scratch(wrap('  mode: player\n'));
  const all = run(u, 'remove', ['publish.exclude_sections', ...SECTIONS.map((x) => JSON.stringify(x))]);
  assert.deepEqual(all.data.list, []);
  assert.equal(all.data.notes.length, SECTIONS.length + 1);
  assert.match(all.data.notes.at(-1), /is empty: nothing from the built-in list is hidden/);
});

test('add and remove refuse a setting that is not a list, a blank or unquoted entry, and a faulted value', () => {
  const s = scratch(wrap('  exclude_sections: 5\n'));
  const before = text(s);
  const lines = (args, verb = 'add') => run(s, verb, args).err;
  assert.deepEqual(lines(['publish.connections', '"web"']), ['Error: publish.connections is not a list, so entries cannot be added to it.']);
  assert.deepEqual(lines(['publish.connections', '"web"'], 'remove'), ['Error: publish.connections is not a list, so entries cannot be removed from it.']);
  assert.deepEqual(lines(['publish.exclude_fields', '" "']), ['Error: publish.exclude_fields has a blank entry; remove it.']);
  assert.deepEqual(lines(['publish.exclude_sections', '"x"']), ['Error: publish.exclude_sections in the file cannot be read; fix it with settings set first.']);
  assert.deepEqual(lines(['publish.zebra', '"x"']), ['Error: publish.zebra is not a setting.']);
  assert.equal(text(s), before);
});

test('the help names add and remove', () => {
  assert.match(helpText(), /settings add /);
  assert.match(helpText(), /settings remove /);
});

// ---- the same entry, by the build's own rule ----

test('remove finds an entry the way the build does: case, folder slash', () => {
  const s = scratch(wrap('  exclude_sections: [GM Notes, Rumours]\n  exclude_dirs: [Secrets]\n  exclude_fields: [Secrets]\n'));
  let r = run(s, 'remove', ['publish.exclude_sections', '"gm notes"']);
  assert.deepEqual([r.data.removed, r.data.absent, r.data.list], [['GM Notes'], [], ['Rumours']]);
  r = run(s, 'remove', ['publish.exclude_dirs', '"secrets"']);
  assert.deepEqual([r.data.removed, r.data.list], [['Secrets'], []]);
  run(s, 'add', ['publish.exclude_dirs', '"Secrets"']);
  r = run(s, 'remove', ['publish.exclude_dirs', '"Secrets/"']);
  assert.deepEqual(r.data.removed, ['Secrets']);
});

test('add of the same heading in another spelling is already there, under the spelling that exists', () => {
  const s = scratch(wrap('  exclude_sections: [GM Notes]\n'));
  const before = text(s);
  for (const spelling of ['**GM Notes**', ' GM Notes ', 'gm  notes:']) {
    const r = run(s, 'add', ['publish.exclude_sections', JSON.stringify(spelling)]);
    assert.deepEqual([r.rc, r.data.added, r.data.already, r.data.written], [0, [], ['GM Notes'], []], spelling);
  }
  assert.equal(text(s), before);
  const dirs = scratch(wrap('  exclude_dirs: [Secrets]\n'));
  assert.deepEqual(run(dirs, 'add', ['publish.exclude_dirs', '"Secrets/"']).data.already, ['Secrets']);
});

test('a decomposed form of a composed entry is the same entry', () => {
  const s = scratch(wrap('  exclude_sections: [Caf\u00e9 Notes]\n'));
  const r = run(s, 'add', ['publish.exclude_sections', JSON.stringify('Cafe\u0301 Notes')]);
  assert.deepEqual([r.data.added, r.data.already], [[], ['Caf\u00e9 Notes']]);
  const rm = run(s, 'remove', ['publish.exclude_sections', JSON.stringify('Cafe\u0301 Notes')]);
  assert.deepEqual(rm.data.removed, ['Caf\u00e9 Notes']);
});

test('a list the build matches exactly treats another case as another entry', () => {
  const s = scratch(wrap('  exclude_fields: [secrets]\n'));
  const add = run(s, 'add', ['publish.exclude_fields', '"Secrets"']);
  assert.deepEqual([add.data.added, add.data.already], [['Secrets'], []]);
  assert.deepEqual(run(s, 'remove', ['publish.exclude_fields', '"SECRETS"']).data.absent, ['SECRETS']);
});

test('exclude_callouts: add makes a list when off, is refused when on; remove has nothing to do when off', () => {
  const off = scratch(wrap('  mode: player\n'));
  assert.deepEqual(run(off, 'remove', ['publish.exclude_callouts', '"gm"']).data, { written: [], notes: [], removed: [], absent: ['gm'], list: [] });
  const added = run(off, 'add', ['publish.exclude_callouts', '"gm"', '"secret"']);
  assert.deepEqual([added.rc, added.data.list], [0, ['gm', 'secret']]);
  assert.deepEqual(run(off, 'add', ['publish.exclude_callouts', '"GM"']).data.already, ['gm']);
  assert.deepEqual(run(off, 'remove', ['publish.exclude_callouts', '"GM"']).data.removed, ['gm']);
  const on = scratch(wrap('  exclude_callouts: true\n'));
  const before = text(on);
  for (const verb of ['add', 'remove']) {
    const r = run(on, verb, ['publish.exclude_callouts', '"gm"']);
    assert.equal(r.rc, 1);
    assert.match(r.err[0], /^Error: publish\.exclude_callouts is on, which hides every one of its kind.*settings set publish\.exclude_callouts/);
  }
  assert.equal(text(on), before);
});

test('remove of a built-in entry the site file also lists says it still applies, not that it is unhidden', () => {
  const s = scratch(wrap('  mode: player\n'), { vaultPath: './vault', excludeSections: ['GM Notes'] });
  const { data } = run(s, 'remove', ['publish.exclude_sections', '"GM Notes"'], { config: s.config });
  assert.equal(data.notes.length, 1);
  assert.match(data.notes[0], /^"GM Notes" still applies, because vault\.config\.json also lists it/);
});

test('the empty-list note names what the list holds', () => {
  const s = scratch(wrap('  exclude_dirs: [Plans]\n'));
  const { data } = run(s, 'remove', ['publish.exclude_dirs', '"plans"']);
  assert.match(data.notes[0], /Add the folders you want hidden/);
});

// ---- plain values ----

test('set takes plain text for any setting, validated by its type', () => {
  const s = scratch(wrap('  mode: player\n'));
  const r = run(s, 'set', ['publish.search=off', 'publish.connections=web', 'publish.mode=full', 'publish.site_title=The Long Night', 'publish.theme.palette.accent=#c9a227']);
  assert.equal(r.rc, 0, r.err.join());
  const publish = require('../lib/frontmatter').parseNote(text(s)).data.publish;
  assert.equal(publish.search, false);
  assert.equal(publish.connections, 'web');
  assert.equal(publish.mode, 'full');
  assert.equal(publish.site_title, 'The Long Night');
  assert.equal(publish.theme.palette.accent, '#c9a227');
});

test('set still reads valid JSON as JSON', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'set', ['publish.search=true', 'publish.landing.max_npcs=3', 'publish.landing.quick_links=["a","b"]', 'publish.footer="quoted text"']).rc, 0);
  const publish = require('../lib/frontmatter').parseNote(text(s)).data.publish;
  assert.deepEqual([publish.search, publish.landing.max_npcs, publish.landing.quick_links, publish.footer], [true, 3, ['a', 'b'], 'quoted text']);
});

test('set refuses plain text the setting does not take, and an empty value', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  assert.deepEqual(run(s, 'set', ['publish.connections=sideways']).err, ['Error: publish.connections is "sideways"; it takes tree, web, cards or off.']);
  assert.equal(run(s, 'set', ['publish.landing.max_npcs=three']).rc, 1);
  assert.equal(run(s, 'set', ['publish.footer=  ']).rc, 1);
  assert.equal(run(s, 'set', ['publish.exclude_sections=[oops']).rc, 1);
  assert.equal(text(s), before);
});

test('set keeps a = inside the value, broken-looking JSON as text, and a number as a number', () => {
  const s = scratch(wrap(''));
  assert.equal(run(s, 'set', ['publish.footer=a=b']).rc, 0);
  assert.equal(require('../lib/frontmatter').parseNote(text(s)).data.publish.footer, 'a=b');
  assert.equal(run(s, 'set', ['publish.footer={oops']).rc, 0);
  assert.equal(require('../lib/frontmatter').parseNote(text(s)).data.publish.footer, '{oops');
  assert.equal(run(s, 'set', ['publish.landing.max_npcs=3']).rc, 0);
  assert.equal(require('../lib/frontmatter').parseNote(text(s)).data.publish.landing.max_npcs, 3);
});

test('add and remove take entries as plain text', () => {
  const s = scratch(wrap('  mode: player\n'));
  const add = run(s, 'add', ['publish.exclude_sections', 'Secrets', 'Player Handout', '"Quoted"']);
  assert.deepEqual(add.data.added, ['Secrets', 'Player Handout', 'Quoted']);
  assert.deepEqual(run(s, 'remove', ['publish.exclude_sections', 'player handout']).data.removed, ['Player Handout']);
  assert.deepEqual(run(s, 'add', ['publish.landing.quick_links', '1984']).data.added, ['1984']);
  assert.equal(run(s, 'add', ['publish.exclude_sections', '  ']).rc, 1);
});

test('add and remove spread a JSON list of text and refuse maps, null and mixed lists', () => {
  const s = scratch(wrap('  mode: player\n'));
  const before = text(s);
  const add = run(s, 'add', ['publish.exclude_sections', '["Rumours","Plans"]']);
  assert.equal(add.rc, 0);
  assert.deepEqual(add.data.added, ['Rumours', 'Plans']);
  const gone = run(s, 'remove', ['publish.exclude_sections', '["Rumours","Plans"]']);
  assert.deepEqual(gone.data.removed, ['Rumours', 'Plans']);
  const kept = text(s);
  for (const bad of ['{"a":1}', 'null', '["A",1]', '["A",null]', '[["A"]]']) {
    for (const verb of ['add', 'remove']) {
      const r = run(s, verb, ['publish.exclude_sections', bad]);
      assert.notEqual(r.rc, 0, `${verb} ${bad}`);
      assert.match(String(r.err), /is not an entry/);
      assert.equal(text(s), kept, `${verb} ${bad} wrote`);
    }
  }
  assert.ok(before.length > 0);
  assert.deepEqual(run(s, 'add', ['publish.exclude_sections', 'Plain Word']).data.added, ['Plain Word']);
  assert.deepEqual(run(s, 'add', ['publish.exclude_sections', '"Quoted One"']).data.added, ['Quoted One']);
});

test('the help shows the plain form first', () => {
  assert.match(helpText(), /settings set <name>=<value> \.\.\. Write settings, all or none: settings set player_site\.features\.connections=web/);
  assert.match(helpText(), /written as JSON/);
});

// ---- A vault on the new settings file -------------------------------------------------------

const newScratch = (yamlText) => {
  const s = scratch(null);
  fs.writeFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), yamlText);
  return s;
};

test('new file: get reads it, under both the new names and main\'s old ones', () => {
  const s = newScratch('player_site:\n  features:\n    connections: web\n  hide:\n    sections: [Rumours]\n');
  const { rc, data } = run(s, 'get');
  assert.equal(rc, 0);
  assert.deepEqual(data.byNewName.values['player_site.features.connections'], 'web');
  assert.deepEqual(data.settings['publish.connections'], { value: 'web', origin: 'file' });
  assert.deepEqual(data.settings['publish.exclude_sections'], { value: ['Rumours'], origin: 'file' });
  assert.equal(data.file.exists, true);
  assert.equal(data.file.leftover, false);
  assert.deepEqual(data.faults, []);
  assert.deepEqual(run(s, 'get', ['player_site.features.connections']).data.settings, { 'publish.connections': { value: 'web', origin: 'file' } });
});

test('new file: check lists faults and exits 1 on a stop', () => {
  const s = newScratch('player_site:\n  exclude_sections: [x]\n');
  const { rc, data } = run(s, 'check');
  assert.equal(rc, 1);
  assert.equal(data.faults[0].use, 'player_site.hide.sections');
});

test('new file: list and describe do not need the file', () => {
  const s = newScratch('version: 1\n');
  assert.equal(run(s, 'list').rc, 0);
  assert.equal(run(s, 'describe', ['player_site.hide.mode']).data.name, 'player_site.hide.mode');
});

test('new file: raw returns the parsed file, or the value at a name', () => {
  const s = newScratch('version: 1\nplayer_site:\n  title: Hello\n');
  assert.deepEqual(run(s, 'raw').data, { version: 1, player_site: { title: 'Hello' } });
  assert.equal(run(s, 'raw', ['player_site.title']).data, 'Hello');
  assert.equal(run(s, 'raw', ['player_site.footer']).data, null);
});

test('new file: set, unset, add and remove refuse with one line and change nothing', () => {
  const s = newScratch('version: 1\n');
  const before = fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), 'utf8');
  for (const [verb, args] of [['set', ['player_site.title=A']], ['unset', ['player_site.title']], ['add', ['player_site.hide.sections', 'X']], ['remove', ['player_site.hide.sections', 'X']]]) {
    const r = run(s, verb, args);
    assert.equal(r.rc, 1, verb);
    assert.deepEqual(r.err, ['Error: this vault is on the new settings file; writing it arrives with the next step'], verb);
  }
  assert.equal(fs.readFileSync(path.join(s.vault, '_meta', 'vault-config.yaml'), 'utf8'), before);
  assert.equal(fs.existsSync(file(s)), false);
});

test('old file: the old-named top level and the new-named one agree', () => {
  const s = scratch(wrap('  connections: cards\n'));
  const { data } = run(s, 'get');
  assert.equal(data.settings['publish.connections'].value, 'cards');
  assert.equal(data.byNewName.values['player_site.features.connections'], 'cards');
});
