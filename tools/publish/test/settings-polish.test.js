'use strict';
// Message and report polish left over from the settings work (#373, #375, #380, #386): one case each.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSettings } = require('../lib/settings/cli.js');

function scratch(yaml, site) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  if (yaml !== null) fs.writeFileSync(path.join(vault, '_meta', 'vault-config.yaml'), yaml);
  fs.writeFileSync(path.join(root, 'vault.config.json'), JSON.stringify(site || { vaultPath: './vault' }));
  return { root, vault, config: path.join(root, 'vault.config.json'), yaml: path.join(vault, '_meta', 'vault-config.yaml') };
}

function run(s, verb, args = [], extra = {}) {
  const out = [];
  const err = [];
  const rc = runSettings({ verb, args, vault: s.vault, config: s.config, ...extra }, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { rc, out: out.join('\n'), err };
}

test('add of an empty list says there is nothing to add, and exits 1 (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    sections: [Rumours]\n');
  const before = fs.readFileSync(s.yaml, 'utf8');
  const { rc, out, err } = run(s, 'add', ['player_site.hide.sections', '[]']);
  assert.equal(rc, 1);
  assert.equal(out, '', 'no blank line');
  assert.match(err[0], /player_site\.hide\.sections.*no entries/);
  assert.equal(fs.readFileSync(s.yaml, 'utf8'), before);
});

test('removing two spellings of one built-in entry says "no longer hidden" once (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    sections: [GM Notes, gm notes, Rumours]\n');
  const { rc, out } = run(s, 'remove', ['player_site.hide.sections', 'GM Notes']);
  assert.equal(rc, 0, out);
  assert.equal(out.split('\n').filter((l) => l.includes('no longer hidden')).length, 1, out);
});

test('a stop and a warning together: the stop message carries the warning too (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  title: [a, b]\n  hide:\n    sections: {a: 1}\n');
  const { loadPublishConfig, assertNoStops } = require('../lib/config');
  const cfg = loadPublishConfig(s.vault, { vaultPath: s.vault }, () => {}, { siteDir: s.root });
  let message = '';
  try { assertNoStops(cfg, 'build'); } catch (e) { message = e.message; }
  assert.match(message, /hide\.sections/);
  assert.match(message, /player_site\.title/, message);
});

test('get prints a setting nobody set as "not set", not null (#373)', () => {
  const s = scratch('version: 1\nvault:\n  campaign: X\n');
  const { rc, out } = run(s, 'get', ['vault.setting_year']);
  assert.equal(rc, 0);
  assert.equal(out, 'vault.setting_year: not set (default)');
});

test('add of a folder outside the vault says so, not "blank entry" (#373)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    folders: [Secret]\n');
  const { rc, err } = run(s, 'add', ['player_site.hide.folders', '/elsewhere/x']);
  assert.equal(rc, 1);
  assert.match(err[0], /not a folder inside the vault/);
  assert.doesNotMatch(err[0], /blank/);
});

test('a failed after step does not claim nothing was built (#386)', () => {
  const { runSteps } = require('../lib/settings/steps');
  const fail = `${JSON.stringify(process.execPath)} -e "process.exit(1)"`;
  assert.throws(() => runSteps([fail], { cwd: os.tmpdir(), label: 'after_build', log: () => {} }), /The pages were built but not published\./);
  assert.throws(() => runSteps([fail], { cwd: os.tmpdir(), label: 'before_build', log: () => {} }), /Nothing was published\./);
});

test('a script is not split where a part sets shell state (#386)', () => {
  const { splitScript } = require('../lib/settings/steps');
  assert.deepEqual(splitScript('unset FOO && node a.js'), ['unset FOO && node a.js']);
  assert.deepEqual(splitScript('umask 022 && node a.js'), ['umask 022 && node a.js']);
  assert.deepEqual(splitScript('alias ll=ls && node a.js'), ['alias ll=ls && node a.js']);
  assert.deepEqual(splitScript('node a.js && node b.js'), ['node a.js', 'node b.js']);
});

test('the address of a published page stands even when a part of it is a hidden note\'s name (#386)', () => {
  const { resolveSiteLink, rememberHiddenNames } = require('../lib/build');
  const linkMap = Object.create(null);
  linkMap['Real Page'] = 'maps/real-page.html';
  rememberHiddenNames(linkMap, [{ vaultPath: 'Secret/Maps.md', frontmatter: {}, displayTitle: 'Maps' }]);
  assert.deepEqual(resolveSiteLink('maps/real-page.html', { linkMap, pages: [] }), { kind: 'site', href: 'maps/real-page.html' });
  // An address that is no page stays dropped.
  assert.deepEqual(resolveSiteLink('maps/other.html', { linkMap, pages: [] }), { kind: 'none', href: null });
});

test('a tall banner picture is height-capped on a phone, not only on a desktop (#386)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  const base = /\n\.landing-banner-img \{([^}]*)\}/.exec(css);
  assert.ok(base, 'the base rule is there');
  assert.match(base[1], /max-height:\s*\d/);
  assert.match(base[1], /object-fit:\s*contain/);
});

test('add onto a list written as a YAML alias is refused, and nothing is written (#380)', () => {
  const { applyChanges } = require('../lib/settings/write');
  const body = 'version: 1\nplayer_site:\n  hide:\n    fields: &a [x, y]\n    sections: *a\n';
  const s = scratch(body);
  assert.throws(() => applyChanges(s.vault, [{ op: 'add', name: 'player_site.hide.sections', entries: ['Z'], same: (a, b) => a === b }]), /alias/);
  assert.equal(fs.readFileSync(s.yaml, 'utf8'), body);
});

test('add onto an explicitly empty hiding list says the built-in entries are not in it (#380)', () => {
  const s = scratch('version: 1\nplayer_site:\n  hide:\n    sections: []\n');
  const { rc, out } = run(s, 'add', ['player_site.hide.sections', 'Rumours']);
  assert.equal(rc, 0, out);
  assert.match(out, /built-in/);
});

test('a vault keep list that drops folders the site file keeps is a stop naming them (#386)', () => {
  const { readSettings } = require('../lib/settings/read');
  const s = scratch('version: 1\nplayer_site:\n  keep: []\n');
  const r = readSettings({ vaultPath: s.vault, siteConfig: { preserveDirs: ['audio', 'maps'] }, siteDir: s.root });
  const f = r.faults.find((x) => x.siteDiffers);
  assert.equal(f.level, 'stop');
  assert.match(f.message, /audio/);
  assert.match(f.message, /maps/);
  // Folders the vault also keeps are no conflict worth a stop.
  const t = scratch('version: 1\nplayer_site:\n  keep: [audio, maps, extra]\n');
  const r2 = readSettings({ vaultPath: t.vault, siteConfig: { preserveDirs: ['audio'] }, siteDir: t.root });
  assert.ok(!r2.faults.some((x) => x.level === 'stop'));
});

test('the docs say build steps run as plain shell commands without npm\'s variables (#386)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'site-settings.md'), 'utf8');
  assert.match(doc, /plain shell commands[^.]*without npm's variables/);
});

test('a key can be added after a |+ block scalar: its trailing blank lines are content and stay (#380)', () => {
  const { applyChanges } = require('../lib/settings/write');
  const s = scratch('version: 1\nplayer_site:\n  title: T\n  footer: |+\n    hello\n\n');
  applyChanges(s.vault, [{ op: 'set', name: 'player_site.host', value: 'github-pages' }]);
  const YAML = require('yaml');
  const back = YAML.parse(fs.readFileSync(s.yaml, 'utf8'));
  assert.equal(back.player_site.footer, 'hello\n\n');
  assert.equal(back.player_site.host, 'github-pages');
});
