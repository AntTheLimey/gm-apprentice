'use strict';
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildIndex } = require('../lib/run-sheet/notes');
const { sessionParty } = require('../lib/run-sheet/session-party');

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const SESSION = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Start.md';
const WRAP = 'Chapters/Chapter 1/Sessions/Session 01/Session 01 - Start - Wrap-Up.md';
const ADA = 'Characters/PCs/Ada Moss.md';
const BEN = 'Characters/PCs/Ben Hart.md';
const CY = 'Characters/PCs/Cy Doe.md';
const NPC = 'Characters/NPCs/Vic Vane.md';

function vault({ indexFm = '', wrap = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sp-'));
  made.push(dir);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put(SESSION, `---\ntype: session\nsession_number: 1\n${indexFm}${wrap ? 'documents:\n  wrap_up: "[[Session 01 - Start - Wrap-Up]]"\n' : ''}---\n# Start\n`);
  if (wrap) put(WRAP, `---\ntype: session-wrap-up\nsession: "[[Session 01 - Start]]"\n---\n# Wrap\n\n## Carry\n\n${wrap}\n`);
  for (const [p, t] of [[ADA, 'pc'], [BEN, 'pc'], [CY, 'pc'], [NPC, 'npc']]) put(p, `---\ntype: ${t}\n---\n# x\n`);
  return buildIndex(dir);
}
const PLAN = '## PC Roster & Arcs\n\n- **[[Ben Hart]]** (Bo): arc\n- **Ada**: arc\n';

describe('the session party', () => {
  it('index list field wins', () => {
    const index = vault({ indexFm: 'party:\n  - "[[Cy Doe]]"\n  - Ada Moss\n', wrap: '### PC Carry-Forward\n\n- **[[Ben Hart]]** — x\n' });
    const r = sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [BEN] });
    assert.deepStrictEqual(r, { party: [CY, ADA], from: 'index' });
  });

  it('wrap-up carry-forward, Canticle heading shape', () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n#### [[Ada Moss]] (Jay) — Spotlight\n\n- **Did a thing** with [[Cy Doe]]\n\n#### [[Ben Hart]] (Bo) — Quiet\n\n- **Carries forward:** on\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [CY] }), { party: [ADA, BEN], from: 'wrapup' });
  });

  it('wrap-up carry-forward, Dead End bullet shape', () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n- **[[Cy Doe]]** — text\n- **[[Ada Moss|Ada]]** — text\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '', given: [] }), { party: [CY, ADA], from: 'wrapup' });
  });

  it("a carry-forward entry's prose linking another PC does not add that PC", () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n- **[[Ada Moss]]** — saved [[Ben Hart]] and **[[Cy Doe]]**\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '', given: [] }).party, [ADA]);
  });

  it('plan roster next', () => {
    const index = vault({});
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [CY] }), { party: [BEN, ADA], from: 'plan' });
  });

  it('given last', () => {
    const index = vault({});
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '## Beats\n', given: [CY] }), { party: [CY], from: 'given' });
  });

  it('a field naming only an NPC falls through', () => {
    const index = vault({ indexFm: 'party:\n  - "[[Vic Vane]]"\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [] }).from, 'plan');
  });
});
