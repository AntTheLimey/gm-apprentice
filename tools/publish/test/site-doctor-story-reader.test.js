'use strict';
// PR #472 review: the site doctor pairs a PC with its story through the reader it was given.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { runSiteDoctor } = require('../lib/site-doctor');

const PC = '---\ntype: pc\nsystem: coc\n---\n## Notes\n\nA person.\n';
const STORY = '---\ntype: character-story\n---\n## Tale\n\nOnce.\n';

describe('PR 472: the site doctor and a PC story', () => {
  const site = buildBoth({ 'PCs/Ann.md': PC, 'PCs/Ann_Story.md': STORY }, { sites: [] });
  after(() => site.cleanup());

  it('reads the story file with the reader passed in', async () => {
    const asked = [];
    const readFile = (p) => { if (p.endsWith('_Story.md')) asked.push(p); return fs.readFileSync(p, 'utf8'); };
    await runSiteDoctor({ configPath: site.configPath, json: true }, { out: () => {}, detect: () => null, readFile });
    assert.ok(asked.some((p) => path.basename(p) === 'Ann_Story.md'), JSON.stringify(asked));
  });
});
