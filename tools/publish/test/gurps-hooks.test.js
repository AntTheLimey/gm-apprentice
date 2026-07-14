const { test } = require('node:test');
const assert = require('node:assert');
const { renderEncumbrance } = require('../lib/templates/gurps/blocks/encumbrance');
const { renderSkills } = require('../lib/templates/gurps/blocks/skills');
const { renderMelee } = require('../lib/templates/gurps/blocks/melee');

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
