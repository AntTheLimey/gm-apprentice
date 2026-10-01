// tools/publish/test/integration/build-sheetless-pc.test.js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const matter = require('gray-matter');
const { build } = require('../../lib/build');
const { sheetSourceOf } = require('../../lib/sheet-source');
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

  it('names a CoC investigator whose folio is empty, and sheet_source settles it', () => {
    const lines = run('coc-7e', {
      Empty: pc('', prose),
      Away: pc('sheet_source: "paper"\n', prose),
      Full: pc('', templateBody('pc-coc-7e.md')),
    });
    assert.strictEqual(lines.length, 1, warnings.join('\n'));
    assert.match(lines[0], /1 PC published with no character sheet \(Empty\)/);
    const perPage = warnings.filter(w => w.includes('parsed no characteristics'));
    assert.strictEqual(perPage.length, 1, 'the PC with sheet_source gets no per-page warning either');
    assert.ok(perPage[0].includes('empty.html'));
  });

  it('names a GURPS PC with no stat sheet', () => {
    assert.match(run('gurps-4e', { Solo: pc('', prose) })[0], /1 PC published with no character sheet \(Solo\)/);
  });

  // The one reading of the field. vault_check.py asks for it (`explain --all`'s
  // sheetSourceSet) instead of parsing the YAML itself.
  it('reads sheet_source as a note only when it is text', () => {
    const set = ['"D&D Beyond"', 'D&D Beyond', "'paper, with the player'", 'https://example.com/c/12345',
      '[PDF, group drive]', '\n  - PDF\n  - group drive', '[PDF, 2]', '!!str D&D Beyond', '|\n  D&D Beyond\n  and paper',
      '"# on paper"', 'D&D Beyond # as of May', '"0"', '"null"'];
    const unset = ['', '""', '"   "', 'null', '~', 'NULL', 'false', 'true', '0', '5', '0.0', '.inf', '# where is it',
      '2024-01-01', '[]', '[""]', '[null]', '[5]', '[{a: b}]', '{where: paper}', '\n  where: paper', '|', '>-'];
    const read = value => sheetSourceOf(matter(`---\ntype: pc\nsheet_source: ${value}\n---\n`).data);
    for (const value of set) assert.ok(read(value), `set: ${value}`);
    for (const value of unset) assert.strictEqual(read(value), '', `unset: ${value}`);
    assert.strictEqual(sheetSourceOf({ player_name: 'T' }), '');
    assert.strictEqual(sheetSourceOf(null), '');
    assert.strictEqual(read('[PDF, group drive]'), 'PDF, group drive');
  });

  it('reads sheet_source: null as unset', () => {
    assert.strictEqual(run('fitd', { Solo: pc('sheet_source: null\n', prose) }).length, 1);
  });

  it('names a PC whose Stat Sheet is only a pointer or a TBD', () => {
    // Languages has no Stat Sheet at all, but its proficiency list is something on
    // the Character Sheet tab, so the build does not call the page sheetless.
    // `vault_check pc-body` still reports the missing section.
    const lines = run('dnd-5e-2024', {
      Tbd: pc('', '## Stat Sheet\n\nTBD\n'),
      Pointer: pc('', '## Stat Sheet\n\nSee D&D Beyond.\n'),
      Real: pc('', '## Stat Sheet\n\n### Combat\n\n| Attribute | Value |\n|---|---|\n| AC | 15 |\n'),
      Languages: pc('', '## Proficiencies\n\n**Languages:** Common, Elvish\n'),
      Odd_Table: pc('', '## Stat Sheet\n\n| Thing | Amount |\n|---|---|\n| Grit | high |\n'),
    });
    assert.match(lines[0], /2 PCs published with no character sheet \(Pointer, Tbd\)/);
    assert.ok(read('characters/pcs/tbd.html').includes('TBD'), 'the text itself still publishes');
  });

  it('names eight and counts the rest', () => {
    const many = {};
    for (let i = 1; i <= 11; i++) many[`Pc_${String(i).padStart(2, '0')}`] = pc('', prose);
    const line = run('fitd', many)[0];
    assert.match(line, /11 PCs published with no character sheet \(Pc 01, .*Pc 08, and 3 more\)/);
    assert.ok(!line.includes('Pc 09'));
    assert.match(line, /pc-body/);
  });

  it('is silent for a system with no sheet renderer', () => {
    assert.deepStrictEqual(run('generic', { Hero: pc('', prose) }), []);
  });
});
