const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanVaultReport, warnScanReport } = require('../lib/scanner');
const { runManifest } = require('../lib/manifest-cli');
const { markNeverPublish } = require('../lib/never-publish');

const FOLDER_MAP = { Sessions: 'sessions', 'Characters/NPCs': 'characters/npcs' };

// A vault with one of each kind of note, and a site config pointing at it.
function setup(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'never-publish-'));
  const vault = path.join(dir, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const configPath = path.join(dir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'T', vaultPath: vault, outputDir: './docs', excludeDirs: ['_meta'], folderMap: FOLDER_MAP,
  }));
  return { dir, vault, configPath };
}

function run(configPath, extra) {
  const out = [];
  const promise = runManifest({ verb: 'never-publish', configPath, ...extra }, { out: (l) => out.push(String(l)) });
  return promise.then((rc) => ({ rc, text: out.join('\n'), out }));
}

const FILES = {
  'Sessions/Play notes.md': 'raw notes\n',
  'Sessions/Plan.md': '---\nstatus: draft\n---\nplan body\n',
  'Sessions/Marked.md': '---\npublish: false\n---\nalready\n',
  'Characters/NPCs/Bob.md': '---\ntype: npc\n---\nBob\n',
  'AGENTS.md': 'agent notes\n',
};

describe('scanner: publish: false on a note with no type', () => {
  it('counts it apart from the untyped files and does not warn about it', () => {
    const { vault } = setup(FILES);
    const report = scanVaultReport({ vaultPath: vault, excludeDirs: ['_meta'], folderMap: FOLDER_MAP });
    assert.deepStrictEqual(report.neverPublish, ['Sessions/Marked.md']);
    assert.ok(!report.untyped.includes('Sessions/Marked.md'));
    const warned = [];
    const real = console.warn;
    console.warn = (m) => warned.push(m);
    const logged = [];
    const realLog = console.log;
    console.log = (m) => logged.push(m);
    try { warnScanReport(report); } finally { console.warn = real; console.log = realLog; }
    assert.ok(warned.every((w) => !w.includes('Marked.md')), warned.join('\n'));
    assert.match(warned.join('\n'), /skipped 3 file\(s\)/);
    assert.match(warned.join('\n'), /publish: false/);
    assert.match(logged.join('\n'), /1 note\(s\) with no `type:` marked publish: false/);
  });
});

describe('markNeverPublish', () => {
  it('gives a note with no frontmatter a one-line block and leaves the body alone', () => {
    assert.strictEqual(markNeverPublish('body\n').text, '---\npublish: false\n---\nbody\n');
  });
  it('adds the line to existing frontmatter and keeps CRLF line endings', () => {
    assert.strictEqual(markNeverPublish('---\r\nstatus: draft\r\n---\r\nbody\r\n').text,
      '---\r\npublish: false\r\nstatus: draft\r\n---\r\nbody\r\n');
  });
  it('treats an unclosed --- as a rule line, not frontmatter', () => {
    assert.strictEqual(markNeverPublish('---\nbody\n').text, '---\npublish: false\n---\n---\nbody\n');
  });
  it('says so when the note is marked already, and leaves a different publish: line to the GM', () => {
    assert.deepStrictEqual(markNeverPublish('---\npublish: false\n---\n'), { skip: 'already marked' });
    assert.match(markNeverPublish('---\npublish: stub\n---\n').skip, /by hand/);
  });
});

describe('manifest never-publish', () => {
  it('previews --untyped and writes nothing', async () => {
    const { vault, configPath } = setup(FILES);
    const r = await run(configPath, { untyped: true });
    assert.strictEqual(r.rc, 0);
    assert.match(r.text, /would mark 2 note/);
    assert.match(r.text, /Sessions\/Play notes\.md/);
    assert.match(r.text, /Sessions\/Plan\.md/);
    assert.doesNotMatch(r.text, /AGENTS\.md/);
    assert.match(r.text, /Run again with --write/);
    assert.strictEqual(fs.readFileSync(path.join(vault, 'Sessions/Play notes.md'), 'utf8'), 'raw notes\n');
  });

  it('--write marks them, then the scan counts them instead of warning', async () => {
    const { vault, configPath } = setup(FILES);
    const r = await run(configPath, { untyped: true, write: true });
    assert.match(r.text, /marked 2 note/);
    assert.strictEqual(fs.readFileSync(path.join(vault, 'Sessions/Play notes.md'), 'utf8'), '---\npublish: false\n---\nraw notes\n');
    assert.strictEqual(fs.readFileSync(path.join(vault, 'Sessions/Plan.md'), 'utf8'), '---\npublish: false\nstatus: draft\n---\nplan body\n');
    assert.strictEqual(fs.readFileSync(path.join(vault, 'AGENTS.md'), 'utf8'), 'agent notes\n');
    const report = scanVaultReport({ vaultPath: vault, excludeDirs: ['_meta'], folderMap: FOLDER_MAP });
    assert.deepStrictEqual(report.untyped, ['AGENTS.md']);
    assert.strictEqual(report.neverPublish.length, 3);
    const again = await run(configPath, { untyped: true, write: true });
    assert.match(again.text, /marked 0 note/);
  });

  it('never touches a note that publishes, and refuses a path that is not in the vault', async () => {
    const { vault, configPath } = setup(FILES);
    const r = await run(configPath, { paths: ['Characters/NPCs/Bob.md'], write: true });
    assert.match(r.text, /marked 0 note/);
    assert.match(r.text, /Bob\.md — it publishes now/);
    assert.strictEqual(fs.readFileSync(path.join(vault, 'Characters/NPCs/Bob.md'), 'utf8'), FILES['Characters/NPCs/Bob.md']);
    const bad = await run(configPath, { paths: ['Sessions/Nope.md', 'Sessions/Plan.md'], write: true });
    assert.strictEqual(bad.rc, 1);
    assert.match(bad.text, /no such file in the vault: Sessions\/Nope\.md/);
    assert.strictEqual(fs.readFileSync(path.join(vault, 'Sessions/Plan.md'), 'utf8'), FILES['Sessions/Plan.md']);
  });

  it('marks a root AGENTS.md only when it is named', async () => {
    const { vault, configPath } = setup(FILES);
    await run(configPath, { paths: ['AGENTS.md'], write: true });
    assert.strictEqual(fs.readFileSync(path.join(vault, 'AGENTS.md'), 'utf8'), '---\npublish: false\n---\nagent notes\n');
  });

  it('asks for --path or --untyped', async () => {
    const { configPath } = setup(FILES);
    const r = await run(configPath, {});
    assert.strictEqual(r.rc, 1);
    assert.match(r.text, /--path/);
  });

  it('explain-style verdict for a marked note is publish: false, not no type', async () => {
    const { surveyVault } = require('../lib/manifest-cli');
    const { vault, configPath } = setup(FILES);
    const survey = surveyVault({ configPath }, {});
    assert.strictEqual(survey.verdicts.get('Sessions/Marked.md').code, 'PUBLISH_FALSE');
    assert.strictEqual(survey.verdicts.get('Sessions/Plan.md').code, 'NO_TYPE');
    assert.ok(vault);
  });
});

describe('gm-publish manifest never-publish (the command line)', () => {
  it('is a known command with its own flags', () => {
    const { spawnSync } = require('child_process');
    const { vault, configPath } = setup(FILES);
    const bin = path.join(__dirname, '..', 'bin', 'gm-publish.js');
    const r = spawnSync(process.execPath, [bin, 'manifest', 'never-publish', '--path', 'Sessions/Plan.md', '--write', '--config', configPath], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /marked 1 note/);
    assert.match(fs.readFileSync(path.join(vault, 'Sessions/Plan.md'), 'utf8'), /^---\npublish: false\n/);
  });
});
