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
const { storyVault, WRAP_1, WRAP_2, SESSION, CHAPTER } = require('../helpers/story-vault');
const { brokenLinks } = require('../helpers/site-links');
const { makePng } = require('../helpers/make-png');
const { runLeakGate } = require('../../lib/leak-gate');

const STORY_1 = 'story/chapter-1-docks-session-1.html';
const STORY_2 = 'story/chapter-1-docks-session-2.html';
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
  // The chapter's introduction names no page, so these tests read each session's Story page on its own: a page the
  // introduction pictured would not be pictured again in its chapter (once per chapter, below).
  'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('The docks, CHAPTER-BODY-1.', 'The harbour, CHAPTER-BODY-1.'),
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

describe('Story pictures: a prop listed in its container with no page of its own on the player site', () => {
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/key.png': png(),
    'Documents/Bookshelf.md': '---\ntype: prop\nprop_kind: container\n---\nA tall shelf in the study.\n',
    // Everything it says is the GM's: the player site lists it in the bookshelf with no page; the GM site gives it one.
    'Documents/Brass Key.md': '---\ntype: prop\nprop_kind: object\nprop_container: "[[Bookshelf]]"\nportrait: key.png\n---\n<!-- gm-only -->\nIt opens the crypt.\n<!-- /gm-only -->\n',
    'Sessions/Session 1 Wrap-Up.md': withRecap('The party found the Brass Key on a shelf.\n\nLater Captain Rook bought a round.'),
  }));
  after(() => s.cleanup());

  it('is pictured on neither site: the GM page shows what the player page shows', () => {
    assert.ok(!s.player.files().some((f) => /brass-key\.html$/.test(f)), 'no page on the player site');
    assert.ok(s.gm.files().some((f) => /brass-key\.html$/.test(f)), 'a page on the GM site');
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.ok(!page.includes('images/key.'), site === s.gm ? 'gm' : 'player');
      assert.deepEqual(captions(page), ['Captain Rook']);
    }
  });
});

describe('Story pictures: longest match wins against a page with no portrait', () => {
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/james.png': png(),
    'NPCs/James Pelham.md': note('npc', 'James Pelham', 'james.png', 'aliases: ["Pelham"]\n'),
    'NPCs/Lady Anne Pelham.md': note('npc', 'Lady Anne Pelham', null),
    'Sessions/Session 1 Wrap-Up.md': withRecap('Lady Anne Pelham arrived.\n\nLater Captain Rook bought a round.'),
  }));
  after(() => s.cleanup());

  it('"Pelham" inside "Lady Anne Pelham" pictures nothing on either site', () => {
    for (const site of [s.player, s.gm]) assert.deepEqual(captions(read(site, STORY_1)), ['Captain Rook']);
  });
});

describe('Story pictures: longest match wins', () => {
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/james.png': png(),
    '_attachments/anne.png': png(),
    'NPCs/James Pelham.md': note('npc', 'James Pelham', 'james.png', 'aliases: ["Pelham"]\n'),
    'NPCs/Lady Anne Pelham.md': note('npc', 'Lady Anne Pelham', 'anne.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap('Lady Anne Pelham poured the tea.\n\nLater Pelham came home.'),
  }));
  after(() => s.cleanup());

  it('an alias inside another page\'s longer title is not a mention there; both sites agree', () => {
    for (const site of [s.player, s.gm]) {
      const figs = figures(read(site, STORY_1));
      assert.deepEqual(figs.map((f) => f.captions), [['Lady Anne Pelham'], ['James Pelham']]);
    }
  });
});

describe('Story pictures: a name inside the words of a link to another page', () => {
  const s = buildBoth(storyVault({ ...PEOPLE,
    '_attachments/station.png': png(40, 30),
    'Locations/MacMillian Station IV.md': note('location', 'MacMillian Station IV', 'station.png', 'aliases: ["MacMillian Station"]\n'),
    'Locations/Station Security HQ.md': note('location', 'Station Security HQ', null),
    'Sessions/Session 1 Wrap-Up.md': withRecap('Six went to [[Station Security HQ|MacMillian Station security HQ]].\n\nNobody slept.\n\n'
      + 'Then [[MacMillian Station IV|MacMillian Station]] itself.') }));
  after(() => s.cleanup());

  it('is not a mention of the named page; a link to the page itself is, on both sites', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.deepEqual(captions(page), ['MacMillian Station IV']);
      assert.match(page, /<\/figure><\/div><p>Then /);
    }
  });
});

// A scene note never publishes; only its picture may, beside the paragraph that names one of its places or people.
const SCENE_AT = 'Chapters/Chapter 1/Sessions/Session 1/Scenes/Scene_Docks.md';
const scene = ({ played = '["[[Session 1]]"]', status = 'played', locations = '["[[The Docks]]"]', entities = '[]', picture = '![[scene-docks.png]]', tag = '1' } = {}) => `---
type: scene
chapter: "[[Chapter 1 Overview]]"
status: ${status}
played_in: ${played}
locations: ${locations}
entities: ${entities}
---

# Scene Docks SCENETITLE-${tag}

${picture}

**Situation:** SCENESECRET-${tag}: the smugglers unload at midnight.

<!-- gm-only -->

## GM Notes

SCENESECRET-${tag} again, and the GM's own picture. ![[scene-gm.png]]

<!-- /gm-only -->
`;
const SCENE_FILES = {
  ...PEOPLE,
  '_attachments/scene-docks.png': png(40, 30),
  '_attachments/scene-gm.png': png(40, 30),
  'Locations/The Docks.md': note('location', 'The Docks', null),
  [SCENE_AT]: scene(),
};
const SCENE_RECAP = 'The party reached [[The Docks]] at dusk and waited.\n\nLater Captain Rook bought a round.';
// Every built file of a site, as text. The GM site shows whole notes, scenes among them, so the files it builds from a
// scene note itself (its page, and that page's link preview and search entry) are left out there: everywhere else, on
// either site, no word of a scene may appear.
const SCENE_OWN = /\/scenes\/scene-[a-z]+\.html$|\/previews\.json$|\/search-index\.json$/;
const builtText = (site, { gm = false } = {}) => site.files()
  .filter((f) => !(gm && SCENE_OWN.test(f.split(path.sep).join('/'))))
  .map((f) => [f, fs.readFileSync(f, 'latin1')]);

describe('Story pictures: the scenes played that session', () => {
  const s = buildBoth(storyVault({ ...SCENE_FILES, 'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP) }));
  after(() => s.cleanup());

  it('the scene\'s picture is beside the paragraph naming its place, with no caption and an empty alt', () => {
    const page = read(s.player, STORY_1);
    const figs = figures(page);
    assert.equal(figs.length, 2);
    assert.equal(figs[0].srcs.length, 1);
    assert.match(figs[0].srcs[0], /^\.\.\/images\/scene-docks\.(png|webp)$/);
    assert.deepEqual(figs[0].captions, []);
    assert.deepEqual(figs[0].places, [true]);
    assert.match(page, /<img src="\.\.\/images\/scene-docks\.(png|webp)" alt="" loading="lazy">/);
    // Its link has a name of its own that says nothing of the scene; a page's picture is named by its alt.
    assert.match(page, /<a class="story-figure__open" href="\.\.\/images\/scene-docks\.(png|webp)" aria-label="Open picture"><img/);
    assert.equal((page.match(/aria-label="Open picture"/g) || []).length, 1);
    assert.match(page, /<\/figure><\/div><p>The party reached/);
    assert.deepEqual(figs[1].captions, ['Captain Rook']);
  });

  it('the GM Notes picture is in no built file and not copied; no text of the scene is in any built file', () => {
    // The GM site's own page of the scene shows its GM Notes picture; no other GM file names it.
    assert.ok(!s.player.files().some((f) => /scene-gm/.test(f)), 'not copied to the player site');
    assert.ok(read(s.gm, 'chapters/chapter 1/sessions/session 1/scenes/scene-docks.html').includes('SCENESECRET-1'), 'the GM site still has the scene\'s own page');
    for (const site of [s.player, s.gm]) {
      for (const [file, text] of builtText(site, { gm: site === s.gm })) {
        for (const needle of ['scene-gm', 'SCENESECRET-1', 'SCENETITLE-1', 'Scene_Docks', 'Scene Docks', 'smugglers unload']) {
          assert.ok(!text.includes(needle), `${needle} in ${file}`);
        }
      }
    }
  });

  it('every link resolves, the leak gate finds nothing, and the GM page shows the same pictures', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
    const shape = (html) => figures(html).map((f) => ({ ...f, srcs: f.srcs.map((x) => x.replace(/\.webp$/, '.png')) }));
    assert.deepEqual(shape(read(s.gm, STORY_1)), shape(read(s.player, STORY_1)));
  });
});

describe('Story pictures: a scene linking its place in another case, or with underscores', () => {
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    [SCENE_AT]: scene({ locations: '["[[the docks]]"]' }),
    'Chapters/Chapter 1/Scenes/Scene_Rook.md': scene({ locations: '[]', entities: '["[[captain_rook]]"]', picture: '![[scene-gm.png]]', tag: 'R' }),
    'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP),
  }));
  after(() => s.cleanup());

  it('is pictured as if linked by the page\'s own name', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.match(page, /images\/scene-docks\.(png|webp)" alt="" loading="lazy">[\s\S]*?<\/figure><\/div><p>The party reached/);
      assert.match(page, /images\/scene-gm\.(png|webp)" alt="" loading="lazy">[\s\S]*?<\/figure><\/div><p>Later Captain Rook/);
    }
  });
});

describe('Story pictures: a scene whose picture is a page\'s portrait', () => {
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    'Locations/The Docks.md': note('location', 'The Docks', 'scene-docks.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP),
  }));
  after(() => s.cleanup());

  it('gives one picture, the portrait, not two', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.equal((page.match(/images\/scene-docks\./g) || []).length, 2, 'one figure: its link and its img');
      assert.deepEqual(captions(page), ['The Docks', 'Captain Rook']);
    }
  });
});

describe('Story pictures: a scene whose picture is the portrait of a page the recap never names', () => {
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    'NPCs/Mara Quill.md': note('npc', 'Mara Quill', 'scene-docks.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP),
  }));
  after(() => s.cleanup());

  it('is placed at the first mention of the scene\'s places, as the scene\'s picture: no name of a page the paragraph never names; both sites agree and no scene text shows', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.equal((page.match(/images\/scene-docks\./g) || []).length, 2, 'one figure: its link and its img');
      assert.match(page, /images\/scene-docks\.(png|webp)" alt="" loading="lazy">[\s\S]*?<\/figure><\/div><p>The party reached/);
      assert.ok(!page.includes('alt="Mara Quill"'));
      assert.deepEqual(captions(page), ['Captain Rook']);
      for (const [file, text] of builtText(site, { gm: site === s.gm })) {
        for (const needle of ['SCENESECRET-1', 'SCENETITLE-1', 'smugglers unload']) assert.ok(!text.includes(needle), `${needle} in ${file}`);
      }
    }
    const shape = (html) => figures(html).map((f) => ({ ...f, srcs: f.srcs.map((x) => x.replace(/\.webp$/, '.png')) }));
    assert.deepEqual(shape(read(s.gm, STORY_1)), shape(read(s.player, STORY_1)));
  });
});

describe('Story pictures: scenes that give no picture', () => {
  const NONE = ['dropped', 'paused', 'other', 'callout', 'gmnotes', 'unnamed', 'ready', 'planned', 'modified', 'unmarked', 'moved'];
  const pics = { '_attachments/bay.png': png(40, 30) };
  for (const n of NONE) pics[`_attachments/${n}.png`] = png(40, 30);
  const at = (n) => `Chapters/Chapter 1/Scenes/Scene_${n}.md`;
  // Session 1's index sits in its own folder, beside the Scenes/ folder the prep for it was written in, with its Plan.
  const S1 = 'Chapters/Chapter 1/Sessions/Session 1';
  const linked = (text, link) => text.replace('played_in:', `session: "${link}"\nplayed_in:`);
  // Prep not yet played (as a real vault keeps it): no played_in, a status other than played, linked to the Plan.
  const prep = (status, tag) => linked(scene({ played: '[]', status, picture: `![[${tag}.png]]`, tag }), '[[Session 1 Plan]]');
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    ...pics,
    [SCENE_AT]: null,
    'Sessions/Session 1.md': null,
    [`${S1}/Session 1.md`]: SESSION(1),
    [`${S1}/Session 1 Plan.md`]: '---\ntype: session-plan\nsession: "[[Session 1]]"\npublish: false\n---\n\n# Session 1 Plan\n',
    [`${S1}/Scenes/Scene_Ready.md`]: prep('ready', 'ready'),
    [`${S1}/Scenes/Scene_Planned.md`]: prep('planned', 'planned'),
    [`${S1}/Scenes/Scene_Modified.md`]: prep('modified', 'modified'),
    [`${S1}/Scenes/Scene_Unmarked.md`]: scene({ played: '[]', status: 'ready', picture: '![[unmarked.png]]', tag: 'unmarked' }),
    // Played, with no played_in, and re-linked to Session 2 though it still sits in Session 1's Scenes/: Session 2 only.
    [`${S1}/Scenes/Scene_Moved.md`]: linked(scene({ played: '[]', locations: '["[[The Docks]]", "[[The Bay]]"]', picture: '![[moved.png]]', tag: 'moved' }), '[[Session 2]]'),
    'Locations/The Bay.md': note('location', 'The Bay', null),
    'Sessions/Session 2 Wrap-Up.md': WRAP_2.replace('crossed the bay at night', 'crossed [[The Bay]] at night'),
    'Locations/Salt Row.md': note('location', 'Salt Row', null),
    [at('Dropped')]: scene({ status: 'dropped', picture: '![[dropped.png]]', tag: 'D' }),
    [at('Paused')]: scene({ status: 'paused', picture: '![[paused.png]]', tag: 'P' }),
    // Not played in Session 1, though it sits in Session 1's folder: Session 2's recap never names the docks.
    'Chapters/Chapter 1/Sessions/Session 1/Scenes/Scene_Other.md': scene({ played: '["[[Session 2]]"]', picture: '![[other.png]]', tag: 'O' }),
    [at('Callout')]: scene({ picture: '> [!note] Keeper\n> ![[callout.png]]', tag: 'C' }),
    [at('Gmnotes')]: scene({ picture: '', tag: 'G' }).replace('![[scene-gm.png]]', '![[gmnotes.png]]'),
    [at('Unnamed')]: scene({ locations: '["[[Salt Row]]"]', picture: '![[unnamed.png]]', tag: 'U' }),
    'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP),
  }));
  after(() => s.cleanup());

  it('a dropped or paused scene, one played in another session, prep not marked played, a picture in a callout or under GM Notes, and a scene whose places the recap never names: no picture on either site', () => {
    for (const site of [s.player, s.gm]) {
      for (const story of [STORY_1, STORY_2]) {
        const page = read(site, story);
        for (const n of NONE) if (!(n === 'moved' && story === STORY_2)) assert.ok(!page.includes(`images/${n}.`), `${n} on ${story}`);
      }
      assert.deepEqual(captions(read(site, STORY_1)), ['Captain Rook']);
      // The played scene re-linked to Session 2 is pictured there, by the place Session 2's recap names.
      assert.equal(figures(read(site, STORY_2)).length, 1);
      assert.match(read(site, STORY_2), /images\/moved\.(png|webp)" alt="" loading="lazy">[\s\S]*?<\/figure><\/div><p>The party crossed/);
      for (const [file, text] of builtText(site, { gm: site === s.gm })) {
        for (const tag of ['D', 'P', 'O', 'C', 'G', 'U', 'ready', 'planned', 'modified', 'unmarked', 'moved']) {
          assert.ok(!text.includes(`SCENESECRET-${tag}`) && !text.includes(`SCENETITLE-${tag}`), `scene ${tag} text in ${file}`);
        }
      }
    }
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });
});

describe('Story pictures: a scene picture the player site cannot have', () => {
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    '_attachments/gm/secret-map.png': png(40, 30),
    '_attachments/html-gm.png': png(40, 30),
    // Its picture sits in a folder the player site hides.
    [SCENE_AT]: scene({ picture: '![[_attachments/gm/secret-map.png]]' }),
    // Its only picture is under an HTML heading, as GM Notes written in HTML.
    'Chapters/Chapter 1/Scenes/Scene_Html.md': scene({ picture: '<h2>GM Notes</h2>\n![[html-gm.png]]', tag: 'H' }),
    'Sessions/Session 1 Wrap-Up.md': withRecap(SCENE_RECAP),
  }), { player: { hide: { folders: ['_attachments/gm'] } } });
  after(() => s.cleanup());

  it('a picture in a hidden folder, or under an HTML heading, is on neither Story page and not copied to the player site', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.ok(!page.includes('secret-map'), `hidden folder, ${site === s.gm ? 'gm' : 'player'}`);
      assert.ok(!page.includes('html-gm'), `HTML heading, ${site === s.gm ? 'gm' : 'player'}`);
      assert.deepEqual(captions(page), ['Captain Rook']);
    }
    assert.ok(!s.player.files().some((f) => /secret-map|html-gm/.test(f)), 'not copied to the player site');
  });
});

describe('Story pictures: player_site.story.pictures off', () => {
  const recap = 'Captain Rook came aboard.\n\n![[rook.png]]\n\nAt dawn [[Mara Quill]] waved from [[The Docks]].';
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    'Locations/The Docks.md': note('location', 'The Docks', 'docks.png'),
    'Sessions/Session 1 Wrap-Up.md': withRecap(recap),
  }), { player: { story: { pictures: false } } });
  after(() => s.cleanup());

  it('off: no story-figures on either site; a GM-placed picture stays; the portrait file is not copied for the Story page alone', () => {
    for (const site of [s.player, s.gm]) {
      const page = read(site, STORY_1);
      assert.ok(!page.includes('story-figure'), 'no story figure');
      assert.equal((page.match(/images\/rook\./g) || []).length, 1, 'the picture the GM placed stays');
      assert.ok(!page.includes('scene-docks'), 'no scene picture either');
    }
    // Player site only: the GM site builds the scene's own page, which shows the picture, so it copies the file anyway.
    assert.ok(!s.player.files().some((f) => /scene-docks/.test(f)), 'the scene picture is not copied');
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });

  it('the setting has no gm_site twin', () => {
    const { entry, NOT_PER_SITE } = require('../../lib/settings/registry');
    assert.equal(entry('player_site.story.pictures').default, true);
    assert.ok(NOT_PER_SITE.has('player_site.story.pictures'));
    assert.equal(entry('gm_site.story.pictures'), undefined);
  });
});

describe('Story pictures: once per chapter, and companions', () => {
  const CH2 = '---\ntype: chapter\ntitle: Chapter 2 — Hills\nsort_order: 2\n---\n\n# Chapter 2 — Hills\n';
  const s3 = SESSION(3).replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]');
  const wrap3 = WRAP_2.replace(/Session 2/g, 'Session 3').replace('session_number: 2', 'session_number: 3')
    .replace('[[Chapter 1 Overview]]', '[[Chapter 2 Overview]]')
    .replace(/## Narrative Recap\n\n[^\n]*\n/, '## Narrative Recap\n\nIn the hills [[Mara Quill]] and Thomas Wyndham waited.\n');
  const wrap2 = WRAP_2.replace(/## Narrative Recap\n\n[^\n]*\n/, '## Narrative Recap\n\n'
    + 'Captain Rook rowed and [[Mara Quill]] counted the coins.\n\nOld Smith met them, with Thomas Wyndham.\n');
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/smith.png': png(),
    '_attachments/thomas.png': png(),
    '_attachments/silas.png': png(),
    'NPCs/Old Smith.md': note('npc', 'Old Smith', 'smith.png'),
    'NPCs/Thomas Wyndham.md': note('npc', 'Thomas Wyndham', 'thomas.png', 'companion: true\n'),
    'NPCs/Silas Wyndham.md': note('npc', 'Silas Wyndham', 'silas.png', 'aliases: ["Wyndham"]\n'),
    // The introduction ("The docks, ...") comes first in the chapter, so it pictures The Docks.
    'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER,
    'Sessions/Session 1 Wrap-Up.md': withRecap('[[Mara Quill]] met Thomas Wyndham at the docks.\n\n![[rook.png]]\n\nCaptain Rook nodded.'),
    'Sessions/Session 2 Wrap-Up.md': wrap2,
    'Chapters/Chapter 2/Chapter 2 Overview.md': CH2,
    'Sessions/Session 3.md': s3,
    'Sessions/Session 3 Wrap-Up.md': wrap3,
    'Sessions/Session 3 Play Notes.md': null,
  }));
  after(() => s.cleanup());
  const STORY_3 = 'story/chapter-2-hills-session-3.html';

  it('a page pictured earlier in the chapter, or whose picture the GM placed there, is not pictured again', () => {
    for (const site of [s.player, s.gm]) {
      assert.deepEqual(captions(read(site, 'story/chapter-1-docks-intro.html')), ['The Docks']);
      assert.deepEqual(captions(read(site, STORY_1)), ['Mara Quill']);
      assert.equal((read(site, STORY_1).match(/images\/rook\./g) || []).length, 1, 'the picture the GM placed stays');
      assert.deepEqual(captions(read(site, STORY_2)), ['Old Smith']);
    }
  });

  it('a new chapter pictures it again', () => {
    for (const site of [s.player, s.gm]) assert.deepEqual(captions(read(site, STORY_3)), ['Mara Quill']);
  });

  it('a companion is never pictured, and its name still holds its words', () => {
    for (const site of [s.player, s.gm]) {
      for (const story of [STORY_1, STORY_2, STORY_3]) {
        const page = read(site, story);
        assert.ok(!/images\/(thomas|silas)\./.test(page), `${story} on ${site === s.gm ? 'gm' : 'player'}`);
      }
    }
    assert.ok(s.player.files().some((f) => /thomas-wyndham\.html$/.test(f)), 'the companion still has a page');
  });

  it('every link resolves and the leak gate finds nothing', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});

describe('Story pictures: once per chapter, with a Story page only the GM site has', () => {
  const hidden = (text) => text.replace('---\n', '---\npublish: false\n');
  const s = buildBoth(storyVault({
    ...PEOPLE,
    'Sessions/Session 1.md': hidden(SESSION(1)),
    'Sessions/Session 1 Wrap-Up.md': hidden(withRecap('[[Mara Quill]] waited.')),
    'Sessions/Session 2 Wrap-Up.md': WRAP_2.replace('crossed the bay at night', 'crossed the bay with [[Mara Quill]] at night'),
  }));
  after(() => s.cleanup());

  it('the GM page players do not have does not keep the next page from picturing what the player page pictures', () => {
    assert.ok(!s.player.files().some((f) => f.endsWith('chapter-1-docks-session-1.html')), 'players have no Session 1 Story page');
    assert.deepEqual(captions(read(s.gm, STORY_1)), ['Mara Quill']);
    assert.deepEqual(captions(read(s.player, STORY_2)), ['Mara Quill']);
    assert.deepEqual(captions(read(s.gm, STORY_2)), ['Mara Quill']);
  });
});

describe('Story pictures: once per chapter, a picture left out for room', () => {
  const s = buildBoth(storyVault({
    ...PEOPLE,
    '_attachments/smith.png': png(),
    'NPCs/Old Smith.md': note('npc', 'Old Smith', 'smith.png'),
    // Three pages in one paragraph: two fit beside it, and Old Smith has no other mention on this page.
    'Sessions/Session 1 Wrap-Up.md': withRecap('[[Mara Quill]], Captain Rook and Old Smith met at dusk.'),
    'Sessions/Session 2 Wrap-Up.md': WRAP_2.replace('crossed the bay at night', 'crossed the bay with Old Smith and [[Mara Quill]] at night'),
  }));
  after(() => s.cleanup());

  it('is pictured on the next Story page of the chapter that names it; what was pictured is not', () => {
    for (const site of [s.player, s.gm]) {
      assert.deepEqual(captions(read(site, STORY_1)), ['Mara Quill', 'Captain Rook']);
      assert.deepEqual(captions(read(site, STORY_2)), ['Old Smith']);
    }
  });
});

describe('Story pictures: once per chapter, a held-back wrap-up on a page where players see another wrap-up (#569)', () => {
  // Two chapter wrap-ups: the GM site's Story page leads with the first, which players do not see; the player page at
  // the same address leads with the second. The chapter note has no introduction, so players have no recap of their
  // own there (no heldBack). Later pages in the chapter count what the player page pictured, on both sites.
  const chapterWrap = (recap, extra = '') => `---\ntype: session_wrap\nchapter: "[[Chapter 1 Overview]]"\n${extra}---\n\n# Chapter 1 Wrap-Up\n\n## Narrative Recap\n\n${recap}\n`;
  const s = buildBoth(storyVault({
    ...PEOPLE,
    'Chapters/Chapter 1/Chapter 1 Overview.md': CHAPTER.replace('sort_order: 1\n', 'sort_order: 1\nstatus: complete\n').replace('\n## Overview\n\nThe docks, CHAPTER-BODY-1.\n', ''),
    'Chapters/Chapter 1/Chapter 1 Wrap-Up A.md': chapterWrap('Captain Rook kept the books.', 'publish: false\n'),
    'Chapters/Chapter 1/Chapter 1 Wrap-Up B.md': chapterWrap('[[Mara Quill]] kept the books.'),
    'Sessions/Session 1 Wrap-Up.md': withRecap('[[Mara Quill]] and Captain Rook met at dusk.').replace('canon_status: DRAFT\n', ''),
  }));
  after(() => s.cleanup());
  const INTRO = 'story/chapter-1-docks-intro.html';

  it('the GM page leads with the recap the player page shows, pictured as it is there, then its own wrap-up marked', () => {
    assert.deepEqual(captions(read(s.player, INTRO)), ['Mara Quill']);
    const gm = read(s.gm, INTRO);
    assert.deepEqual(captions(gm), ['Mara Quill']);
    assert.ok(gm.includes('<a href="../npcs/mara-quill.html">Mara Quill</a> kept the books.'), 'the players\' recap is on the GM page');
    assert.ok(gm.includes('Captain Rook kept the books.'), 'the held-back wrap-up is on the GM page too');
    assert.ok(gm.indexOf('Mara Quill</a> kept the books.') < gm.indexOf('Captain Rook kept the books.'), 'the players\' recap leads');
    assert.doesNotMatch(gm, /players see another Story page here/);
    assert.match(gm, /This wrap-up is held back from players/);
  });

  it('the next page pictures what the player site pictures', () => {
    assert.deepEqual(captions(read(s.player, STORY_1)), ['Captain Rook']);
    assert.deepEqual(captions(read(s.gm, STORY_1)), ['Captain Rook']);
  });

  it('every link resolves and the leak gate finds nothing', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});

describe('Story pictures: a session whose wrap-up is held back, where players see another wrap-up and the session has its own recap (#569)', () => {
  // The session's own recap is not what the player page shows: the player page is made from the other wrap-up in the
  // session's folder. The GM page leads with that one, as the players' recap.
  const hub = SESSION(1).replace('HUB-BODY-1: what the GM prepped.\n', '## Narrative Recap\n\nHUB-RECAP-1: the GM\'s own notes.\n');
  const other = '---\ntype: session_wrap\n---\n\n# Session 1 Recap\n\n## Narrative Recap\n\nCaptain Rook rowed the party out.\n';
  const s = buildBoth(storyVault({
    ...PEOPLE,
    'Sessions/Session 1.md': null,
    'Sessions/Session 1 Wrap-Up.md': null,
    'Sessions/Session 1 Play Notes.md': null,
    'Sessions/One/Session 1.md': hub,
    'Sessions/One/Session 1 Wrap-Up.md': withRecap('[[Mara Quill]] waited.').replace('---\n', '---\npublish: false\n'),
    'Sessions/One/Session 1 Recap.md': other,
  }));
  after(() => s.cleanup());

  it('the GM page\'s players\' recap is the one the player page shows', () => {
    const player = read(s.player, STORY_1);
    assert.ok(player.includes('Captain Rook rowed the party out.'), 'the player page is made from the other wrap-up');
    assert.ok(!player.includes('HUB-RECAP-1'));
    const gm = read(s.gm, STORY_1);
    assert.ok(gm.includes('Captain Rook rowed the party out.'), 'the GM page leads with what players see');
    assert.ok(!gm.includes('HUB-RECAP-1'), 'not the session\'s own recap, which players do not see here');
    assert.deepEqual(captions(gm), captions(player));
  });

  it('every link resolves and the leak gate finds nothing', () => {
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
    assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.player.dir }).findings, []);
  });
});
