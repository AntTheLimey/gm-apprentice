const { describe, it } = require('node:test');
const assert = require('node:assert');

const { decidePage, decideGmPage, publishesPage, NOTE_CODES } = require('../lib/publish-decision');
const { publishedPages } = require('../lib/published-pages');

function page(frontmatter, outputPath = 'characters/npcs/someone.html') {
  return { frontmatter, outputPath, sourcePath: '/vault/' + outputPath, markdown: '' };
}

const PLAYER = { mode: 'player' };
const NOTES_ON = new Set(['notes']);

function gm(fm, opts = {}) {
  return decideGmPage(page(fm), {
    rel: opts.rel || 'Characters/NPCs/Someone.md',
    publishConfig: opts.publishConfig || PLAYER,
    playerConfig: opts.playerConfig,
    manifest: opts.manifest || null,
    folderMapped: opts.folderMapped !== false,
    show: opts.show || NOTES_ON,
    hiddenFolders: opts.hiddenFolders || [],
  });
}

const manifestOf = (m) => Object.assign({ publishing: [], excluded: [], needsDecision: [] }, m);

describe('NOTE_CODES', () => {
  it('lists the whole-note codes', () => {
    assert.deepStrictEqual([...NOTE_CODES].sort(), [
      'AUTO_EXCLUDED_SOURCE', 'AUTO_EXCLUDED_STAGE', 'AUTO_EXCLUDED_STATUS', 'DRAFT_EXCLUDED',
      'MANIFEST_EXCLUDED', 'MANIFEST_NEEDS_DECISION', 'MANIFEST_UNLISTED',
      'PUBLISH_FALSE', 'PUBLISH_NONE', 'SCENE_CUT_SKIPPED',
    ]);
  });
});

describe('decideGmPage: a note players do not see is shown, with the player reason', () => {
  const cases = [
    ['DRAFT_EXCLUDED', { canon_status: 'DRAFT', type: 'npc' }, { publishConfig: { mode: 'player', exclude_drafts: true } }],
    ['AUTO_EXCLUDED_STATUS', { type: 'npc', status: 'planned' }, {}],
    ['AUTO_EXCLUDED_STAGE', { type: 'npc', stage: 'outline' }, {}],
    ['AUTO_EXCLUDED_SOURCE', { type: 'npc', source: 'prep' }, {}],
    ['SCENE_CUT_SKIPPED', { type: 'scene', status: 'skipped' }, {}],
    ['MANIFEST_EXCLUDED', { type: 'npc' }, { manifest: manifestOf({ excluded: ['Characters/NPCs/Someone.md'] }) }],
    ['MANIFEST_NEEDS_DECISION', { type: 'npc' }, { manifest: manifestOf({ needsDecision: ['Characters/NPCs/Someone.md'] }) }],
    ['MANIFEST_UNLISTED', { type: 'npc' }, { manifest: manifestOf({}) }],
    ['PUBLISH_FALSE', { type: 'npc', publish: false }, {}],
    ['PUBLISH_NONE', { type: 'npc', publish: 'none' }, {}],
  ];
  for (const [code, fm, extra] of cases) {
    it(`${code} comes back GM_SHOWN`, () => {
      const player = decidePage(page(fm), {
        rel: 'Characters/NPCs/Someone.md',
        publishConfig: extra.publishConfig || PLAYER,
        manifest: extra.manifest || null,
      });
      assert.strictEqual(player.code, code);
      const v = gm(fm, extra);
      assert.strictEqual(v.bucket, 'publish');
      assert.strictEqual(v.code, 'GM_SHOWN');
      assert.strictEqual(v.reason, player.reason);
      assert.strictEqual(v.outputPath, player.outputPath);
      assert.deepStrictEqual(v.player, player);
      assert.ok(publishesPage(v));
      // With notes off, the verdict is the player's own.
      const off = gm(fm, Object.assign({}, extra, { show: new Set() }));
      assert.strictEqual(off.code, code);
      assert.strictEqual(off.bucket, player.bucket);
      assert.strictEqual(off.reason, player.reason);
      assert.deepStrictEqual(off.player, player);
    });
  }

  it('a page the player site publishes is the player verdict plus .player', () => {
    const v = gm({ type: 'npc' });
    assert.strictEqual(v.code, 'OK');
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.player.code, 'OK');
  });
});

describe('decideGmPage: never shown, or not the notes rule', () => {
  for (const rel of ['_meta/x.md', '_Templates/x.md', 'personal/x.md', '_meta/vault-config.md']) {
    it(`DIR_ALWAYS_EXCLUDED for ${rel}`, () => {
      const v = gm({ type: 'npc' }, { rel });
      assert.strictEqual(v.bucket, 'exclude');
      assert.strictEqual(v.code, 'DIR_ALWAYS_EXCLUDED');
      assert.strictEqual(v.player.code, 'DIR_ALWAYS_EXCLUDED');
    });
  }

  it('always-excluded wins over a hidden folder', () => {
    const v = gm({ type: 'npc' }, { rel: '_meta/x.md', hiddenFolders: ['_meta'] });
    assert.strictEqual(v.code, 'DIR_ALWAYS_EXCLUDED');
  });

  it('a page in a hide.folders folder is GM_SHOWN with the folder verdict as the player verdict', () => {
    const v = gm({ type: 'npc' }, { rel: '_archive/Old.md', hiddenFolders: ['_archive'] });
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.code, 'GM_SHOWN');
    assert.strictEqual(v.reason, 'hide.folders: _archive');
    assert.strictEqual(v.player.bucket, 'exclude');
    assert.strictEqual(v.player.code, 'DIR_CONFIG_EXCLUDED');
    assert.match(v.player.reason, /^in _archive\/ — listed in .*player_site\.hide\.folders/);
    assert.strictEqual(v.player.outputPath, v.outputPath);
  });

  it('a page in a hide.folders folder matches case-insensitively and segment-wise', () => {
    const inside = gm({ type: 'npc' }, { rel: '_Archive/Deep/Old.md', hiddenFolders: ['_archive'] });
    assert.strictEqual(inside.code, 'GM_SHOWN');
    const sibling = gm({ type: 'npc' }, { rel: '_archive2/Old.md', hiddenFolders: ['_archive'] });
    assert.strictEqual(sibling.code, 'OK');
  });

  it('with notes off, a hidden-folder page is the folder verdict', () => {
    const v = gm({ type: 'npc' }, { rel: '_archive/Old.md', hiddenFolders: ['_archive'], show: new Set() });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'DIR_CONFIG_EXCLUDED');
    assert.strictEqual(v.player.code, 'DIR_CONFIG_EXCLUDED');
    assert.strictEqual(v.player.reason, v.reason);
  });

  it('STORY_COMPANION, NO_TYPE, DIR_UNMAPPED and SUPERSEDED_NO_TARGET are the player verdicts', () => {
    const noType = gm({});
    assert.strictEqual(noType.code, 'NO_TYPE');
    assert.strictEqual(noType.bucket, 'decide');
    assert.strictEqual(publishesPage(noType), false);

    const unmapped = gm({ type: 'npc' }, { folderMapped: false });
    assert.strictEqual(unmapped.code, 'DIR_UNMAPPED');
    assert.strictEqual(publishesPage(unmapped), false);

    const superseded = gm({ type: 'npc', canon_status: 'SUPERSEDED' });
    assert.strictEqual(superseded.code, 'SUPERSEDED_NO_TARGET');
    assert.deepStrictEqual(superseded.player.code, 'SUPERSEDED_NO_TARGET');

    const pc = page({ type: 'pc' }, 'characters/pcs/ann.html');
    pc.title = 'Ann';
    const pageIndex = new Map([['Characters/PCs/Ann.md', pc]]);
    const story = decideGmPage(page({ type: 'pc-story' }), {
      rel: 'Characters/PCs/Ann_Story.md', publishConfig: PLAYER, pageIndex, show: NOTES_ON, hiddenFolders: [],
    });
    assert.strictEqual(story.code, 'STORY_COMPANION');
    assert.strictEqual(story.player.code, 'STORY_COMPANION');
  });
});

describe('decideGmPage: the player verdict follows the player site config', () => {
  it('uses options.playerConfig, not the GM site config, for the player verdict', () => {
    const fm = { type: 'npc', canon_status: 'DRAFT' };
    const gmCfg = { mode: 'player', exclude_drafts: false };
    const playerCfg = { mode: 'player', exclude_drafts: true };
    const v = gm(fm, { publishConfig: gmCfg, playerConfig: playerCfg });
    assert.strictEqual(v.player.code, 'DRAFT_EXCLUDED');
    assert.strictEqual(v.code, 'GM_SHOWN');
    const same = gm(fm, { publishConfig: playerCfg, playerConfig: gmCfg });
    assert.strictEqual(same.player.code, 'OK');
    assert.strictEqual(same.code, 'OK');
  });
});

describe('publishedPages with a site', () => {
  const mk = (rel, fm) => Object.assign(page(fm, rel.replace(/\.md$/, '.html')), { rel });
  const relOf = (p) => p.rel;
  const pagesFor = () => [
    mk('Characters/NPCs/Shown.md', { type: 'npc' }),
    mk('Characters/NPCs/Draft.md', { type: 'npc', canon_status: 'DRAFT' }),
    mk('Characters/NPCs/Secret.md', { type: 'npc', publish: false }),
    mk('_archive/Old.md', { type: 'npc' }),
  ];
  const playerConfig = { mode: 'player', exclude_drafts: true };
  const base = { vaultPath: '/nonexistent-vault', manifest: null, relOf };

  it('the player site has playerPublished equal to published', () => {
    const r = publishedPages(pagesFor(), Object.assign({ publishConfig: playerConfig }, base));
    assert.strictEqual(r.playerPublished, r.published);
    assert.deepStrictEqual(r.published.map(relOf), ['Characters/NPCs/Shown.md', '_archive/Old.md']);
  });

  it('the GM site publishes every note and returns what players see', () => {
    const playerCall = publishedPages(pagesFor().slice(0, 3), Object.assign({ publishConfig: playerConfig }, base));
    const r = publishedPages(pagesFor(), Object.assign({
      publishConfig: playerConfig, playerConfig, site: 'gm', show: NOTES_ON, hiddenFolders: ['_archive'],
    }, base));
    assert.deepStrictEqual(r.published.map(relOf), pagesFor().map(relOf));
    assert.deepStrictEqual(r.playerPublished.map(relOf), playerCall.published.map(relOf));
  });

  it('playerPublished follows the player config when the GM config hides differently', () => {
    const gmCfg = { mode: 'player', exclude_drafts: false };
    const r = publishedPages(pagesFor(), Object.assign({
      publishConfig: gmCfg, playerConfig, site: 'gm', show: NOTES_ON, hiddenFolders: [],
    }, base));
    assert.ok(!r.playerPublished.map(relOf).includes('Characters/NPCs/Draft.md'));
    const wrong = publishedPages(pagesFor(), Object.assign({
      publishConfig: gmCfg, playerConfig: gmCfg, site: 'gm', show: NOTES_ON, hiddenFolders: [],
    }, base));
    assert.ok(wrong.playerPublished.map(relOf).includes('Characters/NPCs/Draft.md'));
  });
});
