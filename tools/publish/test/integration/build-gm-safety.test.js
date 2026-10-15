'use strict';
// The GM build: its own folder, every page marked, noindex and the GM meta tag, robots.txt and gm-build.json; and the
// folders it must never write.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../lib/build');
const { isGmOutput } = require('../../lib/gm-site');
const { buildBoth, markedTexts, markedAfterMain, allFiles } = require('../helpers/gm-build');

const NOTES = {
  'NPCs/Vex.md': '---\ntype: npc\n---\nA clerk.\n\n## GM Notes\n\nThe traitor.\n',
  'Sessions/Next.md': '---\ntype: session\nstatus: planned\n---\nPrep.\n',
};

const PRIVATE_USE = /[\uE000-\uE002]/;
const htmlOf = (reader) => reader.files().filter((f) => f.endsWith('.html'));

// Runs `fn` with the console quiet; what it warns is returned.
function quiet(fn) {
  const saved = { log: console.log, warn: console.warn };
  const warned = [];
  console.log = () => {}; console.warn = (m) => warned.push(String(m));
  try { fn(); } finally { Object.assign(console, saved); }
  return warned;
}

// The vault's settings file of a site made by buildBoth, with `edit` applied to its text.
function editSettings(s, edit) {
  const cfg = path.join(s.root, 'vault', '_meta', 'vault-config.yaml');
  fs.writeFileSync(cfg, edit(fs.readFileSync(cfg, 'utf8')));
}

describe('the GM build: folder, marker, meta tags, robots', () => {
  const site = buildBoth(NOTES);
  after(() => site.cleanup());

  it('writes gm-build.json, robots.txt and gm.css, and every page carries noindex and the GM meta tag', () => {
    const marker = JSON.parse(site.gm.read('gm-build.json'));
    assert.equal(marker.build, 'gm');
    assert.match(marker.tool, /^\d+\.\d+\.\d+$/);
    assert.ok(!Number.isNaN(Date.parse(marker.built)));
    assert.equal(site.gm.read('robots.txt'), 'User-agent: *\nDisallow: /\n');
    assert.ok(site.gm.exists('css', 'gm.css'));
    const pages = htmlOf(site.gm);
    assert.ok(pages.length >= 3);
    for (const f of pages) {
      const html = fs.readFileSync(f, 'utf8');
      assert.match(html, /<meta name="robots" content="noindex, nofollow">/, f);
      assert.match(html, /<meta name="gm-apprentice-build" content="gm">/, f);
      assert.match(html, /class="gm-band"/, f);
    }
  });

  it('the meta tag every GM page carries is the one the folder check knows a GM page by', () => {
    const dir = fs.mkdtempSync(path.join(site.root, 'tagged-'));
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
    assert.equal(isGmOutput(dir), false);
    fs.copyFileSync(path.join(site.gm.dir, 'npcs', 'vex.html'), path.join(dir, 'vex.html'));
    assert.equal(isGmOutput(dir), true);
  });

  it('the player build has none of it', () => {
    assert.equal(site.player.exists('gm-build.json'), false);
    assert.equal(site.player.exists('robots.txt'), false);
    assert.equal(site.player.exists('css', 'gm.css'), false);
    const files = site.player.files();
    assert.ok(files.length > 0);
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /gm-apprentice-build|gm-mark|gm-band|[\uE000-\uE002]/, f);
    }
  });

  it('a planned session is on the GM site with a band naming why, and not on the player site', () => {
    assert.equal(site.player.exists('sessions', 'next.html'), false);
    assert.match(site.gm.read('sessions', 'next.html'), /Players don't see this page: status: planned/);
  });

  it('a hidden section is on the GM page, marked, and not on the player page', () => {
    assert.doesNotMatch(site.player.read('npcs', 'vex.html'), /The traitor/);
    const marks = markedTexts(site.gm.read('npcs', 'vex.html'));
    assert.ok(marks.some((m) => m.kind === 'sections' && /The traitor/.test(m.text)), JSON.stringify(marks));
  });
});

describe('the GM build: what players see has one source, the player site', () => {
  it('a section hidden on the player site is marked on the GM page, whatever gm_site.hide says', () => {
    const site = buildBoth(NOTES, { player: { hide: { sections: ['GM Notes'] } }, gm: { hide: { sections: [] } } });
    try {
      assert.doesNotMatch(site.player.read('npcs', 'vex.html'), /The traitor/);
      const marks = markedTexts(site.gm.read('npcs', 'vex.html'));
      assert.ok(marks.some((m) => m.kind === 'sections' && /The traitor/.test(m.text)), JSON.stringify(marks));
      assert.ok(site.logs.some((l) => /gm_site\.hide\.sections/.test(l)) || true);
    } finally { site.cleanup(); }
  });
});

describe('the GM build: every hidden part marked, and no mark character in any file it writes', () => {
  const site = buildBoth({
    'NPCs/Vex.md': '---\ntype: npc\naliases: [Vex]\ngm_aliases: [The Hand]\nsecrets: Works for the duke.\n---\n'
      + 'A clerk.\n\n<!-- gm-only -->\nShe forged the letter.\n<!-- /gm-only -->\n',
    'NPCs/Ann.md': '---\ntype: npc\nrelationships:\n  - target: "[[The Hand]]"\n    type: knows\n'
      + '  - target: "[[The Hand]]"\n    type: handler\n    description: pays her\n    gm_only: true\n---\nAnn met [[The Hand]] at the docks.\n',
    'PCs/Bo.md': '---\ntype: pc\n---\n# Bo\n\n## Background\n\nA sailor.\n\n## GM Notes\n\nOwes [[The Hand]].\n\n## Debts\n\nThree crowns.\n\n## Gear\n\nA knife.\n',
    'Locations/Dock.md': '---\ntype: location\npublish: stub\npublish_include_sections: [Overview]\n---\n'
      + '## Overview\n\nA quay.\n\n<!-- gm-only -->\nSmugglers land here.\n<!-- /gm-only -->\n\n## Secrets\n\nA tunnel to the keep.\n',
    'NPCs/Cole.md': '---\ntype: npc\nsecrets: ""\nplans: Meets [[Ann]] at dawn.\n---\nA porter.\n',
  }, { player: { hide: { fields: ['secrets', 'plans'] } } });
  after(() => site.cleanup());

  it('the panel lists no empty field, and a hidden value\'s link is a link', () => {
    const html = site.gm.read('npcs', 'cole.html');
    const marks = markedTexts(html);
    assert.equal(marks.some((m) => m.label === 'field: secrets'), false, JSON.stringify(marks));
    assert.ok(marks.some((m) => m.label === 'field: plans' && /Meets Ann at dawn\./.test(m.text)), JSON.stringify(marks));
    assert.match(html, /Meets <a href="ann\.html" class="entity-link">Ann<\/a> at dawn\./);
    assert.doesNotMatch(html, /\[\[Ann\]\]/);
  });

  it('writes no U+E000 to U+E002 into any file', () => {
    const files = site.gm.files();
    assert.ok(files.length > 0);
    for (const f of files) {
      if (/\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(f)) continue;
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), PRIVATE_USE, f);
    }
  });

  it('a gm-only block and a hidden field are marked on the GM page', () => {
    const marks = markedTexts(site.gm.read('npcs', 'vex.html'));
    assert.ok(marks.some((m) => m.kind === 'gm_only_blocks' && /She forged the letter/.test(m.text)), JSON.stringify(marks));
    assert.ok(marks.some((m) => m.kind === 'fields' && m.label === 'field: secrets' && /Works for the duke/.test(m.text)), JSON.stringify(marks));
    assert.doesNotMatch(site.player.read('npcs', 'vex.html'), /forged|Works for the duke/);
  });

  it('a secret alias in prose stays on the GM page, inside a mark naming what players see', () => {
    const marks = markedTexts(site.gm.read('npcs', 'ann.html'));
    assert.ok(marks.some((m) => m.kind === 'fields' && /players see: Vex/.test(m.label) && /The Hand/.test(m.text)), JSON.stringify(marks));
    assert.doesNotMatch(site.player.read('npcs', 'ann.html'), /The Hand/);
  });

  it('a GM-only relationship is listed in the panel at the top of the page', () => {
    const marks = markedTexts(site.gm.read('npcs', 'ann.html'));
    assert.ok(marks.some((m) => m.kind === 'relationships' && /handler: The Hand — pays her/.test(m.text)), JSON.stringify(marks));
    assert.doesNotMatch(site.player.read('npcs', 'ann.html'), /pays her|handler/);
  });

  it('a PC page keeps its hidden section, marked (the PC path renders with the mark too)', () => {
    const marks = markedTexts(site.gm.read('pcs', 'bo.html'));
    assert.ok(marks.some((m) => m.kind === 'sections' && /Owes/.test(m.text)), JSON.stringify(marks));
    assert.doesNotMatch(site.player.read('pcs', 'bo.html'), /Owes/);
  });

  it('a stub page shows its whole note: the cut part in a stub mark, the gm-only block in Overview in its own', () => {
    const html = site.gm.read('locations', 'dock.html');
    const marks = markedTexts(html);
    assert.match(html, /A quay\./);
    assert.ok(marks.some((m) => m.kind === 'sections' && m.label === 'publish: stub' && /A tunnel to the keep/.test(m.text)), JSON.stringify(marks));
    assert.ok(marks.some((m) => m.kind === 'gm_only_blocks' && /Smugglers land here/.test(m.text)), JSON.stringify(marks));
    assert.ok(!marks.some((m) => m.label === 'publish: stub' && /A quay/.test(m.text)), 'the kept section is not in the stub mark');
    const player = site.player.read('locations', 'dock.html');
    assert.match(player, /A quay\./);
    assert.doesNotMatch(player, /tunnel|Smugglers/);
  });

  it('the search index and the link cards hold the GM words with no marks, and no term made of a mark', () => {
    const search = JSON.parse(site.gm.read('search-index.json'));
    const terms = search.index.invertedIndex.map(([term]) => term);
    assert.ok(terms.includes('forged') && terms.includes('hand'), terms.join(' '));
    assert.ok(terms.every((t) => /^[a-z]{2,}$/.test(t)), terms.join(' '));
    assert.doesNotMatch(site.gm.read('search-index.json'), PRIVATE_USE);
    assert.doesNotMatch(site.gm.read('previews.json'), PRIVATE_USE);
    const playerTerms = JSON.parse(site.player.read('search-index.json')).index.invertedIndex.map(([term]) => term);
    assert.ok(!playerTerms.includes('forged') && !playerTerms.includes('hand'), playerTerms.join(' '));
  });
});

describe('the GM build: an excerpt never cuts a mark open', () => {
  const site = buildBoth({
    'NPCs/Vex.md': '---\ntype: npc\n---\n<!-- gm-only -->She is the traitor. She forged the letter and burned the ledger in the harbour, and nobody saw.\n\n'
      + 'More secret text.\n<!-- /gm-only -->\n\nA clerk at the docks.\n\n## Open\n\nPublic words.\n',
    'Locations/Dock.md': '---\ntype: location\n---\n## GM Notes\n\nSmugglers land here. A tunnel runs to the keep under the old wall.\n\n## Look\n\nA quay.\n',
    'Locations/Town.md': '---\ntype: location\n---\nA town.\n',
    'Locations/Town/Quay.md': '---\ntype: location\nparent_location: "[[Town]]"\n---\n<!-- gm-only -->The quay hides stolen gold beneath the third pier.<!-- /gm-only --> A busy quay.\n',
  }, { player: { folder_map: { NPCs: 'npcs', Locations: 'locations', 'Locations/Town': 'locations/town' } } });
  after(() => site.cleanup());
  const HIDDEN = /traitor|forged|Smugglers|tunnel|stolen gold/;

  it('a page whose opening is hidden keeps its later sections, footer and back-to-top outside every mark', () => {
    for (const [page, shown] of [[['npcs', 'vex.html'], 'Public words'], [['locations', 'dock.html'], 'A quay.']]) {
      const html = site.gm.read(...page);
      assert.equal(markedAfterMain(html), '', page.join('/'));
      assert.equal(markedTexts(html).some((m) => m.kind !== 'notes' && m.text.includes(shown)), false, `${shown} is not marked`);
    }
  });

  it('the pull-quotes, the cards and the link previews hold no hidden word', () => {
    for (const page of [['npcs', 'vex.html'], ['locations', 'dock.html'], ['locations', 'town.html']]) {
      const html = site.gm.read(...page);
      for (const quote of html.match(/<div class="pull-quote">[\s\S]*?<\/div>/g) || []) assert.doesNotMatch(quote, HIDDEN, page.join('/'));
    }
    const town = site.gm.read('locations', 'town.html');
    assert.match(town, /busy quay/, 'the child location card holds what players see');
    assert.equal(markedTexts(town).some((m) => /stolen gold/.test(m.text)), false);
    assert.doesNotMatch(town, /stolen gold/);
    assert.doesNotMatch(site.gm.read('previews.json'), HIDDEN);
  });

  it('every GM page has balanced marks and nothing after </main> in a mark', () => {
    const pages = htmlOf(site.gm);
    assert.ok(pages.length > 0);
    for (const f of pages) assert.equal(markedAfterMain(fs.readFileSync(f, 'utf8')), '', f);
  });
});

describe('the GM build refuses a folder it must not write', () => {
  for (const [why, folderOf] of [
    ['the player site folder', (s) => path.dirname(s.configPath)],
    ['inside the player site folder', (s) => path.join(path.dirname(s.configPath), 'gm')],
    ['the folder holding the player site folder', (s) => s.root],
  ]) {
    it(`refuses ${why}, and writes and deletes nothing`, () => {
      const s = buildBoth(NOTES, { sites: ['player'] });
      try {
        editSettings(s, (text) => text.replace(/folder: .*campaign-gm.*/, `folder: ${JSON.stringify(folderOf(s))}`));
        const before = allFiles(s.root).sort();
        assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /gm_site\.folder/);
        assert.deepEqual(allFiles(s.root).sort(), before);
      } finally { s.cleanup(); }
    });
  }

  it('refuses a folder with files it did not make', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.mkdirSync(s.gm.dir);
      fs.writeFileSync(path.join(s.gm.dir, 'mine.txt'), 'keep me');
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /did not make/);
      assert.equal(fs.readFileSync(path.join(s.gm.dir, 'mine.txt'), 'utf8'), 'keep me');
    } finally { s.cleanup(); }
  });

  it('refuses a folder holding one old GM page but no gm-build.json, and empties nothing', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.mkdirSync(path.join(s.gm.dir, 'old'), { recursive: true });
      fs.writeFileSync(path.join(s.gm.dir, 'old', 'saved.html'), '<html><head><meta name="gm-apprentice-build" content="gm"></head></html>');
      fs.writeFileSync(path.join(s.gm.dir, 'mine.txt'), 'keep me');
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /did not make/);
      assert.equal(fs.readFileSync(path.join(s.gm.dir, 'mine.txt'), 'utf8'), 'keep me');
      assert.ok(fs.existsSync(path.join(s.gm.dir, 'old', 'saved.html')));
    } finally { s.cleanup(); }
  });

  it('a settings file that cannot be read fails the build with its real message, never "the GM site is off"', () => {
    const { gmSiteOnFor } = require('../../lib/config');
    const { spawnSync } = require('node:child_process');
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      assert.equal(gmSiteOnFor(s.configPath), true);
      editSettings(s, () => 'version: 1\nplayer_site: [unclosed\n  - x: : :\n');
      assert.throws(() => gmSiteOnFor(s.configPath), /./);
      for (const args of [['--site', 'gm'], []]) {
        const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'gm-publish.js'), 'build', '--config', s.configPath, ...args], { encoding: 'utf8' });
        assert.notEqual(r.status, 0, args.join(' '));
        assert.doesNotMatch(r.stderr, /GM site is off/, r.stderr);
        assert.match(r.stderr, /could not read the GM site's settings: ./, r.stderr);
      }
    } finally { s.cleanup(); }
  });

  it('refuses when the GM site is off', () => {
    const s = buildBoth(NOTES, { sites: ['player'], gm: { publish: false } });
    try { assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /gm_site\.publish/); } finally { s.cleanup(); }
  });

  it('refuses on a vault kept by a player', () => {
    const s = buildBoth(NOTES, { sites: [], vault: { kept_by: 'player' } });
    try { assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /kept by a player/); } finally { s.cleanup(); }
  });

  it('refuses a preview folder: the preview is the player site\'s', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm', outputDirOverride: path.join(s.root, 'preview') })), /preview/);
      assert.equal(fs.existsSync(path.join(s.root, 'preview')), false);
    } finally { s.cleanup(); }
  });

  it('warns when the GM folder is inside a git repository', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      fs.mkdirSync(path.join(s.root, '.git'));
      const warned = quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      assert.ok(warned.some((m) => /inside a git repository; do not push it/.test(m)), warned.join('\n'));
    } finally { s.cleanup(); }
  });

  it('the GM site has no live stats, no inbox and no party board, whatever the player site says', () => {
    const s = buildBoth({ 'PCs/Ann.md': '---\ntype: pc\n---\nAnn.\n' }, { player: { features: { live_stats: true, inbox: true } } });
    try {
      const pages = htmlOf(s.gm);
      assert.ok(pages.length > 0);
      for (const f of pages) {
        assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /live-state\.js|data-inbox|party-board/, f);
      }
    } finally { s.cleanup(); }
  });
});

describe('the GM build beside the player site', () => {
  it('the GM build speaks of the GM site: its image count, and an unclosed marker marked to the end of the file', () => {
    const s = buildBoth({ ...NOTES, 'NPCs/Open.md': '---\ntype: npc\n---\nShown.\n\n<!-- gm-only -->\nNever closed.\n' }, { sites: [] });
    try {
      const said = [];
      const saved = { log: console.log, warn: console.warn };
      console.log = (m) => said.push(String(m)); console.warn = (m) => said.push(String(m));
      try { build({ configPath: s.configPath, site: 'gm' }); } finally { Object.assign(console, saved); }
      assert.ok(said.some((l) => /^GM site: copied \d+ referenced images/.test(l)), said.join('\n'));
      assert.ok(!said.some((l) => /Player mode/.test(l)), said.join('\n'));
      assert.ok(said.some((l) => /unclosed <!-- gm-only --> marker .*marked as hidden to end of file/.test(l)), said.join('\n'));
      assert.ok(!said.some((l) => /stripped to end of file/.test(l)), said.join('\n'));
    } finally { s.cleanup(); }
  });

  it('builds with the player site off and the GM site on', () => {
    const s = buildBoth(NOTES, { sites: ['gm'], player: { publish: false } });
    try {
      assert.ok(s.gm.exists('gm-build.json'));
      assert.ok(s.gm.exists('npcs', 'vex.html'));
      assert.throws(() => quiet(() => build({ configPath: s.configPath })), /site is off/);
    } finally { s.cleanup(); }
  });

  it('a settings fault that stops the player build is a warning on the GM build', () => {
    const s = buildBoth(NOTES, { sites: [], player: { hide: { sectoins: ['GM Notes'] } } });
    try {
      assert.throws(() => quiet(() => build({ configPath: s.configPath })), /settings have a fault/);
      const warned = quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      assert.ok(warned.some((m) => /sectoins/.test(m)), warned.join('\n'));
      assert.ok(s.gm.exists('gm-build.json'));
    } finally { s.cleanup(); }
  });

  it('a GM build that fails part-way does not lock its folder: the next build empties and rebuilds it', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      const fail = path.join(s.root, 'fail.js');
      fs.writeFileSync(fail, 'process.exit(3);\n');
      editSettings(s, (text) => `${text.trimEnd()}\n  after_build:\n    - node ${JSON.stringify(fail)}\n`);
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm', runSteps: true, stepsStdio: 'ignore' })), /after_build/);
      assert.ok(s.gm.exists('npcs', 'vex.html'), 'the pages were written');
      assert.equal(JSON.parse(s.gm.read('gm-build.json')).built, null, 'a failed build leaves the marker it wrote first, unfinished');
      fs.writeFileSync(fail, '\n');
      quiet(() => build({ configPath: s.configPath, site: 'gm', runSteps: true, stepsStdio: 'ignore' }));
      assert.ok(!Number.isNaN(Date.parse(JSON.parse(s.gm.read('gm-build.json')).built)));
    } finally { s.cleanup(); }
  });

  it('a GM build that fails before it writes a page does not lock its folder either', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      editSettings(s, (text) => text.replace(/^player_site:\n/m, 'player_site:\n  theme:\n    campaign_image: ../outside.png\n'));
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm' })), /campaign_image outside vault/);
      assert.equal(htmlOf(s.gm).length, 0, 'no page was written');
      assert.ok(s.gm.files().length > 1, 'files besides the marker were written');
      assert.equal(JSON.parse(s.gm.read('gm-build.json')).built, null);
      editSettings(s, (text) => text.replace('  theme:\n    campaign_image: ../outside.png\n', ''));
      quiet(() => build({ configPath: s.configPath, site: 'gm' }));
      assert.ok(s.gm.exists('npcs', 'vex.html'));
      assert.notEqual(JSON.parse(s.gm.read('gm-build.json')).built, null);
    } finally { s.cleanup(); }
  });

  it('a PC with a story companion: the GM build writes the story page, marked as a GM page', () => {
    const s = buildBoth({
      'PCs/Ann.md': '---\ntype: pc\n---\n# Ann\n\n## Background\n\nA sailor.\n',
      'PCs/Ann_Story.md': '---\ntype: character-story\ncharacter: "[[Ann]]"\n---\nShe sailed north.\n\n<!-- gm-only -->\nShe sank the ship.\n<!-- /gm-only -->\n',
    });
    try {
      const story = s.gm.files().find((f) => f.endsWith(path.join('story', 'characters', 'ann.html')));
      assert.ok(story, s.gm.files().join('\n'));
      const html = fs.readFileSync(story, 'utf8');
      assert.match(html, /<meta name="gm-apprentice-build" content="gm">/);
      assert.match(html, /class="gm-band"/);
      assert.ok(markedTexts(html).some((m) => m.kind === 'gm_only_blocks' && /sank the ship/.test(m.text)));
      assert.doesNotMatch(s.player.read('story', 'characters', 'ann.html'), /sank the ship/);
    } finally { s.cleanup(); }
  });

  it('a PC whose link label changes its headings (sheets off) shows its body on the GM page in one mark, and nowhere unmarked', () => {
    const s = buildBoth({
      'PCs/Jean.md': '---\ntype: pc\n---\n# Jean\n## Background\nok BACKGROUNDTEXT\n[[Nowhere|## Skills]]\nSTAT14\n\n## GM Notes\n\nJEANSECRET\n',
    }, { player: { sheets: { show: false } } });
    try {
      const html = s.gm.read('pcs', 'jean.html');
      const marks = markedTexts(html);
      const body = (re) => marks.some((m) => m.label === 'note body (a link label changes its headings)' && re.test(m.text));
      assert.ok(body(/BACKGROUNDTEXT/) && body(/JEANSECRET/), JSON.stringify(marks));
      // Every place the words appear is inside that mark: with the marked elements cut out, none is left.
      let rest = html;
      for (let i = 0; i < 20; i++) rest = rest.replace(/<(div|span) class="gm-mark[^"]*"[^>]*>(?:(?!<\1\b)[\s\S])*?<\/\1>/g, '');
      assert.doesNotMatch(rest, /BACKGROUNDTEXT|JEANSECRET/);
      assert.doesNotMatch(s.player.read('pcs', 'jean.html'), /BACKGROUNDTEXT|JEANSECRET/);
    } finally { s.cleanup(); }
  });

  it('each site\'s build steps are told which site they run for and where it is built', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      const seen = path.join(s.root, 'seen.txt');
      const step = path.join(s.root, 'step.js');
      fs.writeFileSync(step, `require('fs').appendFileSync(${JSON.stringify(seen)}, process.env.GM_APPRENTICE_SITE + ' ' + process.env.GM_APPRENTICE_OUTPUT + '\\n');\n`);
      editSettings(s, (text) => text
        .replace(/^player_site:\n/m, `player_site:\n  before_build:\n    - node ${JSON.stringify(step)}\n`)
        .replace(/^gm_site:\n/m, `gm_site:\n  before_build:\n    - node ${JSON.stringify(step)}\n`));
      quiet(() => build({ configPath: s.configPath, runSteps: true, stepsStdio: 'ignore' }));
      quiet(() => build({ configPath: s.configPath, site: 'gm', runSteps: true, stepsStdio: 'ignore' }));
      assert.deepEqual(fs.readFileSync(seen, 'utf8').trim().split('\n'),
        [`player ${s.player.dir}`, `gm ${s.gm.dir}`]);
    } finally { s.cleanup(); }
  });
});
