const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLinkMap, scanAttachments } = require('../../lib/scanner');
const { resolveWikiLinks, renderRelationships, renderMetaValue, resolveImageEmbeds } = require('../../lib/processor');
const { portraitImg } = require('../../lib/templates/base');

// The two lookup tables the whole renderer indexes into — linkMap (keyed by page title
// and alias) and imageMap (keyed by attachment basename) — are queried with author-typed
// text: the words inside a `[[wikilink]]`, a `portrait:` value, a relationship target.
// The key and the query therefore come from two different keyboards, editors, and OSes,
// which round-trip Unicode differently: "Gonzalez" typed with a precomposed accent (NFC) and
// the same visible name typed as e + combining acute (NFD) are different strings
// byte-for-byte. Exact-string lookup silently misses, and the link renders as plain text
// or the portrait silently vanishes — the same #139 defect as the manifest boundary.
//
// Every constant below is written with explicit \u escapes, never a literal accented
// character, so no editor or formatter can silently re-normalize this file and quietly
// turn these tests into tautologies.
const NFC = 'Alena Gonz\u00e1lez';
const NFD = 'Alena Gonza\u0301lez';
const NFC_PNG = 'Alena Gonz\u00e1lez.png';
const NFD_PNG = 'Alena Gonza\u0301lez.png';

// Sanity: the pairs really do differ byte-for-byte, or every assertion below is vacuous.
assert.notStrictEqual(NFC, NFD);
assert.notStrictEqual(NFC_PNG, NFD_PNG);

const OUT = 'characters/npcs/alena-gonzalez.html';

function pageNamed(title, frontmatter = {}, outputPath = OUT) {
  return { title, outputPath, frontmatter };
}

describe('linkMap lookups across unicode normal forms (#139)', () => {
  it('resolves an NFC-typed lookup against an NFD-named page', () => {
    const map = buildLinkMap([pageNamed(NFD)]);
    assert.strictEqual(map[NFC], OUT);
  });

  it('resolves an NFD-typed lookup against an NFC-named page', () => {
    const map = buildLinkMap([pageNamed(NFC)]);
    assert.strictEqual(map[NFD], OUT);
  });

  it('reports membership for either normal form', () => {
    const map = buildLinkMap([pageNamed(NFC)]);
    assert.ok(NFD in map);
    assert.ok(NFC in map);
    assert.ok(!('Someone Else' in map));
  });

  it('resolves an alias typed in the other normal form', () => {
    const map = buildLinkMap([pageNamed('Alena', { aliases: [NFD] })]);
    assert.strictEqual(map[NFC], OUT);
  });

  it('redirects a superseded page whose superseded_by target differs only in normal form', () => {
    const map = buildLinkMap([
      pageNamed(NFC, {}, 'characters/npcs/new.html'),
      pageNamed('Old Name', { canon_status: 'SUPERSEDED', superseded_by: `[[${NFD}]]` }, 'characters/npcs/old.html'),
    ]);
    assert.strictEqual(map['Old Name'], 'characters/npcs/new.html');
  });

  it('renders a body wikilink typed in the other normal form as a real link', () => {
    const map = buildLinkMap([pageNamed(NFD)]);
    const out = resolveWikiLinks(`Met [[${NFC}]] at the docks.`, map, 'sessions/session-01.html');
    assert.strictEqual(out, `Met [${NFC}](../${OUT}) at the docks.`);
  });

  it('links a relationship target typed in the other normal form', () => {
    const map = buildLinkMap([pageNamed(NFD)]);
    const html = renderRelationships({ relationships: [{ target: NFC, type: 'ally' }] }, map, 'characters/pcs/rook.html');
    assert.ok(html.includes(`href="../npcs/alena-gonzalez.html"`), html);
  });

  it('links a frontmatter wikilink typed in the other normal form', () => {
    const map = buildLinkMap([pageNamed(NFD)]);
    const html = renderMetaValue(`Works for [[${NFC}]]`, map, 'characters/pcs/rook.html');
    assert.ok(html.includes(`href="../npcs/alena-gonzalez.html"`), html);
  });

  it('stores the output path byte-for-byte, without canonicalizing it', () => {
    // #139 normalization and #145 percent-encoding stay orthogonal: only the lookup KEY is
    // canonicalized, never the emitted path. A page whose output path carries NFD bytes must
    // keep them — the file on disk is named with those bytes, so an NFC-rewritten href 404s.
    const nfdOut = `characters/npcs/${NFD}.html`;
    const map = buildLinkMap([pageNamed(NFC, {}, nfdOut)]);
    assert.strictEqual(map[NFC], nfdOut);
    assert.strictEqual(map[NFD], nfdOut);
    assert.deepStrictEqual(Object.values(map), [nfdOut]);

    const out = resolveWikiLinks(`[[${NFC}]]`, map, 'sessions/session-01.html');
    const href = out.slice(out.lastIndexOf('(') + 1, -1);
    assert.strictEqual(decodeURIComponent(href), `../characters/npcs/${NFD}.html`);
  });
});

describe('imageMap lookups across unicode normal forms (#139)', () => {
  function attachmentVault(fileName) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unicode-attach-'));
    fs.mkdirSync(path.join(tmpDir, '_attachments'));
    fs.writeFileSync(path.join(tmpDir, '_attachments', fileName), 'not-really-a-png');
    return tmpDir;
  }

  function withVault(fileName, fn) {
    const tmpDir = attachmentVault(fileName);
    try {
      fn(scanAttachments({ vaultPath: tmpDir, attachmentsDir: '_attachments' }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Both on-disk spellings are exercised: the filesystem itself may hand readdir back
  // either normal form regardless of which one created the file, so pinning only one
  // direction would pass or fail by accident of the host filesystem.
  for (const [label, onDisk] of [['NFC', NFC_PNG], ['NFD', NFD_PNG]]) {
    it(`resolves a ${label}-named attachment from either normal form`, () => {
      withVault(onDisk, (map) => {
        assert.ok(map[NFC_PNG], 'NFC lookup missed');
        assert.ok(map[NFD_PNG], 'NFD lookup missed');
        assert.strictEqual(map[NFC_PNG], map[NFD_PNG]);
      });
    });

    it(`renders a portrait: value against a ${label}-named attachment in either normal form`, () => {
      withVault(onDisk, (map) => {
        for (const portrait of [NFC_PNG, NFD_PNG, `_attachments/${NFD_PNG}`]) {
          const html = portraitImg({ portrait }, 'characters/npcs/alena.html', map);
          assert.match(html, /^<img src="/, `portrait "${portrait}" did not resolve`);
        }
      });
    });

    it(`resolves an image embed against a ${label}-named attachment in either normal form`, () => {
      withVault(onDisk, (map) => {
        for (const typed of [NFC_PNG, NFD_PNG]) {
          const out = resolveImageEmbeds(`![[${typed}]]`, map, 'characters/npcs/alena.html');
          assert.match(out, /^!\[/, `embed "${typed}" did not resolve`);
        }
      });
    });
  }

  it('records a used image under the imageMap key, so player-mode pruning keeps it', () => {
    // build.js prunes with `usedImages.has(basename)` over Object.entries(imageMap). An
    // embed typed in the other normal form must register the map's own key, or the image
    // resolves in the HTML and is then left out of the copy pass — a broken <img> in
    // player mode only.
    withVault(NFC_PNG, (map) => {
      const used = new Set();
      resolveImageEmbeds(`![[${NFD_PNG}]]`, map, 'characters/npcs/alena.html', used);
      const key = Object.keys(map)[0];
      assert.ok(used.has(key), `usedImages ${[...used]} does not contain map key ${key}`);
    });
  });

  it('dedupes an embed that repeats the portrait in the other normal form', () => {
    withVault(NFC_PNG, (map) => {
      const out = resolveImageEmbeds(`![[${NFD_PNG}]]`, map, 'characters/npcs/alena.html', null, {
        portraitBasename: NFC_PNG,
      });
      assert.strictEqual(out, '');
    });
  });

  it('emits the src from the scanned relPath, without canonicalizing it', () => {
    // Same orthogonality guarantee as linkMap: the bytes in the URL are the bytes the
    // scanner recorded (and copyImages writes), never a re-normalized spelling.
    withVault(NFD_PNG, (map) => {
      const entry = map[NFC_PNG];
      const html = portraitImg({ portrait: NFC_PNG }, 'characters/npcs/alena.html', map);
      const src = html.match(/src="([^"]+)"/)[1];
      assert.strictEqual(decodeURIComponent(src), `../../images/${entry.relPath}`);
    });
  });
});

describe('derived title tables across unicode normal forms (#139)', () => {
  // Same defect class as linkMap, found auditing every table keyed by author-typed text:
  // buildBacklinks keys off the words inside a `[[wikilink]]` but is read back with the
  // scanned page title, and the relationship graph resolves wikilink targets against page
  // titles. A mismatch drops the "Mentioned in" sidebar entry, or draws the entity twice —
  // once as a resolved node, once as a dangling one.
  const { buildBacklinks } = require('../../lib/backlinks');
  const { buildRelationshipGraph } = require('../../lib/relationship-graph');

  it('backlinks a mention typed in the other normal form', () => {
    const bl = buildBacklinks([
      { title: 'Session_1', displayTitle: 'Session 1', outputPath: 'sessions/session-1.html', frontmatter: { type: 'session' }, markdown: `Met [[${NFD}]].` },
      { title: NFC, displayTitle: NFC, outputPath: OUT, frontmatter: { type: 'npc' }, markdown: '' },
    ]);
    assert.ok(bl[NFC], 'lookup by the page title should find the mention');
    assert.strictEqual(bl[NFC][0].outputPath, 'sessions/session-1.html');
  });

  it('resolves a graph relationship target typed in the other normal form', () => {
    const pages = [
      { title: 'Rook', displayTitle: 'Rook', outputPath: 'characters/pcs/rook.html', frontmatter: { type: 'pc', relationships: [{ target: `[[${NFD}]]`, type: 'ally' }] } },
      { title: NFC, displayTitle: NFC, outputPath: OUT, frontmatter: { type: 'npc' } },
    ];
    const graph = buildRelationshipGraph('Rook', pages, {});
    const node = graph.nodes.find(n => n.type === 'npc');
    assert.ok(node, `no npc node in ${JSON.stringify(graph.nodes)}`);
    assert.strictEqual(node.outputPath, OUT);
  });

  it('draws the mutual relationship as one resolved pair, not a dangling twin', () => {
    const pages = [
      { title: 'Rook', displayTitle: 'Rook', outputPath: 'characters/pcs/rook.html', frontmatter: { type: 'pc', relationships: [{ target: `[[${NFD}]]`, type: 'ally' }] } },
      { title: NFC, displayTitle: NFC, outputPath: OUT, frontmatter: { type: 'npc', relationships: [{ target: '[[Rook]]', type: 'ally' }] } },
    ];
    const graph = buildRelationshipGraph('Rook', pages, {});
    assert.strictEqual(graph.nodes.length, 2, JSON.stringify(graph.nodes.map(n => n.id)));
    // Every node must resolve to a page: a node with a null outputPath is the dangling
    // twin the mismatch produces — drawn in the graph but linking nowhere.
    assert.ok(graph.nodes.every(n => n.outputPath), JSON.stringify(graph.nodes));
  });
});

// Map/Set boundaries. nfcLookupTable only guarantees plain-object tables; these four sites
// compare author-typed text against filenames through `Map.get`, `Set.has`, or bare `===`,
// so each one needs canonicalization at both the write and the read.
describe('Map/Set title boundaries across unicode normal forms (#139)', () => {
  const { scoreByRecency } = require('../../lib/recency');
  const { buildStorySpine } = require('../../lib/story-spine');

  const SESSION_NFC = 'Session Ren\u00e9e';
  const SESSION_NFD = 'Session Rene\u0301e';
  const CHAPTER_NFC = 'Chapter Ren\u00e9e';
  const CHAPTER_NFD = 'Chapter Rene\u0301e';
  assert.notStrictEqual(SESSION_NFC, SESSION_NFD);
  assert.notStrictEqual(CHAPTER_NFC, CHAPTER_NFD);

  const npcPage = () => ({ title: NFC, displayTitle: NFC, outputPath: OUT, frontmatter: { type: 'npc' } });

  it('scores an entity mentioned in the latest session under the other normal form', () => {
    const session = {
      title: 'Session_1', displayTitle: 'Session 1', outputPath: 'sessions/session-1.html',
      frontmatter: { type: 'session', status: 'played', play_date: '2026-01-02', session_number: 1 },
      markdown: `The party met [[${NFD}]] at the docks.`,
    };
    const scored = scoreByRecency([npcPage()], [session], [], { type: 'npc' });
    assert.strictEqual(scored.length, 1, 'accented NPC never scores, so it never reaches the landing page');
  });

  it('scores an entity named only in a frontmatter participant ref in the other normal form', () => {
    const session = {
      title: 'Session_1', displayTitle: 'Session 1', outputPath: 'sessions/session-1.html',
      frontmatter: {
        type: 'session', status: 'played', play_date: '2026-01-02', session_number: 1,
        participants: [`[[${NFD}]]`],
      },
      markdown: 'No wiki-links in the body.',
    };
    assert.strictEqual(scoreByRecency([npcPage()], [session], [], { type: 'npc' }).length, 1);
  });

  it('counts wrap-up mentions when the wrap-up session ref differs in normal form', () => {
    const session = {
      title: SESSION_NFC, displayTitle: SESSION_NFC, outputPath: 'sessions/session-renee.html',
      frontmatter: { type: 'session', status: 'played', play_date: '2026-01-02', session_number: 1 },
      markdown: 'The session stub carries no mentions.',
    };
    const wrapUp = {
      title: 'Session_Wrap', displayTitle: 'Session Wrap', outputPath: 'sessions/wrap.html',
      frontmatter: { type: 'session_wrap', session: `[[${SESSION_NFD}]]` },
      markdown: `The recap names [[${NFC}]] throughout.`,
    };
    const scored = scoreByRecency([npcPage()], [session], [], { type: 'npc', wrapUps: [wrapUp] });
    assert.strictEqual(scored.length, 1, 'wrap-up never pairs with its session, so its mentions are lost');
  });

  it('pairs a session with a wrap-up whose session ref differs in normal form', () => {
    // The wrap-up lives outside the session's folder, so the same-folder fallback cannot
    // rescue the pairing and only the ref match is under test.
    const pages = [
      { title: 'Chapter_1', displayTitle: 'Chapter 1', sourcePath: '/v/Chapters/Chapter_1.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '' },
      { title: SESSION_NFC, displayTitle: SESSION_NFC, sourcePath: '/v/Chapters/Chapter_1/S1.md', frontmatter: { type: 'session', session_number: 1 }, markdown: '' },
      { title: 'S1_Wrap', displayTitle: 'S1 Wrap', sourcePath: '/v/Wrapups/S1_Wrap.md', frontmatter: { type: 'session_wrap', session: `[[${SESSION_NFD}]]` }, markdown: '## Narrative Recap\n\nThe vault burned.\n' },
    ];
    const units = buildStorySpine(pages);
    assert.ok(
      units.some(u => u.kind === 'session' && u.recapHtml.includes('vault burned')),
      `session recap missing from story spine: ${JSON.stringify(units.map(u => u.kind))}`,
    );
  });

  it('groups a flat-vault session under a chapter whose ref differs in normal form', () => {
    // Separate folders, so chapterOwnsSession falls through to the title/ref match.
    const pages = [
      { title: CHAPTER_NFC, displayTitle: CHAPTER_NFC, sourcePath: '/v/Chapters/Chapter.md', frontmatter: { type: 'chapter', sort_order: 1 }, markdown: '' },
      { title: 'S1', displayTitle: 'S1', sourcePath: '/v/Sessions/S1.md', frontmatter: { type: 'session', session_number: 1, chapter: `[[${CHAPTER_NFD}]]` }, markdown: '## Narrative Recap\n\nThe bridge fell.\n' },
    ];
    const units = buildStorySpine(pages);
    assert.ok(
      units.some(u => u.kind === 'session' && u.chapterTitle === CHAPTER_NFC),
      `session not grouped under its chapter: ${JSON.stringify(units.map(u => [u.kind, u.chapterTitle]))}`,
    );
  });
});

describe('chapter page constituent sessions across unicode normal forms (#139)', () => {
  const { build } = require('../../lib/build');
  const CHAPTER_NFC = 'Chapter Ren\u00e9e';
  const CHAPTER_NFD = 'Chapter Rene\u0301e';

  it('lists a session whose chapter ref differs in normal form from the chapter filename', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'unicode-chapter-'));
    try {
      const vault = path.join(work, 'vault');
      fs.mkdirSync(path.join(vault, 'Chapters'), { recursive: true });
      fs.mkdirSync(path.join(vault, 'Sessions'), { recursive: true });
      fs.writeFileSync(
        path.join(vault, 'Chapters', `${CHAPTER_NFC}.md`),
        `---\ntype: chapter\ntitle: "${CHAPTER_NFC}"\nsort_order: 1\n---\n\nChapter body.\n`,
      );
      fs.writeFileSync(
        path.join(vault, 'Sessions', 'Session 1.md'),
        `---\ntype: session\nchapter: "[[${CHAPTER_NFD}]]"\nsession_number: 1\nstatus: played\n---\n\nSession body.\n`,
      );

      const docs = path.join(work, 'docs');
      const configPath = path.join(work, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        vaultPath: vault, outputDir: docs, attachmentsDir: '_attachments',
        siteTitle: 'Unicode Chapters', siteUrl: 'https://example.github.io/unicode',
        excludeDirs: ['_meta', '_Templates'],
        folderMap: { Chapters: 'chapters', Sessions: 'sessions' },
      }));
      build({ configPath });

      const html = fs.readFileSync(path.join(docs, 'chapters', 'chapter-renee.html'), 'utf8');
      assert.match(html, /sessions\/session-1\.html/, 'chapter page lists no constituent sessions');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
