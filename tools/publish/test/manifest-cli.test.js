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

  // Review follow-up: surveyVault (shared by `manifest diff` and `explain`) used to walk
  // the vault with the raw vault.config.json `excludeDirs` only — a folder excluded
  // exclusively via vault-config.md's `publish.exclude_dirs` still showed up in the diff
  // as a New file, disagreeing with what the real build would do with it.
  it('never lists a file under a folder excluded only via publish.exclude_dirs in vault-config.md', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-vaultconfig-excl-'));
    fs.mkdirSync(path.join(vault, 'Drafts'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Drafts', 'Idea.md'), '---\ntype: npc\n---\n\nA half-formed idea.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
      '---\npublish:\n  exclude_dirs:\n    - "Drafts"\n---\n');
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'diff', configPath, json: true }, c.deps);
    assert.strictEqual(rc, 0);
    const payload = JSON.parse(c.out.join(''));
    const all = [...payload.new, ...(payload.unchanged || [])];
    assert.ok(!all.some((e) => e.path === 'Drafts/Idea.md'), JSON.stringify(payload));
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

  it('moves an entry from Needs Decision to Publishing (#277)', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
      '---', 'mode: player', '---', '',
      '## Needs Decision (1 files)', '', '- [ ] Sessions/Played Session.md', '',
    ].join('\n'));
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-manifest.md')];
    assert.match(written, /## Publishing \(1 files\)\n\n- \[x\] Sessions\/Played Session\.md\n/);
    assert.match(written, /## Needs Decision \(0 files\)\n/);
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

describe('manifest publish-played (#277)', () => {
  function playedVault(manifestBody) {
    const vault = copyVault('auto-exclude');
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: AUTHORITATIVE\n---\n\n## Recap\n\nDone.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    if (manifestBody != null) {
      fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'),
        ['---', 'mode: player', '---', '', manifestBody, ''].join('\n'));
    }
    return vault;
  }
  const manifestFile = (vault) => path.join(vault, '_meta', 'publish-manifest.md');

  it('moves a played session and its Wrap-Up from Needs Decision to Publishing', async () => {
    const vault = playedVault('## Needs Decision (1 files)\n\n- [ ] Sessions/Played Session.md');
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'publish-played', configPath }, c.deps);
    assert.strictEqual(rc, 0);
    const written = c.writes[manifestFile(vault)];
    assert.match(written, /- \[x\] Sessions\/Played Session\.md\n/);
    assert.match(written, /- \[x\] Sessions\/Session 06 - Wrap-Up\.md\n/);
    assert.match(written, /## Needs Decision \(0 files\)/);
    assert.match(c.text(), /published 2 file\(s\)/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('leaves Excluded entries and unplayed sessions alone', async () => {
    const vault = playedVault('## Excluded (1 files)\n\n- [x] Sessions/Played Session.md — private');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath }, c.deps);
    // Nothing is ticked: the excluded index stays excluded, the prepped session is not
    // played, and the Wrap-Up of a session the GM excluded is not published behind the
    // GM's back — its recap is that session's record.
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /no finished session needed publishing/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--dry-run reports without writing, --json emits the paths', async () => {
    const vault = playedVault('## Needs Decision (1 files)\n\n- [ ] Sessions/Played Session.md');
    const before = fs.readFileSync(manifestFile(vault), 'utf8');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath, dryRun: true, json: true }, c.deps);
    assert.deepStrictEqual(c.writes, {});
    assert.strictEqual(fs.readFileSync(manifestFile(vault), 'utf8'), before);
    const payload = JSON.parse(c.text());
    assert.deepStrictEqual(payload.published, ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('lists a played session with no Wrap-Up as unclear and does not tick it', async () => {
    const vault = playedVault('## Needs Decision (1 files)\n\n- [ ] Sessions/Played Session.md');
    fs.rmSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'));
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath, json: true }, c.deps);
    assert.deepStrictEqual(c.writes, {});
    const payload = JSON.parse(c.text());
    assert.deepStrictEqual(payload.published, []);
    assert.strictEqual(payload.unclear.length, 1);
    assert.strictEqual(payload.unclear[0].path, 'Sessions/Played Session.md');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('does nothing without a manifest', async () => {
    const vault = playedVault(null);
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'publish-played', configPath }, c.deps);
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /nothing to do/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('is idempotent', async () => {
    const vault = playedVault('## Publishing (2 files)\n\n- [x] Sessions/Played Session.md\n- [x] Sessions/Session 06 - Wrap-Up.md');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath }, c.deps);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /no finished session needed publishing/);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

// Review of #276/#277: publish-played ticks a hub only when session-hub.js pairs it with
// a Wrap-Up that will publish — the one pairing rule — so a ticked hub's body is always
// withheld. Each variant is a way the old loose matcher ticked a hub whose body then
// published ("Conspiracy wall: KEEPERONLYSECRET").
describe('manifest publish-played ticks only hubs the site will withhold (#276/#277)', () => {
  const { build } = require('../lib/build');

  function run(variant) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-played-'));
    const vault = path.join(work, 'vault');
    const w = (rel, body) => {
      const f = path.join(vault, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    let wrapLink = '[[Session 01 Wrap-Up]]';
    let wrapSession = 'session: "[[Session 01 - Arrival]]"\n';
    let wrapExtra = '';
    let manifestExtra = '';
    if (variant === 'excluded') manifestExtra = '## Excluded (1 files)\n\n- [x] Sessions/Session 01 Wrap-Up.md — secrets\n\n';
    if (variant === 'case') { wrapLink = '[[session 01 wrap-up]]'; wrapSession = ''; }
    if (variant === 'heading') { wrapLink = '[[Session 01 Wrap-Up#Narrative Recap]]'; wrapSession = ''; }
    if (variant === 'folder') { wrapLink = '[[Sessions/Session 01 Wrap-Up]]'; wrapSession = ''; }
    if (variant === 'sesscase') { wrapSession = 'session: "[[session 01 - arrival]]"\n'; wrapLink = ''; }
    if (variant === 'pubnone') wrapExtra = 'publish: none\n';
    w('Sessions/Session 01 - Arrival.md', `---\ntype: session\nsession_number: 1\nstatus: reviewed\n${
      wrapLink ? `documents:\n  wrap_up: "${wrapLink}"\n` : ''}---\n\n# Session 01 - Arrival\n\n- Conspiracy wall: KEEPERONLYSECRET the Baron appears at the ball\n`);
    w('Sessions/Session 01 Wrap-Up.md', `---\ntype: session_wrap\n${wrapSession}${wrapExtra}---\n\n# Session 01 Wrap-Up\n\n## Narrative Recap\n\nThey arrived at dusk.\n`);
    w('_meta/publish-manifest.md', `---\nmode: player\n---\n\n## Publishing (0 files)\n\n${manifestExtra}## Needs Decision (2 files)\n\n- [ ] Sessions/Session 01 - Arrival.md\n${
      variant === 'excluded' ? '' : '- [ ] Sessions/Session 01 Wrap-Up.md\n'}`);
    w('_meta/vault-config.md', '---\npublish:\n  mode: player\n---\n');
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: path.join(work, 'docs'), excludeDirs: ['_meta'], folderMap: { Sessions: 'sessions' } }));
    return { work, vault, configPath };
  }

  async function publishPlayedThenBuild(variant) {
    const site = run(variant);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true }, c.deps);
    const payload = JSON.parse(c.text());
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: site.configPath }); } finally { console.log = log; console.warn = warn; }
    const page = path.join(site.work, 'docs', 'sessions', 'session-01-arrival.html');
    const html = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : null;
    const search = fs.readFileSync(path.join(site.work, 'docs', 'search-index.json'), 'utf8');
    fs.rmSync(site.work, { recursive: true, force: true });
    return { payload, html, search };
  }

  const HUB = 'Sessions/Session 01 - Arrival.md';
  const WRAP = 'Sessions/Session 01 Wrap-Up.md';

  for (const variant of ['baseline', 'folder']) {
    it(`ticks the hub and its Wrap-Up when the link resolves (${variant}), and the body is withheld`, async () => {
      const { payload, html, search } = await publishPlayedThenBuild(variant);
      assert.deepStrictEqual(payload.published, [HUB, WRAP]);
      assert.deepStrictEqual(payload.unclear, []);
      assert.ok(html, 'the session page is built');
      assert.doesNotMatch(html, /KEEPERONLYSECRET/);
      assert.doesNotMatch(search, /keeperonlysecret/i);
    });
  }

  const UNCLEAR = {
    excluded: /^Wrap-Up is Excluded \(Sessions\/Session 01 Wrap-Up\.md\)$/,
    pubnone: /^Wrap-Up Sessions\/Session 01 Wrap-Up\.md does not publish: publish: none$/,
    case: /^documents\.wrap_up \[\[session 01 wrap-up\]\] names no Wrap-Up/,
    heading: /^documents\.wrap_up \[\[Session 01 Wrap-Up#Narrative Recap\]\] names no Wrap-Up/,
    sesscase: /^status reviewed but no Wrap-Up linked to it$/,
  };
  for (const [variant, reason] of Object.entries(UNCLEAR)) {
    it(`lists the hub as unclear, not ticked, when its Wrap-Up will not pair (${variant})`, async () => {
      const { payload, html, search } = await publishPlayedThenBuild(variant);
      assert.ok(!payload.published.includes(HUB), payload.published.join(', '));
      assert.strictEqual(payload.unclear.length, 1);
      assert.strictEqual(payload.unclear[0].path, HUB);
      assert.match(payload.unclear[0].reason, reason);
      assert.strictEqual(html, null, 'the hub is not on the site');
      assert.doesNotMatch(search, /keeperonlysecret/i);
    });
  }

  it('ticks nothing for a hub whose paired Wrap-Up cannot be ticked', async () => {
    const { payload } = await publishPlayedThenBuild('excluded');
    assert.deepStrictEqual(payload.published, []);
  });
});

// Review of #276: build, `explain --all` and publish-played pair on the same frontmatter,
// GM aliases rewritten first (session-hub.js pairHubs). A documents.wrap_up written as the
// Wrap-Up's GM alias pairs in all three, or the tools disagree about a leak.
describe('a documents.wrap_up written as a GM alias pairs the same everywhere (#276 review)', () => {
  const { build } = require('../lib/build');
  const { runExplainAll } = require('../lib/explain-cli');

  it('build, explain --all and publish-played all pair it', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-alias-pair-'));
    const vault = path.join(work, 'vault');
    const w = (rel, body) => {
      const f = path.join(vault, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    };
    const HUB = 'Sessions/Session 01 - Arrival.md';
    const WRAP = 'Sessions/Session 01 Wrap-Up.md';
    w(HUB, '---\ntype: session\nsession_number: 1\nstatus: reviewed\ndocuments:\n  wrap_up: "[[The Sealed Ledger]]"\n---\n\n# Session 01 - Arrival\n\nKEEPERONLYSECRET the Baron appears at the ball\n');
    w(WRAP, '---\ntype: session_wrap\ngm_aliases:\n  - The Sealed Ledger\n---\n\n## Narrative Recap\n\nThey arrived at dusk.\n');
    w('_meta/vault-config.md', '---\npublish:\n  mode: player\n---\n');
    w('_meta/publish-manifest.md', `---\nmode: player\n---\n\n## Publishing (0 files)\n\n## Needs Decision (2 files)\n\n- [ ] ${HUB}\n- [ ] ${WRAP}\n`);
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: path.join(work, 'docs'), excludeDirs: ['_meta'], folderMap: { Sessions: 'sessions' } }));

    try {
      // publish-played pairs it, so ticks both.
      const c = capture();
      await runManifest({ verb: 'publish-played', configPath, json: true }, c.deps);
      const played = JSON.parse(c.text());
      assert.deepStrictEqual(played.published, [HUB, WRAP]);
      assert.deepStrictEqual(played.unclear, []);

      // explain --all, on the manifest publish-played wrote, says the body is withheld.
      const e = capture();
      await runExplainAll({ configPath }, e.deps);
      const hub = JSON.parse(e.out.join('')).pages.find((p) => p.path === HUB);
      assert.strictEqual(hub.publishes, true);
      assert.strictEqual(hub.bodyWithheld, true);

      // The build withholds it too: the page carries the Wrap-Up's recap, not the body.
      const log = console.log; const warn = console.warn;
      console.log = () => {}; console.warn = () => {};
      try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
      const html = fs.readFileSync(path.join(work, 'docs', 'sessions', 'session-01-arrival.html'), 'utf8');
      assert.doesNotMatch(html, /KEEPERONLYSECRET/);
      assert.match(html, /They arrived at dusk/);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
