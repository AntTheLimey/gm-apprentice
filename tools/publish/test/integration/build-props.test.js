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

// #524: the bar says how to print the prop well; a style that says it has a printout toggle (style.json printout_toggle)
// adds that the printout look uses less ink. The hint is the bar's, hidden in print, and never a word of the page.
describe('the print hint on the prop bar', () => {
  const HINT = '<span class="gma-prop-hint">To print: tick Background graphics, set margins to None.</span>';
  const INK = '<span class="gma-prop-hint">To print: tick Background graphics, set margins to None. The printout look uses less ink.</span>';
  it('every bar carries the hint; the ink clause only when asked', () => {
    const bar = propBar({ noteHref: 'a.html', noteTitle: 'A', collectionHref: null });
    assert.ok(bar.includes(HINT), bar);
    assert.ok(!bar.includes('less ink'), bar);
    assert.ok(propBar({ noteHref: 'a.html', noteTitle: 'A', collectionHref: 'p.html', printout: true }).includes(INK));
    assert.match(bar, /@media print\{\.gma-prop-bar\{display:none\}\}/);
  });
  it('withoutPropBar takes the hint out with the bar', () => {
    const { withoutPropBar } = require('../../lib/templates/prop-bar');
    const page = '<html><body class="x"><p>Words</p></body></html>';
    for (const printout of [false, true]) {
      const bar = propBar({ noteHref: 'a.html', noteTitle: 'A', collectionHref: 'p.html', printout });
      assert.equal(withoutPropBar(withPropBar(page, bar)), page);
    }
  });
  it('a terminal page says the printout look saves ink; a letter page and a hand-made page do not', () => {
    const s = buildBoth({
      'Documents/Invitation.md': PROP(), ...PROP_FILES,
      'Documents/Log.md': '---\ntype: prop\nprop_style: terminal\n---\n## The Text\n```\nLOG 1\n```\n',
      'Documents/Note.md': '---\ntype: prop\nprop_style: letter\n---\n## The Text\nDear sir.\n',
    }, { sites: ['player'] });
    try {
      assert.ok(s.player.read('props', 'log.html').includes(INK));
      assert.ok(s.player.read('props', 'note.html').includes(HINT));
      assert.ok(s.player.read('props', 'invitation.html').includes(HINT));
    } finally { s.cleanup(); }
  });
  it("the terminal style's style.json says it has a printout toggle; letter's does not", () => {
    const { loadStyle } = require('../../lib/props/styles');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-vault-'));
    try {
      assert.equal(loadStyle('terminal', { vaultPath: empty }).style.json.printoutToggle, true);
      assert.equal(loadStyle('letter', { vaultPath: empty }).style.json.printoutToggle, false);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
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

describe('a prop page that is not UTF-8', () => {
  const BAR = /<nav class="gma-prop-bar"[\s\S]*?<\/nav>/;
  const BLOCK = '<!-- gm-only --><p>KEEPER ONLY</p><!-- /gm-only -->';
  // A windows-1252 page (an old "save as Web page"): é is 0xE9, the curly quotes 0x93 and 0x94.
  const cp1252 = (text) => Buffer.from(text.replace(/\u201c/g, '\x93').replace(/\u201d/g, '\x94'), 'latin1');
  const HEAD = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><link rel="stylesheet" href="old.css"></head><body><p>Café \u201chush\u201d</p>';
  const CSS = '@charset "windows-1252";\np::after { content: "é"; }\n';
  const s = buildBoth({
    'Documents/Lettre \u2013 copie.md': '---\ntype: prop\nprop_file: lettre.html\n---\nA letter.\n',
    'Documents/lettre.html': cp1252(`${HEAD}${BLOCK}</body></html>`),
    'Documents/old.css': cp1252(CSS),
    'Documents/Unicode.md': '---\ntype: prop\nprop_file: unicode.html\n---\nA Word page.\n',
    'Documents/unicode.html': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<html><head><meta charset="utf-16"></head><body><p>Zoë</p>${BLOCK}</body></html>`, 'utf16le')]),
    'Documents/Plain.md': '---\ntype: prop\nprop_file: plain.html\n---\nA page.\n',
    'Documents/plain.html': `<html><head><meta charset="utf-8"></head><body><p>Café \u201chush\u201d</p>${BLOCK}</body></html>`,
  }, { sites: ['player'] });
  after(() => s.cleanup());
  const page = (name) => s.player.read('props', name).replace(BAR, '');
  // The build lines, from building the player site again (the helper keeps only warnings).
  let built = null;
  const lines = () => (built = built || quiet(() => build({ configPath: s.configPath, site: 'player' })));

  it('a windows-1252 page and stylesheet are written as UTF-8, their charset said so, the gm-only part cut', () => {
    assert.equal(page('lettre-copie.html'), `${HEAD.replace('charset=windows-1252', 'charset=utf-8')}</body></html>`);
    assert.match(s.player.read('props', 'lettre-copie.html'), /&larr; Lettre \u2013 copie<\/a>/);
    assert.equal(s.player.read('props', 'old.css'), CSS.replace('windows-1252', 'utf-8'));
    assert.ok(lines().includes('  props/lettre-copie.html: written as UTF-8 (it was windows-1252)'), lines().join('\n'));
    assert.ok(lines().includes('  props/old.css: written as UTF-8 (it was windows-1252)'), lines().join('\n'));
  });

  it('a UTF-16 page with a byte-order mark is written as UTF-8, the gm-only part cut', () => {
    assert.equal(page('unicode.html'), '<html><head><meta charset="utf-8"></head><body><p>Zoë</p></body></html>');
    assert.ok(lines().includes('  props/unicode.html: written as UTF-8 (it was UTF-16)'), lines().join('\n'));
  });

  it('a UTF-8 page and stylesheet are unchanged byte for byte, but for the cut and the bar', () => {
    assert.equal(page('plain.html'), '<html><head><meta charset="utf-8"></head><body><p>Café \u201chush\u201d</p></body></html>');
    assert.ok(!lines().some((l) => /plain\.html: written as UTF-8/.test(l)), lines().join('\n'));
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
      assert.deepEqual(s.player.files().map((f) => path.relative(s.player.dir, f).split(path.sep).join('/')).filter((f) => f.startsWith('props/')), ['props/index.html'], 'only the props page');
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
      assert.deepEqual(s.player.files().map((f) => path.relative(s.player.dir, f).split(path.sep).join('/')).filter((f) => f.startsWith('props/')), ['props/index.html'], 'only the props page');
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
      ["1 prop could not be put on the site as asked (A) — campaign-qa's Site Faults check fixes it."]);
    assert.deepEqual(summaryLines([row('Documents/A.md'), row('Documents/A.md')]),
      ["1 prop could not be put on the site as asked (A) — campaign-qa's Site Faults check fixes it."]);
    assert.deepEqual(summaryLines(['A', 'B', 'C', 'D'].map((n) => row(`Documents/${n}.md`))),
      ["4 props could not be put on the site as asked (A, B, C) — campaign-qa's Site Faults check fixes these."]);
  });

  it('the build prints the summary line', () => {
    const s = buildBoth({ 'Documents/Invitation.md': PROP() }, { sites: ['player'] });
    try {
      assert.ok(s.logs.includes("  WARNING: 1 prop could not be put on the site as asked (Invitation) — campaign-qa's Site Faults check fixes it."), s.logs.join('\n'));
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
      assert.deepEqual(s.player.files().map((f) => path.relative(s.player.dir, f).split(path.sep).join('/')).filter((f) => f.startsWith('props/')), ['props/index.html'], 'only the props page');
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

  // #506: the build keeps a record of the kept-folder files it wrote, beside the site (never in it), so a copy whose
  // note is gone, or whose address moved, is removed too. Only a file the record names and that still holds the
  // bytes the tool wrote goes: a GM's own file in the kept folder is never touched.
  const RECORD = (s) => path.join(path.dirname(s.player.dir), '.gm-apprentice', 'kept-writes.json');
  const noteOf = (s) => path.join(s.root, 'vault', 'Documents', 'Invitation.md');

  it('a kept-folder prop whose note is deleted is removed on the next build', () => {
    const s = setup();
    try {
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'mine.html'), 'THE GM OWN PAGE');
      assert.ok(fs.existsSync(RECORD(s)), 'the record is kept beside the site');
      assert.ok(!s.player.files().some((f) => /kept-writes/.test(f)), 'the record is never in the site');
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) {
        assert.ok(!s.player.exists(...f.split('/')), f);
        assert.ok(lines.includes(`  removed from kept folder: ${f} (the tool wrote it, and no prop writes it now)`), lines.join('\n'));
      }
      assert.equal(s.player.read('gazetteer', 'mine.html'), 'THE GM OWN PAGE');
      assert.deepEqual(JSON.parse(fs.readFileSync(RECORD(s), 'utf8')).files, {});
    } finally { s.cleanup(); }
  });

  it('a kept-folder prop whose address changes leaves nothing at the old one', () => {
    const s = setup();
    try {
      fs.writeFileSync(noteOf(s), fs.readFileSync(noteOf(s), 'utf8').replace('gazetteer/invitation.html', 'gazetteer/moved/invitation.html'));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) assert.ok(!s.player.exists(...f.split('/')), f);
      assert.ok(s.player.exists('gazetteer', 'moved', 'invitation.html'));
      assert.ok(s.player.exists('gazetteer', 'moved', 'assets', 'paper.jpg'));
      assert.ok(lines.includes('  removed from kept folder: gazetteer/invitation.html (the tool wrote it, and no prop writes it now)'), lines.join('\n'));
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(RECORD(s), 'utf8')).files).sort(),
        ['gazetteer/moved/assets/paper.jpg', 'gazetteer/moved/invitation.html', 'gazetteer/moved/props.css']);
    } finally { s.cleanup(); }
  });

  it('a recorded copy the GM has since changed is left, and the build says so once', () => {
    const s = setup();
    try {
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'EDITED BY THE GM');
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(s.player.read('gazetteer', 'invitation.html'), 'EDITED BY THE GM');
      assert.ok(lines.includes('  left in kept folder: gazetteer/invitation.html (it differs from what the tool wrote)'), lines.join('\n'));
      assert.ok(!s.player.exists('gazetteer', 'props.css'));
      const again = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(s.player.read('gazetteer', 'invitation.html'), 'EDITED BY THE GM');
      assert.ok(!again.some((l) => /kept folder: gazetteer\/invitation\.html/.test(l)), again.join('\n'));
    } finally { s.cleanup(); }
  });

  it('with no record (a site built before the tool kept one) a deleted note\'s copy stays', () => {
    const s = setup();
    try {
      fs.rmSync(RECORD(s));
      fs.rmSync(noteOf(s));
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) assert.ok(s.player.exists(...f.split('/')), f);
    } finally { s.cleanup(); }
  });

  it('a recorded copy behind a link is not deleted, and stays recorded', () => {
    const s = setup();
    try {
      const outside = path.join(s.root, 'outside');
      fs.renameSync(path.join(s.player.dir, 'gazetteer'), outside);
      fs.symlinkSync(outside, path.join(s.player.dir, 'gazetteer'));
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(fs.existsSync(path.join(outside, 'invitation.html')));
      assert.ok(lines.includes('  left in kept folder: gazetteer/invitation.html (a folder on its path is a link)'), lines.join('\n'));
      assert.ok('gazetteer/invitation.html' in JSON.parse(fs.readFileSync(RECORD(s), 'utf8')).files);
    } finally { s.cleanup(); }
  });

  const hashOf = (data) => require('node:crypto').createHash('sha256').update(data).digest('hex');
  const record = (s) => JSON.parse(fs.readFileSync(RECORD(s), 'utf8'));

  it('an unpublished prop whose copy holds bytes an older build recorded is removed, never "differs"', () => {
    const s = setup();
    try {
      // What an older tool wrote there (another bar), with the record that build kept.
      const page = path.join(s.player.dir, 'gazetteer', 'invitation.html');
      const older = fs.readFileSync(page, 'utf8').replace(/<span class="gma-prop-hint">[^<]*<\/span>/, '');
      fs.writeFileSync(page, older);
      const rec = record(s);
      rec.files['gazetteer/invitation.html'] = hashOf(older);
      fs.writeFileSync(RECORD(s), JSON.stringify(rec));
      unlist(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!s.player.exists('gazetteer', 'invitation.html'));
      assert.ok(lines.includes('  removed from kept folder: gazetteer/invitation.html (its prop is not published)'), lines.join('\n'));
      assert.ok(!lines.some((l) => /differs/.test(l)), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  for (const which of ['the record', 'the older clean-up']) {
    it(`a copy ${which} cannot remove is a warning naming it; the build carries on and the record keeps it`, (t) => {
      if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) { t.skip('file permissions do not stop this user'); return; }
      const s = setup();
      const dir = path.join(s.player.dir, 'gazetteer');
      try {
        if (which === 'the record') fs.rmSync(noteOf(s)); else unlist(s);
        fs.chmodSync(dir, 0o555);
        const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
        fs.chmodSync(dir, 0o755);
        assert.ok(s.player.exists('gazetteer', 'invitation.html'));
        assert.ok(lines.some((l) => l.includes('WARNING: could not remove the kept-folder copy gazetteer/invitation.html (EACCES); remove it by hand')), lines.join('\n'));
        assert.ok('gazetteer/invitation.html' in record(s).files);
        assert.ok(s.player.exists('NOTICE.txt'), 'the build finished');
      } finally { fs.chmodSync(dir, 0o755); s.cleanup(); }
    });
  }

  it('a record that cannot be read is said, kept as it is, and removes nothing', () => {
    const s = setup();
    try {
      fs.writeFileSync(RECORD(s), '{ not json');
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      for (const f of KEPT) assert.ok(s.player.exists(...f.split('/')), f);
      assert.equal(fs.readFileSync(RECORD(s), 'utf8'), '{ not json');
      assert.ok(lines.some((l) => /WARNING: .*kept-writes\.json in the site folder could not be read \(it is not JSON\); it is left as it is/.test(l)), lines.join('\n'));
      // A missing record (a site built before there was one) is silent.
      fs.rmSync(RECORD(s));
      const again = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!again.some((l) => /kept-writes/.test(l)), again.join('\n'));
    } finally { s.cleanup(); }
  });

  it('a record that cannot be written is a warning; the old one stays whole and the build finishes', (t) => {
    const s = setup();
    try {
      const before = fs.readFileSync(RECORD(s), 'utf8');
      fs.writeFileSync(noteOf(s), fs.readFileSync(noteOf(s), 'utf8').replace('gazetteer/invitation.html', 'gazetteer/moved/invitation.html'));
      const real = fs.renameSync;
      t.mock.method(fs, 'renameSync', (from, to) => {
        if (String(to).endsWith('kept-writes.json')) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        return real(from, to);
      });
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      t.mock.restoreAll();
      assert.ok(lines.some((l) => l.includes('WARNING: could not write .gm-apprentice/kept-writes.json in the site folder (EIO)')), lines.join('\n'));
      assert.equal(fs.readFileSync(RECORD(s), 'utf8'), before);
      assert.deepEqual(fs.readdirSync(path.dirname(RECORD(s))).filter((n) => n.startsWith('kept-writes')), ['kept-writes.json']);
      assert.ok(s.player.exists('NOTICE.txt'));
    } finally { s.cleanup(); }
  });

  it('a record entry that climbs out of its folder is never followed', () => {
    const s = setup();
    try {
      const outside = path.join(s.root, 'outside.html');
      fs.writeFileSync(outside, 'X');
      const rel = path.relative(s.player.dir, outside).split(path.sep).join('/');
      const rec = record(s);
      rec.files[`gazetteer/../${rel}`] = hashOf('X');
      fs.writeFileSync(RECORD(s), JSON.stringify(rec));
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(fs.existsSync(outside));
      assert.ok(!Object.keys(record(s).files).some((k) => k.includes('..')));
    } finally { s.cleanup(); }
  });

  // #560: a copy that replaced a file of the GM's own says so as it goes; one that replaced only the tool's own does not.
  const REPLACED = "it had replaced a file of yours; see the site repo's history";
  const setupOverMine = (listed = true) => {
    const s = setup('', false);
    fs.mkdirSync(path.join(s.player.dir, 'gazetteer'), { recursive: true });
    fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
    if (listed) fs.writeFileSync(path.join(s.root, 'vault', '_meta', 'publish-list.yaml'), LIST(['Documents/Invitation.md', 'Documents/Other.md']));
    const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
    assert.ok(lines.includes('  replaces kept file: gazetteer/invitation.html'), lines.join('\n'));
    return s;
  };

  it("a deleted note's copy that had replaced a file of the GM's says so as it is removed", () => {
    const s = setupOverMine();
    try {
      assert.deepEqual(record(s).replaced, ['gazetteer/invitation.html']);
      // A build that writes it again keeps the mark, though the file it replaces is now the tool's.
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.deepEqual(record(s).replaced, ['gazetteer/invitation.html']);
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!s.player.exists('gazetteer', 'invitation.html'));
      assert.ok(lines.includes(`  removed from kept folder: gazetteer/invitation.html (the tool wrote it, and no prop writes it now; ${REPLACED})`), lines.join('\n'));
      assert.ok(lines.includes('  removed from kept folder: gazetteer/props.css (the tool wrote it, and no prop writes it now)'), lines.join('\n'));
      assert.ok(!('replaced' in record(s)));
    } finally { s.cleanup(); }
  });

  it("an unpublished prop's copy that had replaced a file of the GM's says so as it is removed", () => {
    const s = setupOverMine();
    try {
      unlist(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!s.player.exists('gazetteer', 'invitation.html'));
      assert.ok(lines.includes(`  removed from kept folder: gazetteer/invitation.html (its prop is not published; ${REPLACED})`), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  it("a copy that replaced only the tool's own earlier copy, or nothing, is not marked", () => {
    const s = setup();
    try {
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!('replaced' in record(s)), JSON.stringify(record(s)));
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!lines.some((l) => l.includes(REPLACED)), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  // Whether the site folder's disk tells letter case apart.
  const caseSensitiveAt = (dir) => {
    const probe = path.join(dir, 'CASE-PROBE');
    fs.writeFileSync(probe, '');
    try { return !fs.existsSync(path.join(dir, 'case-probe')); } finally { fs.rmSync(probe); }
  };
  const recase = (s) => fs.writeFileSync(noteOf(s), fs.readFileSync(noteOf(s), 'utf8').replace('prop_address: gazetteer/invitation.html', 'prop_address: gazetteer/Invitation.html'));
  const named = (s) => fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => /^invitation\.html$/i.test(n));

  // Review of #560: one file under both spellings must never be taken for two. Where the disk does not tell case apart,
  // a stat that fails, or inode numbers that differ per spelling (some network shares), leave the file alone.
  for (const how of ['a stat that fails', 'a different inode per spelling']) {
    it(`a case-only address change keeps the one file when ${how}`, (t) => {
      const s = setup();
      try {
        if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
        recase(s);
        const real = fs.statSync;
        t.mock.method(fs, 'statSync', function (p, o) {
          const st = real.call(fs, p, o);
          if (!/[\\/]gazetteer[\\/]invitation\.html$/i.test(String(p))) return st;
          if (how === 'a stat that fails') throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
          const odd = /Invitation\.html$/.test(String(p)) ? 1 : 0;
          return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: typeof st.ino === 'bigint' ? st.ino + BigInt(odd) : st.ino + odd });
        });
        const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
        t.mock.restoreAll();
        assert.equal(named(s).length, 1);
        assert.match(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'Invitation.html'), 'utf8'), /You are invited/);
        assert.ok(!lines.some((l) => /removed from kept folder: gazetteer\/invitation\.html/i.test(l)), lines.join('\n'));
      } finally { t.mock.restoreAll(); s.cleanup(); }
    });
  }

  // Review of #560: the mark goes with the file that replaced the GM's, by its exact spelling.
  it("a case-only address change says the old copy had replaced a GM's file, and marks the new one only if it is that file", () => {
    const s = setupOverMine();
    try {
      const sensitive = caseSensitiveAt(path.join(s.player.dir, 'gazetteer'));
      recase(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      if (sensitive) {
        assert.ok(lines.includes(`  removed from kept folder: gazetteer/invitation.html (its address is now gazetteer/Invitation.html; ${REPLACED})`), lines.join('\n'));
        assert.ok(!('replaced' in record(s)), JSON.stringify(record(s)));
      } else {
        // One file under both names: it is still the copy that replaced the GM's.
        assert.deepEqual(record(s).replaced, ['gazetteer/Invitation.html']);
      }
    } finally { s.cleanup(); }
  });

  // Review C of #560: when the build cannot tell whether the two spellings are one file, it says so, keeps the old
  // name in the record and keeps its mark there. The same on any disk, since the folder cannot be read either way.
  it('a case-only address change whose folder cannot be read leaves the old name, says so, and keeps its mark', (t) => {
    const s = setupOverMine();
    try {
      recase(s);
      const folder = path.join(s.player.dir, 'gazetteer');
      const real = fs.readdirSync;
      t.mock.method(fs, 'readdirSync', function (p, ...rest) {
        if (String(p) === folder) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        return real.call(fs, p, ...rest);
      });
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      t.mock.restoreAll();
      assert.ok(lines.includes('  left in kept folder: gazetteer/invitation.html (could not tell whether it is gazetteer/Invitation.html)'), lines.join('\n'));
      assert.ok(named(s).length >= 1);
      const rec = record(s);
      assert.ok('gazetteer/invitation.html' in rec.files, JSON.stringify(rec));
      assert.ok('gazetteer/Invitation.html' in rec.files, JSON.stringify(rec));
      assert.deepEqual(rec.replaced, ['gazetteer/invitation.html']);
    } finally { t.mock.restoreAll(); s.cleanup(); }
  });

  // Review of #560: a build that stops after the GM's file is overwritten still has it marked.
  it("a build that stops after replacing a GM's file keeps the mark", () => {
    const s = setup('', false);
    try {
      fs.mkdirSync(path.join(s.player.dir, 'gazetteer'), { recursive: true });
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
      fs.writeFileSync(path.join(s.root, 'vault', '_meta', 'publish-list.yaml'), LIST(['Documents/Invitation.md', 'Documents/Other.md']));
      const saved = { log: console.log, warn: console.warn };
      console.warn = () => {};
      console.log = (line) => { if (line === '  wrote gazetteer/invitation.html') throw new Error('stopped'); };
      try { assert.throws(() => build({ configPath: s.configPath, site: 'player' }), /stopped/); } finally { Object.assign(console, saved); }
      assert.match(s.player.read('gazetteer', 'invitation.html'), /You are invited/);
      assert.deepEqual(record(s).replaced, ['gazetteer/invitation.html']);
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      fs.rmSync(noteOf(s));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(lines.includes(`  removed from kept folder: gazetteer/invitation.html (the tool wrote it, and no prop writes it now; ${REPLACED})`), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  // #560: an address that changes only in letter case. On a disk that tells the two apart (Linux) the old name is a
  // file of its own and goes; on one that does not (macOS, Windows) the two are one file, the one just written.
  // CodeRabbit on #575. A GM's file that could not be read before it is written over is taken as the GM's: marked.
  const overMine = (s) => {
    fs.mkdirSync(path.join(s.player.dir, 'gazetteer'), { recursive: true });
    fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'MINE');
    fs.writeFileSync(path.join(s.root, 'vault', '_meta', 'publish-list.yaml'), LIST(['Documents/Invitation.md', 'Documents/Other.md']));
  };
  it("a file in a kept folder that cannot be read before it is replaced is marked as the GM's", (t) => {
    const s = setup('', false);
    try {
      overMine(s);
      const target = path.join(s.player.dir, 'gazetteer', 'invitation.html');
      const real = fs.readFileSync;
      let once = true;
      t.mock.method(fs, 'readFileSync', function (p, ...rest) {
        if (once && String(p) === target) { once = false; throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); }
        return real.call(fs, p, ...rest);
      });
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      t.mock.restoreAll();
      assert.equal(once, false, 'the file was read before it was replaced');
      assert.deepEqual(record(s).replaced, ['gazetteer/invitation.html']);
    } finally { t.mock.restoreAll(); s.cleanup(); }
  });

  // The mark saved before the write: a record that cannot be written then is a warning, never silent.
  it('a mark that cannot be saved before the write is a warning, and the build carries on', (t) => {
    const s = setup('', false);
    try {
      overMine(s);
      const real = fs.renameSync;
      let once = true;
      t.mock.method(fs, 'renameSync', function (from, to) {
        if (once && String(to).endsWith('kept-writes.json')) { once = false; throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); }
        return real.call(fs, from, to);
      });
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      t.mock.restoreAll();
      assert.ok(lines.includes('  WARNING: could not record in .gm-apprentice/kept-writes.json that gazetteer/invitation.html replaces a file of yours (EIO); if this build stops before it ends, the mark is lost'), lines.join('\n'));
      assert.match(s.player.read('gazetteer', 'invitation.html'), /You are invited/);
      assert.deepEqual(record(s).replaced, ['gazetteer/invitation.html'], 'the record at the end holds it');
    } finally { t.mock.restoreAll(); s.cleanup(); }
  });

  // CodeRabbit on #575, on a disk that tells case apart: another spelling's recorded hash never says whose a file is.
  it("another spelling's recorded hash does not make a GM's file the tool's", (t) => {
    const s = setup();
    try {
      if (!caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk does not tell letter case apart'); return; }
      const rec = record(s);
      rec.files['gazetteer/invitation.html'] = hashOf('MINE');
      fs.writeFileSync(RECORD(s), JSON.stringify(rec));
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'Invitation.html'), 'MINE');
      recase(s);
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.deepEqual(record(s).replaced, ['gazetteer/Invitation.html']);
    } finally { s.cleanup(); }
  });

  // CodeRabbit on #575, case-sensitive disk: an old spelling that is simply gone gives its mark to nothing.
  it('a marked old spelling the GM removed gives no mark to the new spelling', (t) => {
    const s = setupOverMine();
    try {
      if (!caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk does not tell letter case apart'); return; }
      fs.rmSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'));
      recase(s);
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(!('replaced' in record(s)), JSON.stringify(record(s)));
    } finally { s.cleanup(); }
  });

  // CodeRabbit on #575, case-sensitive disk: two names that are hard links to one file are two entries, never settled
  // as one: the old name is left, said and kept in the record.
  it('two spellings that are hard links to one file are left and said, not taken as one', (t) => {
    const s = setup();
    try {
      if (!caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk does not tell letter case apart'); return; }
      fs.linkSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), path.join(s.player.dir, 'gazetteer', 'Invitation.html'));
      recase(s);
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.ok(lines.includes('  left in kept folder: gazetteer/invitation.html (could not tell whether it is gazetteer/Invitation.html)'), lines.join('\n'));
      assert.ok('gazetteer/invitation.html' in record(s).files);
      assert.deepEqual(named(s).sort(), ['Invitation.html', 'invitation.html']);
    } finally { s.cleanup(); }
  });

  it('a kept-folder prop whose address changes only in letter case leaves no file at the old name', () => {
    const s = setup();
    try {
      const probe = path.join(s.player.dir, 'gazetteer', 'CASE-PROBE');
      fs.writeFileSync(probe, '');
      const caseSensitive = !fs.existsSync(probe.toLowerCase().replace(s.player.dir.toLowerCase(), s.player.dir));
      fs.rmSync(probe);
      fs.writeFileSync(noteOf(s), fs.readFileSync(noteOf(s), 'utf8').replace('prop_address: gazetteer/invitation.html', 'prop_address: gazetteer/Invitation.html'));
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      const names = fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => /^invitation\.html$/i.test(n));
      assert.match(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'Invitation.html'), 'utf8'), /You are invited/);
      assert.ok('gazetteer/Invitation.html' in record(s).files, JSON.stringify(record(s)));
      assert.ok(!('gazetteer/invitation.html' in record(s).files), JSON.stringify(record(s)));
      if (caseSensitive) {
        assert.deepEqual(names, ['Invitation.html']);
        assert.ok(lines.includes('  removed from kept folder: gazetteer/invitation.html (its address is now gazetteer/Invitation.html)'), lines.join('\n'));
      } else {
        // One file under both names (#576): it takes the new spelling, so git sees the rename; nothing is deleted.
        assert.deepEqual(names, ['Invitation.html']);
        assert.ok(lines.includes('  renamed in kept folder: gazetteer/invitation.html to gazetteer/Invitation.html (its address changed case)'), lines.join('\n'));
        assert.ok(!lines.some((l) => /removed from kept folder: gazetteer\/invitation\.html/i.test(l)), lines.join('\n'));
        assert.deepEqual(fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => n.includes('.case-')), [], 'no temporary name is left');
      }
    } finally { s.cleanup(); }
  });

  // #576: a folder below the kept folder whose spelling changes only in case is renamed when the tool made it, and left
  // with one warning when the GM's files are in it.
  const readdress = (s, address) => fs.writeFileSync(noteOf(s), fs.readFileSync(noteOf(s), 'utf8').replace(/prop_address: \S+/, `prop_address: ${address}`));
  it('a case-only change in a folder the tool made renames the folder', (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      readdress(s, 'gazetteer/letters/invitation.html');
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      readdress(s, 'gazetteer/Letters/invitation.html');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.deepEqual(fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => /^letters$/i.test(n)), ['Letters']);
      assert.ok(lines.includes('  renamed in kept folder: gazetteer/letters to gazetteer/Letters (its address changed case)'), lines.join('\n'));
      assert.match(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'Letters', 'invitation.html'), 'utf8'), /You are invited/);
      assert.ok('gazetteer/Letters/invitation.html' in record(s).files, JSON.stringify(record(s)));
      assert.ok(!('gazetteer/letters/invitation.html' in record(s).files), JSON.stringify(record(s)));
    } finally { s.cleanup(); }
  });

  it("a case-only change in a folder holding the GM's own file leaves the folder and says so once", (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      readdress(s, 'gazetteer/letters/invitation.html');
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'letters', 'mine.html'), 'MINE');
      readdress(s, 'gazetteer/Letters/invitation.html');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.deepEqual(fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => /^letters$/i.test(n)), ['letters']);
      const warned = lines.filter((l) => l.includes('gazetteer/letters keeps its spelling'));
      assert.equal(warned.length, 1, lines.join('\n'));
      assert.match(warned[0], /it holds files the tool did not write, or that were changed since; rename it yourself if it should change/);
      assert.equal(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'letters', 'mine.html'), 'utf8'), 'MINE');
      assert.match(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'letters', 'invitation.html'), 'utf8'), /You are invited/);
    } finally { s.cleanup(); }
  });

  // Review B: a file the tool wrote and the GM changed since makes the folder the GM's too, as keptIsMine judges.
  it("a case-only folder change where a file the tool wrote was changed since leaves the folder", (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      readdress(s, 'gazetteer/letters/invitation.html');
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      fs.mkdirSync(path.join(s.player.dir, 'gazetteer', 'letters', 'more'));
      fs.writeFileSync(path.join(s.player.dir, 'gazetteer', 'letters', 'more', 'x.html'), 'X');
      const rec = record(s);
      rec.files['gazetteer/letters/more/x.html'] = hashOf('Y');
      fs.writeFileSync(RECORD(s), JSON.stringify(rec));
      readdress(s, 'gazetteer/Letters/invitation.html');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.deepEqual(fs.readdirSync(path.join(s.player.dir, 'gazetteer')).filter((n) => /^letters$/i.test(n)), ['letters']);
      assert.ok(lines.some((l) => l.includes('gazetteer/letters keeps its spelling')), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  // Review B: a build that keeps no record (a preview into the site folder) says that, not that the files are the GM's.
  it('a case-only folder change in a build with no kept record says the build keeps no record', (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      readdress(s, 'gazetteer/letters/invitation.html');
      quiet(() => build({ configPath: s.configPath, site: 'player' }));
      readdress(s, 'gazetteer/Letters/invitation.html');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player', outputDirOverride: s.player.dir }));
      const warned = lines.filter((l) => l.includes('gazetteer/letters keeps its spelling'));
      assert.equal(warned.length, 1, lines.join('\n'));
      assert.match(warned[0], /this build keeps no record of the files the tool wrote in kept folders/);
    } finally { s.cleanup(); }
  });

  // Review B: the temporary name never replaces a file that has it.
  it('a case-only change never writes over a file that has the temporary name', (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      recase(s);
      const taken = path.join(s.player.dir, 'gazetteer', `invitation.html.case-${process.pid}.tmp`);
      fs.writeFileSync(taken, 'GM');
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      assert.equal(fs.readFileSync(taken, 'utf8'), 'GM');
      assert.deepEqual(named(s), ['Invitation.html']);
      assert.ok(lines.some((l) => l.includes(`left in kept folder: gazetteer/invitation.html.case-${process.pid}.tmp`)), lines.join('\n'));
    } finally { s.cleanup(); }
  });

  // Review B: when the put-back fails too, the warning says where the file is now, and a later build names it.
  it('a case-only rename whose put-back fails says where the file is', (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      recase(s);
      const real = fs.renameSync;
      t.mock.method(fs, 'renameSync', (from, to) => {
        if (/\.case-\d+\.tmp$/.test(String(from))) throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        return real(from, to);
      });
      let lines;
      try { lines = quiet(() => build({ configPath: s.configPath, site: 'player' })); } finally { t.mock.restoreAll(); }
      const temp = `gazetteer/invitation.html.case-${process.pid}.tmp`;
      assert.ok(lines.some((l) => l.includes(`could not rename gazetteer/invitation.html to gazetteer/Invitation.html (EIO), nor put it back (EIO): it is now at ${temp}; rename it to gazetteer/Invitation.html by hand`)), lines.join('\n'));
      assert.ok(lines.some((l) => l.includes(`left in kept folder: ${temp}`)), lines.join('\n'));
    } finally { t.mock.restoreAll(); s.cleanup(); }
  });

  // #576: a rename the disk refuses leaves the old spelling, says so, and the build writes the file as before.
  it('a case-only address change whose rename fails keeps the old spelling and says so', (t) => {
    const s = setup();
    try {
      if (caseSensitiveAt(path.join(s.player.dir, 'gazetteer'))) { t.skip('this disk tells letter case apart'); return; }
      recase(s);
      const real = fs.renameSync;
      t.mock.method(fs, 'renameSync', (from, to) => {
        if (/[\\/]gazetteer[\\/]invitation\.html$/.test(String(from))) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        return real(from, to);
      });
      const lines = quiet(() => build({ configPath: s.configPath, site: 'player' }));
      t.mock.restoreAll();
      assert.deepEqual(named(s), ['invitation.html']);
      assert.match(fs.readFileSync(path.join(s.player.dir, 'gazetteer', 'invitation.html'), 'utf8'), /You are invited/);
      assert.ok(lines.some((l) => l.includes('WARNING: could not rename gazetteer/invitation.html to gazetteer/Invitation.html (EACCES)')), lines.join('\n'));
    } finally { t.mock.restoreAll(); s.cleanup(); }
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
