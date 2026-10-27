'use strict';
// The leak gate and the pages the tool makes for props: a styled page, a container page and the props page are read as
// ordinary pages (their words are their notes' published words). A held made prop's address is watched. The one new
// allowance: a sealed item's title, on its own container's page and on the props page, and nowhere else.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { listFileText } = require('../helpers/publish-list');
const { runLeakGate } = require('../../lib/leak-gate');

const STYLE = {
  '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}<div class="held">{{{items}}}</div>',
  '_meta/prop-styles/t/style.css': '.held { color: red; }\n',
};
const GM_NOTE = 'The gardener is the true heir of the house.';
const SEALED_BODY = 'The heir hides beneath the old mill wheel.';
const LETTER = (extra = '') => `---\ntype: prop\nprop_style: t\n${extra}---\nA note.\n\n## The Text\n\nCome to the garden at nine sharp.\n\n## GM Notes\n\n${GM_NOTE}\n`;
const OTHER = { 'Documents/Other.md': '---\ntype: document\n---\nOther.\n' };
const LIST = (publishing) => ({ '_meta/publish-list.yaml': listFileText({ publishing }) });
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
const pick = (f) => ({ code: f.code, page: f.page, note: f.note });
const within = (fn, ...args) => { const s = leakSite(...args); try { return fn(s); } finally { s.cleanup(); } };
const write = (s, rel, data) => {
  const full = path.join(s.outputDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
};
// A built page with a sentence added before </body> (a styled page has no <main>).
function leakBeforeBody(s, rel, sentence) {
  const file = path.join(s.outputDir, ...rel.split('/'));
  const html = fs.readFileSync(file, 'utf8');
  const at = html.lastIndexOf('</body>');
  fs.writeFileSync(file, `${html.slice(0, at)}<p>${sentence}</p>${html.slice(at)}`);
}

describe('leak gate: a styled prop page', () => {
  it('a published styled prop is no finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'letter.html')));
    assert.deepEqual(gate(s).findings, []);
  }, { ...STYLE, 'Documents/Letter.md': LETTER() }));

  it("its own note's GM Notes sentence on the styled page is a finding", () => within((s) => {
    leakBeforeBody(s, 'props/letter.html', GM_NOTE);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/letter.html', note: 'Documents/Letter.md' }]);
  }, { ...STYLE, 'Documents/Letter.md': LETTER() }));

  it("a held styled prop's page left at its address is PROP_UNREVEALED", () => within((s) => {
    assert.ok(!fs.existsSync(path.join(s.outputDir, 'props', 'letter.html')));
    assert.deepEqual(gate(s).findings, []);
    write(s, 'props/letter.html', '<p>an older page</p>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'props/letter.html', note: 'Documents/Letter.md' }]);
  }, { ...STYLE, 'Documents/Letter.md': LETTER(), ...OTHER, ...LIST(['Documents/Other.md']) }));

  it("a held prop whose style does not load keeps its address, and a page left there is PROP_UNREVEALED", () => within((s) => {
    write(s, 'props/letter.html', '<p>an older page</p>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'props/letter.html', note: 'Documents/Letter.md' }]);
  }, { 'Documents/Letter.md': LETTER().replace('prop_style: t', 'prop_style: nosuch'), ...OTHER, ...LIST(['Documents/Other.md']) }));

  it("a shipping styled page at the address a held prop would take is no finding", () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'letter.html')));
    assert.deepEqual(gate(s).findings, []);
  }, { ...STYLE, 'Documents/Letter.md': LETTER(), 'Drafts/Letter.md': LETTER('publish: false\n') }));

  it('a styled prop moved to its -prop address agrees with the build, shipping and held', () => {
    const vault = (publishing) => ({
      ...STYLE, 'Props/Letter.md': '---\ntype: document\n---\nA page about letters.\n', 'Documents/Letter.md': LETTER(),
      ...(publishing ? LIST(publishing) : {}),
    });
    within((s) => {
      assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'letter-prop.html')));
      assert.deepEqual(gate(s).findings, []);
    }, vault(null));
    within((s) => {
      assert.ok(!fs.existsSync(path.join(s.outputDir, 'props', 'letter-prop.html')));
      write(s, 'props/letter-prop.html', '<p>an older page</p>');
      assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'props/letter-prop.html', note: 'Documents/Letter.md' }]);
    }, vault(['Props/Letter.md']));
  });

  it("a styled page the build does not make (no ## The Text) is not shipped: a held prop's page there is PROP_UNREVEALED", () => within((s) => {
    assert.ok(!fs.existsSync(path.join(s.outputDir, 'props', 'letter.html')));
    assert.deepEqual(gate(s).findings, []);
    write(s, 'props/letter.html', '<p>an older page</p>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'props/letter.html', note: 'Drafts/Letter.md' }]);
  }, { ...STYLE, 'Documents/Letter.md': '---\ntype: prop\nprop_style: t\n---\nA note with no text section.\n', 'Drafts/Letter.md': LETTER('publish: false\n') }));

  it('a made page the build could not write (something not a file at its address) is not counted as shipped', () => within((s) => {
    const found = () => gate(s).findings.filter((f) => f.code === 'WITHHELD_PUBLISHED').map((f) => f.page).sort();
    assert.deepEqual(found(), ['documents/letter.html', 'props/letter.html']);
    fs.rmSync(path.join(s.outputDir, 'props', 'letter.html'));
    fs.mkdirSync(path.join(s.outputDir, 'props', 'letter.html'));
    assert.deepEqual(found(), ['documents/letter.html']);
  }, { ...STYLE, 'Documents/Letter.md': LETTER('withheld: true\n') }));

  it('a styled page at an address naming a withheld note is a finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'lord-zorn.html')));
    assert.deepEqual(gate(s).findings.filter((f) => f.page === 'props/lord-zorn.html').map((f) => [f.code, f.note]), [['WITHHELD_IN_PROSE', 'NPCs/Lord Zorn.md']]);
  }, {
    ...STYLE, 'Documents/Letter.md': LETTER('prop_address: props/lord-zorn.html\n'),
    'NPCs/Lord Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nSecret.\n',
  }));

  it('a withheld styled prop that publishes is a finding on its styled page too', () => within((s) => {
    const found = gate(s).findings.filter((f) => f.code === 'WITHHELD_PUBLISHED').map((f) => f.page).sort();
    assert.deepEqual(found, ['documents/letter.html', 'props/letter.html']);
  }, { ...STYLE, 'Documents/Letter.md': LETTER('withheld: true\n') }));
});

describe('leak gate: a sealed title on its listings', () => {
  const SHELF = (extra = '') => ({
    ...STYLE,
    'Documents/Bookshelf.md': `---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n${extra}---\nA tall shelf in the study.\n`,
    'Documents/Letter from Lady Anne.md': `---\ntype: prop\nprop_container: "[[Bookshelf]]"\nprop_style: t\n---\n# Letter from Lady Anne\n\n${SEALED_BODY}\n\n## The Text\n\nMy dear, come quickly.\n`,
    'Documents/Ledger of the Old Debts.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nwithheld: true\n---\nLedger of the Old Debts\n\nEvery debt the squire owes, line by line.\n',
    ...OTHER,
    ...LIST(['Documents/Bookshelf.md', 'Documents/Other.md']),
  });

  it('only the sealed title is allowed, only on its listings', () => within((s) => {
    for (const page of ['props/bookshelf.html', 'props/index.html']) {
      assert.match(fs.readFileSync(path.join(s.outputDir, ...page.split('/')), 'utf8'), /<span class="prop-title">Letter from Lady Anne<\/span>/, page);
    }
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'documents/other.html', 'Letter from Lady Anne');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'documents/other.html', note: 'Documents/Letter from Lady Anne.md' }]);
    leakInto(s.outputDir, 'props/bookshelf.html', SEALED_BODY);
    assert.deepEqual(gate(s).findings.map(pick), [
      { code: 'HIDDEN_TEXT', page: 'documents/other.html', note: 'Documents/Letter from Lady Anne.md' },
      { code: 'HIDDEN_TEXT', page: 'props/bookshelf.html', note: 'Documents/Letter from Lady Anne.md' },
    ]);
  }, SHELF()));

  it('a container that does not show sealed titles gets no allowance', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'props/bookshelf.html', 'Letter from Lady Anne');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/bookshelf.html', note: 'Documents/Letter from Lady Anne.md' }]);
  }, { ...SHELF(), 'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\n---\nA tall shelf in the study.\n' }));

  it("a withheld sealed item's title on a listing is a finding", () => within((s) => {
    assert.doesNotMatch(fs.readFileSync(path.join(s.outputDir, 'props', 'bookshelf.html'), 'utf8'), /Ledger/);
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'props/bookshelf.html', 'Ledger of the Old Debts');
    leakInto(s.outputDir, 'props/index.html', 'Ledger of the Old Debts');
    // The name check's WITHHELD_IN_PROSE and the hidden title are the same page and words: either may be the one told.
    const found = gate(s).findings;
    for (const page of ['props/bookshelf.html', 'props/index.html']) {
      assert.ok(found.some((f) => f.page === page && f.note === 'Documents/Ledger of the Old Debts.md' && ['HIDDEN_TEXT', 'WITHHELD_IN_PROSE'].includes(f.code)), JSON.stringify(found.map(pick)));
    }
  }, SHELF()));

  it("a withheld item's short title, too short to be hidden text, is a finding by its name", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'props/bookshelf.html', 'Cipher');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'WITHHELD_IN_PROSE', page: 'props/bookshelf.html', note: 'Documents/Cipher.md' }]);
  }, { ...SHELF(), 'Documents/Cipher.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\nwithheld: true\n---\nA cipher wheel.\n' }));

  it("an old props page left in a kept folder, naming an unrevealed prop, is a finding", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    // What an earlier build wrote at gazetteer/props.html when the letter was revealed.
    write(s, 'gazetteer/props.html', '<!doctype html><html><body><main><h1>Props</h1><ul class="prop-list"><li class="prop-item"><span class="prop-title">Letter from Lady Anne</span></li></ul></main></body></html>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/props.html', note: 'Documents/Letter from Lady Anne.md' }]);
  }, SHELF(), { player: { keep: ['gazetteer'] } }));

  it("an old props page left in a kept folder, linking a held prop's address, is PROP_UNREVEALED however short its title", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/props.html', '<!doctype html><html><body><main><h1>Props</h1><ul class="prop-list"><li class="prop-item"><a href="../props/the-ledger.html">The Ledger</a></li></ul></main></body></html>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'gazetteer/props.html', note: 'Documents/The Ledger.md' }]);
  }, {
    ...SHELF(), 'Documents/The Ledger.md': '---\ntype: prop\nprop_style: t\n---\nA ledger.\n\n## The Text\n\nSums owed.\n',
  }, { player: { keep: ['gazetteer'] } }));

  it('a hidden phrase inside a sealed title gives no finding on its listings, and is a finding elsewhere', () => within((s) => {
    for (const page of ['props/bookshelf.html', 'props/index.html']) {
      assert.match(fs.readFileSync(path.join(s.outputDir, ...page.split('/')), 'utf8'), /<span class="prop-title">The Letter from Lady Anne Smith<\/span>/, page);
    }
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'documents/other.html', 'Letter from Lady Anne');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'documents/other.html', note: 'Prep/Session 5.md' }]);
  }, {
    ...STYLE,
    'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n---\nA tall shelf in the study.\n',
    'Documents/The Letter from Lady Anne Smith.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\n---\nA folded letter.\n',
    'Prep/Session 5.md': '---\ntype: session-prep\n---\nProps to plant:\n\n- Letter from Lady Anne\n',
    ...OTHER, ...LIST(['Documents/Bookshelf.md', 'Documents/Other.md']),
  }));

  it("an old props page in a kept folder, holding a held plain prop's row, is PROP_UNREVEALED however short its title", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/props.html', '<!doctype html><html><body><main><h1>Props</h1><ul class="prop-list"><li class="prop-item"><a href="../documents/the-ledger.html">The Ledger</a></li></ul></main></body></html>');
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'PROP_UNREVEALED', page: 'gazetteer/props.html', note: 'Documents/The Ledger.md' }]);
  }, { ...SHELF(), 'Documents/The Ledger.md': '---\ntype: prop\n---\nA ledger.\n' }, { player: { keep: ['gazetteer'] } }));

  it("a kept folder's own page at a held prop note's would-be address, linked from the kept folder, gives no finding", () => within((s) => {
    write(s, 'extras/map-of-the-town.html', '<!doctype html><html><body><main><p>My own hand-drawn map page.</p></main></body></html>');
    write(s, 'extras/index.html', '<!doctype html><html><body><main><a href="map-of-the-town.html">Town</a></main></body></html>');
    assert.deepEqual(gate(s).findings, []);
  }, {
    'Extras/Map Of The Town.md': '---\ntype: prop\npublish: false\n---\nA hidden map.\n', ...OTHER,
  }, { player: { keep: ['extras'] } }));

  it('published pages that mention a held plain prop by wikilink and field give no finding', () => within((s) => {
    assert.match(fs.readFileSync(path.join(s.outputDir, 'documents', 'other.html'), 'utf8'), /The Ledger/);
    assert.deepEqual(gate(s).findings, []);
  }, {
    ...SHELF(), 'Documents/The Ledger.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\n---\nA ledger.\n',
    'Documents/Other.md': '---\ntype: document\nrelated: "[[The Ledger]]"\n---\nThe vicar keeps [[The Ledger]] close.\n',
  }));

  it("a hidden prep note listing the sealed item by name gives no finding on its listings", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'documents/other.html', 'Letter from Lady Anne');
    // Elsewhere those words are still hidden text (of the letter or of the prep note: one finding per page and words).
    assert.deepEqual(gate(s).findings.map((f) => [f.code, f.page]), [['HIDDEN_TEXT', 'documents/other.html']]);
  }, { ...SHELF(), 'Prep/Session 5.md': '---\ntype: session-prep\n---\nProps to plant:\n\n- [[Letter from Lady Anne]]\n' }));

  it('the props page set elsewhere is held from the props, as the build holds it', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'shelf.html')), 'the props page at its asked address');
    assert.match(fs.readFileSync(path.join(s.outputDir, 'props', 'shelf.html'), 'utf8'), /<h1 class="page-title">Props<\/h1>/);
    assert.deepEqual(gate(s).findings, []);
    leakInto(s.outputDir, 'props/shelf.html', SEALED_BODY);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/shelf.html', note: 'Documents/Letter from Lady Anne.md' }]);
  }, {
    ...SHELF(), 'Documents/Shelf.md': '---\ntype: prop\nprop_file: shelf.html\n---\nA card.\n', 'Documents/shelf.html': '<!doctype html><html><body><p>A card.</p></body></html>',
    ...LIST(['Documents/Bookshelf.md', 'Documents/Other.md', 'Documents/Shelf.md']),
  }, { player: { props: { address: 'props/shelf.html' } } }));
});

describe('leak gate: a short title of an unpublished prop in a kept folder (Ruling 34)', () => {
  const SHELF = (fm = '') => ({
    'Documents/Bookshelf.md': `---\ntype: prop\nprop_kind: container\nshow_sealed: titles\n${fm}---\nA tall shelf in the study.\n`,
    'Documents/The Ledger.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\n---\nA ledger.\n',
    'Documents/Cipher.md': '---\ntype: prop\nprop_container: "[[Bookshelf]]"\n---\nA cipher wheel.\n',
    ...OTHER,
    ...LIST(['Documents/Bookshelf.md', 'Documents/Other.md']),
  });
  const OLD_LISTING = (title) => `<!doctype html><html><body><main><h1>Props</h1><ul class="prop-list"><li class="prop-item"><span class="prop-title">${title}</span></li></ul></main></body></html>`;

  it('an old listing in a kept folder printing a two-word title, unlinked, is a finding', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/props.html', OLD_LISTING('The Ledger'));
    assert.deepEqual(gate(s).findings.map((f) => ({ ...pick(f), text: f.text })), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/props.html', note: 'Documents/The Ledger.md', text: 'the ledger' }]);
  }, SHELF(), { player: { keep: ['gazetteer'] } }));

  it('the title is matched whole and as written: another case or a longer word is no finding', () => within((s) => {
    write(s, 'gazetteer/props.html', OLD_LISTING('the ledger, and The Ledgers'));
    assert.deepEqual(gate(s).findings, []);
  }, SHELF(), { player: { keep: ['gazetteer'] } }));

  it('the same page outside a kept folder gets no finding from this rule', () => within((s) => {
    write(s, 'gazetteer/props.html', OLD_LISTING('The Ledger'));
    assert.deepEqual(gate(s).findings, []);
  }, SHELF()));

  it("a current container page in a kept folder, listing the title sealed, is no finding", () => within((s) => {
    assert.match(fs.readFileSync(path.join(s.outputDir, 'gazetteer', 'bookshelf.html'), 'utf8'), /<span class="prop-title">The Ledger<\/span>/);
    assert.deepEqual(gate(s).findings, []);
    // The same title elsewhere in the kept folder is still a finding.
    write(s, 'gazetteer/old.html', OLD_LISTING('The Ledger'));
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/old.html', note: 'Documents/The Ledger.md' }]);
  }, SHELF('prop_address: gazetteer/bookshelf.html\n'), { player: { keep: ['gazetteer'] } }));

  it('a title a published page already says is no finding in a kept page', () => within((s) => {
    assert.match(fs.readFileSync(path.join(s.outputDir, 'npcs', 'squire.html'), 'utf8'), /keeps The Ledger in his desk/);
    write(s, 'gazetteer/notes.html', '<!doctype html><html><body><main><p>Ask the squire about The Ledger.</p></main></body></html>');
    assert.deepEqual(gate(s).findings, []);
  }, {
    ...SHELF(), 'NPCs/Squire.md': '---\ntype: npc\n---\nThe squire keeps The Ledger in his desk, everyone knows.\n',
    ...LIST(['Documents/Bookshelf.md', 'Documents/Other.md', 'NPCs/Squire.md']),
  }, { player: { keep: ['gazetteer'] } }));

  it("a shipping styled prop's own page in a kept folder, naming a held title, is no finding", () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'gazetteer', 'letter.html')));
    assert.deepEqual(gate(s).findings, []);
  }, {
    ...STYLE, 'Documents/The Ledger.md': '---\ntype: prop\n---\nA ledger.\n',
    'Documents/Letter.md': '---\ntype: prop\nprop_style: t\nprop_address: gazetteer/letter.html\n---\nA note.\n\n## The Text\n\nBurn The Ledger tonight.\n',
    ...LIST(['Documents/Letter.md']),
  }, { player: { keep: ['gazetteer'] } }));

  it('a page this build writes in a kept folder is not read for held titles, even where no published text says them', () => within((s) => {
    leakBeforeBody(s, 'gazetteer/letter.html', 'The Ledger');
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/old.html', OLD_LISTING('The Ledger'));
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/old.html', note: 'Documents/The Ledger.md' }]);
  }, {
    ...STYLE, 'Documents/The Ledger.md': '---\ntype: prop\n---\nA ledger.\n',
    'Documents/Letter.md': '---\ntype: prop\nprop_style: t\nprop_address: gazetteer/letter.html\n---\nA note.\n\n## The Text\n\nBurn it tonight.\n',
    ...LIST(['Documents/Letter.md']),
  }, { player: { keep: ['gazetteer'] } }));

  it('the props page set in a kept folder is not read for held titles', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'gazetteer', 'all-props.html')));
    // The Old Map is in no container, so no listing prints it sealed: only the skip clears it here.
    leakInto(s.outputDir, 'gazetteer/all-props.html', 'The Old Map');
    assert.deepEqual(gate(s).findings, []);
    write(s, 'gazetteer/old.html', OLD_LISTING('The Old Map'));
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'gazetteer/old.html', note: 'Documents/The Old Map.md' }]);
  }, { ...SHELF(), 'Documents/The Old Map.md': '---\ntype: prop\n---\nA map.\n' }, { player: { keep: ['gazetteer'], props: { address: 'gazetteer/all-props.html' } } }));

  it('a one-word title is not looked for', () => within((s) => {
    write(s, 'gazetteer/props.html', OLD_LISTING('Cipher'));
    assert.deepEqual(gate(s).findings, []);
  }, SHELF(), { player: { keep: ['gazetteer'] } }));
});

// Ruling 41: words a vault style's layout writes are build-written text players see on every page of that style.
describe('leak gate: the words a style\'s layout writes', () => {
  const CREDITS = 'Print with background graphics ticked so each sheet is one page.';
  const LAYOUT_STYLE = {
    '_meta/prop-styles/t/layout.html': `<h1>{{title}}</h1>{{{body}}}<p class="credits">${CREDITS}</p>`,
    '_meta/prop-styles/t/style.css': '.credits { color: grey; }\n',
  };
  const HELD = (gm) => ({ 'Documents/Held.md': `---\ntype: document\n---\nA paper.\n\n## GM Notes\n\n${gm}\n` });
  const SITE = (gm) => ({ ...LAYOUT_STYLE, 'Documents/Letter.md': LETTER(), ...HELD(gm), ...LIST(['Documents/Letter.md']) });

  it('a hidden sentence the layout also writes is no finding', () => within((s) => {
    assert.match(fs.readFileSync(path.join(s.outputDir, 'props', 'letter.html'), 'utf8'), /each sheet is one page/);
    assert.deepEqual(gate(s).findings, []);
  }, SITE(CREDITS)));

  it('a hidden sentence the layout does not write is still a finding on that page', () => within((s) => {
    const other = 'Print the ledger on red paper so the forgery shows.';
    leakBeforeBody(s, 'props/letter.html', other);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/letter.html', note: 'Documents/Held.md' }]);
  }, SITE('Print the ledger on red paper so the forgery shows.')));

  it('a field the layout pastes in by tag gets no words allowed', () => within((s) => {
    const hidden = 'Filed by the night clerk at the harbour office after dark.';
    leakBeforeBody(s, 'props/letter.html', hidden);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/letter.html', note: 'Documents/Held.md' }]);
  }, { '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}<p class="aside">Filed by {{prop_clerk}} at the harbour office after dark.</p>',
    '_meta/prop-styles/t/style.css': '.aside { color: grey; }\n', 'Documents/Letter.md': LETTER('prop_clerk: the night clerk\n'),
    ...HELD('Filed by the night clerk at the harbour office after dark.'), ...LIST(['Documents/Letter.md']) }));

  it('the words either side of a tag do not join into one allowed sentence', () => within((s) => {
    const hidden = 'The clerk files every paper at the harbour office before dawn.';
    leakBeforeBody(s, 'props/letter.html', hidden);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/letter.html', note: 'Documents/Held.md' }]);
  }, { '_meta/prop-styles/t/layout.html': '<h1>{{title}}</h1>{{{body}}}<p class="aside">The clerk files every paper {{prop_clerk}} at the harbour office before dawn.</p>',
    '_meta/prop-styles/t/style.css': '.aside { color: grey; }\n', 'Documents/Letter.md': LETTER('prop_clerk: Corwin\n'),
    ...HELD('The clerk files every paper at the harbour office before dawn.'), ...LIST(['Documents/Letter.md']) }));

  it('a style no shipping prop uses excuses nothing', () => within((s) => {
    leakBeforeBody(s, 'props/letter.html', CREDITS);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/letter.html', note: 'Documents/Held.md' }]);
  }, { ...STYLE, '_meta/prop-styles/u/layout.html': LAYOUT_STYLE['_meta/prop-styles/t/layout.html'],
    '_meta/prop-styles/u/style.css': '.credits { color: grey; }\n', 'Documents/Letter.md': LETTER(), ...HELD(CREDITS), ...LIST(['Documents/Letter.md']) }));
});
