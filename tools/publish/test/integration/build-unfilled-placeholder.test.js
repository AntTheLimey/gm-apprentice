'use strict';
// #720: a paragraph or list item that is only a template placeholder ({To flesh out for colour.}) is not content. The
// page drops it and any heading it leaves empty; the build warns with the note and the section, and the note is an
// UNFILLED_PLACEHOLDER finding for campaign-qa's Site Faults check.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { build } = require('../../lib/build');

const NPC = [
  '---', 'type: npc', 'title: Rosie Tallowby', '---', '# Rosie Tallowby', '',
  '## Appearance & Manner', '', '{To flesh out for colour.}', '',
  '## Voice', '', 'Low and dry.', '',
  '- {Add a verbal tic}', '- A real bullet', '',
  '## Quirks', '', '- {Add a quirk}', '',
  '## Notes', '', 'She said {sic} twice, and wrote {x} on the slate.', '',
  '### Pending', '', '{Pending items}', '',
  '## Kept', '', '### Detail', '', 'Something real.', '',
].join('\n');

describe('#720: an unfilled placeholder is left off the page and warned', () => {
  const site = buildBoth({ 'NPCs/Rosie Tallowby.md': NPC }, {});
  after(() => site.cleanup());
  const html = site.player.read('npcs', 'rosie-tallowby.html');

  it('a placeholder paragraph and its emptied heading are dropped', () => {
    assert.doesNotMatch(html, /To flesh out for colour/);
    assert.doesNotMatch(html, /Appearance &amp; Manner/);
  });

  it('the pull-quote never opens on a placeholder, and the GM site drops it too', () => {
    assert.match(html, /<div class="pull-quote">Low and dry\./);
    assert.doesNotMatch(site.gm.read('npcs', 'rosie-tallowby.html'), /To flesh out for colour/);
  });

  it('a placeholder bullet is dropped and the real one stays, under its heading', () => {
    assert.doesNotMatch(html, /Add a verbal tic/);
    assert.match(html, /A real bullet/);
    assert.match(html, /Voice/);
  });

  it('a list holding only a placeholder goes with its heading, and so does a subheading and then its parent', () => {
    assert.doesNotMatch(html, /Add a quirk|Quirks/);
    assert.doesNotMatch(html, /Pending/);
  });

  it('braces in the middle of a sentence render unchanged, and the heading with other content stays', () => {
    assert.match(html, /She said \{sic\} twice, and wrote \{x\} on the slate\./);
    assert.match(html, /Notes/);
    assert.match(html, /Something real/);
    assert.match(html, /Kept/);
  });

  it('the build warns once per placeholder, with the note and the section', () => {
    const warned = site.logs.filter((l) => /unfilled placeholder:/.test(l));
    assert.equal(warned.length, 8, warned.join('\n'));   // four, on each of the two sites
    assert.ok(warned.some((l) => /rosie-tallowby\.html: unfilled placeholder: \{To flesh out for colour\.\} under "Appearance & Manner"/.test(l)), warned.join('\n'));
  });

  it('each is an UNFILLED_PLACEHOLDER finding on the note, naming the section', () => {
    let faults = [];
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: site.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); }
    const found = faults.filter((f) => f.code === 'UNFILLED_PLACEHOLDER');
    assert.equal(found.length, 4, JSON.stringify(found));
    assert.ok(found.every((f) => f.path === 'NPCs/Rosie Tallowby.md' && f.severity === 'warning'));
    assert.equal(found[0].detail, '{To flesh out for colour.} is an unfilled placeholder under "Appearance & Manner"; it is left off the page');
    assert.equal(found[0].fix, 'Fill it in, or remove the line');
  });
});
