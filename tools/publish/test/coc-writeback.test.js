const { test } = require('node:test');
const assert = require('node:assert');
const { applyCoCFlush } = require('../lib/flush/coc-writeback');

const SHEET = [
  '### Derived',
  '',
  '| Attribute | Max | Current |',
  '|-----------|-----|---------|',
  '| HP | 11 | 11 |',
  '| MP | 13 | 13 |',
  '| Luck | — | 68 (starting 65) |',
  '| Sanity | 92 | 35 (starting 60) |',
  '',
  '### Reputation',
  '',
  '| Attribute | Value |',
  '|-----------|-------|',
  '| Starting Reputation | 45 |',
  '| Current Reputation | 71 |',
  '',
  '### Status',
  '',
  '- [ ] Temporary Insanity',
  '- [x] **Indefinite Insanity**',
  '- [ ] Major Wound',
  '- [ ] Unconscious',
  '- [ ] Dying',
  '',
  '## Skills',
  '',
  '| Skill | Base | Regular | Half | Fifth |',
  '|-------|------|---------|------|-------|',
  '| Spot Hidden | 25 | 58 | 29 | 11 |',
  '',
].join('\n');

const CONDS = { temporaryInsanity: false, indefiniteInsanity: true, majorWound: false, unconscious: false, dying: false };
function blob(over = {}) {
  return Object.assign({ hp: 11, mp: 13, san: 35, luck: 68, rep: 71, conditions: Object.assign({}, CONDS) }, over);
}

test('flushes Derived Current cells and preserves the (starting N) note', () => {
  const { markdown, changes } = applyCoCFlush(SHEET, blob({ hp: 7, san: 31, luck: 60 }));
  assert.match(markdown, /\| HP \| 11 \| 7 \|/);
  assert.match(markdown, /\| Sanity \| 92 \| 31 \(starting 60\) \|/);
  assert.match(markdown, /\| Luck \| — \| 60 \(starting 65\) \|/);
  const fields = changes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['HP', 'Luck', 'Sanity']);
  assert.deepEqual(changes.find((c) => c.field === 'HP'), { field: 'HP', from: '11', to: '7' });
});

test('flushes Current Reputation only when present and non-null', () => {
  const withRep = applyCoCFlush(SHEET, blob({ rep: 50 })).markdown;
  assert.match(withRep, /\| Current Reputation \| 50 \|/);
  assert.match(withRep, /\| Starting Reputation \| 45 \|/); // Starting is never touched
  // Absent rep leaves the Current Reputation row alone.
  const noRep = blob();
  delete noRep.rep;
  assert.match(applyCoCFlush(SHEET, noRep).markdown, /\| Current Reputation \| 71 \|/);
});

test('toggles Status checkboxes with bold-on-ticked, faithful to all five', () => {
  const { markdown } = applyCoCFlush(SHEET, blob({
    conditions: { temporaryInsanity: true, indefiniteInsanity: false, majorWound: true, unconscious: false, dying: true },
  }));
  assert.match(markdown, /- \[x\] \*\*Temporary Insanity\*\*/);
  assert.match(markdown, /- \[ \] Indefinite Insanity/);   // un-ticked drops the bold
  assert.match(markdown, /- \[x\] \*\*Major Wound\*\*/);
  assert.match(markdown, /- \[x\] \*\*Dying\*\*/);
});

test('is idempotent: flushing the sheet\'s own values changes nothing', () => {
  const { markdown, changes } = applyCoCFlush(SHEET, blob());
  assert.equal(changes.length, 0);
  assert.equal(markdown, SHEET); // byte-identical
});

test('skips missing sections/rows and null scalars without crashing', () => {
  const tiny = '### Derived\n\n| Attribute | Max | Current |\n|--|--|--|\n| HP | 11 | 11 |\n';
  const { markdown, changes } = applyCoCFlush(tiny, { hp: null, mp: 4, conditions: {} });
  assert.equal(changes.length, 0);      // hp null → skip; no MP/Status rows to touch
  assert.equal(markdown, tiny);
});

test('never touches the Skills table', () => {
  const { markdown } = applyCoCFlush(SHEET, blob({ hp: 7 }));
  assert.match(markdown, /\| Spot Hidden \| 25 \| 58 \| 29 \| 11 \|/);
});
