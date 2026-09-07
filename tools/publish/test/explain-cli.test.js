const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runExplain } = require('../lib/explain-cli');

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-vault-'));
  write(vault, 'Sessions/Session_07.md', [
    '---', 'type: session', 'session_number: 7', 'status: played', '---', '',
    '## Narrative Recap', '', 'The team reached the docks.', '',
    '<!-- gm-only -->', 'The dockmaster is the informant.', '<!-- /gm-only -->', '',
    '## GM Notes', '', 'Escalate next week.', '',
    '## Reconciliation Context', '', 'Carried forward.', '',
  ].join('\n'));
  write(vault, 'Sessions/Session_08.md', '---\ntype: session\nsession_number: 8\nstatus: prepped\n---\n\n## Prep\n\nAmbush.\n');
  write(vault, '_meta/vault-config.md', '---\npublish:\n  mode: player\n---\n');
  return vault;
}

function siteFor(vaultPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-site-'));
  const configPath = path.join(dir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'Explain Test',
    vaultPath,
    outputDir: './docs',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { Sessions: 'sessions' },
  }, null, 2));
  return configPath;
}

// The committed `story` fixture carries Adrien.md (type: pc) alongside
// Adrien_Story.md (type: character-story) — the pairing the scanner folds together.
function siteForFixtureStory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-story-'));
  const configPath = path.join(dir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'Story Fixture',
    vaultPath: path.join(__dirname, 'fixtures', 'story'),
    outputDir: './docs',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/PCs': 'characters/pcs', Locations: 'locations', Chapters: 'chapters' },
  }, null, 2));
  return configPath;
}

function capture() {
  const out = [];
  return { out, deps: { out: (line) => out.push(String(line)) }, text: () => out.join('\n') };
}

describe('explain', () => {
  it('walks the chain and names the output path for a published page', async () => {
    const vault = makeVault();
    const c = capture();
    const rc = await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_07.md' }, c.deps);

    assert.strictEqual(rc, 0);
    const text = c.text();
    assert.match(text, /^Sessions\/Session_07\.md$/m);
    assert.match(text, /^ {2}exists: yes$/m);
    assert.match(text, /^ {2}directory: Sessions — mapped to sessions$/m);
    assert.match(text, /^ {2}type: session$/m);
    assert.match(text, /^ {2}publish mode: all$/m);
    assert.match(text, /^ {2}auto-exclude: none$/m);
    assert.match(text, /^ {2}canon status: none \(exclude_drafts off\)$/m);
    assert.match(text, /^ {2}manifest: no manifest$/m);
    assert.match(text, /^ {2}VERDICT: publishes at docs\/sessions\/session-07\.html$/m);
    assert.match(text, /^ {2}sections stripped on publish: GM Notes, Reconciliation Context$/m);
    assert.match(text, /^ {2}gm-only blocks: 1$/m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('names the rule that stopped a prepped session', async () => {
    const vault = makeVault();
    const c = capture();
    const rc = await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_08.md' }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /^ {2}auto-exclude: status: prepped$/m);
    assert.match(c.text(), /^ {2}VERDICT: does not publish — status: prepped \(AUTO_EXCLUDED_STATUS\)$/m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('explains a file in _meta as always excluded', async () => {
    const vault = makeVault();
    const c = capture();
    const rc = await runExplain({ configPath: siteFor(vault), target: '_meta/vault-config.md' }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /VERDICT: does not publish — .*\(DIR_ALWAYS_EXCLUDED\)/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('exits 1 on a missing file and suggests the nearest names', async () => {
    const vault = makeVault();
    const c = capture();
    const rc = await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_7.md' }, c.deps);
    assert.strictEqual(rc, 1);
    assert.match(c.text(), /^no such file in the vault: Sessions\/Session_7\.md$/m);
    assert.match(c.text(), /Sessions\/Session_07\.md/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('reads the manifest section a file sits in', async () => {
    const vault = makeVault();
    write(vault, '_meta/publish-manifest.md', [
      '---', 'mode: player', '---', '',
      '## Publishing (1 files)', '', '- [x] Sessions/Session_07.md', '',
      '## Excluded (1 files)', '', '- [x] Sessions/Session_08.md — prep', '',
    ].join('\n'));
    const configPath = siteFor(vault);

    const a = capture();
    await runExplain({ configPath, target: 'Sessions/Session_07.md' }, a.deps);
    assert.match(a.text(), /^ {2}manifest: Publishing$/m);
    assert.match(a.text(), /VERDICT: publishes at docs\/sessions\/session-07\.html/);

    const b = capture();
    await runExplain({ configPath, target: 'Sessions/Session_08.md' }, b.deps);
    assert.match(b.text(), /^ {2}manifest: Excluded$/m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--json carries the verdict and the stripped sections', async () => {
    const vault = makeVault();
    const c = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_07.md', json: true }, c.deps);
    const payload = JSON.parse(c.out.join(''));
    assert.strictEqual(payload.path, 'Sessions/Session_07.md');
    assert.strictEqual(payload.exists, true);
    assert.strictEqual(payload.publishes, true);
    assert.strictEqual(payload.outputPath, 'docs/sessions/session-07.html');
    assert.deepStrictEqual(payload.verdict, {
      bucket: 'publish', code: 'OK', reason: 'mode: player', outputPath: 'sessions/session-07.html',
    });
    assert.deepStrictEqual(payload.strippedSections, ['GM Notes', 'Reconciliation Context']);
    assert.strictEqual(payload.gmOnlyBlocks, 1);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("says a PC's story companion publishes as part of the PC's page", async () => {
    const configPath = siteForFixtureStory();
    const c = capture();
    const rc = await runExplain({ configPath, target: 'Characters/PCs/Adrien_Story.md' }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /^ {2}VERDICT: publishes as part of docs\/characters\/pcs\/adrien\.html$/m);

    const j = capture();
    await runExplain({ configPath, target: 'Characters/PCs/Adrien_Story.md', json: true }, j.deps);
    const payload = JSON.parse(j.out.join(''));
    assert.strictEqual(payload.verdict.code, 'STORY_COMPANION');
    assert.strictEqual(payload.verdict.reason, "merged into Adrien's page");
    // No page is built at the story file's own path, so the verdict must not name one.
    assert.strictEqual(payload.verdict.outputPath, null);
    assert.strictEqual(payload.mergedInto, 'Adrien');
    assert.strictEqual(payload.outputPath, 'docs/characters/pcs/adrien.html');
  });

  it('needs a path', async () => {
    const vault = makeVault();
    const c = capture();
    assert.strictEqual(await runExplain({ configPath: siteFor(vault) }, c.deps), 1);
    assert.match(c.text(), /explain needs a vault-relative path/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  // C1 + M6: a file gray-matter cannot parse at all used to fall through decidePage
  // as "no `type:`" (NO_TYPE) — wrong, since there is no frontmatter to have read a
  // type from — and explain's own re-read for "sections stripped"/"gm-only blocks"
  // silently swallowed the same error, reporting "none"/"0" as if the file were clean.
  // gray-matter caches a parse by exact string content for the life of the process,
  // so re-scanning byte-identical malformed frontmatter a second time (the JSON
  // check below, against the human-report check above) would see a cached, stale
  // "success" instead of the real throw. Each check below therefore gets its own
  // vault with its own marker so the content differs.
  const malformedFrontmatter = (marker) => `---\ntype: npc\nmarker: ${marker}\nname: "Unterminated\n---\n\nBody.\n`;

  function siteForMalformed(marker) {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-malformed-'));
    write(vault, 'Characters/NPCs/Bram.md', malformedFrontmatter(marker));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-malformed-site-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Malformed Test',
      vaultPath: vault,
      outputDir: './docs',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));
    return { vault, dir, configPath };
  }

  it('says the frontmatter could not be parsed, not NO_TYPE, for an unparseable file', async () => {
    const { vault, dir, configPath } = siteForMalformed('human-check');
    const c = capture();
    const rc = await runExplain({ configPath, target: 'Characters/NPCs/Bram.md' }, c.deps);
    assert.strictEqual(rc, 0);
    const text = c.text();
    assert.doesNotMatch(text, /NO_TYPE/);
    assert.match(text, /frontmatter: could not be parsed — [\s\S]*double quoted scalar/);
    assert.match(text, /VERDICT: does not publish — frontmatter could not be parsed[\s\S]*\(FILE_UNPARSEABLE\)/);
    assert.match(text, /sections stripped on publish: unknown — frontmatter could not be parsed/);
    assert.match(text, /gm-only blocks: unknown/);
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--json carries the same FILE_UNPARSEABLE verdict and null stripped/gm-only fields', async () => {
    const { vault, dir, configPath } = siteForMalformed('json-check');
    const j = capture();
    await runExplain({ configPath, target: 'Characters/NPCs/Bram.md', json: true }, j.deps);
    const payload = JSON.parse(j.out.join(''));
    assert.strictEqual(payload.verdict.code, 'FILE_UNPARSEABLE');
    assert.match(payload.frontmatterError, /double quoted scalar/);
    assert.strictEqual(payload.strippedSections, null);
    assert.strictEqual(payload.gmOnlyBlocks, null);
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // M2: a directory this vault's own config excludes is not the same thing as a
  // directory ALWAYS_EXCLUDE_DIRS names on every site — the reason text already
  // said "listed in excludeDirs", but the code lied and called it DIR_ALWAYS_EXCLUDED.
  it('names a config-only excludeDirs hit DIR_CONFIG_EXCLUDED, not DIR_ALWAYS_EXCLUDED', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-config-excluded-'));
    write(vault, 'Drafts/Idea.md', '---\ntype: npc\n---\n\nA half-formed idea.\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-config-excluded-site-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Config Exclude Test',
      vaultPath: vault,
      outputDir: './docs',
      excludeDirs: ['_meta', '_Templates', 'Drafts'],
      folderMap: {},
    }, null, 2));

    const c = capture();
    const rc = await runExplain({ configPath, target: 'Drafts/Idea.md' }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /VERDICT: does not publish — in Drafts\/ — listed in excludeDirs \(DIR_CONFIG_EXCLUDED\)/);

    const j = capture();
    await runExplain({ configPath, target: 'Drafts/Idea.md', json: true }, j.deps);
    const payload = JSON.parse(j.out.join(''));
    assert.strictEqual(payload.verdict.code, 'DIR_CONFIG_EXCLUDED');
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // M3: explain shares surveyVault with `manifest`, so a bad config path must fail
  // the same clean way instead of a raw `require()` "Cannot find module" stack.
  it('fails with a clean message on a config path that does not exist', async () => {
    const configPath = path.join(os.tmpdir(), 'no-such-dir-' + Date.now(), 'vault.config.json');
    await assert.rejects(
      () => runExplain({ configPath, target: 'Sessions/Session_07.md' }, {}),
      (err) => {
        assert.doesNotMatch(err.message, /Cannot find module/);
        assert.match(err.message, /could not be read as JSON/);
        return true;
      },
    );
  });
});
