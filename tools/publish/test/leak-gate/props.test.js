'use strict';
// The leak gate and props: a prop's files are its note's published form. On them only another note's hidden text is
// excused; the prop note's own hidden text, a held prop's file and every other file are checked as before.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto, leakIntoIndex } = require('../helpers/leak-site');
const { allFiles } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');
const { runLeakGate } = require('../../lib/leak-gate');

const OWN = 'The seal was forged in Calcutta last spring.';
const KEEPER = 'The butler keeps the second key in his boot.';
const LETTER = 'Meet me beneath the old mill at midnight.';
const HELD = 'Only the vicar knows the crypt is empty.';
const PROP = (extra = '', body = 'An invitation to the ball.\n') => `---\ntype: prop\nprop_file: inv.html\n${extra}---\n${body}`;
const PAGE = (text = '') => [
  '<!doctype html><html><head><link rel="stylesheet" href="props.css"></head><body>',
  '<h1>You are invited</h1>',
  text,
  `<!-- gm-only --><p>${KEEPER}</p><!-- /gm-only -->`,
  '</body></html>',
].join('\n');
const CSS = 'body { color: #432; } /* a sheet of its own */\n';
const LIST = (publishing) => ({ '_meta/publish-list.yaml': listFileText({ publishing }) });
const OTHER = { 'Documents/Other.md': '---\ntype: document\n---\nOther.\n' };
const gate = (s) => runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
const write = (s, rel, data) => {
  const full = path.join(s.outputDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
};
const pick = (f) => ({ code: f.code, page: f.page, note: f.note, reason: f.reason });
const within = (fn, ...args) => { const s = leakSite(...args); try { return fn(s); } finally { s.cleanup(); } };

describe('leak gate: a prop page and its own note', () => {
  it('a hand-made prop page carrying a GM Notes sentence of its own note is a finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'invitation.html')));
    const found = gate(s).findings.filter((f) => f.page === 'props/invitation.html');
    assert.deepEqual(found.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/invitation.html', note: 'Documents/Invitation.md', reason: 'GM Notes section' }]);
  }, {
    'Documents/Invitation.md': PROP('', `An invitation to the ball.\n\n## GM Notes\n\n${OWN}\n`),
    'Documents/inv.html': PAGE(`<p>${OWN}</p>`), 'Documents/props.css': CSS,
  }));

  it("a prop page quoting another note's hidden sentence is not a finding there", () => within((s) => {
    leakInto(s.outputDir, 'documents/other.html', LETTER);
    const found = gate(s).findings;
    assert.ok(!found.some((f) => f.page === 'props/invitation.html'), JSON.stringify(found));
    assert.deepEqual(found.filter((f) => /mill at midnight/.test(f.text)).map(pick),
      [{ code: 'HIDDEN_TEXT', page: 'documents/other.html', note: 'Scenes/Letter Scene.md', reason: 'unpublished note: prep: scenes and Plans stay off the player site' }]);
  }, {
    'Documents/Invitation.md': PROP(), 'Documents/inv.html': PAGE(`<p>${LETTER}</p>`), 'Documents/props.css': CSS, ...OTHER,
    'Scenes/Letter Scene.md': `---\ntype: scene\n---\nThe letter reads as follows.\n\n${LETTER}\n`,
  }));

  it('a gm-only part of a prop file is hidden text if it reaches the site', () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    leakBeforeBody(s, 'props/invitation.html', KEEPER);
    assert.deepEqual(gate(s).findings.map(pick),
      [{ code: 'HIDDEN_TEXT', page: 'props/invitation.html', note: 'Documents/Invitation.md', reason: 'a hidden part of its prop file (inv.html)' }]);
  }, { 'Documents/Invitation.md': PROP(), 'Documents/inv.html': PAGE(), 'Documents/props.css': CSS }));

  it("the search index and the prop's own note page are checked as before", () => within((s) => {
    leakInto(s.outputDir, 'documents/invitation.html', LETTER);
    leakIntoIndex(s, 'documents/invitation.html', LETTER);
    assert.deepEqual(gate(s).findings.map((f) => f.page).sort(), ['documents/invitation.html', 'search-index.json#documents/invitation.html']);
  }, {
    'Documents/Invitation.md': PROP(), 'Documents/inv.html': PAGE(`<p>${LETTER}</p>`), 'Documents/props.css': CSS,
    'Scenes/Letter Scene.md': `---\ntype: scene\n---\nThe letter reads as follows.\n\n${LETTER}\n`,
  }));
});

// A built page with a sentence added before </body> (a prop page has no <main>).
function leakBeforeBody(s, rel, sentence) {
  const file = path.join(s.outputDir, ...rel.split('/'));
  const html = fs.readFileSync(file, 'utf8');
  const at = html.lastIndexOf('</body>');
  fs.writeFileSync(file, `${html.slice(0, at)}<p>${sentence}</p>${html.slice(at)}`);
}

describe('leak gate: a file two props share', () => {
  const SHARED = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Card</h1></body></html>';
  const BISHOP = 'The bishop hid the chalice under the altar stone.';
  const GARDENER = 'The gardener saw the duke leave at dawn.';
  const VAULT = (beta = '') => ({
    'Documents/Alpha.md': '---\ntype: prop\nprop_file: a.html\n---\nAlpha.\n', 'Documents/a.html': SHARED, 'Documents/style.css': CSS,
    'Letters/Beta.md': `---\ntype: prop\nprop_file: b.html\n${beta}---\nBeta.\n\n## GM Notes\n\n${BISHOP}\n`, 'Letters/b.html': SHARED, 'Letters/style.css': CSS,
    'Scenes/C.md': `---\ntype: scene\n---\nIntro text here.\n\n${GARDENER}\n`,
  });

  it("belongs to both: the second prop's own hidden text there is a finding, another note's is not", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    fs.appendFileSync(path.join(s.outputDir, 'props', 'style.css'), `/* ${BISHOP} */\n/* ${GARDENER} */\n`);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/style.css', note: 'Letters/Beta.md', reason: 'GM Notes section' }]);
  }, VAULT()));

  it("a file a shared stylesheet reaches belongs to both", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    fs.appendFileSync(path.join(s.outputDir, 'props', 'more.css'), `/* ${BISHOP} */\n/* ${GARDENER} */\n`);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'props/more.css', note: 'Letters/Beta.md', reason: 'GM Notes section' }]);
  }, {
    ...VAULT(), 'Documents/style.css': '@import "more.css";\n', 'Letters/style.css': '@import "more.css";\n',
    'Documents/more.css': CSS, 'Letters/more.css': CSS,
  }));

  it('a withheld second prop is published on the shared file too', () => within((s) => {
    const found = gate(s).findings.filter((f) => f.code === 'WITHHELD_PUBLISHED').map((f) => f.page).sort();
    assert.deepEqual(found, ['letters/beta.html', 'props/beta.html', 'props/style.css']);
  }, VAULT('withheld: true\n')));
});

describe('leak gate: a prop that does not ship', () => {
  const HELD_VAULT = (extra = '') => ({
    'Documents/Invitation.md': PROP(extra), 'Documents/inv.html': PAGE(`<p>${HELD}</p>`), 'Documents/props.css': CSS,
    'Documents/Map.md': '---\ntype: prop\nprop_file: map.pdf\n---\nA map.\n', 'Documents/map.pdf': '%PDF-1.4 the held map bytes',
    ...OTHER, ...LIST(['Documents/Other.md']),
  });

  it("a held prop's page copied by hand is caught", () => within((s) => {
    assert.deepEqual(gate(s).findings, []);
    const vault = path.join(s.root, 'vault', 'Documents');
    write(s, 'gazetteer/papers/inv.html', fs.readFileSync(path.join(vault, 'inv.html')));
    write(s, 'x.pdf', fs.readFileSync(path.join(vault, 'map.pdf')));
    write(s, 'props/invitation.html', '<p>mine</p>');
    const found = gate(s).findings;
    const copied = found.filter((f) => f.page === 'gazetteer/papers/inv.html');
    assert.ok(copied.length >= 2, JSON.stringify(found));
    for (const f of copied) {
      assert.equal(f.code, 'HIDDEN_TEXT');
      assert.equal(f.note, 'Documents/Invitation.md');
      assert.match(f.reason, /^unpublished prop: /);
    }
    assert.ok(copied.some((f) => /crypt is empty/.test(f.text)) && copied.some((f) => /second key in his boot/.test(f.text)));
    const unrevealed = found.filter((f) => f.code === 'PROP_UNREVEALED').map((f) => [f.page, f.note, f.reason, f.kind]);
    assert.deepEqual(unrevealed, [
      ['props/invitation.html', 'Documents/Invitation.md', 'the prop file of a note the site does not publish', 'name'],
      ['x.pdf', 'Documents/Map.md', 'the prop file of a note the site does not publish', 'name'],
    ]);
  }, HELD_VAULT()));

  it("a stale copy that differs, at a held prop's kept-folder address, is caught", () => within((s) => {
    write(s, 'gazetteer/invitation.html', '<p>an older copy</p>');
    const found = gate(s).findings;
    assert.deepEqual(found.map(pick), [{ code: 'PROP_UNREVEALED', page: 'gazetteer/invitation.html', note: 'Documents/Invitation.md', reason: 'the prop file of a note the site does not publish' }]);
  }, HELD_VAULT('prop_address: gazetteer/invitation.html\n'), { player: { keep: ['gazetteer'] } }));

  it('a stub note holds its prop, and its text is hidden', () => within((s) => {
    assert.ok(!fs.existsSync(path.join(s.outputDir, 'props')));
    leakInto(s.outputDir, 'documents/invitation.html', HELD);
    assert.deepEqual(gate(s).findings.map(pick), [{ code: 'HIDDEN_TEXT', page: 'documents/invitation.html', note: 'Documents/Invitation.md', reason: 'unpublished prop: publish: stub' }]);
  }, { 'Documents/Invitation.md': PROP('publish: stub\n'), 'Documents/inv.html': PAGE(`<p>${HELD}</p>`) }));

  it('sibling files of an unpublished prop are never copied', () => within((s) => {
    const css = Buffer.from(CSS);
    for (const f of allFiles(s.outputDir)) assert.ok(!fs.readFileSync(f).equals(css), f);
    assert.deepEqual(gate(s).findings, []);
  }, HELD_VAULT()));

  it('a shipping prop at the address a held one would take is no finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'invitation.html')));
    assert.deepEqual(gate(s).findings, []);
  }, {
    'Documents/Invitation.md': PROP(), 'Documents/inv.html': PAGE(), 'Documents/props.css': CSS,
    'Drafts/Invitation.md': '---\ntype: prop\nprop_file: inv.html\npublish: false\n---\nAn old draft.\n', 'Drafts/inv.html': PAGE('<p>An earlier draft of the invitation card.</p>'),
  }));
});

describe('leak gate: withheld names and props', () => {
  it('a withheld prop: unpublished, no findings and no file', () => within((s) => {
    assert.ok(!fs.existsSync(path.join(s.outputDir, 'props')));
    assert.deepEqual(gate(s).findings, []);
  }, { 'Documents/Invitation.md': PROP('withheld: true\npublish: false\n'), 'Documents/inv.html': PAGE(), ...OTHER }));

  it('a withheld prop: published, a finding on its note page and on its prop page', () => within((s) => {
    const found = gate(s).findings.filter((f) => f.code === 'WITHHELD_PUBLISHED');
    assert.deepEqual(found.map((f) => [f.page, f.note]).sort(), [
      ['documents/invitation.html', 'Documents/Invitation.md'],
      ['props/invitation.html', 'Documents/Invitation.md'],
    ]);
  }, { 'Documents/Invitation.md': PROP('withheld: true\n'), 'Documents/inv.html': PAGE().replace('<link rel="stylesheet" href="props.css">', '') }));

  it('a prop file named after a withheld note is a finding', () => within((s) => {
    assert.ok(fs.existsSync(path.join(s.outputDir, 'props', 'lord-zorn.html')));
    const found = gate(s).findings.filter((f) => f.page === 'props/lord-zorn.html');
    assert.deepEqual(found.map((f) => [f.code, f.note]), [['WITHHELD_IN_PROSE', 'NPCs/Lord Zorn.md']]);
  }, {
    'NPCs/Lord Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nSecret.\n',
    'Documents/Invitation.md': PROP('prop_address: props/lord-zorn.html\n'), 'Documents/inv.html': PAGE().replace('<link rel="stylesheet" href="props.css">', ''),
  }));
});

// The gate.test.js vault with a leak of every kind the gate finds; its findings as the gate found them before props,
// but for one fix: a withheld name in a file's name now names its note (it was left undefined).
const NOTES = {
  'NPCs/Sections.md': '---\ntype: npc\n---\nThe baker is a kind man.\n\n## GM Notes\n\nThe baker poisoned the mayor last winter.\n\n- Everyone knows the bridge\n',
  'NPCs/Fields.md': '---\ntype: npc\nsecrets: She works for the drowned cult\n---\nA fisher. Everyone knows the bridge is unsafe.\n',
  'NPCs/Blocks.md': '---\ntype: npc\n---\nA <!-- gm-only -->The key is under the third stone<!-- /gm-only --> b.\n',
  'NPCs/Draft.md': '---\ntype: npc\nstatus: planned\n---\nThe harbourmaster takes bribes from smugglers.\n',
  'NPCs/Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nA man.\n',
  'NPCs/Vesper.md': '---\ntype: npc\nwithheld: true\n---\nA hidden one.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' }, never_show: ['Kestrel'] } };
const BEFORE = [
  { id: '10bde3', kind: 'text', code: 'HIDDEN_TEXT', page: 'extra.html', text: 'she works for the drowned cult', shown: 'She works for the drowned cult', note: 'NPCs/Fields.md', reason: 'field: secrets' },
  { id: '25f73a', kind: 'name', code: 'WITHHELD_IN_PROSE', page: 'images/zorn.png', text: 'zorn', shown: 'images/zorn.png', note: 'NPCs/Zorn.md', reason: 'the name of a note marked withheld' },
  { id: '6dd9ad', kind: 'text', code: 'HIDDEN_TEXT', page: 'npcs/blocks.html', text: 'the baker poisoned the mayor last winter', shown: 'The baker poisoned the mayor last winter.', note: 'NPCs/Sections.md', reason: 'GM Notes section' },
  { id: '27a6b3', kind: 'name', code: 'NEVER_SHOW', page: 'npcs/fields.html', text: 'kestrel', shown: 'The key is under the third stone. Zorn sends his regards, Kestrel.', note: 'player_site.never_show', reason: 'a word the GM listed under player_site.never_show' },
  { id: 'b862e0', kind: 'text', code: 'HIDDEN_TEXT', page: 'npcs/fields.html', text: 'the key is under the third stone', shown: 'The key is under the third stone', note: 'NPCs/Blocks.md', reason: 'gm-only block' },
  { id: '7f4369', kind: 'name', code: 'WITHHELD_IN_PROSE', page: 'npcs/fields.html', text: 'zorn', shown: 'The key is under the third stone. Zorn sends his regards, Kestrel.', note: 'NPCs/Zorn.md', reason: 'the name of a note marked withheld' },
  { id: 'f4b955', kind: 'name', code: 'WITHHELD_PUBLISHED', page: 'npcs/vesper.html', text: 'npcs vesper html', shown: 'npcs/vesper.html', note: 'NPCs/Vesper.md', reason: 'a note marked withheld is published' },
  { id: '36d917', kind: 'text', code: 'HIDDEN_TEXT', page: 'search-index.json#npcs/sections.html', text: 'the harbourmaster takes bribes from smugglers', shown: 'The harbourmaster takes bribes from smugglers.', note: 'NPCs/Draft.md', reason: 'unpublished note: status: planned' },
];

describe('leak gate: a site with no props', () => {
  it('finds exactly what it found before', () => within((s) => {
    leakInto(s.outputDir, 'npcs/blocks.html', 'The baker poisoned the mayor last winter.');
    leakInto(s.outputDir, 'npcs/fields.html', 'The key is under the third stone. Zorn sends his regards, Kestrel.');
    leakIntoIndex(s, 'npcs/sections.html', 'The harbourmaster takes bribes from smugglers.');
    write(s, 'images/zorn.png', 'PNG');
    write(s, 'extra.html', '<p>She works for the drowned cult.</p>');
    assert.deepEqual(gate(s).findings, BEFORE);
  }, NOTES, SETTINGS));
});
