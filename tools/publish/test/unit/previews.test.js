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
    const f = cardFor(page('session', { in_game_date: ['1 May', '3 May'] }, ''), ctx).f;
    assert.deepStrictEqual(f, [['In-game date', '1 May – 3 May']]);
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

describe('buildPreviews', () => {
  it('keys cards by output path and skips a page with no title', () => {
    const map = buildPreviews([page('npc', {}, 'A.'), { outputPath: 'y.html', frontmatter: {}, displayTitle: '' }], ctx);
    assert.deepStrictEqual(Object.keys(map), ['x/npc.html']);
  });
});
