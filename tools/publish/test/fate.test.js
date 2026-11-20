const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hiddenFate, isDead, isDeadBody } = require('../lib/fate');

const note = (bullets, fm = 'status: alive') => `---\ntype: npc\n${fm}\n---\n\n# Tam\n\n## GM Notes\n\n### Behind the Scenes\n\n${bullets}\n\n### Secrets\n\n- **Dead.** not here\n`;
const S1 = '**[[Session 01 - The Pass]]** — ';

describe('fate: hidden fate and death', () => {
  it('a bold Dead. is dead, with or without a session lead', () => {
    assert.ok(isDead(note(`- ${S1}**Dead.** Fell in the crevasse.`), { status: 'alive' }));
    assert.ok(isDead(note('- **Dead, under the ice.** Nobody saw it.'), { status: 'alive' }));
  });
  it('a later fate beats an earlier one', () => {
    const t = note(`- ${S1}**Dead.** So it seemed.\n- **[[Session 02 - The Thaw]]** — **Alive, freed by the party.**`);
    assert.strictEqual(hiddenFate(t), 'Alive, freed by the party.');
    assert.ok(!isDead(t, { status: 'dead' }));
  });
  it('a struck fate is no fate, tildes outside or inside the bold', () => {
    assert.strictEqual(hiddenFate(note(`- ~~${S1}**Dead.** Fell.~~`)), null);
    assert.strictEqual(hiddenFate(note('- **~~Dead.~~** wrong')), null);
    assert.ok(isDead(note('- **Dead.** x\n- **~~Alive.~~** The report was wrong.'), {}));
  });
  it('a bold lead with no full stop is no fate', () => {
    assert.strictEqual(hiddenFate(note('- **Motive:** he owed the Lodge.')), null);
    assert.ok(isDead(note('- **Dead.** Fell.\n- **The Lodge** recovered his coat.'), {}));
  });
  it('death in passing is no fate', () => {
    assert.strictEqual(hiddenFate(note(`- ${S1}he said his brother was dead. **Dead** men tell no tales.`)), null);
    assert.strictEqual(hiddenFate(note('- He fears the **Dead.**')), null);
  });
  it('no section means status decides; a fate elsewhere is no fate', () => {
    const bare = '---\ntype: npc\nstatus: dead\n---\n\n# Tam\n';
    assert.ok(isDead(bare, { status: 'dead' }));
    assert.ok(!isDead(bare, { status: 'alive' }));
    assert.ok(!isDead('# T\n\n## GM Notes\n\n### Secrets\n\n- **Dead.** x\n', {}));
  });
  it('a CRLF body reads the same', () => {
    assert.ok(isDead(note(`- ${S1}**Dead.** Fell.`).replace(/\n/g, '\r\n'), {}));
  });
  it('only death leaves an NPC dead', () => {
    for (const f of ['**Captive, in the ice crypt.**', '**Missing.**']) assert.ok(!isDead(note(`- ${S1}${f}`), { status: 'dead' }));
  });
  it('a stub GM Notes above the real one is skipped', () => {
    const t = '---\ntype: npc\n---\n\n# Tam\n\n## GM Notes\n\n(fill in)\n\n## Elsewhere\n\n## GM Notes\n\n### Behind the Scenes\n\n- **Dead.** Fell.\n';
    assert.strictEqual(hiddenFate(t), 'Dead.');
  });
  it('a body that opens with a thematic break is not stripped a second time', () => {
    const body = '---\n\nIntro line.\n\n---\n\n## GM Notes\n\n### Behind the Scenes\n\n- **Dead.** Fell.\n';
    assert.ok(isDeadBody(body, {}));
  });
});
