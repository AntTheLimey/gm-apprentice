const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
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

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

// #276: the session index (hub) is metadata only by design, and GMs use its body as a
// working dashboard — "Keeper-only" notes, plan links, a Scene Index of prepped-but-unrun
// scenes, links to NPCs who were prepped and never appeared. Once the session has a
// published Wrap-Up, the hub body is withheld from the page and from every derived view,
// and the page shows the Wrap-Up's recap opening instead. A session with no Wrap-Up keeps
// its body exactly as before: some vaults write their recaps there and have no Wrap-Ups.
const HUB_BODY = `# Session 01 - Arrival

**Key prep:** [[Standing_Situations]], [[Session 01 - Arrival - Plan]]

## Documents

- Conspiracy wall: Keeper-only; player knowledge only (no Baron card, he is held to the ball)
- Play notes: DRAFT pending reconcile

## Scene Index

| Scene | State |
|---|---|
| [[The Churchyard Hour]] | contingency |

They will meet [[Prepped Villain]], who is better at this than they are.
`;

describe('session pages and the hub body (#276)', () => {
  let work, docs;
  const read = rel => fs.readFileSync(path.join(docs, rel), 'utf8');
  const find = name => {
    const hit = walk(docs).find(f => path.basename(f) === name);
    assert.ok(hit, `expected ${name} in the build output`);
    return fs.readFileSync(hit, 'utf8');
  };
  const badges = (...values) => '<div class="metadata-badges">'
    + values.map(v => `<span class="metadata-badge">${v}</span>`).join('\n') + '</div>';

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-session-page-'));
    const vault = path.join(work, 'vault');
    docs = path.join(work, 'docs');
    const ch = 'Chapters/Chapter 1 - Opening';

    write(vault, `${ch}/Chapter 1 - Opening.md`,
      '---\ntype: chapter\nsort_order: 1\n---\n\n# Chapter 1 - Opening\n\nThe first chapter.\n');
    write(vault, `${ch}/Sessions/Session 01/Session 01 - Arrival.md`, `---
type: session
session_number: 1
chapter: "[[Chapter 1 - Opening]]"
play_date: "2026-01-17"
in_game_date: "August 11, 1814"
status: reviewed
documents:
  plan: "[[Session 01 - Arrival - Plan]]"
  wrap_up: "[[Chapter_01_Session_01_Wrap_Up]]"
scenes:
  - "[[The Churchyard Hour]]"
---

${HUB_BODY}`);
    write(vault, `${ch}/Sessions/Session 01/Chapter_01_Session_01_Wrap_Up.md`, `---
type: session_wrap
session: "[[Session 01 - Arrival]]"
session_number: 1
chapter: "[[Chapter 1 - Opening]]"
---

# Session 01 Wrap-Up

## Narrative Recap

The investigators reached the town at dusk and met [[Mrs Hale]] at the inn.

<!-- gm-only -->
## GM Notes

### Handoff

Prep the ball next.
<!-- /gm-only -->
`);
    // A recap written in the hub, with no Wrap-Up: the pre-#276 shape.
    write(vault, `${ch}/Sessions/Session 02/Session 02 - Departure.md`, `---
type: session
session_number: 2
chapter: "[[Chapter 1 - Opening]]"
play_date: "2026-01-10"
status: played
---

# Session 02 - Departure

## Narrative Recap

The coach left before dawn with [[Mrs Hale]] waving from the INNYARDWAVE porch.
`);
    write(vault, 'Characters/NPCs/Prepped Villain.md', '---\ntype: npc\n---\n\n# Prepped Villain\n\nA name on a list.\n');
    write(vault, 'Characters/NPCs/Mrs Hale.md', '---\ntype: npc\n---\n\n# Mrs Hale\n\nThe innkeeper.\n');

    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'Session Page Site',
      siteUrl: 'https://example.github.io/session-page',
      vaultPath: vault,
      outputDir: docs,
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { Chapters: 'chapters', 'Characters/NPCs': 'characters/npcs' },
    }, null, 2));
    build({ configPath });
  });

  after(() => fs.rmSync(work, { recursive: true, force: true }));

  describe('with a published Wrap-Up, the hub body is withheld', () => {
    const LEAKS = ['Keeper-only', 'Standing', 'Scene Index', 'Churchyard', 'contingency',
      'Prepped Villain', 'better at this', 'Baron', 'DRAFT pending', 'Plan'];

    it('the session page carries none of it', () => {
      const html = find('session-01-arrival.html');
      for (const leak of LEAKS) assert.ok(!html.includes(leak), `session page leaked "${leak}"`);
    });

    it('keeps the title, main wrapper and badge block exactly as the wiki page renders them', () => {
      const html = find('session-01-arrival.html');
      assert.match(html, /<main class="content">/);
      assert.match(html, /<h1 class="page-title">Session 01 - Arrival<\/h1>/);
      assert.ok(html.includes(badges('1', '2026-01-17', 'reviewed')), 'badge block changed');
    });

    it('shows the linked chapter and the in-game date', () => {
      const html = find('session-01-arrival.html');
      assert.match(html, /<a href="[^"]*chapter-1-opening\.html">Chapter 1 - Opening<\/a>/);
      assert.ok(html.includes('In-game: August 11, 1814'), 'missing in-game date');
    });

    it('shows the Wrap-Up recap opening with a link to the full session', () => {
      const html = find('session-01-arrival.html');
      assert.ok(html.includes('reached the town at dusk'), 'missing recap');
      assert.match(html, /<a class="recap-link" href="[^"]*chapter-01-session-01-wrap-up\.html">Read the full session/);
      assert.ok(!html.includes('Prep the ball'), 'Wrap-Up GM Notes leaked');
    });

    it('lists the NPCs the Wrap-Up names, not the ones the hub prepped', () => {
      const html = find('session-01-arrival.html');
      assert.ok(html.includes('NPCs Appearing'));
      assert.ok(html.includes('Mrs Hale'));
    });

    it('the search index carries none of it', () => {
      // Whole index terms, not substrings: the Wrap-Up's own "innkeeper" is fine.
      const terms = new Set(JSON.parse(read('search-index.json')).index.invertedIndex.map(e => e[0]));
      for (const term of ['keeper', 'standing', 'churchyard', 'contingency', 'baron']) {
        assert.ok(![...terms].some(t => t === term || t.startsWith(term + '-')), `search index leaked "${term}"`);
      }
    });

    it('a hub link to a prepped NPC creates no backlink', () => {
      assert.ok(!find('prepped-villain.html').includes('session-01-arrival'),
        'hub link became a "Mentioned in" backlink');
    });

    it('the landing quotes the Wrap-Up, never the hub', () => {
      const html = read('index.html');
      assert.ok(html.includes('reached the town at dusk'), 'landing should quote the Wrap-Up');
      assert.ok(!html.includes('Keeper-only') && !html.includes('better at this'));
    });

    it('no generated file anywhere carries it', () => {
      for (const f of walk(docs).filter(p => p.endsWith('.html') || p.endsWith('.json'))) {
        const text = fs.readFileSync(f, 'utf8');
        assert.ok(!text.includes('Keeper-only'), `${f} leaked "Keeper-only"`);
        assert.ok(!text.includes('better at this'), `${f} leaked hub prose`);
      }
    });
  });

  describe('with no Wrap-Up, the hub body publishes as before', () => {
    it('renders the body unchanged, with no generated recap', () => {
      const html = find('session-02-departure.html');
      assert.ok(html.includes('The coach left before dawn'), 'hub prose missing');
      assert.ok(!html.includes('session-recap') && !html.includes('session-facts'));
    });

    it('keeps the badge block byte-identical', () => {
      assert.ok(find('session-02-departure.html').includes(badges('2', '2026-01-10', 'played')));
    });

    it('stays in search and still creates backlinks', () => {
      assert.ok(read('search-index.json').toLowerCase().includes('innyardwav'), 'hub prose missing from search');
      assert.ok(find('mrs-hale.html').includes('session-02-departure'), 'hub link should backlink');
    });
  });
});

// Review of #276: two chapters each with a "Session 01 Wrap-Up.md", each hub linking
// [[Session 01 Wrap-Up]]. The Ch2 session page showed the Ch1 recap; the link must pair
// with the Wrap-Up in the hub's own chapter.
describe('same-titled Wrap-Ups in two chapters (#276 review)', () => {
  it('each session page shows its own chapter recap', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-dup-wrap-'));
    const vault = path.join(work, 'vault');
    const docs = path.join(work, 'docs');
    for (const c of [1, 2]) {
      write(vault, `Chapters/Ch${c}/Ch${c}.md`, `---\ntype: chapter\nsort_order: ${c}\n---\n\n# Ch${c}\n`);
      write(vault, `Chapters/Ch${c}/Session 01 - Ch${c} Start.md`, `---\ntype: session\nsession_number: 1\nchapter: "[[Ch${c}]]"\nstatus: reviewed\ndocuments:\n  wrap_up: "[[Session 01 Wrap-Up]]"\n---\n\nhub body\n`);
      write(vault, `Chapters/Ch${c}/Session 01 Wrap-Up.md`, `---\ntype: session_wrap\nchapter: "[[Ch${c}]]"\n---\n\n## Narrative Recap\n\nRECAP-OF-CHAPTER-${c}.\n`);
    }
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: docs, excludeDirs: ['_meta'], folderMap: { Chapters: 'chapters' } }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    for (const c of [1, 2]) {
      const html = fs.readFileSync(path.join(docs, `chapters/Ch${c}/session-01-ch${c}-start.html`), 'utf8');
      assert.deepStrictEqual(html.match(/RECAP-OF-CHAPTER-\d/g), [`RECAP-OF-CHAPTER-${c}`], `Ch${c}`);
      assert.doesNotMatch(html, /hub body/);
    }
    fs.rmSync(work, { recursive: true, force: true });
  });
});

// Final review of #276: the Saga, the landing recap and recency re-paired AFTER build.js
// had reduced every page's frontmatter to its published view, so excluding the very
// fields that pair a session (`documents`, `session`) dropped the Story unit, the landing
// recap and the recent-NPC mentions while the session page itself paired fine. The build
// now pairs once and hands the map to all of them.
describe('pairing survives excluded pairing fields (#276 final review)', () => {
  it('the Saga, landing recap and recency use the pair the page used', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-excluded-pair-'));
    const vault = path.join(work, 'vault');
    const docs = path.join(work, 'docs');
    write(vault, 'Chapters/Ch1/Ch1.md', '---\ntype: chapter\nsort_order: 1\n---\n\n# Ch1\n');
    write(vault, 'Chapters/Ch1/Session 01.md', '---\ntype: session\nsession_number: 1\nchapter: "[[Ch1]]"\nstatus: reviewed\nplay_date: "2026-01-17"\ndocuments:\n  wrap_up: "[[S1 Recap]]"\n---\n\nHUBBODY\n');
    write(vault, 'Chapters/Ch1/Wraps/S1 Recap.md', '---\ntype: session_wrap\nsession: "[[Session 01]]"\nchapter: "[[Ch1]]"\n---\n\n## Narrative Recap\n\nWRAPRECAP with [[Mrs Hale]].\n');
    write(vault, 'Characters/NPCs/Mrs Hale.md', '---\ntype: npc\n---\n\n# Mrs Hale\n\nThe innkeeper.\n');
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: docs, excludeDirs: ['_meta'], excludeFields: ['documents', 'session', 'aliases'],
      folderMap: { Chapters: 'chapters', 'Characters/NPCs': 'characters/npcs' } }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    const page = fs.readFileSync(path.join(docs, 'chapters/Ch1/session-01.html'), 'utf8');
    assert.match(page, /WRAPRECAP/, 'the session page pairs');
    assert.doesNotMatch(page, /HUBBODY/);
    const story = walk(path.join(docs, 'story')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
    assert.match(story, /WRAPRECAP/, 'the Saga keeps the session unit');
    const index = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
    const recap = index.slice(index.indexOf('Latest Session'));
    assert.match(recap, /WRAPRECAP/, 'the landing quotes the paired Wrap-Up');
    assert.match(index, /mrs-hale\.html/, 'recency counts the Wrap-Up\'s mentions');
    fs.rmSync(work, { recursive: true, force: true });
  });
});

// Final review of #276: a Wrap-Up's `session:` claim resolved against published hubs only,
// so Ch1's Wrap-Up (its own hub `publish: false`) took over Ch2's same-titled session.
describe('a claim on an unpublished hub never lands on another chapter (#276 final review)', () => {
  it("Ch2's session keeps its prose and never shows the Ch1 recap", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-cross-chapter-'));
    const vault = path.join(work, 'vault');
    const docs = path.join(work, 'docs');
    write(vault, 'Chapters/Ch1/Ch1.md', '---\ntype: chapter\nsort_order: 1\n---\n\n# Ch1\n');
    write(vault, 'Chapters/Ch2/Ch2.md', '---\ntype: chapter\nsort_order: 2\n---\n\n# Ch2\n');
    write(vault, 'Chapters/Ch1/Session 01.md', '---\ntype: session\nsession_number: 1\nchapter: "[[Ch1]]"\nstatus: reviewed\npublish: false\n---\n\nCH1HUB\n');
    write(vault, 'Chapters/Ch1/Session 01 Wrap-Up.md', '---\ntype: session_wrap\nsession: "[[Session 01]]"\nchapter: "[[Ch1]]"\nsession_number: 1\n---\n\n## Narrative Recap\n\nCH1RECAP\n');
    write(vault, 'Chapters/Ch2/Session 01.md', '---\ntype: session\nsession_number: 1\nchapter: "[[Ch2]]"\nstatus: played\nplay_date: "2026-03-01"\n---\n\n## Narrative Recap\n\nCH2PROSE\n');
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: docs, excludeDirs: ['_meta'], folderMap: { Chapters: 'chapters' } }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    const page = fs.readFileSync(path.join(docs, 'chapters/Ch2/session-01.html'), 'utf8');
    assert.match(page, /CH2PROSE/);
    assert.doesNotMatch(page, /CH1RECAP/);
    const index = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
    const recap = index.slice(index.indexOf('Latest Session'));
    assert.doesNotMatch(recap.slice(0, 2000), /CH1RECAP/, 'the landing does not borrow the Ch1 recap');
    fs.rmSync(work, { recursive: true, force: true });
  });
});

// Review of #278: every chapter page sits in one folder with the sessions below it, so
// folder containment says every chapter holds every session. The withheld-body page's
// "Chapter:" line named Ch1 for a Ch2 session. The session's own `chapter:` decides first.
describe('a session names its own chapter when every chapter shares a folder (#278 review)', () => {
  it('the Chapter: line, the Saga and prev/next follow the session\'s chapter: ref', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-flat-chapters-'));
    const vault = path.join(work, 'vault');
    const docs = path.join(work, 'docs');
    for (const c of [1, 2]) {
      write(vault, `Campaign/Chapter ${c}.md`, `---\ntype: chapter\nsort_order: ${c}\n---\n\n# Chapter ${c}\n`);
      write(vault, `Campaign/Sessions/Ch${c} Session 01.md`, `---\ntype: session\nsession_number: 1\nchapter: "[[Chapter ${c}]]"\nstatus: reviewed\ndocuments:\n  wrap_up: "[[Ch${c} S1 Wrap-Up]]"\n---\n\nhub body\n`);
      write(vault, `Campaign/Sessions/Ch${c} S1 Wrap-Up.md`, `---\ntype: session_wrap\nsession: "[[Ch${c} Session 01]]"\nchapter: "[[Chapter ${c}]]"\n---\n\n## Narrative Recap\n\nRECAP-${c}.\n`);
    }
    const configPath = path.join(work, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ siteTitle: 'T', siteUrl: 'https://x.example', vaultPath: vault,
      outputDir: docs, excludeDirs: ['_meta'], folderMap: { Campaign: 'campaign' } }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    const page = c => fs.readFileSync(walk(docs).find(f => path.basename(f) === `ch${c}-session-01.html`), 'utf8');
    for (const c of [1, 2]) {
      const chapterLine = page(c).match(/<span class="session-chapter">Chapter: <a [^>]*>([^<]*)<\/a>/);
      assert.ok(chapterLine, `Ch${c} session page has no Chapter: line`);
      assert.strictEqual(chapterLine[1], `Chapter ${c}`);
    }
    // One Saga unit per session, each under its own chapter (not both under Chapter 1).
    const story = walk(path.join(docs, 'story')).map(f => path.basename(f)).sort();
    assert.deepStrictEqual(story.filter(f => /session/.test(f)),
      ['chapter-1-ch1-session-01.html', 'chapter-2-ch2-session-01.html']);
    fs.rmSync(work, { recursive: true, force: true });
  });
});
