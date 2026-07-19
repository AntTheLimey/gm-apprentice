const { test } = require('node:test');
const assert = require('node:assert');
const { buildCoCPartyManifest, renderCoCBoard } = require('../lib/templates/coc/party-board');

// Golden fixture — Canticle Chapter 4 (see the design spec appendix).
function entry(name, slug, dex, player, hp, san, mp, luck, rep, conditions) {
  return { name, outputPath: 'characters/pcs/' + slug + '.html', portrait: null, data: {
    pcSlug: slug, dex, player,
    hp: { cur: hp[0], max: hp[1] }, san: { cur: san[0], max: san[1] }, mp: { cur: mp[0], max: mp[1] },
    luck: { cur: luck }, rep: rep == null ? null : { cur: rep }, conditions: conditions || {},
  } };
}
const CANTICLE = [
  entry('Freddy Cavendish', 'freddy-cavendish', 60, 'Jay', [10, 10], [50, 99], [10, 10], 55, 50),
  entry('Nathaniel Holt', 'nathaniel-holt', 70, 'Phil', [11, 11], [50, 50], [10, 10], 55, 22),
  entry('Emma Wentworth', 'emma-wentworth', 70, 'Missy', [10, 10], [35, 92], [12, 12], 80, 71, { indefiniteInsanity: true }),
  entry('Katherine Ward', 'katherine-ward', 60, 'Juel', [10, 10], [70, 99], [14, 14], 60, 42),
  entry('Adrien de Montferrand', 'adrien-de-montferrand', 55, 'Anna', [12, 12], [60, 60], [12, 12], 80, 56),
  entry('Georgiana Wentworth', 'georgiana-wentworth', 50, 'Beth', [11, 11], [65, 65], [16, 16], 78, 45),
];

test('buildCoCPartyManifest sorts DEX desc, name asc tiebreak', () => {
  const m = buildCoCPartyManifest('canticle', CANTICLE);
  assert.deepEqual(m.pcs.map((p) => p.name), [
    'Emma Wentworth', 'Nathaniel Holt', 'Freddy Cavendish', 'Katherine Ward',
    'Adrien de Montferrand', 'Georgiana Wentworth',
  ]);
  assert.equal(m.pcs[0].dex, 70);
  assert.equal(m.pcs[0].player, 'Missy');
});

test('buildCoCPartyManifest returns null for no entries', () => {
  assert.equal(buildCoCPartyManifest('c', []), null);
  assert.equal(buildCoCPartyManifest('c', [{ name: 'x', data: null }]), null);
});

test('renderCoCBoard emits the columns, the DEX-70 leader, and the insanity badge', () => {
  const html = renderCoCBoard(buildCoCPartyManifest('canticle', CANTICLE), 'player-characters.html');
  assert.match(html, /class="gl-party"/);
  assert.match(html, /<th>DEX<\/th><th>HP<\/th><th>SAN<\/th><th>MP<\/th><th>Luck<\/th>/);
  assert.match(html, /<th>Rep<\/th>/);                       // Regency has rep
  assert.match(html, /data-gl-party="emma-wentworth"/);
  assert.match(html, /gl-party-row mad/);
  assert.match(html, /cond-insanity">Indefinite Insanity/);
  assert.match(html, /data-gl-party-field="san"/);
  assert.match(html, /Missy/);                               // player sub-line
  // Emma (DEX 70) renders before Georgiana (DEX 50)
  assert.ok(html.indexOf('emma-wentworth') < html.indexOf('georgiana-wentworth'));
});

test('renderCoCBoard omits the Rep column when no PC has reputation', () => {
  const noRep = CANTICLE.map((e) => ({ ...e, data: { ...e.data, rep: null } }));
  const html = renderCoCBoard(buildCoCPartyManifest('c', noRep), 'player-characters.html');
  assert.doesNotMatch(html, /<th>Rep<\/th>/);
  assert.doesNotMatch(html, /data-gl-party-field="rep"/);
});

test('renderCoCBoard returns null for a null manifest', () => {
  assert.equal(renderCoCBoard(null, 'x.html'), null);
});
