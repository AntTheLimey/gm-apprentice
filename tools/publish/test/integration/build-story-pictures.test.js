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

describe('Story pictures: scenes that give no picture', () => {
  const pics = {};
  for (const n of ['dropped', 'paused', 'other', 'callout', 'gmnotes', 'unnamed']) pics[`_attachments/${n}.png`] = png(40, 30);
  const at = (n) => `Chapters/Chapter 1/Scenes/Scene_${n}.md`;
  const s = buildBoth(storyVault({
    ...SCENE_FILES,
    ...pics,
    [SCENE_AT]: null,
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

  it('a dropped or paused scene, one played in another session, a picture in a callout or under GM Notes, and a scene whose places the recap never names: no picture on either site', () => {
    for (const site of [s.player, s.gm]) {
      for (const story of [STORY_1, 'story/chapter-1-docks-session-2.html']) {
        const page = read(site, story);
        for (const n of ['dropped', 'paused', 'other', 'callout', 'gmnotes', 'unnamed']) assert.ok(!page.includes(`images/${n}.`), `${n} on ${story}`);
      }
      assert.deepEqual(captions(read(site, STORY_1)), ['Captain Rook']);
      for (const [file, text] of builtText(site, { gm: site === s.gm })) {
        for (const tag of ['D', 'P', 'O', 'C', 'G', 'U']) {
          assert.ok(!text.includes(`SCENESECRET-${tag}`) && !text.includes(`SCENETITLE-${tag}`), `scene ${tag} text in ${file}`);
        }
      }
    }
    assert.deepEqual(brokenLinks(s.player.dir), []);
    assert.deepEqual(brokenLinks(s.gm.dir), []);
  });
});
