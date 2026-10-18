'use strict';
// #447: a withheld section's heading written inside a hidden block. The text after the block sits under that heading
// in Obsidian; the player site withholds it on stub and full pages, the GM site marks it, and the build says why.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildBoth, markedTexts } = require('../helpers/gm-build');

const BODY = {
  pct: (word) => `## Appearance\nTall, grey coat.\n%% working note\n## GM Notes\n%%\n${word} is the informant.\n`,
  gmo: (word) => `## Appearance\nTall, grey coat.\n<!-- gm-only -->\n## GM Notes\n<!-- /gm-only -->\n${word} is the informant.\n`,
};
const STUB = '---\ntype: npc\npublish: stub\npublish_include_sections: [Appearance]\n---\n';
const FULL = '---\ntype: npc\n---\n';

const NOTES = {
  'NPCs/Stub Pct.md': STUB + BODY.pct('STUBPCT'),
  'NPCs/Stub Gmo.md': STUB + BODY.gmo('STUBGMO'),
  'NPCs/Full Pct.md': FULL + BODY.pct('FULLPCT'),
  'NPCs/Full Gmo.md': FULL + BODY.gmo('FULLGMO'),
};
const WORDS = ['STUBPCT', 'STUBGMO', 'FULLPCT', 'FULLGMO'];

describe('#447: a GM Notes heading inside a hidden block', () => {
  const site = buildBoth(NOTES, { player: { hide: { sections: ['GM Notes'] } } });
  after(() => site.cleanup());

  it('the player site prints none of the text after the block, in any file', () => {
    for (const f of site.player.files()) {
      if (!/\.(html|json|js|txt|xml)$/.test(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      for (const w of WORDS) assert.doesNotMatch(text, new RegExp(w), `${w} in ${f}`);
    }
    for (const page of ['stub-pct.html', 'stub-gmo.html', 'full-pct.html', 'full-gmo.html']) {
      assert.match(site.player.read('npcs', page), /Tall, grey coat\./, page);
    }
  });

  it('the GM site shows the text, inside a mark', () => {
    for (const [page, word] of [['stub-pct.html', 'STUBPCT'], ['stub-gmo.html', 'STUBGMO'], ['full-pct.html', 'FULLPCT'], ['full-gmo.html', 'FULLGMO']]) {
      const marks = markedTexts(site.gm.read('npcs', page));
      assert.ok(marks.some((m) => new RegExp(word).test(m.text)), `${page}: ${JSON.stringify(marks)}`);
    }
    const full = markedTexts(site.gm.read('npcs', 'full-pct.html'));
    assert.ok(full.some((m) => m.kind === 'sections' && m.label === 'GM Notes section' && /FULLPCT/.test(m.text)), JSON.stringify(full));
  });

  it('the build warns, naming the note and the heading', () => {
    for (const note of ['stub-pct', 'stub-gmo', 'full-pct', 'full-gmo']) {
      assert.ok(site.logs.some((l) => l.includes(note) && /"GM Notes" is inside a hidden block/.test(l)), `${note}: ${JSON.stringify(site.logs)}`);
    }
  });
});
