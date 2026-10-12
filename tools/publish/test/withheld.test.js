const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSiteDoctor } = require('../lib/site-doctor');
const { build } = require('../lib/build');
const { summaryLines } = require('../lib/note-faults');

// `withheld: true` (#291): a note's own name is a secret. Its file name, title and aliases are
// searched for in everything the build publishes, as gm_aliases names are. An unlabelled
// link to it prints a neutral placeholder. #292: a link to such a note is an error.

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const PLACEHOLDER = 'someone';
const ZORN = 'Lord Zorn';

// A player-mode site over a small vault. `files` maps vault paths to text. `excluded` lists
// manifest Excluded entries ("path" or "path — reason"); every other note is published.
function site(files, { excluded = [], publish = null, binary = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'withheld-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/')) folders.add(path.dirname(rel));
  }
  for (const [rel, bytes] of Object.entries(binary)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), bytes);
  }
  const listed = publish || Object.keys(files).filter((rel) => !excluded.some((e) => e.startsWith(rel)));
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
    '---', 'mode: player', '---', '',
    `## Publishing (${listed.length} files)`, '', ...listed.map((rel) => `- [x] ${rel}`), '',
    `## Excluded (${excluded.length} files)`, '', ...excluded.map((e) => `- [x] ${e}`), '',
  ].join('\n'));
  const map = [...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: player\n  exclude_dirs:\n    - Quiet\n  folder_map:\n${map}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta', '_Templates'] }));
  return { root, vault, configPath, docs: path.join(root, 'docs') };
}

async function doctor(configPath, extra = {}) {
  const out = [];
  const rc = await runSiteDoctor({ configPath, ...extra }, { out: (l) => out.push(String(l)), detect: () => null });
  return { rc, text: out.join('\n'), json: extra.json ? JSON.parse(out.join('')) : null };
}

async function found(files, options = {}, code = 'WITHHELD_IN_PROSE') {
  const { configPath } = site(files, options);
  const { json } = await doctor(configPath, { json: true });
  return json.findings.filter((f) => f.code === code);
}

function buildQuiet(configPath) {
  const log = console.log, warn = console.warn;
  const warnings = [];
  console.log = () => {};
  console.warn = (...a) => { warnings.push(a.join(' ')); };
  try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
  return warnings;
}

function walk(dir) {
  const out = [];
  (function go(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) go(full); else out.push(full);
    }
  })(dir);
  return out;
}

const npc = (body = '', extra = '') => `---\ntype: npc\n${extra}---\n\n${body}\n`;
const zornNote = (extra = 'withheld: true\n') => npc('Secret: he is the duke.', extra);
const mara = (body) => npc(body);
const ZORN_EXCLUDED = ['Characters/Lord_Zorn.md'];

describe('WITHHELD_IN_PROSE: a withheld note\'s name printed as plain text', () => {
  it('finds the file name of a withheld note on a published page; without the flag it passes clean', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
    };
    const [f] = await found(files, { excluded: ZORN_EXCLUDED });
    assert.strictEqual(f.code, 'WITHHELD_IN_PROSE');
    assert.strictEqual(f.severity, 'warning');
    assert.strictEqual(f.path, 'Characters/Mara_Quill.md');
    assert.strictEqual(f.name, ZORN);
    assert.strictEqual(f.owner, 'Characters/Lord_Zorn.md');
    assert.match(f.context, /Lord Zorn rides at dawn/);
    assert.match(f.detail, /Lord Zorn/);
    assert.match(f.fix, /link/i);
    // The same vault with the flag off: today's silence, kept.
    const plain = Object.assign({}, files, { 'Characters/Lord_Zorn.md': zornNote('') });
    assert.deepStrictEqual(await found(plain, { excluded: ZORN_EXCLUDED }), []);
  });

  it('searches the title and each alias, on word boundaries', async () => {
    const files = {
      'Characters/Vesper_Hale.md': zornNote('withheld: true\ntitle: The Ferryman\naliases: [Old Nick]\n'),
      'Characters/Mara_Quill.md': mara('The ferryman waits. Old Nick laughs. Vesper Hale smiles. The ferrymanship is a guild.'),
    };
    const names = (await found(files, { excluded: ['Characters/Vesper_Hale.md'] })).map((f) => f.name).sort();
    assert.deepStrictEqual(names, ['Old Nick', 'The Ferryman', 'Vesper Hale']);
  });

  it('finds a possessive ("Acharya\'s") in page text and in the search index', async () => {
    const files = {
      'Characters/Acharya.md': zornNote(),
      'Characters/Mara_Quill.md': mara('She wore the Acharya\'s ring.'),
    };
    const { configPath, docs } = site(files, { excluded: ['Characters/Acharya.md'] });
    const { json } = await doctor(configPath, { json: true });
    const hits = json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE');
    assert.strictEqual(hits.length, 1);
    assert.match(hits[0].context, /Acharya's ring/);
    buildQuiet(configPath);
    const index = fs.readFileSync(path.join(docs, 'search-index.json'), 'utf8');
    assert.ok(index.includes("acharya's"), 'the possessive is a term of the search index');
  });

  it('finds a name only the search index holds, from a field the page does not print', async () => {
    const files = {
      'Characters/Acharya.md': zornNote(),
      'Locations/Quay.md': '---\ntype: location\noccupation: The Acharya\n---\n\nA quay.\n',
    };
    const hits = await found(files, { excluded: ['Characters/Acharya.md'] });
    assert.deepStrictEqual(hits.map((f) => f.path), ['Locations/Quay.md']);
    assert.match(hits[0].detail, /search index/);
  });

  it('finds a copied attachment whose file name carries the name', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('A portrait hangs here. ![[Lord Zorn Portrait.png]]'),
    };
    const { configPath } = site(files, { excluded: ZORN_EXCLUDED, binary: { '_attachments/Lord Zorn Portrait.png': 'fake-png' } });
    const { json } = await doctor(configPath, { json: true });
    // The page prints the file's name as the picture's words as well; that is its own finding.
    const hits = json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE' && f.path.startsWith('_attachments/'));
    assert.strictEqual(hits.length, 1, JSON.stringify(json.findings));
    assert.strictEqual(hits[0].path, '_attachments/Lord Zorn Portrait.png');
    assert.strictEqual(hits[0].name, ZORN);
    assert.match(hits[0].fix, /rename/i);
  });

  it('is silent for a name inside a longer word, and in text the page strips', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zornish things.\n\n## GM Notes\n\nLord Zorn is the duke.\n'),
    };
    assert.deepStrictEqual(await found(files, { excluded: ZORN_EXCLUDED }), []);
  });

  it('reads the flag as gm_only is read: yes, on, 1 and a quoted true count; no crash on the rest', async () => {
    const body = mara('Lord Zorn rides at dawn.');
    for (const [value, expected] of [['yes', 1], ['"True"', 1], ['on', 1], ['1', 1], ['true', 1],
      ['false', 0], ['"no"', 0], ['0', 0], ['2', 0], ['[a, b]', 0], ['{x: 1}', 0], ['', 0], ['"maybe"', 0]]) {
      const files = { 'Characters/Lord_Zorn.md': zornNote(`withheld: ${value}\n`), 'Characters/Mara_Quill.md': body };
      const hits = await found(files, { excluded: ZORN_EXCLUDED });
      assert.strictEqual(hits.length, expected, `withheld: ${value}`);
    }
  });

  it('a withheld name that is also a published page\'s name is told as a notice, not searched', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
    };
    // The withheld note is itself published: its name is the name of a published page.
    const { configPath } = site(files, { excluded: [] });
    const { json } = await doctor(configPath, { json: true });
    assert.deepStrictEqual(json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE'), []);
    const notice = json.findings.filter((f) => f.code === 'WITHHELD_NAME_PUBLIC');
    assert.strictEqual(notice.length, 1);
    assert.strictEqual(notice[0].path, 'Characters/Lord_Zorn.md');
    assert.strictEqual(notice[0].name, ZORN);
    assert.strictEqual(notice[0].severity, 'warning');
    assert.match(notice[0].detail, /Lord Zorn/);
    assert.match(notice[0].fix, /withheld/);
  });

  it('tells the collision for an alias that names another published page', async () => {
    const files = {
      'Characters/Zorn_Elder.md': zornNote('withheld: true\naliases: [Mara Quill]\n'),
      'Characters/Mara_Quill.md': mara('Mara Quill walks.'),
    };
    const notice = await found(files, { excluded: ['Characters/Zorn_Elder.md'] }, 'WITHHELD_NAME_PUBLIC');
    assert.deepStrictEqual(notice.map((f) => f.name), ['Mara Quill']);
    assert.deepStrictEqual(await found(files, { excluded: ['Characters/Zorn_Elder.md'] }), []);
  });

  it('is settled the way NAMED_NO_PAGE is: a "stays hidden:" reason on the withheld note\'s Excluded entry', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
    };
    const open = await found(files, { excluded: ZORN_EXCLUDED });
    assert.strictEqual(open[0].settled, false);
    const { configPath } = site(files, { excluded: ['Characters/Lord_Zorn.md — stays hidden: Zorn is also a town'] });
    const { json } = await doctor(configPath, { json: true });
    const hit = json.findings.find((f) => f.code === 'WITHHELD_IN_PROSE');
    assert.strictEqual(hit.settled, true);
    assert.strictEqual(json.counts.settled, 1);
    assert.ok(!(await doctor(configPath)).text.includes('WITHHELD_IN_PROSE'));
  });

  it('is a report: the build still builds, warns in one line, and doctor exits 0', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
    };
    const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED });
    const warnings = buildQuiet(configPath);
    assert.ok(fs.existsSync(path.join(docs, 'index.html')));
    assert.ok(warnings.some((w) => /1 withheld name is printed on published pages \(Lord Zorn 1 page\)/.test(w)), warnings.join('\n'));
    const { rc, text } = await doctor(configPath);
    assert.strictEqual(rc, 0);
    assert.match(text, /^WITHHELD_IN_PROSE \(1 warning\)$/m);
    assert.match(text, /^ {2}Characters\/Mara_Quill\.md — /m);
  });

  it('summaryLines says it once for the name and once for the collision', () => {
    const lines = summaryLines([
      { code: 'WITHHELD_IN_PROSE', severity: 'warning', path: 'a.md', name: 'X Y', owner: 'x.md' },
      { code: 'WITHHELD_IN_PROSE', severity: 'warning', path: 'b.md', name: 'X Y', owner: 'x.md' },
      { code: 'WITHHELD_NAME_PUBLIC', severity: 'warning', path: 'x.md', name: 'X Y' },
    ]);
    assert.strictEqual(lines.length, 2);
    assert.match(lines[0], /1 withheld name is printed on published pages \(X Y 2 pages\)/);
    assert.match(lines[1], /1 withheld name is also the name of a published page/);
  });
});

describe('an unlabelled link to a withheld page prints a placeholder', () => {
  const files = {
    'Characters/Lord_Zorn.md': zornNote(),
    'Characters/Old_Gil.md': npc('Gil is a drunk.', 'publish: false\n'),
    'Characters/Mara_Quill.md': mara('She met [[Lord_Zorn]] at the quay, and [[Lord Zorn|the stranger]] later. Gil: [[Old_Gil]]. Heading link: [[Lord Zorn#Past]].'),
  };

  it('prints the placeholder for the bare link, the label for a labelled one, the name for any other unpublished page', () => {
    const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED.concat(['Characters/Old_Gil.md']) });
    buildQuiet(configPath);
    const html = fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8');
    assert.ok(html.includes(`She met ${PLACEHOLDER} at the quay`), 'bare link');
    assert.ok(html.includes('the stranger later'), 'labelled link');
    assert.ok(html.includes('Gil: Old Gil'), 'another unpublished page keeps printing its name');
    assert.ok(html.includes(`Heading link: ${PLACEHOLDER}.`), 'a link with a heading anchor');
    assert.ok(!/Zorn/.test(html));
  });

  it('prints it in a frontmatter field the page shows', () => {
    const fm = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': npc('Plain.', 'location: "[[Lord Zorn]]"\n') };
    const { configPath, docs } = site(fm, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    const html = fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8');
    assert.ok(!/Zorn/.test(html), 'the name is not on the page');
  });

  it('a published page that is withheld keeps its links (its name is public already)', () => {
    const both = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('She met [[Lord_Zorn]] at the quay.') };
    const { configPath, docs } = site(both, { excluded: [] });
    buildQuiet(configPath);
    const html = fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8');
    assert.match(html, /href="[^"]*lord-zorn\.html"[^>]*>Lord Zorn<\/a>/);
  });
});

describe('nothing in the output says a note is withheld', () => {
  const vault = (flag) => ({
    'Characters/Lord_Zorn.md': zornNote(`${flag}aliases: [The Hollow Duke]\ntitle: Duke Zorn the Hollow\n`),
    'Characters/Mara_Quill.md': mara('She met [[Lord_Zorn]] at the quay. Later [[The Hollow Duke]] left.\n\n## Related\n\n- [[Duke Zorn the Hollow]]'),
    'Characters/Dax_Moor.md': npc('Dax knows [[Lord Zorn]].', 'relationships:\n  - target: "[[Lord Zorn]]"\n    type: knows\n  - target: Lord Zorn\n    type: fears\nlocation: "[[Lord Zorn]]"\n'),
  });
  const textFiles = (docs) => new Map(walk(docs).filter((f) => /\.(html|json|js|css|txt|xml|svg)$/.test(f))
    .map((f) => [path.relative(docs, f), fs.readFileSync(f, 'utf8')]));

  it('no published file holds the name, and none holds the word more often than a vault with no withheld note', () => {
    const flagged = site(vault('withheld: true\n'), { excluded: ZORN_EXCLUDED });
    const plain = site(vault(''), { excluded: ZORN_EXCLUDED });
    buildQuiet(flagged.configPath);
    buildQuiet(plain.configPath);
    const out = textFiles(flagged.docs);
    const base = textFiles(plain.docs);
    assert.ok(out.size > 5);
    for (const rel of walk(flagged.docs).map((f) => path.relative(flagged.docs, f))) {
      assert.ok(!/zorn|hollow/i.test(rel), `${rel} carries the name`);
    }
    for (const [rel, text] of out) {
      assert.ok(!/zorn|hollow duke/i.test(text), `${rel} holds the name`);
      const count = (t) => (t.match(/withheld/gi) || []).length;
      assert.ok(count(text) <= count(base.get(rel) || ''), `${rel} holds the word more often than the plain build`);
    }
  });
});

describe('a published note that carries the flag does not say so either', () => {
  it('no file holds the word more often than the same vault without the flag', () => {
    const files = (flag) => ({
      'Characters/Lord_Zorn.md': zornNote(flag),
      'Characters/Mara_Quill.md': mara('She met [[Lord_Zorn]] at the quay.'),
    });
    const flagged = site(files('withheld: true\n'), { excluded: [] });
    const plain = site(files(''), { excluded: [] });
    buildQuiet(flagged.configPath);
    buildQuiet(plain.configPath);
    const count = (t) => (t.match(/withheld/gi) || []).length;
    for (const file of walk(flagged.docs)) {
      if (!/\.(html|json|js|css)$/.test(file)) continue;
      const rel = path.relative(flagged.docs, file);
      const other = path.join(plain.docs, rel);
      assert.ok(count(fs.readFileSync(file, 'utf8')) <= (fs.existsSync(other) ? count(fs.readFileSync(other, 'utf8')) : 0), rel);
    }
  });
});

describe('NAMED_NO_PAGE and a withheld target (#292)', () => {
  const linking = (n) => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Old_Gil.md': npc('Gil.') };
    const excluded = ['Characters/Lord_Zorn.md', 'Characters/Old_Gil.md'];
    for (let i = 1; i <= n; i++) files[`Characters/Pal_${i}.md`] = mara('She met [[Lord_Zorn]] and [[Old_Gil]].');
    return { files, excluded };
  };

  it('is an error when the target is withheld, a warning when it is not; still a report', async () => {
    const { files, excluded } = linking(2);
    const { configPath, docs } = site(files, { excluded });
    const { json, rc } = await doctor(configPath, { json: true });
    const named = Object.fromEntries(json.findings.filter((f) => f.code === 'NAMED_NO_PAGE').map((f) => [path.basename(f.path), f.severity]));
    assert.deepStrictEqual(named, { 'Lord_Zorn.md': 'error', 'Old_Gil.md': 'warning' });
    assert.strictEqual(rc, 1);
    assert.strictEqual(json.counts.errors, 1);
    // The build is untouched by it.
    buildQuiet(configPath);
    assert.ok(fs.existsSync(path.join(docs, 'index.html')));
  });

  it('says in the report that the name prints as the placeholder', async () => {
    const { files, excluded } = linking(1);
    const { json } = await doctor(site(files, { excluded }).configPath, { json: true });
    const z = json.findings.find((f) => f.code === 'NAMED_NO_PAGE' && f.path.endsWith('Lord_Zorn.md'));
    assert.match(z.detail, new RegExp(`"${PLACEHOLDER}"`));
    assert.ok(!/Lord Zorn/.test(z.detail.replace(/Lord_Zorn\.md/g, '')));
  });

  it('the human report names the linking pages, capped, with how many more', async () => {
    const { files, excluded } = linking(5);
    const { configPath } = site(files, { excluded });
    const { text } = await doctor(configPath);
    assert.match(text, /named on: Characters\/Pal_1\.md, Characters\/Pal_2\.md, Characters\/Pal_3\.md \(\+2 more; --json lists them all\)/);
    const four = linking(3);
    const { text: short } = await doctor(site(four.files, { excluded: four.excluded }).configPath);
    assert.match(short, /named on: Characters\/Pal_1\.md, Characters\/Pal_2\.md, Characters\/Pal_3\.md$/m);
  });
});
