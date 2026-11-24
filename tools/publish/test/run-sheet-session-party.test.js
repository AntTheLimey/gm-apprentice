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

function vault({ indexFm = '', wrap = null, extra = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sp-'));
  made.push(dir);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put(SESSION, `---\ntype: session\nsession_number: 1\n${indexFm}${wrap ? 'documents:\n  wrap_up: "[[Session 01 - Start - Wrap-Up]]"\n' : ''}---\n# Start\n`);
  if (wrap) put(WRAP, `---\ntype: session-wrap-up\nsession: "[[Session 01 - Start]]"\n---\n# Wrap\n\n## Carry\n\n${wrap}\n`);
  for (const [p, t] of [[ADA, 'pc'], [BEN, 'pc'], [CY, 'pc'], [NPC, 'npc'], ...extra]) put(p, `---\ntype: ${t}\n---\n# x\n`);
  return buildIndex(dir);
}
const PLAN = '## PC Roster & Arcs\n\n- **[[Ben Hart]]** (Bo): arc\n- **Ada**: arc\n';

describe('the session party', () => {
  it('index list field wins', () => {
    const index = vault({ indexFm: 'party:\n  - "[[Cy Doe]]"\n  - Ada Moss\n', wrap: '### PC Carry-Forward\n\n- **[[Ben Hart]]** — x\n' });
    const r = sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [BEN] });
    assert.deepStrictEqual(r, { party: [CY, ADA], from: 'index', warnings: [] });
  });

  it('wrap-up carry-forward, Canticle heading shape', () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n#### [[Ada Moss]] (Jay) — Spotlight\n\n- **Did a thing** with [[Cy Doe]]\n\n#### [[Ben Hart]] (Bo) — Quiet\n\n- **Carries forward:** on\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [CY] }), { party: [ADA, BEN], from: 'wrapup', warnings: [] });
  });

  it('wrap-up carry-forward, Dead End bullet shape', () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n- **[[Cy Doe]]** — text\n- **[[Ada Moss|Ada]]** — text\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '', given: [] }), { party: [CY, ADA], from: 'wrapup', warnings: [] });
  });

  it("a carry-forward entry's prose linking another PC does not add that PC", () => {
    const index = vault({ wrap: '### PC Carry-Forward\n\n- **[[Ada Moss]]** — saved [[Ben Hart]] and **[[Cy Doe]]**\n' });
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '', given: [] }).party, [ADA]);
  });

  it('plan roster next', () => {
    const index = vault({});
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [CY] }), { party: [BEN, ADA], from: 'plan', warnings: [] });
  });

  it('given last', () => {
    const index = vault({});
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '## Beats\n', given: [CY] }), { party: [CY], from: 'given', warnings: [] });
  });

  it('a field naming only an NPC falls through, and says so', () => {
    const index = vault({ indexFm: 'party:\n  - "[[Vic Vane]]"\n' });
    const r = sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [] });
    assert.strictEqual(r.from, 'plan');
    assert.deepStrictEqual(r.warnings.map((w) => [w.kind, w.note]), [['missing-pc', SESSION]]);
    assert.match(r.warnings[0].text, /\[\[Vic Vane\]\], which links a note that is no PC/);
  });

  // final review O3: nobody is dropped without a word
  // Task 28 proof (Dead Air): the roster's bold subject is a nickname and its player, the sheet a link at the end.
  it('a roster bullet led by a nickname takes the PC its Sheet link names', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n- **Bo (Sam):** arc; next beat: the cart. Sheet: [[Ben Hart]].\n'
      + '- **Ada (Jay):** arc, with [[Vic Vane]] close by. Sheet: [[Ada Moss]].\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [] });
    assert.deepStrictEqual(r, { party: [BEN, ADA], from: 'plan', warnings: [] });
  });

  it('a nickname bullet with no Sheet link maps to no one, however many PCs it mentions', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n- **Ada (Jay):** arc. Sheet: [[Ada Moss]].\n- **Cy (Tom):** arc with [[Ben Hart]].\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [] });
    assert.deepStrictEqual(r.party, [ADA], 'Cy is not mapped to Ben');
  });

  // Task 32 (Task 29 re-review): the Sheet link is the signal, written `**Sheet:** [[PC]]` too, after a bold subject
  // with no player in brackets
  it('a roster bullet takes its PC from **Sheet:** with the colon inside the bold, and after a subject with no player', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n- **Bo (Sam):** arc; next beat: the cart. **Sheet:** [[Ben Hart]]\n'
      + '- **Wen:** arc, with [[Vic Vane]] close by. Sheet: [[Ada Moss]].\n'
      + '- **Tam:** arc. **Sheet**: [[Cy Doe]]\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [] });
    assert.deepStrictEqual(r, { party: [BEN, ADA, CY], from: 'plan', warnings: [] });
    const crlf = sessionParty({ index, sessionPath: SESSION, planBody: plan.replace(/\n/g, '\r\n'), given: [] });
    assert.deepStrictEqual(crlf.party, [BEN, ADA, CY], 'CRLF');
  });

  it('a bold-subject bullet with no Sheet link takes nothing, whatever it mentions', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n- **Wen:** arc. Sheet: [[Ada Moss]].\n- **Tam:** arc with [[Ben Hart]] and [[Cy Doe]].\n- **Arc theme:** loyalty, see [[Ben Hart]]\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [] });
    assert.deepStrictEqual(r.party, [ADA]);
  });

  it('a label sub-bullet under a PC heading never adds the PC it mentions', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n### [[Ada Moss]]\n- **State:** standing over [[Ben Hart]]\'s body\n- **Next beat:** Sheet: [[Ben Hart]]\n- **Note:** **Sheet:** [[Ben Hart]]\n- **Note:** Jay plays [[Ben Hart]]\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [] });
    assert.deepStrictEqual(r.party, [ADA], 'Ben is not added');
  });

  it('a stale roster link gives a warning and the other PCs', () => {
    const index = vault({});
    const plan = '## PC Roster & Arcs\n\n- **[[Ben Hart]]** (Bo): arc\n- **[[Ada Mossy]]** (Jay): arc\n- **Arc theme:** not a PC\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [CY], planPath: 'P.md' });
    assert.deepStrictEqual([r.party, r.from], [[BEN], 'plan']);
    assert.deepStrictEqual(r.warnings, [{ kind: 'missing-pc', note: 'P.md', text: 'the Plan\'s PC Roster lists [[Ada Mossy]], which names no PC in the vault: left out of tonight\'s party' }],
      'one warning, for the link; a bold label that names no one is not one');
  });

  it('a stale name in the index field gives a warning and the other PCs', () => {
    const index = vault({ indexFm: 'pcs: Ada Moss, Bea Gone\n' });
    const r = sessionParty({ index, sessionPath: SESSION, planBody: PLAN, given: [] });
    assert.deepStrictEqual([r.party, r.from], [[ADA], 'index']);
    assert.deepStrictEqual(r.warnings.map((w) => w.text), ['the session\'s `pcs` lists Bea Gone, which names no PC in the vault: left out of tonight\'s party']);
  });

  it('[[Ben]] linking an NPC Ben does not add PC Ben Hart', () => {
    const index = vault({ extra: [['Characters/NPCs/Ben.md', 'npc']] });
    const plan = '## PC Roster & Arcs\n\n- **[[Ben]]**: arc\n- **[[Ada Moss]]**: arc\n';
    const r = sessionParty({ index, sessionPath: SESSION, planBody: plan, given: [], planPath: 'P.md' });
    assert.deepStrictEqual(r.party, [ADA]);
    assert.match(r.warnings[0].text, /\[\[Ben\]\], which links a note that is no PC/);
    // a plain Ben, with no link, is still PC Ben Hart's first name
    assert.deepStrictEqual(sessionParty({ index, sessionPath: SESSION, planBody: '## PC Roster & Arcs\n\n- **Ben**: arc\n', given: [] }).party, [BEN]);
  });

  it('the reader puts the party\'s warnings among the sheet\'s', () => {
    const { readRunSheet } = require('../lib/run-sheet/read');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-sp-read-'));
    made.push(dir);
    fs.cpSync(path.join(__dirname, 'fixtures', 'run-sheet-app'), dir, { recursive: true });
    const plan = 'Chapters/Chapter 1/Sessions/Session 02/Session 02 - The Test - Plan.md';
    const text = fs.readFileSync(path.join(dir, plan), 'utf8').replace(/\r\n/g, '\n').replace('- **[[Ben Hart]]** (Sam)', '- **[[Ben Hartt]]** (Sam)');
    fs.writeFileSync(path.join(dir, plan), text);
    const m = readRunSheet(dir, plan, { party: [] });
    assert.deepStrictEqual(m.pcs.map((p) => p.note), [ADA]);
    const w = m.warnings.filter((x) => x.kind === 'missing-pc');
    assert.deepStrictEqual(w.map((x) => [x.note, x.text]), [[plan, 'the Plan\'s PC Roster lists [[Ben Hartt]], which names no PC in the vault: left out of tonight\'s party']]);
  });
});
