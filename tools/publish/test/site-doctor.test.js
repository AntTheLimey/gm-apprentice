const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSiteDoctor, nearestNames, diceCoefficient } = require('../lib/site-doctor');

const FIXTURES = path.join(__dirname, 'fixtures');

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// A site directory whose vault.config.json points at `vaultPath`.
function siteFor(vaultPath, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-'));
  const configPath = path.join(dir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify(Object.assign({
    siteTitle: 'Audit Test',
    vaultPath,
    outputDir: './docs',
    attachmentsDir: '_attachments',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      'Characters/NPCs': 'characters/npcs',
      Locations: 'locations',
      Sessions: 'sessions',
      Chapters: 'chapters',
    },
  }, extra), null, 2));
  return { dir, configPath };
}

function capture() {
  const out = [];
  return {
    out,
    deps: { out: (line) => out.push(String(line)), detect: () => null },
    text: () => out.join('\n'),
  };
}

// One vault carrying one instance of each finding the audit looks for.
function messyVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-vault-'));
  write(vault, 'Characters/NPCs/Dr_Armitage.md', '---\ntype: npc\nportrait: armitage.jpg\n---\n\nThe librarian.\n');
  write(vault, 'Characters/NPCs/Scratchpad.md', '---\nname: Nobody\n---\n\nA note with no type.\n');
  write(vault, 'Locations/Miskatonic_Library.md', '---\ntype: location\n---\n\nRun by [[Dr_Armitag]].\n');
  write(vault, 'Session Notes/Loose Note.md', '---\ntype: session\nstatus: played\n---\n\nIn an unmapped folder.\n');
  write(vault, '_meta/publish-manifest.md', [
    '---', 'mode: player', '---', '',
    '## Publishing (3 files)', '',
    '- [x] Characters/NPCs/Dr_Armitage.md',
    '- [x] Locations/Miskatonic_Library.md',
    '- [x] Locations/Vanished Wing.md',
    '',
  ].join('\n'));
  return vault;
}

describe('site-doctor similarity', () => {
  it('scores an exact match 1 and unrelated strings near 0', () => {
    assert.strictEqual(diceCoefficient('Armitage', 'Armitage'), 1);
    assert.ok(diceCoefficient('Armitage', 'Zebra') < 0.2);
  });

  it('ranks the closest names first and returns at most three', () => {
    const names = ['Dr_Armitage', 'Armitage House', 'Miskatonic_Library', 'Innsmouth', 'Arkham'];
    const near = nearestNames('Dr_Armitag', names);
    assert.strictEqual(near[0], 'Dr_Armitage');
    assert.ok(near.length <= 3);
  });
});

describe('doctor --site', () => {
  it('finds every class of problem in a messy vault', async () => {
    const vault = messyVault();
    const { configPath } = siteFor(vault);
    const c = capture();

    const rc = await runSiteDoctor({ configPath, json: true }, c.deps);
    assert.strictEqual(rc, 0, 'warnings alone do not fail the audit');

    const payload = JSON.parse(c.out.join(''));
    const byCode = {};
    for (const f of payload.findings) (byCode[f.code] = byCode[f.code] || []).push(f);

    assert.deepStrictEqual(byCode.FILE_UNTYPED.map(f => f.path), ['Characters/NPCs/Scratchpad.md']);
    assert.match(byCode.FILE_UNTYPED[0].fix, /add `type:` to the frontmatter/);

    assert.deepStrictEqual(byCode.FOLDER_UNMAPPED.map(f => f.path), ['Session Notes']);
    assert.strictEqual(
      byCode.FOLDER_UNMAPPED[0].fix,
      'add "Session Notes": "session-notes" to folderMap or list it in excludeDirs',
    );

    assert.deepStrictEqual(byCode.PORTRAIT_MISSING.map(f => f.path), ['Characters/NPCs/Dr_Armitage.md']);
    assert.strictEqual(
      byCode.PORTRAIT_MISSING[0].fix,
      'put armitage.jpg in _attachments/ or fix the portrait: value',
    );

    assert.deepStrictEqual(byCode.LINK_UNRESOLVED.map(f => f.path), ['Locations/Miskatonic_Library.md']);
    assert.match(byCode.LINK_UNRESOLVED[0].detail, /Dr_Armitag/);
    assert.match(byCode.LINK_UNRESOLVED[0].fix, /rename the link to one of: Dr_Armitage/);

    assert.deepStrictEqual(byCode.MANIFEST_ORPHAN.map(f => f.path), ['Locations/Vanished Wing.md']);
    assert.match(byCode.MANIFEST_ORPHAN[0].fix, /remove the entry or fix the path/);

    assert.ok(payload.findings.every(f => f.severity === 'warning'));
    assert.strictEqual(payload.ok, true);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('groups the human report by code and counts the severities', async () => {
    const vault = messyVault();
    const { configPath } = siteFor(vault);
    const c = capture();
    await runSiteDoctor({ configPath }, c.deps);
    const text = c.text();
    assert.match(text, new RegExp(`^Site audit \\(${vault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) — 0 errors, \\d+ warnings$`, 'm'));
    assert.match(text, /^FILE_UNTYPED \(1 warning\)$/m);
    assert.match(text, /^ {2}Characters\/NPCs\/Scratchpad\.md — /m);
    assert.match(text, /^ {6}→ add `type:` to the frontmatter$/m);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('says so and exits 0 on a clean vault', async () => {
    const { configPath } = siteFor(path.join(FIXTURES, 'superseded-entities'), {
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    });
    const c = capture();
    const rc = await runSiteDoctor({ configPath }, c.deps);
    assert.strictEqual(rc, 0);
    assert.match(c.text(), /No findings\./);
  });

  it('reports an unreadable config as an error and exits 1', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-bad-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, '{ not json');
    const c = capture();
    const rc = await runSiteDoctor({ configPath }, c.deps);
    assert.strictEqual(rc, 1);
    assert.match(c.text(), /CONFIG_INVALID/);
    assert.match(c.text(), /edit vault\.config\.json/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a config with no vaultPath as an error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-novault-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'x' }));
    const c = capture();
    assert.strictEqual(await runSiteDoctor({ configPath }, c.deps), 1);
    assert.match(c.text(), /CONFIG_INVALID/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports a vaultPath that does not exist as an error', async () => {
    const { configPath } = siteFor(path.join(os.tmpdir(), 'no-such-vault-' + Date.now()));
    const c = capture();
    const rc = await runSiteDoctor({ configPath, json: true }, c.deps);
    assert.strictEqual(rc, 1);
    const payload = JSON.parse(c.out.join(''));
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.findings[0].code, 'VAULT_MISSING');
    assert.match(payload.findings[0].fix, /vaultPath points at/);
  });

  it('warns when the site pin is older than the newest installed tool', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-pinned-'));
    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\nHi.\n');
    const { dir, configPath } = siteFor(vault, { folderMap: { 'Characters/NPCs': 'characters/npcs' } });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      dependencies: { 'gm-apprentice-publish': 'file:/cache/gm-apprentice/1.11.20/tools/publish' },
    }));
    const c = capture();
    c.deps.detect = () => ({ pinned: '1.11.30', latest: '1.11.30', drift: false, versionsRoot: '/cache/gm-apprentice' });

    await runSiteDoctor({ configPath, json: true }, c.deps);
    const payload = JSON.parse(c.out.join(''));
    const finding = payload.findings.find(f => f.code === 'VERSION_DRIFT');
    assert.ok(finding, JSON.stringify(payload.findings));
    assert.match(finding.detail, /1\.11\.20/);
    assert.match(finding.fix, /run `gm-publish update-pin`/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('warns about a played session that is in no manifest section', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-unreg-'));
    write(vault, 'Sessions/Session_1.md', '---\ntype: session\nstatus: played\n---\n\nIt happened.\n');
    write(vault, 'Sessions/Session_2.md', '---\ntype: session\nstatus: played\n---\n\nAlso happened.\n');
    write(vault, '_meta/publish-manifest.md', [
      '---', 'mode: player', '---', '',
      '## Publishing (1 files)', '', '- [x] Sessions/Session_1.md', '',
    ].join('\n'));
    const { configPath } = siteFor(vault, { folderMap: { Sessions: 'sessions' } });
    const c = capture();
    await runSiteDoctor({ configPath, json: true }, c.deps);
    const payload = JSON.parse(c.out.join(''));
    const finding = payload.findings.find(f => f.code === 'MANIFEST_UNREGISTERED');
    assert.ok(finding, JSON.stringify(payload.findings));
    assert.strictEqual(finding.path, 'Sessions/Session_2.md');
    assert.match(finding.fix, /gm-publish manifest diff/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('warns when a published wrap-up has no session index or chapter behind it', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-recap-'));
    write(vault, 'Sessions/Session_1_Wrap.md', '---\ntype: session_wrap\n---\n\nWhat happened.\n');
    const { configPath } = siteFor(vault, { folderMap: { Sessions: 'sessions' } });
    const c = capture();
    await runSiteDoctor({ configPath, json: true }, c.deps);
    const payload = JSON.parse(c.out.join(''));
    const finding = payload.findings.find(f => f.code === 'RECAP_INCOMPLETE');
    assert.ok(finding, JSON.stringify(payload.findings));
    assert.match(finding.fix, /publish the session index and chapter page/);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('caps the untyped rows at 20 and says how many more there are', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'site-doctor-many-'));
    for (let i = 1; i <= 25; i++) write(vault, `Characters/NPCs/Untyped${i}.md`, '---\nname: x\n---\n');
    const { configPath } = siteFor(vault, { folderMap: { 'Characters/NPCs': 'characters/npcs' } });
    const c = capture();
    await runSiteDoctor({ configPath }, c.deps);
    const rows = c.text().split('\n').filter(l => /Untyped\d+\.md/.test(l));
    assert.strictEqual(rows.length, 20);
    assert.match(c.text(), /\+5 more/);
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
