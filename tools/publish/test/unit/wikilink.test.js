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
const { scoreByRecency } = require('../../lib/recency');
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
      { raw: 'Emma_Wentworth', target: 'Emma_Wentworth', heading: '', display: 'Emma', escapedPipe: true });
    assert.deepStrictEqual(parseWikilink('Emma_Wentworth|Emma'),
      { raw: 'Emma_Wentworth', target: 'Emma_Wentworth', heading: '', display: 'Emma', escapedPipe: false });
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
      { raw: 'Plain', target: 'Plain', heading: '', display: '', escapedPipe: false });
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
    const rw = gmAliasRewriter([owner]);
    assert.strictEqual(rw.markdown('| [[Elias\\|a patron]] |'), '| [[Lord Vane\\|a patron]] |');
    assert.strictEqual(rw.markdown('| [[Lord Vane\\|Elias]] |'), '| [[Lord Vane]] |');
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
    const scored = scoreByRecency([npc], [page], [], { window: 3, max: 10, type: 'npc' });
    assert.strictEqual(scored.length, 1);
  });

  it('a frontmatter participant written with an escaped pipe is a mention', () => {
    const s = { title: 'S', frontmatter: { type: 'session', status: 'played', session_number: 1, participants: ['[[Emma_Wentworth\\|Emma]]'] }, markdown: '' };
    const npc = { title: 'Emma_Wentworth', frontmatter: { type: 'npc' }, markdown: '' };
    assert.strictEqual(scoreByRecency([npc], [s], [], { window: 3, max: 10, type: 'npc' }).length, 1);
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
      { raw: 'A', target: 'A', heading: '', display: '', escapedPipe: false });
  });

  it('the gm-alias rewriter still rewrites a secret name with an empty alias', () => {
    const owner = { title: 'Lord Vane', displayTitle: 'Lord Vane', frontmatter: { gm_aliases: ['Elias'] } };
    const rw = gmAliasRewriter([owner]);
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
    assert.strictEqual(extractRecap(page), 'They met Emma at dawn.');
  });

  it('a location is found by a parent_location written with an escaped pipe', () => {
    const parent = { title: 'Sector_7G', displayTitle: 'Sector 7-G', outputPath: 'locations/s.html',
      frontmatter: { type: 'location' }, markdown: '' };
    const child = { title: 'Docking_Ring', displayTitle: 'Docking Ring', outputPath: 'locations/d.html',
      frontmatter: { type: 'location', parent_location: '[[Sector_7G\\|Sector]]' },
      markdown: '## Overview\n\nCargo moves at all hours here.\n' };
    const ctx = { pages: [parent, child], linkMap: {}, publishConfig: { exclude_sections: [], _backlinks: {} } };
    const html = locationTemplate(parent, { html: '<p>x</p>', relationships: '' }, () => '',
      { siteTitle: 'T', attachmentsDir: '_attachments' }, {}, ctx);
    assert.ok(html.includes('Docking Ring'), 'child listed under its parent');
  });
});
