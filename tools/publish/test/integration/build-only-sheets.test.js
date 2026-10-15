'use strict';
// tools/publish/test/integration/build-only-sheets.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../../lib/build');
const { spawnSync } = require('node:child_process');
const { buildBoth, allFiles } = require('../helpers/gm-build');

const NOTES = {
  'PCs/Ann.md': '---\ntype: pc\noccupation: Clerk\n---\n# Ann\n\n## Background\n\nAnn grew up by the river.\n',
  'PCs/Bo.md': '---\ntype: pc\noccupation: Sailor\n---\n# Bo\n\n## Background\n\nBo.\n',
  'NPCs/Vex.md': '---\ntype: npc\n---\nMentions [[Ann]].\n',
};
const hashes = (dir) => Object.fromEntries(allFiles(dir).map((f) => [path.relative(dir, f), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const quiet = (fn) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };

describe('build --only sheets', () => {
  it('a changed PC field reaches the PC page; every other file is byte-identical', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const before = hashes(s.player.dir);
      const ann = path.join(s.root, 'vault', 'PCs', 'Ann.md');
      fs.writeFileSync(ann, fs.readFileSync(ann, 'utf8').replace('Clerk', 'Archivist'));
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      const after = hashes(s.player.dir);
      assert.match(s.player.read('pcs', 'ann.html'), /Archivist/);
      for (const [rel, h] of Object.entries(before)) {
        if (rel === path.join('pcs', 'ann.html')) continue;
        assert.equal(after[rel], h, rel);
      }
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    } finally { s.cleanup(); }
  });

  it('the PC page it writes is the page a full build writes', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const ann = path.join(s.root, 'vault', 'PCs', 'Ann.md');
      fs.writeFileSync(ann, fs.readFileSync(ann, 'utf8').replace('Clerk', 'Archivist'));
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      const fast = s.player.read('pcs', 'ann.html');
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(fast, s.player.read('pcs', 'ann.html'));
    } finally { s.cleanup(); }
  });

  it('refuses a folder with no full build, and writes nothing', () => {
    const s = buildBoth(NOTES, { sites: [] });
    try {
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' })), /no full build/);
      assert.equal(fs.existsSync(s.player.dir), false);
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'gm', only: 'sheets' })), /no full build/);
    } finally { s.cleanup(); }
  });

  it('works on the GM site, marks and all', () => {
    const s = buildBoth({ ...NOTES, 'PCs/Ann.md': NOTES['PCs/Ann.md'] + '\n## GM Notes\n\nHIDDEN\n' });
    try {
      quiet(() => build({ configPath: s.configPath, site: 'gm', only: 'sheets' }));
      assert.match(s.gm.read('pcs', 'ann.html'), /data-gm-kind="sections"/);
    } finally { s.cleanup(); }
  });

  it('a PC added since the full build gets its page', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.writeFileSync(path.join(s.root, 'vault', 'PCs', 'Cy.md'), '---\ntype: pc\n---\n# Cy\n');
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      assert.ok(s.player.exists('pcs', 'cy.html'));
    } finally { s.cleanup(); }
  });

  it('runs the after_build steps and not the before_build steps', () => {
    const s = buildBoth(NOTES, { sites: [], player: { before_build: ['node before.js'], after_build: ['node after.js'] } });
    try {
      const siteDir = path.dirname(s.configPath);
      // after.js adds a line to every page that lacks it (idempotent, as Dead End's steps are); before.js leaves a file.
      fs.writeFileSync(path.join(siteDir, 'after.js'), [
        "const fs = require('fs'); const path = require('path');",
        "const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);",
        "for (const f of walk(path.join(__dirname, 'docs')).filter((x) => x.endsWith('.html'))) {",
        "  const t = fs.readFileSync(f, 'utf8'); if (!t.includes('<!-- step -->')) fs.writeFileSync(f, t + '<!-- step -->');",
        '}',
      ].join('\n'));
      fs.writeFileSync(path.join(siteDir, 'before.js'), "require('fs').writeFileSync(require('path').join(__dirname, 'before-ran'), 'x');");
      quiet(() => build({ configPath: s.configPath, site: 'player', runSteps: true }));
      fs.rmSync(path.join(siteDir, 'before-ran'));
      const before = hashes(s.player.dir);
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets', runSteps: true }));
      assert.equal(fs.existsSync(path.join(siteDir, 'before-ran')), false);
      assert.equal((s.player.read('pcs', 'ann.html').match(/<!-- step -->/g) || []).length, 1);
      const after = hashes(s.player.dir);
      for (const [rel, h] of Object.entries(before)) assert.equal(after[rel], h, rel);
    } finally { s.cleanup(); }
  });

  it('a PC renamed since the full build gets its new page, and the line says a full build tidies the rest', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.renameSync(path.join(s.root, 'vault', 'PCs', 'Bo.md'), path.join(s.root, 'vault', 'PCs', 'Bodil.md'));
      const lines = [];
      const l = console.log; const w = console.warn;
      console.log = (m) => lines.push(String(m)); console.warn = () => {};
      try { build({ configPath: s.configPath, site: 'player', only: 'sheets' }); } finally { console.log = l; console.warn = w; }
      assert.ok(s.player.exists('pcs', 'bodil.html'));
      assert.ok(lines.some((m) => /1 character page is new; a full build updates the menu and the lists that link it/.test(m)));
    } finally { s.cleanup(); }
  });

  it('the command takes only "sheets", and rebuilds through the command line', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const bin = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
      const bad = spawnSync(process.execPath, [bin, 'build', '--only', 'x', '--config', s.configPath], { encoding: 'utf8' });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /Unknown --only value: x\. The only one is sheets\./);
      const before = hashes(s.player.dir);
      const ok = spawnSync(process.execPath, [bin, 'build', '--site', 'player', '--only', 'sheets', '--config', s.configPath], { encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /Updated 2 character pages; nothing else was rewritten\./);
      assert.deepEqual(hashes(s.player.dir), before);
    } finally { s.cleanup(); }
  });
});
