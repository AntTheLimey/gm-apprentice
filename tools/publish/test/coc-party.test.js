const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('../js/coc-party.js');

const emma = {
  pcSlug: 'emma-wentworth', name: 'Emma Wentworth', player: 'Missy', dex: 70,
  hp: { cur: 10, max: 10 }, mp: { cur: 12, max: 12 }, san: { cur: 35, max: 92 },
  luck: 80, rep: 71, conditions: { indefiniteInsanity: true },
};

test('cocRowCells: authored defaults when state is null', () => {
  const c = cp.cocRowCells(emma, null);
  assert.match(c.hp, /width:100%/);
  assert.match(c.san, /35<span class="gl-max">\/92<\/span>/);
  assert.match(c.san, /gl-bar-san/);
  assert.match(c.san, /width:38%/);      // round(35/92*100)
  assert.equal(c.dex, '<span class="gl-dex">70</span>');
  assert.equal(c.rep, '<span class="gl-rep">71</span>');
  assert.equal(c.player, 'Missy');
});

test('cocRowCells: indefinite insanity -> mad row + insanity badge', () => {
  const c = cp.cocRowCells(emma, null);
  assert.equal(c.rowClass, 'mad');
  assert.match(c.status, /cond-insanity/);
  assert.match(c.status, /Indefinite Insanity/);
});

test('cocRowCells: no conditions -> Ready badge, empty rowClass', () => {
  const c = cp.cocRowCells({ ...emma, conditions: {} }, null);
  assert.equal(c.rowClass, '');
  assert.match(c.status, /gl-badge ok">Ready/);
});

test('cocRowCells: wound conditions -> hurt row + badges', () => {
  const c = cp.cocRowCells({ ...emma, conditions: { majorWound: true, dying: true } }, null);
  assert.equal(c.rowClass, 'hurt');
  assert.match(c.status, /cond-wound">Major Wound/);
  assert.match(c.status, /cond-dying">Dying/);
});

test('cocRowCells: live state overrides authored values', () => {
  const c = cp.cocRowCells(emma, { hp: 3, san: 10, mp: 1, luck: 12, conditions: {} });
  assert.match(c.hp, /3<span class="gl-max">\/10<\/span>/);
  assert.match(c.hp, /gl-low/);          // 3*3 < 10
  assert.match(c.luck, /gl-low">12/);    // luck < 15 dims
});

test('cocRowCells: mad+hurt combine', () => {
  const c = cp.cocRowCells({ ...emma, conditions: { temporaryInsanity: true, unconscious: true } }, null);
  assert.equal(c.rowClass, 'mad hurt');
});
