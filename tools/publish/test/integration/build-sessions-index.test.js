const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

function write(base, rel, body) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

// #214: the nav's Story group has always linked Sessions at sessions/index.html
// (nav.js's NAV_GROUPS), but nothing generated that page for a vault whose folderMap
// routes a folder to "sessions" output — a guaranteed 404. base.js's DIR_LABELS is the
// authoritative set build.js iterates to write section indexes; adding "sessions" there
// makes it built the same way every other section is.
describe('sessions/index.html is generated when session pages exist (#214)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sessions-index-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, 'Sessions/Session One.md',
      '---\ntype: session\nsession_number: 1\n---\n\n# Session One\n\nThe party arrives.\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Sessions Index Site',
      siteUrl: 'https://example.github.io/sessions-index',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Sessions: 'sessions' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('writes sessions/index.html', () => {
    assert.ok(fs.existsSync(path.join(outputDir, 'sessions', 'index.html')));
  });

  it('the nav Sessions link resolves to a page that was actually written', () => {
    const session = fs.readFileSync(path.join(outputDir, 'sessions', 'session-one.html'), 'utf8');
    assert.match(session, /href="index\.html">Sessions</, session);
    // The href above is relative to sessions/session-one.html — resolve it for real,
    // not just match the string, so a generated link with nothing behind it still fails.
    assert.ok(fs.existsSync(path.join(outputDir, 'sessions', 'index.html')), 'sessions/index.html must exist for the nav link to resolve');
  });

  it('the generated index lists the session page', () => {
    const index = fs.readFileSync(path.join(outputDir, 'sessions', 'index.html'), 'utf8');
    assert.ok(index.includes('Session One'), index);
  });
});

describe('the Sessions nav link is hidden when no session pages exist (#214)', () => {
  let work, outputDir;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-sessions-index-empty-'));
    const vault = path.join(work, 'vault');
    outputDir = path.join(work, 'docs');

    write(vault, 'Characters/NPCs/Someone.md', '---\ntype: npc\n---\n\n# Someone\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'No Sessions Site',
      siteUrl: 'https://example.github.io/no-sessions',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    build({ configPath });
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('does not show a Sessions link in the nav when there are no session pages', () => {
    const npc = fs.readFileSync(path.join(outputDir, 'characters', 'npcs', 'someone.html'), 'utf8');
    assert.ok(!npc.includes('>Sessions<'), npc);
  });
});
