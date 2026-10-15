'use strict';
// player_site.limits.*, player_site.sheets.header_facts and player_site.withheld_words.*: numbers and word
// lists that were fixed in the build's code. With nothing set, every one gives what the old constant gave
// (checked below, function by function, and by the page tests that stay as they were); each can be set.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../lib/build');
const { loadPublishConfig } = require('../lib/config');
const { entry } = require('../lib/settings');
const { TYPES } = require('../lib/settings/types');
const { renderTimelineStrip } = require('../lib/timeline');
const { extractRecap, extractRecapHtml } = require('../lib/templates/landing-data');
const { cardFor } = require('../lib/previews');
const { headerMetaFields } = require('../lib/pc-header-meta');
const { withheldPlaceholder } = require('../lib/processor');
const { writeNewConfig } = require('./helpers/settings-files');

const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };

// What each setting was before it was one: the constant in the code.
const OLD_LIMITS = { timeline_events: 15, recap_chars: 500, card_excerpt_chars: 200, card_fact_chars: 120, card_title_chars: 120, card_facts: 3, list_goals: 3, list_relationships: 4 };

// A vault on the new settings file; `settings` is what goes under `player_site:`.
function config(settings, dir = tmp('limits-config-')) {
  writeNewConfig(dir, { version: 1, player_site: settings });
  const warnings = [];
  const publishConfig = loadPublishConfig(dir, { vaultPath: dir }, (m) => warnings.push(m));
  return { publishConfig, warnings };
}

test('nothing set: the limits, the header facts and the withheld words are what the code fixed before', () => {
  const { publishConfig, warnings } = config({});
  assert.deepEqual({ ...publishConfig.limits }, OLD_LIMITS);
  assert.deepEqual(publishConfig.header_facts, ['occupation', 'age', 'nationality']);
  assert.deepEqual({ ...publishConfig.withheld_words }, { person: 'someone', place: 'somewhere', thing: 'something' });
  assert.deepEqual(warnings, []);
});

test('a number below its floor, a fraction or text is a warning and the built-in number is used; 0 means zero where allowed', () => {
  const { publishConfig, warnings } = config({
    limits: { timeline_events: 0, recap_chars: 0, card_excerpt_chars: -5, card_fact_chars: 12.5, card_title_chars: 'many', card_facts: 0, list_goals: '2', list_relationships: 1.5 },
  });
  const l = publishConfig.limits;
  assert.equal(l.timeline_events, 0, '0 is allowed and means none');
  assert.equal(l.card_facts, 0);
  assert.equal(l.list_goals, 2, 'a number written as digits in text reads as that number');
  assert.equal(l.recap_chars, 500);
  assert.equal(l.card_excerpt_chars, 200);
  assert.equal(l.card_fact_chars, 120);
  assert.equal(l.card_title_chars, 120);
  assert.equal(l.list_relationships, 4);
  assert.equal(warnings.length, 5, warnings.join('\n'));
  for (const name of ['recap_chars', 'card_excerpt_chars', 'card_fact_chars', 'card_title_chars', 'list_relationships']) {
    assert.ok(warnings.some((w) => w.includes(`player_site.limits.${name}`)), name);
  }
});

test('a withheld word that is blank reads as unset; one that would break its link is a warning and the built-in word is used', () => {
  const { publishConfig, warnings } = config({ withheld_words: { person: '   ', place: 'a|b', thing: ' it ' } });
  assert.deepEqual({ ...publishConfig.withheld_words }, { person: 'someone', place: 'somewhere', thing: 'it' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /player_site\.withheld_words\.place/);
});

test('the header facts can be emptied, and a list is taken as written', () => {
  assert.deepEqual(config({ sheets: { header_facts: [] } }).publishConfig.header_facts, []);
  assert.deepEqual(config({ sheets: { header_facts: ['home_town', 'age'] } }).publishConfig.header_facts, ['home_town', 'age']);
});

test('a number with a largest value and no smallest refuses a bigger one (#375)', () => {
  const e = { type: 'number', integer: true, max: 5 };
  assert.deepEqual(TYPES.number.read(5, e), { ok: true, value: 5 });
  assert.deepEqual(TYPES.number.read(6, e), { ok: false });
  assert.deepEqual(TYPES.number.read(-3, e), { ok: true, value: -3 });
  assert.equal(TYPES.number.takes(e), 'a whole number, 5 or less');
});

test('the registry holds each old number as its default, and the floor the plan names', () => {
  for (const [name, old] of Object.entries(OLD_LIMITS)) {
    const e = entry(`player_site.limits.${name}`);
    assert.equal(e.default, old, name);
    assert.equal(e.integer, true, name);
    assert.equal(e.min, ['timeline_events', 'card_facts', 'list_goals', 'list_relationships'].includes(name) ? 0 : 1, name);
  }
});

// --- Each function, with the default values, gives what it gave with the constant ---

const eventsOf = (n) => Array.from({ length: n }, (_, i) => ({ title: `E${i}`, date: new Date(Date.UTC(2024, 0, i + 1)), type: 'event', outputPath: `e/${i}.html`, outcome: '', location: '' }));
const entriesIn = (html) => (html.match(/class="tl-entry/g) || []).length;

test('renderTimelineStrip: the default shows fifteen, a limit is taken as given, 0 shows none', () => {
  const data = { events: eventsOf(20), chapters: [] };
  assert.equal(entriesIn(renderTimelineStrip(data, { maxEvents: OLD_LIMITS.timeline_events })), 15);
  assert.equal(entriesIn(renderTimelineStrip(data, { maxEvents: 16 })), 16);
  assert.equal(renderTimelineStrip(data, { maxEvents: 0 }), '');
});

const recapPage = (text) => ({ frontmatter: {}, publishedMarkdown: `## Narrative Recap\n\n${text}\n` });

test('extractRecap and extractRecapHtml: the default cuts at 500 characters at a word, a limit is taken as given', () => {
  const long = 'alpha beta gamma delta '.repeat(60).trim();
  for (const read of [extractRecap, extractRecapHtml]) {
    const out = read(recapPage(long), OLD_LIMITS.recap_chars);
    assert.ok(out.endsWith('…') && out.length <= 501 && out.length > 480, String(out.length));
    const short = read(recapPage(long), 80);
    assert.ok(short.endsWith('…') && short.length <= 81, short);
    assert.ok(/(alpha|beta|gamma|delta)…$/.test(short), `cut at a word: ${short}`);
  }
  assert.equal(extractRecap(recapPage('A short recap.'), OLD_LIMITS.recap_chars), 'A short recap.');
});

// The value is always passed in. A caller that forgets it is a mistake in the code, so it stops with a plain error
// instead of quietly using a number or words of its own.
test('extractRecap, extractRecapHtml and gmAliasRewriter throw when the setting is not passed', () => {
  const { gmAliasRewriter } = require('../lib/processor');
  assert.throws(() => extractRecap(recapPage('Some text.')), /recap length/);
  assert.throws(() => extractRecapHtml(recapPage('Some text.')), /recap length/);
  assert.throws(() => extractRecap(recapPage('Some text.'), 0), /recap length/);
  assert.throws(() => gmAliasRewriter([]), /withheld_words/);
  assert.throws(() => gmAliasRewriter([], [], undefined, { person: 'a' }), /withheld_words/);
});

const npcPage = (frontmatter, body = '') => ({ title: 'Hallam', displayTitle: 'Hallam', outputPath: 'x/hallam.html', frontmatter: { type: 'npc', ...frontmatter }, publishedMarkdown: body, markdown: body });
const CARD_CTX = { imageMap: {}, excludeSections: [], limits: OLD_LIMITS, headerFacts: ['occupation', 'age', 'nationality'] };

test('cardFor: the defaults give 3 facts, 120 characters to a fact and a title, 200 to an opening', () => {
  const page = npcPage({ occupation: 'o'.repeat(150), status: 'missing', rank: 'captain', nationality: 'Welsh' }, 'w'.repeat(300));
  page.displayTitle = 't'.repeat(150);
  const card = cardFor(page, CARD_CTX);
  assert.equal(card.f.length, 3);
  assert.equal(card.f[0][1].length, 121);
  assert.equal(card.t.length, 121);
  assert.equal(card.x.length, 201);
});

test('cardFor: each limit is taken as given, and 0 facts shows none', () => {
  const page = npcPage({ occupation: 'o'.repeat(150), status: 'missing', rank: 'captain' }, 'w'.repeat(300));
  page.displayTitle = 't'.repeat(150);
  const card = cardFor(page, { ...CARD_CTX, limits: { card_facts: 1, card_fact_chars: 30, card_title_chars: 40, card_excerpt_chars: 50 } });
  assert.equal(card.f.length, 1);
  assert.equal(card.f[0][1].length, 31);
  assert.equal(card.t.length, 41);
  assert.equal(card.x.length, 51);
  assert.equal(cardFor(page, { ...CARD_CTX, limits: { ...OLD_LIMITS, card_facts: 0 } }).f, undefined);
});

test("a PC's facts: the note's own display_meta wins over the site's list; the site's list is used otherwise", () => {
  assert.deepEqual(headerMetaFields({ display_meta: ['rank'] }, ['age']), ['rank']);
  assert.deepEqual(headerMetaFields({}, ['age']), ['age']);
  assert.deepEqual(headerMetaFields({}, []), []);
  // The page keeps no list of its own: a caller that forgets to pass the site's is told so, not shown an empty header.
  assert.throws(() => headerMetaFields({}), /not given the site's header_facts/);
  assert.throws(() => headerMetaFields({ display_meta: ['rank'] }, undefined), /not given the site's header_facts/);
});

test('withheldPlaceholder: person for a character or NPC, place for a location, thing for any other', () => {
  const words = { person: 'p', place: 'q', thing: 'r' };
  assert.deepEqual(['npc', 'PC', 'location', 'item', '', undefined, 'constructor'].map((t) => withheldPlaceholder(t, words)), ['p', 'p', 'q', 'r', 'r', 'r', 'r']);
});

// --- Pages ---

const note = (type, fm = '', body = 'Text.') => `---\ntype: ${type}\n${fm}---\n\n${body}\n`;
const eventNote = (day, who = []) => `---\ntype: event\nin_game_date: "1922-02-${String(day).padStart(2, '0')}"\nparticipants:${who.length ? '\n' + who.map((w) => `  - "${w}"`).join('\n') : ' []'}\n---\nIt happened.\n`;

function site(settings, files) {
  const root = tmp('limits-site-');
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writeNewConfig(vault, {
    version: 1,
    player_site: {
      folder_map: { Characters: 'characters', Locations: 'locations', Factions: 'factions', Events: 'events', Sessions: 'sessions', Hidden: 'hidden' },
      ...settings,
    },
  });
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: './vault' }));
  const warnings = [];
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try { build({ configPath }); } finally { Object.assign(console, saved); }
  return { warnings, read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8').replace(/\r\n/g, '\n') };
}

const manyEvents = (n, who = []) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Events/Raid ${String(i + 1).padStart(2, '0')}.md`, eventNote(i + 1, who)]));
const journey = (html) => { const at = html.indexOf('id="tab-journey">'); return at < 0 ? '' : html.slice(at, html.indexOf('<script', at) < 0 ? undefined : html.indexOf('<script', at)); };
const stripOf = (html) => { const at = html.indexOf('class="timeline-strip"'); return at < 0 ? '' : html.slice(at, html.indexOf('</div>\n  <a class="recap-link" href="timeline.html">', at)); };

test('timeline_events: nothing set shows fifteen on the landing page and on a PC page; 16 shows 16; 0 shows no strip', () => {
  const files = { 'Characters/Quill.md': note('pc', '', '# Quill'), ...manyEvents(20, ['[[Quill]]']) };
  const plain = site({}, files);
  assert.equal(entriesIn(stripOf(plain.read('index.html'))), 15);
  assert.equal(entriesIn(journey(plain.read('characters', 'quill.html'))), 15);
  const sixteen = site({ limits: { timeline_events: 16 } }, files);
  assert.equal(entriesIn(stripOf(sixteen.read('index.html'))), 16);
  assert.equal(entriesIn(journey(sixteen.read('characters', 'quill.html'))), 16);
  const none = site({ limits: { timeline_events: 0 } }, files);
  assert.equal(stripOf(none.read('index.html')), '');
  assert.equal(entriesIn(journey(none.read('characters', 'quill.html'))), 0);
  assert.match(none.read('timeline.html'), /Raid 20/, 'the full timeline page is not a limit');
});

const LONG_RECAP = 'The crew rowed out past the breakwater and talked about the cargo until the lamps went out. '.repeat(8).trim();
const recapIn = (html) => (/<div class="recap">([\s\S]*?)<a class="recap-link"/.exec(html) || [])[1] || '';

test('recap_chars: nothing set cuts the landing recap at 500 characters; 80 cuts it at 80, at a word', () => {
  const files = { 'Sessions/S1.md': `---\ntype: session\nsession_number: 1\nstatus: played\n---\n\n# Session 1\n\n${LONG_RECAP}\n` };
  const plain = recapIn(site({}, files).read('index.html')).replace(/<[^>]+>/g, '').trim();
  assert.ok(plain.endsWith('…') && plain.length <= 501 && plain.length > 450, String(plain.length));
  const short = recapIn(site({ limits: { recap_chars: 80 } }, files).read('index.html')).replace(/<[^>]+>/g, '').trim();
  assert.ok(short.endsWith('…') && short.length <= 81 && short.length > 50, short);
  assert.ok(/(crew|rowed|out|past|the|breakwater|and|talked|about|cargo|until|lamps|went|cargo)…$/.test(short), short);
});

// The session hub page shows the recap opening too, cut at the same length. Setting 80 must cut it at 80 there, so a
// hardcoded 500 in build.js's call for the hub fails here.
test('recap_chars: the session hub page cuts the Wrap-Up recap at the setting, not at 500', () => {
  const files = {
    'Sessions/S1.md': '---\ntype: session\nsession_number: 1\nstatus: reviewed\ndocuments:\n  wrap_up: "[[S1 Wrap Up]]"\n---\n\n# Session 1\n\nPrep notes.\n',
    'Sessions/S1 Wrap Up.md': `---\ntype: session_wrap\nsession: "[[S1]]"\nsession_number: 1\n---\n\n# S1 Wrap-Up\n\n## Narrative Recap\n\n${LONG_RECAP}\n`,
  };
  const hubRecap = (settings) => {
    const html = site(settings, files).read('sessions', 's1.html');
    const found = /<div class="recap session-recap"><p>([\s\S]*?)<\/p>/.exec(html);
    assert.ok(found, 'the hub page shows a recap opening');
    return found[1];
  };
  const plain = hubRecap({});
  assert.ok(plain.endsWith('…') && plain.length <= 501 && plain.length > 450, String(plain.length));
  const short = hubRecap({ limits: { recap_chars: 80 } });
  assert.ok(short.endsWith('…') && short.length <= 81 && short.length > 50, short);
});

test('card_facts and the card_* lengths: nothing set gives three facts; 1 gives one; 0 gives none; the lengths cut', () => {
  const files = { 'Characters/Hallam.md': note('npc', `occupation: ${'o'.repeat(150)}\nstatus: missing\nrank: captain\n`, 'w'.repeat(300)) };
  const card = (settings) => JSON.parse(site(settings, files).read('previews.json'))['characters/hallam.html'];
  assert.equal(card({}).f.length, 3);
  assert.equal(card({}).f[0][1].length, 121);
  assert.equal(card({}).x.length, 201);
  assert.equal(card({ limits: { card_facts: 1 } }).f.length, 1);
  assert.equal(card({ limits: { card_facts: 0 } }).f, undefined);
  const cut = card({ limits: { card_fact_chars: 30, card_excerpt_chars: 50, card_title_chars: 4 } });
  assert.equal(cut.f[0][1].length, 31);
  assert.equal(cut.x.length, 51);
  assert.equal(cut.t, 'Hall…');
});

test('list_goals and list_relationships: nothing set lists three goals and four relationships; set, they follow; 0 lists none', () => {
  const rels = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `  - target: "[[Mara_${x}]]"\n    type: ally\n`).join('');
  const files = { 'Factions/Guild.md': note('faction', `faction_type: guild\ngoals: [g1, g2, g3, g4, g5]\nrelationships:\n${rels}`) };
  const page = (settings) => site(settings, files).read('factions', 'index.html');
  const count = (html, cls) => (html.match(new RegExp(`class="${cls}"`, 'g')) || []).length;
  const goals = (html) => (/<ul class="intel-goals">([\s\S]*?)<\/ul>/.exec(html) || [, ''])[1].match(/<li>/g) || [];
  const conns = (html) => (html.match(/class="intel-conn"/g) || []).length;
  const plain = page({});
  assert.equal(goals(plain).length, 3);
  assert.equal(conns(plain), 4);
  const one = page({ limits: { list_goals: 1, list_relationships: 1 } });
  assert.equal(goals(one).length, 1);
  assert.equal(conns(one), 1);
  const none = page({ limits: { list_goals: 0, list_relationships: 0 } });
  assert.equal(count(none, 'intel-goals'), 0);
  assert.equal(count(none, 'intel-connections'), 0);
});

test('header_facts: nothing set shows occupation, age and nationality; a list shows those; [] shows none; the note\'s own display_meta wins', () => {
  const pc = (extra = '') => ({ 'Characters/Quill.md': note('pc', `player_name: Sam\noccupation: Smith\nage: 31\nnationality: Welsh\nhome_town: Bath\n${extra}`, '# Quill') });
  const badges = (settings, files) => (site(settings, files).read('characters', 'quill.html').match(/<span class="label">([^<]+)<\/span>/g) || []).map((s) => s.replace(/<[^>]+>/g, ''));
  assert.deepEqual(badges({}, pc()).filter((l) => ['Occupation', 'Age', 'Nationality', 'Home Town'].includes(l)), ['Occupation', 'Age', 'Nationality']);
  assert.deepEqual(badges({ sheets: { header_facts: ['home_town'] } }, pc()).filter((l) => ['Occupation', 'Age', 'Nationality', 'Home Town'].includes(l)), ['Home Town']);
  assert.deepEqual(badges({ sheets: { header_facts: [] } }, pc()).filter((l) => ['Occupation', 'Age', 'Nationality', 'Home Town'].includes(l)), []);
  assert.deepEqual(badges({ sheets: { header_facts: [] } }, pc('display_meta: [age]\n')).filter((l) => ['Occupation', 'Age', 'Nationality', 'Home Town'].includes(l)), ['Age']);
  const card = JSON.parse(site({ sheets: { header_facts: ['home_town'] } }, pc()).read('previews.json'))['characters/quill.html'];
  assert.deepEqual(card.f, [['Player', 'Sam'], ['Home Town', 'Bath']]);
});

test('withheld_words: nothing set prints someone, somewhere and something; each can be set; the word is escaped', () => {
  const files = {
    'Hidden/Lord_Zorn.md': note('npc', 'publish: false\nwithheld: true\n'),
    'Hidden/Old_Quay.md': note('location', 'publish: false\nwithheld: true\n'),
    'Hidden/Blue_Key.md': note('item', 'publish: false\nwithheld: true\n'),
    'Characters/Mara_Quill.md': note('npc', '', 'She met [[Lord_Zorn]] at [[Old_Quay]] and took [[Blue_Key]].'),
  };
  const body = (settings) => site(settings, files).read('characters', 'mara-quill.html');
  assert.ok(body({}).includes('She met someone at somewhere and took something.'));
  const set = body({ withheld_words: { person: 'a stranger', place: 'the old place', thing: '<b>it</b>' } });
  assert.ok(set.includes('She met a stranger at the old place and took &lt;b&gt;it&lt;/b&gt;.'), set.slice(set.indexOf('She met'), set.indexOf('She met') + 120));
  assert.ok(!/Zorn|Old Quay|Blue Key/.test(set));
});
