const { describe, it, before, after } = require('node:test');
require('../helpers/quiet-legacy-warning.js');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { buildVault } = require('../helpers/build-vault');
const { fixtureNames, prepareFixture } = require('../helpers/fixture-build');

// What the GM hid must be in NO file of the built site: the hidden words are looked for
// in every output file (pages, search index, cards, scripts), not in one page.

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function everyFileText(root) {
  return walk(root).filter(f => /\.(html|json|js|css|txt|xml)$/.test(f))
    .map(f => ({ file: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }));
}

function mentions(root, word) {
  const re = new RegExp(word, 'i');
  return everyFileText(root).filter(f => re.test(f.text)).map(f => f.file);
}

// L1: one note per way of writing the excluded heading; each hides a word of its own.
const HEADINGS = [
  'GM Notes:', '**GM Notes**', '_GM Notes_', '*GM Notes*', '~~GM Notes~~', '==GM Notes==', '`GM Notes`',
  'GM Notes {#gm}', 'GM Notes {.secret}', 'GM Notes ^gm', '[[GM Notes]]', '[[Plans|GM Notes]]',
  'GM Notes ##', 'GM  Notes', 'gm notes', '**GM Notes:**', '**GM Notes**:', '[GM Notes](x.md)',
];

describe('L1: a heading written with decoration is hidden like a plain one', () => {
  let site;
  before(() => {
    const files = {};
    HEADINGS.forEach((h, i) => {
      files[`Locations/Place ${i}.md`] = `---\ntype: location\n---\nPublic words ${i}.\n\n## ${h}\n\nHIDDENHEAD${i} text.\n\n## Open\n\nSHOWN${i} text.\n`;
    });
    files['Locations/Setext.md'] = '---\ntype: location\n---\nPublic.\n\n**GM Notes**\n-----\n\nHIDDENSETEXT text.\n\n## Open\n\nSHOWNSETEXT text.\n';
    files['Locations/Different.md'] = '---\ntype: location\n---\nPublic.\n\n## GM Notes on travel\n\nSHOWNTRAVEL text.\n\n## GM Notes -\n\nSHOWNDASH text.\n';
    site = buildVault(files, { extraConfig: '  exclude_sections: ["GM Notes"]\n' });
  });
  after(() => site.cleanup());

  HEADINGS.forEach((h, i) => {
    it(`hides ${JSON.stringify(h)} everywhere in the output and keeps the next section`, () => {
      assert.deepStrictEqual(mentions(path.join(site.root, 'docs'), `HIDDENHEAD${i}\\b`), []);
      assert.ok(site.read('locations', `place-${i}.html`).includes(`SHOWN${i} text`));
    });
  });
  it('hides a decorated setext heading', () => {
    assert.deepStrictEqual(mentions(path.join(site.root, 'docs'), 'HIDDENSETEXT'), []);
    assert.ok(site.read('locations', 'setext.html').includes('SHOWNSETEXT'));
  });
  it('does not hide a heading with other words, or a dash', () => {
    const html = site.read('locations', 'different.html');
    assert.ok(html.includes('SHOWNTRAVEL') && html.includes('SHOWNDASH'));
  });
});

// L2: a note with no page has no search entry.
describe('L2: the search index lists only pages that exist', () => {
  it('leaves out a world-flags note, words and all', () => {
    const site = buildVault({
      'Locations/Gate.md': '---\ntype: location\n---\nA gate.\n',
      'Locations/_flags.md': '---\ntype: world_flags\n---\n## Canon\n\n- The mayor is secretly HIDDENFLAGWORD.\n',
    });
    try {
      assert.ok(!site.exists('locations', 'flags.html'));
      assert.deepStrictEqual(mentions(path.join(site.root, 'docs'), 'HIDDENFLAGWORD'), []);
      const index = JSON.parse(site.read('search-index.json'));
      assert.deepStrictEqual(Object.values(index.documents).map(d => d.href), ['locations/gate.html']);
    } finally { site.cleanup(); }
  });

  it('names a built file in every entry, on every fixture vault', () => {
    const failures = [];
    let checked = 0;
    for (const name of fixtureNames()) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-fixture-'));
      try {
        const configPath = prepareFixture(name, root);
        const log = console.log; const warn = console.warn;
        console.log = () => {}; console.warn = () => {};
        try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
        const indexFile = path.join(root, 'docs', 'search-index.json');
        if (!fs.existsSync(indexFile)) continue;
        for (const doc of Object.values(JSON.parse(fs.readFileSync(indexFile, 'utf8')).documents)) {
          checked++;
          if (!fs.existsSync(path.join(root, 'docs', ...doc.href.split('/')))) failures.push(`${name}: ${doc.href}`);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
    assert.deepStrictEqual(failures, []);
    assert.ok(checked > 60, `checked ${checked} entries`);
  });
});
