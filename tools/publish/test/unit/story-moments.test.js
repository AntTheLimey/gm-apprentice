'use strict';
// Memorable Moments cards (story-moments.js): the shapes a wrap-up writes (a bold beat and its italic context line, a
// block-quote with a `— Speaker` line), the `#moment/<kind>` tag read as structure, and the card markup. The build
// shows the note as written: no quote marks added or dropped, and the tag is the only text taken out.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { KINDS, parseMoments, momentsHtml } = require('../../lib/story-moments');

const html = (md, opts = {}) => momentsHtml(parseMoments(md), { title: 'Memorable Moments', unitKind: 'session', ...opts });

describe('parseMoments', () => {
  it('a bold beat and its italic context make one narration card, kind from the tag', () => {
    const { cards, unknownTags } = parseMoments('**Six crawled through the sewer.**\n\n*Unplanned.* #moment/funny');
    assert.deepEqual(cards, [{ shape: 'narration', main: '**Six crawled through the sewer.**', context: '*Unplanned.*', kind: 'funny', speaker: null }]);
    assert.deepEqual(unknownTags, []);
  });

  it('the shape the wrap-up template writes: the beat and its context on two lines of one paragraph', () => {
    const { cards } = parseMoments('**Mara walked off the pier.**\n*Nobody moved to help her. #moment/funny*');
    assert.deepEqual(cards, [{ shape: 'narration', main: '**Mara walked off the pier.**', context: '*Nobody moved to help her.*', kind: 'funny', speaker: null }]);
  });

  it('a quote keeps its marks exactly; the speaker comes from the dash line', () => {
    const { cards } = parseMoments('> "Nobody planned this."\n> — GM\n\n*Commentary.*');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].shape, 'speech');
    assert.equal(cards[0].main, '"Nobody planned this."');
    assert.equal(cards[0].speaker, 'GM');
    assert.equal(cards[0].context, '*Commentary.*');
  });

  it('narration in quote marks with a speaker stays a speech card as written', () => {
    const { cards } = parseMoments('> "Holger Graeme raised his glass and said nothing at all."\n> — [Holger Graeme](../npcs/holger-graeme.html)\n\n*The room went quiet. #moment/dramatic*');
    assert.equal(cards[0].shape, 'speech');
    assert.equal(cards[0].main, '"Holger Graeme raised his glass and said nothing at all."');
    assert.equal(cards[0].speaker, '[Holger Graeme](../npcs/holger-graeme.html)');
    assert.equal(cards[0].kind, 'dramatic');
  });

  it('no tag, no kind; an unknown tag gives no kind, is reported, and is not printed', () => {
    const none = parseMoments('**A beat.**\n\n*Context.*');
    assert.equal(none.cards[0].kind, null);
    assert.deepEqual(none.unknownTags, []);
    const bad = parseMoments('**A beat.**\n\n*Context.* #moment/sad');
    assert.equal(bad.cards[0].kind, null);
    assert.deepEqual(bad.unknownTags, ['sad']);
    assert.doesNotMatch(momentsHtml(bad, { title: 'Memorable Moments', unitKind: 'session' }), /#moment|sad/);
  });

  it('#moment/EPIC reads as epic', () => {
    assert.equal(parseMoments('**A beat.**\n\n*Context.* #moment/EPIC').cards[0].kind, 'epic');
  });

  it('every kind is one the tag can name', () => {
    for (const k of KINDS) assert.equal(parseMoments(`**B.**\n\n*C.* #moment/${k}`).cards[0].kind, k);
  });

  it('a tag on a bold line with no context', () => {
    const { cards } = parseMoments('**Six held the door. #moment/epic**');
    assert.deepEqual(cards, [{ shape: 'narration', main: '**Six held the door.**', context: null, kind: 'epic', speaker: null }]);
  });

  it('two italic lines in a row: the second is a card of its own', () => {
    const { cards } = parseMoments('**Beat.**\n\n*First.*\n\n*Second.*');
    assert.equal(cards.length, 2);
    assert.equal(cards[0].context, '*First.*');
    assert.equal(cards[1].shape, 'other');
    assert.equal(cards[1].main, '*Second.*');
  });

  it('a list is one card, as written', () => {
    const { cards } = parseMoments('- the first thing\n- the second thing');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].shape, 'other');
    assert.equal(cards[0].main, '- the first thing\n- the second thing');
  });

  it('a quote with no dash line has no speaker', () => {
    const { cards } = parseMoments('> "Just this."');
    assert.equal(cards[0].speaker, null);
    assert.equal(cards[0].main, '"Just this."');
  });

  it('the speaker line keeps its dash exactly as written; only the name is split off', () => {
    for (const dash of ['-- ', '– ', '— ', '—', '--']) {
      const card = parseMoments(`> "A."\n> ${dash}Tim`).cards[0];
      assert.equal(card.speaker, 'Tim', dash);
      assert.equal(card.speakerDash, dash, dash);
    }
  });

  it('CRLF input reads the same', () => {
    const { cards } = parseMoments('**Beat.**\r\n\r\n*Context.* #moment/tragic\r\n');
    assert.deepEqual(cards, [{ shape: 'narration', main: '**Beat.**', context: '*Context.*', kind: 'tragic', speaker: null }]);
  });

  it('a run of blocks inside one marked span is one card', () => {
    const open = 'a1';
    const { cards } = parseMoments(`${open}\n**Hidden beat.**\n\n*Hidden context.*\n\n\n**Shown beat.**`);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].shape, 'other');
    assert.match(cards[0].main, /Hidden beat[\s\S]*Hidden context/);
    assert.equal(cards[1].main, '**Shown beat.**');
  });

  it('a lone lowercase word on its own line is ordinary text, not a marked span', () => {
    const { cards } = parseMoments('**B.**\n\nyes\n\n*ctx.* #moment/funny');
    assert.deepEqual(cards.map((c) => [c.shape, c.main]), [['narration', '**B.**'], ['other', 'yes'], ['other', '*ctx.*']]);
  });

  it('a real marked span between a beat and its context is a card of its own; the context is not taken from beyond it', () => {
    const open = '\uE000a1\uE001';
    const { cards } = parseMoments(`**B.**\n\n${open}\nhidden\n\uE002\n\n*ctx.* #moment/funny`);
    assert.deepEqual(cards.map((c) => [c.shape, c.main, c.context]), [['narration', '**B.**', null], ['other', `${open}\nhidden\n\uE002`, null], ['other', '*ctx.*', null]]);
    assert.equal(cards[2].kind, 'funny');
  });

  it('a tag at the end of a marked span is structure there too: taken off, the kind set, an unknown word reported', () => {
    const open = '\uE000a1\uE001';
    for (const [md, main] of [
      [`${open}\n**Hidden beat.** #moment/funny\n\uE002`, `${open}\n**Hidden beat.**\n\uE002`],
      [`${open}\n**Hidden beat.**\n*Ctx.* #moment/funny\uE002`, `${open}\n**Hidden beat.**\n*Ctx.*\uE002`],
      [`${open}\n**Hidden beat.**\n\n#moment/funny\n\uE002`, `${open}\n**Hidden beat.**\n\uE002`],
    ]) {
      const { cards, unknownTags } = parseMoments(md);
      assert.deepEqual(cards.map((c) => [c.shape, c.main, c.kind]), [['other', main, 'funny']], md);
      assert.deepEqual(unknownTags, []);
    }
    const unknown = parseMoments(`${open}\n**Hidden beat.** #moment/sad\n\uE002`);
    assert.deepEqual(unknown.cards.map((c) => [c.main, c.kind]), [[`${open}\n**Hidden beat.**\n\uE002`, null]]);
    assert.deepEqual(unknown.unknownTags, ['sad']);
    // The card before the span keeps its own kind: the span's tag is the span's.
    assert.deepEqual(parseMoments(`**B.**\n\n${open}\nhidden #moment/epic\n\uE002`).cards.map((c) => c.kind), [null, 'epic']);
  });

  it('unknown tags are reported once however they are cased', () => {
    assert.deepEqual(parseMoments('**A.**\n\n*x* #moment/Sad\n\n**B.**\n\n*y* #moment/sad').unknownTags, ['Sad']);
  });

  it('a paragraph that is only a tag is structure: it sets the kind of the card before it, and prints nothing', () => {
    const { cards, unknownTags } = parseMoments('**Beat.**\n*Context.*\n\n#moment/funny');
    assert.deepEqual(cards, [{ shape: 'narration', main: '**Beat.**', context: '*Context.*', kind: 'funny', speaker: null }]);
    assert.deepEqual(unknownTags, []);
    assert.doesNotMatch(html('**Beat.**\n*Context.*\n\n#moment/funny'), /#moment/);
    const quote = parseMoments('> "Run."\n> — Mara\n\n#moment/epic').cards;
    assert.deepEqual(quote.map((c) => [c.shape, c.kind]), [['speech', 'epic']]);
  });

  it('a tag paragraph leaves a kind the card already has; an unknown word is reported and sets none', () => {
    assert.deepEqual(parseMoments('**Beat.** #moment/epic\n\n#moment/funny').cards.map((c) => c.kind), ['epic']);
    const unknown = parseMoments('**Beat.**\n\n#moment/sad');
    assert.deepEqual(unknown.cards.map((c) => [c.main, c.kind]), [['**Beat.**', null]]);
    assert.deepEqual(unknown.unknownTags, ['sad']);
    assert.deepEqual(parseMoments('**Beat.** #moment/epic\n\n#moment/sad').unknownTags, ['sad']);
  });

  it('a tag paragraph with no card before it is dropped, and reported when it names no kind', () => {
    for (const md of ['#moment/funny\n\n**Beat.**', '**B.**\n\n---\n\n#moment/funny\n\n**Beat.**']) {
      const { cards, unknownTags } = parseMoments(md);
      assert.ok(cards.every((c) => c.kind === null && !c.main.includes('#moment')), JSON.stringify(cards));
      assert.deepEqual(unknownTags, []);
    }
    assert.deepEqual(parseMoments('#moment/sad\n\n**Beat.**').unknownTags, ['sad']);
  });

  it('a tag paragraph after a marked span names the card before the span, as on the player site', () => {
    const open = '\uE000a1\uE001';
    const { cards } = parseMoments(`**B.**\n\n${open}\nhidden\n\uE002\n\n#moment/funny`);
    assert.deepEqual(cards.map((c) => [c.main, c.kind]), [['**B.**', 'funny'], [`${open}\nhidden\n\uE002`, null]]);
  });

  it('empty text has no cards', () => {
    assert.deepEqual(parseMoments('').cards, []);
    assert.equal(html(''), '');
  });

  it('a `---` rule divides the section and is no card (Canticle Ch3 S13 ends its moments with one)', () => {
    const { cards } = parseMoments('**Varrio grabbed her arm.**\n\n---\n\n*Not his context.*\n\n---\n');
    assert.deepEqual(cards.map((c) => [c.main, c.context]), [['**Varrio grabbed her arm.**', null], ['*Not his context.*', null]]);
    assert.match(html('**A.**\n\n---\n'), /<p>1 from this session<\/p>/);
  });
});

describe('parseMoments: where each card stands (`lines`, for the wrap-up tagger)', () => {
  const at = (md) => parseMoments(md).cards.map((c) => c.lines && [c.lines.first, c.lines.last]);

  it('a card spans its own lines; a context line after it extends it; the field is not enumerable', () => {
    const md = '**Beat one.**\n\n*Its context.*\n\n> "Said."\n> \u2014 Mara\n\n**Mara walked off.**\n*Nobody helped.*\n\n- a list\n';
    assert.deepEqual(at(md), [[0, 2], [4, 5], [7, 8], [10, 10]]);
    assert.deepEqual(Object.keys(parseMoments(md).cards[0]).includes('lines'), false);
  });

  it('a lone tag paragraph and a rule do not move a card; blank lines inside a quote are not its end', () => {
    assert.deepEqual(at('**A.**\n\n#moment/epic\n\n---\n\n*B.*\n'), [[0, 0], [6, 6]]);
    assert.deepEqual(at('> one\n>\n> two\n\n\n'), [[0, 2]]);
  });
});

describe('momentsHtml', () => {
  const words = (md, ...ws) => { const out = html(md); for (const w of ws) assert.ok(out.includes(w), `${w} in ${out}`); return out; };

  it('keeps every word of every shape', () => {
    words('**Tag on bold. #moment/epic**', 'Tag on bold.');
    words('**Beat.**\n\n*one*\n\n*two*', 'Beat.', 'one', 'two');
    words('- alpha\n- beta', 'alpha', 'beta');
    words('> "A quote."', 'A quote.');
    words('**Beat.**\r\n\r\n*Context.*\r\n', 'Beat.', 'Context.');
  });

  it('prints the heading as written and the count', () => {
    const md = Array.from({ length: 11 }, (_, i) => `**Beat ${i}.**`).join('\n\n');
    const out = html(md, { title: 'Memorable Moments' });
    assert.match(out, /<section class="story-moments"/);
    assert.match(out, /<h2[^>]*>Memorable Moments<\/h2>/);
    assert.match(out, /11 from this session/);
    assert.match(html(md, { unitKind: 'chapter' }), /11 from this chapter/);
    assert.match(html(md, { unitKind: 'chapter-intro' }), /11 from this chapter/);
  });

  it('a kind row carries its icon; a card with no kind has none', () => {
    const out = html('**Beat.**\n\n*Context.* #moment/funny');
    assert.match(out, /<p class="moment-kind" data-kind="funny"><svg[^>]*aria-hidden="true"[^>]*>.*M8 14s1\.5 2 4 2 4-2 4-2.*<\/svg>Funny<\/p>/);
    assert.doesNotMatch(html('**Beat.**'), /moment-kind/);
  });

  it('the rule shows only with a context line', () => {
    assert.match(html('**Beat.**\n\n*Context.*'), /<hr class="moment-rule">/);
    assert.doesNotMatch(html('**Beat.**'), /moment-rule/);
  });

  it('a quote card prints its speaker, with no blockquote and its links kept', () => {
    const out = html('> "Said aloud."\n> — [Mara](../npcs/mara.html)');
    assert.doesNotMatch(out, /<blockquote/);
    assert.match(out, /class="moment-speaker">— <a href="\.\.\/npcs\/mara\.html">Mara<\/a>/);
    assert.match(out, /Said aloud/);
  });

  it('the speaker line prints as written', () => {
    assert.match(html('> "A."\n> -- Tim'), /class="moment-speaker">-- Tim</);
    assert.match(html('> "A."\n> –Tim'), /class="moment-speaker">–Tim</);
  });

  it('a link in the beat is kept', () => {
    assert.match(html('**[Mara](../npcs/mara.html) fell.**'), /<strong><a href="\.\.\/npcs\/mara\.html">Mara<\/a> fell\.<\/strong>/);
  });
});
