const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lunr = require('lunr');

const { wikilinkRe, parseWikilink, firstWikilinkTarget } = require('../../lib/wikilink');
const {
  resolveWikiLinks, resolveImageEmbeds, processContent, parseWikiRef, plainMetaValue,
  renderMetaValue, gmAliasRewriter,
} = require('../../lib/processor');
const { buildBacklinks } = require('../../lib/backlinks');
const WORDS = require('../helpers/settings-files').defaultWithheldWords();
const { scoreByRecency } = require('../../lib/recency');
const GONE = new Set(require('../../lib/settings').entry('vault.statuses.gone').default);
const { buildSearchIndex } = require('../../lib/search-index');
const { excerptFromMarkdown } = require('../../lib/excerpt');
const { runSiteDoctor } = require('../../lib/site-doctor');
const { refTarget } = require('../../lib/wikilink');
const { parseParticipant } = require('../../lib/templates/event');
const { extractRecap } = require('../../lib/templates/landing-data');
const { locationTemplate } = require('../../lib/templates/location');

// Obsidian writes a link inside a table cell with its alias pipe escaped.
const ROW = '| a | [[Emma_Wentworth\\|Emma]] |';

describe('parseWikilink', () => {
  it('treats a backslash before the alias pipe as part of the pipe', () => {
    assert.deepStrictEqual(parseWikilink('Emma_Wentworth\\|Emma'),
      { raw: 'Emma_Wentworth', target: 'Emma_Wentworth', name: 'Emma_Wentworth', heading: '', display: 'Emma', escapedPipe: true });
    assert.deepStrictEqual(parseWikilink('Emma_Wentworth|Emma'),
      { raw: 'Emma_Wentworth', target: 'Emma_Wentworth', name: 'Emma_Wentworth', heading: '', display: 'Emma', escapedPipe: false });
  });

  it('keeps the heading and block after an escaped pipe', () => {
    const h = parseWikilink('Note#Heading\\|Y');
    assert.strictEqual(h.target, 'Note');
    assert.strictEqual(h.heading, 'Heading');
    assert.strictEqual(h.display, 'Y');
    assert.strictEqual(h.escapedPipe, true);
    const b = parseWikilink('Note^b1\\|Y');
    assert.strictEqual(b.target, 'Note');
    assert.strictEqual(b.heading, 'b1');
  });

  it('keeps an image size', () => {
    assert.strictEqual(parseWikilink('img.png\\|300').display, '300');
  });

  it('has no alias and no heading on a bare target', () => {
    assert.deepStrictEqual(parseWikilink('Plain'),
      { raw: 'Plain', target: 'Plain', name: 'Plain', heading: '', display: '', escapedPipe: false });
  });

  it('wikilinkRe matches an escaped-pipe link as one link, and gives a fresh RegExp', () => {
    const m = wikilinkRe('').exec('x [[A\\|B]] y');
    assert.strictEqual(m[1], 'A\\|B');
    assert.notStrictEqual(wikilinkRe(), wikilinkRe());
    assert.strictEqual(wikilinkRe('g', true).exec('![[A]]')[0], '![[A]]');
    assert.strictEqual(firstWikilinkTarget('[[Name\\|x]]'), 'Name');
    assert.strictEqual(firstWikilinkTarget('[[Name|x]]'), 'Name');
  });
});

describe('table links with an escaped pipe, in the site build', () => {
  const linkMap = { Emma_Wentworth: 'characters/emma.html' };

  it('resolveWikiLinks rewrites the link and the row stays a row', () => {
    assert.strictEqual(resolveWikiLinks(ROW, linkMap, 'sessions/x.html'),
      '| a | [Emma](../characters/emma.html) |');
  });

  it('an unresolved one renders as its display text', () => {
    assert.strictEqual(resolveWikiLinks('| [[Nobody\\|Nob]] |', linkMap, 'x.html'), '| Nob |');
  });

  it('a full page render gives a <td> holding an <a>', () => {
    const page = {
      markdown: '| who | link |\n|---|---|\n| a | [[Emma_Wentworth\\|Emma]] |\n',
      frontmatter: {}, outputPath: 'sessions/x.html',
    };
    const { html } = processContent(page, linkMap, []);
    assert.match(html, /<td><a href="\.\.\/characters\/emma\.html"[^>]*>Emma<\/a><\/td>/);
    assert.ok(!html.includes('\\'), html);
  });

  it('an escaped-pipe image embed keeps its size text and finds the file', () => {
    const used = new Set();
    const out = resolveImageEmbeds('![[map.png\\|300]]', { 'map.png': { relPath: 'map.png' } }, 'x.html', used);
    assert.match(out, /^!\[300\]\(images\/map\.png\)$/);
    assert.ok(used.has('map.png'));
  });

  it('parseWikiRef and the meta-value helpers drop the backslash', () => {
    assert.deepStrictEqual(parseWikiRef('[[Emma_Wentworth\\|Emma]]'), { target: 'Emma_Wentworth', label: 'Emma' });
    assert.strictEqual(plainMetaValue('[[Emma_Wentworth\\|Emma]]'), 'Emma');
    assert.match(renderMetaValue('[[Emma_Wentworth\\|Emma]]', linkMap, 'sessions/x.html'),
      /<a href="..\/characters\/emma.html" class="entity-link">Emma<\/a>/);
  });

  it('the gm-alias rewriter keeps the escaped pipe', () => {
    const owner = { title: 'Lord Vane', displayTitle: 'Lord Vane', frontmatter: { gm_aliases: ['Elias'] } };
    const rw = gmAliasRewriter([owner], undefined, undefined, WORDS);
    assert.strictEqual(rw.markdown('| [[Elias\\|a patron]] |'), '| [[Lord Vane\\|a patron]] |');
    assert.strictEqual(rw.markdown('| [[Lord Vane\\|Elias]] |'), '| [[Lord Vane]] |');
  });
});

describe('a secret alias with a ^block anchor is still rewritten', () => {
  const owner = { title: 'Lord Vane', displayTitle: 'Lord Vane', frontmatter: { gm_aliases: ['Elias Crowe'] } };
  const rw = gmAliasRewriter([owner], undefined, undefined, WORDS);

  it('in every link form', () => {
    assert.strictEqual(rw.markdown('[[Elias Crowe^b1]]'), '[[Lord Vane^b1]]');
    assert.strictEqual(rw.markdown('[[Elias Crowe^b1|y]]'), '[[Lord Vane^b1|y]]');
    assert.strictEqual(rw.markdown('| [[Elias Crowe^b1\\|y]] |'), '| [[Lord Vane^b1\\|y]] |');
    assert.strictEqual(rw.markdown('![[Elias Crowe^b1]]'), '![[Lord Vane^b1]]');
    assert.strictEqual(rw.markdown('[[Elias Crowe#Past]]'), '[[Lord Vane#Past]]');
  });

  it('and when written with a folder path', () => {
    assert.strictEqual(rw.markdown('[[NPCs/Elias Crowe]]'), '[[Lord Vane]]');
    assert.strictEqual(rw.markdown('[[NPCs/Elias Crowe.md]]'), '[[Lord Vane]]');
    assert.strictEqual(rw.markdown('[[NPCs/Elias Crowe#Past]]'), '[[Lord Vane#Past]]');
    assert.strictEqual(rw.markdown('[[NPCs/Elias Crowe^b1|y]]'), '[[Lord Vane^b1|y]]');
    assert.strictEqual(rw.markdown('| [[NPCs/Elias Crowe\\|y]] |'), '| [[Lord Vane\\|y]] |');
    assert.strictEqual(rw.markdown('![[NPCs/Elias Crowe.md]]'), '![[Lord Vane]]');
    assert.strictEqual(rw.markdown('[[NPCs/Lord Vane]]'), '[[NPCs/Lord Vane]]');
  });

  it('and with a .md on the name', () => {
    assert.strictEqual(rw.markdown('[[Elias Crowe.md]]'), '[[Lord Vane]]');
    assert.strictEqual(rw.markdown('[[Elias Crowe.md#Past]]'), '[[Lord Vane#Past]]');
    assert.strictEqual(rw.markdown('[[Elias Crowe.md^b1|y]]'), '[[Lord Vane^b1|y]]');
    assert.strictEqual(rw.markdown('![[Elias Crowe.md]]'), '![[Lord Vane]]');
  });
});

describe('backlinks, recency, search and excerpt read the escaped link', () => {
  const page = {
    title: 'Session_1', displayTitle: 'Session 1', outputPath: 'sessions/s1.html',
    frontmatter: { type: 'session', status: 'played', session_number: 1 },
    markdown: ROW,
  };

  it('backlinks counts a link to Emma_Wentworth', () => {
    const bl = buildBacklinks([page]);
    assert.ok(bl.Emma_Wentworth, Object.keys(bl).join());
    assert.ok(!Object.keys(bl).some(k => k.includes('\\')));
  });

  it('recency counts the mention', () => {
    const npc = { title: 'Emma_Wentworth', frontmatter: { type: 'npc' }, markdown: '' };
    const scored = scoreByRecency([npc], [page], [], { gone: GONE, window: 3, max: 10, type: 'npc' });
    assert.strictEqual(scored.length, 1);
  });

  it('a frontmatter participant written with an escaped pipe is a mention', () => {
    const s = { title: 'S', frontmatter: { type: 'session', status: 'played', session_number: 1, participants: ['[[Emma_Wentworth\\|Emma]]'] }, markdown: '' };
    const npc = { title: 'Emma_Wentworth', frontmatter: { type: 'npc' }, markdown: '' };
    assert.strictEqual(scoreByRecency([npc], [s], [], { gone: GONE, window: 3, max: 10, type: 'npc' }).length, 1);
  });

  it('the search index and the excerpt show Emma with no backslash', () => {
    const idx = lunr.Index.load(buildSearchIndex([page]).index);
    assert.strictEqual(idx.search('emma').length, 1);
    assert.strictEqual(idx.search('wentworth').length, 0);
    assert.strictEqual(excerptFromMarkdown('Met [[Emma_Wentworth\\|Emma]] today.'), 'Met Emma today.');
    assert.strictEqual(excerptFromMarkdown('Met [[Emma_Wentworth#H\\|Emma]] today.'), 'Met Emma today.');
  });
});

describe('site-doctor and the escaped link', () => {
  async function dead(vaultFiles) {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wikilink-doctor-'));
    for (const [rel, body] of Object.entries(vaultFiles)) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), body);
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikilink-site-'));
    const configPath = path.join(dir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      siteTitle: 'T', vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments',
      folderMap: { Characters: 'characters', Sessions: 'sessions' },
    }));
    const out = [];
    await runSiteDoctor({ configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null });
    fs.rmSync(vault, { recursive: true, force: true });
    return JSON.parse(out.join('')).findings.filter(f => f.code === 'LINK_UNRESOLVED');
  }

  it('does not report a link to an existing page, and names the target of a missing one', async () => {
    const files = {
      'Characters/Emma_Wentworth.md': '---\ntype: npc\n---\n\nEmma.\n',
      'Sessions/S1.md': '---\ntype: session\nstatus: played\n---\n\n| a | [[Emma_Wentworth\\|Emma]] |\n',
    };
    assert.strictEqual((await dead(files)).length, 0);
    files['Sessions/S1.md'] += '| b | [[Nobody_Here\\|Nob]] |\n';
    const rows = await dead(files);
    assert.strictEqual(rows.length, 1);
    assert.match(rows[0].detail, /\[\[Nobody_Here\]\]/);
  });
});

describe('an empty alias is no alias', () => {
  it('the shared pattern matches [[A|]] and ![[A|]] and parses no display', () => {
    assert.strictEqual(wikilinkRe('', true).exec('![[A|]]')[0], '![[A|]]');
    assert.deepStrictEqual(parseWikilink('A|'),
      { raw: 'A', target: 'A', name: 'A', heading: '', display: '', escapedPipe: false });
  });

  it('the gm-alias rewriter still rewrites a secret name with an empty alias', () => {
    const owner = { title: 'Lord Vane', displayTitle: 'Lord Vane', frontmatter: { gm_aliases: ['Elias'] } };
    const rw = gmAliasRewriter([owner], undefined, undefined, WORDS);
    for (const form of ['[[Elias|]]', '![[Elias|]]', '[[Elias\\|]]']) {
      const out = rw.markdown(`She met ${form} there.`);
      assert.ok(!out.includes('Elias'), out);
      assert.match(out, /\[\[Lord Vane\]\]/);
    }
  });

  it('resolveWikiLinks and the excerpt show the humanized target, never raw brackets', () => {
    assert.strictEqual(resolveWikiLinks('[[Dr_Who|]]', {}, 'x.html'), 'Dr Who');
    assert.strictEqual(resolveWikiLinks('[[Dr_Who|]]', { Dr_Who: 'c/who.html' }, 'x.html'), '[Dr Who](c/who.html)');
    assert.strictEqual(excerptFromMarkdown('Met [[Dr_Who|]] today.'), 'Met Dr Who today.');
  });
});

describe('templates read the escaped link', () => {
  it('refTarget drops the alias and the backslash of the pipe', () => {
    assert.strictEqual(refTarget('[[Name\\|Shown]]'), 'Name');
    assert.strictEqual(refTarget('[[Name|Shown]]'), 'Name');
    assert.strictEqual(refTarget('Name'), 'Name');
  });

  it('parseParticipant takes the target and alias of an escaped link', () => {
    const p = parseParticipant('[[Emma_Wentworth\\|Emma]] (injured)');
    assert.strictEqual(p.target, 'Emma_Wentworth');
    assert.strictEqual(p.display, 'Emma');
    assert.strictEqual(p.annotation, 'injured');
    assert.strictEqual(parseParticipant('[[Emma_Wentworth|]]').display, 'Emma Wentworth');
  });

  it('the landing recap teaser shows the alias without a backslash', () => {
    const page = { frontmatter: {}, markdown: '## Narrative Recap\n\nThey met [[Emma_Wentworth\\|Emma]] at dawn.\n' };
    assert.strictEqual(extractRecap(page, 500), 'They met Emma at dawn.');
  });

  it('a location is found by a parent_location written with an escaped pipe', () => {
    const parent = { title: 'Sector_7G', displayTitle: 'Sector 7-G', outputPath: 'locations/s.html',
      frontmatter: { type: 'location' }, markdown: '' };
    const child = { title: 'Docking_Ring', displayTitle: 'Docking Ring', outputPath: 'locations/d.html',
      frontmatter: { type: 'location', parent_location: '[[Sector_7G\\|Sector]]' },
      markdown: '## Overview\n\nCargo moves at all hours here.\n' };
    const ctx = { pages: [parent, child], linkMap: {}, publishConfig: { exclude_sections: [], _backlinks: {} } };
    const html = locationTemplate(parent, { html: '<p>x</p>' }, () => '',
      { siteTitle: 'T', attachmentsDir: '_attachments' }, {}, ctx);
    assert.ok(html.includes('Docking Ring'), 'child listed under its parent');
  });
});

describe('fix round 2: old semantics kept', () => {
  it('a location whose title starts with an underscore still matches its ref', () => {
    const hub = { title: '_Hub', displayTitle: 'Hub', outputPath: 'locations/h.html',
      frontmatter: { type: 'location' }, markdown: '' };
    const child = { title: 'Dock', displayTitle: 'Dock', outputPath: 'locations/d.html',
      frontmatter: { type: 'location', parent_location: '[[_Hub]]' },
      markdown: '## Overview\n\nCargo moves at all hours here.\n' };
    const ctx = { pages: [hub, child], linkMap: {}, publishConfig: { exclude_sections: [], _backlinks: {} } };
    const html = locationTemplate(hub, { html: '<p>x</p>' }, () => '',
      { siteTitle: 'T', attachmentsDir: '_attachments' }, {}, ctx);
    assert.ok(html.includes('Dock'), 'child listed under _Hub');
  });

  it('an empty-target link never renders as raw brackets', () => {
    assert.strictEqual(excerptFromMarkdown('Met [[|x]] today.'), 'Met |x today.');
    const page = { frontmatter: {}, markdown: '## Narrative Recap\n\nThey met [[|x]] at dawn.\n' };
    assert.strictEqual(extractRecap(page, 500), 'They met |x at dawn.');
  });
});

describe('linkText: a frontmatter value that names a note, read for a page that prints it', () => {
  const { linkText, labelsForLinks } = require('../../lib/wikilink');
  it('a value with no label is the value with its brackets off, as these readers always took it', () => {
    for (const value of ['Old_Tam', '[[Old_Tam]]', ' [[Old_Tam#Past]] ', '[[A]] (and [[B]])', '[[Folder/Old_Tam]]', '[[Old_Tam|]]']) {
      const bare = value.replace(/\[\[|\]\]/g, '');
      assert.deepStrictEqual(linkText(value), { words: bare, key: bare, labelled: false }, value);
    }
  });
  it('a labelled link is looked up by its target and printed as its label, never as the target', () => {
    assert.deepStrictEqual(linkText('[[Vesper_Hale|the stranger]]'), { words: 'the stranger', key: 'Vesper_Hale', labelled: true });
    assert.deepStrictEqual(linkText(' [[Vesper_Hale#Past\\|the stranger]] '), { words: ' the stranger ', key: 'Vesper_Hale', labelled: true });
    assert.deepStrictEqual(linkText('[[Vesper_Hale.md|the stranger]]').key, 'Vesper_Hale');
  });
  it('in running text each labelled link prints its label and the rest stays', () => {
    const got = linkText('[[Old_Tam]] (held for [[Vesper_Hale|the stranger]])');
    assert.strictEqual(got.words, 'Old_Tam (held for the stranger)');
    assert.strictEqual(got.labelled, false);
    assert.ok(!got.words.includes('Vesper'));
  });
  it('humanize reads _ as a space in everything but a label', () => {
    assert.strictEqual(linkText('[[Old_Tam]] and [[Vesper_Hale|snake_case]]', { humanize: true }).words, 'Old Tam and snake_case');
    assert.strictEqual(linkText('Old_Tam', { humanize: true }).key, 'Old_Tam');
  });
  it('a label holding a lone ] prints the label, and the target is still the key', () => {
    assert.deepStrictEqual(linkText('[[Ghost_Agent|agent [X] of the cult]]', { humanize: true }), { words: 'agent [X] of the cult', key: 'Ghost_Agent', labelled: true });
    assert.deepStrictEqual(linkText('[[Ghost_Agent|agent [deceased]]]'), { words: 'agent [deceased]', key: 'Ghost_Agent', labelled: true });
    const running = linkText('Seen with [[Ghost_Agent|a man [X] in grey]] and [[Old_Tam]]', { humanize: true });
    assert.strictEqual(running.words, 'Seen with a man [X] in grey and Old Tam');
    assert.ok(!running.words.includes('Ghost'));
  });
  it('a link nested in a label prints the innermost label and no target', () => {
    const one = linkText('[[ZZA|[[ZZB|[[ZZC|the veiled one]]]]]]');
    assert.deepStrictEqual(one, { words: 'the veiled one', key: 'ZZA', labelled: true });
    const two = linkText('[[ZZA|[[ZZB|two deep]]]]', { humanize: true });
    assert.strictEqual(two.words, 'two deep');
    assert.strictEqual(linkText('see [[ZZA|[[ZZB|c_d]]]] now', { humanize: true }).words, 'see c_d now');
  });
  it('two links side by side are not one labelled link', () => {
    const got = linkText('[[A|x]] and [[B|y]]');
    assert.strictEqual(got.labelled, false);
    assert.strictEqual(got.words, 'x and y');
  });
  it('labelsForLinks turns only labelled links into their labels', () => {
    assert.strictEqual(labelsForLinks('Heir of [[Old_Tam|the old man]] and [[Bo_Pike]]'), 'Heir of the old man and [[Bo_Pike]]');
    assert.strictEqual(labelsForLinks('a | b and [[Bo_Pike]]'), 'a | b and [[Bo_Pike]]');
    assert.strictEqual(labelsForLinks(null), '');
    assert.strictEqual(labelsForLinks('[[Old_Tam\\|the old man]]'), 'the old man');
  });
});

describe('a labelled superseded_by names the note that took over', () => {
  const { buildLinkMap } = require('../../lib/scanner');
  it('links to the old name go to the new page', () => {
    const page = (title, frontmatter) => ({ title, displayTitle: title, outputPath: `${title.toLowerCase()}.html`, vaultPath: title, frontmatter });
    const map = buildLinkMap([
      page('Old', { type: 'npc', canon_status: 'SUPERSEDED', superseded_by: '[[New|the new one]]' }),
      page('New', { type: 'npc' }),
    ]);
    assert.strictEqual(map.Old, 'new.html');
  });
});

describe('labelsForLinksFully', () => {
  const { labelsForLinksFully } = require('../../lib/wikilink');
  it('reduces a link nested in a label to the innermost label', () => {
    assert.strictEqual(labelsForLinksFully('[[A|[[B|c]]]]'), 'c');
    assert.strictEqual(labelsForLinksFully('x [[A|[[B|[[C|d]]]]]] [[E]]'), 'x d [[E]]');
  });
  it('reduces nesting of any depth, leaving no target', () => {
    const deep = (n) => '[[T|'.repeat(n) + 'x' + ']]'.repeat(n);
    assert.strictEqual(labelsForLinksFully(deep(12)), 'x');
    assert.strictEqual(labelsForLinksFully(`a ${deep(40)} b`), 'a x b');
  });
  it('leaves plain text and unlabelled links alone', () => {
    assert.strictEqual(labelsForLinksFully('Heir of [[Bo_Pike]]'), 'Heir of [[Bo_Pike]]');
    assert.strictEqual(labelsForLinksFully(null), '');
  });
});

describe('labelsForLinks: embeds and a ] inside a link', () => {
  const { labelsForLinks } = require('../../lib/wikilink');
  const { escapeHtml } = require('../../lib/processor');
  it('an embed with a size prints nothing, not "!300"', () => {
    assert.strictEqual(escapeHtml('![[map.png|300]]'), '');
    assert.strictEqual(labelsForLinks('a ![[map.png|300]] b'), 'a  b');
    assert.strictEqual(labelsForLinks('![[map.png]]'), '![[map.png]]');
  });
  it('a ] inside the label or the target still prints only the label', () => {
    assert.strictEqual(labelsForLinks('[[Vesper_Hale|a]b]]'), 'a]b');
    assert.strictEqual(labelsForLinks('[[Vesper]Hale|the stranger]]'), 'the stranger');
    assert.strictEqual(labelsForLinks('x [[Vesper]Hale|the]stranger]] y [[Bo_Pike]]'), 'x the]stranger y [[Bo_Pike]]');
    assert.strictEqual(escapeHtml('[[Vesper_Hale|a]b]]'), 'a]b');
  });
  it('an unlabelled link, or two links side by side, are left as written', () => {
    assert.strictEqual(labelsForLinks('[[A]] | [[B]]'), '[[A]] | [[B]]');
    assert.strictEqual(labelsForLinks('[[A]] and [[B|c]]'), '[[A]] and c');
  });
});

describe('a labelled link inside backticks in a value (kept as it is: the hiding side)', () => {
  const { labelsForLinks } = require('../../lib/wikilink');
  it('prints the label, not the link as typed, so the target is not shown', () => {
    assert.strictEqual(labelsForLinks('`[[Vesper_Hale|the stranger]]`'), '`the stranger`');
  });
});
