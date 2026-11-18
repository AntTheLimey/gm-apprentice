'use strict';
// The House Rules page: the Campaign Overview's `## House Rules` section, built into house-rules.html with a menu link
// in the Reference group whenever it holds a rule, whether or not the Overview itself publishes.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { houseRulesOf } = require('../lib/shared-threads');
const { writeNewConfig } = require('./helpers/settings-files');
const { writePublishList } = require('./helpers/publish-list');

const overview = (section) => `---\ntype: campaign_overview\n---\n\n# Overview\n\n## Premise\n\nA tale.\n\n${section}## Key Themes\n\n- Dread\n`;
const TWO = '## House Rules\n\n- Anyone on time gets a bankable +1 token for any roll.\n- Criticals on a 5 or under.\n\n';
const npc = '---\ntype: npc\n---\n\nA person.\n';

function site(section, { published = false, gm = false, extra = {}, overviewRel = 'Campaign Overview.md', folderMap = { NPCs: 'npcs' }, publishing = ['NPCs/Mara.md'], warnings = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rules-'));
  const vault = path.join(root, 'vault');
  const notes = { 'NPCs/Mara.md': npc, ...extra };
  if (section !== null) notes[overviewRel] = overview(section);
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writePublishList(vault, published
    ? { publishing: [...publishing, overviewRel] }
    : { publishing, excluded: section === null ? [] : [overviewRel] });
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: folderMap }, gm_site: { publish: gm, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = (m) => { if (warnings) warnings.push(String(m)); };
  try { build({ configPath, site: gm ? 'gm' : 'player' }); } finally { Object.assign(console, real); }
  const out = gm ? path.join(root, 'campaign-gm') : path.join(siteDir, 'docs');
  return {
    out,
    exists: (rel) => fs.existsSync(path.join(out, rel)),
    read: (rel) => fs.readFileSync(path.join(out, rel), 'utf8'),
  };
}

for (const published of [false, true]) {
  test(`house rules: the page is built from the section, Overview ${published ? '' : 'un'}published`, () => {
    const s = site(TWO, { published });
    assert.ok(s.exists('house-rules.html'));
    const html = s.read('house-rules.html');
    assert.match(html, /<h1 class="page-title">House Rules<\/h1>/);
    assert.match(html, /<li>Anyone on time gets a bankable \+1 token for any roll\.<\/li>/);
    assert.match(html, /<li>Criticals on a 5 or under\.<\/li>/);
    assert.doesNotMatch(html, /Dread|A tale/, 'only the section, never the rest of the Overview');
  });
}

test('house rules: a menu link in the Reference group, on every page', () => {
  const s = site(TWO);
  for (const page of ['house-rules.html', 'npcs/mara.html', 'index.html']) {
    const html = s.read(page);
    const prefix = page.includes('/') ? '../' : '';
    assert.ok(html.includes(`href="${prefix}house-rules.html">House Rules</a>`), `${page} links the page`);
  }
});

test('house rules: no page and no link with no rules', () => {
  for (const section of [null, '', '## House Rules\n\n', '## House Rules\n\n{Standing changes, one bullet each.}\n\n', '## Other\n\n- a thing\n\n']) {
    const s = site(section);
    assert.ok(!s.exists('house-rules.html'), JSON.stringify(section));
    assert.doesNotMatch(s.read('npcs/mara.html'), /House Rules/);
  }
});

test('house rules: a gm-only fence inside the section stays hidden, on both sites', () => {
  const section = '## House Rules\n\n- Open rule.\n\n<!-- gm-only -->\n- The secret rule is that whoever rolls a natural twenty may rewrite the harbour master ledger.\n<!-- /gm-only -->\n\n';
  for (const gm of [false, true]) {
    const s = site(section, { gm });
    const html = s.read('house-rules.html');
    assert.match(html, /Open rule\./);
    assert.doesNotMatch(html, /secret rule/, gm ? 'gm site' : 'player site');
  }
});

test('house rules: a section whose only rule is behind a gm-only fence builds no page', () => {
  const s = site('## House Rules\n\n<!-- gm-only -->\n- The secret rule is that whoever rolls a natural twenty may rewrite the harbour master ledger.\n<!-- /gm-only -->\n\n');
  assert.ok(!s.exists('house-rules.html'));
});

test('house rules: the page text passes the leak check even though the Overview is unpublished', () => {
  const { runLeakGate } = require('../lib/leak-gate');
  const s = site('## House Rules\n\n- Open rule.\n\n<!-- gm-only -->\n- The secret rule is that whoever rolls a natural twenty may rewrite the harbour master ledger.\n<!-- /gm-only -->\n\n');
  const configPath = path.join(path.dirname(s.out), 'vault.config.json');
  assert.deepEqual(runLeakGate({ configPath, outputDir: s.out }).findings, []);
  const page = path.join(s.out, 'house-rules.html');
  fs.writeFileSync(page, s.read('house-rules.html').replace('</body>', '<p>The secret rule is that whoever rolls a natural twenty may rewrite the harbour master ledger.</p></body>'));
  assert.ok(runLeakGate({ configPath, outputDir: s.out }).findings.some((f) => /rewrite the harbour master/i.test(f.text)));
});

test('house rules: the section is found outside code fences, in any case, up to the next level 2 heading', () => {
  const md = '```\n## House Rules\n- fenced\n```\n\n## house rules\n\n- one\n- two\n\n### Sub\n\nmore\n\n## Next\n\n- no\n';
  assert.equal(houseRulesOf(md), '- one\n- two\n\n### Sub\n\nmore');
  assert.equal(houseRulesOf('## Other\n\n- x\n'), '');
});

test('house rules: a published note of the GM\'s at house-rules.html keeps it: no generated page, one menu link, one warning', () => {
  const warnings = [];
  const note = '---\ntype: reference\n---\n\n# House Rules\n\nNOTE-PAGE rule text.\n';
  const s = site(TWO, { extra: { 'House Rules.md': note }, publishing: ['NPCs/Mara.md', 'House Rules.md'], warnings });
  const html = s.read('house-rules.html');
  assert.match(html, /NOTE-PAGE rule text/);
  assert.doesNotMatch(html, /bankable/);
  assert.equal((s.read('index.html').match(/house-rules\.html/g) || []).length <= 1, true, 'no second menu link');
  const said = warnings.filter((w) => /owns house-rules\.html/.test(w));
  assert.equal(said.length, 1, warnings.join('\n'));
  assert.match(said[0], /House Rules\.md/);
});

test('house rules: an alias link in a rule reads as the public name when the Overview is in a folder the site never reads', () => {
  const { runLeakGate } = require('../lib/leak-gate');
  const mara = '---\ntype: npc\ngm_aliases:\n  - Elias Crowe\n---\n\nA person.\n';
  const rules = '## House Rules\n\n- Ask [[Elias Crowe]] for a loan.\n\n';
  const s = site(rules, { extra: { 'NPCs/Mara.md': mara }, overviewRel: '_Campaign/Campaign Overview.md' });
  const html = s.read('house-rules.html');
  assert.doesNotMatch(html, /Elias Crowe/);
  assert.match(html, /<a href="npcs\/mara\.html">Mara<\/a>/);
  assert.deepEqual(runLeakGate({ configPath: path.join(path.dirname(s.out), 'vault.config.json'), outputDir: s.out }).findings, []);
});
