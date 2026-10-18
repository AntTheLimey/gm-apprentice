'use strict';
// #448: a `title:` that links a withheld note. Page text turns such a link into the withheld word; the title takes
// the same rewrite, once, where the title is resolved, so every place that prints it (the page heading, <title>, the
// nav, the search index, the link previews, the Connections lanes of related pages) prints the word.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildBoth, markedTexts } = require('../helpers/gm-build');

const NOTES = {
  'NPCs/The Masked Patron.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nThe duke in a mask.\n',
  'NPCs/Patron Ledger.md': '---\ntype: npc\ntitle: "[[The Masked Patron]]"\n---\nA ledger of payments.\n',
  'NPCs/Ann.md': '---\ntype: npc\nrelationships:\n  - target: "[[Patron Ledger]]"\n    type: knows\n---\nAnn read [[Patron Ledger]].\n',
};

describe('#448: a title that links a withheld note', () => {
  const site = buildBoth(NOTES);
  after(() => site.cleanup());

  it('no file of the player site prints the withheld name', () => {
    const files = site.player.files().filter((f) => /\.(html|json|js|txt|xml)$/.test(f));
    assert.ok(files.length > 0);
    for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Masked Patron/, f);
  });

  it('the page heading and <title> print the withheld word', () => {
    const html = site.player.read('npcs', 'patron-ledger.html');
    assert.match(html, /<h1>someone<\/h1>/);
    assert.match(html, /<title>someone\b/);
  });

  it('the search index, the link previews and the Connections lane of a related page print the withheld word', () => {
    const search = site.player.read('search-index.json');
    assert.match(search, /"title":"someone"/);
    const previews = JSON.parse(site.player.read('previews.json'));
    assert.ok(JSON.stringify(previews).includes('"someone"'), JSON.stringify(previews).slice(0, 400));
    const ann = site.player.read('npcs', 'ann.html');
    assert.match(ann, /<a href="patron-ledger\.html">someone<\/a>/, 'the Connections lane on a related page');
    assert.match(ann, /"t":"someone","h":"patron-ledger\.html"/, 'the Connections data');
  });

  it('the GM site shows the name, marked as what players do not see', () => {
    const marks = markedTexts(site.gm.read('npcs', 'patron-ledger.html'));
    assert.ok(marks.some((m) => m.kind === 'withheld_names' && /The Masked Patron/.test(m.text)), JSON.stringify(marks));
  });
});
