'use strict';
// tools/publish/test/integration/backstory-leak.test.js
// A `<!-- gm-only -->` block inside a PC's `### Backstory` and `### Appearance`: the player
// site never shows it (PC page, card, story page, link previews, search index); the GM site does.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('../helpers/gm-build');

const SECRET_STORY = 'BACKSTORY-GM-SECRET the archivist burned the ninth drawer herself.';
const SECRET_LOOK = 'APPEARANCE-GM-SECRET the ink on her cuffs is not ink.';

const PC = [
  '---', 'type: pc', 'player_name: "Test Player"', 'status: alive', '---', '',
  '## Background', '', '**Species:** Elf', '',
  '### Backstory', '',
  '<!-- gm-only -->', SECRET_STORY, '<!-- /gm-only -->', '',
  'For a hundred years Ilse kept the index. Nobody asked what she thought.', '',
  '### Appearance', '',
  'Tall and narrow.', '',
  '<!-- gm-only -->', SECRET_LOOK, '<!-- /gm-only -->', '',
  '**Age:** 112 · **Height:** — · **Weight:** — · **Eyes:** grey · **Hair:** — · **Skin:** — · **Faith:** —', '',
  '### Personality', '', '- **Traits:** Exact.', '',
  '## Notes', '', 'Owes the librarian a favour.', '',
].join('\n');

const STORY = '---\ntype: character-story\n---\n\n### Session 1 — The Road\n\n*Ilse reads a card she never wrote.*\n\nLong prose.\n\n### Session 2 — The Gate\n\nShe is turned away. Later.\n';

describe('background parts never carry gm-only text', () => {
  const site = buildBoth({
    'Characters/PCs/Ilse_Varn.md': PC,
    'Characters/PCs/Ilse_Varn_Story.md': STORY,
  }, { vault: { system: 'dnd-5e-2024' } });
  after(() => site.cleanup());
  const secrets = [/BACKSTORY-GM-SECRET/, /APPEARANCE-GM-SECRET/];

  it('background parts never carry gm-only text', () => {
    const pcRel = ['characters', 'pcs', 'ilse-varn.html'];
    const player = site.player.read(...pcRel);
    // The page really did show the story: the leak check is not passing on an empty page.
    assert.match(player, /class="pc-prologue"/);
    assert.match(player, /For a hundred years Ilse kept the index/);
    assert.match(player, /Tall and narrow/);
    assert.ok(site.player.exists('characters', 'pcs', 'index.html'));
    assert.ok(site.player.exists('story', 'characters', 'ilse-varn.html'));
    assert.ok(site.player.exists('previews.json'));
    assert.ok(site.player.exists('search-index.json'));
    assert.match(site.player.read('characters', 'pcs', 'index.html'), /card-hook">For a hundred years Ilse kept the index\./);
    for (const file of site.player.files()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const secret of secrets) assert.doesNotMatch(text, secret, path.relative(site.player.dir, file));
    }
    const gm = site.gm.read(...pcRel);
    for (const secret of secrets) assert.match(gm, secret);
    // The GM page shows the hidden line marked in the story, never unmarked as the pull quote.
    const quote = gm.split('class="pull-quote">')[1].split('</div>')[0];
    assert.equal(quote, 'For a hundred years Ilse kept the index.');
  });

  it('the story page opens with the prologue; the gm-only line stays off the player copy', () => {
    const storyRel = ['story', 'characters', 'ilse-varn.html'];
    const player = site.player.read(...storyRel);
    assert.match(player, /class="pc-prologue"/);
    assert.match(player, /For a hundred years Ilse kept the index/);
    assert.ok(player.indexOf('pc-prologue') < player.indexOf('Session 1'));
    assert.doesNotMatch(player, /BACKSTORY-GM-SECRET/);
    assert.match(site.gm.read(...storyRel), /BACKSTORY-GM-SECRET/);
  });

  it('the PC page lists a line per session, linked to the story page', () => {
    const player = site.player.read('characters', 'pcs', 'ilse-varn.html');
    assert.match(player, /href="\.\.\/\.\.\/story\/characters\/ilse-varn\.html#session-1"/);
    assert.match(player, /Ilse reads a card she never wrote\./);
    assert.match(player, /She is turned away\./);
  });
});

describe('a hidden summary line never becomes the story-so-far line', () => {
  const HIDDEN = 'SUMMARY-GM-SECRET Ilse already knows who forged the card.';
  const story = '---\ntype: character-story\n---\n\n### Session 1 — The Road\n\n'
    + `<!-- gm-only -->\n*${HIDDEN}*\n<!-- /gm-only -->\n\nIlse follows the road south. Rain comes.\n\n`
    + '### Session 2 — The Gate\n\n*She is turned away.*\n\nProse.\n';
  const site = buildBoth({
    'Characters/PCs/Ilse_Varn.md': PC,
    'Characters/PCs/Ilse_Varn_Story.md': story,
  }, { vault: { system: 'dnd-5e-2024' } });
  after(() => site.cleanup());

  it('falls back to the next visible sentence and leaks nowhere', () => {
    const page = site.player.read('characters', 'pcs', 'ilse-varn.html');
    assert.match(page, /Ilse follows the road south\./);
    assert.match(page, /She is turned away\./);
    for (const file of site.player.files()) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /SUMMARY-GM-SECRET/, path.relative(site.player.dir, file));
    }
    assert.match(site.gm.read('story', 'characters', 'ilse-varn.html'), /SUMMARY-GM-SECRET/);
  });
});
