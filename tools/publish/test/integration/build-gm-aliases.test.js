const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { publishedFrontmatter } = require('../../lib/processor');

// #212: a `gm_aliases` entry resolves links to its page but its text never
// reaches the site: not the search index, not the portrait alt text, not the
// frontmatter meta, and not the text of a link written with it.
const SECRET = 'Elias Crowe';
const OBSIDIAN_SECRET = 'The Crimson Hand';

function writeVault(root) {
  const f = (rel, body) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  f('_attachments/Lord Vane.png', 'fake-png-bytes');
  f('Characters/NPCs/Lord Vane.md', [
    '---', 'type: npc', 'status: alive', 'portrait: "Lord Vane.png"',
    // The Obsidian case: the secret is also under `aliases` so Obsidian resolves it.
    `aliases: [Vane, "${OBSIDIAN_SECRET}"]`,
    `gm_aliases: ["${SECRET}", "${OBSIDIAN_SECRET}", "Red Hand"]`,
    '---', '', 'A courtly patron of the arts.', '',
  ].join('\n'));
  f('Characters/NPCs/Ada Marsh.md', [
    '---', 'type: npc', 'status: alive', 'occupation: Red', `location: "[[${SECRET}]]"`,
    'relationships:',
    `  - target: "[[${SECRET}]]"`, '    type: fears',
    // Bare, with no brackets: renderers look this up in the link map too.
    `  - target: ${SECRET}`, '    type: suspects',
    '---', '',
    `Ada has seen [[${SECRET}]] twice, and once [[${OBSIDIAN_SECRET}|a shadow in red]].`,
    // Spellings Obsidian resolves: other case, underscores, a heading anchor, an embed.
    `She wrote [[elias crowe]], [[Elias_Crowe]] and [[${SECRET}#Past]] in her diary. ![[${SECRET}]]`,
    '',
  ].join('\n'));
  // An unpublished owner: its secret must still be rewritten wherever it is linked.
  f('Characters/NPCs/Mother Grey.md', [
    '---', 'type: npc', 'publish: false', 'gm_aliases: ["The Weaver"]',
    '---', '', 'Spins the town.', '',
  ].join('\n'));
  f('Characters/NPCs/Kit Lowe.md', [
    '---', 'type: npc', 'status: alive',
    'relationships:', '  fears: The Weaver',
    '---', '', 'Kit dreams of [[The Weaver]]. ![[The Weaver]] She fears [[The Veiled One]].', '',
  ].join('\n'));
  // An owner the site never scans (an excluded GM folder) still owns its secret.
  f('_GM/Villains/Lord Crane.md', [
    '---', 'type: npc', 'gm_aliases: ["The Veiled One"]', '---', '', 'Hidden.', '',
  ].join('\n'));
  // Unpublished notes named after a secret, or aliasing it, must not claim it.
  f(`_GM/${SECRET}.md`, ['---', 'type: npc', '---', '', 'GM file on the disguise.', ''].join('\n'));
  f('_GM/Plot.md', ['---', 'aliases: [Red Hand]', '---', '', 'Plot notes.', ''].join('\n'));
  f('Locations/Dock.md', [
    '---', 'type: location', '---', '', 'The [[Red Hand]] meets here.', '',
  ].join('\n'));
  // GM aliases that are ordinary words must not rewrite ordinary fields.
  f('Characters/NPCs/Wren.md', [
    '---', 'type: npc', 'gm_aliases: ["Alive", "Red"]', '---', '', 'A quiet one.', '',
  ].join('\n'));
  // A GM alias that collides with a real page title must not steal that page's links.
  f('Characters/NPCs/Tomas Reed.md', [
    '---', 'type: npc', 'status: alive', 'gm_aliases: ["Ada Marsh"]',
    '---', '', 'Tomas keeps to himself.', '',
  ].join('\n'));
  f('Locations/Harbour.md', [
    '---', 'type: location', '---', '', 'Everyone passes [[Ada Marsh]] here.', '',
  ].join('\n'));
}

function readTree(dir) {
  const out = new Map();
  (function walk(d, base) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.posix.join(base, e.name);
      if (e.isDirectory()) walk(full, rel);
      else if (/\.(html|json|js)$/.test(e.name)) out.set(rel, fs.readFileSync(full, 'utf8'));
    }
  })(dir, '');
  return out;
}

describe('gm_aliases (#212)', () => {
  let work, tree;

  before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-aliases-'));
    const vault = path.join(work, 'vault');
    const docs = path.join(work, 'docs');
    writeVault(vault);
    const configPath = path.join(work, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: vault, outputDir: docs, attachmentsDir: '_attachments',
      siteTitle: 'Alias Campaign', siteUrl: 'https://example.github.io/alias',
      excludeDirs: ['_meta', '_Templates'],
      folderMap: { 'Characters/NPCs': 'characters/npcs', Locations: 'locations' },
    }));
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try { build({ configPath }); } finally { console.log = origLog; console.warn = origWarn; }
    tree = readTree(docs);
  });

  after(() => fs.rmSync(work, { recursive: true, force: true }));

  const pageFor = name => {
    const slug = name.toLowerCase().replace(/ /g, '-');
    const hit = [...tree.keys()].find(k => k.endsWith(`/${slug}.html`));
    assert.ok(hit, `no page for ${name} in ${[...tree.keys()].join(', ')}`);
    return tree.get(hit);
  };

  it('never writes a GM alias anywhere in the site', () => {
    for (const [rel, text] of tree) {
      assert.ok(!text.includes(SECRET), `${rel} contains "${SECRET}"`);
      assert.ok(!text.includes(OBSIDIAN_SECRET), `${rel} contains "${OBSIDIAN_SECRET}"`);
      assert.ok(!/crowe|weaver|veiled|red hand/i.test(text), `${rel} contains a spelling of a GM alias`);
    }
  });

  it('shows an unpublished owner by its public name, unlinked', () => {
    const kit = pageFor('Kit Lowe');
    assert.match(kit, /Kit dreams of Mother Grey\./);
    assert.match(kit, /She fears Lord Crane\./);
  });

  it('leaves an ordinary field alone when its value is also a GM alias', () => {
    const ada = pageFor('Ada Marsh');
    assert.match(ada, /<span class="label">Status<\/span> alive/);
    assert.doesNotMatch(ada, /Wren/);
  });

  it('resolves a GM-alias link to its page, shown under the public name', () => {
    const ada = pageFor('Ada Marsh');
    assert.match(ada, /<a href="lord-vane\.html">Lord Vane<\/a>/);
    assert.match(ada, /<a href="lord-vane\.html">a shadow in red<\/a>/);
  });

  it('keeps public aliases that are not GM aliases', () => {
    const search = [...tree.entries()].find(([k]) => /search-index/.test(k));
    assert.ok(search, `no search index in ${[...tree.keys()].join(', ')}`);
    assert.match(search[1], /\bVane\b/);
  });

  it('lets a real page title win over a clashing GM alias', () => {
    const harbour = pageFor('Harbour');
    assert.match(harbour, /href="[^"]*ada-marsh\.html"/);
    assert.doesNotMatch(harbour, /tomas-reed\.html/);
  });
});

describe('scanAllNotes (#212)', () => {
  it('warns when a note with gm_aliases has unreadable frontmatter', () => {
    const { scanAllNotes } = require('../../lib/scanner');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-alias-bad-'));
    fs.writeFileSync(path.join(dir, 'Mara.md'), '---\ngm_aliases: [The Veiled One\n---\nBody.\n');
    const warned = [];
    const orig = console.warn;
    console.warn = m => warned.push(String(m));
    try { scanAllNotes(dir); } finally { console.warn = orig; fs.rmSync(dir, { recursive: true, force: true }); }
    assert.ok(warned.some(w => w.includes('Mara.md') && w.includes('NOT hidden')), warned.join('\n'));
  });
});

describe('publishedFrontmatter and gm_aliases (#212)', () => {
  it('drops gm_aliases and removes them from aliases', () => {
    const out = publishedFrontmatter({ aliases: ['Vane', 'Red'], gm_aliases: ['Red', 'Crowe'] });
    assert.deepStrictEqual(out.aliases, ['Vane']);
    assert.ok(!('gm_aliases' in out));
  });

  it('drops aliases entirely when every entry is a GM alias', () => {
    const out = publishedFrontmatter({ aliases: ['Red'], gm_aliases: ['Red'] });
    assert.ok(!('aliases' in out));
  });

  it('leaves a page without gm_aliases untouched', () => {
    assert.deepStrictEqual(publishedFrontmatter({ aliases: ['Vane'] }).aliases, ['Vane']);
  });
});
