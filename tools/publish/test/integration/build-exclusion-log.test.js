const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

// The build prints a one-line breakdown of why pages were dropped. Each dropped
// page is counted ONCE, under whichever rule caught it first — and which rule that
// is has been stable since the four filter passes were written, so a page carrying
// two reasons must not migrate between lines when the filters are refactored.
describe('build exclusion log attribution', () => {
  let work;
  let stdout;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-exclusion-log-'));
    const vault = path.join(work, 'vault');
    const write = (rel, body) => {
      const full = path.join(vault, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    };

    write('_meta/vault-config.md', '---\npublish:\n  mode: player\n  exclude_drafts: true\n---\n');
    write('Sessions/Played.md', '---\ntype: session\nstatus: played\n---\n\nHappened.\n');
    // Two reasons at once: prep state AND an explicit publish: false.
    write('Sessions/Both.md', '---\ntype: session\nstatus: planned\npublish: false\n---\n\nPrep.\n');
    // Two reasons at once: DRAFT (with exclude_drafts on) AND publish: false.
    write('Characters/NPCs/DraftAndHidden.md', '---\ntype: npc\ncanon_status: DRAFT\npublish: false\n---\n\nx\n');
    // One reason only, so the publish:false line still has something to count.
    write('Characters/NPCs/Hidden.md', '---\ntype: npc\npublish: false\n---\n\nx\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Exclusion Log',
      siteUrl: 'https://example.github.io/exclusion-log',
      vaultPath: vault,
      outputDir: path.join(work, 'docs'),
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Sessions: 'sessions', 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));

    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      build({ configPath });
    } finally {
      console.log = original;
    }
    stdout = lines.join('\n');
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('counts a DRAFT page that is also publish: false as a DRAFT exclusion', () => {
    assert.match(stdout, /^Excluded 1 DRAFT entity\/entities$/m, stdout);
  });

  it('counts a prep page that is also publish: false as auto-excluded', () => {
    assert.match(stdout, /^Auto-excluded 1 prep\/draft file\(s\)$/m, stdout);
  });

  it('counts only the page whose sole reason is publish: false on that line', () => {
    assert.match(stdout, /^publish: false — skipped 1 file\(s\)$/m, stdout);
  });

  it('emits the page that survives every filter', () => {
    assert.ok(fs.existsSync(path.join(work, 'docs', 'sessions', 'played.html')));
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'sessions', 'both.html')));
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'characters', 'npcs', 'hidden.html')));
  });
});
