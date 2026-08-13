const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../../lib/build');

// Differential build for #139. The same vault is built twice: once with every author-typed
// reference decomposed (NFD), once with every reference precomposed (NFC). Filenames are NFC
// in both. If any comparison between a ref and a filename-derived title is normalization-
// naive, the two sites diverge — a rollup empties, a tree flattens, a recap swaps.
//
// Reading the code has now missed sites three times over; this test is the mechanical guard
// that replaces that method. It covers boundaries no lookup-table wrapper can reach (Map,
// Set, bare ===) and any new one a future template introduces.
//
// Every name is written with precomposed \u escapes, never a literal accented character, so
// the constants are NFC by construction and no editor can silently re-normalize this file.
const NPC = 'Alena Gonz\u00e1lez';
const LOC = 'Caf\u00e9 Ub\u00edquito';
const SUB = 'Caf\u00e9 Ub\u00edquito Anexo';
const FAC = 'Sociedad Ib\u00e9rica';
const ITEM = 'Reliquia \u00c1mbar';
const EVT = 'La Desaparici\u00f3n';
const CRE = 'Bestia \u00d1u';
const HER = 'Linaje \u00d3seo';
const SESS = 'Sesi\u00f3n Ren\u00e9e';
const SESS2 = 'Sesi\u00f3n Posterior';
const CHAP = 'Cap\u00edtulo Ren\u00e9e';
const CHAP2 = 'Cap\u00edtulo Segundo';
const SESS3 = 'Sesi\u00f3n Anexa';
const OLD = 'Nombre Antig\u00fco';
const DOC = 'Carta An\u00f3nima';
// Named by two districts but never published as a page: the locations index then buckets
// those districts under this raw ref rather than a resolved node.
const REGION = 'Regi\u00f3n Perdida';
const BARRIO_N = 'Barrio Norte';
const BARRIO_S = 'Barrio Sur';
const DOMAIN = 'Dominio \u00c1rtico';
const CLUE = 'Pista \u00d3rfica';
const PC = 'Rook';
const PORTRAIT = `${NPC}.png`;

function writeVault(root, refForm) {
  // R() decomposes every author-typed reference in the NFD variant. Filenames never change.
  // In MIXED, the form flips per file: a grouping key or dedupe Set built from a raw ref
  // splits one entity into two, which a uniform build can never reveal.
  let fileIndex = 0;
  let decompose = false;
  const R = s => (decompose ? s.normalize('NFD') : s.normalize('NFC'));
  const f = (rel, body) => {
    decompose = refForm === 'NFD' || (refForm === 'MIXED' && fileIndex++ % 2 === 1);
    // Filenames pinned to NFC: were they ever NFD, the "control" build would mismatch too and
    // the whole-tree comparison would pass while proving nothing.
    const p = path.join(root, rel.normalize('NFC'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  f(`_attachments/${PORTRAIT}`, 'fake-png-bytes');

  f('_Campaign/Campaign Overview.md', [
    '---', 'type: campaign_overview', 'title: "Diff Campaign"',
    'current_game_date: "1923-04-01"', 'sessions_played: 2',
    // Deliberately the EARLIER session: a failed ref match then falls back to the
    // date-latest session, which is a visible swap rather than an empty slot.
    `last_session: "[[${R(SESS)}]]"`, 'last_play_date: "2026-01-02"',
    '---', '', `The saga of [[${R(NPC)}]] at [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Chapters/${CHAP}.md`, [
    '---', 'type: chapter', `title: "${CHAP}"`, 'sort_order: 1', 'status: active',
    '---', '', '## Narrative Recap', '', `The chapter opens on [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Sessions/${SESS}.md`, [
    '---', 'type: session', 'session_number: 1', 'status: played',
    'play_date: "2026-01-02"', 'in_game_date: "1923-04-01"',
    `chapter: "[[${R(CHAP)}]]"`, `location: "[[${R(LOC)}]]"`,
    'participants:', `  - "[[${R(NPC)}]]"`, `  - "[[${R(PC)}]]"`,
    '---', '', `The party met [[${R(NPC)}]] and fought [[${R(CRE)}]].`, '',
    `They carried [[${R(ITEM)}]].`, '',
  ].join('\n'));

  f(`Sessions/${SESS2}.md`, [
    '---', 'type: session', 'session_number: 2', 'status: played',
    'play_date: "2026-02-09"', 'in_game_date: "1923-05-01"',
    `chapter: "[[${R(CHAP)}]]"`, `location: "[[${R(LOC)}]]"`,
    '---', '', 'A later, duller session with no recap heading.', '',
  ].join('\n'));

  // Outside the session folder on purpose: wrap-up pairing has a same-folder fallback in
  // three separate modules, and colocating the two would mask the ref match under test.
  f(`Chapters/${CHAP2}.md`, [
    '---', 'type: chapter', `title: "${CHAP2}"`, 'sort_order: 2', 'status: active',
    '---', '', 'A second chapter, in the same folder as its session.', '',
  ].join('\n'));

  f(`Chapters/${SESS3}.md`, [
    '---', 'type: session', 'session_number: 1', 'status: played',
    'play_date: "2026-01-05"', 'in_game_date: "1923-04-15"',
    `chapter: "[[${R(CHAP2)}]]"`,
    '---', '', 'A session filed beside its chapter.', '',
  ].join('\n'));

  f(`Wrapups/${SESS} Wrap.md`, [
    '---', 'type: session_wrap', `session: "[[${R(SESS)}]]"`,
    '---', '', '## Narrative Recap', '',
    `The wrap-up recounts [[${R(NPC)}]] escaping [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Characters/NPCs/${NPC}.md`, [
    '---', 'type: npc', `portrait: "${R(PORTRAIT)}"`,
    `location: "[[${R(LOC)}]]"`, `occupation: "Agent of [[${R(FAC)}]]"`,
    `faction: "[[${R(FAC)}]]"`, `first_appearance: "[[${R(SESS)}]]"`,
    `summary: "Seen last at [[${R(LOC)}]]"`,
    'aliases:', '  - "La Se\u00f1ora"',
    'relationships:',
    `  - target: "[[${R(FAC)}]]"`, '    type: member_of',
    `  - target: "[[${R(PC)}]]"`, '    type: ally',
    '---', '', `She keeps rooms above [[${R(LOC)}]].`, '', `![[${R(PORTRAIT)}]]`, '',
  ].join('\n'));

  f(`Characters/NPCs/${OLD}.md`, [
    '---', 'type: npc', 'canon_status: SUPERSEDED', `superseded_by: "[[${R(NPC)}]]"`,
    '---', '', 'An earlier name for the same woman.', '',
  ].join('\n'));

  f(`Characters/PCs/${PC}.md`, [
    '---', 'type: pc', 'player_name: "Ant"',
    'relationships:', `  - target: "[[${R(NPC)}]]"`, '    type: ally',
    `  - target: "[[${R(FAC)}]]"`, '    type: member_of',
    '---', '', `Rook trusts [[${R(NPC)}]].`, '',
  ].join('\n'));

  f(`Locations/${LOC}.md`, [
    '---', 'type: location', 'location_type: cafe',
    '---', '', `A smoky room. [[${R(NPC)}]] holds court here.`, '',
  ].join('\n'));

  f(`Locations/${SUB}.md`, [
    '---', 'type: location', 'location_type: room', `parent_location: "[[${R(LOC)}]]"`,
    '---', '', 'A back room.', '',
  ].join('\n'));

  f(`Locations/${BARRIO_N}.md`, [
    '---', 'type: location', 'location_type: district',
    `parent_location: "[[${R(REGION)}]]"`,
    '---', '', 'North of the river.', '',
  ].join('\n'));

  f(`Locations/${BARRIO_S}.md`, [
    '---', 'type: location', 'location_type: district',
    `parent_location: "[[${R(REGION)}]]"`,
    '---', '', 'South of the river.', '',
  ].join('\n'));

  f(`Factions/${FAC}.md`, [
    '---', 'type: faction', 'faction_type: society',
    `leadership: "[[${R(NPC)}]]"`, `territory: "[[${R(LOC)}]]"`,
    '---', '', `They meet at [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Items/${ITEM}.md`, [
    '---', 'type: item', 'item_type: relic',
    `current_holder: "[[${R(NPC)}]]"`, `origin: "[[${R(LOC)}]]"`,
    '---', '', `Taken from [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Events/${EVT}.md`, [
    '---', 'type: event', 'event_type: disappearance', 'in_game_date: "1923-03-30"',
    `location: "[[${R(LOC)}]]"`, 'participants:', `  - "[[${R(NPC)}]]"`,
    '---', '', `Everyone at [[${R(LOC)}]] saw it.`, '',
  ].join('\n'));

  f(`Creatures/${CRE}.md`, [
    '---', 'type: creature', 'creature_type: beast', `location: "[[${R(LOC)}]]"`,
    'relationships:', `  - target: "[[${R(NPC)}]]"`, '    type: hunted_by',
    '---', '', `It stalks [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Heritages/${HER}.md`, [
    '---', 'type: heritage',
    'relationships:', `  - target: "[[${R(NPC)}]]"`, '    type: ancestor_of',
    '---', '', `Bloodline of [[${R(NPC)}]].`, '',
  ].join('\n'));

  f(`World/${DOMAIN}.md`, [
    '---', 'type: world_domain', `summary: "Beyond [[${R(LOC)}]]"`,
    'relationships:', `  - target: "[[${R(NPC)}]]"`, '    type: known_to',
    '---', '', `Ice fields north of [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Clues/${CLUE}.md`, [
    '---', 'type: clue', `location: "[[${R(LOC)}]]"`,
    'relationships:', `  - target: "[[${R(NPC)}]]"`, '    type: points_to',
    '---', '', `Found at [[${R(LOC)}]], in the hand of [[${R(NPC)}]].`, '',
  ].join('\n'));

  f(`Characters/PCs/${PC}_Story.md`, [
    '---', 'type: character-story',
    '---', '', `Rook's tale begins with [[${R(NPC)}]] at [[${R(LOC)}]].`, '',
  ].join('\n'));

  f(`Documents/${DOC}.md`, [
    '---', 'type: document',
    '---', '', `Addressed to [[${R(NPC)}]] care of [[${R(LOC)}]].`, '',
  ].join('\n'));
}

function buildVariant(refForm) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `unicode-refs-${refForm}-`));
  const vault = path.join(work, 'vault');
  const docs = path.join(work, 'docs');
  writeVault(vault, refForm);
  const configPath = path.join(work, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    vaultPath: vault, outputDir: docs, attachmentsDir: '_attachments',
    siteTitle: 'Diff Campaign', siteUrl: 'https://example.github.io/diff',
    excludeDirs: ['_meta', '_Templates'],
    folderMap: {
      _Campaign: 'campaign', Chapters: 'chapters', Sessions: 'sessions', Wrapups: 'wrapups',
      'Characters/PCs': 'characters/pcs', 'Characters/NPCs': 'characters/npcs',
      Locations: 'locations', Factions: 'factions', Items: 'items',
      Events: 'events', Creatures: 'creatures', Heritages: 'heritages', Documents: 'documents',
      World: 'world', Clues: 'clues',
    },
  }));
  const origLog = console.log, origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { build({ configPath }); } finally { console.log = origLog; console.warn = origWarn; }
  return { work, docs };
}

function readTree(dir) {
  const out = new Map();
  (function walk(d, base) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.posix.join(base, e.name);
      if (e.isDirectory()) walk(full, rel);
      // Content is compared NFC-normalized: a page that merely echoes the raw ref text is
      // not a defect, so only structural and content divergence survives the comparison.
      else if (/\.(html|json)$/.test(e.name)) {
        out.set(rel.normalize('NFC'), fs.readFileSync(full, 'utf8').normalize('NFC'));
      }
    }
  })(dir, '');
  return out;
}

describe('build with NFD refs against NFC filenames (#139)', () => {
  let nfd, nfc, mixed, treeNfd, treeNfc, treeMixed;
  const read = rel => treeNfd.get(rel);

  before(() => {
    nfd = buildVariant('NFD');
    nfc = buildVariant('NFC');
    mixed = buildVariant('MIXED');
    treeNfd = readTree(nfd.docs);
    treeNfc = readTree(nfc.docs);
    treeMixed = readTree(mixed.docs);
  });

  after(() => {
    for (const v of [nfd, nfc, mixed]) fs.rmSync(v.work, { recursive: true, force: true });
  });

  function diffAgainstControl(tree) {
    const keys = [...new Set([...tree.keys(), ...treeNfc.keys()])].sort();
    return keys.filter(k => tree.get(k) !== treeNfc.get(k));
  }

  it('produces a byte-identical site whichever normal form every ref uses', () => {
    const differing = diffAgainstControl(treeNfd);
    assert.deepStrictEqual(differing, [], `these outputs depend on the refs' normal form: ${differing.join(', ')}`);
  });

  it('produces a byte-identical site when the two forms are mixed within one vault', () => {
    const differing = diffAgainstControl(treeMixed);
    assert.deepStrictEqual(differing, [], `these outputs split one entity in two when forms are mixed: ${differing.join(', ')}`);
  });

  it('renders the shared parent region once, not once per spelling', () => {
    const html = read('locations/index.html');
    const headings = (treeMixed.get('locations/index.html').match(/loc-region-title/g) || []).length;
    const control = (html.match(/loc-region-title/g) || []).length;
    assert.strictEqual(headings, control, 'mixed-form vault produced a different number of region headings');
  });

  // Per-page assertions on the NFD build. The whole-tree check above proves "no divergence";
  // these name the feature that breaks, so a failure points at the site rather than the page.
  it('lists sub-locations under their parent ("Places Within")', () => {
    assert.match(read('locations/cafe-ubiquito.html'), /Places Within/);
  });

  it('lists NPCs at their location ("Known Figures")', () => {
    assert.match(read('locations/cafe-ubiquito.html'), /Known Figures/);
  });

  it('lists events at their location ("What Happened Here")', () => {
    assert.match(read('locations/cafe-ubiquito.html'), /What Happened Here/);
  });

  it('rolls up faction members from relationship targets', () => {
    assert.match(read('factions/sociedad-iberica.html'), /<h3>Members<\/h3>/);
  });

  it('nests a child location under its parent in the locations index', () => {
    assert.match(read('locations/index.html'), /loc-children/);
  });

  it('features the session the overview names, not the date-latest one', () => {
    const html = read('index.html');
    assert.match(html, /The wrap-up recounts/, 'landing recap did not come from the named session\'s wrap-up');
    assert.doesNotMatch(html, /duller session/, 'landing fell back to a different session entirely');
  });

  it('groups sessions under their chapter on the chapters index', () => {
    const html = read('chapters/index.html');
    const grouped = /<ol class="chapter-sessions">[\s\S]*?sesion-anexa\.html[\s\S]*?<\/ol>/.test(html);
    assert.ok(grouped, 'session was not listed inside its chapter card');
    assert.doesNotMatch(html, /Other Sessions/, 'session fell through to the ungrouped list');
  });
});
