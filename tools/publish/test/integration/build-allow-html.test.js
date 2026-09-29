const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');
const { configureRenderer } = require('../../lib/processor');

// #266: publish.allow_html, end to end. Whatever the flag, nothing marked gm-only,
// spoiler, commented out or in an excluded section may appear anywhere in the built
// site — page bodies, the campaign index deep-dive, the landing recap or the search
// index.

const NPC = `---
type: npc
occupation: Archivist
---
# Vex

<div class="handout" style="border: 1px solid #333">
Public handout text.
<!-- gm-only -->
SECRET_IN_HANDOUT
<!-- /gm-only -->
</div>

<details><summary>Rumour</summary>Public rumour.</details>

<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#900"/></svg>

<script>window.pwned = true</script>
<img src="x.png" onerror="window.pwned = true">

<!-- gm-only -->
<div class="handout">SECRET_BLOCK</div>
<!-- /gm-only -->

<!-- keeper note
SECRET_COMMENT
-->

## GM Notes

<div>SECRET_SECTION</div>
`;

const OVERVIEW = `---
type: campaign_overview
---
# The Campaign

## Premise

A <span class="accent">public</span> premise.

<!-- gm-only -->
SECRET_PREMISE
<!-- /gm-only -->
`;

function buildVault(work, allowHtml) {
  const vault = path.join(work, 'vault');
  const write = (rel, body) => {
    const full = path.join(vault, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  write('_meta/vault-config.md', `---\npublish:\n  mode: full\n  allow_html: ${allowHtml}\n---\n`);
  write('Characters/NPCs/Vex.md', NPC);
  write('_Campaign/Overview.md', OVERVIEW);
  const configPath = path.join(work, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'Allow HTML',
    siteUrl: 'https://example.com/allow-html',
    vaultPath: vault,
    outputDir: path.join(work, 'docs'),
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/NPCs': 'characters/npcs', _Campaign: 'campaign' },
  }, null, 2));
  const log = console.log;
  console.log = () => {};
  try {
    build({ configPath });
  } finally {
    console.log = log;
  }
  return path.join(work, 'docs');
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

for (const allowHtml of [true, false]) {
  describe(`build with publish.allow_html: ${allowHtml}`, () => {
    let work;
    let docs;

    before(() => {
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-allow-html-'));
      docs = buildVault(work, allowHtml);
    });

    after(() => {
      fs.rmSync(work, { recursive: true, force: true });
      configureRenderer({ allowHtml: false });
    });

    it('emits no gm-only, commented or excluded content in any output file', () => {
      for (const file of walk(docs).filter(f => /\.(html|json|js)$/.test(f))) {
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /SECRET_/, `${path.relative(docs, file)} leaks: ${(text.match(/.{0,80}SECRET_\w+/) || [])[0]}`);
      }
    });

    it('never emits a script from a page body or an event handler', () => {
      const html = fs.readFileSync(path.join(docs, 'characters/npcs/vex.html'), 'utf8');
      assert.doesNotMatch(html, /<script>window\.pwned|<img[^>]*onerror/);
    });

    it('keeps search index terms free of markup', () => {
      const index = JSON.parse(fs.readFileSync(path.join(docs, 'search-index.json'), 'utf8'));
      const terms = JSON.stringify(index.index.invertedIndex.map(e => e[0]));
      for (const bad of ['"div"', '"svg"', '"script"', '"onerror"', '"viewbox"']) {
        assert.ok(!terms.includes(bad), `search index has ${bad}`);
      }
    });

    if (allowHtml) {
      it('renders the allowed markup', () => {
        const html = fs.readFileSync(path.join(docs, 'characters/npcs/vex.html'), 'utf8');
        assert.match(html, /<div class="handout" style="border:1px solid #333">\s*Public handout text\.\s*<\/div>/);
        assert.match(html, /<details><summary>Rumour<\/summary>Public rumour\.<\/details>/);
        assert.match(html, /<svg viewbox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#900"><\/circle><\/svg>/);
      });

      it('renders the campaign deep-dive from the published view, with HTML on', () => {
        const html = fs.readFileSync(path.join(docs, 'campaign/index.html'), 'utf8');
        assert.match(html, /A <span class="accent">public<\/span> premise\./);
      });
    } else {
      it('escapes raw HTML exactly as before', () => {
        const html = fs.readFileSync(path.join(docs, 'characters/npcs/vex.html'), 'utf8');
        assert.match(html, /&lt;div class=.handout. style=.border: 1px solid #333.&gt;/);
        assert.match(html, /&lt;details&gt;&lt;summary&gt;Rumour/);
        assert.doesNotMatch(html, /<div class="handout"/);
      });
    }
  });
}
