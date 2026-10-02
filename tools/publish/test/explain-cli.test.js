const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFile } = require('child_process');
const { promisify } = require('util');

const { runExplain, runExplainAll } = require('../lib/explain-cli');

const CLI = path.join(__dirname, '..', 'bin', 'gm-publish.js');

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
    // #276: no Wrap-Up, so the hub body is the session's record and publishes.
    assert.doesNotMatch(text, /^ {2}body: /m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('says a session index body is withheld once a Wrap-Up publishes (#276)', async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Session_07_Wrap_Up.md',
      '---\ntype: session_wrap\nsession: "[[Session_07]]"\n---\n\n## Narrative Recap\n\nDocks.\n');
    const c = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_07.md' }, c.deps);
    assert.match(c.text(), /^ {2}body: not published — a session index is metadata only/m);
    const j = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_07.md', json: true }, j.deps);
    assert.strictEqual(JSON.parse(j.out.join('')).bodyPublishes, false);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--json says a session index body publishes when there is no Wrap-Up (#276)', async () => {
    const vault = makeVault();
    const c = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_07.md', json: true }, c.deps);
    assert.strictEqual(JSON.parse(c.out.join('')).bodyPublishes, true);
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
  const MALFORMED = `---\ntype: npc\nname: "Unterminated\n---\n\nBody.\n`;

  function siteForMalformed() {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-malformed-'));
    write(vault, 'Characters/NPCs/Bram.md', MALFORMED);
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
    const { vault, dir, configPath } = siteForMalformed();
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
    const { vault, dir, configPath } = siteForMalformed();
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

  // Review follow-up: explain used to read the raw vault.config.json `excludeDirs` only,
  // so a folder excluded exclusively via vault-config.md's `publish.exclude_dirs` was
  // reported as publishable here while the real build actually dropped it — the two
  // commands disagreed about the same file.
  it('reports DIR_CONFIG_EXCLUDED for a folder excluded only via publish.exclude_dirs in vault-config.md', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-vaultconfig-excluded-'));
    write(vault, 'Drafts/Idea.md', '---\ntype: npc\n---\n\nA half-formed idea.\n');
    write(vault, '_meta/vault-config.md', '---\npublish:\n  exclude_dirs:\n    - "Drafts"\n---\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-vaultconfig-excluded-site-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Vault Config Exclude Test',
      vaultPath: vault,
      outputDir: './docs',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: {},
    }, null, 2));

    const c = capture();
    const rc = await runExplain({ configPath, target: 'Drafts/Idea.md' }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /VERDICT: does not publish — in Drafts\/ — listed in excludeDirs \(DIR_CONFIG_EXCLUDED\)/);
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

describe('explain on a session index that does not publish (#276)', () => {
  it('says the page itself does not publish, not that it is built from the Wrap-Up', async () => {
    const vault = makeVault();
    // Session 08 is prepped (auto-excluded); give it a published Wrap-Up.
    write(vault, 'Sessions/Session_08_Wrap_Up.md',
      '---\ntype: session_wrap\nsession: "[[Session_08]]"\n---\n\n## Narrative Recap\n\nAmbush.\n');
    const c = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_08.md' }, c.deps);
    assert.match(c.text(), /^ {2}body: not published — the page itself does not publish/m);
    assert.doesNotMatch(c.text(), /built from frontmatter/);
    const j = capture();
    await runExplain({ configPath: siteFor(vault), target: 'Sessions/Session_08.md', json: true }, j.deps);
    const parsed = JSON.parse(j.out.join(''));
    assert.strictEqual(parsed.publishes, false);
    assert.strictEqual(parsed.bodyPublishes, false);
    assert.strictEqual(parsed.bodyWithheld, true);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});

describe('explain reports the switches and the sheet-withheld sections (#285)', () => {
  function vaultWith(publishLines, siteExtra) {
    const vault = makeVault();
    write(vault, '_meta/vault-config.md', `---\npublish:\n  mode: player\n${publishLines}---\n`);
    write(vault, 'Sessions/Hero.md', [
      '---', 'type: pc', '---', '',
      '## Stat Sheet', '', 'ST 12', '',
      '## Skills', '', 'Brawling 12', '',
      '## Background', '', 'A sailor.', '',
      '## GM Notes', '', 'Secret.', '',
    ].join('\n'));
    const configPath = siteFor(vault);
    if (siteExtra) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      fs.writeFileSync(configPath, JSON.stringify(Object.assign(cfg, siteExtra)));
    }
    return { vault, configPath };
  }
  async function explainAll(configPath) {
    const c = capture();
    assert.strictEqual(await runExplainAll({ configPath }, c.deps), 0);
    return JSON.parse(c.out.join(''));
  }

  it('reports the defaults, sheets off forcing live stats off, and all on', async () => {
    const d = vaultWith('');
    assert.deepStrictEqual((await explainAll(d.configPath)).switches,
      { characterSheets: true, liveStats: false, inbox: false });
    const off = vaultWith('  character_sheets: false\n  live_stats: true\n');
    assert.deepStrictEqual((await explainAll(off.configPath)).switches,
      { characterSheets: false, liveStats: false, inbox: false });
    const on = vaultWith('  live_stats: true\n  inbox: true\n');
    assert.deepStrictEqual((await explainAll(on.configPath)).switches,
      { characterSheets: true, liveStats: true, inbox: true });
    for (const v of [d, off, on]) fs.rmSync(v.vault, { recursive: true, force: true });
  });

  it('reports the list the build resolves: vault file first, else the site file, else the default', async () => {
    const both = vaultWith('  exclude_sections: ["GM Notes"]\n', { excludeSections: ['Keeper Only'] });
    assert.deepStrictEqual((await explainAll(both.configPath)).excludeSections, ['GM Notes']);
    const siteOnly = vaultWith('', { excludeSections: ['Keeper Only'] });
    assert.deepStrictEqual((await explainAll(siteOnly.configPath)).excludeSections, ['Keeper Only']);
    const none = vaultWith('');
    assert.deepStrictEqual((await explainAll(none.configPath)).excludeSections,
      ['GM Notes', 'DM Notes', 'Player Notes', 'Source References', 'Reconciliation Context', 'Handoff to Reconcile']);
    const c = capture();
    assert.strictEqual(await runExplain({ configPath: both.configPath, target: 'Sessions/Hero.md', json: true }, c.deps), 0);
    assert.deepStrictEqual(JSON.parse(c.out.join('')).excludeSections, ['GM Notes']);
    for (const v of [both, siteOnly, none]) fs.rmSync(v.vault, { recursive: true, force: true });
  });

  it('names the sections only the keep-list withholds, apart from the stripped ones', async () => {
    const off = vaultWith('  character_sheets: false\n');
    const pages = new Map((await explainAll(off.configPath)).pages.map((p) => [p.path, p]));
    const hero = pages.get('Sessions/Hero.md');
    assert.deepStrictEqual(hero.sheetWithheldSections, ['Stat Sheet', 'Skills']);
    assert.deepStrictEqual(hero.strippedSections, ['GM Notes']);
    fs.rmSync(off.vault, { recursive: true, force: true });
    const on = vaultWith('');
    const heroOn = (await explainAll(on.configPath)).pages.find((p) => p.path === 'Sessions/Hero.md');
    assert.deepStrictEqual(heroOn.sheetWithheldSections, []);
    fs.rmSync(on.vault, { recursive: true, force: true });
  });

  it('gives null for a file the scanner made no page for', async () => {
    const off = vaultWith('  character_sheets: false\n');
    write(off.vault, 'Unmapped/Hidden.md', '---\ntype: pc\n---\n\n## Stat Sheet\n\nST 12\n');
    const pages = new Map((await explainAll(off.configPath)).pages.map((p) => [p.path, p]));
    assert.strictEqual(pages.get('Unmapped/Hidden.md').sheetWithheldSections, null);
    fs.rmSync(off.vault, { recursive: true, force: true });
  });

  it('single-file --json and the report carry the same field', async () => {
    const off = vaultWith('  character_sheets: false\n');
    const j = capture();
    await runExplain({ configPath: off.configPath, target: 'Sessions/Hero.md', json: true }, j.deps);
    assert.deepStrictEqual(JSON.parse(j.out.join('')).sheetWithheldSections, ['Stat Sheet', 'Skills']);
    const h = capture();
    await runExplain({ configPath: off.configPath, target: 'Sessions/Hero.md' }, h.deps);
    assert.match(h.text(), /sections withheld with the character sheet: Stat Sheet, Skills/);
    const s = capture();
    await runExplain({ configPath: off.configPath, target: 'Sessions/Session_07.md' }, s.deps);
    assert.doesNotMatch(s.text(), /withheld with the character sheet/);
    fs.rmSync(off.vault, { recursive: true, force: true });
  });
});

describe('explain --all (#276)', () => {
  function all(configPath, extra) {
    const c = capture();
    return runExplainAll(Object.assign({ configPath }, extra || {}), c.deps)
      .then((rc) => ({ rc, json: JSON.parse(c.out.join('')) }));
  }
  const byPath = (json) => new Map(json.pages.map((p) => [p.path, p]));

  it('reports publishes and body status for every file in one run', async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Session_07_Wrap_Up.md',
      '---\ntype: session_wrap\nsession: "[[Session_07]]"\n---\n\n## Narrative Recap\n\nDocks.\n');
    const { rc, json } = await all(siteFor(vault));
    assert.strictEqual(rc, 0);
    const pages = byPath(json);
    assert.deepStrictEqual(pages.get('Sessions/Session_07.md'), {
      path: 'Sessions/Session_07.md', type: 'session', publishes: true,
      code: pages.get('Sessions/Session_07.md').code, bodyWithheld: true, bodyPublishes: false,
      strippedSections: ['GM Notes', 'Reconciliation Context'],
      sheetSourceSet: null,
      sheetWithheldSections: [],
      retiredSheetFields: null,
      frontmatterError: null,
    });
    assert.strictEqual(pages.get('Sessions/Session_07_Wrap_Up.md').bodyPublishes, true);
    assert.strictEqual(pages.get('Sessions/Session_08.md').publishes, false);
    assert.strictEqual(pages.get('Sessions/Session_08.md').code, 'AUTO_EXCLUDED_STATUS');
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('carries the parser message for a file whose frontmatter cannot be parsed (#287)', async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Dup.md', '---\ntype: pc\nsheet_source: paper\nsheet_source: PDF\n---\n\nA sailor.\n');
    write(vault, 'Sessions/Colon.md', '---\ntype: npc\nrole: a: b\n---\n\nA clerk.\n');
    const { rc, json } = await all(siteFor(vault));
    assert.strictEqual(rc, 0);
    const pages = byPath(json);
    const dup = pages.get('Sessions/Dup.md');
    assert.strictEqual(dup.code, 'FILE_UNPARSEABLE');
    assert.strictEqual(dup.publishes, false);
    assert.match(dup.frontmatterError, /duplicated mapping key/);
    assert.strictEqual(pages.get('Sessions/Colon.md').code, 'FILE_UNPARSEABLE');
    assert.ok(pages.get('Sessions/Colon.md').frontmatterError);
    assert.strictEqual(pages.get('Sessions/Session_07.md').frontmatterError, null);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  describe('retiredSheetFields follow the campaign system', () => {
    async function retiredFor(system, fm) {
      const vault = makeVault();
      write(vault, '_meta/vault-config.md', `---\npublish:\n  mode: player\n${system ? `  system: ${system}\n` : ''}---\n`);
      write(vault, 'Sessions/Pc.md', `---\ntype: pc\noccupation: Sailor\n${fm}---\n\nA sailor.\n`);
      write(vault, 'Sessions/Npc.md', '---\ntype: npc\nskills: [x]\n---\n\nA clerk.\n');
      const { rc, json } = await all(siteFor(vault));
      assert.strictEqual(rc, 0);
      const pages = byPath(json);
      assert.strictEqual(pages.get('Sessions/Npc.md').retiredSheetFields, null);
      assert.strictEqual(pages.get('Sessions/Session_07.md').retiredSheetFields, null);
      fs.rmSync(vault, { recursive: true, force: true });
      return pages.get('Sessions/Pc.md').retiredSheetFields;
    }
    const gurpsFm = 'attributes: { ST: 77 }\nskills: [{ name: Sentinel }]\nstress: { current: 1, max: 9 }\n';

    it('lists a GURPS name on a GURPS PC (aliases included), and [] when none is carried', async () => {
      assert.deepStrictEqual(await retiredFor('gurps-4e', gurpsFm), ['attributes', 'skills']);
      assert.deepStrictEqual(await retiredFor('gurps', gurpsFm), ['attributes', 'skills']);
      assert.deepStrictEqual(await retiredFor('gurps-4e', 'point_total: 150\n'), []);
    });

    it('does not report a GURPS-only name on a CoC, D&D or generic PC', async () => {
      for (const system of ['coc-7e', 'dnd-5e-2024', 'fitd', 'generic', '']) {
        const got = await retiredFor(system, 'skills: [x]\nidentity: x\nlanguages: [x]\npoints: [x]\n');
        assert.deepStrictEqual(got, [], system);
      }
    });

    it('reports each system its own names, a shared name for every system that read it', async () => {
      assert.deepStrictEqual(await retiredFor('dnd-5e-2024', gurpsFm + 'ability_scores: {}\nspell_slots: {}\n'), ['ability_scores', 'spell_slots']);
      assert.deepStrictEqual(await retiredFor('blades', gurpsFm), ['stress']);
      assert.deepStrictEqual(await retiredFor('pathfinder-2e', gurpsFm + 'hero_points: 1\nspell_slots: {}\n'), ['attributes', 'spell_slots', 'hero_points']);
    });
  });

  it('says whether each PC has a sheet_source, and null for any other file (#273)', async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Away.md', '---\ntype: pc\nsheet_source: "D&D Beyond"\n---\n\nA sailor.\n');
    write(vault, 'Sessions/Blank.md', '---\ntype: pc\nsheet_source: null\n---\n\nA sailor.\n');
    write(vault, 'Unmapped/Hidden.md', '---\ntype: pc\nsheet_source: paper\n---\n\nA sailor.\n');
    const { rc, json } = await all(siteFor(vault));
    assert.strictEqual(rc, 0);
    const pages = byPath(json);
    assert.strictEqual(pages.get('Sessions/Away.md').sheetSourceSet, true);
    assert.strictEqual(pages.get('Sessions/Blank.md').sheetSourceSet, false);
    // No page is made for a file in an unmapped folder, so there is nothing to say.
    assert.strictEqual(pages.get('Unmapped/Hidden.md').sheetSourceSet, null);
    assert.strictEqual(pages.get('Sessions/Session_08.md').sheetSourceSet, null);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('a broken documents.wrap_up plus a number-matched Wrap-Up leaves the body published', async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Session_07.md', [
      '---', 'type: session', 'session_number: 7', 'status: played',
      'documents:', '  wrap_up: "[[No Such Wrap Up]]"', '---', '',
      'Keeper-only: the Baron appears in scene 3.', '',
    ].join('\n'));
    write(vault, 'Sessions/Session_07_Wrap_Up.md',
      '---\ntype: session_wrap\nsession_number: 7\n---\n\n## Narrative Recap\n\nDocks.\n');
    const { json } = await all(siteFor(vault));
    const hub = byPath(json).get('Sessions/Session_07.md');
    assert.strictEqual(hub.bodyWithheld, false);
    assert.strictEqual(hub.bodyPublishes, true);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("names a handout's Keeper sections among the stripped ones (#280)", async () => {
    const vault = makeVault();
    write(vault, 'Sessions/Chit.md', [
      '---', 'type: document', '---', '', '## Content', '', 'The chit.', '',
      '## Context', '', 'Why.', '', '## Clues, if Katherine walks', '', 'Route.', '',
      '## Prop Notes', '', 'Paper.', '',
    ].join('\n'));
    const { json } = await all(siteFor(vault));
    assert.deepStrictEqual(byPath(json).get('Sessions/Chit.md').strippedSections,
      ['Context', 'Clues, if Katherine walks', 'Prop Notes']);
    assert.deepStrictEqual(byPath(json).get('Sessions/Session_08.md').strippedSections, []);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('pipes JSON larger than the 64 KB pipe buffer whole (#279)', async () => {
    const vault = makeVault();
    for (let i = 0; i < 700; i++) {
      write(vault, `Sessions/Filler_${String(i).padStart(4, '0')}_with_a_long_name.md`,
        `---\ntype: session\nsession_number: ${100 + i}\nstatus: played\n---\n`);
    }
    const { stdout } = await promisify(execFile)(process.execPath,
      [CLI, 'explain', '--all', '--json', '--config', siteFor(vault), '--vault', vault],
      { maxBuffer: 16 * 1024 * 1024 });
    assert.ok(stdout.length > 65536, `only ${stdout.length} bytes: the fixture is too small to test the pipe`);
    assert.strictEqual(JSON.parse(stdout).pages.length, 702);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('--vault reads another vault through the site config', async () => {
    const vault = makeVault();
    const other = makeVault();
    write(other, 'Sessions/Only_Here.md', '---\ntype: session\nsession_number: 9\nstatus: played\n---\n');
    const { json } = await all(siteFor(vault), { vaultPath: other });
    assert.strictEqual(json.vaultPath, path.resolve(other));
    assert.ok(byPath(json).has('Sessions/Only_Here.md'));
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('runs from the CLI and refuses --all without --json', async () => {
    const vault = makeVault();
    const configPath = siteFor(vault);
    const run = (args) => promisify(execFile)(process.execPath, [CLI, ...args])
      .then((r) => ({ code: 0, ...r }))
      .catch((err) => ({ code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' }));
    const ok = await run(['explain', '--all', '--json', '--config', configPath, '--vault', vault]);
    assert.strictEqual(ok.code, 0, ok.stderr);
    assert.ok(JSON.parse(ok.stdout).pages.some((p) => p.path === 'Sessions/Session_07.md'));
    const bad = await run(['explain', '--all', '--config', configPath]);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.stderr, /explain --all needs --json/);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
