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

  it('a PC renamed since the full build stops the fast build before anything is written, naming the old page', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const before = hashes(s.player.dir);
      fs.renameSync(path.join(s.root, 'vault', 'PCs', 'Bo.md'), path.join(s.root, 'vault', 'PCs', 'Bodil.md'));
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' })), /pcs\/bo\.html.*full build/s);
      assert.deepEqual(hashes(s.player.dir), before);
    } finally { s.cleanup(); }
  });

  it('a PC taken off the site (publish: false) stops the fast build, names the page, deletes and writes nothing', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const before = hashes(s.player.dir);
      const bo = path.join(s.root, 'vault', 'PCs', 'Bo.md');
      fs.writeFileSync(bo, fs.readFileSync(bo, 'utf8').replace('type: pc', 'type: pc\npublish: false'));
      assert.throws(() => quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' })), /pcs\/bo\.html.*Run a full build/s);
      assert.deepEqual(hashes(s.player.dir), before);
      assert.ok(s.player.exists('pcs', 'bo.html'));
    } finally { s.cleanup(); }
  });

  it('through the command line the stop exits 1 and says to run a full build', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const bo = path.join(s.root, 'vault', 'PCs', 'Bo.md');
      fs.writeFileSync(bo, fs.readFileSync(bo, 'utf8').replace('type: pc', 'type: pc\npublish: false'));
      const bin = path.join(__dirname, '..', '..', 'bin', 'gm-publish.js');
      const r = spawnSync(process.execPath, [bin, 'build', '--site', 'player', '--only', 'sheets', '--config', s.configPath], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /pcs\/bo\.html/);
      assert.match(r.stderr, /full build/);
    } finally { s.cleanup(); }
  });

  const STORY = '---\ntype: character-story\n---\n# Ann Story\n\nAnn told no one.\n';

  it('each PC story page is written exactly as a full build writes it', () => {
    const s = buildBoth({ ...NOTES, 'PCs/Ann_Story.md': STORY }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('story', 'characters', 'ann.html'));
      const story = path.join(s.root, 'vault', 'PCs', 'Ann_Story.md');
      fs.writeFileSync(story, STORY + '\nShe left at dawn.\n\n## GM Notes\n\nSECRET\n');
      const before = hashes(s.player.dir);
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      const fast = s.player.read('story', 'characters', 'ann.html');
      assert.match(fast, /She left at dawn/);
      assert.doesNotMatch(fast, /SECRET/);
      const after = hashes(s.player.dir);
      for (const [rel, h] of Object.entries(before)) {
        if (rel === path.join('pcs', 'ann.html') || rel === path.join('story', 'characters', 'ann.html')) continue;
        assert.equal(after[rel], h, rel);
      }
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(fast, s.player.read('story', 'characters', 'ann.html'));
    } finally { s.cleanup(); }
  });

  it('a new PC with a story companion gets both pages', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.writeFileSync(path.join(s.root, 'vault', 'PCs', 'Cy.md'), '---\ntype: pc\n---\n# Cy\n');
      fs.writeFileSync(path.join(s.root, 'vault', 'PCs', 'Cy_Story.md'), '---\ntype: character-story\n---\n# Cy Story\n\nCy rose.\n');
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      assert.ok(s.player.exists('pcs', 'cy.html'));
      assert.ok(s.player.exists('story', 'characters', 'cy.html'));
    } finally { s.cleanup(); }
  });

  it('the images a written PC page uses are copied', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      fs.mkdirSync(path.join(s.root, 'vault', '_attachments'), { recursive: true });
      fs.writeFileSync(path.join(s.root, 'vault', '_attachments', 'Ann.png'), png);
      const ann = path.join(s.root, 'vault', 'PCs', 'Ann.md');
      fs.writeFileSync(ann, fs.readFileSync(ann, 'utf8') + '\n![[Ann.png]]\n');
      assert.equal(s.player.exists('images', 'Ann.png'), false);
      quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      assert.match(s.player.read('pcs', 'ann.html'), /Ann\.png/);
      assert.ok(s.player.exists('images', 'Ann.png'));
    } finally { s.cleanup(); }
  });

  it('a prebuild or postbuild script in the site package.json is named, once, as not run', () => {
    const s = buildBoth(NOTES, { sites: ['player'] });
    try {
      fs.writeFileSync(path.join(path.dirname(s.configPath), 'package.json'), JSON.stringify({ scripts: { postbuild: 'node theme.js' } }));
      const lines = [];
      const l = console.log; const w = console.warn;
      console.log = (m) => lines.push(String(m)); console.warn = () => {};
      try { build({ configPath: s.configPath, site: 'player', only: 'sheets' }); } finally { console.log = l; console.warn = w; }
      const hit = lines.filter((m) => /postbuild/.test(m));
      assert.equal(hit.length, 1);
      assert.match(hit[0], /does not run in a sheets-only build/);
      assert.match(hit[0], /update moves build steps into the vault's settings/);
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
