const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { build } = require('../../lib/build');

// Leaks, end to end. Nothing marked gm-only, spoiler, commented out or in an excluded
// section may appear anywhere in the built site — page bodies, the campaign index
// deep-dive, the landing recap or the search index — and raw HTML in a body is escaped.

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

// Saved with Windows line endings: a closer shown inside a fenced example must not end
// the gm-only block early (review finding: `.` never matches \r, so the fence was
// missed and SECRET_AFTER_FENCE reached the search index).
const KEEP_CRLF = [
  '---', 'type: location', '---', '# The Keep', '', 'Public keep text.', '',
  '<!-- gm-only -->', 'How to hide a note:', '', '```', '<!-- /gm-only -->', '```', '',
  'SECRET_AFTER_FENCE lives in the cellar.', '<!-- /gm-only -->', '', 'More public text.', '',
].join('\r\n');

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

// A handout in the layout the handout workflow used to produce (#280): the
// Keeper's analysis in top-level sections beside the handout text.
const HANDOUT = `---
type: document
doc_type: letter
---
# The Chit

## Content

> Public handout wording.

## Context

SECRET_CONTEXT the man they came to stop.

## Clues Embedded

- SECRET_CLUE

## Clues, if Katherine walks the servants' course

SECRET_ROUTE

## Prop Notes

SECRET_PROP Keeper-only until delivered.
`;

// Review: `type` removed from the reader-facing frontmatter, and a wrapped
// heading, must not let the Keeper sections through.
const HANDOUT_HIDDEN_TYPE = `---
type: document
publish_exclude_fields: [type]
---
# The Card

## Content

Public card wording.

## **Context**

SECRET_WRAPPED_CONTEXT

## Prop Notes:

SECRET_COLON_PROP
`;

function buildVault(work) {
  const vault = path.join(work, 'vault');
  const write = (rel, body) => {
    const full = path.join(vault, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  write('_meta/vault-config.md', `---\npublish:\n  mode: full\n---\n`);
  write('Characters/NPCs/Vex.md', NPC);
  write('_Campaign/Overview.md', OVERVIEW);
  write('Locations/Keep.md', KEEP_CRLF);
  write('Documents/Chit.md', HANDOUT);
  write('Documents/Card.md', HANDOUT_HIDDEN_TYPE);
  const configPath = path.join(work, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    siteTitle: 'Leaks',
    siteUrl: 'https://example.com/leaks',
    vaultPath: vault,
    outputDir: path.join(work, 'docs'),
    excludeDirs: ['_meta', '_Templates'],
    folderMap: { 'Characters/NPCs': 'characters/npcs', _Campaign: 'campaign', Locations: 'locations', Documents: 'documents' },
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

describe('build leaks', () => {
  let work;
  let docs;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-leaks-'));
    docs = buildVault(work);
  });

  after(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('emits no gm-only, commented or excluded content in any output file', () => {
    for (const file of walk(docs).filter(f => /\.(html|json|js)$/.test(f))) {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /SECRET_/i, `${path.relative(docs, file)} leaks: ${(text.match(/.{0,80}SECRET_\w+/) || [])[0]}`);
    }
  });

  it('keeps a CRLF page\'s gm-only text out of the search index', () => {
    // The index stores lowercased tokens, so check a plain secret-only word too.
    const index = fs.readFileSync(path.join(docs, 'search-index.json'), 'utf8');
    assert.ok(fs.existsSync(path.join(docs, 'locations/keep.html')));
    assert.match(index, /"public"/);
    assert.doesNotMatch(index, /cellar|secret_/i);
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

  it('escapes raw HTML as literal text', () => {
    const html = fs.readFileSync(path.join(docs, 'characters/npcs/vex.html'), 'utf8');
    assert.match(html, /&lt;div class=.handout. style=.border: 1px solid #333.&gt;/);
    assert.match(html, /&lt;details&gt;&lt;summary&gt;Rumour/);
    assert.doesNotMatch(html, /<div class="handout"/);
  });

  it("withholds a handout's Keeper sections and keeps its text (#280)", () => {
    const html = fs.readFileSync(path.join(docs, 'documents/chit.html'), 'utf8');
    assert.match(html, /Public handout wording/);
    assert.doesNotMatch(html, /Context|Clues|Prop Notes/);
  });

  it('keeps the campaign deep-dive free of gm-only premise text', () => {
    const html = fs.readFileSync(path.join(docs, 'campaign/index.html'), 'utf8');
    assert.match(html, /premise\./);
    assert.doesNotMatch(html, /SECRET_PREMISE/);
  });
});
