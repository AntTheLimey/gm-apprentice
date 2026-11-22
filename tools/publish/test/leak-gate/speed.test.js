'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

// The gate's own CPU time, not the clock's: a machine busy with other work (the rest of the suite, another
// worktree's tests) stretches the clock, not the work, so a limit on the clock failed under load (#852).
function timed(fn) {
  const c0 = process.cpuUsage();
  const r = fn();
  const c = process.cpuUsage(c0);
  return { r, cpu: (c.user + c.system) / 1e6 };
}

it('the gate reads a 1,000-page site in under 3 seconds', () => {
  const files = {};
  for (let i = 0; i < 1000; i++) {
    files[`NPCs/N${i}.md`] = `---\ntype: npc\n---\nVisible paragraph number ${i} about the town and its people.\n\n## GM Notes\n\nNumber ${i} secretly serves the drowned god. They meet at the old mill. Nobody suspects them yet.\n`;
  }
  const site = leakSite(files, { player: { folder_map: { NPCs: 'npcs' } } });
  try {
    const page = fs.readFileSync(path.join(site.outputDir, 'npcs', 'n0.html'), 'utf8');
    assert.ok(page.length > 1000);
    const { r, cpu } = timed(() => runLeakGate({ configPath: site.configPath, outputDir: site.outputDir }));
    assert.deepEqual(r.findings, []);
    const limit = process.env.CI ? 9 : 3;   // CI machines are slower; the proof measures the real copies
    assert.ok(cpu < limit, `took ${cpu.toFixed(2)} s of CPU (${r.seconds.toFixed(2)} s on the clock)`);
  } finally { site.cleanup(); }
});

it('the gate reads a 1,000-page site full of comments in under 3 seconds', () => {
  const files = {};
  for (let i = 0; i < 1000; i++) {
    files[`NPCs/N${i}.md`] = `---\ntype: npc\n---\nVisible paragraph number ${i} <!-- aside ${i} --> about the town %% note ${i} %% and its people.\n\n<!-- a line comment -->\n\n%% another line comment %%\n\n<!--\nA comment over\nseveral lines ${i}\n-->\n\nMore visible words, then %%\na multi-line\nobsidian comment\n%% and the end.\n\n## GM Notes\n\nNumber ${i} secretly serves the drowned god. They meet at the old mill. Nobody suspects them yet.\n`;
  }
  const site = leakSite(files, { player: { folder_map: { NPCs: 'npcs' } } });
  try {
    const page = fs.readFileSync(path.join(site.outputDir, 'npcs', 'n0.html'), 'utf8');
    assert.ok(page.length > 1000);
    assert.ok(!page.includes('line comment') && !page.includes('multi-line'), 'comments are not on the page');
    const { r, cpu } = timed(() => runLeakGate({ configPath: site.configPath, outputDir: site.outputDir }));
    assert.deepEqual(r.findings, []);
    const limit = process.env.CI ? 9 : 3;
    assert.ok(cpu < limit, `took ${cpu.toFixed(2)} s of CPU (${r.seconds.toFixed(2)} s on the clock)`);
  } finally { site.cleanup(); }
});
