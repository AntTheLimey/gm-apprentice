const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  decidePage,
  publishesPage,
  autoExcludeCode,
  ALWAYS_EXCLUDE_DIRS,
  AUTO_EXCLUDE_STATUS,
  AUTO_EXCLUDE_STAGE,
  AUTO_EXCLUDE_SOURCE,
} = require('../lib/publish-decision');

// A scanner-shaped page, minus everything decidePage never reads.
function page(frontmatter, outputPath = 'characters/npcs/someone.html') {
  return { frontmatter, outputPath, sourcePath: '/vault/' + outputPath, markdown: '' };
}

function decide(fm, opts = {}) {
  const rel = opts.rel || 'Characters/NPCs/Someone.md';
  return decidePage(page(fm), {
    rel,
    publishConfig: opts.publishConfig || { mode: 'player' },
    manifest: opts.manifest || null,
    folderMapped: opts.folderMapped !== false,
  });
}

const manifestOf = (m) => Object.assign(
  { publishing: [], excluded: [], needsDecision: [], resolved: [], meta: {} }, m);

describe('publish-decision: constants', () => {
  it('names the always-excluded directories', () => {
    assert.deepStrictEqual(ALWAYS_EXCLUDE_DIRS, ['_meta', '_Templates', '_templates', 'personal']);
  });

  it('keeps the auto-exclude vocabularies build.js used', () => {
    assert.deepStrictEqual([...AUTO_EXCLUDE_STATUS].sort(), ['planned', 'prepped']);
    assert.deepStrictEqual([...AUTO_EXCLUDE_STAGE].sort(), ['draft', 'outline', 'ready']);
    assert.deepStrictEqual([...AUTO_EXCLUDE_SOURCE].sort(), ['prep']);
  });

  it('autoExcludeCode names which field triggered, or null', () => {
    assert.strictEqual(autoExcludeCode({ status: 'Planned' }), 'AUTO_EXCLUDED_STATUS');
    assert.strictEqual(autoExcludeCode({ stage: 'outline' }), 'AUTO_EXCLUDED_STAGE');
    assert.strictEqual(autoExcludeCode({ source: 'prep' }), 'AUTO_EXCLUDED_SOURCE');
    assert.strictEqual(autoExcludeCode({ status: 'played' }), null);
    assert.strictEqual(autoExcludeCode({ status: { hp: 11 } }), null);
    assert.strictEqual(autoExcludeCode(null), null);
  });
});

describe('publish-decision: one case per code', () => {
  it('DIR_ALWAYS_EXCLUDED for a file under _meta/', () => {
    const v = decide({ type: 'npc' }, { rel: '_meta/vault-config.md' });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'DIR_ALWAYS_EXCLUDED');
    assert.match(v.reason, /_meta/);
  });

  it('DIR_ALWAYS_EXCLUDED for a nested personal/ directory', () => {
    const v = decide({ type: 'npc' }, { rel: 'Characters/personal/Notes.md' });
    assert.strictEqual(v.code, 'DIR_ALWAYS_EXCLUDED');
    assert.match(v.reason, /personal/);
  });

  it('does not match a directory name only as a prefix', () => {
    const v = decide({ type: 'npc' }, { rel: '_metadata/Thing.md' });
    assert.strictEqual(v.bucket, 'publish');
  });

  it('DIR_UNMAPPED when the folder is not in folderMap', () => {
    const v = decide({ type: 'npc' }, { folderMapped: false });
    assert.strictEqual(v.bucket, 'decide');
    assert.strictEqual(v.code, 'DIR_UNMAPPED');
  });

  it('NO_TYPE when the frontmatter carries no type', () => {
    const v = decide({ name: 'Nobody' });
    assert.strictEqual(v.bucket, 'decide');
    assert.strictEqual(v.code, 'NO_TYPE');
  });

  it('NO_TYPE for a file the scanner never produced (frontmatter: null)', () => {
    const v = decidePage({ rel: 'Notes/Scratch.md', frontmatter: null }, {
      rel: 'Notes/Scratch.md', publishConfig: { mode: 'player' },
    });
    assert.strictEqual(v.code, 'NO_TYPE');
    assert.strictEqual(v.outputPath, null);
  });

  it('PUBLISH_FALSE for publish: false', () => {
    const v = decide({ type: 'npc', publish: false });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'PUBLISH_FALSE');
  });

  it('PUBLISH_NONE for publish: none', () => {
    const v = decide({ type: 'npc', publish: 'none' });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'PUBLISH_NONE');
  });

  it('publish: false wins in full mode too', () => {
    const v = decide({ type: 'npc', publish: false }, { publishConfig: { mode: 'full' } });
    assert.strictEqual(v.code, 'PUBLISH_FALSE');
  });

  it('AUTO_EXCLUDED_STATUS for status: planned', () => {
    const v = decide({ type: 'session', status: 'planned' });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'AUTO_EXCLUDED_STATUS');
    assert.match(v.reason, /status: planned/);
  });

  it('AUTO_EXCLUDED_STAGE for stage: draft', () => {
    assert.strictEqual(decide({ type: 'npc', stage: 'draft' }).code, 'AUTO_EXCLUDED_STAGE');
  });

  it('AUTO_EXCLUDED_SOURCE for source: prep', () => {
    assert.strictEqual(decide({ type: 'npc', source: 'prep' }).code, 'AUTO_EXCLUDED_SOURCE');
  });

  it('does not auto-exclude in full mode', () => {
    const v = decide({ type: 'session', status: 'planned' }, { publishConfig: { mode: 'full' } });
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.reason, 'mode: full');
  });

  it('a manifest Publishing entry overrides an auto-exclusion', () => {
    const v = decide({ type: 'session', status: 'planned' }, {
      rel: 'Sessions/Planned Session.md',
      manifest: manifestOf({ publishing: ['Sessions/Planned Session.md'] }),
    });
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.reason, 'manifest: Publishing');
  });

  it('SCENE_CUT_SKIPPED for a cut scene', () => {
    const v = decide({ type: 'scene', status: 'cut' });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'SCENE_CUT_SKIPPED');
  });

  it('SCENE_CUT_SKIPPED for a skipped scene', () => {
    assert.strictEqual(decide({ type: 'scene', status: 'skipped' }).code, 'SCENE_CUT_SKIPPED');
  });

  it('a played scene publishes', () => {
    assert.strictEqual(decide({ type: 'scene', status: 'played' }).bucket, 'publish');
  });

  it('only scenes are cut-filtered — a cut session is not', () => {
    assert.strictEqual(decide({ type: 'session', status: 'cut' }).bucket, 'publish');
  });

  it('DRAFT_EXCLUDED only when exclude_drafts is on', () => {
    const fm = { type: 'npc', canon_status: 'DRAFT' };
    assert.strictEqual(decide(fm).bucket, 'publish');
    const v = decide(fm, { publishConfig: { mode: 'player', exclude_drafts: true } });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'DRAFT_EXCLUDED');
  });

  it('SUPERSEDED_NO_TARGET is a decision, not an exclusion', () => {
    const v = decide({ type: 'npc', canon_status: 'SUPERSEDED' });
    assert.strictEqual(v.bucket, 'decide');
    assert.strictEqual(v.code, 'SUPERSEDED_NO_TARGET');
    // The build still publishes it — the GM is being asked to name a successor,
    // not to withhold the page.
    assert.strictEqual(publishesPage(v), true);
  });

  it('a superseded page with a target publishes', () => {
    const v = decide({ type: 'npc', canon_status: 'SUPERSEDED', superseded_by: '[[New Name]]' });
    assert.strictEqual(v.bucket, 'publish');
  });

  it('MANIFEST_EXCLUDED for an Excluded entry in player mode', () => {
    const v = decide({ type: 'npc' }, {
      rel: 'Characters/NPCs/Villain.md',
      manifest: manifestOf({ excluded: ['Characters/NPCs/Villain.md'] }),
    });
    assert.strictEqual(v.bucket, 'exclude');
    assert.strictEqual(v.code, 'MANIFEST_EXCLUDED');
  });

  it('MANIFEST_NEEDS_DECISION for an unchecked entry', () => {
    const v = decide({ type: 'npc' }, {
      rel: 'Events/Ambiguous.md',
      manifest: manifestOf({ needsDecision: ['Events/Ambiguous.md'] }),
    });
    assert.strictEqual(v.bucket, 'decide');
    assert.strictEqual(v.code, 'MANIFEST_NEEDS_DECISION');
  });

  it('MANIFEST_UNLISTED for a file in no section, in player mode', () => {
    const v = decide({ type: 'npc' }, { manifest: manifestOf({ publishing: ['Other.md'] }) });
    assert.strictEqual(v.bucket, 'decide');
    assert.strictEqual(v.code, 'MANIFEST_UNLISTED');
    assert.strictEqual(publishesPage(v), false);
  });

  it('the manifest is not an allowlist in full mode', () => {
    const v = decide({ type: 'npc' }, {
      publishConfig: { mode: 'full' },
      manifest: manifestOf({ excluded: ['Characters/NPCs/Someone.md'] }),
    });
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.reason, 'mode: full');
  });

  it('OK carries the output path so callers can print the destination', () => {
    const v = decide({ type: 'npc' });
    assert.strictEqual(v.code, 'OK');
    assert.strictEqual(v.outputPath, 'characters/npcs/someone.html');
    assert.strictEqual(v.reason, 'mode: player');
    assert.strictEqual(publishesPage(v), true);
  });
});

describe('publish-decision: over the fixture vaults', () => {
  const path = require('path');
  const { scanVault } = require('../lib/scanner');
  const { vaultRelPath } = require('../lib/config');

  const fixtures = path.join(__dirname, 'fixtures');

  function classify(vault, folderMap, publishConfig, manifest) {
    const vaultPath = path.join(fixtures, vault);
    const pages = scanVault({ vaultPath, excludeDirs: ['_meta', '_Templates'], folderMap });
    const out = {};
    for (const p of pages) {
      const rel = vaultRelPath(vaultPath, p.sourcePath);
      out[rel] = decidePage(p, { rel, publishConfig, manifest: manifest || null });
    }
    return out;
  }

  it('auto-exclude fixture: prep files land in exclude, the played ones publish', () => {
    const verdicts = classify('auto-exclude', {
      'Sessions': 'sessions',
      'Characters/NPCs': 'characters/npcs',
    }, { mode: 'player' });

    assert.strictEqual(verdicts['Sessions/Played Session.md'].bucket, 'publish');
    assert.strictEqual(verdicts['Characters/NPCs/Published NPC.md'].bucket, 'publish');
    assert.strictEqual(verdicts['Sessions/Planned Session.md'].code, 'AUTO_EXCLUDED_STATUS');
    assert.strictEqual(verdicts['Characters/NPCs/Draft NPC.md'].code, 'AUTO_EXCLUDED_STAGE');
    assert.strictEqual(verdicts['Characters/NPCs/Prep Source.md'].code, 'AUTO_EXCLUDED_SOURCE');
  });

  it('superseded fixture: a superseded page with a target still publishes', () => {
    const verdicts = classify('superseded-entities', { 'Characters/NPCs': 'characters/npcs' }, { mode: 'player' });
    assert.strictEqual(verdicts['Characters/NPCs/Old Name.md'].bucket, 'publish');
    assert.strictEqual(verdicts['Characters/NPCs/New Name.md'].bucket, 'publish');
  });
});

describe('publish-decision: evaluation order reproduces the build log', () => {
  // build.js attributes each dropped page to the pass that caught it FIRST, and
  // that attribution is what the console breakdown counts. A page carrying two
  // reasons must land in the same bucket it always did.
  it('a page that is both publish: false and status: planned is auto-excluded', () => {
    const v = decide({ type: 'session', status: 'planned', publish: false });
    assert.strictEqual(v.code, 'AUTO_EXCLUDED_STATUS');
  });

  it('a DRAFT page that is also publish: false is a DRAFT exclusion', () => {
    const v = decide({ type: 'npc', canon_status: 'DRAFT', publish: false }, {
      publishConfig: { mode: 'player', exclude_drafts: true },
    });
    assert.strictEqual(v.code, 'DRAFT_EXCLUDED');
  });

  it('a DRAFT page that is also status: planned is a DRAFT exclusion', () => {
    const v = decide({ type: 'session', status: 'planned', canon_status: 'DRAFT' }, {
      publishConfig: { mode: 'player', exclude_drafts: true },
    });
    assert.strictEqual(v.code, 'DRAFT_EXCLUDED');
  });

  it('the manifest allowlist outranks publish: false, as the build passes did', () => {
    const v = decide({ type: 'npc', publish: false }, {
      manifest: manifestOf({ publishing: ['Other.md'] }),
    });
    assert.strictEqual(v.code, 'MANIFEST_UNLISTED');
  });

  it('a listed page still honours publish: false', () => {
    const v = decide({ type: 'npc', publish: false }, {
      rel: 'Characters/NPCs/Someone.md',
      manifest: manifestOf({ publishing: ['Characters/NPCs/Someone.md'] }),
    });
    assert.strictEqual(v.code, 'PUBLISH_FALSE');
  });

  // SUPERSEDED_NO_TARGET is the one `decide` the build publishes, so it is
  // evaluated last: ahead of these it would drag a page onto the site that the
  // old build dropped.
  it('a superseded page with no target does not escape the manifest allowlist', () => {
    const v = decide({ type: 'npc', canon_status: 'SUPERSEDED' }, {
      manifest: manifestOf({ publishing: ['Other.md'] }),
    });
    assert.strictEqual(v.code, 'MANIFEST_UNLISTED');
    assert.strictEqual(publishesPage(v), false);
  });

  it('a superseded page with no target still honours publish: false', () => {
    const v = decide({ type: 'npc', canon_status: 'SUPERSEDED', publish: false });
    assert.strictEqual(v.code, 'PUBLISH_FALSE');
    assert.strictEqual(publishesPage(v), false);
  });
});

describe('publish-decision: STORY_COMPANION', () => {
  const { storyCompanionPc } = require('../lib/publish-decision');

  const pcPage = {
    frontmatter: { type: 'pc' },
    title: 'Adrien',
    displayTitle: 'Adrien',
    outputPath: 'characters/pcs/adrien.html',
  };
  const index = new Map([['Characters/PCs/Adrien.md', pcPage]]);

  it('resolves a story file to its sibling PC', () => {
    assert.strictEqual(storyCompanionPc('Characters/PCs/Adrien_Story.md', index), pcPage);
  });

  it('resolves to null when the sibling is not a PC', () => {
    const npcIndex = new Map([['Characters/NPCs/Vex.md', { frontmatter: { type: 'npc' } }]]);
    assert.strictEqual(storyCompanionPc('Characters/NPCs/Vex_Story.md', npcIndex), null);
  });

  it('resolves to null without a page index', () => {
    assert.strictEqual(storyCompanionPc('Characters/PCs/Adrien_Story.md', null), null);
  });

  it('names the PC whose page carries the content', () => {
    const v = decidePage({ frontmatter: { type: 'character-story' }, outputPath: 'characters/pcs/adrien-story.html' }, {
      rel: 'Characters/PCs/Adrien_Story.md',
      publishConfig: { mode: 'player' },
      pageIndex: index,
    });
    assert.strictEqual(v.bucket, 'publish');
    assert.strictEqual(v.code, 'STORY_COMPANION');
    assert.strictEqual(v.reason, "merged into Adrien's page");
    // Never the story file's own scanner path: nothing is built there.
    assert.strictEqual(v.outputPath, null);
    assert.strictEqual(publishesPage(v), true);
  });

  it('a story file with no sibling PC falls through to the normal chain', () => {
    const v = decidePage({ frontmatter: { type: 'character-story' }, outputPath: 'x.html' }, {
      rel: 'Characters/PCs/Orphan_Story.md',
      publishConfig: { mode: 'player' },
      pageIndex: new Map(),
    });
    assert.strictEqual(v.code, 'OK');
  });
});
