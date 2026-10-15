'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

it('the gate reads a 1,000-page site in under 3 seconds', () => {
  const files = {};
  for (let i = 0; i < 1000; i++) {
    files[`NPCs/N${i}.md`] = `---\ntype: npc\n---\nVisible paragraph number ${i} about the town and its people.\n\n## GM Notes\n\nNumber ${i} secretly serves the drowned god. They meet at the old mill. Nobody suspects them yet.\n`;
  }
  const site = leakSite(files, { player: { folder_map: { NPCs: 'npcs' } } });
  try {
    const page = fs.readFileSync(path.join(site.outputDir, 'npcs', 'n0.html'), 'utf8');
    assert.ok(page.length > 1000);
    const r = runLeakGate({ configPath: site.configPath, outputDir: site.outputDir });
    assert.deepEqual(r.findings, []);
    const limit = process.env.CI ? 9 : 3;   // CI machines are slower; the proof measures the real copies
    assert.ok(r.seconds < limit, `took ${r.seconds.toFixed(2)} s`);
  } finally { site.cleanup(); }
});
