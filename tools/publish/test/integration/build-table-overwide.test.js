'use strict';
// #470: a table with a row wider than its header is widened by the renderer (no cell is lost). The build says so, and
// the note is a TABLE_OVERWIDE finding (information) that campaign-qa's Site Faults check can list and offer to fix.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildBoth } = require('../helpers/gm-build');
const { build } = require('../../lib/build');

const WIDE = '---\ntype: npc\n---\n## Notes\n\n| Item | Value |\n| --- | --- |\n| Sword | 5 | tacked-on remark |\n| Shield | 3 |\n';
const FITS = '---\ntype: npc\n---\n## Notes\n\n| Item | Value |\n| --- | --- |\n| Sword | 5 |\n';

describe('#470: an over-wide table is a note fault', () => {
  const site = buildBoth({ 'NPCs/Wide.md': WIDE, 'NPCs/Fits.md': FITS }, {});
  after(() => site.cleanup());

  it('lists the note once per widened table, as information, with the fix', () => {
    let faults = null;
    const saved = { log: console.log, warn: console.warn };
    const lines = [];
    console.log = () => {}; console.warn = (m) => lines.push(String(m));
    try { build({ configPath: site.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }); } finally { Object.assign(console, saved); }
    const mine = faults.filter((f) => f.code === 'TABLE_OVERWIDE');
    assert.deepEqual(mine.map((f) => f.path), ['NPCs/Wide.md']);
    assert.equal(mine[0].severity, 'info');
    assert.match(mine[0].detail, /a table has 1 row with more cells than its 2-column header \(first: "Sword"\); the table was widened to 3 columns/);
    assert.match(mine[0].fix, /^Add header cells for the extra columns/);
    assert.ok(!lines.some((l) => /TABLE_OVERWIDE/.test(l)), 'the closing summary says nothing more');
  });

  it('the build still warns, as before', () => {
    assert.ok(site.logs.some((l) => l.includes('wide') && /more cells than its 2-column header/.test(l)), JSON.stringify(site.logs));
  });
});
