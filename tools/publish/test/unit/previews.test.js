const { describe, it } = require('node:test');
const assert = require('node:assert');
const { cardFor, buildPreviews } = require('../../lib/previews');
const { excerptFromMarkdown } = require('../../lib/excerpt');

const ctx = { imageMap: { 'hallam.webp': { relPath: 'characters/hallam.webp' } }, excludeSections: ['GM Notes'] };
function page(type, frontmatter, body, extra) {
  return { title: 'Hallam', displayTitle: 'Hallam', outputPath: `x/${type}.html`,
    frontmatter: { type, ...frontmatter }, publishedMarkdown: body, markdown: 'RAW-SECRET ' + body, ...extra };
}

describe('excerptFromMarkdown sentences', () => {
  it('returns one sentence by default and two when asked', () => {
    const src = 'First one. Second one. Third one.';
    assert.strictEqual(excerptFromMarkdown(src), 'First one.');
    assert.strictEqual(excerptFromMarkdown(src, { sentences: 2 }), 'First one. Second one.');
  });
  it('keeps both sentences when the second ends the text', () => {
    assert.strictEqual(excerptFromMarkdown('Keeper of the gate. He trusts nobody.', { sentences: 2 }), 'Keeper of the gate. He trusts nobody.');
    assert.strictEqual(excerptFromMarkdown('A. B.', { sentences: 2 }), 'A. B.');
    assert.strictEqual(excerptFromMarkdown('A. B.'), 'A.');
  });
  it('stops at the limit even inside the second sentence', () => {
    const long = 'Short. ' + 'word '.repeat(80) + 'end.';
    const got = excerptFromMarkdown(long, { sentences: 2, limit: 200 });
    assert.ok(got.length <= 201, String(got.length));
    assert.ok(got.startsWith('Short.'));
  });
});

describe('cardFor', () => {
  it('gives an NPC its name, kind, facts, opening lines and picture', () => {
    const card = cardFor(page('npc', { occupation: 'Warden of [[North_Gate|the north gate]]', status: 'alive',
      rank: 'Captain', portrait: '_attachments/characters/hallam.webp' }, '# Hallam\n\nKeeper of the gate. He trusts nobody. More.'), ctx);
    assert.deepStrictEqual(card, { t: 'Hallam', k: 'NPC',
      f: [['Role', 'Warden of the north gate'], ['Rank', 'Captain']],
      x: 'Keeper of the gate. He trusts nobody.', i: 'images/characters/hallam.webp' });
  });
  it('shows a status that is not the ordinary one', () => {
    assert.deepStrictEqual(cardFor(page('npc', { status: 'missing' }, ''), ctx).f, [['Status', 'missing']]);
  });
  it('shows at most three facts', () => {
    const card = cardFor(page('npc', { occupation: 'a', status: 'dead', rank: 'c', nationality: 'd' }, ''), ctx);
    assert.strictEqual(card.f.length, 3);
  });
  it('gives each kind its own facts', () => {
    assert.deepStrictEqual(cardFor(page('location', { location_type: 'Village', parent_location: '[[Wiltshire]]' }, ''), ctx).f,
      [['Sort of place', 'Village'], ['Part of', 'Wiltshire']]);
    assert.deepStrictEqual(cardFor(page('event', { in_game_date: new Date(Date.UTC(1814, 7, 10)), location: '[[Vienna]]', outcome: 'Won.' }, ''), ctx).f,
      [['Date', '1814-08-10'], ['Where', 'Vienna'], ['Outcome', 'Won.']]);
    assert.deepStrictEqual(cardFor(page('item', { item_type: 'Blade', current_holder: '[[Hallam]]' }, ''), ctx).f,
      [['Sort of thing', 'Blade'], ['Held by', 'Hallam']]);
    assert.deepStrictEqual(cardFor(page('faction', { faction_type: 'Guild' }, ''), ctx).f, [['Sort of group', 'Guild']]);
  });
  it('names a kind it has no table for by its type, with no facts', () => {
    const card = cardFor(page('world_domain', { occupation: 'x' }, 'Some prose here.'), ctx);
    assert.strictEqual(card.k, 'World domain');
    assert.strictEqual(card.f, undefined);
  });
  it('marks a draft', () => {
    assert.strictEqual(cardFor(page('npc', { canon_status: 'DRAFT' }, ''), ctx).d, 1);
    assert.strictEqual(cardFor(page('npc', {}, ''), ctx).d, undefined);
  });
  it('leaves out a picture the build did not find', () => {
    assert.strictEqual(cardFor(page('npc', { portrait: 'missing.png' }, ''), ctx).i, undefined);
  });
  it('gives a player character the player, then the header badges, three in all', () => {
    const card = cardFor(page('pc', { player_name: 'Sam', display_meta: ['occupation', 'home_town', 'age'],
      occupation: 'Smith', home_town: '[[Bath]]', age: 31 }, ''), ctx);
    assert.deepStrictEqual(card.f, [['Player', 'Sam'], ['Occupation', 'Smith'], ['Home Town', 'Bath']]);
  });
  it('falls back to the default badges for a player character with no display_meta', () => {
    const card = cardFor(page('pc', { player_name: 'Sam', age: 31, nationality: 'Welsh' }, ''), ctx);
    assert.deepStrictEqual(card.f, [['Player', 'Sam'], ['Age', '31'], ['Nationality', 'Welsh']]);
  });
  it('uses the fields the session and chapter pages show', () => {
    assert.deepStrictEqual(cardFor(page('session', { session_number: 3, play_date: '2026-01-02' }, ''), ctx).f,
      [['Session', '3'], ['Played', '2026-01-02']]);
    assert.deepStrictEqual(cardFor(page('chapter', { sort_order: 2, chapter_number: 9 }, ''), ctx).f, [['Chapter', '2']]);
  });

  // Review Focus 1 and 2, and the safety rule.
  it('never reads the raw note', () => {
    const card = cardFor(page('npc', {}, 'Seen by all.'), ctx);
    assert.ok(!JSON.stringify(card).includes('RAW-SECRET'));
  });
  it('has no opening lines when the only prose is under an excluded heading', () => {
    const card = cardFor(page('npc', {}, '# Hallam\n\n## GM Notes\n\nHe is the killer.\n'), ctx);
    assert.strictEqual(card.x, undefined);
    assert.ok(!JSON.stringify(card).includes('killer'));
  });
  it('shows a fact naming a note that is not on the site as its label, and nothing else', () => {
    const card = cardFor(page('npc', { occupation: 'Agent of [[Secret_Lair|the Compound]]' }, ''), ctx);
    assert.deepStrictEqual(card.f, [['Role', 'Agent of the Compound']]);
    assert.ok(!JSON.stringify(card).includes('Secret_Lair'));
  });
  it('caps a long value', () => {
    const card = cardFor(page('event', { outcome: 'x'.repeat(400) }, ''), ctx);
    assert.ok(card.f[0][1].length <= 121);
    assert.ok(card.f[0][1].endsWith('…'));
  });
});

describe('values as the page prints them', () => {
  it('joins a session in-game date range the way the session page does', () => {
    const hub = page('session', { in_game_date: ['1 May', '3 May'] }, '');
    const f = cardFor(hub, { ...ctx, hubWrapUps: new Map([[hub, {}]]) }).f;
    assert.deepStrictEqual(f, [['In-game date', '1 May – 3 May']]);
  });
  it('shows a session in-game date only where the session page prints it (a hub with a Wrap-Up)', () => {
    const fm = { session_number: 4, in_game_date: 'March 4th 1925', play_date: '2026-01-10' };
    const bare = page('session', fm, '');
    assert.deepStrictEqual(cardFor(bare, { ...ctx, hubWrapUps: new Map() }).f, [['Session', '4'], ['Played', '2026-01-10']]);
    assert.deepStrictEqual(cardFor(bare, ctx).f, [['Session', '4'], ['Played', '2026-01-10']]);
    const wrapped = page('session', fm, '');
    assert.deepStrictEqual(cardFor(wrapped, { ...ctx, hubWrapUps: new Map([[wrapped, {}]]) }).f,
      [['Session', '4'], ['In-game date', 'March 4th 1925'], ['Played', '2026-01-10']]);
  });
  it('uses the same function as the session page for that date', () => {
    const { shownInGameDate } = require('../../lib/templates/session');
    assert.strictEqual(shownInGameDate({ in_game_date: 'x' }, null), '');
    assert.strictEqual(shownInGameDate({}, {}), '');
    assert.strictEqual(shownInGameDate({ in_game_date: ['a', 'b'] }, {}), 'a – b');
  });
  it('prints an item holder through the page rule, in every real shape', () => {
    const holders = [['[[Name]]', 'Name'], ['[[Name|alias]]', 'alias'], ['Name (note)', 'Name (note)'], ['Name / Other', 'Name / Other'],
      ['[[A]] (held for [[B]])', 'A (held for B)'], ['[[Nathaniel]] (and / or [[Cleo]])', 'Nathaniel (and / or Cleo)']];
    for (const [raw, want] of holders) {
      assert.deepStrictEqual(cardFor(page('item', { current_holder: raw }, ''), ctx).f, [['Held by', want]], raw);
    }
  });
  it('prints a bare name with underscores the way the page does (as words, in a reference)', () => {
    assert.deepStrictEqual(cardFor(page('event', { location: 'Ex_under_score' }, ''), ctx).f, [['Where', 'Ex under score']]);
    assert.deepStrictEqual(cardFor(page('item', { current_holder: '[[Ex_under_score]]' }, ''), ctx).f, [['Held by', 'Ex under score']]);
  });
  it('prints a snake_case type value as words, as the page badge does', () => {
    assert.deepStrictEqual(cardFor(page('location', { location_type: 'government_quarter' }, ''), ctx).f, [['Sort of place', 'Government quarter']]);
  });
});

describe('a card holds only bounded, clean text', () => {
  it('caps a title at 120 characters and a PC epithet at 200, with an ellipsis', () => {
    const card = cardFor(page('wiki', {}, 'A.', { displayTitle: 'T'.repeat(10000) }), ctx);
    assert.strictEqual(card.t.length, 121);
    assert.ok(card.t.endsWith('…'));
    const pc = cardFor(page('pc', { key_traits: ['k'.repeat(10000), 'j'.repeat(10000)] }, ''), ctx);
    assert.strictEqual(pc.x.length, 201);
    assert.ok(pc.x.endsWith('…'));
    assert.strictEqual(cardFor(page('wiki', {}, 'A.', { displayTitle: 'Short' }), ctx).t, 'Short');
  });
  it('does not split a character at the cap', () => {
    const card = cardFor(page('wiki', {}, 'A.', { displayTitle: '😀'.repeat(200) }), ctx);
    assert.ok(!/[\uD800-\uDBFF]…$/.test(card.t));
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(card)));
  });
  it('looks a picture up as an own entry, never a name on Object.prototype', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.strictEqual(cardFor(page('npc', { portrait: name }, ''), ctx).i, undefined, name);
    }
  });
  it('treats a type named after an Object member as an unknown kind', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      const card = cardFor(page(name, { occupation: 'x' }, 'Some prose.'), ctx);
      assert.strictEqual(card.f, undefined, name);
      assert.strictEqual(typeof card.k, 'string', name);
    }
  });
});

describe('a card opens with clean prose', () => {
  const x = (body) => cardFor(page('wiki', {}, body), ctx).x;
  it('reads a markdown link as its text', () => {
    assert.strictEqual(x('[Open the Gazetteer — the handouts](/gazetteer/), set in 1890. Next.'), 'Open the Gazetteer — the handouts, set in 1890. Next.');
    assert.strictEqual(x('See [the map][m] and [^1] there.\n'), 'See the map and there.');
  });
  it('drops emphasis markers and list markers', () => {
    assert.strictEqual(x('**Warden** of the _north_ gate. ~~Gone~~ now.'), 'Warden of the north gate. Gone now.');
    assert.strictEqual(x('- In the dead of night. Then.\n- Second item.'), 'In the dead of night. Then.');
    assert.strictEqual(x('1. First thing here. Second.\n2. Other'), 'First thing here. Second.');
    assert.strictEqual(x('- [ ] A task. Done.'), 'A task. Done.');
  });
  it('never shows a table row, and never joins prose across a heading or a table', () => {
    assert.strictEqual(x('| a | b |\n|---|---|\n| c | d |\n\nAfter the table. More.'), 'After the table. More.');
    assert.strictEqual(x('Name | Value\n--- | ---\nx | y\n\nProse here.'), 'Prose here.');
    assert.strictEqual(x('Before the heading\n\n## Heading\n\nAfter the heading.'), 'Before the heading');
    assert.strictEqual(x('Intro text.\n\n| a | b |\n|---|---|\n\nLater text.'), 'Intro text.');
  });
  it('shows no raw html and decodes entities', () => {
    assert.strictEqual(x('<div class="x">Fish &amp; chips</div> <b>here</b> now. Next.'), 'Fish & chips here now. Next.');
  });
  it('prints three dots and double hyphens as the page typography does', () => {
    assert.strictEqual(x('Wait... then go -- now. Next.'), 'Wait… then go – now. Next.');
  });
  it('leaves the default excerpt alone', () => {
    assert.strictEqual(excerptFromMarkdown('- item [a](b) one.\n\n## H\n\nafter.'), '- item [a](b) one.');
  });
  it('prints a list in another header the way String() does', () => {
    assert.deepStrictEqual(cardFor(page('event', { in_game_date: ['1 May', '3 May'] }, ''), ctx).f, [['Date', '1 May,3 May']]);
  });
});

describe('a PC card and the page header share their badges', () => {
  const { headerMeta } = require('../../lib/pc-header-meta');
  it('shows the same labels and values, in order', () => {
    for (const fm of [{ player_name: 'Sam', occupation: 'Smith', age: 31, nationality: 'Welsh' },
      { player_name: 'Sam', display_meta: ['age', 'home_town', 'occupation'], age: 31, home_town: 'Bath', occupation: 'Smith' }]) {
      const expected = [['Player', 'Sam'], ...headerMeta(fm).map(([l, v]) => [l, String(v)])].slice(0, 3);
      assert.deepStrictEqual(cardFor(page('pc', fm, ''), ctx).f, expected);
    }
  });
});

describe('a card title is always a string', () => {
  it('writes a numeric or boolean title as text', () => {
    assert.strictEqual(cardFor(page('wiki', {}, 'A.', { displayTitle: 1984 }), ctx).t, '1984');
    assert.strictEqual(cardFor(page('wiki', {}, 'A.', { displayTitle: true }), ctx).t, 'true');
  });
});

describe('buildPreviews', () => {
  it('keys cards by output path and skips a page with no title', () => {
    const map = buildPreviews([page('npc', {}, 'A.'), { outputPath: 'y.html', frontmatter: {}, displayTitle: '' }], ctx);
    assert.deepStrictEqual(Object.keys(map), ['x/npc.html']);
  });
});

describe('a card keeps the underscores its page prints', () => {
  it('keeps an underscore inside a word and drops emphasis underscores', () => {
    const card = cardFor(page('wiki', {}, 'The code is MARKER_NINE_ok and _this_ is emphasised.'), ctx);
    assert.strictEqual(card.x, 'The code is MARKER_NINE_ok and this is emphasised.');
  });
  it('the default excerpt is unchanged', () => {
    assert.strictEqual(excerptFromMarkdown('MARKER_NINE_ok here.'), 'MARKERNINEok here.');
  });
});

describe('a PC card opens with what the PC page opens with', () => {
  it('has no opening lines when the page shows none (the CoC folio)', () => {
    const card = cardFor(page('pc', { key_traits: ['Curious'] }, 'Prose.'), { ...ctx, pcEpithet: false });
    assert.strictEqual(card.x, undefined);
  });
  it('uses key_traits when there are any', () => {
    const card = cardFor(page('pc', { key_traits: ['Curious', 'Stubborn'] }, 'Body prose. More prose.'), ctx);
    assert.strictEqual(card.x, 'Curious, Stubborn');
  });
  it('otherwise the first sentence of the body, as the page quotes it', () => {
    const card = cardFor(page('pc', {}, 'First prose. Second prose.'), ctx);
    assert.strictEqual(card.x, 'First prose.');
  });
});
