'use strict';
// The no-Plan record reader: Last time, World, Coming up, the lead card and where the crew is, from the last Wrap-Up.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readRecord } = require('../lib/run-sheet/read-record');
const { areaOf } = require('../lib/run-sheet/web/record-rank');
const { copyRecordFixture } = require('./helpers/record-fixture');
const { present } = require('../lib/run-sheet/present');
const { buildIndex } = require('../lib/run-sheet/notes');
const { removeFixture } = require('./helpers/systems-fixture');

const made = [];
after(() => { for (const d of made) removeFixture(d); });

const S13 = 'Chapters/Chapter 3/Sessions/Session 13/Session 13 - Unlit.md';
const S14 = 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger.md';
const W14 = 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Wrap-Up.md';
const W13 = 'Chapters/Chapter 3/Sessions/Session 13/Session 13 - Unlit - Wrap-Up.md';
const S15 = 'Chapters/Chapter 3/Sessions/Session 15/Session 15 - Next.md';
const CH3 = 'Chapters/Chapter 3/Chapter 3.md';
const loc = (n) => `Locations/${n}.md`;
const npc = (n) => `Characters/NPCs/${n}.md`;

const session = (over = {}) => ({
  index: null, title: 'Session 15', number: 15, chapter: CH3, after: S14, played: false, playDate: null, planVault: false, fromRecord: true, ...over,
});

let crlfMode = false; // the vault last opened is CRLF, so the files a test adds are too
function open({ crlf = false, drop = [] } = {}) {
  crlfMode = crlf;
  const dir = copyRecordFixture({ crlf, drop });
  made.push(dir);
  return dir;
}
// Rewrite a vault file's text (LF in, the file's own line ends out).
function edit(dir, rel, fn) {
  const f = path.join(dir, rel);
  const raw = fs.readFileSync(f, 'utf8');
  const crlf = raw.includes('\r\n');
  const out = fn(raw.replace(/\r\n/g, '\n'));
  fs.writeFileSync(f, crlf ? out.replace(/\n/g, '\r\n') : out);
}
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), crlfMode ? text.replace(/\r?\n/g, '\r\n') : text);
};
// The real Wrap-Up template, filed as Session 14's Wrap-Up (its session link pointed at Session 14).
const TEMPLATE_WRAP = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'skills', 'shared', 'templates', 'session-wrap.md'), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^session:.*$/m, 'session: "[[Session 14 - Ledger]]"');

describe('readRecord', () => {
  // Task 8: the sheet re-reads the model once the session is filed. The new index names no party of its own, so the
  // party stays the one the record gave (the latest Wrap-Up's), not an empty list: the PCs the GM placed stay on the page.
  for (const crlf of [false, true]) {
    it(`a session filed tonight keeps the record's party${crlf ? ' (CRLF)' : ''}`, () => {
      const dir = open({ crlf });
      const before = readRecord(dir, session());
      put(dir, S15, '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nstatus: planned\n---\n\n# Session 15 - Next\n');
      const m = readRecord(dir, session({ index: S15, title: 'Session 15 - Next' }));
      assert.ok(before.pcs.length > 0);
      assert.deepStrictEqual(m.pcs.map((p) => p.note), before.pcs.map((p) => p.note));
      assert.strictEqual(m.partyFrom, before.partyFrom);
    });
  }
  // Someone named in the last played session's Play Notes is seen on the players' screen before tonight is filed, as after.
  for (const crlf of [false, true]) {
    it(`a person named in after's Play Notes is seen before the filing and after it${crlf ? ' (CRLF)' : ''}`, () => {
      const dir = open({ crlf });
      const P14 = 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Play Notes.md';
      put(dir, P14, '---\ntype: session-play-notes\nsession: "[[Session 14 - Ledger]]"\n---\n\n# Play Notes\n\nThe crew met Odalys Venn at the shop door.\n');
      const want = { [npc('Odalys Venn')]: 'named in Session 14' };
      assert.deepStrictEqual(readRecord(dir, session()).seenFrom, want);
      put(dir, S15, '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\nstatus: planned\n---\n\n# Session 15 - Next\n');
      assert.deepStrictEqual(readRecord(dir, session({ index: S15, title: 'Session 15 - Next' })).seenFrom, want);
    });
  }
  it('the header and the no-Plan line', () => {
    const dir = open();
    const m = readRecord(dir, session({ planVault: true }));
    assert.strictEqual(m.record.header, "Session 15, no Plan: built from Session 14's Wrap-Up");
    assert.strictEqual(m.record.noPlanLine, 'No Plan for Session 15: this is built from the record. session-prep makes one.');
    assert.strictEqual(m.record.from, W14);
    assert.strictEqual(m.record.fromSession, S14);
    assert.strictEqual(m.record.leftOut, 'Points to land and If-they need a Plan.');
    // Task 5 fills the cards and Background (the fixture's own are pinned in 'the possible scenes' below)
    assert.ok(Array.isArray(m.record.cards) && Array.isArray(m.record.background));
    // a vault with no Plan anywhere has no such line
    assert.strictEqual(readRecord(dir, session({ planVault: false })).record.noPlanLine, null);
    // the shared core still gives the party and the cast
    assert.strictEqual(m.pcs.length, 4);
  });

  it('a played, unwrapped session says so in its header', () => {
    const dir = open();
    const m = readRecord(dir, session({ played: true, playDate: '2026-11-29' }));
    assert.strictEqual(m.record.header, 'Session 15: played 29 Nov, not wrapped up yet');
    // the same record below it
    assert.strictEqual(m.record.from, W14);
    assert.ok(m.record.lastTime.recap);
    assert.strictEqual(readRecord(dir, session({ played: true, playDate: null })).record.header, 'Session 15: played, not wrapped up yet');
  });

  it('no Wrap-Up at all: no record yet', () => {
    const dir = open({ drop: [W13, W14] });
    const m = readRecord(dir, session({ number: 1, after: null, title: 'Session 1' }));
    assert.strictEqual(m.record.header, 'Session 1, no Plan: there is no record yet');
    assert.strictEqual(m.record.from, null);
    assert.strictEqual(m.record.fromSession, null);
    assert.strictEqual(m.record.comingUp.empty, 'No record yet: nothing is coming up.');
    assert.strictEqual(m.record.comingUp.lead, null);
    assert.strictEqual(m.record.lastTime.recap, '');
    assert.strictEqual(m.record.lastTime.playDate, null);
    assert.strictEqual(m.record.world.location, null);
  });

  for (const crlf of [false, true]) {
    const tag = crlf ? ' (CRLF)' : '';

    it(`last time is the recap's first two paragraphs and the play date${tag}`, () => {
      const m = readRecord(open({ crlf }), session());
      const { recap, playDate } = m.record.lastTime;
      assert.strictEqual(playDate, '6 Nov');
      assert.match(recap, /^The crew spent the morning at the \[\[Harbour Festival Grounds\]\]/);
      assert.match(recap, /Harl Brannock\]\] arrived before they could read it twice\.$/);
      assert.doesNotMatch(recap, /Harl took the page/);
      assert.strictEqual(recap.split(/\n\s*\n/).length, 2);
      assert.doesNotMatch(recap, /\r/);
    });

    it(`the world reads from the World State's labels${tag}`, () => {
      const w = readRecord(open({ crlf }), session()).record.world;
      assert.strictEqual(w.date, 'Day 11');
      assert.strictEqual(w.location, loc('The Salt Inn'));
      // Changed on purpose (Task 11b, F5 and F9): each World State value is shown word for word; the split into
      // sentences is the lead card's search alone
      assert.deepStrictEqual(w.threats, ["Corvin's guild wants payback. Harl is closing in on the crew."]);
      assert.deepStrictEqual(w.clocks, ['The Harbour Festival opens at dusk on Day 14. The next shift of lamplighters starts at midnight.']);
      assert.match(w.md, /Day 11/);
    });

    it(`coming up: the handoff, the intentions, and the lead card at the Harbour Festival Grounds${tag}`, () => {
      const c = readRecord(open({ crlf }), session()).record.comingUp;
      assert.strictEqual(c.empty, null);
      assert.match(c.handoff, /^The crew sits in \[\[The Salt Inn\]\] after dark/);
      assert.doesNotMatch(c.handoff, /gm-only/);
      assert.strictEqual(c.intentions.length, 2);
      assert.match(c.intentions[0], /^\*\*Festival schedule:\*\*/);
      const lead = c.lead;
      assert.strictEqual(lead.title, 'The Harbour Festival opens at dusk on Day 14.');
      assert.strictEqual(lead.clock, 'The Harbour Festival opens at dusk on Day 14.');
      assert.strictEqual(lead.place, loc('Harbour Festival Grounds'));
      assert.deepStrictEqual(lead.people, [npc('Harl Brannock'), npc('Odalys Venn')]);
      // no threat links a note or names one in full, so none is tied to the clock
      assert.deepStrictEqual(lead.hits, []);
      assert.strictEqual(lead.md, c.handoff);
    });
  }

  for (const crlf of [false, true]) {
    const tag = crlf ? ' (CRLF)' : '';
    it(`a clock naming no place gives a placeless lead and no guess${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('The Harbour Festival opens at dusk on Day 14. ', ''));
      const lead = readRecord(dir, session()).record.comingUp.lead;
      assert.strictEqual(lead.title, 'The next shift of lamplighters starts at midnight.');
      assert.strictEqual(lead.place, null);
      assert.deepStrictEqual(lead.hits, []);
      assert.match(lead.md, /^The crew sits in/);
      assert.deepStrictEqual(lead.people, [npc('Harl Brannock'), npc('Odalys Venn')]);
    });

    // Changed on purpose (Task 11b, F5 and F9): the items the page shows are the label's line and its nested bullets,
    // word for word; sentences and semicolons split for the lead card's search only (the lead's title below)
    it(`World State labels may hold several items: nested bullets, each word for word${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t
        .replace(/- \*\*Active threats:\*\*.*\n/, '- **Active threats:**\n  - The guild wants payback.\n  - Harl closes in; the harbourmaster waits.\n')
        .replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The Harbour Festival opens at dusk; the lamps go out at noon.\n'));
      const w = readRecord(dir, session()).record.world;
      assert.deepStrictEqual(w.threats, ['The guild wants payback.', 'Harl closes in; the harbourmaster waits.']);
      assert.deepStrictEqual(w.clocks, ['The Harbour Festival opens at dusk; the lamps go out at noon.']);
      assert.strictEqual(readRecord(dir, session()).record.comingUp.lead.title, 'The Harbour Festival opens at dusk');
    });

    it(`where they are comes from the World State\'s Location, and each PC note gives its own${tag}`, () => {
      const w = readRecord(open({ crlf }), session()).record.whereNow;
      assert.strictEqual(w.place, loc('The Salt Inn'));
      assert.strictEqual(w.from, 'world-state');
      assert.strictEqual(w.text, 'The Salt Inn');
      assert.strictEqual(w.byPc['Characters/PCs/Pell Rowan.md'], loc('The Salt Inn'));
      assert.strictEqual(w.byPc['Characters/PCs/Joss Harker.md'], null);
      assert.deepStrictEqual(Object.keys(w.byPc).sort(), ['Joss Harker', 'Mirren Fell', 'Pell Rowan', 'Yarrow Tide'].map((n) => `Characters/PCs/${n}.md`));
    });

    // Changed on purpose (Task 8 fix round 2, the coordinator's ruling): tonight's own positions live in the state (the
    // same state file survives a restart and a played-not-wrapped reopen), so whereNow never reads tonight's Table Log.
    // It reads the latest wrapped-up session's (`after`'s) Where everyone ended first: where the crew starts tonight.
    const L14 = 'Chapters/Chapter 3/Sessions/Session 14/Session 14 - Ledger - Table Log.md';
    const whereEnded = (lines) => (t) => t.replace('## Log\n', `## Where everyone ended\n\n${lines}\n\n## Log\n`);
    it(`the last session's Table Log's Where everyone ended wins${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, L14, whereEnded('- [[Mirren Fell]]: [[Marrow Market]]\n- [[Joss Harker]]: not placed'));
      const w = readRecord(dir, session()).record.whereNow;
      assert.strictEqual(w.place, loc('Marrow Market'));
      assert.strictEqual(w.from, 'table-log');
      assert.strictEqual(w.text, 'Marrow Market');
    });

    it(`tonight's own Table Log is never read for where the crew is${tag}`, () => {
      const dir = open({ crlf });
      put(dir, S15, '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\ndocuments:\n  table_log: "[[Session 15 - Next - Table Log]]"\n---\n\n# Session 15 - Next\n');
      put(dir, 'Chapters/Chapter 3/Sessions/Session 15/Session 15 - Next - Table Log.md',
        '---\ntype: session-table-log\nsession: "[[Session 15 - Next]]"\n---\n\n## Where everyone ended\n\n- [[Pell Rowan]]: [[Marrow Market]]\n- [[Joss Harker]]: not placed\n\n## Log\n\n- Pell went inland.\n');
      for (const played of [false, true]) {
        const w = readRecord(dir, session({ index: S15, played })).record.whereNow;
        assert.strictEqual(w.place, loc('The Salt Inn'), `played: ${played}`);
        assert.strictEqual(w.from, 'world-state');
      }
    });

    it(`the most specific place wins, by the parent chain${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, L14, whereEnded('- [[Mirren Fell]]: [[Harbour District]]\n- [[Joss Harker]]: [[Dock Row]]'));
      assert.strictEqual(readRecord(dir, session()).record.whereNow.place, loc('Dock Row'));
    });

    // Changed on purpose (Task 11b, F8): the Handoff's first place now comes before the PC notes, so this test takes the
    // fixture Handoff's link out too, to leave the PC notes as the only place
    it(`with no Location anywhere but the PC notes, the PC notes give the place${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Location:** [[The Salt Inn]]\n', '- **Location:**\n')
        .replace('The crew sits in [[The Salt Inn]] after dark', 'The crew sits in the inn after dark'));
      const w = readRecord(dir, session()).record.whereNow;
      assert.strictEqual(w.place, loc('The Salt Inn'));
      assert.strictEqual(w.from, 'pc-notes');
    });

    it(`a template-fresh Wrap-Up gives no Coming up line and says it has no Handoff${tag}`, () => {
      const dir = open({ crlf, drop: [W13] });
      put(dir, W14, TEMPLATE_WRAP);
      edit(dir, 'Characters/PCs/Pell Rowan.md', (t) => t.replace('**Location:** [[The Salt Inn]]', '**Location:**'));
      const r = readRecord(dir, session()).record;
      assert.strictEqual(r.comingUp.empty, 'The last Wrap-Up has no Handoff yet.');
      assert.strictEqual(r.comingUp.handoff, '');
      assert.deepStrictEqual(r.comingUp.intentions, []);
      assert.strictEqual(r.comingUp.lead, null);
      assert.strictEqual(r.lastTime.recap, '');
      assert.deepStrictEqual([r.world.date, r.world.location, r.world.threats, r.world.clocks], ['', null, [], []]);
      assert.deepStrictEqual([r.whereNow.place, r.whereNow.from, r.whereNow.text], [null, null, '']);
      assert.ok(Object.values(r.whereNow.byPc).every((v) => v === null));
    });

  }

  it('two places sharing the clock word give no place, and a stop word never names one', () => {
    const dir = open();
    // Harbour District and Harbour Festival Grounds both hold "harbour"
    edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The harbour bells ring at dusk.\n'));
    const lead = readRecord(dir, session()).record.comingUp.lead;
    assert.strictEqual(lead.place, null);
    assert.deepStrictEqual(lead.hits, []);
    // "market" is a kind of place, not Marrow Market
    edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The market closes at night.\n'));
    assert.strictEqual(readRecord(dir, session()).record.comingUp.lead.place, null);
  });

  // Carried over from Task 6: a map's GM half (a `location` with `doc_type: map`, paired with the players' half) is never
  // the lead card's place and never counts in a card's places, even when a clock word names it uniquely.
  for (const crlf of [false, true]) {
    it(`a map's GM half is never the lead's place nor a card's place, even when a clock word names it${crlf ? ' (CRLF)' : ''}`, () => {
      const dir = open({ crlf });
      put(dir, loc('Lanternhall Map (GM)'), '---\ntype: location\nname: Lanternhall Map (GM)\ndoc_type: map\nplayer_version: "[[Lanternhall Map]]"\nlocation_type: building\nparent_location: "[[Harbour District]]"\n---\n\nThe GM map.\n');
      put(dir, loc('Lanternhall Map'), '---\ntype: location\nname: Lanternhall Map\ndoc_type: map\nlocation_type: building\nparent_location: "[[Harbour District]]"\n---\n\nThe players\' map.\n');
      // "lanternhall" is unique to the map pair; the clock names it, and a threat links the GM half
      edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The Lanternhall bell tolls at dusk.\n')
        .replace(/- \*\*Active threats:\*\*.*\n/, "- **Active threats:** [[Corvin Tash]] waits near [[Lanternhall Map (GM)]].\n"));
      const m = readRecord(dir, session());
      const lead = m.record.comingUp.lead;
      const gm = loc('Lanternhall Map (GM)');
      const players = loc('Lanternhall Map');
      assert.ok(lead, 'there is a lead card');
      assert.ok(lead.place !== gm && lead.place !== players, `the lead's place is ${lead.place}`);
      for (const c of [lead, ...m.record.cards]) {
        assert.ok(!(c.places || []).includes(gm) && !(c.places || []).includes(players), `a card's places hold the map: ${JSON.stringify(c.places)}`);
        assert.ok(c.place !== gm && c.place !== players, `a card's place is the map: ${c.place}`);
      }
      assert.ok(!(m.placeKeys || {})[gm], 'the GM half has no place key');
      assert.ok(!JSON.stringify(m.record.whereNow).includes('Lanternhall'));
    });
  }

  it('a word three places share gives no place, a stop word beside it changes nothing', () => {
    const dir = open();
    put(dir, loc('Harbour Gate'), '---\ntype: location\nname: Harbour Gate\nlocation_type: district\nparent_location: "[[Veyland]]"\n---\n');
    edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The bell at Harbour Gate rings.\n'));
    // "harbour" matches three places; "gate" is a stop word; none is unique, so there is none
    assert.strictEqual(readRecord(dir, session()).record.comingUp.lead.place, null);
  });

  it('a threat that names a note in full or by link ties it to the clock; a decoy sharing a common word does not', () => {
    const dir = open();
    put(dir, 'Factions/Harbour Guard.md', '---\ntype: faction\nname: Harbour Guard\n---\n\nThe festival watch.\n');
    put(dir, 'Characters/NPCs/Master Hale.md', '---\ntype: npc\nname: Master Hale\naliases:\n  - Old Hale\n---\n\nStands at the Harbour Festival Grounds.\n');
    edit(dir, W14, (t) => t.replace(/- \*\*Active threats:\*\*.*\n/, "- **Active threats:** [[Corvin Tash]]'s guild wants payback. Old Hale watches the crew. The harbour is tense.\n"));
    const lead = readRecord(dir, session()).record.comingUp.lead;
    assert.strictEqual(lead.place, loc('Harbour Festival Grounds'));
    // Corvin by link, Master Hale by alias; Harbour Guard shares only "harbour" with the threats, so it is no hit
    assert.deepStrictEqual(lead.hits, [npc('Corvin Tash'), npc('Master Hale')]);
  });

  it('areaOf walks to the settlement the place is in', () => {
    // areaOf now lives in web/record-rank.js and takes the record's loc map (test changed on purpose)
    const L = readRecord(open(), session()).record.loc;
    assert.strictEqual(areaOf(loc('The Salt Inn'), L), loc('Harbour District'));
    assert.strictEqual(areaOf(loc('Veyland'), L), loc('Veyland'));
    assert.strictEqual(areaOf(null, L), null);
  });
});

// ---- Possible scenes (Task 5). Expected titles and counts are written from the rules (rounds 8 and 9), not from the code:
// Threads/NPC follow-ups/Intentions only; a ticked or struck item is gone; one card per person (first NPC named);
// cards sharing a subject note join, one hop; an item with no person and no link keeps a card titled by its first
// five words.
const ODALYS = npc('Odalys Venn');
const CORVIN = npc('Corvin Tash');
const HARL = npc('Harl Brannock');
const GUILD = 'Factions/Lamplighters Guild.md';
const titles = (m) => m.record.cards.map((c) => c.title);
const itemsOf = (card) => card.items.map((i) => i.md.replace(/\*\*/g, '').split(':')[0]);

describe('the possible scenes', () => {
  for (const crlf of [false, true]) {
    const tag = crlf ? ' (CRLF)' : '';

    it(`cards come only from the three sources, one per person${tag}`, () => {
      const m = readRecord(open({ crlf }), session());
      // The ledger-page thread alone shares three words with the ticked checklist line (ledger, page, safe), and the ferry
      // toll is struck, so what is left: Who paid (Odalys), Unsigned notes, and the follow-ups for
      // Odalys, Harl and Corvin, and the Guildhall visit. The Festival schedule is the lead's, not a card.
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Harl Brannock', 'Corvin Tash']);
      assert.deepStrictEqual(m.record.cards.map((c) => c.items.length), [2, 1, 1, 2]);
      assert.deepStrictEqual(m.record.cards[0].items.map((i) => i.source), ['Unresolved Threads', 'NPCs Needing Follow-Up']);
      assert.deepStrictEqual(m.record.cards[1].items.map((i) => i.source), ['Unresolved Threads']);
      assert.deepStrictEqual(m.record.cards[2].items.map((i) => i.source), ['NPCs Needing Follow-Up']);
      assert.deepStrictEqual(m.record.cards[3].items.map((i) => i.source), ['NPCs Needing Follow-Up', 'Player-Stated Intentions']);
      const all = m.record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n');
      // PC Carry-Forward never makes a card
      assert.doesNotMatch(all, /guild's mark|Faced down|Talked Corvin|upside down|Keep watch on the Salt Inn/);
      assert.doesNotMatch(all, /\r/);
      for (const c of m.record.cards) for (const i of c.items) assert.ok(['Unresolved Threads', 'NPCs Needing Follow-Up', 'Player-Stated Intentions'].includes(i.source));
    });

    it(`a ticked or struck item makes no card${tag}`, () => {
      const dir = open({ crlf });
      const all = readRecord(dir, session()).record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n');
      assert.doesNotMatch(all, /ferry toll/i); // struck through
      assert.doesNotMatch(all, /Ledger page:/); // ticked: ledger, page, safe shared with the [x] line, and no other item shares as many
      // un-tick the checklist line and both come back. Ledger page links Odalys first, so it is hers; Harl's follow-up is a
      // card that shares the Harl Brannock note with it, so the two join, titled by the note linked most (Odalys).
      edit(dir, W14, (t) => t.replace('- [x] ~~Decide', '- [ ] ~~Decide'));
      const m = readRecord(dir, session());
      assert.deepStrictEqual(titles(m), ['Unsigned notes: someone keeps slipping', 'Corvin Tash', 'Odalys Venn']);
      assert.deepStrictEqual(m.record.cards[2].items.map((i) => i.md.replace(/\*\*/g, '').split(':')[0]), ['Ledger page', 'Who paid the guild', '[[Odalys Venn]]', '[[Harl Brannock]]']);
      assert.doesNotMatch(m.record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n'), /ferry toll/i);
    });

    it(`a ticked line drops one item, the closer one, and on a tie drops neither${tag}`, () => {
      const dir = open({ crlf });
      const textOf = (m) => m.record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n');
      // Tie: Harl's follow-up also shares three words with the ticked line (decide, ledger, page), as the Ledger page
      // thread does (ledger, page, safe). Neither goes.
      edit(dir, W14, (t) => t.replace('decide what he does with the page tonight.', 'decide what he does with the ledger page tonight.'));
      let m = readRecord(dir, session());
      assert.match(textOf(m), /\*\*Ledger page:\*\*/);
      assert.match(textOf(m), /what he does with the ledger page/);
      // the two share Harl's note, so they join on it
      assert.deepStrictEqual(titles(m), ['Unsigned notes: someone keeps slipping', 'Corvin Tash', 'Odalys Venn']);
      // Harl's line now shares four (decide, ledger, page, safe): the closer one goes, the Ledger page thread stays
      edit(dir, W14, (t) => t.replace('with the ledger page tonight.', 'with the ledger page and the safe tonight.'));
      m = readRecord(dir, session());
      assert.match(textOf(m), /\*\*Ledger page:\*\*/);
      assert.doesNotMatch(textOf(m), /what he does with/);
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Corvin Tash']);
      assert.strictEqual(m.record.cards[0].items.length, 3);
    });

    it(`two items about one NPC make one card with two bullets${tag}`, () => {
      const odalys = readRecord(open({ crlf }), session()).record.cards[0];
      assert.strictEqual(odalys.title, 'Odalys Venn');
      assert.strictEqual(odalys.items.length, 2);
      assert.match(odalys.items[0].md, /^\*\*Who paid the guild:\*\*/);
      assert.match(odalys.items[1].md, /^\*\*\[\[Odalys Venn\]\]:\*\*/);
      assert.deepStrictEqual(odalys.people, [ODALYS]);
      assert.deepStrictEqual(odalys.notes, [ODALYS]);
      assert.deepStrictEqual(odalys.places, []);
    });

    it(`a plain-words thread keeps its own card, titled by its first five words${tag}`, () => {
      const c = readRecord(open({ crlf }), session()).record.cards[1];
      assert.strictEqual(c.title, 'Unsigned notes: someone keeps slipping');
      assert.deepStrictEqual([c.people, c.places, c.notes], [[], [], []]);
      assert.strictEqual(c.items.length, 1);
    });

    it(`the festival intention is the lead card's schedule, and Guildhall visit stays a card${tag}`, () => {
      const m = readRecord(open({ crlf }), session());
      const lead = m.record.comingUp.lead;
      assert.strictEqual(lead.word, 'festival');
      assert.strictEqual(lead.schedule.length, 1);
      assert.match(lead.schedule[0], /^\*\*Festival schedule:\*\*/);
      assert.ok(m.record.cards.every((c) => c.items.every((i) => !/Festival schedule/.test(i.md))));
      assert.ok(m.record.cards[3].items.some((i) => /^\*\*Guildhall visit:\*\*/.test(i.md)));
    });

    it(`Background holds the consequences and the carried item${tag}`, () => {
      const bg = readRecord(open({ crlf }), session()).record.background;
      assert.deepStrictEqual(bg.map((b) => b.from), ['Pending Consequences', 'Pending Consequences', 'Resolved Threads']);
      assert.match(bg[0].md, /^\*\*The page is gone:\*\* \[\[Harl Brannock\]\] will log the ledger page as port evidence/);
      assert.match(bg[1].md, /^\*\*Corvin's wound:\*\*/);
      // Changed on purpose (Task 11b, F1: one bullet is one line, word for word): the bullet's own full stop stays.
      assert.strictEqual(bg[2].md, "The question of who opened the chandler's safe: carried on a live list.");
      for (const b of bg) assert.doesNotMatch(b.md, /[\r\n]/);
    });

    it(`card ids are stable across two reads, and across line ends${tag}`, () => {
      const dir = open({ crlf });
      const a = readRecord(dir, session()).record.cards.map((c) => c.id);
      const b = readRecord(dir, session()).record.cards.map((c) => c.id);
      assert.deepStrictEqual(a, b);
      assert.ok(a.every((id) => /^[0-9a-f]{12}$/.test(id)));
      assert.strictEqual(new Set(a).size, a.length);
      const other = readRecord(open({ crlf: !crlf }), session()).record.cards.map((c) => c.id);
      assert.deepStrictEqual(a, other);
    });

    it(`a one-hop join through member_of${tag}`, () => {
      const dir = open({ crlf });
      // Unsigned notes links the Guild; Corvin's note is member_of it, so his card reaches it by one hop
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps', '- **Unsigned notes:** someone from the [[Lamplighters Guild]] keeps'));
      const m = readRecord(dir, session());
      // Changed on purpose (Task 11b, F11: a title comes only from notes the items link or name, never one hop away):
      // Corvin's two items link him; the Guild is linked by one item, so the card is Corvin's
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Harl Brannock', 'Corvin Tash']);
      const j = m.record.cards[2];
      assert.deepStrictEqual(j.items.map((i) => i.source), ['Unresolved Threads', 'NPCs Needing Follow-Up', 'Player-Stated Intentions']);
      assert.deepStrictEqual(j.notes.slice().sort(), [CORVIN, GUILD]);
      assert.deepStrictEqual(j.people, [CORVIN]);
      // the lead card's place is left out: Corvin is also located_at Harbour Festival Grounds, which never joins or lists
      assert.ok(!j.notes.includes(loc('Harbour Festival Grounds')));
    });

    it(`no chain through a second hop${tag}`, () => {
      const dir = open({ crlf });
      put(dir, 'Items/Ferry Charter.md', '---\ntype: item\nname: Ferry Charter\n---\n');
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.',
        '- **Unsigned notes:** someone from the [[Lamplighters Guild]] keeps slipping the crew notes, stamped [[Ferry Charter]].\n- **Lamp oil:** the [[Lamplighters Guild]] is buying every cask on the quay.\n- **Dock levy:** the harbourmaster\'s clerk wants a levy under the [[Ferry Charter]].'));
      const m = readRecord(dir, session());
      // Guild: Unsigned notes, Lamp oil and Corvin's card (3 cards) joins first. Dock levy shares the Charter only with a
      // card that has already joined, so it stays alone.
      assert.deepStrictEqual(titles(m), ['Odalys Venn', "Dock levy: the harbourmaster's clerk", 'Harl Brannock', 'Lamplighters Guild']);
      assert.deepStrictEqual(m.record.cards.map((c) => c.items.length), [2, 1, 1, 4]);
      assert.deepStrictEqual(m.record.cards[1].notes, ['Items/Ferry Charter.md']);
    });

    it(`the shared common word of a name never joins: a surname counts only when no other NPC shares it${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps', '- **Unsigned notes:** Venn keeps'));
      // Venn is only Odalys's: the item is hers
      assert.deepStrictEqual(titles(readRecord(dir, session())), ['Odalys Venn', 'Harl Brannock', 'Corvin Tash']);
      assert.strictEqual(readRecord(dir, session()).record.cards[0].items.length, 3);
      // Mara Venn shares the word, so "Venn" alone names neither
      put(dir, npc('Mara Venn'), '---\ntype: npc\nname: Mara Venn\n---\n');
      const m = readRecord(dir, session());
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: Venn keeps slipping', 'Harl Brannock', 'Corvin Tash']);
      // a full name, an alias and a link always count
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** Venn keeps', '- **Unsigned notes:** Odalys Venn keeps'));
      assert.strictEqual(readRecord(dir, session()).record.cards[0].items.length, 3);
      put(dir, ODALYS, '---\nname: Odalys Venn\ntype: npc\naliases:\n  - The Widow\nlocation: "[[The Salt Inn]]"\n---\n');
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** Odalys Venn keeps', '- **Unsigned notes:** The Widow keeps'));
      assert.strictEqual(readRecord(dir, session()).record.cards[0].items.length, 3);
    });

    it(`the lead's place, the PCs and the party's area never join, but a place below the area does${tag}`, () => {
      const link = (l) => (t) => t
        .replace('so someone else did.', `so someone else did. ${l}`)
        .replace('with no name on them.', `with no name on them. ${l}`);
      for (const l of ['[[Harbour Festival Grounds]]', '[[Harbour District]]', '[[Mirren Fell]]']) {
        const dir = open({ crlf });
        edit(dir, W14, link(l));
        assert.deepStrictEqual(titles(readRecord(dir, session())), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Harl Brannock', 'Corvin Tash'], l);
      }
      // control: Dock Row sits below the party's area (Harbour District), so it joins
      const dir = open({ crlf });
      edit(dir, W14, link('[[Dock Row]]'));
      const m = readRecord(dir, session());
      // Dock Row and Odalys are each reached by two items; the tie goes to the note first seen in the record (Odalys)
      assert.deepStrictEqual(titles(m), ['Harl Brannock', 'Corvin Tash', 'Odalys Venn']);
      assert.deepStrictEqual(m.record.cards[2].places, [loc('Dock Row')]);
    });
  }

  it('a session note two items link is no subject: they do not join', () => {
    const dir = open();
    edit(dir, W14, (t) => t
      .replace('so someone else did.', 'so someone else did. See [[Session 14 - Ledger]].')
      .replace('with no name on them.', 'with no name on them. See [[Session 14 - Ledger]].'));
    const m = readRecord(dir, session());
    assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Harl Brannock', 'Corvin Tash']);
    assert.deepStrictEqual(m.record.cards[0].notes, [ODALYS]);
    // a chapter note neither
    edit(dir, W14, (t) => t.split('[[Session 14 - Ledger]]').join('[[Chapter 3]]'));
    assert.deepStrictEqual(titles(readRecord(dir, session())), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Harl Brannock', 'Corvin Tash']);
  });

  it('only an item that is one struck span drops; a partly struck item is live', () => {
    const dir = open();
    edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.',
      '- ~~Old rumour~~ the crew still hear of a masked buyer ~~maybe~~\n- ~~**Dead lead:** nothing came of it.~~'));
    const all = readRecord(dir, session()).record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n');
    assert.match(all, /masked buyer/);
    assert.doesNotMatch(all, /Dead lead/);
  });

  // Changed on purpose (Task 11b, F11, the controller's ruling): a card's title comes only from notes its items link or
  // name directly; one-hop notes count for joins, never for the title. This test pinned the opposite ("the Guild, linked
  // by one item, beats Corvin, linked by two", counting the hop); it now pins the ruling.
  it('a title never counts one-hop notes: Corvin, linked by two items, beats the Guild, linked by one', () => {
    const dir = open();
    edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps', '- **Unsigned notes:** someone from the [[Lamplighters Guild]] keeps'));
    const m = readRecord(dir, session());
    // Corvin's two items link Corvin; the Guild is linked by one item (and reached by Corvin's two only by a hop)
    assert.strictEqual(m.record.cards.find((c) => c.items.length === 3).title, 'Corvin Tash');
  });

  it('an intention naming no lead word is a card of its own, and a placeless lead has no schedule', () => {
    const dir = open();
    edit(dir, W14, (t) => t.replace('The Harbour Festival opens at dusk on Day 14. ', ''));
    const m = readRecord(dir, session());
    assert.deepStrictEqual(m.record.comingUp.lead.schedule, []);
    assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Harl Brannock', 'Corvin Tash', 'Festival schedule: the crew will']);
  });

  it('a template-fresh Wrap-Up and a missing one make no cards and no Background', () => {
    const dir = open({ drop: [W13] });
    put(dir, W14, TEMPLATE_WRAP);
    const r = readRecord(dir, session()).record;
    assert.deepStrictEqual([r.cards, r.background], [[], []]);
    const none = readRecord(open({ drop: [W13, W14] }), session({ number: 1, after: null, title: 'Session 1' })).record;
    assert.deepStrictEqual([none.cards, none.background], [[], []]);
  });
});

// ---- Task 11b: shapes the proof found on copies of real vaults (the shapes only; every word here is the fixture's own).
describe('real-vault shapes (Task 11b)', () => {
  for (const crlf of [false, true]) {
    const tag = crlf ? ' (CRLF)' : '';

    // F1: a Background line is one whole bullet, never cut into sentences; an initialism's dots are not sentence ends.
    it(`F1: a Background line is the whole bullet, initialisms and bold kept${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t
        .replace("- **Corvin's wound:**", '- **The Q.R.L. charter** is lodged with the port. **Harl** has read it twice.\n- **Corvin\'s wound:**')
        .replace("- The question of who opened the chandler's safe: carried on a live list.",
          "- **The chandler's safe** was opened by a hand the crew never saw. The Q.R.L. agent was in town that week. — closed: carried on the shared list (Session 14)"));
      const bg = readRecord(dir, session()).record.background;
      assert.deepStrictEqual(bg.map((b) => b.md), [
        '**The page is gone:** [[Harl Brannock]] will log the ledger page as port evidence, so the crew cannot use it openly.',
        '**The Q.R.L. charter** is lodged with the port. **Harl** has read it twice.',
        "**Corvin's wound:** [[Corvin Tash]] was cut in the scuffle and will blame the crew to his guild.",
        "**The chandler's safe** was opened by a hand the crew never saw. The Q.R.L. agent was in town that week. — closed: carried on the shared list (Session 14)",
      ]);
    });

    // F7: a Resolved Threads entry is Background only when it says it is carried on, carried forward or still live.
    it(`F7: a closed entry holding the word "carried" is not Background${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace("- The question of who opened the chandler's safe: carried on a live list.\n",
        "- The question of who opened the chandler's safe: carried on a live list.\n"
        + '- Means to haul the lamp oil up from the cellar herself. — closed: Mirren carried the casks up the stair; Pell held the door. (Mirren Fell)\n'
        + '- Whether the deputy keeps his word. — closed: carried forward to the next session (Session 14)\n'
        + '- The bell-ringer\'s debt. — closed: still live on the shared list\n'
        // the open wording before "closed:" says nothing: the closure decides (Canticle's shape, found on the re-run)
        + '- The deputy\'s offer is still live at the inn. — closed: retired by the keeper: he withdrew it (Joss Harker)\n'
        // fix round 1: a "closed:" mid-sentence is no closure, and "carried on his back" is the physical sense
        + '- Whether the quay bridge holds is still live — the road is closed: the crew must go round\n'
        + '- Joss means to bring the old lamp home. — closed: Joss carried on his back the old lamp to the inn (Joss Harker)\n'
        // fix round 2: "carried on to …" carries; "re-closed:" is no closure, so the whole entry is read
        + '- Who rang the bell at noon. — closed: carried on to the next session (Session 14)\n'
        + '- The lamp-man\'s debt is still live. — re-closed: the keeper looked again\n'));
      const bg = readRecord(dir, session()).record.background.filter((b) => b.from === 'Resolved Threads').map((b) => b.md);
      assert.deepStrictEqual(bg, [
        "The question of who opened the chandler's safe: carried on a live list.",
        'Whether the deputy keeps his word. — closed: carried forward to the next session (Session 14)',
        "The bell-ringer's debt. — closed: still live on the shared list",
        'Whether the quay bridge holds is still live — the road is closed: the crew must go round',
        'Who rang the bell at noon. — closed: carried on to the next session (Session 14)',
        "The lamp-man's debt is still live. — re-closed: the keeper looked again",
      ]);
    });

    // F4 / F6: an item that only says there is nothing reads as empty: no lead from "none.", no card from "None left open".
    it(`F4: a World State value of "none." is empty: no clock, no threat, no lead${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** none.\n')
        .replace(/- \*\*Active threats:\*\*.*\n/, '- **Active threats:** None.\n'));
      const r = readRecord(dir, session()).record;
      assert.deepStrictEqual([r.world.clocks, r.world.threats], [[], []]);
      assert.strictEqual(r.comingUp.lead, null);
      assert.doesNotMatch(r.world.md, /none/i);
      // the Festival schedule intention is no lead's schedule now: it is a card of its own
      assert.ok(r.cards.some((c) => c.items.some((i) => /Festival schedule/.test(i.md))));
    });

    it(`F6: an item that says nothing is open makes no card; one that only starts with a "no" word does${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n',
        '- **None left open by the quay.** The lamp is lit again and the guild has gone quiet. The ledger is the port\'s.\n'
        // changed on purpose (fix round 2: "No <kind>" takes at most one of yet, left, open, remain(s), pending, new,
        // known after it): "No open threads this session." would now stay
        + '- Nothing.\n- n/a\n- —\n- No open threads yet.\n'
        + '- Nothing stops the deputy from reading the page aloud.\n- No one knows who rang the bell.\n'));
      const all = readRecord(dir, session()).record.cards.flatMap((c) => c.items.map((i) => i.md));
      assert.ok(!all.some((m) => /None left open|^Nothing\.$|^n\/a$|^—$|No open threads/.test(m)), all.join('\n'));
      assert.ok(all.includes('Nothing stops the deputy from reading the page aloud.'));
      assert.ok(all.includes('No one knows who rang the bell.'));
    });

    // F5 / F9: the in-game date and every World State value are shown word for word, links as links; the split into
    // items is for the lead card's search only.
    it(`F5: the World lines are the record's words, links rendered, never re-joined${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t
        .replace('- **In-game date:** Day 11', '- **In-game date:** Day 11; three days to the [[Harbour Festival Grounds|fair]].')
        .replace(/- \*\*Active threats:\*\*.*\n/, '- **Active threats:** Corvin (the guild, the cut); Harl and the deputy; the bell-ringer.\n')
        .replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** Day 12 the market at dawn; Day 14 the Harbour Festival at dusk.\n'));
      const m = readRecord(dir, session());
      const w = m.record.world;
      assert.strictEqual(w.date, 'Day 11; three days to the [[Harbour Festival Grounds|fair]].');
      assert.deepStrictEqual(w.threats, ['Corvin (the guild, the cut); Harl and the deputy; the bell-ringer.']);
      assert.deepStrictEqual(w.clocks, ['Day 12 the market at dawn; Day 14 the Harbour Festival at dusk.']);
      assert.strictEqual(w.md, [
        '- **In-game date:** Day 11; three days to the [[Harbour Festival Grounds|fair]].',
        '- **Location:** [[The Salt Inn]]',
        '- **Active threats:** Corvin (the guild, the cut); Harl and the deputy; the bell-ringer.',
        '- **Ticking clocks:** Day 12 the market at dawn; Day 14 the Harbour Festival at dusk.',
      ].join('\n'));
      // the search still splits: the lead is the clause that names a place
      assert.strictEqual(m.record.comingUp.lead.title, 'Day 14 the Harbour Festival at dusk.');
      assert.strictEqual(m.record.comingUp.lead.place, loc('Harbour Festival Grounds'));
      // rendered: the alias shown, the link a link, no markup left
      const p = present(m, { index: buildIndex(dir) }).record.world;
      assert.match(p.dateHtml, /^Day 11; three days to the <a class="lk" data-note="Locations\/Harbour Festival Grounds\.md">fair<\/a>\.$/);
      assert.deepStrictEqual(p.clocksHtml, ['Day 12 the market at dawn; Day 14 the Harbour Festival at dusk.']);
      assert.doesNotMatch(p.mdHtml, /\[\[|\*\*/);
    });

    // Fix round 1: the In-game date is a World line like the others: nested items stay items, never joined.
    it(`F5: an In-game date of nested items keeps each as its own line${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **In-game date:** Day 11\n', '- **In-game date:**\n  - Day 11, at dusk.\n  - Three days to the [[Harbour Festival Grounds|fair]].\n'));
      const m = readRecord(dir, session());
      const w = m.record.world;
      assert.strictEqual(w.date, 'Day 11, at dusk.\nThree days to the [[Harbour Festival Grounds|fair]].');
      assert.match(w.md, /^- \*\*In-game date:\*\*\n {2}- Day 11, at dusk\.\n {2}- Three days to the \[\[Harbour Festival Grounds\|fair\]\]\.$/m);
      const p = present(m, { index: buildIndex(dir) }).record.world;
      assert.match(p.dateHtml, /^Day 11, at dusk\.<br>Three days to the <a class="lk" [^>]*>fair<\/a>\.$/);
    });

    it(`F5: the Location line is its own words, with nested bullets kept as items${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t
        .replace('- **Location:** [[The Salt Inn]]', '- **Location:** the crew at [[The Salt Inn]], with the deputy outside.')
        .replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:**\n  - The Harbour Festival opens at dusk; the lamps go out.\n  - The deputy reports at noon.\n'));
      const w = readRecord(dir, session()).record.world;
      assert.strictEqual(w.location, loc('The Salt Inn'));
      assert.deepStrictEqual(w.clocks, ['The Harbour Festival opens at dusk; the lamps go out.', 'The deputy reports at noon.']);
      assert.match(w.md, /^- \*\*Location:\*\* the crew at \[\[The Salt Inn\]\], with the deputy outside\.$/m);
      assert.match(w.md, /^- \*\*Ticking clocks:\*\*\n {2}- The Harbour Festival opens at dusk; the lamps go out\.\n {2}- The deputy reports at noon\.$/m);
    });

    // F2 / F10: a name inside a longer matched name is not that person: the longest match wins.
    it(`F2: a person whose whole name is another's first name is not named inside that full name${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Corvin'), '---\nname: Corvin\ntype: npc\n---\n\nAn old ferryman at the festival.\n');
      const m = readRecord(dir, session());
      const corvin = m.record.cards.find((c) => c.title === 'Corvin Tash');
      assert.deepStrictEqual(corvin.people, [CORVIN]);
      assert.ok(m.record.cards.every((c) => !c.people.includes(npc('Corvin'))), JSON.stringify(m.record.cards.map((c) => c.people)));
      // said on its own, the name is his
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps', '- **Unsigned notes:** Corvin keeps'));
      const solo = readRecord(dir, session()).record.cards.find((c) => /Unsigned notes/.test(c.items[0].md));
      assert.deepStrictEqual(solo.people, [npc('Corvin')]);
    });

    // Fix round 1: the same shape said in plain words, no link: the full name "Corvin Tash" holds "Corvin", and only
    // the longer name counts; a lone "Corvin" later in the line is the other man.
    it(`F2: a full name said without a link names only that person; the short name alone names the other${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Corvin'), '---\nname: Corvin\ntype: npc\n---\n\nAn old ferryman.\n');
      const LINE = '- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n';
      const peopleOn = (line, re) => {
        edit(dir, W14, (t) => t.replace(LINE, line));
        const card = readRecord(dir, session()).record.cards.find((c) => c.items.some((i) => re.test(i.md)));
        edit(dir, W14, (t) => t.replace(line, LINE));
        return card.people;
      };
      const one = peopleOn('- **Unsigned notes:** Corvin Tash says the notes come from the quay.\n', /come from the quay/);
      assert.ok(one.includes(CORVIN) && !one.includes(npc('Corvin')), JSON.stringify(one));
      const both = peopleOn('- **The ferry:** Corvin Tash and old Corvin both want the crossing.\n', /want the crossing/);
      assert.ok(both.includes(CORVIN) && both.includes(npc('Corvin')), JSON.stringify(both));
    });

    it(`F10: an alias is not named inside another person's full name${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Harl Dunmore'), '---\nname: Harl Dunmore\ntype: npc\naliases: [Harl, Harl the Ferryman]\n---\n\nThe ferryman.\n');
      const m = readRecord(dir, session());
      const harl = m.record.cards.find((c) => c.title === 'Harl Brannock');
      assert.deepStrictEqual(harl.people, [HARL]);
      assert.ok(m.record.cards.every((c) => !c.people.includes(npc('Harl Dunmore'))));
    });

    it(`F2: a threat naming a full name is no hit for the man whose name is its first word${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Corvin'), '---\nname: Corvin\ntype: npc\n---\n\nAn old ferryman at the festival.\n');
      edit(dir, W14, (t) => t.replace(/- \*\*Active threats:\*\*.*\n/, "- **Active threats:** Corvin Tash's guild wants payback.\n"));
      const lead = readRecord(dir, session()).record.comingUp.lead;
      assert.strictEqual(lead.place, loc('Harbour Festival Grounds'));
      assert.deepStrictEqual(lead.hits, [CORVIN]);
    });

    // F11: titles, chips and people show each note's display name (name, else title, else the stem with `_` as spaces),
    // and a card's title comes only from notes its items link or name, never from a note one hop away.
    it(`F11: a card and the names map show display names, never a raw stem${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Ottilie_Marsh'), '---\ntype: npc\n---\n\nA bell-ringer.\n');
      put(dir, 'Items/Ferry_Charter.md', '---\ntype: item\ntitle: The Ferry Charter\n---\n');
      edit(dir, 'Characters/PCs/Pell Rowan.md', (t) => t.replace('type: pc\n', 'type: pc\nname: Pell Rowan-Ashe\n'));
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n',
        '- **[[Ottilie_Marsh]]** rings the bell at odd hours.\n- [[Ferry_Charter]] terms are still unsigned.\n'));
      const r = readRecord(dir, session()).record;
      const ts = r.cards.map((c) => c.title);
      assert.ok(ts.includes('Ottilie Marsh'), ts.join(' | '));
      // the first five words, the link read as the note's title
      assert.ok(ts.includes('The Ferry Charter terms are'), ts.join(' | '));
      assert.ok(ts.every((x) => !x.includes('_')), ts.join(' | '));
      assert.strictEqual(r.names[npc('Ottilie_Marsh')], 'Ottilie Marsh');
      assert.strictEqual(r.names['Items/Ferry_Charter.md'], 'The Ferry Charter');
      assert.strictEqual(r.names['Characters/PCs/Pell Rowan.md'], 'Pell Rowan-Ashe');
      assert.strictEqual(r.names['Characters/PCs/Joss Harker.md'], 'Joss Harker');
      assert.strictEqual(r.names[CORVIN], 'Corvin Tash');
      assert.strictEqual(r.names[loc('The Salt Inn')], 'The Salt Inn');
    });

    it(`F11: two cards joined through a place one hop away are titled by a note they name, not the place${tag}`, () => {
      const dir = open({ crlf });
      put(dir, npc('Mags_Orrel'), '---\ntype: npc\nrelationships:\n  - target: "[[Dock Row]]"\n    type: based_at\n---\n');
      put(dir, npc('Tobin Reave'), '---\nname: Tobin Reave\ntype: npc\nrelationships:\n  - target: "[[Dock Row]]"\n    type: located_at\n---\n');
      edit(dir, W14, (t) => t.replace('- **[[Corvin Tash]]:** decide what the guild learns of the scuffle.\n',
        '- **[[Corvin Tash]]:** decide what the guild learns of the scuffle.\n- **[[Mags_Orrel]]:** decide whether she sells the oil.\n- **[[Tobin Reave]]:** decide where he sleeps tonight.\n'));
      const r = readRecord(dir, session()).record;
      const joined = r.cards.find((c) => c.items.some((i) => /Mags_Orrel/.test(i.md)));
      assert.ok(joined.items.some((i) => /Tobin Reave/.test(i.md)), 'the two join on Dock Row');
      assert.strictEqual(joined.title, 'Mags Orrel');
    });

    // F8: where they are: the last Table Log's Where everyone ended, the World State's Location, the first place the
    // Handoff links (never one it says they came "from"), and the PC notes only when the record says nothing of where.
    it(`F8: the Handoff's first place comes before the PC notes${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Location:** [[The Salt Inn]]\n', '- **Location:**\n')
        .replace('The crew sits in [[The Salt Inn]] after dark', 'The crew waits in [[Marrow Market]] after dark, a day from [[The Salt Inn]]'));
      const w = readRecord(dir, session()).record.whereNow;
      assert.deepStrictEqual([w.place, w.from, w.text], [loc('Marrow Market'), 'handoff', 'Marrow Market']);
    });

    it(`F8: a record that says the crew left a place, and names no other, puts them nowhere, whatever the PC notes say${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Location:** [[The Salt Inn]]', '- **Location:** the crew has walked down to the coast; [[Mirren Fell]] went ahead.')
        .replace('The crew sits in [[The Salt Inn]] after dark, arguing', 'Dawn; the crew has walked down from [[The Salt Inn]], arguing'));
      const w = readRecord(dir, session()).record.whereNow;
      // Pell's note still says The Salt Inn: that note is older than the record
      assert.strictEqual(w.byPc['Characters/PCs/Pell Rowan.md'], loc('The Salt Inn'));
      assert.deepStrictEqual([w.place, w.from, w.text], [null, null, '']);
    });

    // Fix round 1: an item is empty only when the nothing-phrase is the whole item (or the bold heading of one, as
    // "**None left open by the quay.**" heads its gloss); any further clause keeps it.
    it(`F6: a nothing-phrase with a further clause says something, and stays${tag}`, () => {
      const keep = ['None new; the old one still ticks: the deputy rides at dawn.', 'Nothing new, but the bell rings at dusk.',
        'None pending — except the toll, due Friday.', 'No threats remain but the Guild', 'No clocks tick except the tide',
        'None. The deputy rides at dawn.', 'No threats near the Guild'];
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n',
        `${keep.map((k) => `- ${k}`).join('\n')}\n`)
        .replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** Nothing new, but the bell rings at dusk.\n'));
      const r = readRecord(dir, session()).record;
      const all = r.cards.flatMap((c) => c.items.map((i) => i.md));
      for (const k of keep) assert.ok(all.includes(k), `${k} stays: ${all.join(' | ')}`);
      assert.deepStrictEqual(r.world.clocks, ['Nothing new, but the bell rings at dusk.']);
    });

    // Task 12, F2: a bold nothing-heading keeps its item when the rest turns against it (still, except, but…) about a note
    // it links or a person or place it names: that rest is a live fact, and the item stays, heading and all. A gloss of
    // why nothing is open drops, even one that names people (Snowbound's shape: "The dragon is dead, … [[Sister X]]").
    it(`F2: a bold nothing-heading over a live fact keeps the item; over a gloss it drops${tag}`, () => {
      const keep = ['**Nothing new.** Except Odalys still wants the ledger back.',
        '**No threats.** The guild still watches [[Dock Row]].',
        '**Nothing pending.** But the Marrow Market opens at dawn.'];
      const drop = ['**None left open by the quay.** The lamp is lit again and the guild has gone quiet.',
        '**None left open by the story.** The safe is shut, Corvin is mended and [[Harl Brannock]] has closed the case.',
        '**No threats.** But the bell still rings at dusk.'];
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps slipping the crew notes with no name on them.\n',
        `${[...keep, ...drop].map((k) => `- ${k}`).join('\n')}\n`)
        .replace(/- \*\*Active threats:\*\*.*\n/, '- **Active threats:** **No threats.** The guild still watches [[Dock Row]].\n'));
      const r = readRecord(dir, session()).record;
      const all = r.cards.flatMap((c) => c.items.map((i) => i.md));
      for (const k of keep) assert.ok(all.includes(k), `${k} stays: ${all.join(' | ')}`);
      for (const d of drop) assert.ok(!all.includes(d), `${d} drops: ${all.join(' | ')}`);
      assert.deepStrictEqual(r.world.threats, ['**No threats.** The guild still watches [[Dock Row]].']);
    });

    it(`F1: a clock is never split at an initialism's dots${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The Q.R.L. Council marches on the Harbour Festival Grounds at noon. The bell rings at dusk.\n'));
      const lead = readRecord(dir, session()).record.comingUp.lead;
      assert.strictEqual(lead.title, 'The Q.R.L. Council marches on the Harbour Festival Grounds at noon.');
      assert.strictEqual(lead.place, loc('Harbour Festival Grounds'));
    });
  }
});
