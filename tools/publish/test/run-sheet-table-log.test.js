'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readTableLog } = require('../lib/run-sheet/table-log');

const LOG = [
  '---',
  'type: session-table-log',
  'session: "[[Session 01 - The Road]]"',
  'publish: false',
  '---',
  '',
  '# Session 01 - The Road - Table Log',
  '',
  '## Where everyone ended',
  '',
  '- [[Ada Moss]] at [[The Gate]]',
  '',
  '## stopped IN',
  '',
  '- [[The Gate]]',
  '',
  '## Log',
  '',
  '- 19:40 The wolves came out of the trees.',
  '',
  '## Vitals at the end',
  '',
  '| Who | HP | Conditions |',
  '|-----|----|------------|',
  '| [[Lucan Grey]] | 9/27 | poisoned |',
  '| [[Ada Moss]] | 12 | |',
  '| [[Ben Hart]] | 7 / 20 | |',
  '| [[Frost Wolf]] | lots | dead |',
  '',
  '## Advancement',
  '',
].join('\n');

describe('readTableLog', () => {
  it('reads sections in any case', () => {
    const { sections } = readTableLog(LOG);
    assert.strictEqual(sections.get('Where everyone ended'), '- [[Ada Moss]] at [[The Gate]]');
    // written `## stopped IN`, asked for as the contract spells it, or any other case
    assert.strictEqual(sections.get('Stopped in'), '- [[The Gate]]');
    assert.strictEqual(sections.get('STOPPED IN'), '- [[The Gate]]');
    assert.strictEqual(sections.has('stopped in'), true);
    assert.strictEqual(sections.get('Log'), '- 19:40 The wolves came out of the trees.');
    // a section with nothing under it is there, and empty
    assert.strictEqual(sections.get('Advancement'), '');
    // the frontmatter and the title are no section
    assert.strictEqual([...sections.keys()].some((k) => /type:|table log$/i.test(k)), false);
  });

  it('vitals cur/max and cur alone', () => {
    const { vitals } = readTableLog(LOG);
    assert.deepStrictEqual(vitals, [
      { who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: 27, conditions: 'poisoned' },
      { who: 'Ada Moss', copy: null, hpNow: 12, hpMax: null, conditions: '' },
      { who: 'Ben Hart', copy: null, hpNow: 7, hpMax: 20, conditions: '' },
      // an odd HP cell is no number, never an error
      { who: 'Frost Wolf', copy: null, hpNow: null, hpMax: null, conditions: 'dead' },
    ]);
  });

  it('missing section is empty, not an error', () => {
    const { sections, vitals } = readTableLog('---\ntype: session-table-log\n---\n\n## Loot\n\n- [[Rope]] to [[Ada Moss]]\n');
    assert.strictEqual(sections.get('Vitals at the end'), undefined);
    assert.strictEqual(sections.has('Points landed'), false);
    assert.deepStrictEqual(vitals, []);
    // nothing at all, or not text, reads to nothing
    for (const odd of ['', null, undefined, '## Vitals at the end\n\nnone recorded\n', '## Vitals at the end\n\n| Who | HP |\n|---|---|\n']) {
      const r = readTableLog(odd);
      assert.deepStrictEqual(r.vitals, [], String(odd));
    }
  });

  it('pipe in Who cell takes the target', () => {
    const text = '## Vitals at the end\n\n| Who | HP | Conditions |\n|---|---|---|\n| [[Lucan Grey|Lucan]] | 4/16 | |\n| [[Characters/NPCs/Sister Fen\\|Fen]] | 3 | prone |\n| Garrick | 5/9 | |\n';
    assert.deepStrictEqual(readTableLog(text).vitals, [
      { who: 'Lucan Grey', copy: null, hpNow: 4, hpMax: 16, conditions: '' },
      { who: 'Characters/NPCs/Sister Fen', copy: null, hpNow: 3, hpMax: null, conditions: 'prone' },
      // no link: the cell's text is who it names
      { who: 'Garrick', copy: null, hpNow: 5, hpMax: 9, conditions: '' },
    ]);
  });

  it('negative hit points read as numbers', () => {
    const text = '## Vitals at the end\n\n| Who | HP | Conditions |\n|---|---|---|\n| [[Lucan Grey]] | -3/12 | dying |\n| [[Ada Moss]] | -10 | |\n| [[Ben Hart]] | - 3 | |\n';
    assert.deepStrictEqual(readTableLog(text).vitals.map((v) => [v.who, v.hpNow, v.hpMax]), [
      ['Lucan Grey', -3, 12], ['Ada Moss', -10, null], ['Ben Hart', null, null],
    ]);
  });

  it('a Windows checkout (CRLF) reads the same', () => {
    const crlf = LOG.replace(/\n/g, '\r\n');
    assert.match(crlf, /\r\n/);
    const a = readTableLog(crlf);
    const b = readTableLog(LOG);
    assert.deepStrictEqual(a.vitals, b.vitals);
    assert.deepStrictEqual([...a.sections], [...b.sections]);
    assert.doesNotMatch(JSON.stringify([...a.sections]), /\\r/);
  });

  it('finds the Who, HP and Conditions columns by the header row, in any case', () => {
    const t = (head, sep, row) => `## Vitals at the end\n\n${head}\n${sep}\n${row}\n`;
    const r1 = readTableLog(t('| Who | Max | HP |', '|---|---|---|', '| [[Lucan Grey]] | 27 | 9 |'));
    assert.deepStrictEqual(r1.vitals, [{ who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: null, conditions: '' }]);
    const r2 = readTableLog(t('| who | CONDITIONS | hp |', '|---|---|---|', '| [[Lucan Grey]] | winded | 9/27 |'));
    assert.deepStrictEqual(r2.vitals, [{ who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: 27, conditions: 'winded' }]);
    // no header row (no separator): by position
    const r3 = readTableLog('## Vitals at the end\n\n| [[Lucan Grey]] | 9/27 | winded |\n');
    assert.deepStrictEqual(r3.vitals, [{ who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: 27, conditions: 'winded' }]);
  });

  it('emphasis in the header row still names the columns', () => {
    const r = readTableLog('## Vitals at the end\n\n| **Who** | **Max** | __HP__ | *Conditions* |\n|---|---|---|---|\n| [[Lucan Grey]] | 27 | 9 | winded |\n');
    assert.deepStrictEqual(r.vitals, [{ who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: null, conditions: 'winded' }]);
    assert.deepStrictEqual(r.unnamed, 0);
  });

  it('a header row naming none of the columns is counted and its table not read by position', () => {
    const r = readTableLog('## Vitals at the end\n\n| Name | Max | Now |\n|---|---|---|\n| [[Lucan Grey]] | 27 | 9 |\n');
    assert.deepStrictEqual(r.vitals, []);
    assert.strictEqual(r.unnamed, 1);
  });

  it('reads the HP cell shapes a hand-writer types', () => {
    const cells = ['9/27 hp', '9 of 27', '9/27 (bloodied)', '\u22123/27', '9 HP'];
    const text = '## Vitals at the end\n\n| Who | HP | Conditions |\n|---|---|---|\n'
      + cells.map((c) => `| [[Lucan Grey]] | ${c} | |`).join('\n') + '\n';
    const r = readTableLog(text);
    assert.deepStrictEqual(r.vitals.map((v) => [v.hpNow, v.hpMax]), [[9, 27], [9, 27], [9, 27], [-3, 27], [9, null]]);
    assert.deepStrictEqual(r.unread, []);
  });

  it('lists the rows whose HP cell is not empty and cannot be read', () => {
    const text = '## Vitals at the end\n\n| Who | HP | Conditions |\n|---|---|---|\n'
      + '| [[Lucan Grey]] | fine | |\n| [[Ada Moss]] | | prone |\n| [[Ben Hart]] | 4/9 | |\n';
    assert.deepStrictEqual(readTableLog(text).unread, [{ who: 'Lucan Grey', copy: null, cell: 'fine' }]);
  });

  // Task 20: each system's own columns, found by name; a log without them reads as before
  describe("each system's vitals columns (Task 20)", () => {
    const COC = '## Vitals at the end\n\n| Who | HP | MP | SAN | Luck | Conditions |\n| --- | --- | --- | --- | --- | --- |\n'
      + '| [[Iris Calder]] | 9/11 | 10/12 | 48 | 50 | Major wound |\n| [[Edda Voss]] | 7/10 | 4/10 | 50 |  |  |\n';
    it('table-log reads the CoC columns back', () => {
      assert.deepStrictEqual(readTableLog(COC).vitals, [
        { who: 'Iris Calder', copy: null, hpNow: 9, hpMax: 11, mpNow: 10, mpMax: 12, sanNow: 48, sanMax: null, luck: 50, conditions: 'Major wound' },
        { who: 'Edda Voss', copy: null, hpNow: 7, hpMax: 10, mpNow: 4, mpMax: 10, sanNow: 50, sanMax: null, luck: null, conditions: '' },
      ]);
    });

    it('the GURPS columns, and -3/12 reads back as -3 (an ASCII minus or a typed one)', () => {
      const r = readTableLog('## Vitals at the end\n\n| Who | HP | FP | Conditions |\n| --- | --- | --- | --- |\n'
        + '| [[Orrin Tate]] | -3/12 | 6/12 | Stunned |\n| [[Bram Holt]] | \u22122/12 | \u22121/11 |  |\n');
      assert.deepStrictEqual(r.vitals, [
        { who: 'Orrin Tate', copy: null, hpNow: -3, hpMax: 12, fpNow: 6, fpMax: 12, conditions: 'Stunned' },
        { who: 'Bram Holt', copy: null, hpNow: -2, hpMax: 12, fpNow: -1, fpMax: 11, conditions: '' },
      ]);
    });

    it('an old HP-only log still reads, with no pool figures', () => {
      assert.deepStrictEqual(readTableLog(LOG).vitals[0], { who: 'Lucan Grey', copy: null, hpNow: 9, hpMax: 27, conditions: 'poisoned' });
    });

    it('a headerless table is still read Who, HP, Conditions, however many cells (a CoC vault too)', () => {
      const r = readTableLog('## Vitals at the end\n\n| [[Iris Calder]] | 9/11 | winded | 48 | 50 |\n');
      assert.deepStrictEqual(r.vitals, [{ who: 'Iris Calder', copy: null, hpNow: 9, hpMax: 11, conditions: 'winded' }]);
    });

    it('a pool cell that holds no number reads null and is listed by its column; an empty one is not', () => {
      const r = readTableLog('## Vitals at the end\n\n| Who | HP | MP | SAN | Conditions |\n| --- | --- | --- | --- | --- |\n'
        + '| [[Edda Voss]] | 7/10 | lots | | |\n');
      assert.deepStrictEqual([r.vitals[0].mpNow, r.vitals[0].sanNow], [null, null]);
      assert.deepStrictEqual(r.unread, [{ who: 'Edda Voss', copy: null, cell: 'lots', field: 'mp' }]);
    });
  });
});
