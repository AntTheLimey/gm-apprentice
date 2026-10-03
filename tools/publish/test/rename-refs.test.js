const { describe, it } = require('node:test');
require('./helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { pcLiveKey, slugify } = require('../lib/scanner');
const { build } = require('../lib/build');
const { setPublishKeys } = require('../lib/vault-config-edit');

const BIN = path.join(__dirname, '..', 'bin', 'gm-publish.js');
const FROM = 'Characters/PCs/Emma_Wentworth.md';
const TO = 'Characters/PCs/Emma_Wentworth_Hale.md';

function vaultWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-refs-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function rename(vault, from = FROM, to = TO, extra = []) {
  const out = execFileSync('node', [BIN, 'manifest', 'rename', '--vault', vault, '--from', from, '--to', to, '--json', ...extra], { encoding: 'utf8' });
  return JSON.parse(out);
}

const MANIFEST = (eol = '\n') => [
  '---', 'generated: 2026-10-03', '---', '',
  '## Publishing (2 files)', '',
  `- [x] ${FROM}`,
  `- [x] Characters/PCs/Emma_Wentworth_Story.md`,
  '',
  '## Excluded (1 files)', '',
  `- [x] ${FROM} — kept off while testing`,
  '',
  '## Needs Decision (1 files)', '',
  `- [ ] ${FROM}`,
  '',
].join(eol);

describe('manifest rename', () => {
  it('rewrites the path in all three sections and leaves a longer name alone', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': MANIFEST() });
    const got = rename(vault);
    const text = got.files['_meta/publish-manifest.md'];
    assert.strictEqual(text, MANIFEST().split(FROM).join(TO));
    assert.match(text, /Emma_Wentworth_Story\.md/);
    assert.strictEqual(got.pin, undefined);
    assert.strictEqual(fs.readFileSync(path.join(vault, '_meta/publish-manifest.md'), 'utf8'), MANIFEST(), 'writes nothing');
  });

  it('keeps CRLF endings', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': MANIFEST('\r\n') });
    const text = rename(vault).files['_meta/publish-manifest.md'];
    assert.strictEqual(text, MANIFEST('\r\n').split(FROM).join(TO));
  });

  it('matches an NFD manifest entry against an NFC path', () => {
    const nfc = 'Characters/PCs/Renée.md';
    const vault = vaultWith({ '_meta/publish-manifest.md': `## Publishing (1 files)\n\n- [x] ${nfc.normalize('NFD')}\n` });
    const got = rename(vault, nfc, 'Characters/PCs/Renee.md');
    assert.strictEqual(got.files['_meta/publish-manifest.md'], '## Publishing (1 files)\n\n- [x] Characters/PCs/Renee.md\n');
  });

  it('prints {"files": {}} when nothing names the note', () => {
    const vault = vaultWith({ '_meta/publish-manifest.md': '## Publishing (1 files)\n\n- [x] Locations/Elsewhere.md\n' });
    assert.deepStrictEqual(rename(vault).files, {});
    assert.deepStrictEqual(rename(vaultWith({ 'a.md': 'x' })).files, {});
  });

  it('rewrites a vault-config override path and featured names, byte for byte', () => {
    const cfg = [
      '---', 'publish:', '  mode: player', '  overrides:', '    fields:',
      `      "${FROM}":`, '        include: [secrets]',
      '  landing:', '    featured_npcs: ["Emma_Wentworth", Other]', '    quick_links:', '      - Emma_Wentworth', '---', '', '# Config', ''].join('\n');
    const vault = vaultWith({ '_meta/vault-config.md': cfg, [FROM]: '---\ntype: npc\n---\n' });
    const text = rename(vault).files['_meta/vault-config.md'];
    assert.strictEqual(text, cfg.replace(FROM, TO).replace('"Emma_Wentworth"', '"Emma_Wentworth_Hale"').replace('- Emma_Wentworth', '- Emma_Wentworth_Hale'));
  });

  it('leaves a featured name alone when two notes share the old name', () => {
    const cfg = '---\npublish:\n  landing:\n    featured_npcs: [Emma_Wentworth]\n---\n';
    const vault = vaultWith({ '_meta/vault-config.md': cfg, [FROM]: '---\ntype: npc\n---\n', 'Elsewhere/Emma_Wentworth.md': '---\ntype: npc\n---\n' });
    assert.deepStrictEqual(rename(vault).files, {});
  });

  it('exits non-zero with one stderr line on bad arguments', () => {
    const r = spawnSync('node', [BIN, 'manifest', 'rename', '--vault', os.tmpdir(), '--from', FROM], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1);
    assert.match(r.stderr, /--to/);
    const bad = spawnSync('node', [BIN, 'manifest', 'rename', '--vault', '/no/such/dir', '--from', FROM, '--to', TO], { encoding: 'utf8' });
    assert.notStrictEqual(bad.status, 0);
    assert.strictEqual(bad.stderr.trim().split('\n').length, 1);
  });
});

describe('manifest rename: the live key', () => {
  it('says what a PC page is keyed by now', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n' });
    const got = rename(vault);
    assert.deepStrictEqual(got.files, {});
    assert.deepStrictEqual(got.pin, { live_key: 'emma-wentworth' });
  });

  it('has no pin when the rename leaves the key as it is', () => {
    const pinned = vaultWith({ [FROM]: '---\ntype: pc\nlive_key: Old Key\n---\n' });
    assert.strictEqual(rename(pinned).pin, undefined);
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n' });
    assert.strictEqual(rename(vault, FROM, 'Characters/Retired/Emma_Wentworth.md').pin, undefined);
    assert.strictEqual(rename(vault, FROM, 'Characters/PCs/emma wentworth.md').pin, undefined);
  });

  it('has no pin for a note that holds no live state', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: npc\n---\n' });
    assert.strictEqual(rename(vault).pin, undefined);
  });
});

const STORY = 'Characters/PCs/Emma_Wentworth_Story.md';
const STORY_TO = 'Characters/PCs/Emma_Wentworth_Hale_Story.md';
const STORY_NOTE = '---\ntype: character-story\ncharacter: "[[Emma_Wentworth]]"\n---\n';

describe('manifest rename: story companions', () => {
  const manifest = `## Publishing (2 files)\n\n- [x] ${FROM}\n- [x] ${STORY}\n`;

  it('lists the story file beside the PC and rewrites its manifest entry too', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n', [STORY]: STORY_NOTE, '_meta/publish-manifest.md': manifest });
    const got = rename(vault);
    assert.deepStrictEqual(got.companions.map((x) => [x.from, x.to]), [[STORY, STORY_TO]]);
    assert.strictEqual(got.files['_meta/publish-manifest.md'], `## Publishing (2 files)\n\n- [x] ${TO}\n- [x] ${STORY_TO}\n`);
    assert.strictEqual(got.detaches, undefined);
  });

  it('has no companion for a PC with no story, or an untyped story file the build does not scan', () => {
    const none = vaultWith({ [FROM]: '---\ntype: pc\n---\n' });
    assert.strictEqual(rename(none).companions, undefined);
    const untyped = vaultWith({ [FROM]: '---\ntype: pc\n---\n', [STORY]: 'no frontmatter\n' });
    assert.strictEqual(rename(untyped).companions, undefined);
  });

  it('moves any typed <PC>_Story.md beside a PC, as the build hides it whatever its type', () => {
    const odd = vaultWith({ [FROM]: '---\ntype: pc\n---\n', [STORY]: '---\ntype: npc\n---\n' });
    const c = rename(odd).companions;
    assert.deepStrictEqual(c.map((x) => [x.from, x.to]), [[STORY, STORY_TO]]);
    assert.match(rename(odd, STORY, 'Characters/PCs/Emma_Tale.md').detaches, /story/);
  });

  it('refuses a rename onto <PC>_Story.md beside a PC, which the build would swallow as its story', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n', 'Characters/NPCs/Hallam.md': '---\ntype: npc\n---\n' });
    const got = rename(vault, 'Characters/NPCs/Hallam.md', STORY);
    assert.match(got.refusal, /Characters\/PCs\/Emma_Wentworth_Story\.md would attach to Emma_Wentworth as its story/);
    const fine = rename(vault, 'Characters/NPCs/Hallam.md', 'Characters/NPCs/Hallam_Story.md');
    assert.strictEqual(fine.refusal, undefined);
  });

  it('refuses a PC renamed onto a name whose story file is already there', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n', 'Characters/PCs/Other_Story.md': STORY_NOTE });
    assert.match(rename(vault, FROM, 'Characters/PCs/Other.md').refusal, /Other_Story\.md would attach to Other as its story/);
  });

  it('says the story alone would detach', () => {
    const vault = vaultWith({ [FROM]: '---\ntype: pc\n---\n', [STORY]: STORY_NOTE });
    const got = rename(vault, STORY, 'Characters/PCs/Emma_Tale.md');
    assert.match(got.detaches, /Emma_Wentworth_Story\.md is Emma_Wentworth's story; rename Emma_Wentworth and the story moves with it/);
  });

  it('does not call a story with no PC detached', () => {
    const vault = vaultWith({ [STORY]: STORY_NOTE });
    assert.strictEqual(rename(vault, STORY, 'Characters/PCs/Emma_Tale.md').detaches, undefined);
  });
});

describe('manifest rename: who each spelling goes to', () => {
  const SITE = '---\npublish:\n  mode: full\n  folder_map:\n    Characters/NPCs: characters/npcs\n    Characters/PCs: characters/pcs\n    Sessions: sessions\n---\n';
  const NPC = 'Characters/NPCs/Charlotte_Thorne.md';
  const PC = 'Characters/PCs/Charlotte_Thorne.md';
  const note = (type, extra = '') => `---\ntype: ${type}\n${extra}---\n# C\n`;
  const names = (...n) => n.flatMap((x) => ['--name', x]);
  const ask = (vault, spellings, from = NPC, extra = []) => rename(vault, from, 'Characters/NPCs/Charlotte_Thorne_NPC.md', [...names(...spellings), ...extra]);

  it('asks nothing of the link map when no spelling is given', () => {
    const vault = vaultWith({ '_meta/vault-config.md': SITE, [NPC]: note('npc') });
    assert.strictEqual(ask(vault, []).owners, undefined);
  });

  it('names the note the build links each spelling to', () => {
    const toNpc = vaultWith({ '_meta/vault-config.md': SITE, [NPC]: note('npc'), [PC]: note('pc', 'canon_status: SUPERSEDED\n') });
    assert.strictEqual(ask(toNpc, ['Charlotte_Thorne']).owners.Charlotte_Thorne, NPC);
    const toPc = vaultWith({ '_meta/vault-config.md': SITE, [NPC]: note('npc', 'canon_status: SUPERSEDED\n'), [PC]: note('pc') });
    assert.strictEqual(ask(toPc, ['Charlotte_Thorne']).owners.Charlotte_Thorne, PC);
  });

  it('follows an alias another note holds, and null for a spelling that maps to nothing', () => {
    const vault = vaultWith({
      '_meta/vault-config.md': SITE,
      'Characters/PCs/Charlotte_Thorne.md': note('pc'),
      'Characters/NPCs/Cast_Charlotte.md': note('npc', 'aliases: ["Charlotte Thorne"]\n'),
    });
    const got = ask(vault, ['Charlotte Thorne', 'Nobody_Here'], 'Characters/PCs/Charlotte_Thorne.md').owners;
    assert.strictEqual(got['Charlotte Thorne'], 'Characters/NPCs/Cast_Charlotte.md');
    assert.strictEqual(got.Nobody_Here, null);
    const hidden = vaultWith({ '_meta/vault-config.md': SITE, [NPC]: note('npc', 'publish: false\n') });
    assert.strictEqual(ask(hidden, ['Charlotte_Thorne']).owners.Charlotte_Thorne, null);
  });

  it('reads the site config the build reads, when the folder map lives there', () => {
    const vault = vaultWith({ '_meta/vault-config.md': '---\npublish:\n  mode: full\n---\n', [NPC]: note('npc') });
    const cfg = path.join(vault, 'site.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ vaultPath: vault, folderMap: { 'Characters/NPCs': 'characters/npcs' }, excludeDirs: ['_meta'] }));
    assert.strictEqual(ask(vault, ['Charlotte_Thorne']).owners.Charlotte_Thorne, null, 'no folder map without the site config');
    assert.strictEqual(ask(vault, ['Charlotte_Thorne'], NPC, ['--config', cfg]).owners.Charlotte_Thorne, NPC);
  });

  it('agrees with what the build links a bare name to', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-owner-'));
    const vault = path.join(root, 'vault');
    for (const [rel, text] of Object.entries({
      '_meta/vault-config.md': SITE, [NPC]: note('npc'), [PC]: note('pc'),
      'Sessions/S1.md': '---\ntype: session\n---\nSee [[Charlotte_Thorne]].\n',
    })) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    }
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
    const real = console.log; console.log = () => {};
    try { build({ configPath }); } finally { console.log = real; }
    const html = fs.readFileSync(path.join(root, 'docs', 'sessions', 's1.html'), 'utf8');
    const href = /href="([^"]*charlotte-thorne[^"]*)"/.exec(html)[1];
    const owner = ask(vault, ['Charlotte_Thorne']).owners.Charlotte_Thorne;
    assert.ok(href.includes(owner === NPC ? '/npcs/' : '/pcs/'), `${href} vs ${owner}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('backlinks follow the page a link resolves to', () => {
  it('two pages with one title: the session lists only the one the link map sends the name to', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backlink-key-'));
    const vault = path.join(root, 'vault');
    const files = {
      '_meta/vault-config.md': '---\npublish:\n  mode: full\n  folder_map:\n    Characters/NPCs: characters/npcs\n    Characters/PCs: characters/pcs\n    Sessions: sessions\n---\n',
      'Characters/NPCs/Charlotte_Thorne.md': '---\ntype: npc\ncanon_status: SUPERSEDED\n---\n# N\n',
      'Characters/PCs/Charlotte_Thorne.md': '---\ntype: pc\n---\n# P\n',
      'Sessions/S1.md': '---\ntype: session\n---\nWe met [[Charlotte_Thorne]].\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    }
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments', siteTitle: 'T' }));
    const real = console.log; console.log = () => {};
    try { build({ configPath }); } finally { console.log = real; }
    const html = fs.readFileSync(path.join(root, 'docs', 'sessions', 's1.html'), 'utf8');
    assert.match(html, /characters\/pcs\/charlotte-thorne\.html/);
    assert.doesNotMatch(html, /characters\/npcs\/charlotte-thorne\.html/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('manifest rename: what the site publishes', () => {
  const MAP = '---\npublish:\n  mode: full\n  exclude_dirs: [GM]\n  folder_map:\n    NPCs: characters/npcs\n    Cultures: cultures\n    Sessions: sessions\n---\n';
  const npc = '---\ntype: npc\n---\n# N\n';

  it('lists the notes the site publishes, so links in the rest are not read through its link map', () => {
    const vault = vaultWith({ '_meta/vault-config.md': MAP, 'NPCs/Hallam.md': npc, 'GM/Hallam.md': npc, 'GM/Plan.md': '---\ntype: session\n---\n[[Hallam]]\n', 'Sessions/S1.md': '---\ntype: session\n---\n[[Hallam]]\n' });
    const got = rename(vault, 'NPCs/Hallam.md', 'NPCs/Hallam_Reeve.md', ['--name', 'Hallam']);
    assert.ok(got.published.includes('NPCs/Hallam.md'));
    assert.ok(got.published.includes('Sessions/S1.md'));
    assert.ok(!got.published.includes('GM/Plan.md'));
    assert.ok(!got.published.includes('GM/Hallam.md'));
  });

  it('says when the new place would take a published page off the site', () => {
    const vault = vaultWith({ '_meta/vault-config.md': MAP, 'NPCs/Hallam.md': npc, 'Cultures/Elves.md': '---\ntype: culture\n---\n' });
    assert.match(rename(vault, 'NPCs/Hallam.md', 'Elsewhere/Hallam.md').unpublishes, /Elsewhere\/Hallam\.md.*folder_map/);
    assert.match(rename(vault, 'NPCs/Hallam.md', 'GM/Hallam.md').unpublishes, /GM\/Hallam\.md.*exclude_dirs/);
    assert.match(rename(vault, 'Cultures/Elves.md', 'Heritages/Elves.md').unpublishes, /Heritages\/Elves\.md.*folder_map/);
    assert.strictEqual(rename(vault, 'NPCs/Hallam.md', 'NPCs/Hallam_Reeve.md').unpublishes, undefined);
  });

  it('does not object when the page was not published to begin with', () => {
    const vault = vaultWith({ '_meta/vault-config.md': MAP, 'NPCs/Hallam.md': '---\ntype: npc\npublish: false\n---\n' });
    assert.strictEqual(rename(vault, 'NPCs/Hallam.md', 'Elsewhere/Hallam.md').unpublishes, undefined);
  });
});

describe('pcLiveKey', () => {
  it('is the slug of the title when live_key is absent, as before', () => {
    for (const title of ['Emma_Wentworth', 'Renée González', "O'Neil & Sons"]) {
      assert.strictEqual(pcLiveKey({ type: 'pc' }, title), slugify(title));
      assert.strictEqual(pcLiveKey(null, title), slugify(title));
      assert.strictEqual(pcLiveKey({ live_key: '  ' }, title), slugify(title));
      assert.strictEqual(pcLiveKey({ live_key: 7 }, title), slugify(title));
    }
  });

  it('uses the pinned value, as a slug', () => {
    assert.strictEqual(pcLiveKey({ live_key: 'emma-wentworth' }, 'Emma_Wentworth_Hale'), 'emma-wentworth');
    assert.strictEqual(pcLiveKey({ live_key: 'Emma: Wentworth' }, 'X'), 'emma-wentworth');
  });
});

describe('a pinned key reaches the build', () => {
  function buildRoster(pinned) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-key-'));
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    setPublishKeys(vault, { live_stats: true });
    const pcs = path.join(vault, 'Characters', 'PCs');
    if (pinned) {
      const src = fs.readFileSync(path.join(pcs, 'Karl Brenner.md'), 'utf8');
      fs.rmSync(path.join(pcs, 'Karl Brenner.md'));
      fs.writeFileSync(path.join(pcs, 'Karl_Hale.md'), src.replace('type: pc\n', 'type: pc\nlive_key: karl-brenner\n'));
    }
    fs.writeFileSync(path.join(root, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Roster Test', system: 'gurps-4e', excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    build({ configPath });
    const read = (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8');
    return { read, root };
  }

  it('without live_key the slug is the filename slug, as today', () => {
    const { read, root } = buildRoster(false);
    assert.match(read('characters', 'pcs', 'player-characters.html'), /"pcSlug":"karl-brenner"/);
    assert.match(read('characters', 'pcs', 'karl-brenner.html'), /"pcSlug":"karl-brenner"/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('with live_key the pinned slug is in the page data and the party manifest, at the new URL', () => {
    const { read, root } = buildRoster(true);
    assert.match(read('characters', 'pcs', 'player-characters.html'), /"pcSlug":"karl-brenner"/);
    const page = read('characters', 'pcs', 'karl-hale.html');
    assert.match(page, /"pcSlug":"karl-brenner"/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('two PCs on one live key', () => {
  it('the build warns, naming both notes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-key-dup-'));
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    const pcs = path.join(vault, 'Characters', 'PCs');
    const src = fs.readFileSync(path.join(pcs, 'Karl Brenner.md'), 'utf8');
    fs.writeFileSync(path.join(pcs, 'Karl_Hale.md'), src.replace('type: pc\n', 'type: pc\nlive_key: karl-brenner\n'));
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Roster Test', system: 'gurps-4e', excludeDirs: ['_meta'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    const warned = [];
    const real = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try { build({ configPath }); } finally { console.warn = real; }
    const w = warned.find((m) => /live key/i.test(m));
    assert.ok(w, warned.join('\n'));
    assert.match(w, /Characters\/PCs\/Karl Brenner\.md/);
    assert.match(w, /Characters\/PCs\/Karl_Hale\.md/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('the build stays silent for a roster with distinct keys', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-key-ok-'));
    const vault = path.join(root, 'vault');
    fs.cpSync(path.join(__dirname, 'fixtures', 'with-party-roster'), vault, { recursive: true });
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Roster Test', system: 'gurps-4e', excludeDirs: ['_meta'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    const warned = [];
    const real = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try { build({ configPath }); } finally { console.warn = real; }
    assert.deepStrictEqual(warned.filter((m) => /live key/i.test(m)), []);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
