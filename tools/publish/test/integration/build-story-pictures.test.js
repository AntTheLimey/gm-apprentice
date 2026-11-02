'use strict';
// Story page 9b: the people and places a recap names are pictured beside the paragraph that first names them, on both
// sites. Only a page the player site publishes, with a portrait the build has, and not a PC; a picture the GM placed
// stays where it is and its page gets no second one; nothing hidden is pictured, and the GM page shows the same
// pictures as the player page.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/quiet-legacy-warning.js');
const { buildBoth } = require('../helpers/gm-build');
const { storyVault, WRAP_1, SESSION } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { makePng } = require('../helpers/make-png');
const { runLeakGate } = require('../../lib/leak-gate');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const read = (site, p) => site.read(...p.split('/'));
const png = (w = 30, h = 40) => makePng(w, h);

const note = (type, title, portrait, extra = '') => `---\ntype: ${type}\ntitle: ${title}\n${portrait ? `portrait: ${portrait}\n` : ''}${extra}---\n\n# ${title}\n\nBODY of ${title}.\n`;
const withRecap = (recap) => WRAP_1.replace(/## Narrative Recap\n\n[^\n]*\n/, `## Narrative Recap\n\n${recap}\n`);

// The figure blocks on a page, in order: { classes, captions, srcs, places }.
function figures(html) {
  const out = [];
  const re = /<div class="(story-figures[^"]*)">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[2];
    out.push({
      classes: m[1].split(/\s+/),
      captions: [...body.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((x) => x[1]),
      srcs: [...body.matchAll(/<img src="([^"]+)"/g)].map((x) => x[1]),
      places: [...body.matchAll(/<figure class="([^"]+)"/g)].map((x) => x[1].split(/\s+/).includes('story-figure--place')),
    });
  }
  return out;
}
const captions = (html) => figures(html).flatMap((f) => f.captions);

const PEOPLE = {
  '_attachments/mara.png': png(),
  '_attachments/docks.png': png(40, 30),
  '_attachments/six.png': png(),
  '_attachments/rook.png': png(),
  'NPCs/Mara Quill.md': note('npc', 'Mara Quill', 'mara.png'),
  'Locations/The Docks.md': note('location', 'The Docks', 'docks.png'),
  'PCs/Six.md': note('pc', 'Six', 'six.png'),
  'NPCs/Captain Rook.md': note('npc', 'Captain Rook', 'rook.png'),
};
const RECAP = 'The party reached the docks at dusk, where [[Mara Quill]] waited with a lantern and a ledger. Six watched from a roof.\n\n'
  + 'Later Captain Rook bought a round and Mara Quill paid for it.\n\nNobody slept.';

describe('Story pictures: the people and places a recap names', () => {
  const s = buildBoth(storyVault({ ...PEOPLE, 'Sessions/Session 1 Wrap-Up.md': withRecap(RECAP) }));
  after(() => s.cleanup());

  it('an NPC and a location named in the recap are pictured beside their first mention; the PC is not', () => {
    const page = read(s.player, STORY_1);
    const figs = figures(page);
    assert.deepEqual(figs.map((f) => f.captions), [['The Docks', 'Mara Quill'], ['Captain Rook']]);
    assert.deepEqual(figs[0].places, [true, false]);
    assert.ok(figs[0].classes.includes('story-figures--two'));
    assert.ok(!figs[1].classes.includes('story-figures--two'));
    // Each float sits right before the paragraph that first names it.
    assert.match(page, /<\/figure><\/div><p>The party reached the docks/);
    assert.match(page, /<\/figure><\/div><p>Later Captain Rook/);
    assert.ok(!/six\.png/.test(page));
    assert.match(page, /<a class="story-figure__open" href="\.\.\/images\/mara\.(png|webp)"><img src="\.\.\/images\/mara\.(png|webp)" alt="Mara Quill" loading="lazy"><span class="story-figure__zoom" aria-hidden="true"><svg /);
  });

  it('the picture files are copied and every link resolves', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    for (const site of [s.player, s.gm]) {
      const srcs = figures(read(site, STORY_1)).flatMap((f) => f.srcs);
      assert.equal(srcs.length, 3);
      for (const src of srcs) assert.ok(fs.existsSync(path.join(site.dir, 'story', decodeURI(src))), src);
    }
  });

  it('sides alternate from the right', () => {
    const figs = figures(read(s.player, STORY_1));
    assert.ok(!figs[0].classes.includes('story-figures--left'));
    assert.ok(figs[1].classes.includes('story-figures--left'));
  });

  it('the GM page shows the same pictures', () => {
    assert.deepEqual(captions(read(s.gm, STORY_1)), captions(read(s.player, STORY_1)));
  });

  it('the leak gate finds nothing on the built player site', () => {
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});

describe('Story pictures: a picture the GM placed', () => {
  const recap = 'Captain Rook came aboard.\n\n![[rook.png]]\n\nAt dawn Captain Rook left, and [[Mara Quill]] waved.';
  const s = buildBoth(storyVault({ ...PEOPLE, 'Sessions/Session 1 Wrap-Up.md': withRecap(recap) }));
  after(() => s.cleanup());

  it('stays where it is, and its page gets no second one', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.equal((page.match(/images\/rook\./g) || []).length, 1, 'one picture of Rook');
      assert.deepEqual(captions(page), ['Mara Quill']);
    }
    assert.deepEqual(brokenLinks(s.player.dir), []);
  });
});

describe('Story pictures: a portrait the build does not have', () => {
  const recap = 'Ghost Gale, Web Wren and Hidden Hal met [[Mara Quill]].';
  const s = buildBoth(storyVault({
    ...PEOPLE,
    'NPCs/hidden.png': png(),
    'NPCs/Ghost Gale.md': note('npc', 'Ghost Gale', 'missing.png'),
    'NPCs/Web Wren.md': note('npc', 'Web Wren', 'https://example.com/wren.png'),
    'NPCs/Hidden Hal.md': note('npc', 'Hidden Hal', 'hidden.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap(recap),
  }));
  after(() => s.cleanup());

  it('a portrait missing from the vault, or a web address: no figure, no broken link', () => {
    for (const site of [s.player, s.gm]) assert.deepEqual(captions(read(site, STORY_1)), ['Mara Quill']);
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assert.ok(!read(s.player, STORY_1).includes('example.com/wren.png'));
  });
});

describe('Story pictures: a portrait in a folder the player site hides', () => {
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/gm/rook-gm.png': png(),
    'NPCs/Captain Rook.md': note('npc', 'Captain Rook', 'rook-gm.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap('Captain Rook met [[Mara Quill]].'),
  }), { player: { hide: { folders: ['_attachments/gm'] } } });
  after(() => s.cleanup());

  it('is pictured on neither site', () => {
    for (const site of [s.player, s.gm]) assert.deepEqual(captions(read(site, STORY_1)), ['Mara Quill']);
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });
});

describe('Story pictures: pages players do not see', () => {
  const recap = 'Pale Pete and Lord Zorn met Elias Crowe and [[Mara Quill]] in [[Agent Ash]]\'s cellar.';
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/pete.png': png(),
    '_attachments/zorn.png': png(),
    '_attachments/vane.png': png(),
    '_attachments/ash.png': png(),
    'NPCs/Pale Pete.md': note('npc', 'Pale Pete', 'pete.png', 'publish: false\n'),
    'NPCs/Lord Zorn.md': note('npc', 'Lord Zorn', 'zorn.png', 'publish: false\nwithheld: true\n'),
    'NPCs/Lord Vane.md': note('npc', 'Lord Vane', 'vane.png', 'gm_aliases: ["Elias Crowe"]\n'),
    // A title that names the withheld note: players read it with the withheld word in its place.
    'NPCs/Agent Ash.md': '---\ntype: npc\ntitle: "Ash, agent of [[Lord Zorn]]"\nportrait: ash.png\n---\n\n# Ash\n\nBODY.\n',
    'Sessions/Session 1 Wrap-Up.md': withRecap(recap),
  }));
  after(() => s.cleanup());

  it('a publish: false NPC, a withheld NPC and a page shown only on the GM site are pictured on neither site; a gm_aliases name pictures nothing', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      for (const x of ['pete.png', 'zorn.png', 'vane.png']) assert.ok(!page.includes(x), `${x} on ${site.dir}`);
    }
    assert.ok(read(s.gm, STORY_1).includes('Pale Pete'), 'the GM page still has the words');
  });

  it('the GM page\'s figure captions equal the player page\'s, and no caption carries the withheld name', () => {
    const player = captions(read(s.player, STORY_1));
    assert.deepEqual(captions(read(s.gm, STORY_1)), player);
    // Ash is found by the recap's link alone (its title is not in the recap), and captioned as players read it.
    assert.deepEqual(player, ['Mara Quill', 'Ash, agent of someone']);
    for (const c of player) assert.ok(!c.includes('Zorn'), c);
  });

  // The recap names the secret ones in plain text, so the leak gate rightly reports the recap; it is run on the clean
  // vault above.
  it('no broken link', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });
});

describe('Story pictures: a wrap-up the player site holds back', () => {
  // The session note has its own recap, so players have a Story page; the draft wrap-up is held back from it.
  const hub = SESSION(1).replace('HUB-BODY-1: what the GM prepped.\n', '## Narrative Recap\n\nCaptain Rook rowed the party out.\n');
  const s = buildBoth(storyVault({ ...PEOPLE, 'Sessions/Session 1.md': hub }), { player: { hide: { drafts: true } } });
  after(() => s.cleanup());

  it('pictures go in the recap the player page shows; the GM page shows the same ones', () => {
    assert.deepEqual(captions(read(s.player, STORY_1)), ['Captain Rook']);
    assert.deepEqual(captions(read(s.gm, STORY_1)), ['Captain Rook']);
    assert.ok(read(s.gm, STORY_1).includes('where <a href="../npcs/mara-quill.html">Mara Quill</a> waited'), 'the held-back recap is on the GM page');
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });
});
