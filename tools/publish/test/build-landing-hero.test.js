'use strict';
// #530: player_site.landing.hero.* — a built-in full-bleed landing hero. Card (today's look) is the default and writes
// exactly the page it wrote before; full-bleed writes plain hooks (a class on the hero, a class on <body>) that the
// tool's own stylesheet styles, so neither the tool nor a theme needs :has(). The picture's focus is validated, so a
// value can never carry CSS.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBoth } = require('./helpers/gm-build');
const { makePng } = require('./helpers/make-png');
const { readSettings } = require('../lib/settings/read');
const { TYPES } = require('../lib/settings/types');
const { entry } = require('../lib/settings/registry');

const FILES = {
  'Characters/Mara.md': '---\ntype: npc\n---\nA person.\n',
  'Sessions/Session 01.md': '---\ntype: session\nsession_number: 1\nstatus: played\n---\n\nThe party met.\n',
  'Art/coast.png': makePng(64, 24),
};

const sites = [];
after(() => sites.forEach((s) => s.cleanup()));
function built(hero, { sitesToBuild = ['player'], image = true } = {}) {
  const s = buildBoth(FILES, {
    sites: sitesToBuild,
    player: {
      title: 'Lantern Coast',
      theme: { ...(image ? { campaign_image: 'Art/coast.png' } : {}), tagline: 'Salt and smoke.' },
      ...(hero === undefined ? {} : { landing: { hero } }),
    },
  });
  sites.push(s);
  return s;
}
const heroOf = (html) => html.slice(html.indexOf('<div class="landing-hero'), html.indexOf('</div>', html.indexOf('class="hero-dates"')) + 6);

const unset = built(undefined);
const card = built({ layout: 'card' });
const cardCentre = built({ layout: 'card', align: 'center', focus: '20% center' });
const bleed = built({ layout: 'full-bleed', focus: '20% center', focus_narrow: '68% center', align: 'left' });

test('nothing set: the hero is the card it was, and <body> carries nothing', () => {
  const html = unset.player.read('index.html');
  assert.match(html, /<body>\n/);
  assert.match(html, /<div class="landing-hero">\n {2}<img class="landing-hero-img" /);
  assert.doesNotMatch(html, /full-bleed|--hero-focus|landing-hero--/);
});

test('card, written out (with today\'s align and a focus it has no use for), gives the same pages as nothing set', () => {
  for (const s of [card, cardCentre]) {
    for (const f of unset.player.files().filter((x) => x.endsWith('.html'))) {
      const rel = path.relative(unset.player.dir, f).split(path.sep);
      assert.equal(s.player.read(...rel), fs.readFileSync(f, 'utf8'), rel.join('/'));
    }
  }
});

test('full-bleed writes the hooks on the hero and <body>, with the focus as two custom properties', () => {
  const html = bleed.player.read('index.html');
  assert.match(html, /<body class="landing-full-bleed">/);
  const hero = heroOf(html);
  assert.match(hero, /^<div class="landing-hero landing-hero--full-bleed landing-hero--align-left" style="--hero-focus: 20% center; --hero-focus-narrow: 68% center">/);
  assert.match(hero, /<img class="landing-hero-img" /);
  assert.match(hero, /<h1>Lantern Coast<\/h1>/);
  // Only the landing page is laid out this way.
  assert.match(bleed.player.read('characters', 'mara.html'), /<body>\n/);
});

test('the stylesheet styles the full-bleed hooks without :has() or 100vw', () => {
  const css = bleed.player.read('css', 'style.css');
  for (const sel of ['body.landing-full-bleed > .top-nav', 'body.landing-full-bleed > main.content', '.landing-hero--full-bleed .landing-hero-img', '.landing-hero--full-bleed::after', '.landing-hero--align-left']) {
    assert.ok(css.includes(sel), `style.css has no rule for ${sel}`);
  }
  const block = css.slice(css.indexOf('/* ===== FULL-BLEED LANDING HERO'), css.indexOf('END FULL-BLEED LANDING HERO')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /:has\(|100vw|overflow-x/);
  assert.match(block, /object-position: var\(--hero-focus-narrow, var\(--hero-focus, center\)\)/);
  assert.match(block, /color-mix\(in srgb, var\(--bg-hero\)/);
});

test('align left on a card is a class on the card alone', () => {
  const s = built({ align: 'left' });
  const html = s.player.read('index.html');
  assert.match(html, /<body>\n/);
  assert.match(html, /<div class="landing-hero landing-hero--align-left">/);
});

test('full-bleed with only a focus writes that one property, and with no picture still writes the hooks', () => {
  const one = built({ layout: 'full-bleed', focus: 'right 10% top' });
  assert.match(one.player.read('index.html'), /<div class="landing-hero landing-hero--full-bleed" style="--hero-focus: right 10% top">/);
  const bare = built({ layout: 'full-bleed' }, { image: false });
  const html = bare.player.read('index.html');
  assert.match(html, /<div class="landing-hero landing-hero--full-bleed">/);
  assert.match(html, /<body class="landing-full-bleed">/);
});

test('the GM site follows the player site\'s hero and keeps its band in view', () => {
  const s = built({ layout: 'full-bleed' }, { sitesToBuild: ['player', 'gm'] });
  assert.match(s.gm.read('index.html'), /<body class="landing-full-bleed">/);
  assert.ok(s.gm.read('css', 'gm.css').includes('body.landing-full-bleed > .top-nav'));
});

test('a focus value is a picture position and nothing else', () => {
  const read = (raw) => TYPES.position.read(raw, entry('player_site.landing.hero.focus'));
  for (const good of ['center', '20% center', 'left top', 'right 10% bottom 2rem', '0 0', '-5px 50%', '  68%   CENTER ', 0, 'center center', 'left bottom', 'top right', 'center left']) {
    assert.equal(read(good).ok, true, String(good));
  }
  assert.equal(read('  68%   CENTER ').value, '68% center');
  assert.equal(read(0).value, '0');
  for (const bad of ['20% center; } body { display: none', 'url(x)', 'var(--x)', 'calc(1px + 2px)', '1 2 3 4 5', '', 'middle', '20%;', '10furlongs', '<b>', '12', 12, 'left right', 'top Bottom', 'right 10% left', 'bottom 2rem top']) {
    assert.equal(read(bad).ok, false, bad);
  }
});

test('the generated schema pattern agrees with the reader on same-axis positions', () => {
  const { schema } = require('../lib/settings/describe');
  const text = JSON.stringify(schema());
  const pat = JSON.parse(text);
  const find = (n) => { if (n && typeof n === 'object') { if (n.anyOf && n.anyOf[0] && n.anyOf[0].pattern && /\(\?!/.test(n.anyOf[0].pattern)) return n.anyOf[0].pattern; for (const v of Object.values(n)) { const r = find(v); if (r) return r; } } return null; };
  const re = new RegExp(find(pat));
  for (const good of ['center', '20% center', 'LEFT Top', 'right 10% bottom 2rem']) assert.ok(re.test(good), good);
  for (const bad of ['left right', 'Top bottom', 'right 10% left', 'bottom 2rem top']) assert.ok(!re.test(bad), bad);
});

test('a bad focus is a settings fault with a plain message, and never reaches the page', () => {
  const evil = '20% center; } body { display: none';
  const s = built({ layout: 'full-bleed', focus: evil });
  const html = s.player.read('index.html');
  assert.doesNotMatch(html, /display: none|--hero-focus/);
  assert.match(html, /<div class="landing-hero landing-hero--full-bleed">/);
  const warned = s.logs.find((l) => l.includes('player_site.landing.hero.focus'));
  assert.ok(warned, `no warning names the setting: ${s.logs.join('\n')}`);
  assert.match(warned, /position/);
  // The settings reader reports it the same way the Settings check does.
  const vault = path.join(s.root, 'vault');
  const { faults } = readSettings({ vaultPath: vault });
  const f = faults.find((x) => x.setting === 'player_site.landing.hero.focus');
  assert.ok(f, 'the reader has a fault for it');
});
