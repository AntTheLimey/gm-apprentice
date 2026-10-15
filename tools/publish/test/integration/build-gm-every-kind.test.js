'use strict';
// tools/publish/test/integration/build-gm-every-kind.test.js
// Every way a thing is kept off the player site, built both ways: each hidden word is in no player file, and on the
// GM site it is inside a mark of the right kind. No mark reaches the player site.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth, markedTexts } = require('../helpers/gm-build');

const TOKENS = /[-]/;

const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nPublic.\n\n## GM Notes\n\nHIDSECTION here.\n\n### Deeper\n\nHIDNESTED here.\n\n## Open\n\nSHOWNOPEN.\n',
  'NPCs/Fields.md': '---\ntype: npc\nsecrets: HIDFIELD\npublish_exclude_fields: [occupation]\noccupation: HIDOWNFIELD\nrelationships:\n  - target: "[[Sections]]"\n    type: serves\n    description: HIDEDGE\n    gm_only: true\n---\nBody.\n',
  'NPCs/Blocks.md': '---\ntype: npc\n---\nA <!-- gm-only -->HIDINLINE<!-- /gm-only --> b.\n\n<!-- spoiler -->\nHIDSPOILER\n<!-- /spoiler -->\n\nLead <!-- gm-only -->HIDMIDLINE\nstill hidden\n<!-- /gm-only --> tail.\n',
  'NPCs/Callout.md': '---\ntype: npc\n---\nText.\n\n> [!secret] Keeper\n> HIDCALLOUT\n\nAfter.\n',
  'NPCs/Comments.md': '---\ntype: npc\n---\nA <!-- HIDHTMLCOMMENT --> b %% HIDOBSIDIAN %% c.\n',
  'NPCs/Vesper.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nHIDWITHHELDPAGE.\n',
  'NPCs/Linker.md': '---\ntype: npc\n---\nShe met [[Vesper]] at the quay.\n',
  'NPCs/Lord Vane.md': '---\ntype: npc\ngm_aliases: [Elias Crowe]\n---\nA lord.\n',
  'NPCs/AliasUser.md': '---\ntype: npc\n---\nThey whisper of [[Elias Crowe]].\n',
  'NPCs/Draft.md': '---\ntype: npc\nstatus: planned\n---\nHIDPREP.\n',
  'NPCs/Stub.md': '---\ntype: npc\npublish: stub\npublish_include_sections: [Overview]\n---\n## Overview\n\nSHOWNSTUB.\n\n## Plans\n\nHIDSTUB.\n',
  'NPCs/Forged.md': '---\ntype: npc\n---\nForged 0HIDFORGE text.\n',
  'PCs/Ann.md': '---\ntype: pc\n---\n# Ann\n\n## Background\n\nSHOWNBG.\n\n## GM Notes\n\nHIDPC\n\n## Background Two\n\nSHOWNPCAFTER.\n',
};
// word -> the kind of mark it must sit in on the GM site, and the page it is on.
const EXPECT = [
  ['HIDSECTION', 'sections', 'npcs/sections.html'],
  ['HIDNESTED', 'sections', 'npcs/sections.html'],
  ['HIDFIELD', 'fields', 'npcs/fields.html'],
  ['HIDOWNFIELD', 'fields', 'npcs/fields.html'],
  ['HIDEDGE', 'relationships', 'npcs/fields.html'],
  ['HIDINLINE', 'gm_only_blocks', 'npcs/blocks.html'],
  ['HIDMIDLINE', 'gm_only_blocks', 'npcs/blocks.html'],
  ['HIDSPOILER', 'spoilers', 'npcs/blocks.html'],
  ['HIDCALLOUT', 'callouts', 'npcs/callout.html'],
  ['HIDSTUB', 'sections', 'npcs/stub.html'],
  ['HIDPC', 'sections', 'pcs/ann.html'],
];

describe('one of every hidden kind, both ways', () => {
  let site;
  before(() => { site = buildBoth(NOTES, { player: { hide: { callouts: true } }, gm: { show: { comments: true } } }); });
  after(() => site.cleanup());

  const FORGED = 'npcs/forged.html';
  // The forged note's own text holds private-use characters; the player build leaves a note's text as written, and no
  // mark renderer runs there. This is everything the player site wrote except that note's own output.
  const playerText = ({ withoutForged = false } = {}) => {
    const files = site.player.files();
    assert.ok(files.length > 0, 'the player build wrote files');
    return files.map((f) => {
      const rel = path.relative(site.player.dir, f).split(path.sep).join('/');
      const text = fs.readFileSync(f, 'utf8');
      if (!withoutForged) return text;
      if (rel === FORGED) return '';
      if (rel === 'previews.json') {
        const j = JSON.parse(text);
        delete j[FORGED];
        return JSON.stringify(j);
      }
      if (rel === 'search-index.json') {
        const j = JSON.parse(text);
        for (const [id, d] of Object.entries(j.documents)) if (d.href === FORGED) delete j.documents[id];
        j.index.invertedIndex = j.index.invertedIndex.filter(([term]) => !TOKENS.test(term));
        return JSON.stringify(j);
      }
      return text;
    }).join('\n');
  };

  it('no hidden word, mark, band or token reaches the player site', () => {
    const all = playerText({ withoutForged: true });
    for (const [word] of EXPECT) assert.equal(all.includes(word), false, word);
    for (const w of ['HIDHTMLCOMMENT', 'HIDOBSIDIAN', 'HIDWITHHELDPAGE', 'HIDPREP', 'Elias Crowe']) assert.equal(all.includes(w), false, w);
    assert.doesNotMatch(all, /gm-mark|gm-band|gm-apprentice-build/);
    assert.doesNotMatch(all, TOKENS);
  });

  it('a note\'s own private-use characters reach the player site only in that note, as written', () => {
    const html = site.player.read('npcs', 'forged.html');
    assert.ok(html.includes('Forged 0HIDFORGE text.'));
    assert.doesNotMatch(html, /gm-mark|�/);
    for (const rel of ['previews.json', 'search-index.json']) {
      assert.match(site.player.read(rel), TOKENS, rel); // the forged note's own entry
    }
    // and nowhere else: every other player file is clean (checked above with the forged note's entries removed)
    for (const f of site.player.files()) {
      if (path.relative(site.player.dir, f).split(path.sep).join('/') === FORGED) continue;
      if (/\.json$/.test(f)) continue;
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), TOKENS, f);
    }
  });

  it('what players see is on both sites, outside any mark', () => {
    for (const [word, page] of [['SHOWNOPEN', 'npcs/sections.html'], ['SHOWNSTUB', 'npcs/stub.html'], ['SHOWNBG', 'pcs/ann.html'], ['SHOWNPCAFTER', 'pcs/ann.html']]) {
      assert.ok(site.player.read(...page.split('/')).includes(word), `player ${word}`);
      const gm = site.gm.read(...page.split('/'));
      assert.ok(gm.includes(word), `gm ${word}`);
      assert.equal(markedTexts(gm).some((m) => m.kind !== 'notes' && m.text.includes(word)), false, `unmarked ${word}`);
    }
  });

  for (const [word, kind, page] of EXPECT) {
    it(`${word} is on the GM site inside a ${kind} mark`, () => {
      const marks = markedTexts(site.gm.read(...page.split('/')));
      assert.ok(marks.some((m) => m.kind === kind && m.text.includes(word)), JSON.stringify(marks.map((m) => [m.kind, m.text.slice(0, 40)])));
    });
  }

  it('comments, switched on, are marked', () => {
    const marks = markedTexts(site.gm.read('npcs', 'comments.html'));
    assert.ok(marks.some((m) => m.kind === 'comments' && m.text.includes('HIDHTMLCOMMENT')));
    assert.ok(marks.some((m) => m.kind === 'comments' && m.text.includes('HIDOBSIDIAN')));
  });

  it('a withheld name is shown, marked with what players see', () => {
    const marks = markedTexts(site.gm.read('npcs', 'linker.html'));
    assert.ok(marks.some((m) => m.kind === 'withheld_names' && m.text.includes('Vesper') && m.label === 'players see: someone'));
    assert.match(site.player.read('npcs', 'linker.html'), /someone/);
  });

  it('a secret alias is shown, marked with the name players see', () => {
    const marks = markedTexts(site.gm.read('npcs', 'aliasuser.html'));
    assert.ok(marks.some((m) => m.kind === 'fields' && m.text.includes('Elias Crowe') && /players see: Lord Vane/.test(m.label)));
  });

  it('pages players do not see are on the GM site with a band', () => {
    for (const [page, reason] of [['npcs/vesper.html', 'publish: false'], ['npcs/draft.html', 'status: planned']]) {
      const marks = markedTexts(site.gm.read(...page.split('/')));
      assert.ok(marks.some((m) => m.kind === 'notes' && m.label.includes(reason)), page);
      assert.equal(site.player.exists(...page.split('/')), false, page);
    }
  });

  it('a note cannot forge a mark', () => {
    const html = site.gm.read('npcs', 'forged.html');
    assert.equal(markedTexts(html).some((m) => m.text.includes('HIDFORGE')), false);
    assert.match(html, /�/);
  });

  it('every GM page is well nested', () => {
    const pages = site.gm.files().filter((x) => x.endsWith('.html'));
    assert.ok(pages.length > 0, 'the GM build wrote pages');
    for (const f of pages) {
      const html = fs.readFileSync(f, 'utf8');
      for (const tag of ['div', 'span', 'aside']) {
        assert.equal((html.match(new RegExp(`<${tag}\\b`, 'g')) || []).length, (html.match(new RegExp(`</${tag}>`, 'g')) || []).length, `${f} ${tag}`);
      }
      assert.doesNotMatch(html, TOKENS, f);
    }
  });

  it('the GM search index and link cards hold the hidden words with no tokens', () => {
    const index = site.gm.read('search-index.json');
    assert.match(index, /hidsection/i); // the search library stores words in lower case
    assert.doesNotMatch(index + (site.gm.exists('previews.json') ? site.gm.read('previews.json') : ''), TOKENS);
  });

  it('a kind switched off is stripped on the GM site as on the player site', () => {
    const off = buildBoth(NOTES, { player: { hide: { callouts: true } }, gm: { show: { spoilers: false } }, sites: ['gm'] });
    try { assert.equal(off.gm.read('npcs', 'blocks.html').includes('HIDSPOILER'), false); } finally { off.cleanup(); }
  });
});
