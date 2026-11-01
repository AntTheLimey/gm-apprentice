'use strict';
// The leak gate reads more of the site (#508, #515): a page in another encoding, the files a held prop page links, a
// word-less SVG prop, and the links a page makes by srcset, CSS url() and a rooted address on a project site.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { listFileText } = require('../helpers/publish-list');
const { runLeakGate } = require('../../lib/leak-gate');

const HELD = 'Only the vicar of Sainte Hélène knows the crypt is empty.';
const PROP = (file = 'inv.html', extra = '') => `---\ntype: prop\nprop_file: ${file}\n${extra}---\nA paper.\n`;
const PAGE = (text = `<p>${HELD}</p>`) => `<!doctype html><html><head><link rel="stylesheet" href="props.css"></head><body><h1>Card</h1>${text}<img src="keeper-map.png" alt=""></body></html>`;
const CSS = 'body { color: #432; }\n';
// Bytes no text reader finds words in: a picture.
const MAP = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const SECRET = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7, 7, 7, 7]);
const PAPER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9, 9]);
const LIST = (publishing) => ({ '_meta/publish-list.yaml': listFileText({ publishing }) });
const OTHER = { 'Documents/Other.md': '---\ntype: document\n---\nOther.\n' };
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
const pick = (f) => ({ code: f.code, page: f.page, note: f.note });
const within = (fn, ...args) => { const s = leakSite(...args); try { return fn(s); } finally { s.cleanup(); } };
const write = (s, rel, data) => {
  const full = path.join(s.outputDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
};
const HELD_VAULT = (extra = {}) => ({
  'Documents/Invitation.md': PROP(), 'Documents/inv.html': PAGE(), 'Documents/props.css': CSS, 'Documents/keeper-map.png': MAP,
  ...OTHER, ...LIST(['Documents/Other.md']), ...extra,
});

describe('leak gate: a site file in another encoding (#508)', () => {
  it("an edited windows-1252 copy of a held prop's page is hidden text", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/inv.html', Buffer.from(`<html><body><p>Edited.</p><p>${HELD}</p></body></html>`, 'latin1'));
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/inv.html', note: 'Documents/Invitation.md' }]);
  }, HELD_VAULT()));

  it('a windows-1252 page of ordinary words is no finding', () => within((s) => {
    write(s, 'gazetteer/cafe.html', Buffer.from('<html><body><p>The café on the corner sells crêpes all day long.</p></body></html>', 'latin1'));
    assert.deepEqual(gate(s).findings, []);
    assert.deepEqual(gate(s).warnings, []);
  }, HELD_VAULT()));

  it("a copy of a held prop's words in UTF-16 with no byte-order mark is read, in a page or any text file", () => within((s) => {
    for (const [rel, le] of [['gazetteer/notes.html', true], ['gazetteer/notes.txt', true], ['gazetteer/be.txt', false]]) {
      const text = rel.endsWith('.html') ? `<html><body><p>${HELD}</p></body></html>` : `${HELD}\n`;
      write(s, rel, le ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'utf16le').swap16());
    }
    const result = gate(s);
    assert.deepEqual(result.findings.map(pick), ['gazetteer/be.txt', 'gazetteer/notes.html', 'gazetteer/notes.txt']
      .map((page) => ({ code: 'HIDDEN_TEXT', page, note: 'Documents/Invitation.md' })));
    assert.deepEqual(result.warnings, []);
  }, HELD_VAULT()));

  it('any text file left with NUL characters is a warning that words may be missed; an ordinary one is not', () => within((s) => {
    // NULs side by side, not on alternate bytes: no UTF-16 to read.
    write(s, 'gazetteer/odd.json', Buffer.from('{"a": "x\u0000\u0000yz"}'));
    write(s, 'gazetteer/plain.txt', 'Nothing odd here at all.\n');
    const result = gate(s);
    assert.equal(result.warnings.length, 1, JSON.stringify(result.warnings));
    assert.match(result.warnings[0], /gazetteer\/odd\.json/);
    assert.match(result.warnings[0], /NUL/);
    assert.match(result.warnings[0], /may be missed/);
  }, HELD_VAULT()));
});

describe("leak gate: the files a held prop page links (#508)", () => {
  // The build empties the site folder but its kept folders: only there can a hand copy outlive a build.
  const KEPT = { player: { keep: ['gazetteer'] } };
  it('its picture and its stylesheet, copied by hand, are PROP_UNREVEALED', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/m.png', MAP);
    write(s, 'gazetteer/look.css', CSS);
    const found = gate(s).findings;
    assert.deepEqual(found.map(pick), [
      { code: 'PROP_UNREVEALED', page: 'gazetteer/look.css', note: 'Documents/Invitation.md' },
      { code: 'PROP_UNREVEALED', page: 'gazetteer/m.png', note: 'Documents/Invitation.md' },
    ]);
    for (const f of found) assert.equal(f.reason, 'a file the prop page of a note the site does not publish links');
  }, HELD_VAULT(), KEPT));

  it('outside a kept folder its bytes are not watched (the build writes everything there)', () => within((s) => {
    write(s, 'loose/m.png', MAP);
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT(), KEPT));

  it('a picture linked only inside its Keeper block is watched too', () => within((s) => {
    write(s, 'gazetteer/s.png', SECRET);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'gazetteer/s.png', note: 'Documents/Invitation.md' }]);
  }, HELD_VAULT({ 'Documents/inv.html': PAGE(`<p>${HELD}</p><!-- gm-only --><img src="secret.png" alt=""><!-- /gm-only -->`), 'Documents/secret.png': SECRET }), KEPT));

  it('an empty file it links is not watched (every site has an empty .nojekyll)', () => within((s) => {
    write(s, 'gazetteer/.keep', '');
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({ 'Documents/inv.html': PAGE().replace('</body>', '<script src="extra.js"></script></body>'), 'Documents/extra.js': '' }), KEPT));

  it('a file it links that cannot be read stops the check', (t) => {
    if (process.getuid && process.getuid() === 0) { t.skip('root reads any file'); return; }
    within((s) => {
      const file = path.join(s.root, 'vault', 'Documents', 'keeper-map.png');
      fs.chmodSync(file, 0o000);
      try {
        assert.throws(() => gate(s), /Leak check: .*keeper-map\.png.*could not be read/);
      } finally { fs.chmodSync(file, 0o644); }
    }, HELD_VAULT(), KEPT);
  });

  const PICTURES = [
    ['a section banner', { 'Documents/_banner.png': MAP, 'Documents/inv.html': PAGE().replace('keeper-map.png', '_banner.png') }, {}],
    ['the campaign image', {}, { theme: { campaign_image: 'Documents/keeper-map.png' } }],
    ['the default page banner', { '_attachments/hdr.png': MAP }, { theme: { page_banner: '_attachments/hdr.png' } }],
  ];
  for (const [what, extra, player] of PICTURES) {
    it(`the build's own copy of the same picture as ${what} is no finding`, () => within((s) => {
      assert.deepEqual(gate(s).findings, []);
    }, HELD_VAULT(extra), { player: { ...KEPT.player, ...player } }));
  }

  it('a file a shipping prop also ships, with the same bytes, is no finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'keeper-map.png')));
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'props.css')));
    assert.deepEqual(gate(s).findings, []);
    // And copied elsewhere by hand: the shipping prop's file, already on the site.
    write(s, 'gazetteer/m.png', MAP);
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({
    'Letters/Card.md': PROP('card.html'), 'Letters/card.html': '<html><head><link rel="stylesheet" href="props.css"></head><body><p>Hello.</p><img src="keeper-map.png" alt=""></body></html>',
    'Letters/props.css': CSS, 'Letters/keeper-map.png': MAP,
    ...LIST(['Documents/Other.md', 'Letters/Card.md']),
  }), KEPT));

  it("the build's own copy of the same picture, used by a published page, is no finding", () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'images', 'keeper-map.png')));
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({
    '_attachments/keeper-map.png': MAP,
    'Documents/Other.md': '---\ntype: document\n---\nOther.\n\n![[keeper-map.png]]\n',
  }), KEPT));

  // A stylesheet or letterhead reused across props: in a kept folder, the same bytes as a held page's own copy.
  const ASSETS = { player: { keep: ['assets'] } };
  it('a kept file with the bytes a held page links is PROP_UNREVEALED when nothing published shows those bytes', () => within((s) => {
    write(s, 'assets/props.css', CSS);
    write(s, 'assets/paper.png', MAP);
    assert.deepEqual(gate(s).findings.map(pick), [
      { code: 'PROP_UNREVEALED', page: 'assets/paper.png', note: 'Documents/Invitation.md' },
      { code: 'PROP_UNREVEALED', page: 'assets/props.css', note: 'Documents/Invitation.md' },
    ]);
  }, HELD_VAULT(), ASSETS));

  it('a kept file with bytes a shipping prop also ships is no finding', () => within((s) => {
    write(s, 'assets/props.css', CSS);
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({
    'Letters/Card.md': PROP('card.html'), 'Letters/card.html': '<html><head><link rel="stylesheet" href="props.css"></head><body><p>Hello.</p></body></html>',
    'Letters/props.css': CSS, ...LIST(['Documents/Other.md', 'Letters/Card.md']),
  }), ASSETS));

  it('a kept file with the bytes of a picture a published page shows is no finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'images', 'keeper-map.png')));
    write(s, 'assets/paper.png', MAP);
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({
    '_attachments/keeper-map.png': MAP,
    'Documents/Other.md': '---\ntype: document\n---\nOther.\n\n![[keeper-map.png]]\n',
  }), ASSETS));

  it("a font a held prop links is not watched", () => within((s) => {
    write(s, 'gazetteer/hand.woff2', Buffer.from('wOF2 font bytes'));
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT({
    'Documents/inv.html': PAGE().replace('</head>', '<style>@font-face { font-family: H; src: url("hand.woff2"); }</style></head>'),
    'Documents/hand.woff2': Buffer.from('wOF2 font bytes'),
  }), KEPT));
});

describe('leak gate: a word-less SVG prop (#508)', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L10 10 Z"/></svg>\n';
  it('a held one copied by hand is PROP_UNREVEALED', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'maps/m.svg', SVG);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'maps/m.svg', note: 'Documents/Map.md' }]);
  }, { 'Documents/Map.md': PROP('map.svg'), 'Documents/map.svg': SVG, ...OTHER, ...LIST(['Documents/Other.md']) }));

  it('another word-less SVG on the site is no finding', () => within((s) => {
    write(s, 'maps/m.svg', SVG.replace('M0 0', 'M1 1'));
    assert.deepEqual(gate(s).findings, []);
  }, { 'Documents/Map.md': PROP('map.svg'), 'Documents/map.svg': SVG, ...OTHER, ...LIST(['Documents/Other.md']) }));
});

describe('leak gate: more ways a page links a held prop (#515)', () => {
  const PICTURE = { 'Documents/Map.md': PROP('map.png'), 'Documents/map.png': MAP, ...OTHER, ...LIST(['Documents/Other.md']) };
  const linking = (s, html) => leakInto(s.outputDir, 'documents/other.html', html);
  const CASES = [
    ['a srcset candidate', '<img srcset="../props/other.png 1x, ../props/map.png 2x" alt="">', '<img srcset="../props/other.png 1x, ../props/also.png 2x" alt="">'],
    ['a style attribute url()', '<span style="background: url(\'../props/map.png\')">x</span>', '<span style="background: url(\'../props/paper.png\')">x</span>'],
    ['an <object data>', '<object data="../props/map.png"></object>', '<object data="../props/paper.png"></object>'],
    ['a <video poster>', '<video poster="../props/map.png"></video>', '<video poster="../props/paper.png"></video>'],
    ['a <style> block url()', '<style>.m { background: url(../props/map.png); }</style>', '<style>.m { background: url(../props/paper.png); }</style>'],
  ];
  for (const [what, held, harmless] of CASES) {
    it(`${what} to a held prop's address is PROP_UNREVEALED, and to another file is not`, () => within((s) => {
      linking(s, harmless);
      assert.deepEqual(gate(s).findings, []);
      linking(s, held);
      assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'documents/other.html', note: 'Documents/Map.md' }]);
    }, PICTURE));
  }

  it("a stylesheet's url() and @import to a held prop's address are PROP_UNREVEALED; its other links are not", () => within((s) => {
    write(s, 'gazetteer/look.css', '@import "../fonts/x.css";\n.a { background: url("../images/paper.png"); }\n');
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/look.css', '.a { background: url("../props/map.png"); }\n');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'gazetteer/look.css', note: 'Documents/Map.md' }]);
  }, PICTURE));

  it("a rooted link under a project site's path is read from the site's top", () => within((s) => {
    linking(s, '<a href="/campaign/documents/other.html">Other</a>');
    assert.deepEqual(gate(s).findings, []);
    linking(s, '<a href="/campaign/props/map.png">Map</a>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'documents/other.html', note: 'Documents/Map.md' }]);
  }, PICTURE, { player: { url: 'https://ant.github.io/campaign/' } }));

  it('a rooted link on a site at the top of its host is read as before', () => within((s) => {
    linking(s, '<a href="/props/map.png">Map</a>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'documents/other.html', note: 'Documents/Map.md' }]);
  }, PICTURE, { player: { url: 'https://campaign.pages.dev' } }));
});
