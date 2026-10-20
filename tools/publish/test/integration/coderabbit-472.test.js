'use strict';
// PR #472 review: a PC story page on the GM site, which has no note audit.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { build } = require('../../lib/build');

const PC = '---\ntype: pc\nsystem: coc\n---\n## Notes\n\nA person.\n';
const STORY = '---\ntype: character-story\n---\n## Tale\n\n| Item | Value |\n| --- | --- |\n| Sword | 5 | tacked-on remark |\n';

describe('PR 472: a story page with an over-wide table', () => {
  const site = buildBoth({ 'PCs/Ann.md': PC, 'PCs/Ann_Story.md': STORY }, { sites: ['player'] });
  after(() => site.cleanup());

  it('builds on the GM site, which has no note audit', () => {
    const saved = { log: console.log, warn: console.warn };
    console.log = () => {}; console.warn = () => {};
    try { assert.doesNotThrow(() => build({ configPath: site.configPath, site: 'gm' })); } finally { Object.assign(console, saved); }
  });
});
