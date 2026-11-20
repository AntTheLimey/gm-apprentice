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
      { who: 'Lucan Grey', hpNow: 9, hpMax: 27, conditions: 'poisoned' },
      { who: 'Ada Moss', hpNow: 12, hpMax: null, conditions: '' },
      { who: 'Ben Hart', hpNow: 7, hpMax: 20, conditions: '' },
      // an odd HP cell is no number, never an error
      { who: 'Frost Wolf', hpNow: null, hpMax: null, conditions: 'dead' },
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
      { who: 'Lucan Grey', hpNow: 4, hpMax: 16, conditions: '' },
      { who: 'Characters/NPCs/Sister Fen', hpNow: 3, hpMax: null, conditions: 'prone' },
      // no link: the cell's text is who it names
      { who: 'Garrick', hpNow: 5, hpMax: 9, conditions: '' },
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
});
