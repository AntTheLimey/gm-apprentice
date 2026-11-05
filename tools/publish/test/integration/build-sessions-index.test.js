const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { writeSiteConfig } = require('../helpers/vault-files');

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
    writeSiteConfig(configPath, {
      siteTitle: 'Sessions Index Site',
      siteUrl: 'https://example.github.io/sessions-index',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Sessions: 'sessions' },
    }, 2);

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
    writeSiteConfig(configPath, {
      siteTitle: 'No Sessions Site',
      siteUrl: 'https://example.github.io/no-sessions',
      vaultPath: vault,
      outputDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs' },
    }, 2);

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

// #543: a wrap-up folded into its Story page leaves no page of its own, so a Sessions folder holding only wrap-ups
// has nothing to list. A section with nothing in it writes no index, and nothing links to one.
describe('empty section indexes are not written (#543)', () => {
  const { buildBoth } = require('../helpers/gm-build');
  const { storyVault } = require('../helpers/story-vault');
  const { brokenLinks } = require('../helpers/site-links');
  // The NPC sits where the site files NPCs, so the landing page's link to that index is a real one.
  const NPC = { 'NPCs/Mara Quill.md': null, 'Characters/NPCs/Mara Quill.md': storyVault()['NPCs/Mara Quill.md'] };
  // Session notes and play notes (the GM site lists those) moved out of Sessions: only the wrap-ups are left there.
  const hubsMoved = { ...NPC };
  for (const n of [1, 2]) {
    for (const name of [`Session ${n}`, `Session ${n} Play Notes`]) {
      hubsMoved[`Sessions/${name}.md`] = null;
      hubsMoved[`Chapters/Chapter 1/${name}.md`] = storyVault()[`Sessions/${name}.md`];
    }
  }
  const nothingHere = buildBoth(storyVault(hubsMoved));
  const withHubs = buildBoth(storyVault(NPC));
  after(() => { nothingHere.cleanup(); withHubs.cleanup(); });

  for (const side of ['player', 'gm']) {
    it(`${side}: a Sessions folder holding only folded wrap-ups writes no sessions/index.html, and nothing links to it`, () => {
      const s = nothingHere[side];
      assert.ok(!s.exists('sessions', 'index.html'));
      assert.ok(s.exists('story', 'chapter-1-docks-session-1.html'));
      for (const f of s.files().filter((x) => /\.(?:html|json|js|xml)$/.test(x))) {
        assert.ok(!/sessions\/index\.html|"\/sessions\/"/.test(fs.readFileSync(f, 'utf8')), `${path.relative(s.dir, f)} links sessions/index.html`);
      }
      assert.ok(!/<a [^>]*>Sessions<\/a>/.test(s.read('index.html')), 'no Sessions link in the menu');
      assert.deepEqual(brokenLinks(s.dir), []);
    });

    it(`${side}: the landing page links the NPC index only when NPCs are filed where it lists them`, () => {
      assert.match(withHubs[side].read('index.html'), /href="characters\/npcs\/index\.html">View all/);
      const elsewhere = buildBoth(storyVault());
      try {
        assert.doesNotMatch(elsewhere[side].read('index.html'), /View all \d+ NPCs/);
        assert.deepEqual(brokenLinks(elsewhere[side].dir), []);
      } finally { elsewhere.cleanup(); }
    });

    it(`${side}: "View all N NPCs" counts the NPCs the index lists, not every npc page`, () => {
      const mixed = buildBoth(storyVault({ ...NPC, 'NPCs/Other Fixer.md': '---\ntype: npc\ntitle: Other Fixer\nstatus: alive\n---\n\n# Other Fixer\n\nElsewhere.\n' }));
      try {
        assert.match(mixed[side].read('index.html'), /View all 1 NPC &rarr;/);
        assert.equal((mixed[side].read('characters', 'npcs', 'index.html').match(/Mara Quill|Other Fixer/g) || []).filter((n) => n === 'Other Fixer').length, 0);
      } finally { mixed.cleanup(); }
    });

    it(`${side}: with a session note there, the index and the menu link both stay`, () => {
      const s = withHubs[side];
      assert.ok(s.exists('sessions', 'index.html'));
      assert.match(s.read('index.html'), /<a [^>]*>Sessions<\/a>/);
      assert.deepEqual(brokenLinks(s.dir), []);
    });

    it(`${side}: any empty section writes no index (no factions, no factions/index.html)`, () => {
      assert.ok(!withHubs[side].exists('factions', 'index.html'));
      assert.ok(withHubs[side].exists('characters', 'npcs', 'index.html'));
    });
  }
});
