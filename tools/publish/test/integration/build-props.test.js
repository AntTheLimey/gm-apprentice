'use strict';
// The player site publishes a prop's own page beside its note: the files ship cut, the note
// page links the prop, the prop page has a bar back, and what cannot ship is a warning.
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../../lib/build');
const { buildBoth, allFiles } = require('../helpers/gm-build');
const { listFileText } = require('../helpers/publish-list');
const { takenAddresses } = require('../../lib/props/address');
const { propBar, withPropBar, propLinkHtml } = require('../../lib/templates/prop-bar');
const { propHrefFor, propOutputs } = require('../../lib/props/files');
const { runSiteDoctor } = require('../../lib/site-doctor');
const { summaryLines } = require('../../lib/note-faults');

const PROP = (extra = '') => `---\ntype: prop\nprop_file: invitation.html\n${extra}---\nAn invitation to the ball.\n`;
const PAGE = [
  '<!doctype html><html><head><link rel="stylesheet" href="props.css"></head>',
  '<body class="paper"><h1>You are invited</h1><img src="assets/paper.jpg">',
  '<!-- gm-only --><div>KEEPER ONLY</div><img src="assets/secret.jpg"><!-- /gm-only -->',
  '<!-- note to self -->',
  '<script>document.title = "Invitation";</script>',
  '</body></html>',
].join('\n');
const PROP_FILES = {
  'Documents/invitation.html': PAGE,
  'Documents/props.css': 'body { background: url(assets/paper.jpg); }\n',
  'Documents/assets/paper.jpg': 'JPEGBYTES',
  'Documents/assets/secret.jpg': 'SECRETBYTES',
};
const rels = (s) => s.player.files().map((f) => path.relative(s.player.dir, f).split(path.sep).join('/'));
const quietly = async (fn) => {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};
const quiet = (fn) => {
  const saved = { log: console.log, warn: console.warn };
  const lines = [];
  console.log = (m) => lines.push(String(m)); console.warn = (m) => lines.push(String(m));
  try { fn(); } finally { Object.assign(console, saved); }
  return lines;
};

describe('the prop bar and link', () => {
  it('goes after <body>, else after </head>, else at the start', () => {
    assert.equal(withPropBar('<html><body class="x">A</body></html>', 'BAR'), '<html><body class="x">BARA</body></html>');
    assert.equal(withPropBar('<head></head>A', 'BAR'), '<head></head>BARA');
    assert.equal(withPropBar('A', 'BAR'), 'BARA');
    assert.equal(withPropBar('<body onload="a>b" class=\'c>d\'>A', 'BAR'), '<body onload="a>b" class=\'c>d\'>BARA');
  });
  it('links the note, hides when printed, and the note links the prop', () => {
    const bar = propBar({ noteHref: '../documents/invitation.html', noteTitle: 'The <Invitation>', collectionHref: null });
    assert.match(bar, /^<nav class="gma-prop-bar"/);
    assert.match(bar, /<a href="\.\.\/documents\/invitation\.html">&larr; The &lt;Invitation&gt;<\/a>/);
    assert.match(bar, /@media print\{\.gma-prop-bar\{display:none\}\}/);
    assert.equal(propBar({ noteHref: null, noteTitle: 'X', collectionHref: null }), '');
    assert.equal(propLinkHtml('../props/a.html'), '<p class="prop-link"><a class="prop-btn" href="../props/a.html">See the prop</a></p>');
  });
});

describe('a published prop', () => {
  const s = buildBoth({ 'Documents/Invitation.md': PROP(), ...PROP_FILES }, { sites: ['player'] });
  after(() => s.cleanup());

  it("a published prop's page, stylesheet and picture are on the site", () => {
    assert.ok(s.player.exists('props', 'invitation.html'));
    assert.equal(s.player.read('props', 'props.css'), PROP_FILES['Documents/props.css']);
    assert.equal(s.player.read('props', 'assets', 'paper.jpg'), 'JPEGBYTES');
    const note = s.player.read('documents', 'invitation.html');
    assert.match(note, /<a class="prop-btn" href="\.\.\/props\/invitation\.html">See the prop<\/a>/);
  });

  it('the gm-only part and every comment are cut', () => {
    const page = s.player.read('props', 'invitation.html');
    assert.doesNotMatch(page, /KEEPER ONLY|gm-only|note to self|<!--/);
    assert.match(page, /<body class="paper"><nav class="gma-prop-bar"/);
    assert.match(page, /<a href="\.\.\/documents\/invitation\.html">&larr; Invitation<\/a>/);
  });

  it("a gm-only picture's file is not on the site", () => {
    assert.ok(!rels(s).some((f) => /secret/.test(f)), rels(s).join(', '));
    for (const f of s.player.files()) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /SECRETBYTES/, f);
  });

  it('a script in a hand-made page ships as written', () => {
    assert.match(s.player.read('props', 'invitation.html'), /<script>document\.title = "Invitation";<\/script>/);
  });
});

describe('props that do not ship', () => {
  it('a prop whose note is not published ships nothing', () => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP(), 'Documents/Other.md': '---\ntype: document\n---\nOther.\n', ...PROP_FILES,
      '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Other.md'] }),
    }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('documents', 'other.html'));
      assert.ok(!s.player.exists('props'));
      assert.ok(!rels(s).some((f) => /props\.css|paper\.jpg|invitation/.test(f)), rels(s).join(', '));
    } finally { s.cleanup(); }
  });

  it("a stub note's prop ships nothing", () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP('publish: stub\n'), ...PROP_FILES }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('documents', 'invitation.html'));
      assert.doesNotMatch(s.player.read('documents', 'invitation.html'), /prop-link/);
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });

  it('a document note without prop_file is unchanged', () => {
    const s = buildBoth({ 'Documents/Letter.md': '---\ntype: document\n---\nA letter.\n' }, { sites: ['player'] });
    try {
      assert.doesNotMatch(s.player.read('documents', 'letter.html'), /prop-link/);
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });

  it('a Dead End reference note with prop: and prop_look: is not a prop', () => {
    const s = buildBoth({
      'Reference/Crate.md': '---\ntype: item\nprop: crate.html\nprop_look: battered\n---\nA crate.\n',
      'Reference/crate.html': '<p>crate</p>',
    }, { sites: ['player'] });
    try {
      assert.doesNotMatch(s.player.read('reference', 'crate.html'), /prop-link/);
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });
});

describe('what cannot ship is a warning', () => {
  it('a ../ link is reported, not copied', () => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP(), 'Documents/invitation.html': '<body><img src="../up.png"></body>', 'up.png': 'UP',
    }, { sites: ['player'] });
    try {
      assert.ok(s.logs.some((l) => /WARNING: Documents\/Invitation\.md: invitation\.html links "\.\.\/up\.png", which is outside its folder — /.test(l)), s.logs.join('\n'));
      assert.ok(s.player.exists('props', 'invitation.html'));
      assert.ok(!rels(s).some((f) => /up\.png/.test(f)));
    } finally { s.cleanup(); }
  });

  it('a missing prop file: the note page publishes with no link and a warning', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP() }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('documents', 'invitation.html'));
      assert.doesNotMatch(s.player.read('documents', 'invitation.html'), /prop-link/);
      assert.ok(s.logs.some((l) => /WARNING: Documents\/Invitation\.md: the prop file "invitation\.html" is not in Documents/.test(l)), s.logs.join('\n'));
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });

  it('an address on a page is refused and the page is untouched', () => {
    const s = buildBoth({
      'Documents/Letter.md': '---\ntype: document\n---\nTHE NOTE PAGE.\n',
      'Documents/Invitation.md': PROP('prop_address: documents/letter.html\n'), ...PROP_FILES,
    }, { sites: ['player'] });
    try {
      assert.match(s.player.read('documents', 'letter.html'), /THE NOTE PAGE\./);
      assert.doesNotMatch(s.player.read('documents', 'letter.html'), /You are invited/);
      assert.ok(s.logs.some((l) => /its address documents\/letter\.html is taken by a page the site builds/.test(l)), s.logs.join('\n'));
      assert.doesNotMatch(s.player.read('documents', 'invitation.html'), /prop-link/);
    } finally { s.cleanup(); }
  });

  it('each problem is a PROP_NOT_COPIED note fault', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP() }, { sites: [] });
    try {
      let faults = null;
      quiet(() => build({ configPath: s.configPath, site: 'player', inMemory: true, onNoteFaults: (f) => { faults = f; } }));
      const mine = faults.filter((f) => f.code === 'PROP_NOT_COPIED');
      assert.equal(mine.length, 1, JSON.stringify(faults));
      assert.equal(mine[0].severity, 'warning');
      assert.equal(mine[0].path, 'Documents/Invitation.md');
    } finally { s.cleanup(); }
  });
});

describe('PROP_NOT_COPIED in the doctor and the summary', () => {
  it('doctor --site reports PROP_NOT_COPIED', async () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP() }, { sites: [] });
    try {
      const out = [];
      await quietly(() => runSiteDoctor({ configPath: s.configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null }));
      const mine = JSON.parse(out.join('\n')).findings.filter((f) => f.code === 'PROP_NOT_COPIED');
      assert.equal(mine.length, 1, out.join('\n'));
      assert.equal(mine[0].severity, 'warning');
      assert.equal(mine[0].path, 'Documents/Invitation.md');
      assert.match(mine[0].detail, /the prop file "invitation\.html" is not in Documents/);
      assert.equal(mine[0].fix, 'put the file beside the note, or correct prop_file');
    } finally { s.cleanup(); }
  });

  it('the build summary counts the props and names the worst three notes', () => {
    const row = (p) => ({ code: 'PROP_NOT_COPIED', severity: 'warning', path: p, detail: 'd', fix: 'f' });
    assert.deepEqual(summaryLines([row('Documents/A.md')]),
      ["1 prop file could not be put on the site (A) — campaign-qa's Site Faults check fixes it."]);
    assert.deepEqual(summaryLines(['A', 'B', 'C', 'D'].map((n) => row(`Documents/${n}.md`))),
      ["4 prop files could not be put on the site (A, B, C) — campaign-qa's Site Faults check fixes these."]);
  });

  it('the build prints the summary line', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP() }, { sites: ['player'] });
    try {
      assert.ok(s.logs.includes("  WARNING: 1 prop file could not be put on the site (Invitation) — campaign-qa's Site Faults check fixes it."), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
});

describe('other kinds of prop', () => {
  it('a PDF prop is copied as is and linked', () => {
    const pdf = '%PDF-1.4\n<!-- gm-only -->not cut in a PDF<!-- /gm-only -->\n';
    const s = buildBoth({
      'Documents/Invitation.md': '---\ntype: prop\nprop_file: invitation.pdf\n---\nA letter.\n', 'Documents/invitation.pdf': pdf,
    }, { sites: ['player'] });
    try {
      assert.equal(s.player.read('props', 'invitation.pdf'), pdf);
      assert.match(s.player.read('documents', 'invitation.html'), /href="\.\.\/props\/invitation\.pdf">See the prop/);
    } finally { s.cleanup(); }
  });

  it('a prop with no prop_file publishes its note page only', () => {
    const s = buildBoth({ 'Documents/Invitation.md': '---\ntype: prop\n---\nA letter.\n' }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('documents', 'invitation.html'));
      assert.doesNotMatch(s.player.read('documents', 'invitation.html'), /prop-link/);
      assert.ok(!s.player.exists('props'));
      assert.ok(!s.logs.some((l) => /Invitation/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
});

describe('kept folders', () => {
  const setup = (address) => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP(address ? `prop_address: ${address}\n` : ''), ...PROP_FILES }, { sites: [], player: { keep: ['gazetteer'] } });
    fs.mkdirSync(path.join(s.player.dir, 'gazetteer'), { recursive: true });
    fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
    return s;
  };

  it('an explicit address inside a kept folder replaces the kept file and says so', () => {
    const s = setup('gazetteer/invitation.html');
    try {
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.match(s.player.read('gazetteer', 'invitation.html'), /You are invited/);
      assert.ok(lines.includes('  wrote gazetteer/invitation.html'), lines.join('\n'));
      assert.ok(lines.includes('  replaces kept file: gazetteer/invitation.html'), lines.join('\n'));
      assert.ok(lines.includes('Props: 1 published (3 files)'), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  it('an explicit address inside a kept folder with no file there only says it wrote', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP('prop_address: gazetteer/invitation.html\n'), ...PROP_FILES }, { sites: [], player: { keep: ['gazetteer'] } });
    try {
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.match(s.player.read('gazetteer', 'invitation.html'), /You are invited/);
      assert.ok(lines.includes('  wrote gazetteer/invitation.html'), lines.join('\n'));
      assert.ok(!lines.some((l) => /replaces kept file/.test(l)), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  it('a default address inside a kept folder is refused', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP(), ...PROP_FILES }, { sites: [], player: { keep: ['props'] } });
    try {
      fs.mkdirSync(path.join(s.player.dir, 'props'), { recursive: true });
      fs.writeFileSync(path.join(s.player.dir, 'props', 'invitation.html'), 'MINE');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(s.player.read('props', 'invitation.html'), 'MINE');
      assert.ok(!s.player.exists('props', 'props.css'));
      assert.ok(lines.some((l) => /WARNING: Documents\/Invitation\.md: its address props\/invitation\.html is taken by the kept folder props/.test(l)), lines.join('\n'));
    } finally { s.cleanup(); }
  });
});

describe('a withheld name in a prop', () => {
  it('in a prop page or in a file name is a fault of the note', () => {
    const s = buildBoth({
      'NPCs/Lord Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nSecret.\n',
      'Documents/Invitation.md': PROP(),
      'Documents/invitation.html': '<body><p>From Lord Zorn, with love.</p></body>',
      'Documents/Gift.md': '---\ntype: prop\nprop_file: gift.html\n---\nA gift.\n',
      'Documents/gift.html': '<body><img src="lord-zorn.png"></body>',
      'Documents/lord-zorn.png': 'PNG',
    }, { sites: [] });
    try {
      let faults = null;
      quiet(() => build({ configPath: s.configPath, site: 'player', inMemory: true, onNoteFaults: (f) => { faults = f; } }));
      const paths = new Set(faults.filter((f) => /Lord Zorn/.test(JSON.stringify(f))).map((f) => f.path));
      assert.ok(paths.has('Documents/Invitation.md'), JSON.stringify(faults, null, 1));
      assert.ok(paths.has('Documents/Gift.md'), JSON.stringify(faults, null, 1));
    } finally { s.cleanup(); }
  });
});

describe('a sheets-only build', () => {
  it('plans nothing and writes nothing', () => {
    const s = buildBoth({ 'PCs/Ann.md': '---\ntype: pc\n---\n# Ann\n', 'Documents/Invitation.md': PROP(), ...PROP_FILES }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('props', 'invitation.html'));
      fs.rmSync(path.join(s.player.dir, 'props'), { recursive: true, force: true });
      fs.rmSync(path.join(s.root, 'vault', 'Documents', 'props.css'));   // a problem a full build would report
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player', only: 'sheets' }));
      assert.ok(!s.player.exists('props'));
      assert.ok(!lines.some((l) => /Props:|props\.css|Invitation/.test(l)), lines.join('\n'));
    } finally { s.cleanup(); }
  });
});

describe('every file a build writes is a taken address', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-props-taken-'));
  after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  it('the reserved files and folders cover the site the build writes', () => {
    const configPath = path.join(outputDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      vaultPath: path.join(fixturesDir, 'redesign-full'), outputDir: path.join(outputDir, 'docs'), attachmentsDir: '_attachments',
      siteTitle: 'Redesign Test', siteUrl: 'https://example.github.io/redesign-test', searchEnabled: true,
      excludeDirs: ['_meta', '_Templates'], excludeSections: [],
      folderMap: { 'Characters/PCs': 'characters/pcs', 'Characters/NPCs': 'characters/npcs', Locations: 'locations', Events: 'events', Sessions: 'sessions', Factions: 'factions' },
    }));
    quiet(() => build({ configPath }));
    const docs = path.join(outputDir, 'docs');
    const written = allFiles(docs).map((f) => path.relative(docs, f).split(path.sep).join('/')).filter((f) => !f.startsWith('props/'));
    const taken = takenAddresses({});
    const checked = written.filter((f) => (!f.includes('/') && /\.(?:html|json)$/.test(f)) || /^(?:css|js|images|fonts|story)\//.test(f));
    assert.ok(checked.length > 10, checked.join(', '));
    for (const f of checked) assert.ok(taken.has(f), `${f} is written by the build but is not a taken address`);
  });
});

describe('a prop file whose bytes the plan does not hold', () => {
  it('is not linked from its note, and is a PROP_NOT_COPIED row', () => {
    // A plan made without the bytes (the file could not be read when it was written): nothing of it is written.
    const page = { outputPath: 'documents/invitation.html', displayTitle: 'Invitation' };
    const plan = { props: [{ rel: 'Documents/Invitation.md', page, ships: true, address: 'props/invitation.html', files: [{ source: '/nowhere', out: 'props/invitation.html', cut: true }] }], problems: [] };
    assert.equal(propHrefFor(plan, page), null);
    const { outputs, failed } = propOutputs(plan);
    assert.deepEqual(outputs, []);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, 'PROP_NOT_COPIED');
    assert.equal(failed[0].rel, 'Documents/Invitation.md');
  });

  it('the file is read once, by the plan: a change after planning is not what is written', () => {
    // The bytes written are the bytes the plan read and cut, never a second read of the vault.
    const s = buildBoth({ 'Documents/Invitation.md': PROP(), ...PROP_FILES }, { sites: [] });
    try {
      const { planProps } = require('../../lib/props/plan');
      const vault = path.join(s.root, 'vault');
      const note = { sourcePath: path.join(vault, 'Documents', 'Invitation.md'), outputPath: 'documents/invitation.html', displayTitle: 'Invitation', frontmatter: { type: 'prop', prop_file: 'invitation.html' } };
      const plan = planProps({ vaultPath: vault, pages: [note], relOf: () => 'Documents/Invitation.md', ships: () => true, taken: takenAddresses(), cutKeeper: true });
      fs.writeFileSync(path.join(vault, 'Documents', 'invitation.html'), '<body>CHANGED</body>');
      const page = propOutputs(plan).outputs.find((o) => o.out === 'props/invitation.html');
      assert.match(page.text, /You are invited/);
      assert.doesNotMatch(page.text, /CHANGED/);
    } finally { s.cleanup(); }
  });
});

describe('an in-memory build', () => {
  it('writes no props/', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP(), ...PROP_FILES }, { sites: [] });
    try {
      quiet(() => build({ configPath: s.configPath, site: 'player', inMemory: true }));
      assert.ok(!s.player.exists('props'));
      assert.ok(!s.player.exists('documents'));
    } finally { s.cleanup(); }
  });
});

describe('a kept-folder prop that stops shipping', () => {
  const LIST = (publishing) => listFileText({ publishing });
  const setup = (fm = '', listed = true) => buildBoth({
    'Documents/Invitation.md': PROP(`prop_address: gazetteer/invitation.html\n${fm}`), ...PROP_FILES,
    'Documents/Other.md': '---\ntype: document\n---\nOther.\n',
    '_meta/publish-list.yaml': LIST(listed ? ['Documents/Invitation.md', 'Documents/Other.md'] : ['Documents/Other.md']),
  }, { sites: ['player'], player: { keep: ['gazetteer'] } });
  const unlist = (s) => fs.writeFileSync(path.join(s.root, 'vault', '_meta', 'publish-list.yaml'), LIST(['Documents/Other.md']));
  const KEPT = ['gazetteer/invitation.html', 'gazetteer/props.css', 'gazetteer/assets/paper.jpg'];

  it('a kept-folder prop unpublished later is removed on the next build', () => {
    const s = setup();
    try {
      for (const f of KEPT) assert.ok(s.player.exists(...f.split('/')), f);
      unlist(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) {
        assert.ok(!s.player.exists(...f.split('/')), f);
        assert.ok(lines.includes(`  removed from kept folder: ${f} (its prop is not published)`), lines.join('\n'));
      }
      assert.ok(s.player.exists('gazetteer', 'assets'), 'a folder is never removed');
    } finally { s.cleanup(); }
  });

  it("a GM's own file at that address is not deleted", () => {
    const s = setup();
    try {
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
      unlist(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(s.player.read('gazetteer', 'invitation.html'), 'MINE');
      assert.ok(!lines.some((l) => /removed from kept folder: gazetteer\/invitation\.html/.test(l)), lines.join('\n'));
      assert.ok(!s.player.exists('gazetteer', 'props.css'));
    } finally { s.cleanup(); }
  });

  it("a stub note's kept-folder prop is removed too", () => {
    const s = setup();
    try {
      const note = path.join(s.root, 'vault', 'Documents', 'Invitation.md');
      fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace('---\nAn invitation', 'publish: stub\n---\nAn invitation'));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) assert.ok(!s.player.exists(...f.split('/')), f);
      assert.ok(lines.includes('  removed from kept folder: gazetteer/invitation.html (its prop is not published)'), lines.join('\n'));
      assert.ok(s.player.exists('documents', 'invitation.html'));
    } finally { s.cleanup(); }
  });

  it('a published prop leaves props/ when it is unpublished', () => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP(), ...PROP_FILES, 'Documents/Other.md': '---\ntype: document\n---\nOther.\n',
      '_meta/publish-list.yaml': LIST(['Documents/Invitation.md', 'Documents/Other.md']),
    }, { sites: ['player'] });
    try {
      assert.ok(s.player.exists('props', 'invitation.html'));
      unlist(s);
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!s.player.exists('props'));
    } finally { s.cleanup(); }
  });
});

describe('a link on a prop path in the site folder', () => {
  const OUTSIDE_PAGE = '<body>THE GM OWN PAGE</body>';
  // A kept folder that is a link to a folder outside the site (standing in for the vault).
  const linked = (fm, { sub = false, listed = true } = {}) => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP(`prop_address: gazetteer/papers/invitation.html\n${fm}`), ...PROP_FILES,
      'Documents/Other.md': '---\ntype: document\n---\nOther.\n',
      '_meta/publish-list.yaml': listFileText({ publishing: listed ? ['Documents/Invitation.md', 'Documents/Other.md'] : ['Documents/Other.md'] }),
    }, { sites: [], player: { keep: ['gazetteer'] } });
    const outside = path.join(s.root, 'outside');
    fs.mkdirSync(path.join(outside, 'papers'), { recursive: true });
    fs.mkdirSync(s.player.dir, { recursive: true });
    if (sub) {
      fs.mkdirSync(path.join(s.player.dir, 'gazetteer'));
      fs.symlinkSync(path.join(outside, 'papers'), path.join(s.player.dir, 'gazetteer', 'papers'));
    } else {
      fs.symlinkSync(outside, path.join(s.player.dir, 'gazetteer'));
    }
    return { s, outside };
  };

  for (const sub of [false, true]) {
    const where = sub ? 'a linked folder inside a kept folder' : 'a kept folder that is a link';
    it(`${where}: a shipping prop is not written through it`, () => {
      const { s, outside } = linked('', { sub });
      try {
        fs.writeFileSync(path.join(outside, 'papers', 'invitation.html'), OUTSIDE_PAGE);
        let faults = null;
        const lines = quiet(() => build({ configPath: s.configPath, site: 'player', onNoteFaults: (f) => { faults = f; } }));
        assert.equal(fs.readFileSync(path.join(outside, 'papers', 'invitation.html'), 'utf8'), OUTSIDE_PAGE);
        assert.deepEqual(fs.readdirSync(path.join(outside, 'papers')), ['invitation.html']);
        assert.ok(!lines.some((l) => /wrote gazetteer/.test(l)), lines.join('\n'));
        assert.ok(faults.some((f) => f.code === 'PROP_NOT_COPIED' && f.path === 'Documents/Invitation.md' && /is a link/.test(f.detail)), JSON.stringify(faults));
        assert.doesNotMatch(s.player.read('documents', 'invitation.html'), /prop-link/);
      } finally { s.cleanup(); }
    });

    it(`${where}: an in-memory build (the doctor's) raises the same row, and touches nothing`, () => {
      const { s, outside } = linked('', { sub });
      try {
        let faults = null;
        quiet(() => build({ configPath: s.configPath, site: 'player', inMemory: true, onNoteFaults: (f) => { faults = f; } }));
        assert.deepEqual(fs.readdirSync(path.join(outside, 'papers')), []);
        const mine = faults.filter((f) => f.code === 'PROP_NOT_COPIED');
        assert.ok(mine.length > 0 && mine.every((f) => f.path === 'Documents/Invitation.md'), JSON.stringify(faults));
        assert.match(mine[0].detail, /gazetteer\/papers\/invitation\.html was not written: a folder on its path in the site folder is a link/);
        let full = null;
        quiet(() => build({ configPath: s.configPath, site: 'player', onNoteFaults: (f) => { full = f; } }));
        assert.deepEqual(mine, full.filter((f) => f.code === 'PROP_NOT_COPIED'), 'the rows a full build raises');
      } finally { s.cleanup(); }
    });

    it(`${where}: an unpublished prop's matching copy behind it is not deleted`, () => {
      // Built once through a real folder, the copy is then moved behind the link: same bytes.
      const { s, outside } = linked('', { sub, listed: false });
      try {
        const real = buildBoth({ 'Documents/Invitation.md': PROP('prop_address: gazetteer/papers/invitation.html\n'), ...PROP_FILES }, { sites: ['player'], player: { keep: ['gazetteer'] } });
        const copy = real.player.read('gazetteer', 'papers', 'invitation.html');
        real.cleanup();
        fs.writeFileSync(path.join(outside, 'papers', 'invitation.html'), copy);
        const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
        assert.equal(fs.readFileSync(path.join(outside, 'papers', 'invitation.html'), 'utf8'), copy);
        assert.ok(lines.includes('  left in kept folder: gazetteer/papers/invitation.html (a folder on its path is a link)'), lines.join('\n'));
      } finally { s.cleanup(); }
    });
  }

  it('an in-memory build looks only in kept folders: a link the full build would clean away is no row', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP('prop_address: papers/invitation.html\n'), ...PROP_FILES }, { sites: [] });
    try {
      const outside = path.join(s.root, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      fs.mkdirSync(s.player.dir, { recursive: true });
      fs.symlinkSync(outside, path.join(s.player.dir, 'papers'));
      let faults = null;
      quiet(() => build({ configPath: s.configPath, site: 'player', inMemory: true, onNoteFaults: (f) => { faults = f; } }));
      assert.deepEqual(faults.filter((f) => f.code === 'PROP_NOT_COPIED'), []);
    } finally { s.cleanup(); }
  });

  it('a stale copy whose bytes differ is left, and the build says so', () => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP('prop_address: gazetteer/invitation.html\n'), ...PROP_FILES,
      'Documents/Other.md': '---\ntype: document\n---\nOther.\n',
      '_meta/publish-list.yaml': listFileText({ publishing: ['Documents/Other.md'] }),
    }, { sites: [], player: { keep: ['gazetteer'] } });
    try {
      fs.mkdirSync(path.join(s.player.dir, 'gazetteer'), { recursive: true });
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(s.player.read('gazetteer', 'invitation.html'), 'MINE');
      assert.ok(lines.includes('  left in kept folder: gazetteer/invitation.html (it differs from what the tool would write)'), lines.join('\n'));
    } finally { s.cleanup(); }
  });
});
