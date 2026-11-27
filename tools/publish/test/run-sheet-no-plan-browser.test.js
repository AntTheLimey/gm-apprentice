'use strict';
// The no-Plan run sheet's GM page (plan Task 8) in a real browser, against the real server on the record fixture
// (test/fixtures/run-sheet-record: Sessions 13 and 14 wrapped up, Session 15 not in the vault yet). Real input only:
// a held mouse press, key events and Input.insertText (helpers/cdp.js), never dispatchEvent or .click(). Every test runs
// at 1449, 1280 and 1100 wide, 762 high. The filing (`gma table-file`) is faked through deps.runFileLog, as the server
// tests fake it. What is checked: where the crew is, Move them and Fight here on the first screen (audit P1, P6); the
// rail in the page's order, again after a move (P2, P5); Move them re-ranking the cards; Fight here ticking the crew in
// once and never an empty chip (P7); the title box before and after the filing (D2, D8); nothing new on the players'
// screen; and no sideways scroll.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createTableServer, listenLocal } = require('../lib/run-sheet/server');
const { listSessions, pickSession, stateFileFor } = require('../lib/run-sheet/sessions');
const { browserSkip } = require('./helpers/browser');
const { withPage } = require('./helpers/cdp');
const { copyRecordFixture } = require('./helpers/record-fixture');
const { removeFixture } = require('./helpers/systems-fixture');

const PROBE = 'JSON.parse(document.body.dataset.probe || "null")';
const WIDTHS = [1449, 1280, 1100];
const HEIGHT = 762;
const SHOTS = path.join(__dirname, '..', '..', '..', 'tests', 'proof-runs', 'run-sheet-no-plan', 'shots');
const S15 = 'Chapters/Chapter 3/Sessions/Session 15';
const SALT = 'Locations/The Salt Inn.md';
const FESTIVAL = 'Locations/Harbour Festival Grounds.md';
const CMD = ['gma', 'table-file', 'VAULT', '--number', '15', '--chapter', 'Chapter 3'];
// the night the sheet opens, in local time (D3)
const OPENED = new Date(2026, 10, 29, 20, 15);
// Words of the fixture's cards, Coming up, Background and Last time: none may reach the players' screen.
const SECRET_WORDS = ['swears she never paid', 'hides the crew', 'slipping the crew notes', 'does with the page', 'learns of the scuffle',
  'Lamplighters Guild hall', 'arguing over', 'heard all of it', 'port evidence', 'blame the crew', "chandler's safe", 'lamp oil',
  'Festival schedule', 'opens at dusk', 'lamplighters starts at midnight', 'Unsigned notes', 'Possible scenes', 'Coming up'];

const made = [];
const servers = [];
after(async () => {
  for (const s of servers) await s.close();
  for (const d of made) removeFixture(d);
});

// Stands in for `gma table-file`: the index and its empty Table Log, the index's CREATED row first (the server tests' own).
function tableFiler(vault) {
  const calls = [];
  const runFileLog = async (cmd) => {
    calls.push(cmd);
    const a = cmd.find((x) => x.startsWith('--title='));
    const stem = `Session 15 - ${a ? a.slice('--title='.length) : 'untitled'}`;
    const idx = `${S15}/${stem}.md`;
    const log = `${S15}/${stem} - Table Log.md`;
    fs.mkdirSync(path.join(vault, S15), { recursive: true });
    fs.writeFileSync(path.join(vault, idx), `---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nplay_date: "${cmd[cmd.indexOf('--play-date') + 1]}"\nstatus: planned\ndocuments:\n  plan: null\n  table_log: "[[${stem} - Table Log]]"\n  wrap_up: null\n---\n\n# ${stem}\n`);
    fs.writeFileSync(path.join(vault, log), `---\ntype: session-table-log\nsession: "[[${stem}]]"\ncreated_by: run-sheet\n---\n\n# ${stem} - Table Log\n\n## Log\n`);
    return { ok: true, out: `CREATED\t${idx}\t\tsession template\nCREATED\t${log}\t\tthe Table Log's 18 sections, empty\n` };
  };
  return { calls, runFileLog };
}

async function startRec({ crlf = false, prepped = null, noPlace = false } = {}) {
  const vault = copyRecordFixture({ crlf });
  made.push(vault);
  // a record that names no place for the crew: the World State's Location and Pell's note's are left empty
  if (noPlace) {
    const blank = (rel, from, to) => {
      const f = path.join(vault, rel);
      const t = fs.readFileSync(f, 'utf8');
      assert.ok(t.includes(from), `${rel} holds ${from}`);
      fs.writeFileSync(f, t.replace(from, to));
    };
    blank('Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Wrap-Up.md', '**Location:** [[The Salt Inn]]', '**Location:**');
    blank('Characters/PCs/Pell Rowan.md', '**Location:** [[The Salt Inn]]', '**Location:**');
  }
  // session-prep filed Session 15's index (no Plan, no Table Log): the sheet opens it, named
  if (prepped) {
    fs.mkdirSync(path.join(vault, S15), { recursive: true });
    fs.writeFileSync(path.join(vault, S15, `${prepped}.md`), `---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nstatus: planned\ndocuments:\n  plan: null\n  table_log: null\n  wrap_up: null\n---\n\n# ${prepped}\n`);
  }
  const session = pickSession(listSessions(vault), null, vault).session;
  assert.ok(session && session.fromRecord, 'the record gives Session 15');
  const { file, stateId } = stateFileFor(vault, session);
  const filer = tableFiler(vault);
  const t = createTableServer({ vaultPath: vault, session, stateFile: file, stateId, fileLog: prepped ? ['gma', 'table-log-new'] : { cmd: CMD, takesTitle: true },
    deps: { delayMs: 50, log: () => {}, now: () => OPENED, runFileLog: filer.runFileLog } });
  const port = await listenLocal(t.server, 0);
  servers.push(t);
  return { ...t, vault, port, filer, base: `http://127.0.0.1:${port}/` };
}
const api = async (run, url) => (await fetch(`${run.base.slice(0, -1)}${url}`)).json();
const stateOf = async (run) => (await api(run, '/api/state')).state;
const probe = (page) => page.evaluate(PROBE);
const settled = (page) => page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && document.getElementById('where') && p; })()`);

// An element wholly in the window (both edges, both ways) and the thing under its centre is itself.
const inView = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return { found: false };
  const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { found: true, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    whole: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0 && r.height > 0,
    hit: Boolean(top) && (top === e || e.contains(top)) }; })()`);
const noSideways = (page) => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
// The rail's links in order, and whether their targets stand in the same order down the page.
const railNames = (page) => page.evaluate('Array.from(document.querySelectorAll("#rail a[data-go]"), (a) => a.textContent.trim())');
const railInPageOrder = (page) => page.evaluate(`(() => { const ids = Array.from(document.querySelectorAll('#rail a[data-go]'), (a) => a.dataset.go);
  const els = ids.map((id) => document.getElementById(id)); if (els.some((e) => !e)) return { ok: false, missing: ids.filter((id, i) => !els[i]) };
  for (let i = 1; i < els.length; i++) if (!(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return { ok: false, at: ids[i] };
  return { ok: true }; })()`);
const cardTitles = (page, group) => page.evaluate(`Array.from(document.querySelectorAll('#scenes [data-cards="${group}"] .card h3'), (h) => h.textContent.trim())`);

const BEFORE_MOVE = ['Where they are', 'Coming up', 'Odalys Venn', 'Harl Brannock', 'Unsigned notes: someone keeps slipping', 'Corvin Tash',
  'Places', 'People', 'The PCs', 'End of the night'];
const AFTER_MOVE = ['Where they are', 'Coming up', 'Unsigned notes: someone keeps slipping', 'Corvin Tash', 'Places', 'People', 'The PCs', 'End of the night'];

describe('the no-Plan page in a browser', { skip: browserSkip() }, () => {
  for (const width of WIDTHS) {
    it(`the first screen holds where they are, Move them and Fight here (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.strictEqual(await page.evaluate('window.scrollY'), 0);
        const head = await page.evaluate('document.querySelector("#rhead").textContent');
        assert.match(head, /Session 15, no Plan: built from Session 14's Wrap-Up/);
        const row = await page.evaluate('document.querySelector("#where .wrow").textContent');
        for (const n of ['Joss', 'Mirren', 'Pell', 'Yarrow']) assert.match(row, new RegExp(n));
        assert.match(row, /The Salt Inn/);
        for (const sel of ['#where .wrow .who', '#where .wrow .pchip:first-child', '#where .wrow .pchip:last-child', '#where .wrow [data-movebox]',
          `#where .wrow [data-fplace="${SALT}"]`, '#rtitle']) {
          const v = await inView(page, sel);
          assert.ok(v.found && v.whole && v.hit, `${sel} wholly on the first screen at ${width}: ${JSON.stringify(v)}`);
        }
        assert.strictEqual(await noSideways(page), true, 'no sideways scroll');
        // the title box: optional, with the date the sheet opened as its placeholder
        assert.strictEqual(await page.evaluate('document.getElementById("rtitle").placeholder'), '29 Nov 2026');
        assert.match(await page.evaluate('document.querySelector("label[for=rtitle]").textContent'), /Tonight's title \(optional\)/);
        assert.match(await page.evaluate('document.querySelector("#rleft").textContent'), /^Points to land and If-they need a Plan\.$/);
        // the Plan sheet's sections are not drawn
        assert.strictEqual(await page.evaluate('Boolean(document.getElementById("run") || document.getElementById("handover"))'), false);
        // the players' preview, with nobody placed, says so without the Plan's word "beat"
        assert.match(await page.evaluate('document.getElementById("side").textContent'), /Nobody is placed yet: the players see the campaign's name\./);
        // the party came from the last Wrap-Up, not tonight's
        assert.match(await page.evaluate('document.querySelector("#pcs").textContent'), /from the last Wrap-Up/);
        // no D&D word on a GURPS sheet
        const text = await page.evaluate('document.getElementById("sheet").textContent');
        assert.doesNotMatch(text, /\b(AC|Long rest|initiative|level \d)\b/);
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot(path.join(SHOTS, `task-8-first-screen-${width}.png`));
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`the rail matches the page's order, and again after Move them (${width})`, async () => {
      const run = await startRec({ crlf: width === 1280 });
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.deepStrictEqual(await railNames(page), BEFORE_MOVE);
        assert.deepStrictEqual(await railInPageOrder(page), { ok: true });
        // a rail card jumps to its card: out of view before, the press lands on the link, the page scrolls, the heading
        // is then wholly in view. A Here card and a Could-come card.
        const { model } = await api(run, '/api/model');
        const idOf = (t) => model.record.cards.find((c) => c.title === t).id;
        for (const t of ['Odalys Venn', 'Corvin Tash']) {
          const head = `[id="card:${idOf(t)}"] h3`;
          if (t === 'Corvin Tash') { await page.wheel(400, 400, -20000); }
          const was = await inView(page, head);
          assert.ok(was.found && !was.whole, `${t}'s card is out of view before the jump: ${JSON.stringify(was)}`);
          const y0 = await page.evaluate('window.scrollY');
          const hit = await page.click(`#rail a[data-go="card:${idOf(t)}"]`);
          assert.ok(hit.inView && hit.hit, `the rail link takes the press: ${JSON.stringify(hit)}`);
          await page.waitFor(`window.scrollY !== ${y0}`);
          await page.sleep(100);
          const v = await inView(page, head);
          assert.ok(v.whole, `${t}'s heading is in view: ${JSON.stringify(v)}`);
          assert.strictEqual(await page.evaluate(`document.querySelector(${JSON.stringify(head)}).textContent`), t);
        }
        await page.wheel(400, 400, -20000);
        // Move them, by the keyboard, to the other city
        await page.click('#where .wrow input[data-movebox]');
        await page.type('Marrow');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        await page.waitFor('/Marrow Market/.test(document.querySelector("#where .wrow").textContent)');
        assert.deepStrictEqual(await railNames(page), AFTER_MOVE);
        assert.deepStrictEqual(await railInPageOrder(page), { ok: true });
        assert.strictEqual(await noSideways(page), true);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`Move them to the other city re-ranks: Here empties (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.deepStrictEqual(await cardTitles(page, 'here'), ['Odalys Venn', 'Harl Brannock']);
        assert.deepStrictEqual(await cardTitles(page, 'could'), ['Unsigned notes: someone keeps slipping', 'Corvin Tash']);
        // every card names where its bullets came from
        assert.match(await page.evaluate('document.querySelector("#scenes .card").textContent'), /Unresolved Threads/);
        assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#places .place a.lk"), (a) => a.textContent)'), ['The Salt Inn']);
        await page.click('#where .wrow input[data-movebox]');
        await page.type('Marrow Mar');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.click('#where [data-movepick]');
        await settled(page);
        await page.waitFor('/Marrow Market/.test(document.querySelector("#where .wrow").textContent)');
        assert.deepStrictEqual(await cardTitles(page, 'here'), []);
        assert.match(await page.evaluate('document.querySelector("#scenes [data-cards=here]").textContent'), /Nothing on the record is here/);
        assert.deepStrictEqual(await cardTitles(page, 'elsewhere'), ['Odalys Venn', 'Harl Brannock']);
        assert.strictEqual(await page.evaluate('document.querySelector("#scenes details[data-cards=elsewhere]").open'), false, 'Elsewhere is folded');
        assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#places .place a.lk"), (a) => a.textContent)'), ['Marrow Market']);
        const s = await stateOf(run);
        assert.ok(Object.values(s.positions).every((p) => p && p.beat === 'pl-3b2cc69c'), JSON.stringify(s.positions));
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`Fight here at the Salt Inn ticks the crew in once (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await page.click(`#where .wrow [data-fplace="${SALT}"]`);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
        await page.waitFor('document.querySelector("#side .fin .gchip")');
        const p = await probe(page);
        assert.deepStrictEqual(p.fight.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [true, true, true, true], 'the four stand there');
        const chips = await page.evaluate('Array.from(document.querySelectorAll("#side .fin .gchip"), (c) => c.textContent)');
        assert.strictEqual(chips.length, 1, `one chip: ${chips.join(' | ')}`);
        assert.match(chips[0], /Joss, Mirren, Pell, Yarrow · The Salt Inn/);
        assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#side [data-faddgroup]"), (b) => b.textContent)'), [], 'nobody left to add');
        const s = await stateOf(run);
        assert.ok(!s.events.some((l) => /\bmove/i.test(l.text || '')), `placing the crew where the record has them logs no move: ${JSON.stringify(s.events)}`);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`Fight here away from the crew offers the crew once, with no empty chip (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await page.click(`#coming .lead [data-fplace="${FESTIVAL}"]`);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p; })()`);
        await page.waitFor('document.querySelector("#side .fadd")');
        const p = await probe(page);
        assert.deepStrictEqual(p.fight.rows.filter((r) => r.kind === 'pc').map((r) => r.in), [false, false, false, false], 'nobody stands there');
        const adds = await page.evaluate('Array.from(document.querySelectorAll("#side [data-faddgroup]"), (b) => b.textContent)');
        assert.deepStrictEqual(adds, ['+ the crew at The Salt Inn']);
        const chips = await page.evaluate('Array.from(document.querySelectorAll("#side .fin .gchip"), (c) => c.textContent)');
        assert.ok(chips.every((c) => !c.startsWith('—')), `no empty chip: ${chips.join(' | ')}`);
        await page.click('#side [data-faddgroup]');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.fight.rows.filter((r) => r.kind === 'pc' && r.in).length === 4 && p; })()`);
        const after = await page.evaluate('Array.from(document.querySelectorAll("#side .fin .gchip"), (c) => c.textContent)');
        assert.strictEqual(after.filter((c) => /Joss/.test(c)).length, 1, `the crew once: ${after.join(' | ')}`);
        assert.ok(after.every((c) => !c.startsWith('—')), `no empty chip: ${after.join(' | ')}`);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`typing a title then a jot files under that title, and the box then says Filed as (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        // a title the vault can't use is named while the box holds it (D8)
        await page.click('#rtitle');
        await page.type('Lamp/Fair');
        await page.waitFor('/A title can\'t hold/.test(document.getElementById("rtbad").textContent)');
        assert.strictEqual(await page.evaluate('document.getElementById("rtbad").textContent'), 'A title can\'t hold \\ / : * ? " < > | # ^ [ ]');
        for (let i = 0; i < 'Lamp/Fair'.length; i++) await page.key('Backspace');
        await page.waitFor('document.getElementById("rtbad").textContent === ""');
        await page.type('The Lamp Fair');
        // the jot box, then a line and Enter
        await page.click('#hjot');
        await page.type('The crew lands at Dock Row.');
        await page.key('Enter');
        await page.waitFor('/Filed as Session 15 - The Lamp Fair/.test((document.getElementById("rfiled") || {}).textContent || "")');
        assert.strictEqual(await page.evaluate('document.getElementById("rtitle")'), null, 'the box is gone once filed');
        assert.strictEqual(run.filer.calls.length, 1);
        assert.ok(run.filer.calls[0].includes('--title=The Lamp Fair'), JSON.stringify(run.filer.calls[0]));
        const v = await inView(page, '#rfiled');
        assert.ok(v.whole, JSON.stringify(v));
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // Review Focus 5 (fix round 1): a crew split across two places, then each group focused in turn. The cards, the
    // places and the rail re-rank around the focused group's place, and the rail keeps the page's order.
    it(`a split crew re-ranks around whichever group is focused (${width})`, async () => {
      const run = await startRec({ crlf: width === 1100 });
      const PELL = 'Characters/PCs/Pell Rowan.md';
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        // pick Pell, then Move them: Pell alone goes to Marrow Market
        await page.click(`#where [data-wpick="${PELL}"]`);
        await page.waitFor(`document.querySelector('#where [data-wpick="${PELL}"]').getAttribute('aria-pressed') === 'true'`);
        await page.click(`#where [data-wrow="__crew"] input[data-movebox]`);
        await page.type('Marrow');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        await page.waitFor('document.querySelectorAll("#where .wrow").length === 2');
        const s = await stateOf(run);
        assert.deepStrictEqual(Object.keys(s.positions), [PELL], 'only Pell moved');
        const rows = await page.evaluate('Array.from(document.querySelectorAll("#where .wrow"), (r) => r.textContent)');
        assert.match(rows.find((r) => /Pell/.test(r)), /Marrow Market/);
        assert.match(rows.find((r) => /Joss/.test(r)), /The Salt Inn/);
        assert.ok(!/Pell/.test(rows.find((r) => /Joss/.test(r))), 'Pell left the crew\'s row');
        const marrow = async () => {
          assert.deepStrictEqual(await cardTitles(page, 'here'), []);
          assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#places .place a.lk"), (a) => a.textContent)'), ['Marrow Market']);
          assert.deepStrictEqual(await railNames(page), AFTER_MOVE);
          assert.deepStrictEqual(await railInPageOrder(page), { ok: true });
        };
        const salt = async () => {
          assert.deepStrictEqual(await cardTitles(page, 'here'), ['Odalys Venn', 'Harl Brannock']);
          assert.deepStrictEqual(await page.evaluate('Array.from(document.querySelectorAll("#places .place a.lk"), (a) => a.textContent)'), ['The Salt Inn']);
          assert.deepStrictEqual(await railNames(page), BEFORE_MOVE);
          assert.deepStrictEqual(await railInPageOrder(page), { ok: true });
        };
        // the moved group is focused
        await marrow();
        // the rail shows the same two groups, with their faces
        const rail = await page.evaluate('Array.from(document.querySelectorAll("#rail a[data-pgroup]"), (a) => a.textContent)');
        assert.deepStrictEqual(rail.map((t) => t.replace(/[A-Z]+$/, '')), ['Marrow Market', 'The Salt Inn']);
        // focus the crew still at the inn (its row's Focus), then Pell's group again (from the rail)
        await page.click('#where [data-wrow="__crew"] [data-pgroup]');
        await page.waitFor('document.querySelector("#where [data-wrow=__crew]").classList.contains("focus")');
        await salt();
        await page.click('#rail a[data-pgroup="pl-3b2cc69c"]');
        await page.waitFor('document.querySelector("#where [data-wrow=pl-3b2cc69c]").classList.contains("focus")');
        await marrow();
        // Move them for one group moves that group alone: the crew at the inn goes to Dock Row; Pell stays
        await page.click('#where [data-wrow="__crew"] input[data-movebox]');
        await page.type('Dock Row');
        await page.waitFor('document.querySelector("#where [data-wrow=__crew] [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        const after = await stateOf(run);
        assert.strictEqual(after.positions[PELL].beat, 'pl-3b2cc69c');
        assert.ok(['Joss Harker', 'Mirren Fell', 'Yarrow Tide'].every((n) => after.positions[`Characters/PCs/${n}.md`].beat === 'pl-dccbec2f'));
        assert.deepStrictEqual(await cardTitles(page, 'here'), ['Odalys Venn', 'Harl Brannock'], 'Dock Row is focused now: the harbour cards');
        assert.deepStrictEqual(await railInPageOrder(page), { ok: true });
        assert.strictEqual(await noSideways(page), true);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`a PC goes off-screen and comes back (${width})`, async () => {
      const run = await startRec();
      const YARROW = 'Characters/PCs/Yarrow Tide.md';
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await page.click(`#where [data-off="${YARROW}"]`);
        await page.waitFor('document.getElementById("woff")');
        await settled(page);
        assert.match(await page.evaluate('document.getElementById("woff").textContent'), /Off-screen: .*Yarrow/);
        assert.ok(!/Yarrow/.test(await page.evaluate('document.querySelector("#where .wrow").textContent')), 'not in the crew\'s row');
        assert.match(await page.evaluate('document.getElementById("rail").textContent'), /Off-screen/);
        assert.deepStrictEqual((await stateOf(run)).positions[YARROW], { off: true });
        const v = await inView(page, `#woff [data-wback="${YARROW}"]`);
        assert.ok(v.whole && v.hit, JSON.stringify(v));
        await page.click(`#woff [data-wback="${YARROW}"]`);
        await page.waitFor('!document.getElementById("woff")');
        await settled(page);
        const s = await stateOf(run);
        assert.deepStrictEqual(s.positions[YARROW], { beat: 'pl-dcecf058', spot: null }, 'back with the crew, at the inn');
        // that PC alone: the others stay where the record has them, not placed (fix round 3)
        assert.deepStrictEqual(Object.keys(s.positions), [YARROW], `only Yarrow is placed: ${JSON.stringify(s.positions)}`);
        assert.match(await page.evaluate('document.querySelector("#where .wrow").textContent'), /Yarrow/);
        assert.ok(!s.events.some((l) => /\bmove/i.test(l.text || '')), `no move logged: ${JSON.stringify(s.events)}`);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`with nowhere to go, the off-screen line says Move them first, then offers back (${width})`, async () => {
      const run = await startRec({ noPlace: true });
      const YARROW = 'Characters/PCs/Yarrow Tide.md';
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.match(await page.evaluate('document.querySelector("#where .wrow").textContent'), /a place the record does not name/);
        await page.click(`#where [data-off="${YARROW}"]`);
        await page.waitFor('document.getElementById("woff")');
        await settled(page);
        assert.strictEqual(await page.evaluate('document.querySelector("#woff [data-wback]")'), null, 'no dead "back" button');
        assert.match(await page.evaluate('document.getElementById("woff").textContent'), /back: Move them first/);
        // Move them gives the crew a place: "back" now goes there
        await page.click('#where .wrow input[data-movebox]');
        await page.type('Marrow');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        await page.waitFor(`document.querySelector('#woff [data-wback="${YARROW}"]')`);
        assert.doesNotMatch(await page.evaluate('document.getElementById("woff").textContent'), /Move them first/);
        await page.click(`#woff [data-wback="${YARROW}"]`);
        await page.waitFor('!document.getElementById("woff")');
        await settled(page);
        assert.deepStrictEqual((await stateOf(run)).positions[YARROW], { beat: 'pl-3b2cc69c', spot: null });
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`a pick goes when its PC moves by another route (${width})`, async () => {
      const run = await startRec();
      const PELL = 'Characters/PCs/Pell Rowan.md';
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await page.click(`#where [data-wpick="${PELL}"]`);
        await page.waitFor(`document.querySelector('#where [data-wpick="${PELL}"]').getAttribute('aria-pressed') === 'true'`);
        // Fight here moves the crew, Pell with them, to where the record has them; then the fight ends
        await page.click(`#where .wrow [data-fplace="${SALT}"]`);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.saved === 'Saved' && p.pending === 0 && p; })()`);
        await page.click('#fEnd');
        await page.click('#fEnd');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && !p.fight && p; })()`);
        await settled(page);
        assert.strictEqual(await page.evaluate('document.querySelectorAll("#where [data-wpick][aria-pressed=true]").length'), 0, 'no stale pick');
        // so Move them moves the whole row, not Pell alone
        await page.click('#where .wrow input[data-movebox]');
        await page.type('Marrow');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        const s = await stateOf(run);
        assert.ok(Object.values(s.positions).length === 4 && Object.values(s.positions).every((p) => p.beat === 'pl-3b2cc69c'), JSON.stringify(s.positions));
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`a Session 15 that session-prep filed is named, read-only (${width})`, async () => {
      const run = await startRec({ prepped: 'Session 15 - The Lamp Fair' });
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.strictEqual(await page.evaluate('document.getElementById("rtitle")'), null, 'no title box');
        assert.strictEqual(await page.evaluate('document.getElementById("rindex").textContent.replace(/\\s+/g, " ").trim()'), 'Named by session-prep: Session 15 - The Lamp Fair');
        assert.doesNotMatch(await page.evaluate('document.querySelector(".rtop").textContent'), /Filed as/);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`a redraw from another window mid-title commits nothing; Enter does (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await page.click('#rtitle');
        await page.type('The Lamp');
        // another window writes the state: the page redraws while the box has focus
        const got = await api(run, '/api/state');
        await page.evaluate('window.__mark = document.getElementById("rtitle")');
        const put = await fetch(`${run.base}api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stateId: got.stateId, base: got.rev, state: got.state, clientId: 'another-window' }) });
        assert.strictEqual(put.status, 200);
        await page.waitFor('document.getElementById("rtitle") !== window.__mark', 5000);
        await page.sleep(300);
        assert.strictEqual((await stateOf(run)).title, '', 'nothing committed by the redraw');
        assert.strictEqual(await page.evaluate('document.getElementById("rtitle").value'), 'The Lamp');
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'rtitle', 'the box keeps focus');
        await page.type(' Fair');
        await page.key('Enter');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.saved === 'Saved' && p.pending === 0 && p; })()`);
        assert.strictEqual((await stateOf(run)).title, 'The Lamp Fair');
        assert.deepStrictEqual(run.filer.calls, [], 'a title files nothing');
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    it(`the players' screen shows no card text (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        const views = [];
        const look = async () => views.push(JSON.stringify(await api(run, '/api/players/view')));
        // the players' own event stream, read the whole time
        let streamed = '';
        const stream = http.get(`${run.base}api/players/events`, (res) => { res.setEncoding('utf8'); res.on('data', (c) => { streamed += c; }); });
        stream.on('error', () => {});
        await look();
        // open Background, a card's people in the drawer, a fight at the lead's place and back, Move them
        await page.click('#background summary');
        await page.click('#scenes .card a.lk');
        await page.waitFor('document.querySelector("#drawer.open")');
        await page.key('Escape');
        await look();
        await page.click(`#coming .lead [data-fplace="${FESTIVAL}"]`);
        await page.waitFor(`(() => { const p = ${PROBE}; return p && p.fight && p.saved === 'Saved' && p.pending === 0 && p; })()`);
        await look();
        await page.click('#fEnd');
        await page.click('#fEnd');
        await page.waitFor(`(() => { const p = ${PROBE}; return p && !p.fight && p; })()`);
        await settled(page);
        await page.click('#where .wrow input[data-movebox]');
        await page.type('Marrow');
        await page.waitFor('document.querySelector("#where [data-movepick]")');
        await page.key('Enter');
        await settled(page);
        await look();
        await page.sleep(300);
        stream.destroy();
        assert.match(streamed, /event: (hello|view)/, `the stream was read: ${streamed.slice(0, 200)}`);
        views.push(streamed);
        for (const v of views) for (const w of SECRET_WORDS) assert.ok(!v.toLowerCase().includes(w.toLowerCase()), `the players' screen holds "${w}": ${v.slice(0, 400)}`);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });
  }
});

// Task 9: the frustration audit's items on the no-Plan page (docs/superpowers/plans/2026-11-22-run-sheet-no-plan-ux-audit.md),
// each named by its number, by real input only, at 1449, 1280 and 1100 wide, 762 high.
describe('the audit\'s frustrations on the no-Plan page (Task 9)', { skip: browserSkip() }, () => {
  const tap = async (page, sel, opts) => {
    const r = await page.click(sel, opts);
    assert.ok(r.inView && r.hit, `click ${sel}: ${JSON.stringify(r)}`);
    return r;
  };
  for (const width of WIDTHS) {
    // S8: the drawer stayed open until Esc or Close
    it(`S8: a click on the sheet outside the drawer closes it (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, `#where a.lk[data-note="${SALT}"]`);
        await page.waitFor('document.querySelector("#drawer.open h2")');
        // the drawer slides in (0.18 s): a hand waits for it to stop
        await page.waitFor('Math.round(document.getElementById("drawer").getBoundingClientRect().right) === innerWidth');
        await page.sleep(250);
        await tap(page, '#drawer h2');
        assert.strictEqual(await page.evaluate('document.getElementById("drawer").classList.contains("open")'), true, 'a click inside keeps it open');
        await tap(page, '#where h2', { offsetX: 6 });
        await page.waitFor('!document.getElementById("drawer").classList.contains("open")', 2000);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S6: Enter on a typed new place did nothing, and an empty box said nothing
    it(`S6: Enter in Move them makes a typed new place; with nothing typed it says why beside the box (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        await tap(page, '#where input[data-moveg]');
        await page.key('Enter');
        await page.waitFor('(document.querySelector("#where [data-movesay]") || {}).textContent === "Type a place, or pick one from the list"', 2000);
        const v = await inView(page, '#where [data-movesay]');
        assert.ok(v.whole, `beside the box, in view: ${JSON.stringify(v)}`);
        assert.deepStrictEqual((await stateOf(run)).positions, {}, 'nobody moved');
        // fix round 1: "The Old Inn" shares only its last word with The Salt Inn, which the list offers for a click; Enter
        // makes the typed place
        await page.type('The Old Inn');
        await page.waitFor('Array.from(document.querySelectorAll("#where [data-movepick]"), (b) => b.textContent).includes("The Salt Inn")');
        await page.key('Enter');
        await settled(page);
        const s = await stateOf(run);
        const typed = s.improvised.find((i) => i.newPlace);
        assert.strictEqual(typed && typed.title, 'The Old Inn');
        assert.ok(Object.values(s.positions).length === 4 && Object.values(s.positions).every((x) => x.beat === typed.key), 'the crew went there');
        assert.match(await page.evaluate('document.querySelector("#where .wrow").textContent'), /The Old Inn/);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S4: a no-Plan night has no beats, so a jot had nowhere to land on the page: "Tonight so far" tops Coming up
    it(`S4: tonight's jots top Coming up, newest first, and each says "Noted under" for 3 s (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.strictEqual(await page.evaluate('document.getElementById("tonight")'), null, 'no list before the first jot');
        // the page opens with focus in the header's Jot box: the GM just types
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'hjot');
        await page.type('Venn arrives soaked');
        await page.key('Enter');
        await settled(page);
        // nobody placed: the jot is the night's, and Noted says so (fix round 1)
        await page.waitFor('(document.getElementById("hnoted") || {}).textContent === "Noted under the night"', 1000);
        const v = await inView(page, '#hnoted');
        assert.ok(v.whole, `Noted in view: ${JSON.stringify(v)}`);
        await page.type('Brannock pays in lamp oil');
        await page.key('Enter');
        await settled(page);
        await page.waitFor('document.querySelectorAll("#tonight li").length === 2');
        const list = await page.evaluate('Array.from(document.querySelectorAll("#tonight li > span:not(.tm)"), (e) => e.textContent)');
        assert.deepStrictEqual(list, ['Brannock pays in lamp oil', 'Venn arrives soaked'], 'newest first');
        // fix round 1: the probe's jots are the beats' alone; tonight's list has its own field
        const pr = await probe(page);
        assert.deepStrictEqual([pr.jots, pr.tonight], [[], ['Brannock pays in lamp oil', 'Venn arrives soaked']]);
        assert.match(await page.evaluate('document.querySelector("#coming h4.lab").textContent'), /^Tonight so far$/, 'at the top of Coming up');
        assert.ok(await page.evaluate('document.getElementById("tonight").compareDocumentPosition(document.querySelector("#coming .lead")) & Node.DOCUMENT_POSITION_FOLLOWING'), 'above the lead card');
        await page.waitFor('(document.getElementById("hnoted") || {}).textContent === ""', 4000);
        assert.strictEqual(await noSideways(page), true);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S3, P3, P4: no find box; People in card order; a place only by its exact name
    it(`S3, P3, P4: the find box finds "salt" and "harb", Enter opens the first hit; People A to Z; no datalist (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        assert.strictEqual(await page.evaluate('document.querySelectorAll("datalist, input[list]").length'), 0, 'no datalist in the page');
        const names = await page.evaluate('Array.from(document.querySelectorAll("#people tbody tr td:first-child a[data-note]"), (a) => a.textContent.trim())');
        assert.deepStrictEqual(names, ['Corvin Tash', 'Harl Brannock', 'Odalys Venn'], 'People A to Z');
        const v = await inView(page, '#find');
        assert.ok(v.whole && v.hit, `the find box is on the first screen: ${JSON.stringify(v)}`);
        const hits = () => page.evaluate('Array.from(document.querySelectorAll("#findHits [data-findhit]"), (b) => [b.querySelector(".n").textContent, b.querySelector(".k").textContent])');
        await tap(page, '#find');
        await page.type('salt');
        await page.waitFor('document.querySelector("#findHits [data-findhit]")');
        assert.deepStrictEqual((await hits())[0], ['The Salt Inn', 'place']);
        // a hit is a real button: a held click opens it
        await tap(page, '#findHits [data-findhit]');
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "The Salt Inn"');
        await page.key('Escape');
        await tap(page, '#find');
        await page.type('harb');
        await page.waitFor('document.querySelectorAll("#findHits [data-findhit]").length >= 2');
        assert.deepStrictEqual((await hits()).slice(0, 2), [['Harbour District', 'place'], ['Harbour Festival Grounds', 'place']]);
        await page.key('Enter');
        await page.waitFor('document.querySelector("#drawer.open h2") && document.querySelector("#drawer h2").textContent === "Harbour District"');
        await page.key('Escape');
        await tap(page, '#find');
        await page.type('venn');
        await page.waitFor('document.querySelector("#findHits [data-findhit]")');
        assert.deepStrictEqual(await hits(), [['Odalys Venn', 'person']]);
        // Esc in the box closes the list and leaves the words
        await page.key('Escape');
        assert.strictEqual(await page.evaluate('document.querySelectorAll("#findHits [data-findhit]").length'), 0);
        assert.strictEqual(await page.evaluate('document.getElementById("find").value'), 'venn');
        // fix round 1: Enter with no hits says so beside the box, as Move them does; typing takes it away
        await page.type('zzq');
        await page.key('Enter');
        await page.waitFor('(document.getElementById("findSay") || {}).textContent === "Nothing matches"', 2000);
        const say = await inView(page, '#findSay');
        assert.ok(say.whole, `beside the box, in view: ${JSON.stringify(say)}`);
        assert.strictEqual(await page.evaluate('document.getElementById("drawer").classList.contains("open")'), false);
        await page.key('Backspace');
        assert.strictEqual(await page.evaluate('document.getElementById("findSay").textContent'), '');
        assert.strictEqual(await noSideways(page), true);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // S2: the players' column was a fixed 400 px with no fold or grip; the sheet 480 at 1100
    it(`S2: the players' column folds and drags on the no-Plan page as on the Plan sheet (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        const col = () => page.evaluate(`({ side: Math.round(document.getElementById('side').getBoundingClientRect().width), sheet: Math.round(document.getElementById('sheet').getBoundingClientRect().width), folded: document.getElementById('app').classList.contains('sidef') })`);
        let c = await col();
        if (width === 1100) {
          assert.deepStrictEqual([c.folded, c.side, c.sheet], [true, 40, 1100 - 220 - 40], 'folded by itself at 1100');
          await tap(page, '#sideOpen');
          c = await col();
          assert.strictEqual(c.folded, false);
        } else {
          assert.deepStrictEqual([c.folded, c.side], [false, 400]);
          const g = await page.box('#grip');
          await page.drag(g.left + g.width / 2, 400, g.left + g.width / 2 - 60, 400);
          assert.strictEqual((await col()).side, 460, 'the grip drags');
          await tap(page, '#sideFold');
          c = await col();
          assert.deepStrictEqual([c.folded, c.side, c.sheet], [true, 40, width - 220 - 40]);
        }
        assert.strictEqual(await noSideways(page), true);
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });

    // P9 (pinned, never seen on this page): the prototype put a 20 x 17 px Show beside nearly every link, so a near miss on
    // a link could put something on the players' screen. The cards carry no Show at all, and a press just beside a link
    // opens nothing and shows nothing.
    it(`P9: no Show beside the cards' links; a near miss shows the players nothing (${width})`, async () => {
      const run = await startRec();
      await withPage({ width, height: HEIGHT }, async (page) => {
        await page.goto(`${run.base}?probe=1`);
        await settled(page);
        const cards = await page.evaluate(`(() => { const cs = Array.from(document.querySelectorAll('#scenes .card, #coming .card'));
          return { cards: cs.length, links: cs.reduce((n, c) => n + c.querySelectorAll('a[data-note]').length, 0),
            shows: cs.reduce((n, c) => n + Array.from(c.querySelectorAll('button')).filter((b) => /show/i.test(b.textContent + ' ' + b.title)).length, 0) }; })()`);
        assert.ok(cards.cards >= 3 && cards.links >= 3, JSON.stringify(cards));
        assert.strictEqual(cards.shows, 0, 'no Show on a card');
        const a = await page.box('#scenes .card a[data-note]');
        await page.clickAt(a.right + 3, a.top + a.height / 2);
        await page.sleep(300);
        assert.strictEqual(await page.evaluate('document.getElementById("drawer").classList.contains("open")'), false);
        const s = await stateOf(run);
        assert.deepStrictEqual(s.panels || {}, {}, 'nothing on any panel');
        assert.deepStrictEqual((await probe(page)).errors, []);
      });
    });
  }
});
