// tools/publish/test/integration/build-sheetless-pc.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { templateBody } = require('../helpers/pc-template');

// #273: a PC page with no sheet used to publish without a word to the GM.
describe('build warns about PCs with no character sheet', () => {
  let root;
  let warnings;
  const read = rel => fs.readFileSync(path.join(root, 'docs', rel), 'utf-8');

  function run(system, pcs) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-sheetless-'));
    const vault = path.join(root, 'vault');
    fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
    fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: player\n  system: ${system}\n---\n`);
    for (const [name, text] of Object.entries(pcs)) fs.writeFileSync(path.join(vault, 'Characters', 'PCs', `${name}.md`), text);
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: path.join(root, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Test', system, excludeDirs: ['_meta'], excludeSections: ['GM Notes'],
      folderMap: { 'Characters/PCs': 'characters/pcs' },
    }));
    warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try { build({ configPath }); } finally { console.warn = original; }
    return warnings.filter(w => w.includes('no character sheet'));
  }
  after(() => root && fs.rmSync(root, { recursive: true, force: true }));

  const prose = '## Background\n\nA sailor.\n\n## Notes\n\nNone.\n';
  const pc = (extra, body) => `---\ntype: pc\nplayer_name: T\n${extra}---\n\n${body}`;

  describe('a D&D site', () => {
    let lines;
    before(() => {
      lines = run('dnd-5e-2024', {
        Alistair_Gray: pc('', prose),
        Bryn: pc('', prose),
        Kept_Elsewhere: pc('sheet_source: "SHEET-SOURCE-VALUE"\n', prose),
        Stubbed: pc('publish: stub\npublish_include_sections: ["Background"]\n', prose),
        Sheeted: pc('', templateBody('pc-dnd-5e-2024.md')),
      });
    });

    it('prints one line naming each PC with no sheet', () => {
      assert.strictEqual(lines.length, 1, warnings.join('\n'));
      assert.match(lines[0], /WARNING: 2 PCs published with no character sheet \(Alistair Gray, Bryn\)/);
      assert.match(lines[0], /sheet_source/);
    });
    it('leaves out a PC with a sheet, one with sheet_source, and a stub', () => {
      for (const name of ['Kept Elsewhere', 'Stubbed', 'Sheeted']) assert.ok(!lines[0].includes(name), name);
    });
    it('never publishes the sheet_source value', () => {
      const files = [];
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name))));
      walk(path.join(root, 'docs'));
      for (const file of files) assert.ok(!fs.readFileSync(file, 'utf-8').includes('SHEET-SOURCE-VALUE'), file);
      assert.ok(read('characters/pcs/kept-elsewhere.html').includes('A sailor.'));
    });
  });

  it('says "1 PC" for one', () => {
    const lines = run('fitd', { Solo: pc('', prose) });
    assert.match(lines[0], /WARNING: 1 PC published with no character sheet \(Solo\)/);
  });

  it('is silent when every PC has a sheet', () => {
    assert.deepStrictEqual(run('pf2e', { Hero: pc('', templateBody('pc-pf2e.md')) }), []);
  });

  it('is silent for a system with no sheet renderer', () => {
    assert.deepStrictEqual(run('generic', { Hero: pc('', prose) }), []);
  });
});
