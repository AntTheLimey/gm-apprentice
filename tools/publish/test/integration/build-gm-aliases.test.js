const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');
const { publishedFrontmatter, gmAliasList, gmAliasRewriter } = require('../../lib/processor');

// #212: a `gm_aliases` entry resolves links to its page but its text never
// reaches the site: not the search index, not the portrait alt text, not the
// frontmatter meta, and not the text of a link written with it.
const SECRET = 'Elias Crowe';
const OBSIDIAN_SECRET = 'The Crimson Hand';
// A second secret used to exercise the piped-label leak: Obsidian
// autocomplete writes `[[<public name>|<secret name>]]` when a GM lists the
// same secret in both `aliases` and `gm_aliases` (per entity-schema.md).
const PIPED_SECRET = 'The Gilded Serpent';
// A secret declared as a bare string (`gm_aliases: <name>`) rather than a
// YAML list, which older/hand-edited frontmatter can produce.
const SCALAR_SECRET = 'The Hollow King';

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
    // `PIPED_SECRET` is listed the same way — that's what makes Obsidian
    // autocomplete offer it as a LABEL for a link whose target is the public name.
    `aliases: [Vane, "${OBSIDIAN_SECRET}", "${PIPED_SECRET}"]`,
    `gm_aliases: ["${SECRET}", "${OBSIDIAN_SECRET}", "${PIPED_SECRET}", "Red Hand"]`,
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
    // The Obsidian-autocomplete leak: target is Lord Vane's PUBLIC name, but the
    // label is his secret name, because autocomplete offered it from `aliases`.
    `Once she nearly said [[Lord Vane|${PIPED_SECRET}]] aloud.`,
    // Mentions the scalar-secret owner by its public name so the built page also
    // proves that owner claims and hides a `gm_aliases` string (not a list).
    `She trusts [[Old Mercer]] more than most.`,
    '',
  ].join('\n'));
  f('Characters/NPCs/Old Mercer.md', [
    '---', 'type: npc', 'status: alive',
    // A scalar, not a list: hand-edited or older frontmatter can write it this way.
    `gm_aliases: "${SCALAR_SECRET}"`,
    '---', '', 'A retired locksmith.', '',
  ].join('\n'));
  f('Characters/NPCs/Beck.md', [
    '---', 'type: npc', 'status: alive', '---', '',
    `Beck once called him [[${SCALAR_SECRET}]] by mistake.`,
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
      assert.ok(!text.includes(PIPED_SECRET), `${rel} contains "${PIPED_SECRET}"`);
      assert.ok(!text.includes(SCALAR_SECRET), `${rel} contains "${SCALAR_SECRET}"`);
      assert.ok(!/crowe|weaver|veiled|red hand|gilded serpent|hollow king/i.test(text),
        `${rel} contains a spelling of a GM alias`);
    }
  });

  it('drops a secret label piped onto the target\'s public name (#leak-piped-label)', () => {
    const ada = pageFor('Ada Marsh');
    // Obsidian wrote `[[Lord Vane|The Gilded Serpent]]`: the target already
    // resolves to Lord Vane's own public page, so the link must still point
    // there — only the secret LABEL is the thing that must disappear.
    assert.match(ada, /Once she nearly said <a href="lord-vane\.html">Lord Vane<\/a> aloud\./);
  });

  it('hides a scalar gm_aliases value (string, not a list)', () => {
    const beck = pageFor('Beck');
    assert.match(beck, /Beck once called him <a href="old-mercer\.html">Old Mercer<\/a> by mistake\./);
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

describe('gmAliasList and a scalar gm_aliases', () => {
  it('treats a bare string as a one-item list', () => {
    assert.deepStrictEqual(gmAliasList({ gm_aliases: SCALAR_SECRET }), [SCALAR_SECRET]);
  });

  it('trims a scalar and drops it if blank', () => {
    assert.deepStrictEqual(gmAliasList({ gm_aliases: `  ${SCALAR_SECRET}  ` }), [SCALAR_SECRET]);
    assert.deepStrictEqual(gmAliasList({ gm_aliases: '   ' }), []);
  });

  it('still returns [] for absent or non-string/array gm_aliases', () => {
    assert.deepStrictEqual(gmAliasList({}), []);
    assert.deepStrictEqual(gmAliasList({ gm_aliases: 42 }), []);
  });

  it('publishedFrontmatter hides a scalar gm_aliases and strips it from aliases', () => {
    const out = publishedFrontmatter({ aliases: ['Mercer', SCALAR_SECRET], gm_aliases: SCALAR_SECRET });
    assert.deepStrictEqual(out.aliases, ['Mercer']);
    assert.ok(!('gm_aliases' in out));
  });
});

describe('gmAliasRewriter and a piped secret label', () => {
  const owner = {
    title: 'Lord Vane',
    displayTitle: 'Lord Vane',
    frontmatter: { aliases: ['Vane', PIPED_SECRET], gm_aliases: [PIPED_SECRET] },
  };
  const bystander = { title: 'Ada Marsh', displayTitle: 'Ada Marsh', frontmatter: {} };

  it('drops a secret label piped onto the owner\'s own public target', () => {
    const rw = gmAliasRewriter([owner, bystander]);
    const out = rw.markdown(`She said [[Lord Vane|${PIPED_SECRET}]] aloud.`);
    assert.ok(!out.includes(PIPED_SECRET), out);
    assert.match(out, /\[\[Lord Vane\]\]/);
  });

  it('drops a secret label piped onto the secret alias itself', () => {
    const rw = gmAliasRewriter([owner, bystander]);
    const out = rw.markdown(`She said [[${PIPED_SECRET}|${PIPED_SECRET}]] aloud.`);
    assert.ok(!out.includes(PIPED_SECRET), out);
    assert.match(out, /\[\[Lord Vane\]\]/);
  });

  it('keeps a normal, non-secret label untouched', () => {
    const rw = gmAliasRewriter([owner, bystander]);
    const out = rw.markdown(`She said [[Lord Vane|a courtly patron]] aloud.`);
    assert.match(out, /\[\[Lord Vane\|a courtly patron\]\]/);
  });

  it('drops a secret label belonging to a different page than the target', () => {
    const rw = gmAliasRewriter([owner, bystander]);
    const out = rw.markdown(`She said [[Ada Marsh|${PIPED_SECRET}]] aloud.`);
    assert.ok(!out.includes(PIPED_SECRET), out);
    // The target isn't itself a known alias owner, so it's shown bare.
    assert.match(out, /\[\[Ada Marsh\]\]/);
  });

  it('scalar gm_aliases also feeds the rewriter', () => {
    const scalarOwner = { title: 'Old Mercer', displayTitle: 'Old Mercer', frontmatter: { gm_aliases: SCALAR_SECRET } };
    const rw = gmAliasRewriter([scalarOwner, bystander]);
    const out = rw.markdown(`Beck called him [[${SCALAR_SECRET}]] by mistake.`);
    assert.ok(!out.includes(SCALAR_SECRET), out);
    assert.match(out, /\[\[Old Mercer\]\]/);
  });
});
