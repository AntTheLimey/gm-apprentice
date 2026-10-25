'use strict';
// A container prop (a bookshelf, a briefcase) gets a page listing what it holds: the items the
// players have, linked; with show_sealed: titles, the title alone of each they have not found.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');

const STYLE = {
  '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}<div class="held">{{{items}}}</div>',
  '_meta/prop-styles/t/style.css': '.held { color: red; }\n',
};
const NOTES = {
  ...STYLE,
  'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n---\nA tall shelf in the study.\n\n## The Text\n\nDusty spines line every board.\n',
  'Documents/Diary.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nprop_line: Kept by the vicar\nrevealed_in: "[[Session 14]]"\n---\nA diary.\n',
  'Documents/Letter.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nprop_style: t\nprop_line: Quietly folded twice\n---\nWhispered sentence about the heir.\n\n## The Text\n\nUnseen words of the letter.\n',
  'Documents/Ledger.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nwithheld: true\n---\nA ledger of debts.\n',
  'Documents/Briefcase.md': '---\ntype: prop\nprop_kind: container\nprop_style: t\n---\nA battered briefcase.\n',
  'Documents/Map.md': '---\ntype: prop\nprop_container: [[Briefcase]]\n---\nA map.\n',
  'Sessions/Session 14.md': '---\ntype: session\nsession_number: 14\nstatus: played\n---\nThe study.\n',
  '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Bookshelf.md', 'Documents/Diary.md', 'Documents/Briefcase.md', 'Documents/Map.md', 'Sessions/Session 14.md'] }),
};
const rels = (site) => site.files().map((f) => path.relative(site.dir, f).split(path.sep).join('/'));

describe('container pages', () => {
  const s = buildBoth(NOTES);
  after(() => s.cleanup());

  it('a container page is at its address with its items', () => {
    const page = s.player.read('props', 'bookshelf.html');
    assert.match(page, /<h1 class="page-title">Bookshelf<\/h1>/);
    assert.match(page, /<a href="\.\.\/documents\/bookshelf\.html">&larr; Bookshelf<\/a>/);
    assert.match(page, /Dusty spines line every board\./);
    assert.match(page, /<a class="nav-|<nav/, 'the site shell');
    const session = rels(s.player).find((r) => /session-14\.html$/.test(r));
    assert.ok(session, rels(s.player).join(', '));
    assert.match(page, new RegExp(`<li class="prop-item"><a href="\\.\\./documents/diary\\.html">Diary</a> <span class="prop-line">Kept by the vicar</span> <span class="prop-arrived">Arrived in <a href="\\.\\./${session.replace(/\./g, '\\.')}">Session 14</a></span></li>`));
    assert.match(page, /<li class="prop-item prop-sealed"><span class="prop-title">Letter<\/span> <span class="prop-seal">Sealed<\/span><\/li>/);
    assert.match(s.player.read('documents', 'bookshelf.html'), /<a class="prop-btn" href="\.\.\/props\/bookshelf\.html">See the prop<\/a>/);
  });

  it('the sealed item ships nothing but its title, and the withheld item nothing at all', () => {
    assert.ok(!s.player.exists('props', 'letter.html'));
    for (const f of s.player.files()) {
      const text = fs.readFileSync(f, 'utf8');
      for (const leak of [/props\/letter\.html|letter\.html/, /Quietly folded/, /Whispered sentence/, /Unseen words/, /Ledger/, /ledger/]) {
        assert.doesNotMatch(text, leak, `${path.relative(s.player.dir, f)}: ${leak}`);
      }
    }
  });

  it('a styled container fills its layout with its items, with no The Text needed', () => {
    const page = s.player.read('props', 'briefcase.html');
    assert.match(page, /<h1>Briefcase<\/h1>/);
    assert.match(page, /<div class="held"><ul class="prop-list">\n<li class="prop-item"><a href="\.\.\/documents\/map\.html">Map<\/a><\/li>\n<\/ul><\/div>/);
    assert.match(page, /<link rel="stylesheet" href="styles\/t\/style\.css">/);
    assert.ok(!s.logs.some((l) => /Briefcase/.test(l)), s.logs.join('\n'));
  });

  it('the GM site lists every item and marks the unrevealed', () => {
    const page = s.gm.read('props', 'bookshelf.html');
    assert.match(page, /<a href="\.\.\/documents\/diary\.html">Diary<\/a> <span class="prop-line">Kept by the vicar<\/span>/);
    assert.doesNotMatch(page, /Diary<\/a>[^\n]*not yet revealed/);
    assert.match(page, /<a href="letter\.html">Letter<\/a> <span class="prop-line">Quietly folded twice<\/span> <span class="gm-unrevealed">not yet revealed<\/span>/);
    assert.doesNotMatch(page, /prop-sealed/);
  });
});

describe('a container with nothing in it, and an item in a non-container', () => {
  const s = buildBoth({
    'Documents/Chest.md': '---\ntype: prop\nprop_kind: container\n---\nAn empty chest.\n',
    'Documents/Desk.md': '---\ntype: document\n---\nA desk.\n',
    'Documents/Pen.md': '---\ntype: prop\nprop_container: "[[Desk]]"\n---\nA pen.\n',
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('says it holds nothing yet', () => {
    assert.match(s.player.read('props', 'chest.html'), /<p class="prop-empty">Nothing in it yet\.<\/p>/);
  });

  it('warns about the item, which is listed on its own', () => {
    assert.ok(s.logs.some((l) => l.includes('Documents/Pen.md: prop_container names "Desk", which is not a container prop; it is listed on its own — make "Desk" a container (prop_kind: container), or correct prop_container')), s.logs.join('\n'));
  });
});

describe('a hidden prop_title on a sealed item', () => {
  const s = buildBoth({
    'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n---\nA shelf.\n',
    'Documents/Letter.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nprop_title: From Lady Anne\n---\nA letter.\n',
    '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Bookshelf.md'] }),
  }, { sites: ['player'], player: { hide: { fields: ['prop_title'] } } });
  after(() => s.cleanup());

  it('lists the display title, never the hidden one', () => {
    const page = s.player.read('props', 'bookshelf.html');
    assert.match(page, /<span class="prop-title">Letter<\/span>/);
    for (const f of s.player.files()) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Lady Anne/, f);
  });
});

// Ruling 19: on the GM site a withheld note's name (an item's, or a container's) carries the usual
// withheld_names mark, and with gm_site.show.withheld_names off reads as players would see it.
const WITHHELD = {
  'Documents/Vault Box.md': '---\ntype: prop\nprop_kind: container\nwithheld: true\n---\nA box.\n',
  'Documents/Coin.md': '---\ntype: prop\nprop_container: "[[Vault Box]]"\n---\nA coin.\n',
  'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\n---\nA shelf.\n',
  'Documents/Ledger.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nwithheld: true\n---\nA ledger.\n',
  '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Bookshelf.md', 'Documents/Coin.md'] }),
};
const MARK = (name) => `<span class="gm-mark gm-mark--withheld_names" data-gm-kind="withheld_names" data-gm-label="players see: something">${name}</span>`;

describe('withheld names on the GM site', () => {
  it('carry the withheld mark', () => {
    const s = buildBoth(WITHHELD);
    try {
      const shelf = s.gm.read('props', 'bookshelf.html');
      assert.ok(shelf.includes(`<a href="../documents/ledger.html">${MARK('Ledger')}</a> <span class="gm-unrevealed">not yet revealed</span>`), shelf);
      const box = s.gm.read('props', 'vault-box.html');
      assert.ok(box.includes(`<h1 class="page-title">${MARK('Vault Box')}</h1>`), box);
      assert.ok(box.includes(`&larr; ${MARK('Vault Box')}</a>`), box);
      assert.match(box, /<title>Vault Box — T<\/title>/);
      assert.doesNotMatch(s.player.read('props', 'bookshelf.html'), /Ledger|something/);
    } finally { s.cleanup(); }
  });

  it('read as players see them when withheld_names is off', () => {
    const s = buildBoth(WITHHELD, { gm: { show: { withheld_names: false } } });
    try {
      const shelf = s.gm.read('props', 'bookshelf.html');
      assert.match(shelf, /<a href="\.\.\/documents\/ledger\.html">something<\/a> <span class="gm-unrevealed">not yet revealed<\/span>/);
      assert.doesNotMatch(shelf, /Ledger<|gm-mark--withheld_names/);
      const box = s.gm.read('props', 'vault-box.html');
      assert.match(box, /<h1 class="page-title">something<\/h1>/);
      assert.doesNotMatch(box, /gm-mark--withheld_names/);
    } finally { s.cleanup(); }
  });
});

describe('a container whose style has no place for its list', () => {
  const s = buildBoth({
    'Documents/Chest.md': '---\ntype: prop\nprop_kind: container\nprop_style: scroll\n---\nA chest.\n',
    'Documents/Coin.md': '---\ntype: prop\nprop_container: "[[Chest]]"\n---\nA coin.\n',
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('gets the site\'s own page and a warning row', () => {
    const page = s.player.read('props', 'chest.html');
    assert.match(page, /<h1 class="page-title">Chest<\/h1>/);
    assert.match(page, /<a href="\.\.\/documents\/coin\.html">Coin<\/a>/);
    assert.match(page, /<link rel="stylesheet" href="\.\.\/css\/style\.css">/);
    assert.ok(!s.player.exists('props', 'styles', 'scroll'), 'no style files on its account');
    assert.ok(s.logs.some((l) => l.includes('Documents/Chest.md: the style "scroll" has no {{{items}}} place, so the container\'s page uses the site\'s own look — use a style made for containers, or remove prop_style from the container')), s.logs.join('\n'));
  });
});

describe('a style that lists the items on its sheet', () => {
  const s = buildBoth({
    '_meta/prop-styles/s/layout.html': '<main class="s">{{{body}}}</main>',
    '_meta/prop-styles/s/sheet.html': '<section class="sheet">{{{text}}}<div class="held">{{{items}}}</div></section>',
    '_meta/prop-styles/s/style.css': '.s { color: red; }\n',
    'Documents/Chest.md': '---\ntype: prop\nprop_kind: container\nprop_style: s\n---\nA chest.\n',
    'Documents/Coin.md': '---\ntype: prop\nprop_container: "[[Chest]]"\n---\nA coin.\n',
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('fills one sheet with them, though the container has no words', () => {
    const page = s.player.read('props', 'chest.html');
    assert.equal((page.match(/<section class="sheet">/g) || []).length, 1);
    assert.match(page, /<div class="held"><ul class="prop-list">\n<li class="prop-item"><a href="\.\.\/documents\/coin\.html">Coin<\/a><\/li>/);
    assert.ok(!s.logs.some((l) => /Chest/.test(l)), s.logs.join('\n'));
  });
});

describe('a stub item (Ruling 20)', () => {
  const s = buildBoth({
    'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\n---\nA shelf.\n',
    'Documents/Diary.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\npublish: stub\nprop_line: STUBLINE\nrevealed_in: "[[Session 2]]"\n---\nA diary.\n',
    'Sessions/Session 2.md': '---\ntype: session\nsession_number: 2\nstatus: played\n---\nPlayed.\n',
  }, { sites: ['player'] });
  after(() => s.cleanup());

  it('is its title linking its stub page, with no line and no session', () => {
    const page = s.player.read('props', 'bookshelf.html');
    assert.match(page, /<li class="prop-item"><a href="\.\.\/documents\/diary\.html">Diary<\/a><\/li>/);
    for (const f of s.player.files()) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /STUBLINE/, f);
  });
});
