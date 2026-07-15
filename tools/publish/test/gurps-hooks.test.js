const { test } = require('node:test');
const assert = require('node:assert');
const { renderEncumbrance } = require('../lib/templates/gurps/blocks/encumbrance');
const { renderSkills } = require('../lib/templates/gurps/blocks/skills');
const { renderMelee } = require('../lib/templates/gurps/blocks/melee');
const { renderAttributes } = require('../lib/templates/gurps/blocks/attributes');
const { renderStatus } = require('../lib/templates/gurps/blocks/status');
const { renderDefenses } = require('../lib/templates/gurps/blocks/defenses');
const { liveStat } = require('../lib/templates/gurps/render');

test('encumbrance rows carry data-level and the block has a readout + reset', () => {
  const html = renderEncumbrance({ encumbrance: [
    { level: 'None (0)', weight: '≤34', move: '6', dodge: '10', current: false },
    { level: 'Light (1)', weight: '≤68', move: '4', dodge: '9', current: true },
  ] });
  assert.match(html, /data-level="0"/);
  assert.match(html, /data-level="1"/);
  assert.match(html, /id="gl-weight"/);
  assert.match(html, /id="gl-move"/);
  assert.match(html, /id="gl-dodge"/);
  assert.match(html, /id="gl-reset"/);
});

test('skill rows expose data-skill-key and a current-level span', () => {
  const html = renderSkills({ skills: [{ name: 'Climbing', level: '12', relative: 'DX-1', points: '1', base: '13', markers: [] }] });
  assert.match(html, /data-skill-key="Climbing"/);
  assert.match(html, /class="sk-cur">12</);
});

test('melee rows expose data-weapon-key and to-hit/parry spans', () => {
  const html = renderMelee({ melee: [{ weapon: 'Vibro-axe', skill: 'Axe/Mace-17', damage: '3d+2', reach: '1', parry: '12' }] });
  assert.match(html, /data-weapon-key="Vibro-axe"/);
  assert.match(html, /class="wp-tohit"/);
  assert.match(html, /class="wp-parry"/);
});

// --- SP1.1: live Move/Dodge across all stat displays ---

test('liveStat wraps only the leading number and preserves the rest', () => {
  // "cur / base" — wrap the cur, keep " / 6" static so base stays visible
  assert.strictEqual(liveStat('4 / 6', 'move'),
    '<span class="gl-live" data-gl-field="move">4</span> / 6');
  // bare integer — wrap it, no trailing text
  assert.strictEqual(liveStat('9', 'dodge'),
    '<span class="gl-live" data-gl-field="dodge">9</span>');
  // trailing parenthetical — wrap the number, keep the note
  assert.strictEqual(liveStat('9 (retreat 12)', 'dodge'),
    '<span class="gl-live" data-gl-field="dodge">9</span> (retreat 12)');
  // no leading number — left untouched (escaped), no span
  assert.strictEqual(liveStat('—', 'dodge'), '—');
  // decimal — capture the whole number so a fractional rewrite doesn't strand ".5"
  assert.strictEqual(liveStat('3.5 / 6', 'move'),
    '<span class="gl-live" data-gl-field="move">3.5</span> / 6');
});

test('attributes Move card wraps the current value, base preserved', () => {
  const html = renderAttributes({ attributes: { secondary: { Move: { value: '4 / 6' } } } });
  assert.match(html, /data-gl-field="move">4<\/span> \/ 6/);
});

test('attributes legacy Dodge derived span is live', () => {
  const html = renderAttributes({ attributes: { dodge: '9' } });
  assert.match(html, /data-gl-field="dodge">9</);
});

test('attributes leaves non-Move/Dodge secondary cards untouched', () => {
  const html = renderAttributes({ attributes: { secondary: { HP: { value: '13' }, Move: { value: '4 / 6' } } } });
  // HP must not become a live field
  assert.doesNotMatch(html, /data-gl-field="[^"]*">13</);
});

test('status Move pip is a live field', () => {
  const html = renderStatus({ status: { move: '4 / 6' } });
  assert.match(html, /Move: <span class="gl-live" data-gl-field="move">4<\/span> \/ 6/);
});

test('defenses Dodge chip is a live field', () => {
  const html = renderDefenses({ defenses: { dodge: '9' } });
  assert.match(html, /data-gl-field="dodge">9</);
});

test('encumbrance readout Move/Dodge are live fields showing cur / base', () => {
  const html = renderEncumbrance({ encumbrance: [
    { level: 'None (0)', weight: '≤34', move: '6', dodge: '10', current: false },
    { level: 'Light (1)', weight: '≤68', move: '4', dodge: '9', current: true },
  ] });
  assert.match(html, /id="gl-move"[^>]*data-gl-field="move"/);
  assert.match(html, /id="gl-dodge"[^>]*data-gl-field="dodge"/);
  // base drawn from the None (level 0) row
  assert.match(html, /data-gl-field="move">[^<]*<\/b> \/ 6/);
  assert.match(html, /data-gl-field="dodge">[^<]*<\/b> \/ 10/);
});
