'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { buildVault } = require('../helpers/build-vault');
const { publishedFrontmatter } = require('../../lib/processor');
const { labelsForLinksFully } = require('../../lib/wikilink');

const note = (fm, body = '') => `---\n${fm}\n---\n${body}\n`;
const FILES = {
  'NPCs/Emma.md': note('type: npc\nrelationships:\n  - target: "[[Hallam]]"\n    type: serves\n    tone: loyal\n    description: His secretary.\n  - target: "[[Vesper_Hale|the stranger]]"\n    type: fears\n  - target: "[[Elias Crowe]]"\n    type: fears\n    description: Saw him once.\n  - target: "[[Cult_Leader]]"\n    type: serves\n    gm_only: true\n    description: Secretly hers.', 'Emma works at [[Docks]].'),
  'NPCs/Hallam.md': note('type: npc\nrelationships:\n  - target: "[[Emma]]"\n    type: distrusts\n    tone: cold\n    description: Watches her.\n    gm_only: true', 'Hallam.'),
  'NPCs/Cult_Leader.md': note('type: npc\npublish: false\nrelationships:\n  - target: "[[Emma]]"\n    type: hunts\n    tone: predatory\n    description: Wants Emma dead, HIDDENLINE.', 'Hidden. Knows [[Emma]].'),
  'NPCs/Lord_Vane.md': note('type: npc\naliases: [Vane]\ngm_aliases: ["Elias Crowe"]\nrelationships:\n  - target: "[[Emma]]"\n    type: employs\n    description: Pays her wages.', 'Vane.'),
  'NPCs/Quiet.md': note('type: npc\npublish_exclude_fields: [relationships]\nrelationships:\n  - target: "[[Emma]]"\n    type: blackmails\n    description: Holds the letters.', 'Quiet.'),
  'Locations/Docks.md': note('type: location', 'The docks. [[Emma]] is often here.'),
  'World/Magic.md': note('type: world_domain\nrules:\n  - rule: Magic costs blood.', 'Magic.'),
  'Sessions/Session_1.md': note('type: session\nsession_number: 1', '[[Emma]] met [[Hallam]].'),
};
const sites = [];
const site = (extraConfig = '') => { const s = buildVault(FILES, { extraConfig }); sites.push(s); return s; };
after(() => sites.forEach((s) => s.cleanup()));

test('a page carries one Connections section and none of the old four', () => {
  const emma = site().read('npcs', 'emma.html');
  assert.strictEqual((emma.match(/<section class="cx"/g) || []).length, 1);
  assert.match(emma, /data-cx-mode="tree"/);
  assert.match(emma, /<a href="hallam\.html">Hallam<\/a> <span class="cx-kind">NPC<\/span> <span class="cx-tone cx-warm">warm<\/span><span class="cx-line">His secretary\.<\/span><span class="cx-sess">1 session: Session 1<\/span>/);
  assert.ok(!emma.includes('relationship-graph'));
  assert.match(emma, /js\/connections\.js/);
});

test('the other end shows the relationship, worded by the inverse', () => {
  assert.match(site().read('npcs', 'hallam.html'), /<h4>Served by<\/h4>\s*<ul>\s*<li><a href="emma\.html">Emma<\/a>/);
});

test('a page that only mentions the subject is under Mentions', () => {
  assert.match(site().read('npcs', 'emma.html'), /<h3>Mentions<\/h3>[^]*<a href="\.\.\/locations\/docks\.html">Docks<\/a>/);
});

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const TEXT_FILE = /\.(html|json|js|css|xml|txt|webmanifest)$/i;

test('hidden material: nothing of a gm-only edge, a hidden note, an excluded field, a GM alias or a name behind a label is in any built file', () => {
  const s = site();
  const files = walk(path.join(s.root, 'docs')).filter((f) => TEXT_FILE.test(f));
  assert.ok(files.some((f) => f.endsWith('search-index.json')), 'the search index is among the files read');
  assert.ok(files.some((f) => f.endsWith(path.join('npcs', 'emma.html'))), 'a page is among the files read');
  // Names and lines that only a hidden thing holds. `Cult` also stands for Cult_Leader.
  const secrets = ['Cult', 'Secretly hers', 'Watches her', 'distrust', 'Holds the letters', 'lackmail', 'Vesper',
    'Elias', 'Crowe', 'HIDDENLINE', 'Wants Emma dead', 'hunts', 'predatory'];
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    for (const secret of secrets) {
      assert.ok(!body.includes(secret), `${path.relative(s.root, file)} holds "${secret}"`);
    }
  }
  const emma = s.read('npcs', 'emma.html');
  assert.match(emma, /<span class="cx-name">the stranger<\/span>/);
  // A GM alias as a target is the note it names, under that note's own title.
  assert.match(emma, /<a href="lord-vane\.html">Lord Vane<\/a>/);
});

// Every note's relationship lines as a page may print them: the published frontmatter
// (gm-only edges dropped), each description read as the page reads it.
function publishedLines() {
  const lines = new Map();
  for (const [rel, text] of Object.entries(FILES)) {
    const fm = publishedFrontmatter(matter(text).data, []);
    const list = Array.isArray(fm.relationships) ? fm.relationships : [];
    lines.set(path.basename(rel, '.md').toLowerCase().replace(/_/g, '-'),
      list.map((r) => labelsForLinksFully(String(r.description || '')).replace(/\s+/g, ' ').trim()).filter(Boolean));
  }
  return lines;
}
const islandOfHtml = (html) => JSON.parse(html.match(/<script[^>]*class="cx-data"[^>]*>([^]*?)<\/script>/)[1].replace(/\\u003c/gi, '<'));

test('every line in a page\'s Connections is in the published frontmatter of its subject or of the item\'s page', () => {
  const s = site();
  const lines = publishedLines();
  let checked = 0;
  for (const file of walk(path.join(s.root, 'docs')).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    if (!/class="cx-data"/.test(html)) continue;
    const subject = path.basename(file, '.html');
    for (const tab of islandOfHtml(html).t) {
      for (const group of tab.g) {
        for (const item of group.d) {
          const other = item.h ? path.basename(item.h, '.html') : null;
          for (const line of item.l) {
            checked++;
            const allowed = [...(lines.get(subject) || []), ...(other ? lines.get(other) || [] : [])];
            assert.ok(allowed.includes(line), `${subject}: "${line}" is in neither ${subject} nor ${other}`);
          }
        }
      }
    }
  }
  assert.ok(checked >= 3, `the lines were read (${checked})`);
});

test('a relationship marked gm_only in any spelling of yes is hidden at both ends', () => {
  const spellings = ['true', 'True', '"true"', '" true "', 'yes', 'YES', 'on', '"On"', '1'];
  const files = { 'NPCs/Alice.md': note('type: npc', 'Alice.') };
  spellings.forEach((g, n) => {
    files[`NPCs/Other_${n}.md`] = note(`type: npc\nrelationships:\n  - target: "[[Alice]]"\n    type: hunts\n    description: SECRETLINE${n}\n    gm_only: ${g}`, `Other ${n}.`);
  });
  const s = buildVault(files); sites.push(s);
  for (const f of walk(path.join(s.root, 'docs')).filter((x) => TEXT_FILE.test(x))) {
    const body = fs.readFileSync(f, 'utf8');
    assert.ok(!/SECRETLINE|Hunted|hunts/i.test(body), `${path.relative(s.root, f)} shows a gm_only edge`);
  }
});

test('a relationship target whose label holds a ] or a link prints the label and no target', () => {
  const targets = ['[[Xqzghost_Agent|agent [X] of the cult]]', '[[Xqzouter_One|[[Xqzinner_Two|[[Xqzcore_Three|the veiled one]]]]]]'];
  const files = { 'NPCs/Alice.md': note('type: npc\nrelationships:\n' + targets.map((t) => `  - target: "${t}"\n    type: knows`).join('\n'), 'Alice.') };
  const s = buildVault(files); sites.push(s);
  for (const f of walk(path.join(s.root, 'docs')).filter((x) => TEXT_FILE.test(x))) {
    const body = fs.readFileSync(f, 'utf8');
    assert.ok(!/Xqz/i.test(body), `${path.relative(s.root, f)} prints a target`);
  }
  const alice = s.read('npcs', 'alice.html');
  assert.match(alice, /<span class="cx-name">agent \[X\] of the cult<\/span>/);
  assert.match(alice, /<span class="cx-name">the veiled one<\/span>/);
});

test('a target with no page is in the page\'s data island by its words, and its key is not', () => {
  const html = site().read('npcs', 'emma.html');
  const island = JSON.parse(html.match(/<script[^>]*class="cx-data"[^>]*>([^]*?)<\/script>/)[1].replace(/\\u003c/gi, '<'));
  const items = island.t.flatMap((tab) => tab.g.flatMap((group) => group.d));
  const stranger = items.find((it) => it.t === 'the stranger');
  assert.ok(stranger, 'the item is in the island');
  assert.strictEqual(stranger.h, null);
  assert.ok(!('key' in stranger), 'the island item carries no key');
  assert.ok(!JSON.stringify(island).includes('Vesper'), 'the target behind the label is not in the island');
  assert.ok(!/"key"/.test(html), 'no key anywhere in the page');
});

test('each mode builds; off leaves no section and no script', () => {
  for (const mode of ['web', 'cards']) {
    assert.match(site(`  connections: ${mode}\n`).read('npcs', 'emma.html'), new RegExp(`data-cx-mode="${mode}"`));
  }
  const off = site('  connections: off\n');
  const html = off.read('npcs', 'emma.html');
  assert.ok(!html.includes('class="cx"') && !html.includes('connections.js'));
  assert.ok(!off.exists('js', 'connections.js'));
  assert.ok(site().exists('js', 'connections.js'));
});

test('no page keeps the sidebar, the body list or the NPC cards', () => {
  const s = site();
  for (const file of [['npcs', 'emma.html'], ['npcs', 'hallam.html'], ['locations', 'docks.html'], ['sessions', 'session-1.html']]) {
    const html = s.read(...file);
    for (const old of ['context-sidebar', 'content-with-sidebar', 'relationship-list', 'relationship-cards', 'rel-card', 'Mentioned In', 'sidebar-badge']) {
      assert.ok(!html.includes(old), `${file.join('/')} still has ${old}`);
    }
  }
});

test("a session page's NPCs are in its Connections, under Appearing", () => {
  assert.match(site().read('sessions', 'session-1.html'), /<h4>Appearing<\/h4>\s*<ul>\s*<li><a href="[^"]*emma\.html">Emma<\/a>/);
});

test('two sessions with one file name each list only their own NPCs', () => {
  const s = buildVault(Object.assign({}, FILES, {
    'Sessions/Ch1/Session_01.md': note('type: session\nsession_number: 1', '[[Emma]] spoke.'),
    'Sessions/Ch2/Session_01.md': note('type: session\nsession_number: 1', '[[Lord_Vane]] spoke.'),
  }));
  sites.push(s);
  const ch1 = s.read('sessions', 'ch1', 'session-01.html');
  const ch2 = s.read('sessions', 'ch2', 'session-01.html');
  assert.match(ch1, /<h4>Appearing<\/h4>[^]*emma\.html/);
  assert.ok(!/<h4>Appearing<\/h4>\s*<ul>(?:(?!<\/ul>)[^])*lord-vane\.html/.test(ch1), 'Ch1 lists an NPC only Ch2 links');
  assert.ok(!/<h4>Appearing<\/h4>\s*<ul>(?:(?!<\/ul>)[^])*emma\.html/.test(ch2), 'Ch2 lists an NPC only Ch1 links');
});

test('World Rules sit in the page, not beside it', () => {
  const html = site().read('world', 'magic.html');
  assert.match(html, /<section class="world-rules"><h2>World Rules<\/h2><ul><li>Magic costs blood\.<\/li><\/ul><\/section>/);
  assert.ok(!html.includes('<aside'));
});

test('a description keeps its underscores and prints a link by its label, in the list and the island (#336)', () => {
  const s = buildVault({
    'NPCs/Ivy.md': note('type: npc\nrelationships:\n  - target: "[[Bo_Pike]]"\n    type: knows\n    description: "_Close_ to snake_case, see https://example.com/a_b and [site](https://example.com/a_(b)) then [[Old_Tom]] and [[Old_Tom|the_smith]]"', 'Ivy.'),
    'NPCs/Bo_Pike.md': note('type: npc', 'Bo.'),
    'NPCs/Old_Tom.md': note('type: npc', 'Tom.'),
  });
  sites.push(s);
  const html = s.read('npcs', 'ivy.html');
  const want = '_Close_ to snake_case, see https://example.com/a_b and site then Old Tom and the_smith';
  assert.ok(html.includes(`<span class="cx-line">${want}</span>`), 'the plain list');
  assert.deepStrictEqual(islandOfHtml(html).t[0].g[0].d[0].l, [want], 'the island');
});
