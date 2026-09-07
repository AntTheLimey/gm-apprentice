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

// The manifest line counts allowlist membership and nothing else. `publish: false`
// was dropped by a later pass, so a page that is both listed and never-publish is
// still on the right-hand side of this line — and then subtracted on the next one.
describe('build manifest-filter line counts allowlist membership only', () => {
  let work;
  let stdout;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-manifest-line-'));
    const vault = path.join(work, 'vault');
    const write = (rel, body) => {
      const full = path.join(vault, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    };

    write('Locations/Tavern.md', '---\ntype: location\n---\n\nA tavern.\n');
    // Listed under Publishing AND never-publish: counted by the manifest line,
    // removed by the publish-false line.
    write('Locations/Cellar.md', '---\ntype: location\npublish: false\n---\n\nA cellar.\n');
    // Not listed at all — the allowlist drops it, so it is not in either count.
    write('Locations/Attic.md', '---\ntype: location\n---\n\nAn attic.\n');
    write('_meta/publish-manifest.md', [
      '---', 'mode: player', '---', '',
      '## Publishing (2 files)', '',
      '- [x] Locations/Tavern.md',
      '- [x] Locations/Cellar.md',
      '',
    ].join('\n'));

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Manifest Line',
      siteUrl: 'https://example.github.io/manifest-line',
      vaultPath: vault,
      outputDir: path.join(work, 'docs'),
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Locations: 'locations' },
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

  it('counts a listed publish: false page on the right-hand side of the manifest line', () => {
    assert.match(stdout, /^Manifest filter: 3 → 2 pages$/m, stdout);
  });

  it('subtracts it on the publish: false line instead', () => {
    assert.match(stdout, /^publish: false — skipped 1 file\(s\)$/m, stdout);
  });

  it('and does not build a page for it', () => {
    assert.ok(fs.existsSync(path.join(work, 'docs', 'locations', 'tavern.html')));
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'locations', 'cellar.html')));
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'locations', 'attic.html')));
  });
});

// M1 (controller ruling): decidePage checks the manifest allowlist before the
// auto-exclude heuristics, so a manifest-listed prep page's verdict is OK from the
// start — it never passes through an AUTO_EXCLUDED_* code, so it never reaches the
// "Auto-excluded N" tally at all. That count is the pages genuinely withheld today;
// "Manifest override: re-included" is purely informational, not a subtraction from it.
describe('build "Auto-excluded" count excludes a manifest-re-included prep page', () => {
  let work;
  let stdout;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-reinclude-count-'));
    const vault = path.join(work, 'vault');
    const write = (rel, body) => {
      const full = path.join(vault, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    };

    // Genuinely withheld: prep-state, not listed anywhere in the manifest.
    write('Locations/Hideout.md', '---\ntype: location\nstatus: planned\n---\n\nStill forming.\n');
    // Also prep-state, but the GM explicitly listed it under Publishing: decidePage
    // never classifies it AUTO_EXCLUDED_STATUS, so it must not inflate that count.
    write('Locations/Sneak_Peek.md', '---\ntype: location\nstatus: planned\n---\n\nA teaser the GM wants live.\n');
    write('_meta/publish-manifest.md', [
      '---', 'mode: player', '---', '',
      '## Publishing (1 files)', '',
      '- [x] Locations/Sneak_Peek.md',
      '',
    ].join('\n'));

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Reinclude Count',
      siteUrl: 'https://example.github.io/reinclude-count',
      vaultPath: vault,
      outputDir: path.join(work, 'docs'),
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Locations: 'locations' },
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

  it('counts only the genuinely withheld prep page as auto-excluded', () => {
    assert.match(stdout, /^Auto-excluded 1 prep\/draft file\(s\)$/m, stdout);
  });

  it('reports the manifest-listed prep page as re-included, on top of that count', () => {
    assert.match(stdout, /^Manifest override: re-included 1 auto-excluded file\(s\)$/m, stdout);
  });

  it('builds the re-included page and not the withheld one', () => {
    assert.ok(fs.existsSync(path.join(work, 'docs', 'locations', 'sneak-peek.html')));
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'locations', 'hideout.html')));
  });
});
