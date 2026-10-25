const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { makePng } = require('../helpers/make-png');

// A recap's picture shows on the story page and is copied; a picture only in a hidden
// part of the Wrap-Up is not copied.

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

describe('story pages show the pictures a recap embeds', () => {
  let work; let docs;
  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'story-images-'));
    const vault = path.join(work, 'vault');
    docs = path.join(work, 'docs');
    const ch = 'Chapters/Chapter 1 - Opening';
    write(vault, `${ch}/Chapter 1 - Opening.md`, '---\ntype: chapter\nsort_order: 1\n---\n\n# Chapter 1 - Opening\n\nThe first chapter.\n');
    write(vault, `${ch}/Sessions/Session 01/Session 01 - Arrival.md`, `---
type: session
session_number: 1
chapter: "[[Chapter 1 - Opening]]"
documents:
  wrap_up: "[[Chapter_01_Session_01_Wrap_Up]]"
---

Hub body.
`);
    write(vault, `${ch}/Sessions/Session 01/Chapter_01_Session_01_Wrap_Up.md`, `---
type: session_wrap
session: "[[Session 01 - Arrival]]"
session_number: 1
chapter: "[[Chapter 1 - Opening]]"
---

# Session 01 Wrap-Up

## Narrative Recap

They reached the harbour at dusk.

![[harbour.png]]

<!-- gm-only -->
## GM Notes

![[secret-map.png]]
<!-- /gm-only -->
`);
    write(vault, `${ch}/Sessions/Session 02/Session 02 - Departure.md`, `---
type: session
session_number: 2
chapter: "[[Chapter 1 - Opening]]"
documents:
  wrap_up: "[[Chapter_01_Session_02_Wrap_Up]]"
---

Hub body.
`);
    write(vault, `${ch}/Sessions/Session 02/Chapter_01_Session_02_Wrap_Up.md`, `---
type: session_wrap
session: "[[Session 02 - Departure]]"
session_number: 2
chapter: "[[Chapter 1 - Opening]]"
---

# Session 02 Wrap-Up

## Narrative Recap

They sailed at dawn without a picture.
`);
    fs.mkdirSync(path.join(vault, '_attachments'), { recursive: true });
    fs.writeFileSync(path.join(vault, '_attachments', 'harbour.png'), makePng(8, 8));
    fs.writeFileSync(path.join(vault, '_attachments', 'secret-map.png'), makePng(8, 8));
    write(vault, '_meta/vault-config.md', '---\npublish:\n  folder_map:\n    Chapters: chapters\n---\n');
    const configPath = path.join(work, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: docs, attachmentsDir: '_attachments', siteTitle: 'T' }));
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
  });
  after(() => fs.rmSync(work, { recursive: true, force: true }));

  const storyFile = (n) => fs.readdirSync(path.join(docs, 'story')).filter(f => f.includes(n))
    .map(f => fs.readFileSync(path.join(docs, 'story', f), 'utf8')).join('\n');

  it("a recap's image embed shows on its story page and is copied", () => {
    const html = storyFile('session-01');
    assert.match(html, /<img[^>]*src="\.\.\/images\/harbour\.png"/);
    assert.ok(fs.existsSync(path.join(docs, 'images', 'harbour.png')));
  });

  it("an image only in a recap's GM Notes is not copied", () => {
    assert.ok(!fs.existsSync(path.join(docs, 'images', 'secret-map.png')));
    assert.ok(!storyFile('session-01').includes('secret-map'));
  });

  it('a recap with no embeds renders as before', () => {
    const html = storyFile('session-02');
    assert.ok(html.includes('without a picture'));
    assert.ok(!html.includes('<img'));
  });
});
