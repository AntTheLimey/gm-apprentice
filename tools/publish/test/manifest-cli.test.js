const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runManifest } = require('../lib/manifest-cli');

const FIXTURES = path.join(__dirname, 'fixtures');

const FOLDER_MAP = {
  _Campaign: 'campaign',
  'Characters/PCs': 'characters/pcs',
  'Characters/NPCs': 'characters/npcs',
  Locations: 'locations',
  Sessions: 'sessions',
};

// A site dir with a vault.config.json pointing at `vaultPath`.
function siteFor(vaultPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-cli-'));
  const configPath = path.join(dir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'Test Campaign',
    vaultPath,
    outputDir: './docs',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: FOLDER_MAP,
  }, null, 2));
  return { dir, configPath };
}

// A throwaway copy of a fixture vault, so apply can write into _meta/.
function copyVault(name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-vault-'));
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

function capture() {
  const out = [];
  const writes = {};
  return {
    out,
    writes,
    deps: {
      out: (line) => out.push(String(line)),
      writeFile: (p, content) => { writes[p] = content; fs.writeFileSync(p, content); },
      now: () => new Date('2026-09-07T12:00:00.000Z'),
    },
    text: () => out.join('\n'),
  };
}

describe('manifest diff', () => {
  it('classifies every vault file when there is no manifest', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'diff', configPath }, c.deps);

    assert.strictEqual(rc, 0);
    const text = c.text();
    assert.match(text, /^manifest: no manifest — 2 publishing, 3 excluded, 0 needs decision$/m);
    // Every file is New, with its bucket, code and reason on one tab-separated row.
    assert.match(text, /^ {2}Sessions\/Planned Session\.md\texclude\tAUTO_EXCLUDED_STATUS\tstatus: planned$/m);
    assert.match(text, /^ {2}Characters\/NPCs\/Prep Source\.md\texclude\tAUTO_EXCLUDED_SOURCE\tsource: prep$/m);
    assert.match(text, /^ {2}Sessions\/Played Session\.md\tpublish\tOK\tmode: player$/m);
    assert.match(text, /^New \(5\):$/m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--json reports the same classification', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'diff', configPath, json: true }, c.deps), 0);

    const payload = JSON.parse(c.out.join(''));
    assert.strictEqual(payload.manifestExists, false);
    assert.strictEqual(payload.mode, 'player');
    assert.strictEqual(payload.new.length, 5);
    assert.deepStrictEqual(payload.removed, []);
    assert.deepStrictEqual(payload.counts.publishing, 2);
    assert.deepStrictEqual(payload.counts.excluded, 3);
    const planned = payload.new.find(e => e.path === 'Sessions/Planned Session.md');
    assert.deepStrictEqual(planned, {
      path: 'Sessions/Planned Session.md',
      bucket: 'exclude',
      code: 'AUTO_EXCLUDED_STATUS',
      reason: 'status: planned',
    });
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('separates new files, removed entries and unchanged ones', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Publishing (2 files)', '',
      '- [x] Sessions/Played Session.md',
      '- [x] Locations/Long Gone.md',
      '',
      '## Excluded (1 files)', '',
      '- [x] Sessions/Planned Session.md — prep',
      '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'diff', configPath, json: true }, c.deps), 0);

    const payload = JSON.parse(c.out.join(''));
    assert.strictEqual(payload.manifestExists, true);
    assert.deepStrictEqual(payload.removed, [{ path: 'Locations/Long Gone.md', section: 'Publishing' }]);
    assert.deepStrictEqual(
      payload.new.map(e => e.path).sort(),
      ['Characters/NPCs/Draft NPC.md', 'Characters/NPCs/Prep Source.md', 'Characters/NPCs/Published NPC.md'],
    );
    assert.deepStrictEqual(payload.counts.unchanged, { publishing: 1, excluded: 1, needsDecision: 0 });
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('the human header names the mode', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), '---\nmode: player\n---\n\n## Publishing (0 files)\n');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'diff', configPath }, c.deps);
    assert.match(c.text(), /^manifest: mode player — /m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // C1: shared with explain-cli via surveyVault — a file gray-matter cannot parse
  // must not read as NO_TYPE here either.
  it('classifies an unparseable file as FILE_UNPARSEABLE, not NO_TYPE', async () => {
    const vault = copyVault('auto-exclude');
    fs.writeFileSync(
      path.join(vault, 'Characters', 'NPCs', 'Bram.md'),
      '---\ntype: npc\nmarker: manifest-diff\nname: "Unterminated\n---\n\nBody.\n',
    );
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'diff', configPath, json: true }, c.deps);
    assert.strictEqual(rc, 0);
    const payload = JSON.parse(c.out.join(''));
    const row = payload.new.find((e) => e.path === 'Characters/NPCs/Bram.md');
    assert.ok(row, JSON.stringify(payload.new));
    assert.strictEqual(row.bucket, 'exclude');
    assert.strictEqual(row.code, 'FILE_UNPARSEABLE');
    assert.match(row.reason, /double quoted scalar/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // M3: manifest shares surveyVault's config loading with deploy and explain — a
  // bad config path must fail the same clean way instead of a raw `require()`
  // "Cannot find module" stack.
  it('fails with a clean message on a config path that does not exist', async () => {
    const configPath = path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'vault.config.json');
    await assert.rejects(
      () => runManifest({ verb: 'diff', configPath }, {}),
      (err) => {
        assert.doesNotMatch(err.message, /Cannot find module/);
        assert.match(err.message, /could not be read as JSON/);
        return true;
      },
    );
  });
});

describe('manifest diff: story companions', () => {
  it("classifies a PC's story companion as merged into the PC's page", async () => {
    const { configPath } = siteFor(path.join(FIXTURES, 'story'));
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'diff', configPath, json: true }, c.deps), 0);

    const payload = JSON.parse(c.out.join(''));
    const story = payload.new.find(e => e.path === 'Characters/PCs/Adrien_Story.md');
    assert.ok(story, payload.new.map(e => e.path).join(', '));
    assert.strictEqual(story.bucket, 'publish');
    assert.strictEqual(story.code, 'STORY_COMPANION');
    assert.strictEqual(story.reason, "merged into Adrien's page");
  });
});

describe('manifest apply', () => {
  it('creates the documented format for a two-entry manifest', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();

    const rc = await runManifest({
      verb: 'apply',
      configPath,
      publish: ['Sessions/Played Session.md'],
      exclude: ['Sessions/Planned Session.md=prep'],
    }, c.deps);

    assert.strictEqual(rc, 0);
    const manifestPath = path.join(vault, '_meta', 'publish-manifest.md');
    assert.strictEqual(c.writes[manifestPath], [
      '---',
      'generated: 2026-09-07T12:00:00.000Z',
      'vault: "Test Campaign"',
      'mode: player',
      'total_files: 5',
      'publishing: 1',
      'excluded: 1',
      'needs_decision: 0',
      '---',
      '',
      '## Publishing (1 files)',
      '',
      '- [x] Sessions/Played Session.md',
      '',
      '## Excluded (1 files)',
      '',
      '- [x] Sessions/Planned Session.md — prep',
      '',
      '## Needs Decision (0 files)',
      '',
    ].join('\n'));
    assert.match(c.text(), /manifest updated: \+1 publishing, \+1 excluded, \+0 needs decision, -0 pruned/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('moves an entry out of its old section', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Excluded (1 files)', '', '- [x] Sessions/Played Session.md — prep', '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-manifest.md')];
    assert.match(written, /## Publishing \(1 files\)\n\n- \[x\] Sessions\/Played Session\.md\n/);
    assert.match(written, /## Excluded \(0 files\)\n/);
    assert.doesNotMatch(written, /Excluded \(0 files\)\n\n- \[x\]/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('preserves the annotation on an entry it was not asked to move', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Excluded (1 files)', '',
      '- [x] Characters/NPCs/Prep Source.md — a spy the party has not met',
      '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    assert.match(
      c.writes[path.join(vault, '_meta', 'publish-manifest.md')],
      /- \[x\] Characters\/NPCs\/Prep Source\.md — a spy the party has not met/,
    );
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('carries a grouped "Reason:" heading across as the entry annotation', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Excluded (1 files)', '',
      '- Reason: prep',
      '  - Sessions/Planned Session.md',
      '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    assert.match(
      c.writes[path.join(vault, '_meta', 'publish-manifest.md')],
      /- \[x\] Sessions\/Planned Session\.md — prep/,
    );
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('writes Needs Decision entries unchecked', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'apply', configPath, decide: ['Characters/NPCs/Draft NPC.md'] }, c.deps);
    assert.match(
      c.writes[path.join(vault, '_meta', 'publish-manifest.md')],
      /## Needs Decision \(1 files\)\n\n- \[ \] Characters\/NPCs\/Draft NPC\.md\n/,
    );
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('rejects a path that matches no vault file and writes nothing', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();

    const rc = await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Nope.md'] }, c.deps);
    assert.strictEqual(rc, 1);
    assert.match(c.text(), /no such file in the vault: Sessions\/Nope\.md/);
    assert.deepStrictEqual(c.writes, {});
    assert.ok(!fs.existsSync(path.join(vault, '_meta', 'publish-manifest.md')));
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--prune drops entries whose file is gone', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Publishing (2 files)', '',
      '- [x] Sessions/Played Session.md',
      '- [x] Locations/Long Gone.md',
      '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, prune: true }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-manifest.md')];
    assert.doesNotMatch(written, /Long Gone/);
    assert.match(written, /- \[x\] Sessions\/Played Session\.md/);
    assert.match(c.text(), /manifest updated: \+0 publishing, \+0 excluded, \+0 needs decision, -1 pruned/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // M9: --prune used to drop any entry whose path fell under excludeDirs, because
  // the scanned `files` list never contains those paths at all — indistinguishable
  // from a file that was actually deleted. Adding a folder to excludeDirs must not
  // silently erase the manifest's memory of everything already in it.
  it('--prune keeps an entry under excludeDirs whose file is still on disk', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_Templates'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_Templates', 'Old Template.md'), '---\ntype: npc\n---\n\nx\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Publishing (2 files)', '',
      '- [x] Sessions/Played Session.md',
      '- [x] _Templates/Old Template.md',
      '',
      '## Excluded (1 files)', '',
      '- [x] Locations/Long Gone.md',
      '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, prune: true }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-manifest.md')];
    // Genuinely gone (no file on disk at all): pruned.
    assert.doesNotMatch(written, /Long Gone/);
    // Under excludeDirs but still a real file on disk: survives.
    assert.match(written, /- \[x\] _Templates\/Old Template\.md/);
    assert.match(written, /- \[x\] Sessions\/Played Session\.md/);
    assert.match(c.text(), /manifest updated: \+0 publishing, \+0 excluded, \+0 needs decision, -1 pruned/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('an --exclude with no =reason gets no annotation', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'apply', configPath, exclude: ['Sessions/Planned Session.md'] }, c.deps);
    assert.match(
      c.writes[path.join(vault, '_meta', 'publish-manifest.md')],
      /- \[x\] Sessions\/Planned Session\.md\n/,
    );
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('creates _meta/ through the injected mkdir rather than touching fs directly', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    const made = [];
    c.deps.mkdir = (p) => { made.push(p); fs.mkdirSync(p, { recursive: true }); };

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    assert.deepStrictEqual(made, [path.join(vault, '_meta')]);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--json reports the sections it wrote', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({
      verb: 'apply', configPath, json: true,
      publish: ['Sessions/Played Session.md'],
    }, c.deps);
    const payload = JSON.parse(c.out.join(''));
    assert.strictEqual(payload.publishing, 1);
    assert.strictEqual(payload.excluded, 0);
    assert.strictEqual(payload.needsDecision, 0);
    assert.strictEqual(payload.pruned, 0);
    assert.strictEqual(payload.totalFiles, 5);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
