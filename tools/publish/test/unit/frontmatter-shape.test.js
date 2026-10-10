const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { shapeFrontmatter, TEXT_FIELDS, LIST_FIELDS, RECORD_LIST_FIELDS } = require('../../lib/frontmatter-shape');
const { scanVaultReport, warnScanReport } = require('../../lib/scanner');

const DAY = new Date('2024-03-04T00:00:00Z');

describe('shapeFrontmatter: a field read as one piece of text', () => {
  it('leaves text, an empty value and a field it does not know alone, and hands back the same object', () => {
    const fm = { type: 'npc', status: 'alive', canon_status: null, tags: { any: ['shape'] }, found_by: ['a', 'b'] };
    const got = shapeFrontmatter(fm);
    assert.strictEqual(got.frontmatter, fm);
    assert.deepStrictEqual(got.wrong, []);
  });
  it('reads a number, a true/false and a date as their text, without a word', () => {
    const got = shapeFrontmatter({ type: 'npc', status: 7, canon_status: true, item_type: DAY });
    assert.deepStrictEqual(got.frontmatter, { type: 'npc', status: '7', canon_status: 'true', item_type: '2024-03-04' });
    assert.deepStrictEqual(got.wrong, []);
  });
  it('reads a list of plain values as one value, and says so', () => {
    const got = shapeFrontmatter({ type: ['npc'], status: ['alive', 'missing', 3] });
    assert.deepStrictEqual(got.frontmatter, { type: 'npc', status: 'alive, missing, 3' });
    assert.deepStrictEqual(got.wrong, [
      { field: 'type', problem: 'is a list where one value is expected; it is read as "npc"' },
      { field: 'status', problem: 'is a list where one value is expected; it is read as "alive, missing, 3"' },
    ]);
  });
  it('does not read a set of named values, an empty list or a list that holds one', () => {
    for (const value of [{ now: 'alive' }, [], [{ a: 'b' }], [['a']], ['a', null]]) {
      const got = shapeFrontmatter({ type: 'npc', status: value });
      assert.deepStrictEqual(got.frontmatter, { type: 'npc' }, JSON.stringify(value));
      assert.deepStrictEqual(got.wrong, [{ field: 'status', problem: 'is not a plain value, so it is not read; write one value' }]);
    }
  });
  it('does not change the object it was given', () => {
    const fm = { type: 'npc', status: ['a'] };
    shapeFrontmatter(fm);
    assert.deepStrictEqual(fm, { type: 'npc', status: ['a'] });
  });
});

describe('shapeFrontmatter: a field read as a list', () => {
  it('leaves a list of text alone', () => {
    const fm = { aliases: ['Jon', 'The Clerk'], gm_aliases: 'Elias Crowe' };
    assert.strictEqual(shapeFrontmatter(fm).frontmatter, fm);
  });
  it('reads a number or a date in the list as its text, and drops an empty item, without a word', () => {
    const got = shapeFrontmatter({ aliases: [1984, 'Jon', null, DAY] });
    assert.deepStrictEqual(got.frontmatter, { aliases: ['1984', 'Jon', '2024-03-04'] });
    assert.deepStrictEqual(got.wrong, []);
  });
  it('drops an item that is not a plain value, and says so', () => {
    const got = shapeFrontmatter({ abilities: ['Flight', { name: 'Bite' }, ['x']] });
    assert.deepStrictEqual(got.frontmatter, { abilities: ['Flight'] });
    assert.deepStrictEqual(got.wrong, [{ field: 'abilities', problem: 'holds an item that is not a plain value; that item is not read' }]);
  });
  it('does not read a value that is not a list, and says so', () => {
    for (const value of [{ short: 'Jon' }, 'Jon', 7, true, DAY]) {
      const got = shapeFrontmatter({ aliases: value });
      assert.deepStrictEqual(got.frontmatter, {}, JSON.stringify(value));
      assert.deepStrictEqual(got.wrong, [{ field: 'aliases', problem: 'is not a list, so it is not read; write it as a list, one item to a line' }]);
    }
  });
  it('gm_aliases: one plain value is one secret name; named values are not read', () => {
    assert.deepStrictEqual(shapeFrontmatter({ gm_aliases: 1984 }), { frontmatter: { gm_aliases: '1984' }, wrong: [] });
    assert.deepStrictEqual(shapeFrontmatter({ gm_aliases: { a: 'Elias' } }).wrong,
      [{ field: 'gm_aliases', problem: 'is not a list, so it is not read; write it as a list, one item to a line' }]);
  });
});

describe('shapeFrontmatter: a field read as a list of records', () => {
  it('drops an empty item and nothing else', () => {
    const rel = { target: '[[Jon]]', type: 'knows' };
    assert.deepStrictEqual(shapeFrontmatter({ relationships: [null, rel, 'loose words'] }),
      { frontmatter: { relationships: [rel, 'loose words'] }, wrong: [] });
    const map = { relationships: { knows: ['[[Jon]]'] } };
    assert.strictEqual(shapeFrontmatter(map).frontmatter, map);
  });
});

describe('the scanner shapes what it reads and names what was wrong', () => {
  function vault(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-'));
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
  }
  function warnings(report) {
    const said = [];
    const warn = console.warn;
    console.warn = (...a) => said.push(a.join(' '));
    try { warnScanReport(report); } finally { console.warn = warn; }
    return said;
  }
  it('the note and the field, one line each', () => {
    const root = vault({
      'People/Jon.md': '---\ntype: npc\nstatus:\n  - alive\n  - missing\naliases:\n  short: Jon\n---\nBody.\n',
      'People/Fine.md': '---\ntype: npc\nstatus: alive\naliases:\n  - Mara\n---\nBody.\n',
      'People/Loose.md': '---\nstatus:\n  - no type, so not on the site\n---\nBody.\n',
      'People/Kind.md': '---\ntype:\n  a: npc\n---\nBody.\n',
    });
    try {
      const report = scanVaultReport({ vaultPath: root, excludeDirs: [], folderMap: { People: 'people' } }, { quiet: true });
      const jon = report.pages.find((p) => p.title === 'Jon');
      assert.strictEqual(jon.frontmatter.status, 'alive, missing');
      assert.ok(!('aliases' in jon.frontmatter));
      assert.deepStrictEqual(report.mistyped.map((m) => `${m.rel} ${m.field}`).sort(), ['People/Jon.md aliases', 'People/Jon.md status', 'People/Kind.md type']);
      const said = warnings(report).filter((l) => !/no `type:`/.test(l));
      assert.deepStrictEqual(said.sort(), [
        'scanner: People/Jon.md — aliases: is not a list, so it is not read; write it as a list, one item to a line.',
        'scanner: People/Jon.md — status: is a list where one value is expected; it is read as "alive, missing".',
        'scanner: People/Kind.md — type: is not a plain value, so it is not read; write one value.',
      ]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('past ten it gives the count', () => {
    const files = {};
    for (let i = 0; i < 13; i++) files[`People/N${i}.md`] = '---\ntype: npc\nstatus:\n  a: b\n---\nBody.\n';
    const root = vault(files);
    try {
      const said = warnings(scanVaultReport({ vaultPath: root, excludeDirs: [], folderMap: { People: 'people' } }, { quiet: true }));
      assert.strictEqual(said.length, 11);
      assert.strictEqual(said[10], 'scanner: and 3 more frontmatter value(s) of the wrong type.');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('the lists of fields are what the build test sweeps', () => {
    assert.ok(TEXT_FIELDS.includes('status') && 'aliases' in LIST_FIELDS && RECORD_LIST_FIELDS.includes('relationships'));
  });
});
