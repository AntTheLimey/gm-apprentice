const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { slugify, mapFolder, buildLinkMap, scanVault, pairStoryFiles } = require('../../lib/scanner');
const { getCanonStatus } = require('../../lib/templates/base');

describe('slugify', () => {
  it('converts to lowercase', () => {
    assert.strictEqual(slugify('Hello World'), 'hello-world');
  });

  it('removes apostrophes', () => {
    assert.strictEqual(slugify("Captain's Log"), 'captains-log');
  });

  it('converts ampersand to "and"', () => {
    assert.strictEqual(slugify('Factions & Organizations'), 'factions-and-organizations');
  });

  it('replaces non-alphanumeric with hyphens', () => {
    assert.strictEqual(slugify('Item (rare)'), 'item-rare');
  });

  it('trims leading/trailing hyphens', () => {
    assert.strictEqual(slugify('--test--'), 'test');
  });

  it('returns "untitled" for empty string', () => {
    assert.strictEqual(slugify(''), 'untitled');
  });
});

describe('slugify unicode normalization (#139)', () => {
  // Built with explicit \u escapes (never a literal accented character) so the test
  // file itself cannot be silently re-normalized by an editor or formatter. NFC types
  // the accent as one precomposed codepoint; NFD types the same visible character as
  // base letter + a separate combining acute accent codepoint.
  const NFC = 'Gonz\u00e1lez';
  const NFD = 'Gonza\u0301lez';

  it('strips combining marks rather than hyphenating them, for NFC input', () => {
    assert.strictEqual(slugify(NFC), 'gonzalez');
  });

  it('strips combining marks rather than hyphenating them, for NFD input', () => {
    assert.strictEqual(slugify(NFD), 'gonzalez');
  });

  it('produces the same slug for two names differing only in normal form', () => {
    assert.notStrictEqual(NFC, NFD); // sanity: the two source strings really do differ byte-for-byte
    assert.strictEqual(slugify(NFC), slugify(NFD));
  });
});

describe('mapFolder', () => {
  const folderMap = {
    'Characters/PCs': 'characters/pcs',
    'Characters/NPCs': 'characters/npcs',
    '_Campaign': 'campaign',
  };

  it('maps exact folder match', () => {
    assert.strictEqual(mapFolder('Characters/PCs', folderMap), 'characters/pcs');
  });

  it('maps nested paths within mapped folder', () => {
    assert.strictEqual(mapFolder('Characters/PCs/subfolder', folderMap), 'characters/pcs/subfolder');
  });

  it('returns null for unmapped folders', () => {
    assert.strictEqual(mapFolder('Unknown', folderMap), null);
  });
});

describe('buildLinkMap', () => {
  it('maps titles to output paths', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: {} },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John Doe'], 'characters/pcs/john-doe.html');
  });

  it('maps aliases', () => {
    const pages = [
      { title: 'John Doe', outputPath: 'characters/pcs/john-doe.html', frontmatter: { aliases: ['Johnny'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Johnny'], 'characters/pcs/john-doe.html');
  });

  it('prefers canonical title over alias', () => {
    const pages = [
      { title: 'John', outputPath: 'a.html', frontmatter: {} },
      { title: 'Jane', outputPath: 'b.html', frontmatter: { aliases: ['John'] } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['John'], 'a.html');
  });

  it('redirects superseded entities via source_confidence', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { source_confidence: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });

  it('redirects superseded entities via canon_status fallback', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { canon_status: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });

  it('redirects superseded entities via legacy bare confidence field', () => {
    const pages = [
      { title: 'New Name', outputPath: 'new.html', frontmatter: {} },
      { title: 'Old Name', outputPath: 'old.html', frontmatter: { confidence: 'SUPERSEDED', superseded_by: '[[New Name]]' } },
    ];
    const map = buildLinkMap(pages);
    assert.strictEqual(map['Old Name'], 'new.html');
  });

  it('excludes pages marked SUPERSEDED via legacy bare confidence from publish set', () => {
    const pages = [
      { title: 'Live NPC', outputPath: 'live.html', frontmatter: { canon_status: 'AUTHORITATIVE' } },
      { title: 'Retired NPC', outputPath: 'retired.html', frontmatter: { confidence: 'SUPERSEDED', superseded_by: '[[Live NPC]]' } },
    ];
    const published = pages.filter(p => getCanonStatus(p.frontmatter) !== 'SUPERSEDED');
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].title, 'Live NPC');
  });

  it('excludes DRAFT pages using getCanonStatus filter (same predicate as build.js)', () => {
    const pages = [
      { title: 'Active NPC', outputPath: 'npc.html', frontmatter: { source_confidence: 'AUTHORITATIVE' } },
      { title: 'Draft NPC', outputPath: 'draft.html', frontmatter: { source_confidence: 'DRAFT' } },
      { title: 'Legacy Draft', outputPath: 'legacy.html', frontmatter: { canon_status: 'DRAFT' } },
    ];
    const filtered = pages.filter(p => getCanonStatus(p.frontmatter) !== 'DRAFT');
    const map = buildLinkMap(filtered);
    assert.ok('Active NPC' in map);
    assert.ok(!('Draft NPC' in map));
    assert.ok(!('Legacy Draft' in map));
  });
});

describe('scanVault displayTitle', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'minimal');
  const config = {
    vaultPath: fixturesDir,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      '_Campaign': 'campaign',
      'Characters/PCs': 'characters/pcs',
      'Characters/NPCs': 'characters/npcs',
      'Locations': 'locations',
    },
  };

  it('sets displayTitle with underscores replaced by spaces', () => {
    const pages = scanVault(config);
    const pc = pages.find(p => p.title === 'Underscored_Name');
    assert.ok(pc, 'Underscored_Name page should exist');
    assert.strictEqual(pc.displayTitle, 'Underscored Name');
  });

  it('preserves title as raw filename for link resolution', () => {
    const pages = scanVault(config);
    const pc = pages.find(p => p.title === 'Underscored_Name');
    assert.ok(pc, 'Underscored_Name page should exist');
    assert.strictEqual(pc.title, 'Underscored_Name');
  });
});

describe('pairStoryFiles', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'with-story');
  const config = {
    vaultPath: fixturesDir,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      'Characters/PCs': 'characters/pcs',
    },
  };

  it('attaches storyMarkdown to PC with matching story file', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'Lord_Blackwood');
    assert.ok(pc, 'Lord_Blackwood page should exist');
    assert.ok(pc.storyMarkdown, 'Should have storyMarkdown attached');
    assert.ok(pc.storyMarkdown.includes('The Whitby Letter'));
    assert.ok(pc.storyMarkdown.includes('The Hastings Séance'));
  });

  it('removes story files from the page list', () => {
    const pages = scanVault(config);
    const beforeCount = pages.length;
    pairStoryFiles(pages, fixturesDir);
    const storyPage = pages.find(p => p.title === 'Lord_Blackwood_Story');
    assert.strictEqual(storyPage, undefined, 'Story file should be removed from pages');
    assert.strictEqual(pages.length, beforeCount - 2, 'Both story files should be removed');
  });

  it('leaves PCs without story files unchanged', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'No_Story_PC');
    assert.ok(pc, 'No_Story_PC should exist');
    assert.strictEqual(pc.storyMarkdown, undefined);
  });

  it('only pairs with type: pc pages', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const remaining = pages.filter(p => p.frontmatter.type === 'pc');
    assert.strictEqual(remaining.length, 3, 'Should have 3 PCs remaining');
  });

  it('skips story files without type: character-story frontmatter', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const pc = pages.find(p => p.title === 'Wrong_Type_PC');
    assert.ok(pc, 'Wrong_Type_PC should exist');
    assert.strictEqual(pc.storyMarkdown, undefined, 'Should not pair with wrong-type story file');
  });

  it('removes wrong-type story files from pages to prevent standalone publishing', () => {
    const pages = scanVault(config);
    pairStoryFiles(pages, fixturesDir);
    const storyPage = pages.find(p => p.title === 'Wrong_Type_PC_Story');
    assert.strictEqual(storyPage, undefined, 'Wrong-type story file should still be removed from pages');
  });
});

describe('scanVault unmapped-directory warning', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures', 'minimal');

  function captureWarns(fn) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try { fn(); } finally { console.warn = orig; }
    return warns;
  }

  it('warns once per unmapped directory holding typed pages', () => {
    const config = {
      vaultPath: fixturesDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: {
        '_Campaign': 'campaign',
        'Characters/PCs': 'characters/pcs',
        'Characters/NPCs': 'characters/npcs',
        // Locations intentionally unmapped
      },
    };
    const warns = captureWarns(() => scanVault(config));
    const locWarns = warns.filter(w => w.includes('Locations') && w.includes('folderMap'));
    assert.strictEqual(locWarns.length, 1);
  });

  it('does not warn when every typed dir is mapped', () => {
    const config = {
      vaultPath: fixturesDir,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: {
        '_Campaign': 'campaign',
        'Characters/PCs': 'characters/pcs',
        'Characters/NPCs': 'characters/npcs',
        'Locations': 'locations',
      },
    };
    const warns = captureWarns(() => scanVault(config));
    assert.strictEqual(warns.filter(w => w.includes('folderMap')).length, 0);
  });
});

describe('scanVault page slug collision warning (#139)', () => {
  // Stripping combining marks makes "Renée" and "Renee" in one folder slug to the
  // same renee.html, where the old naive slugify kept them apart ("ren-e"/"renee").
  // The second page silently overwrites the first on disk, so the scan has to say so.
  function captureWarns(fn) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try { return { result: fn(), warns }; } finally { console.warn = orig; }
  }

  function makeVault(fileNames) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-collision-'));
    const npcDir = path.join(tmpDir, 'Characters', 'NPCs');
    fs.mkdirSync(npcDir, { recursive: true });
    for (const name of fileNames) {
      fs.writeFileSync(path.join(npcDir, name + '.md'), '---\ntype: npc\n---\n\nBody.\n');
    }
    return tmpDir;
  }

  const config = (vaultPath) => ({
    vaultPath,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/NPCs': 'characters/npcs' },
  });

  // é written as an escape so no editor can silently re-normalize this source file.
  const ACCENTED = 'Ren\u00e9e';

  it('warns when two pages in the same folder produce the same output path', () => {
    const tmpDir = makeVault([ACCENTED, 'Renee']);
    try {
      const { warns } = captureWarns(() => scanVault(config(tmpDir)));
      const collisionWarns = warns.filter(w => w.includes('page slug collision'));
      assert.strictEqual(collisionWarns.length, 1, `expected one collision warning, got: ${warns.join(' | ')}`);
      // Normalized before matching: the filesystem may hand readdir back either normal form.
      const warning = collisionWarns[0].normalize('NFC');
      assert.ok(warning.includes('characters/npcs/renee.html'), warning);
      assert.ok(warning.includes(ACCENTED + '.md'), warning);
      assert.ok(warning.includes('Renee.md'), warning);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not warn when slugs are distinct', () => {
    const tmpDir = makeVault([ACCENTED, 'Bjorn']);
    try {
      const { warns } = captureWarns(() => scanVault(config(tmpDir)));
      assert.strictEqual(warns.filter(w => w.includes('page slug collision')).length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('still returns both colliding pages so the caller decides what to do', () => {
    const tmpDir = makeVault([ACCENTED, 'Renee']);
    try {
      const { result: pages } = captureWarns(() => scanVault(config(tmpDir)));
      assert.strictEqual(pages.length, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('scanVault untyped-file warning', () => {
  // A file with no `type:` never publishes. Skipping it silently is how a GM
  // ends up staring at a site that is missing a note they definitely wrote, so
  // the scan names the files it dropped and how to fix them.
  function captureWarns(fn) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try { return { result: fn(), warns }; } finally { console.warn = orig; }
  }

  function makeVault(files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-untyped-'));
    const npcDir = path.join(tmpDir, 'Characters', 'NPCs');
    fs.mkdirSync(npcDir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(npcDir, name + '.md'), body);
    }
    return tmpDir;
  }

  const config = (vaultPath) => ({
    vaultPath,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/NPCs': 'characters/npcs' },
  });

  const TYPED = '---\ntype: npc\n---\n\nBody.\n';
  const UNTYPED = '---\nname: Nobody\n---\n\nBody.\n';

  it('warns once, names the file, and still returns the typed pages', () => {
    const tmpDir = makeVault({ Gatekeeper: TYPED, Scratchpad: UNTYPED });
    try {
      const { result: pages, warns } = captureWarns(() => scanVault(config(tmpDir)));
      const untypedWarns = warns.filter(w => w.includes('no `type:`'));
      assert.strictEqual(untypedWarns.length, 1, `expected one warning, got: ${warns.join(' | ')}`);
      assert.ok(untypedWarns[0].includes('Characters/NPCs/Scratchpad.md'), untypedWarns[0]);
      assert.ok(untypedWarns[0].includes('skipped 1 file(s)'), untypedWarns[0]);
      assert.ok(untypedWarns[0].includes('excludeDirs'), untypedWarns[0]);
      assert.strictEqual(pages.length, 1);
      assert.strictEqual(pages[0].title, 'Gatekeeper');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists at most five paths and counts the rest', () => {
    const files = {};
    for (let i = 1; i <= 7; i++) files['Untyped' + i] = UNTYPED;
    const tmpDir = makeVault(files);
    try {
      const { warns } = captureWarns(() => scanVault(config(tmpDir)));
      const w = warns.find(x => x.includes('no `type:`'));
      assert.ok(w, warns.join(' | '));
      assert.ok(w.includes('skipped 7 file(s)'), w);
      assert.ok(w.includes('(+2 more)'), w);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('says nothing when every file is typed', () => {
    const tmpDir = makeVault({ Gatekeeper: TYPED, Bjorn: TYPED });
    try {
      const { warns } = captureWarns(() => scanVault(config(tmpDir)));
      assert.strictEqual(warns.filter(w => w.includes('no `type:`')).length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('scanVaultReport', () => {
  const { scanVaultReport } = require('../../lib/scanner');

  function makeVault(files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-report-'));
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return tmpDir;
  }

  const config = (vaultPath) => ({
    vaultPath,
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/NPCs': 'characters/npcs' },
  });

  const TYPED = '---\ntype: npc\n---\n\nBody.\n';
  const UNTYPED = '---\nname: Nobody\n---\n\nBody.\n';

  function silently(fn) {
    const orig = console.warn;
    console.warn = () => {};
    try { return fn(); } finally { console.warn = orig; }
  }

  it('returns the pages the scan produced', () => {
    const vault = makeVault({ 'Characters/NPCs/Gatekeeper.md': TYPED });
    try {
      const report = silently(() => scanVaultReport(config(vault)));
      assert.strictEqual(report.pages.length, 1);
      assert.strictEqual(report.pages[0].title, 'Gatekeeper');
      assert.deepStrictEqual(report.untyped, []);
      assert.deepStrictEqual(report.unmapped, []);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('names every untyped file, uncapped', () => {
    const files = {};
    for (let i = 1; i <= 7; i++) files[`Characters/NPCs/Untyped${i}.md`] = UNTYPED;
    const vault = makeVault(files);
    try {
      const report = silently(() => scanVaultReport(config(vault)));
      assert.strictEqual(report.untyped.length, 7);
      assert.ok(report.untyped.includes('Characters/NPCs/Untyped3.md'), report.untyped.join(', '));
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('reports each unmapped directory once, with how many typed pages it lost', () => {
    const vault = makeVault({
      'Characters/NPCs/Gatekeeper.md': TYPED,
      'Session Notes/Note A.md': TYPED,
      'Session Notes/Note B.md': TYPED,
      'Session Notes/Scratch.md': UNTYPED,
    });
    try {
      const report = silently(() => scanVaultReport(config(vault)));
      assert.deepStrictEqual(report.unmapped, [{ dir: 'Session Notes', typedFileCount: 2 }]);
      // The untyped file in an unmapped folder is reported as untyped, not as a lost page.
      assert.deepStrictEqual(report.untyped, ['Session Notes/Scratch.md']);
      assert.strictEqual(report.pages.length, 1);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('scanVault still prints both warnings and returns just the pages', () => {
    const vault = makeVault({
      'Characters/NPCs/Gatekeeper.md': TYPED,
      'Characters/NPCs/Scratch.md': UNTYPED,
      'Session Notes/Note A.md': TYPED,
    });
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const pages = scanVault(config(vault));
      assert.strictEqual(pages.length, 1);
      assert.strictEqual(warns.filter(w => w.includes('no `type:`')).length, 1);
      assert.strictEqual(warns.filter(w => w.includes('not in folderMap')).length, 1);
      assert.ok(warns.find(w => w.includes('Session Notes')), warns.join(' | '));
    } finally {
      console.warn = orig;
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
