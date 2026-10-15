const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runManifest } = require('../lib/manifest-cli');
const { writePublishList, readListText } = require('./helpers/publish-list');
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
    assert.match(text, /^ {2}Sessions\/Played Session\.md\tpublish\tOK\tno publish list: publishing$/m);
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
    assert.strictEqual(payload.mode, undefined);
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
    writePublishList(vault, { publishing: ['Sessions/Played Session.md', 'Locations/Long Gone.md'], excluded: [{ path: 'Sessions/Planned Session.md', reason: 'prep' }] });
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

  it('the human header names the publish list', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, {  });
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'diff', configPath }, c.deps);
    assert.match(c.text(), /^manifest: publish list — /m);
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
    const manifestPath = path.join(vault, '_meta', 'publish-list.yaml');
    assert.strictEqual(c.writes[manifestPath], [
      'publishing:',
      '  - Sessions/Played Session.md',
      'excluded:',
      '  - path: Sessions/Planned Session.md',
      '    reason: prep',
      'needs_decision: []',
      '',
    ].join('\n'));
    assert.match(c.text(), /manifest updated: \+1 publishing, \+1 excluded, \+0 needs decision, -0 pruned/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('moves an entry out of its old section', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { excluded: [{ path: 'Sessions/Played Session.md', reason: 'prep' }] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-list.yaml')];
    const list = readListText(written);
    assert.deepStrictEqual(list.publishing, ['Sessions/Played Session.md']);
    assert.deepStrictEqual(list.excluded, []);
    assert.strictEqual(list.reasons.size, 0);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('moves an entry from Needs Decision to Publishing (#277)', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { needsDecision: ['Sessions/Played Session.md'] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-list.yaml')];
    const list = readListText(written);
    assert.deepStrictEqual(list.publishing, ['Sessions/Played Session.md']);
    assert.deepStrictEqual(list.needsDecision, []);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('preserves the reason on an entry it was not asked to move', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { excluded: [{ path: 'Characters/NPCs/Prep Source.md', reason: 'a spy the party has not met' }] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const list = readListText(c.writes[path.join(vault, '_meta', 'publish-list.yaml')]);
    assert.deepStrictEqual(list.excluded, ['Characters/NPCs/Prep Source.md']);
    assert.strictEqual(list.reasons.get('Characters/NPCs/Prep Source.md'), 'a spy the party has not met');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('keeps a reason on an excluded entry it was not asked to move', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { excluded: [{ path: 'Sessions/Planned Session.md', reason: 'prep' }] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps);
    const list = readListText(c.writes[path.join(vault, '_meta', 'publish-list.yaml')]);
    assert.strictEqual(list.reasons.get('Sessions/Planned Session.md'), 'prep');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('writes Needs Decision entries under needs_decision', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'apply', configPath, decide: ['Characters/NPCs/Draft NPC.md'] }, c.deps);
    assert.deepStrictEqual(readListText(c.writes[path.join(vault, '_meta', 'publish-list.yaml')]).needsDecision, ['Characters/NPCs/Draft NPC.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('records a decision on a note in a folder the site leaves out, and will not list it under Publishing', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_Templates'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_Templates', 'Lore.md'), '---\ntype: world_domain\n---\n\nLore.\n');
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'apply', configPath, exclude: ['_Templates/Lore.md=stays hidden: reference only'] }, c.deps);
    assert.strictEqual(rc, 0, c.text());
    assert.strictEqual(readListText(c.writes[path.join(vault, '_meta', 'publish-list.yaml')]).reasons.get('_Templates/Lore.md'), 'stays hidden: reference only');

    const refused = capture();
    assert.strictEqual(await runManifest({ verb: 'apply', configPath, publish: ['_Templates/Lore.md'] }, refused.deps), 1);
    // The file is there: the refusal says what stops it, not that it is missing.
    assert.match(refused.text(), /cannot list under Publishing: _Templates\/Lore\.md is in a folder the site leaves out/);
    assert.ok(!/no such file/.test(refused.text()), refused.text());
    assert.deepStrictEqual(refused.writes, {});
    const outside = capture();
    assert.strictEqual(await runManifest({ verb: 'apply', configPath, exclude: ['../elsewhere.md=x'] }, outside.deps), 1);
    assert.deepStrictEqual(outside.writes, {});
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('diff lists a recorded decision for a note in a left-out folder apart from "Removed", and --prune keeps it', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_Templates'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_Templates', 'Lore.md'), '---\ntype: world_domain\n---\n\nLore.\n');
    const { configPath } = siteFor(vault);
    await runManifest({ verb: 'apply', configPath, exclude: ['_Templates/Lore.md=stays hidden: reference only', 'Sessions/Played Session.md=x'] }, capture().deps);
    fs.rmSync(path.join(vault, 'Sessions', 'Played Session.md'));

    const human = capture();
    await runManifest({ verb: 'diff', configPath }, human.deps);
    // Only the entry whose file is gone is "Removed".
    assert.match(human.text(), /^Removed \(1\):\n {2}Sessions\/Played Session\.md\tExcluded$/m);
    assert.match(human.text(), /^Listed, in a folder the site leaves out \(1; the file is there, the entry is kept\):\n {2}_Templates\/Lore\.md\tExcluded$/m);
    const json = capture();
    await runManifest({ verb: 'diff', configPath, json: true }, json.deps);
    const answer = JSON.parse(json.out.join(''));
    assert.deepStrictEqual(answer.removed, [{ path: 'Sessions/Played Session.md', section: 'Excluded' }]);
    assert.deepStrictEqual(answer.outside, [{ path: '_Templates/Lore.md', section: 'Excluded' }]);

    const pruned = capture();
    await runManifest({ verb: 'apply', configPath, prune: true }, pruned.deps);
    const text = pruned.writes[path.join(vault, '_meta', 'publish-list.yaml')];
    assert.strictEqual(readListText(text).reasons.get('_Templates/Lore.md'), 'stays hidden: reference only');
    assert.ok(!text.includes('Played Session.md'));
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--vault reads and writes that vault\'s manifest, not the one the site file names', async () => {
    const named = copyVault('auto-exclude');
    const audited = copyVault('auto-exclude');
    const { configPath } = siteFor(named);
    const c = capture();
    const rc = await runManifest({ verb: 'apply', configPath, vaultPath: audited, exclude: ['Sessions/Played Session.md=stays hidden: not yet'] }, c.deps);
    assert.strictEqual(rc, 0, c.text());
    assert.deepStrictEqual(Object.keys(c.writes), [path.join(audited, '_meta', 'publish-list.yaml')]);
    assert.ok(!fs.existsSync(path.join(named, '_meta', 'publish-list.yaml')));
    const d = capture();
    await runManifest({ verb: 'diff', configPath, vaultPath: audited, json: true }, d.deps);
    assert.strictEqual(JSON.parse(d.out.join('')).manifestExists, true);
    fs.rmSync(named, { recursive: true, force: true });
    fs.rmSync(audited, { recursive: true, force: true });
  });

  it('rejects a path that matches no vault file and writes nothing', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();

    const rc = await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Nope.md'] }, c.deps);
    assert.strictEqual(rc, 1);
    assert.match(c.text(), /no such file in the vault: Sessions\/Nope\.md/);
    assert.deepStrictEqual(c.writes, {});
    assert.ok(!fs.existsSync(path.join(vault, '_meta', 'publish-list.yaml')));
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--prune drops entries whose file is gone', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { publishing: ['Sessions/Played Session.md', 'Locations/Long Gone.md'] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, prune: true }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-list.yaml')];
    assert.doesNotMatch(written, /Long Gone/);
    assert.deepStrictEqual(readListText(written).publishing, ['Sessions/Played Session.md']);
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
    writePublishList(vault, { publishing: ['Sessions/Played Session.md', '_Templates/Old Template.md'], excluded: ['Locations/Long Gone.md'] });
    const { configPath } = siteFor(vault);
    const c = capture();

    await runManifest({ verb: 'apply', configPath, prune: true }, c.deps);
    const written = c.writes[path.join(vault, '_meta', 'publish-list.yaml')];
    // Genuinely gone (no file on disk at all): pruned.
    assert.doesNotMatch(written, /Long Gone/);
    // Under excludeDirs but still a real file on disk: survives.
    assert.deepStrictEqual(readListText(written).publishing.sort(), ['Sessions/Played Session.md', '_Templates/Old Template.md']);
    assert.match(c.text(), /manifest updated: \+0 publishing, \+0 excluded, \+0 needs decision, -1 pruned/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('an --exclude with no =reason gets no reason', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'apply', configPath, exclude: ['Sessions/Planned Session.md'] }, c.deps);
    const list = readListText(c.writes[path.join(vault, '_meta', 'publish-list.yaml')]);
    assert.deepStrictEqual(list.excluded, ['Sessions/Planned Session.md']);
    assert.strictEqual(list.reasons.size, 0);
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
  function playedVault(lists) {
    const vault = copyVault('auto-exclude');
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: AUTHORITATIVE\n---\n\n## Recap\n\nDone.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    if (lists != null) writePublishList(vault, lists);
    return vault;
  }
  const manifestFile = (vault) => path.join(vault, '_meta', 'publish-list.yaml');

  it('moves a played session and its Wrap-Up from Needs Decision to Publishing', async () => {
    const vault = playedVault({ needsDecision: ['Sessions/Played Session.md'] });
    const { configPath } = siteFor(vault);
    const c = capture();
    const rc = await runManifest({ verb: 'publish-played', configPath }, c.deps);
    assert.strictEqual(rc, 0);
    const written = c.writes[manifestFile(vault)];
    const list = readListText(written);
    assert.deepStrictEqual(list.publishing.sort(), ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    assert.deepStrictEqual(list.needsDecision, []);
    assert.match(c.text(), /published 2 file\(s\)/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('leaves Excluded entries and unplayed sessions alone', async () => {
    const vault = playedVault({ excluded: [{ path: 'Sessions/Played Session.md', reason: 'private' }] });
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
    const vault = playedVault({ needsDecision: ['Sessions/Played Session.md'] });
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
    const vault = playedVault({ needsDecision: ['Sessions/Played Session.md'] });
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
    const vault = playedVault({ publishing: ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md'] });
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath }, c.deps);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /no finished session needed publishing/);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

// Final review of #276/#277: clear means reviewed. A DRAFT Wrap-Up the GM deferred ("after
// reconcile") must not be published silently by the next publish-site or reconcile run.
describe('manifest publish-played ticks only reviewed sessions (#277 final review)', () => {
  function vaultWith(hubStatus, canonStatus) {
    const vault = copyVault('auto-exclude');
    const hubPath = path.join(vault, 'Sessions', 'Played Session.md');
    fs.writeFileSync(hubPath, fs.readFileSync(hubPath, 'utf8').replace('status: played', `status: ${hubStatus}`));
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      `---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: ${canonStatus}\n---\n\n## Recap\n\nDone.\n`);
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { needsDecision: ['Sessions/Played Session.md'] });
    return vault;
  }
  async function plan(vault, site) {
    const { configPath } = site || siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath, json: true }, c.deps);
    return { payload: JSON.parse(c.text()), writes: c.writes };
  }

  for (const status of ['played', 'wrap-up']) {
    it(`a ${status} session with a DRAFT Wrap-Up is unclear, not ticked`, async () => {
      const vault = vaultWith(status, 'DRAFT');
      const { payload, writes } = await plan(vault);
      assert.deepStrictEqual(writes, {});
      assert.deepStrictEqual(payload.published, []);
      assert.strictEqual(payload.unclear.length, 1);
      assert.match(payload.unclear[0].reason, /^Wrap-Up not reviewed yet/);
      assert.strictEqual(payload.unclear[0].wrapUp, 'Sessions/Session 06 - Wrap-Up.md');
      fs.rmSync(vault, { recursive: true, force: true });
    });
  }

  it('an unreviewed session already published with its Wrap-Up is left alone', async () => {
    const vault = vaultWith('wrap-up', 'DRAFT');
    writePublishList(vault, { publishing: ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md'] });
    const { payload, writes } = await plan(vault);
    assert.deepStrictEqual(writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.deepStrictEqual(payload.unclear, []);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('an unreviewed published hub does not get its DRAFT Wrap-Up ticked', async () => {
    const vault = vaultWith('wrap-up', 'DRAFT');
    writePublishList(vault, { publishing: ['Sessions/Played Session.md'] });
    const { payload, writes } = await plan(vault);
    assert.deepStrictEqual(writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.match(payload.unclear[0].reason, /^Wrap-Up not reviewed yet/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a reviewed index is clear even while its Wrap-Up is DRAFT', async () => {
    const vault = vaultWith('reviewed', 'DRAFT');
    const { payload } = await plan(vault);
    assert.deepStrictEqual(payload.published, ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('an AUTHORITATIVE Wrap-Up counts as reviewed, as reconcile promotes it', async () => {
    const vault = vaultWith('wrap-up', 'AUTHORITATIVE');
    const { payload } = await plan(vault);
    assert.deepStrictEqual(payload.published, ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

// Final review of #277: the site builds with the tool in its own node_modules. One pinned
// below 1.11.40 publishes every hub body, so publish-played must not tick hubs for it.
describe('manifest publish-played answers for the site\'s pinned tool (#277 final review)', () => {
  function pinnedSite(vault, version) {
    const site = siteFor(vault);
    const pkg = path.join(site.dir, 'node_modules', 'gm-apprentice-publish');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'gm-apprentice-publish', version }));
    return site;
  }
  function reviewedVault() {
    const vault = copyVault('auto-exclude');
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: AUTHORITATIVE\n---\n\n## Recap\n\nDone.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { needsDecision: ['Sessions/Played Session.md'] });
    return vault;
  }

  it('a site pinned below 1.11.40 gets no hub ticked, only the Wrap-Up', async () => {
    const vault = reviewedVault();
    const site = pinnedSite(vault, '1.11.39');
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true, dryRun: true }, c.deps);
    const payload = JSON.parse(c.text());
    assert.deepStrictEqual(payload.published, ['Sessions/Session 06 - Wrap-Up.md']);
    assert.strictEqual(payload.unclear.length, 1);
    assert.strictEqual(payload.unclear[0].path, 'Sessions/Played Session.md');
    assert.strictEqual(payload.unclear[0].reason, 'site is pinned to 1.11.39; update the pin before publishing sessions');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a site whose package.json pins 1.11.39 but has nothing installed ticks no hub (re-check)', async () => {
    // The next `npm install && build` installs 1.11.39, which publishes the body.
    const vault = reviewedVault();
    const site = siteFor(vault);
    fs.writeFileSync(path.join(site.dir, 'package.json'), JSON.stringify({
      dependencies: { 'gm-apprentice-publish': 'file:vendor/gm-apprentice-publish-1.11.39.tgz' } }));
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true, dryRun: true }, c.deps);
    const payload = JSON.parse(c.text());
    assert.deepStrictEqual(payload.published, ['Sessions/Session 06 - Wrap-Up.md']);
    assert.strictEqual(payload.unclear[0].reason, 'site is pinned to 1.11.39; update the pin before publishing sessions');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a prerelease of 1.11.40 is below 1.11.40 (re-check)', async () => {
    const vault = reviewedVault();
    const site = pinnedSite(vault, '1.11.40-rc.1');
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true, dryRun: true }, c.deps);
    assert.deepStrictEqual(JSON.parse(c.text()).published, ['Sessions/Session 06 - Wrap-Up.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a site pinned at 1.11.40 ticks both', async () => {
    const vault = reviewedVault();
    const site = pinnedSite(vault, '1.11.40');
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true, dryRun: true }, c.deps);
    assert.deepStrictEqual(JSON.parse(c.text()).published, ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('an installed tool with no readable version fails safe', async () => {
    const vault = reviewedVault();
    const site = pinnedSite(vault, '');
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath: site.configPath, json: true, dryRun: true }, c.deps);
    const payload = JSON.parse(c.text());
    assert.deepStrictEqual(payload.published, ['Sessions/Session 06 - Wrap-Up.md']);
    assert.match(payload.unclear[0].reason, /no readable version/);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

// Review of #278: session-wrapup's "Publish now?" registers one unreviewed session through
// publish-played, so the pairing and the site-pin checks still hold; only the review state
// is waived, and only for the named session.
describe('manifest publish-played --session --include-unreviewed (#278)', () => {
  function draftVault() {
    const vault = copyVault('auto-exclude');
    const hubPath = path.join(vault, 'Sessions', 'Played Session.md');
    fs.writeFileSync(hubPath, fs.readFileSync(hubPath, 'utf8').replace('status: played', 'status: wrap-up'));
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: DRAFT\n---\n\n## Recap\n\nDone.\n');
    // Another played session with a DRAFT Wrap-Up: --session must leave it alone.
    fs.writeFileSync(path.join(vault, 'Sessions', 'Other Session.md'),
      '---\ntype: session\nsession_number: 5\nstatus: wrap-up\n---\n\n## Notes\n\nOther.\n');
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 05 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Other Session]]"\ncanon_status: DRAFT\n---\n\n## Recap\n\nEarlier.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    writePublishList(vault, { needsDecision: ['Sessions/Played Session.md'] });
    return vault;
  }
  function pinnedSite(vault, version) {
    const site = siteFor(vault);
    const pkg = path.join(site.dir, 'node_modules', 'gm-apprentice-publish');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'gm-apprentice-publish', version }));
    return site;
  }
  async function run(configPath, extra) {
    const c = capture();
    const rc = await runManifest(Object.assign({ verb: 'publish-played', configPath, json: true }, extra), c.deps);
    return { rc, c, payload: rc === 0 ? JSON.parse(c.text()) : null };
  }
  const session = 'Sessions/Played Session.md';

  it('ticks the named unreviewed session and its Wrap-Up, and nothing else', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { rc, payload } = await run(configPath, { session, includeUnreviewed: true });
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(payload.published, ['Sessions/Played Session.md', 'Sessions/Session 06 - Wrap-Up.md']);
    assert.deepStrictEqual(payload.unclear, []);
    const written = fs.readFileSync(path.join(vault, '_meta', 'publish-list.yaml'), 'utf8');
    assert.doesNotMatch(written, /Other Session|Session 05/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('without --include-unreviewed the named DRAFT session stays unclear', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.deepStrictEqual(payload.unclear.map((u) => u.path), [session]);
    assert.match(payload.unclear[0].reason, /^Wrap-Up not reviewed yet/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('on a stale site pin it ticks no index and says why', async () => {
    const vault = draftVault();
    const site = pinnedSite(vault, '1.11.39');
    const { payload } = await run(site.configPath, { session, includeUnreviewed: true });
    assert.ok(!payload.published.includes(session));
    assert.deepStrictEqual(payload.unclear.map((u) => u.path), [session]);
    assert.strictEqual(payload.unclear[0].reason, 'site is pinned to 1.11.39; update the pin before publishing sessions');
    const written = fs.readFileSync(path.join(vault, '_meta', 'publish-list.yaml'), 'utf8');
    assert.ok(!readListText(written).publishing.includes('Sessions/Played Session.md'));
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('with no Wrap-Up that pairs it ticks nothing and says why', async () => {
    const vault = draftVault();
    fs.rmSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'));
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session, includeUnreviewed: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.deepStrictEqual(payload.unclear.map((u) => u.path), [session]);
    assert.match(payload.unclear[0].reason, /no Wrap-Up linked/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('when the Wrap-Up will not publish it ticks nothing and says why', async () => {
    const vault = draftVault();
    writePublishList(vault, { excluded: ['Sessions/Session 06 - Wrap-Up.md'] });
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session, includeUnreviewed: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.match(payload.unclear[0].reason, /^Wrap-Up is Excluded/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a path that is not a played session index is reported, not ticked', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session: 'Sessions/Planned Session.md', includeUnreviewed: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.match(payload.unclear[0].reason, /not a played session/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a path that matches no vault file is an error and nothing is written', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { rc, c } = await run(configPath, { session: 'Sessions/Nope.md', includeUnreviewed: true });
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /no such file in the vault: Sessions\/Nope\.md/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // Some vaults keep the recap in the index body and have no Wrap-Ups: there the body
  // is what the GM wants published, and --publish-body is the GM's yes to exactly that.
  it('--publish-body registers an index no Wrap-Up pairs, and says its body publishes', async () => {
    const vault = draftVault();
    fs.rmSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'));
    const { configPath } = siteFor(vault);
    const { rc, payload } = await run(configPath, { session, publishBody: true });
    assert.strictEqual(rc, 0);
    assert.deepStrictEqual(payload.published, [session]);
    assert.deepStrictEqual(payload.bodyPublished, [session]);
    assert.deepStrictEqual(payload.unclear, []);
    const written = fs.readFileSync(path.join(vault, '_meta', 'publish-list.yaml'), 'utf8');
    assert.ok(readListText(written).publishing.includes('Sessions/Played Session.md'));
    assert.doesNotMatch(written, /Other Session/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--publish-body says so in the text report', async () => {
    const vault = draftVault();
    fs.rmSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'));
    const { configPath } = siteFor(vault);
    const c = capture();
    await runManifest({ verb: 'publish-played', configPath, session, publishBody: true }, c.deps);
    assert.match(c.text(), /body publishes as written[^\n]*\n  Sessions\/Played Session\.md/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--publish-body leaves a paired session to the normal checks', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session, publishBody: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.deepStrictEqual(payload.bodyPublished, []);
    assert.match(payload.unclear[0].reason, /^Wrap-Up not reviewed yet/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--publish-body refuses a path that is not a played session index', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session: 'Sessions/Planned Session.md', publishBody: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.match(payload.unclear[0].reason, /not a played session/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--publish-body never touches an Excluded index', async () => {
    const vault = draftVault();
    fs.rmSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'));
    writePublishList(vault, { excluded: [{ path: 'Sessions/Played Session.md', reason: 'private' }] });
    const { configPath } = siteFor(vault);
    const { payload, c } = await run(configPath, { session, publishBody: true });
    assert.deepStrictEqual(c.writes, {});
    assert.deepStrictEqual(payload.published, []);
    assert.strictEqual(payload.unclear[0].reason, 'the session index is Excluded');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--publish-body without --session is an error', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { rc, c } = await run(configPath, { publishBody: true });
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /--publish-body needs --session/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--include-unreviewed without --session is an error', async () => {
    const vault = draftVault();
    const { configPath } = siteFor(vault);
    const { rc, c } = await run(configPath, { includeUnreviewed: true });
    assert.strictEqual(rc, 1);
    assert.deepStrictEqual(c.writes, {});
    assert.match(c.text(), /--include-unreviewed needs --session/);
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
    const wrapUpPath = 'Sessions/Session 01 Wrap-Up.md';
    if (variant === 'case') { wrapLink = '[[session 01 wrap-up]]'; wrapSession = ''; }
    if (variant === 'heading') { wrapLink = '[[Session 01 Wrap-Up#Narrative Recap]]'; wrapSession = ''; }
    if (variant === 'folder') { wrapLink = '[[Sessions/Session 01 Wrap-Up]]'; wrapSession = ''; }
    if (variant === 'sesscase') { wrapSession = 'session: "[[session 01 - arrival]]"\n'; wrapLink = ''; }
    if (variant === 'pubnone') wrapExtra = 'publish: none\n';
    w('Sessions/Session 01 - Arrival.md', `---\ntype: session\nsession_number: 1\nstatus: reviewed\n${
      wrapLink ? `documents:\n  wrap_up: "${wrapLink}"\n` : ''}---\n\n# Session 01 - Arrival\n\n- Conspiracy wall: KEEPERONLYSECRET the Baron appears at the ball\n`);
    w('Sessions/Session 01 Wrap-Up.md', `---\ntype: session_wrap\n${wrapSession}${wrapExtra}---\n\n# Session 01 Wrap-Up\n\n## Narrative Recap\n\nThey arrived at dusk.\n`);
    writePublishList(vault, variant === 'excluded'
      ? { excluded: [{ path: wrapUpPath, reason: 'secrets' }], needsDecision: ['Sessions/Session 01 - Arrival.md'] }
      : { needsDecision: ['Sessions/Session 01 - Arrival.md', wrapUpPath] });
    w('_meta/vault-config.md', '---\npublish:\n  site_title: T\n---\n');
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

  for (const variant of ['baseline', 'folder', 'heading']) {
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
    w('_meta/vault-config.md', '---\npublish:\n  site_title: T\n---\n');
    writePublishList(vault, { needsDecision: [HUB, WRAP] });
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

describe('manifest apply keeps a reason beside a needs_decision entry', () => {
  it('rewrites the list with the reason still there', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'publish-list.yaml'),
      'publishing: []\nexcluded: []\nneeds_decision:\n  - path: Sessions/Planned Session.md\n    reason: waiting on Sam\n');
    const { configPath } = siteFor(vault);
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'apply', configPath, publish: ['Sessions/Played Session.md'] }, c.deps), 0, c.text());
    const list = readListText(fs.readFileSync(path.join(vault, '_meta', 'publish-list.yaml'), 'utf8'));
    assert.strictEqual(list.reasons.get('Sessions/Planned Session.md'), 'waiting on Sam');
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

// Only the update and `manifest convert` move a list (review C1): every other writer keeps the vault on its file.
describe('a vault still on the old Markdown list stays on it', () => {
  const oldFile = (vault) => path.join(vault, '_meta', 'publish-manifest.md');
  const newFile = (vault) => path.join(vault, '_meta', 'publish-list.yaml');
  // A site whose build step reads the old file: the update holds this vault on it.
  function heldSite(vault) {
    const site = siteFor(vault);
    fs.mkdirSync(path.join(site.dir, 'scripts'));
    fs.writeFileSync(path.join(site.dir, 'scripts', 'add-props.mjs'), "readFileSync('../vault/_meta/publish-manifest.md')\n");
    fs.writeFileSync(path.join(site.dir, 'package.json'), JSON.stringify({ scripts: { postbuild: 'node scripts/add-props.mjs' } }));
    return site;
  }

  it('apply writes the old file in the old layout, byte for byte what the old writer wrote, and no new file', async () => {
    const vault = copyVault('auto-exclude');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(oldFile(vault), '---\nmode: player\n---\n\n## Publishing (0 files)\n\n## Needs Decision (1 files)\n\n- [ ] Sessions/Planned Session.md\n');
    const { configPath } = heldSite(vault);
    const c = capture();
    const rc = await runManifest({
      verb: 'apply', configPath, publish: ['Sessions/Played Session.md'], exclude: ['Sessions/Planned Session.md=prep'],
    }, c.deps);
    assert.strictEqual(rc, 0, c.text());
    assert.strictEqual(fs.existsSync(newFile(vault)), false, 'no new file');
    assert.strictEqual(fs.readFileSync(oldFile(vault), 'utf8'), [
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
    assert.doesNotMatch(c.text(), /Moved the publish list/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('publish-played ticks in the old file and leaves the vault on it', async () => {
    const vault = copyVault('auto-exclude');
    fs.writeFileSync(path.join(vault, 'Sessions', 'Session 06 - Wrap-Up.md'),
      '---\ntype: session_wrap\nsession: "[[Played Session]]"\ncanon_status: AUTHORITATIVE\n---\n\n## Recap\n\nDone.\n');
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(oldFile(vault), '---\nmode: player\n---\n\n## Excluded (1 files)\n\n- [ ] Notes/Kept.md — spoils it\n\n## Needs Decision (1 files)\n\n- [ ] Sessions/Played Session.md\n');
    const { configPath } = heldSite(vault);
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'publish-played', configPath }, c.deps), 0, c.text());
    assert.strictEqual(fs.existsSync(newFile(vault)), false, 'no new file');
    const written = fs.readFileSync(oldFile(vault), 'utf8');
    assert.match(written, /- \[x\] Sessions\/Played Session\.md\n/);
    assert.match(written, /- \[x\] Sessions\/Session 06 - Wrap-Up\.md\n/);
    assert.match(written, /- \[x\] Notes\/Kept\.md — spoils it\n/, 'the old writer keeps an unticked Excluded entry');
    assert.match(c.text(), /published 2 file\(s\)/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a vault with no list whose site tool cannot read the new file gets the old file', async () => {
    const vault = copyVault('auto-exclude');
    const site = siteFor(vault);
    const pkg = path.join(site.dir, 'node_modules', 'gm-apprentice-publish');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.26.0' }));
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'apply', configPath: site.configPath, exclude: ['Sessions/Planned Session.md=prep'] }, c.deps), 0, c.text());
    assert.strictEqual(fs.existsSync(newFile(vault)), false);
    assert.match(fs.readFileSync(oldFile(vault), 'utf8'), /## Excluded \(1 files\)\n\n- \[x\] Sessions\/Planned Session\.md — prep\n/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a vault with no list and an up-to-date site gets the new file', async () => {
    const vault = copyVault('auto-exclude');
    const { configPath } = siteFor(vault);
    const c = capture();
    assert.strictEqual(await runManifest({ verb: 'apply', configPath, exclude: ['Sessions/Planned Session.md=prep'] }, c.deps), 0, c.text());
    assert.strictEqual(fs.existsSync(oldFile(vault)), false);
    assert.strictEqual(readListText(fs.readFileSync(newFile(vault), 'utf8')).reasons.get('Sessions/Planned Session.md'), 'prep');
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
