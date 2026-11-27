'use strict';
// The no-Plan record reader: Last time, World, Coming up, the lead card and where the crew is, from the last Wrap-Up.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readRecord, areaOf } = require('../lib/run-sheet/read-record');
const { buildIndex } = require('../lib/run-sheet/notes');
const { copyRecordFixture } = require('./helpers/record-fixture');
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
      assert.deepStrictEqual(w.threats, ["Corvin's guild wants payback.", 'Harl is closing in on the crew.']);
      assert.deepStrictEqual(w.clocks, ['The Harbour Festival opens at dusk on Day 14.', 'The next shift of lamplighters starts at midnight.']);
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

    it(`World State labels may hold several items: sentences, semicolons or nested bullets${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t
        .replace(/- \*\*Active threats:\*\*.*\n/, '- **Active threats:**\n  - The guild wants payback.\n  - Harl closes in; the harbourmaster waits.\n')
        .replace(/- \*\*Ticking clocks:\*\*.*\n/, '- **Ticking clocks:** The Harbour Festival opens at dusk; the lamps go out at noon.\n'));
      const w = readRecord(dir, session()).record.world;
      assert.deepStrictEqual(w.threats, ['The guild wants payback.', 'Harl closes in', 'the harbourmaster waits.']);
      assert.deepStrictEqual(w.clocks, ['The Harbour Festival opens at dusk', 'the lamps go out at noon.']);
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

    it(`a Table Log's Where everyone ended wins${tag}`, () => {
      const dir = open({ crlf });
      put(dir, S15, '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\ndocuments:\n  table_log: "[[Session 15 - Next - Table Log]]"\n---\n\n# Session 15 - Next\n');
      put(dir, 'Chapters/Chapter 3/Sessions/Session 15/Session 15 - Next - Table Log.md',
        '---\ntype: session-table-log\nsession: "[[Session 15 - Next]]"\n---\n\n## Where everyone ended\n\n- [[Mirren Fell]]: [[Marrow Market]]\n- [[Joss Harker]]: not placed\n\n## Log\n\n- Went inland.\n');
      const w = readRecord(dir, session({ index: S15 })).record.whereNow;
      assert.strictEqual(w.place, loc('Marrow Market'));
      assert.strictEqual(w.from, 'table-log');
      assert.strictEqual(w.text, 'Marrow Market');
    });

    it(`the most specific place wins, by the parent chain${tag}`, () => {
      const dir = open({ crlf });
      put(dir, S15, '---\ntype: session\nsession_number: 15\nchapter: "[[Chapter 3]]"\ndocuments:\n  table_log: "[[Session 15 - Next - Table Log]]"\n---\n\n# Session 15 - Next\n');
      put(dir, 'Chapters/Chapter 3/Sessions/Session 15/Session 15 - Next - Table Log.md',
        '---\ntype: session-table-log\nsession: "[[Session 15 - Next]]"\n---\n\n## Where everyone ended\n\n- [[Mirren Fell]]: [[Harbour District]]\n- [[Joss Harker]]: [[The Salt Inn]]\n');
      assert.strictEqual(readRecord(dir, session({ index: S15 })).record.whereNow.place, loc('The Salt Inn'));
    });

    it(`with no Location anywhere but the PC notes, the PC notes give the place${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Location:** [[The Salt Inn]]\n', '- **Location:**\n'));
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
    const idx = buildIndex(open());
    assert.strictEqual(areaOf(idx, loc('The Salt Inn')), loc('Harbour District'));
    assert.strictEqual(areaOf(idx, loc('Veyland')), loc('Veyland'));
    assert.strictEqual(areaOf(idx, null), null);
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
      // The ledger-page thread and Harl's follow-up share three words with the ticked checklist line (decide, ledger, page),
      // the ferry toll is struck, so what is left: Who paid (Odalys), Unsigned notes, the three follow-ups' Odalys and
      // Corvin, and the Guildhall visit. The Festival schedule is the lead's, not a card.
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Corvin Tash']);
      assert.deepStrictEqual(m.record.cards.map((c) => c.items.length), [2, 1, 2]);
      assert.deepStrictEqual(m.record.cards[0].items.map((i) => i.source), ['Unresolved Threads', 'NPCs Needing Follow-Up']);
      assert.deepStrictEqual(m.record.cards[1].items.map((i) => i.source), ['Unresolved Threads']);
      assert.deepStrictEqual(m.record.cards[2].items.map((i) => i.source), ['NPCs Needing Follow-Up', 'Player-Stated Intentions']);
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
      assert.doesNotMatch(all, /Ledger page:/); // ticked: ledger, page, safe shared with the [x] line
      assert.doesNotMatch(all, /what he does with the ledger page/);
      // un-tick the checklist line and both come back. Ledger page links Odalys first, so it is hers; Harl's follow-up is a
      // card that shares the Harl Brannock note with it, so the two join, titled by the note linked most (Odalys).
      edit(dir, W14, (t) => t.replace('- [x] ~~Decide', '- [ ] ~~Decide'));
      const m = readRecord(dir, session());
      assert.deepStrictEqual(titles(m), ['Unsigned notes: someone keeps slipping', 'Corvin Tash', 'Odalys Venn']);
      assert.deepStrictEqual(m.record.cards[2].items.map((i) => i.md.replace(/\*\*/g, '').split(':')[0]), ['Ledger page', 'Who paid the guild', '[[Odalys Venn]]', '[[Harl Brannock]]']);
      assert.doesNotMatch(m.record.cards.flatMap((c) => c.items.map((i) => i.md)).join('\n'), /ferry toll/i);
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
      assert.ok(m.record.cards[2].items.some((i) => /^\*\*Guildhall visit:\*\*/.test(i.md)));
    });

    it(`Background holds the consequences and the carried item${tag}`, () => {
      const bg = readRecord(open({ crlf }), session()).record.background;
      assert.deepStrictEqual(bg.map((b) => b.from), ['Pending Consequences', 'Pending Consequences', 'Resolved Threads']);
      assert.match(bg[0].md, /^\*\*The page is gone:\*\* \[\[Harl Brannock\]\] will log the ledger page as port evidence/);
      assert.match(bg[1].md, /^\*\*Corvin's wound:\*\*/);
      assert.strictEqual(bg[2].md, "The question of who opened the chandler's safe: carried on a live list");
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
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Lamplighters Guild']);
      const j = m.record.cards[1];
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
      assert.deepStrictEqual(titles(m), ['Odalys Venn', "Dock levy: the harbourmaster's clerk", 'Lamplighters Guild']);
      assert.deepStrictEqual(m.record.cards.map((c) => c.items.length), [2, 1, 4]);
      assert.deepStrictEqual(m.record.cards[1].notes, ['Items/Ferry Charter.md']);
    });

    it(`the shared common word of a name never joins: a surname counts only when no other NPC shares it${tag}`, () => {
      const dir = open({ crlf });
      edit(dir, W14, (t) => t.replace('- **Unsigned notes:** someone keeps', '- **Unsigned notes:** Venn keeps'));
      // Venn is only Odalys's: the item is hers
      assert.deepStrictEqual(titles(readRecord(dir, session())), ['Odalys Venn', 'Corvin Tash']);
      assert.strictEqual(readRecord(dir, session()).record.cards[0].items.length, 3);
      // Mara Venn shares the word, so "Venn" alone names neither
      put(dir, npc('Mara Venn'), '---\ntype: npc\nname: Mara Venn\n---\n');
      const m = readRecord(dir, session());
      assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: Venn keeps slipping', 'Corvin Tash']);
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
        assert.deepStrictEqual(titles(readRecord(dir, session())), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Corvin Tash'], l);
      }
      // control: Dock Row sits below the party's area (Harbour District), so it joins
      const dir = open({ crlf });
      edit(dir, W14, link('[[Dock Row]]'));
      const m = readRecord(dir, session());
      assert.deepStrictEqual(titles(m), ['Corvin Tash', 'Dock Row']);
      assert.deepStrictEqual(m.record.cards[1].places, [loc('Dock Row')]);
    });
  }

  it('an intention naming no lead word is a card of its own, and a placeless lead has no schedule', () => {
    const dir = open();
    edit(dir, W14, (t) => t.replace('The Harbour Festival opens at dusk on Day 14. ', ''));
    const m = readRecord(dir, session());
    assert.deepStrictEqual(m.record.comingUp.lead.schedule, []);
    assert.deepStrictEqual(titles(m), ['Odalys Venn', 'Unsigned notes: someone keeps slipping', 'Corvin Tash', 'Festival schedule: the crew will']);
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
