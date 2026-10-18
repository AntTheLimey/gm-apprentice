const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSiteDoctor } = require('../lib/site-doctor');
const { build } = require('../lib/build');
const { summaryLines } = require('../lib/note-faults');
const { writeNewConfig } = require('./helpers/settings-files');
const { writePublishList } = require('./helpers/publish-list');
// `withheld: true` (#291): a note's own name is a secret. Its file name, title and aliases are
// searched for in everything the build publishes, as gm_aliases names are. An unlabelled
// link to it prints a neutral placeholder. #292: a link to such a note is an error.

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const PLACEHOLDER = 'someone';
const ZORN = 'Lord Zorn';

// A player-mode site over a small vault. `files` maps vault paths to text. `excluded` lists
// manifest Excluded entries ("path" or "path — reason"); every other note is published.
function site(files, { excluded = [], publish = null, binary = {}, mode = 'player', extra = '' } = {}) {
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
  writePublishList(vault, { publishing: listed, excluded });
  const map = [...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: ${mode}\n  exclude_dirs:\n    - Quiet\n${extra}  folder_map:\n${map}---\n`);
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

  it('tells the collision for an alias that names another published page', async () => {
    const files = {
      'Characters/Zorn_Elder.md': zornNote('withheld: true\naliases: [Mara Quill]\n'),
      'Characters/Mara_Quill.md': mara('Mara Quill walks.'),
    };
    const notice = await found(files, { excluded: ['Characters/Zorn_Elder.md'] }, 'WITHHELD_NAME_PUBLIC');
    assert.deepStrictEqual(notice.map((f) => f.name), ['Mara Quill']);
    assert.deepStrictEqual(await found(files, { excluded: ['Characters/Zorn_Elder.md'] }), []);
  });

  it('cannot be settled: "stays hidden:" on the withheld note\'s Excluded entry leaves the name findings open', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
    };
    const { configPath } = site(files, { excluded: ['Characters/Lord_Zorn.md — stays hidden: Zorn is also a town'] });
    const { json } = await doctor(configPath, { json: true });
    const hit = json.findings.find((f) => f.code === 'WITHHELD_IN_PROSE');
    assert.ok(hit);
    assert.ok(!hit.settled, 'a name in plain text has no "leave it" answer');
    assert.strictEqual(json.counts.settled, 0);
    assert.doesNotMatch(hit.fix, /stays hidden/, 'the fix does not offer an answer that settles nothing');
    assert.match((await doctor(configPath)).text, /WITHHELD_IN_PROSE/);
  });

  it('a collision notice cannot be settled either', async () => {
    const files = {
      'Characters/Zorn_Elder.md': zornNote('withheld: true\naliases: [Mara Quill]\n'),
      'Characters/Mara_Quill.md': mara('Mara Quill walks.'),
    };
    const { configPath } = site(files, { excluded: ['Characters/Zorn_Elder.md — stays hidden: ok'] });
    const { json } = await doctor(configPath, { json: true });
    const hit = json.findings.find((f) => f.code === 'WITHHELD_NAME_PUBLIC');
    assert.ok(hit && !hit.settled);
  });

  it('"stays hidden:" still settles the link report for a withheld target', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Met [[Lord_Zorn]].') };
    const { configPath } = site(files, { excluded: ['Characters/Lord_Zorn.md — stays hidden: the placeholder will do'] });
    const { json, rc } = await doctor(configPath, { json: true });
    const hit = json.findings.find((f) => f.code === 'NAMED_NO_PAGE');
    assert.strictEqual(hit.settled, true);
    assert.strictEqual(rc, 0);
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

describe('player_site.withheld_words: the audit does not depend on the built-in words', () => {
  // The same vault with the person word as the built-in one and as 'a stranger', on the new settings file.
  function withWord(word) {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('She met [[Lord_Zorn]] at the quay. Lord Zorn laughed.'),
    };
    const s = site(files, { excluded: ZORN_EXCLUDED });
    fs.rmSync(path.join(s.vault, '_meta', 'vault-config.md'));
    writeNewConfig(s.vault, {
      version: 1,
      player_site: { hide: { folders: ['Quiet'] }, folder_map: { Characters: 'characters' }, ...(word ? { withheld_words: { person: word } } : {}) },
    });
    fs.writeFileSync(s.configPath, JSON.stringify({ vaultPath: s.vault }));
    let findings = null;
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath: s.configPath, onNoteFaults: (f) => { findings = f; } }); } finally { console.log = log; console.warn = warn; }
    return { html: fs.readFileSync(path.join(s.docs, 'characters', 'mara-quill.html'), 'utf8'), findings, configPath: s.configPath };
  }
  const pick = (findings) => findings.map((f) => `${f.code}|${f.path}|${f.name || ''}|${f.severity}`).sort();

  it('prints the word the GM chose, and finds the same names as with the built-in word', async () => {
    const def = withWord(null);
    const own = withWord('a stranger');
    assert.ok(def.html.includes('She met someone at the quay.'));
    assert.ok(own.html.includes('She met a stranger at the quay.'));
    assert.ok(pick(def.findings).some((f) => f.startsWith('WITHHELD_IN_PROSE|')), 'the plain-text name is found');
    assert.deepStrictEqual(pick(own.findings), pick(def.findings));
    const [a, b] = [await doctor(def.configPath, { json: true }), await doctor(own.configPath, { json: true })];
    assert.deepStrictEqual(pick(b.json.findings), pick(a.json.findings));
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

// ---------------------------------------------------------------------------------------
// Links, kinds, fields, publishing, flags, Unicode and copied files
// ---------------------------------------------------------------------------------------
const outputText = (docs) => walk(docs).map((f) => [path.relative(docs, f), /\.(html|json|js|css|txt|xml|svg)$/.test(f) ? fs.readFileSync(f, 'utf8') : '']);
const namesIn = (docs) => outputText(docs).filter(([rel, text]) => /zorn|hollow[ _-]duke/i.test(rel) || /zorn|hollow[ _-]duke/i.test(text)).map(([rel]) => rel);

describe('every way a link reaches a withheld note prints the placeholder', () => {
  const zorn = zornNote('withheld: true\ntitle: Duke Zorn the Hollow\naliases: [The Hollow Duke]\ngm_aliases: [Hollow Duke]\n');
  const forms = [
    '[[Lord_Zorn]]', '[[lord zorn]]', '[[LORD_ZORN]]', '[[Duke Zorn the Hollow]]', '[[The Hollow Duke]]', '[[the_hollow_duke]]',
    '[[Hollow Duke]]', '[[hollow_duke]]', '[[Hollow Duke#Secrets]]', '[[Hollow Duke#^abc]]', '![[Hollow Duke]]', '![[Lord Zorn#Past]]',
    '[[Characters/Lord_Zorn]]', '[[Characters/Lord_Zorn.md]]', '[[Characters/Hollow Duke]]', '[[Lord_Zorn#Past]]',
  ];

  it('prints it for the title, file name, alias, gm_alias, heading, block, embed, case, underscore and folder forms', () => {
    const body = forms.map((f, i) => `Form ${i}: ${f}.`).join('\n\n') + '\n\nLabelled: [[Hollow Duke|the stranger]].';
    const { configPath, docs } = site({ 'Characters/Lord_Zorn.md': zorn, 'Characters/Mara_Quill.md': mara(body) }, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    const html = fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8');
    forms.forEach((f, i) => assert.ok(html.includes(`Form ${i}: ${PLACEHOLDER}.`), `${f} did not print the placeholder`));
    assert.ok(html.includes('Labelled: the stranger.'));
    assert.deepStrictEqual(namesIn(docs), []);
  });

  it('prints it in a frontmatter field, a relationship target and a bare field, by gm_alias too', () => {
    const fm = 'faction: "[[Hollow Duke]]"\nlocation: Hollow Duke\nparent_location: "[[Hollow Duke#Secrets]]"\n'
      + 'relationships:\n  - target: "[[Hollow Duke]]"\n    type: fears\n  - target: Hollow Duke\n    type: knows\n  - target: "[[The Hollow Duke]]"\n    type: serves\n';
    const { configPath, docs } = site({ 'Characters/Lord_Zorn.md': zorn, 'Characters/Mara_Quill.md': npc('Plain words.', fm) }, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    assert.deepStrictEqual(namesIn(docs), []);
  });

  it('a gm_alias that is a published page\'s name is left to that page', () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote('withheld: true\ngm_aliases: [Mara_Quill]\n'),
      'Characters/Mara_Quill.md': mara('Plain.'),
      'Characters/Dax.md': mara('Intro.\n\nDax met [[Mara_Quill]].'),
    };
    const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    assert.ok(fs.readFileSync(path.join(docs, 'characters', 'dax.html'), 'utf8').includes('>Mara Quill</a>'));
  });
});

describe('the placeholder fits the kind of note', () => {
  const cases = [['npc', 'Characters', 'someone'], ['pc', 'Characters', 'someone'], ['location', 'Locations', 'somewhere'],
    ['item', 'Items', 'something'], ['creature', 'Creatures', 'something'], ['organization', 'Orgs', 'something'], ['clue', 'Clues', 'something']];
  for (const [type, dir, word] of cases) {
    it(`${type} prints "${word}"`, () => {
      const files = {
        [`${dir}/Lord_Zorn.md`]: `---\ntype: ${type}\nwithheld: true\ngm_aliases: [Hollow Duke]\n---\n\nSecret.\n`,
        'Characters/Mara_Quill.md': mara('Met [[Lord_Zorn]] and [[Hollow Duke]] at the quay.'),
      };
      const { configPath, docs } = site(files, { excluded: [`${dir}/Lord_Zorn.md`] });
      buildQuiet(configPath);
      const html = fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8');
      assert.ok(html.includes(`Met ${word} and ${word} at the quay.`), word);
    });
  }
  it('a note with no type prints "something"', () => {
    const files = { 'Characters/Lord_Zorn.md': '---\nwithheld: true\n---\n\nSecret.\n', 'Characters/Mara_Quill.md': mara('Met [[Lord_Zorn]].') };
    const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    assert.ok(fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8').includes('Met something.'));
  });
});

describe('the name planted in any frontmatter field is reported or absent from every output file', () => {
  const fields = ['occupation', 'gender', 'nationality', 'status', 'location', 'first_appearance', 'source', 'source_document', 'campaign',
    'description', 'notes', 'summary', 'tags', 'aliases', 'title', 'display_meta', 'portrait', 'relationships_description', 'relationship_type', 'custom_field'];
  for (const field of fields) {
    it(`${field}`, async () => {
      const value = '"Lord Zorn\'s Man"';
      let fm;
      if (field === 'tags' || field === 'aliases' || field === 'display_meta') fm = `${field}: [${value}]\n`;
      else if (field === 'relationships_description') fm = `relationships:\n  - target: "[[Dax_Moor]]"\n    type: knows\n    description: ${value}\n`;
      else if (field === 'relationship_type') fm = `relationships:\n  - target: "[[Dax_Moor]]"\n    type: ${value}\n`;
      else fm = `${field}: ${value}\n`;
      const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': npc('Plain words.', fm), 'Characters/Dax_Moor.md': npc('Dax.') };
      const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED });
      const { json } = await doctor(configPath, { json: true });
      buildQuiet(configPath);
      const where = namesIn(docs);
      const reported = json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE' && f.path === 'Characters/Mara_Quill.md');
      assert.ok(where.length === 0 || reported.length > 0, `${field}: in ${where.join(', ')} and not reported`);
    });
  }
});

describe('a withheld note that publishes', () => {
  const scenes = [
    ['listed under Publishing', {}, ''],
    ['publish: true, listed', {}, 'publish: true\n'],
    ['publish: stub, listed', {}, 'publish: stub\n'],
  ];
  for (const [name, options, extra] of scenes) {
    it(`is one error naming the page, with both ways out: ${name}`, async () => {
      const files = {
        'Characters/Lord_Zorn.md': zornNote(`withheld: true\n${extra}`),
        'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.'),
      };
      const { configPath } = site(files, Object.assign({ excluded: [] }, options));
      const { json, rc } = await doctor(configPath, { json: true });
      const hit = json.findings.filter((f) => f.code === 'WITHHELD_PUBLISHED');
      assert.strictEqual(hit.length, 1, JSON.stringify(json.findings.map((f) => f.code)));
      assert.strictEqual(hit[0].severity, 'error');
      assert.strictEqual(hit[0].path, 'Characters/Lord_Zorn.md');
      assert.match(hit[0].detail, /is marked withheld and is being published: page characters\/lord-zorn\.html/);
      assert.match(hit[0].fix, /remove withheld/);
      assert.match(hit[0].fix, /stop (it|the note) publishing/);
      assert.deepStrictEqual(json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE'), [], 'no flood');
      assert.strictEqual(rc, 1);
    });
  }
  it('the build still builds and its closing lines mention it', () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Plain.') };
    const { configPath, docs } = site(files, { excluded: [] });
    const warnings = buildQuiet(configPath);
    assert.ok(fs.existsSync(path.join(docs, 'characters', 'lord-zorn.html')));
    assert.ok(warnings.some((w) => /1 note marked withheld is published \(Lord_Zorn\)/.test(w)), warnings.join('\n'));
  });
  it('a withheld note kept off the site by publish: false while listed is not one', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote('withheld: true\npublish: false\n'), 'Characters/Mara_Quill.md': mara('Plain.') };
    const { configPath } = site(files, { excluded: [] });
    const { json } = await doctor(configPath, { json: true });
    assert.deepStrictEqual(json.findings.filter((f) => f.code === 'WITHHELD_PUBLISHED'), []);
  });
});

describe('a flag value the build cannot read', () => {
  for (const value of ['tru', '[true]', '"maybe"', 'yes please', '2']) {
    it(`withheld: ${value} is told once, read as not withheld`, async () => {
      const files = { 'Characters/Lord_Zorn.md': zornNote(`withheld: ${value}\n`), 'Characters/Mara_Quill.md': mara('Met [[Lord_Zorn]]. Lord Zorn.') };
      const { configPath } = site(files, { excluded: ZORN_EXCLUDED });
      const { json } = await doctor(configPath, { json: true });
      const hit = json.findings.filter((f) => f.code === 'WITHHELD_FLAG_UNREADABLE');
      assert.strictEqual(hit.length, 1);
      assert.strictEqual(hit[0].path, 'Characters/Lord_Zorn.md');
      assert.strictEqual(hit[0].severity, 'warning');
      assert.match(hit[0].detail, /withheld: /);
      assert.match(hit[0].detail, /read as not withheld/);
      assert.match(hit[0].fix, /true or false/);
      const warnings = buildQuiet(configPath);
      assert.ok(warnings.some((w) => /Characters\/Lord_Zorn\.md/.test(w) && /withheld/.test(w) && /not withheld/.test(w)), warnings.join('\n'));
    });
  }
  it('says nothing for a value it reads', async () => {
    for (const value of ['true', 'false', 'yes', 'no', 'on', 'off', '0', '1', '1.0', '', '"False"']) {
      const files = { 'Characters/Lord_Zorn.md': zornNote(`withheld: ${value}\n`) };
      const { configPath } = site(files, { excluded: ZORN_EXCLUDED });
      const { json } = await doctor(configPath, { json: true });
      assert.deepStrictEqual(json.findings.filter((f) => f.code === 'WITHHELD_FLAG_UNREADABLE'), [], value);
    }
  });
  it('tells a note in a folder the scan never reads', async () => {
    const files = { 'Quiet/Lord_Zorn.md': zornNote('withheld: tru\n'), 'Characters/Mara_Quill.md': mara('Plain.') };
    const { configPath } = site(files, { excluded: [] });
    const { json } = await doctor(configPath, { json: true });
    assert.strictEqual(json.findings.filter((f) => f.code === 'WITHHELD_FLAG_UNREADABLE').length, 1);
  });
});

describe('the closing line for a withheld target', () => {
  it('says a neutral word prints, not "plain words", and sorts the withheld notes apart', () => {
    const lines = summaryLines([
      { code: 'NAMED_NO_PAGE', severity: 'error', path: 'Characters/Lord_Zorn.md', pageCount: 5, withheld: true, printed: ['someone'] },
      { code: 'NAMED_NO_PAGE', severity: 'warning', path: 'Characters/Old_Gil.md', pageCount: 2, printed: ['Old Gil'] },
    ]);
    assert.strictEqual(lines.length, 2);
    const w = lines.find((l) => /withheld/.test(l));
    assert.match(w, /1 note marked withheld is linked from published pages, where a neutral word prints in its place \(most linked: Lord_Zorn 5 pages\)/);
    assert.ok(!/plain words/.test(w));
    assert.match(lines.find((l) => !/withheld/.test(l)), /plain words/);
  });
});

describe('a name in another Unicode form', () => {
  const nfd = (t) => t.normalize('NFD');
  it('finds a file name in NFD against a body in NFC, and the reverse', async () => {
    const name = 'Séraphine_Voss';
    const a = { [`Characters/${nfd(name)}.md`]: zornNote(), 'Characters/Mara_Quill.md': mara(`Met ${'Séraphine Voss'.normalize('NFC')} today.`) };
    assert.strictEqual((await found(a, { excluded: [`Characters/${nfd(name)}.md`] })).length, 1);
    const b = { [`Characters/${name.normalize('NFC')}.md`]: zornNote(), 'Characters/Mara_Quill.md': mara(`Met ${nfd('Séraphine Voss')} today.`) };
    assert.strictEqual((await found(b, { excluded: [`Characters/${name.normalize('NFC')}.md`] })).length, 1);
  });
  it('finds a gm_aliases name the same way (ALIAS_IN_PROSE finds more, correctly)', async () => {
    const files = { 'Characters/Lord_Zorn.md': npc('x', 'gm_aliases: ["Séraphine"]\n'), 'Characters/Mara_Quill.md': mara(`Met ${nfd('Séraphine')} today.`) };
    assert.strictEqual((await found(files, {}, 'ALIAS_IN_PROSE')).length, 1);
  });
});

describe('the name matcher\'s word boundaries', () => {
  it('a name that ends a longer word is not a hit (the leading boundary)', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('The Mylord Zorn and the 3Lord Zorn arrive.') };
    assert.deepStrictEqual(await found(files, { excluded: ZORN_EXCLUDED }), []);
  });
});

describe('a withheld name that is an everyday word (#454)', () => {
  // A one-word name the site also prints in lower case is an everyday word: every ordinary use is reported, so the fix
  // line says to rename the note (or, for a title or alias, to take that name off). A `title:` adds a name to look for
  // and takes none away, so it is no way out.
  it('a one-word file name printed in lower case says to rename the note; a capital-only one keeps the usual line', async () => {
    const files = {
      'Heritages/Human.md': npc('Secret: the humans are clones.', 'withheld: true\ntitle: The First Folk\n'),
      'Characters/Mara_Quill.md': mara('Mara is human. Human or not, she sails.'),
    };
    const [f] = await found(files, { excluded: ['Heritages/Human.md'] });
    assert.strictEqual(f.name, 'Human');
    assert.match(f.fix, /^"Human" is an everyday word, so every ordinary use of it is reported: rename the note \(Heritages\/Human\.md\)/);
    assert.match(f.fix, /and remove any matching title or aliases; campaign-qa offers to rename it, links included/);
    const caps = await found({ ...files, 'Characters/Mara_Quill.md': mara('Human or not, she sails.') }, { excluded: ['Heritages/Human.md'] });
    assert.match(caps[0].fix, /^reword it/);
    assert.strictEqual(f.everyday, true, 'vault_check prints the fix of a row that carries this');
    assert.strictEqual(caps[0].everyday, undefined);
  });

  it('a one-word title or alias printed in lower case says to take that name off the note; two words never count', async () => {
    const files = {
      'Characters/Vesper_Hale.md': zornNote('withheld: true\naliases: [Hope, Old Nick]\n'),
      'Characters/Mara_Quill.md': mara('There is hope yet. old nick laughs.'),
    };
    const byName = new Map((await found(files, { excluded: ['Characters/Vesper_Hale.md'] })).map((f) => [f.name, f]));
    assert.match(byName.get('Hope').fix, /^"Hope" is an everyday word, so every ordinary use of it is reported: take it out of the title or aliases of Characters\/Vesper_Hale\.md/);
    assert.match(byName.get('Old Nick').fix, /^reword it/);
  });
});

describe('a "stays hidden:" reason beside a Publishing entry', () => {
  it('does not settle the link report of a withheld note', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote('withheld: true\npublish: false\n'), 'Characters/Mara_Quill.md': mara('Met [[Lord_Zorn]].') };
    const { configPath } = site(files, { publish: ['Characters/Mara_Quill.md', 'Characters/Lord_Zorn.md — stays hidden: x'] });
    const { json } = await doctor(configPath, { json: true });
    const hit = json.findings.find((f) => f.code === 'NAMED_NO_PAGE');
    assert.strictEqual(hit.reason, 'stays hidden: x');
    assert.strictEqual(hit.settled, false);
  });
});

describe('every file the build copies is read for a withheld name', () => {
  it('a campaign image, a section banner and a vault font', async () => {
    const extra = [
      '  theme:',
      '    campaign_image: "_attachments/Lord Zorn Crest.png"',
      '    fonts:',
      '      source: local',
      '      files:',
      '        - path: "_attachments/Lord Zorn Serif.woff2"',
      '          family: Zorn Serif',
      '  banners:',
      '    characters/npcs: "_attachments/Lord Zorn Banner.png"',
      '',
    ].join('\n');
    const files = { 'Characters/NPCs/Lord_Zorn.md': zornNote(), 'Characters/NPCs/Mara_Quill.md': mara('Plain.') };
    const binary = {
      '_attachments/Lord Zorn Crest.png': 'x', '_attachments/Lord Zorn Serif.woff2': 'x', '_attachments/Lord Zorn Banner.png': 'x',
    };
    const { configPath } = site(files, { excluded: ['Characters/NPCs/Lord_Zorn.md'], binary, extra });
    const { json } = await doctor(configPath, { json: true });
    const paths = json.findings.filter((f) => f.code === 'WITHHELD_IN_PROSE' && f.path.startsWith('_attachments/')).map((f) => f.path).sort();
    assert.deepStrictEqual(paths, ['_attachments/Lord Zorn Banner.png', '_attachments/Lord Zorn Crest.png', '_attachments/Lord Zorn Serif.woff2']);
  });
});

describe('a withheld name in the label of a link to a published page', () => {
  const base = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Plain.') };
  const noSearch = '  search: false\n';

  for (const [name, options] of [['search on', {}], ['search off', { extra: noSearch }]]) {
    it(`in the body is reported on the page that holds it (${name})`, async () => {
      const files = Object.assign({}, base, { 'Characters/Dax.md': mara("Intro.\n\nDax met [[Mara_Quill|Lord Zorn's friend]] and [[Mara_Quill|Lord Zorn]].") });
      const hits = await found(files, Object.assign({ excluded: ZORN_EXCLUDED }, options));
      assert.deepStrictEqual(hits.map((f) => f.path), ['Characters/Dax.md']);
      assert.match(hits[0].detail, /printed on the page/);
      assert.ok(!/search index/.test(hits[0].detail));
    });
  }

  const fields = [
    ['organization', 'Orgs/Cult.md', 'leadership'], ['organization', 'Orgs/Cult.md', 'territory'], ['npc', 'Characters/Dax.md', 'location'],
    ['event', 'Events/Raid.md', 'location'], ['world_domain', 'World/Law.md', 'summary'],
  ];
  for (const [type, rel, field] of fields) {
    for (const [name, options] of [['search on', {}], ['search off', { extra: noSearch }]]) {
      it(`in ${type} ${field} is reported on that note (${name})`, async () => {
        const files = Object.assign({}, base, { [rel]: `---\ntype: ${type}\n${field}: "[[Mara_Quill|Lord Zorn's man]]"\n---\n\nPlain words.\n` });
        const hits = await found(files, Object.assign({ excluded: ZORN_EXCLUDED }, options));
        assert.ok(hits.some((f) => f.path === rel), `${field}: ${JSON.stringify(hits.map((f) => f.path))}`);
        assert.ok(hits.every((f) => !/search index/.test(f.detail) || f.path !== rel), 'names the page, not the index');
      });
    }
  }

  it('a link whose words are a public name stays unread: a page whose name holds the secret name', async () => {
    const files = Object.assign({}, base, {
      'Characters/Lord_Zorn_Jr.md': mara('The heir.'),
      'Characters/Dax.md': mara('Intro.\n\nDax met [[Lord_Zorn_Jr]] and [[Lord_Zorn_Jr|Lord Zorn Jr]].'),
    });
    // The heir's own title holds the name, and the search index holds it from Dax's text; what
    // Dax's page prints is only that title, so the page itself is not a hit.
    const hits = await found(files, { excluded: ZORN_EXCLUDED });
    assert.deepStrictEqual(hits.filter((f) => f.path === 'Characters/Dax.md' && /printed on the page/.test(f.detail)), []);
  });

  it('a gm_aliases name in a label is an ALIAS_IN_PROSE finding too', async () => {
    const files = { 'Characters/Vesper_Hale.md': npc('x', 'gm_aliases: ["Old Smuggler"]\n'), 'Characters/Mara_Quill.md': mara('Plain.'),
      'Characters/Dax.md': mara('Intro.\n\nDax met [[Mara_Quill|the Old Smuggler\'s friend]].') };
    const hits = await found(files, {}, 'ALIAS_IN_PROSE');
    assert.deepStrictEqual(hits.map((f) => f.path), ['Characters/Dax.md']);
  });
});

describe('an address on a page', () => {
  it('a Markdown link to the withheld note\'s file is reported', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Intro.\n\nSee [the stranger](Lord_Zorn.md), [him](Characters/Lord_Zorn.md) and [x](Lord%20Zorn.md).'),
    };
    const hits = await found(files, { excluded: ZORN_EXCLUDED });
    assert.deepStrictEqual(hits.map((f) => f.path), ['Characters/Mara_Quill.md']);
    assert.match(hits[0].detail, /address of a link/);
  });
  it('the site\'s own addresses (pages, images, scripts) are not read', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Lord_Zorn_Jr.md': mara('The heir.'),
      'Characters/Mara_Quill.md': mara('Intro.\n\nMet [[Lord_Zorn_Jr]]. [heir](lord-zorn-jr.html) [home](../index.html)'),
    };
    const hits = await found(files, { excluded: ZORN_EXCLUDED });
    assert.deepStrictEqual(hits.filter((f) => f.path === 'Characters/Mara_Quill.md' && /printed on the page|address/.test(f.detail)), []);
  });
  it('a hand-written address of a page the site does not have is read (#352)', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote(),
      'Characters/Mara_Quill.md': mara('Intro.\n\nSee [v](lord_zorn.html).'),
    };
    const hits = await found(files, { excluded: ZORN_EXCLUDED });
    assert.deepStrictEqual(hits.map((f) => [f.path, /address of a link/.test(f.detail)]), [['Characters/Mara_Quill.md', true]]);
  });
  // A bare https://… is plain text on the page (the renderer makes no link of it), so it stays a finding of the page's words.
  it('another site\'s address holding the name is told as an address, labelled or written <https://…> (#352)', async () => {
    for (const body of ['See [out](https://example.com/Lord_Zorn).', 'See <https://example.com/Lord_Zorn> here.']) {
      const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara(`Intro.\n\n${body}`) };
      const hits = await found(files, { excluded: ZORN_EXCLUDED });
      assert.deepStrictEqual(hits.map((f) => [f.path, /address of a link/.test(f.detail)]), [['Characters/Mara_Quill.md', true]], body);
    }
  });
});

describe('the link previews file', () => {
  it('is read in its own right: a name only a card holds is reported', async () => {
    const previews = require('../lib/previews');
    const real = previews.buildPreviews;
    previews.buildPreviews = (pages, ctx) => {
      const cards = real(pages, ctx);
      for (const [key, card] of Object.entries(cards)) if (/mara-quill/.test(key)) card.t = `${card.t} (Lord Zorn's)`;
      return cards;
    };
    try {
      const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Plain words.') };
      const hits = await found(files, { excluded: ZORN_EXCLUDED });
      assert.deepStrictEqual(hits.map((f) => f.path), ['Characters/Mara_Quill.md']);
      assert.match(hits[0].detail, /link previews/);
    } finally { previews.buildPreviews = real; }
  });
});

describe('a withheld note\'s aliases written as one value', () => {
  it('a scalar aliases: is searched, and its links print the placeholder', async () => {
    const files = {
      'Characters/Lord_Zorn.md': zornNote('withheld: true\naliases: Old Nick\n'),
      'Characters/Mara_Quill.md': mara('Intro.\n\nOld Nick laughs. Met [[Old Nick]].'),
    };
    const hits = await found(files, { excluded: ZORN_EXCLUDED });
    assert.deepStrictEqual(hits.map((f) => f.name), ['Old Nick']);
    const { configPath, docs } = site(files, { excluded: ZORN_EXCLUDED });
    buildQuiet(configPath);
    assert.ok(fs.readFileSync(path.join(docs, 'characters', 'mara-quill.html'), 'utf8').includes('Met someone.'));
  });
});

describe('secret-name leftovers (#352)', () => {
  it('a plural written with a capital is the name: "the Lord Zorns"', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Intro.\n\nThe Lord Zorns rode out.') };
    assert.deepStrictEqual((await found(files, { excluded: ZORN_EXCLUDED })).map((f) => f.name), [ZORN]);
  });
  it('a name in the first paragraph, which an NPC page also prints as its pull-quote, is printed once', async () => {
    const files = { 'Characters/Lord_Zorn.md': zornNote(), 'Characters/Mara_Quill.md': mara('Lord Zorn rides at dawn.') };
    const [f] = await found(files, { excluded: ZORN_EXCLUDED });
    assert.strictEqual(f.count, 1);
    assert.doesNotMatch(f.detail, /times/);
  });
  it('a PC heading that links a withheld note keeps the PC\'s page whole while sheets are off', () => {
    const sheetsOff = '  character_sheets: false\n  pc_prose_sections:\n    - Background\n';
    for (const heading of ['## [[Lord_Zorn]]', '## Debts to [[Lord_Zorn]]']) {
      const { configPath, docs } = site({
        'Characters/Lord_Zorn.md': zornNote(),
        'PCs/Jean.md': `---\ntype: pc\nplayer_name: Pat\n---\n\n# Jean\n## Background\nRaised in the docks.\n${heading}\nOwes a debt.\n`,
      }, { excluded: ZORN_EXCLUDED, extra: sheetsOff });
      const warnings = buildQuiet(configPath);
      assert.deepStrictEqual(warnings.filter((w) => /changes this note's headings/.test(w)), [], heading);
      const html = fs.readFileSync(path.join(docs, 'pcs', 'jean.html'), 'utf8');
      assert.ok(html.includes('Raised in the docks.') && !html.includes(ZORN), heading);
    }
  });
  it('`withheld : true` (a space before the colon) on a note the scan never reads keeps the flag', async () => {
    for (const key of ['withheld : true', '"withheld": true']) {
      const files = { 'Quiet/Lord_Zorn.md': zornNote(`${key}\n`), 'Characters/Mara_Quill.md': mara('Intro.\n\nLord Zorn rides.') };
      assert.deepStrictEqual((await found(files)).map((f) => f.name), [ZORN], key);
    }
  });
});
