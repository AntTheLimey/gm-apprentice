const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSiteDoctor } = require('../lib/site-doctor');
const { build } = require('../lib/build');
const { summaryLines, kindOfType } = require('../lib/note-faults');

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A site over a small player-mode vault. `files` maps vault paths to text; every note in
// `publish` is listed under Publishing, every `excluded` entry ("path" or "path — reason")
// under Excluded. Folders are mapped to themselves, lower-cased.
function site(files, { publish = null, excluded = [], mode = 'player', extra = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-faults-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/')) folders.add(path.dirname(rel));
  }
  const listed = publish || Object.keys(files).filter((rel) => !excluded.some((e) => e.startsWith(rel)) && !rel.startsWith('_') && !rel.startsWith('Quiet/'));
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_meta', 'publish-manifest.md'), [
    '---', `mode: ${mode}`, '---', '',
    `## Publishing (${listed.length} files)`, '', ...listed.map((rel) => `- [x] ${rel}`), '',
    `## Excluded (${excluded.length} files)`, '', ...excluded.map((e) => `- [x] ${e}`), '',
  ].join('\n'));
  const map = [...folders].filter((f) => !f.startsWith('Quiet')).map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: ${mode}\n${extra}  exclude_dirs:\n    - Quiet\n  folder_map:\n${map}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta', '_Templates'] }));
  return { root, vault, configPath };
}

async function doctor(configPath, extraOptions = {}) {
  const out = [];
  const rc = await runSiteDoctor({ configPath, ...extraOptions }, { out: (l) => out.push(String(l)), detect: () => null });
  return { rc, out, text: out.join('\n'), json: extraOptions.json ? JSON.parse(out.join('')) : null };
}

async function faults(files, options = {}, code = null) {
  const { configPath } = site(files, options);
  const { json } = await doctor(configPath, { json: true });
  return json.findings.filter((f) => (code ? f.code === code : /^(NAMED_NO_PAGE|COMMENT_STRAY|FENCE_UNCLOSED|ALIAS_IN_PROSE)$/.test(f.code)));
}

const npc = (name, body = '', extra = '') => `---\ntype: npc\n${extra}---\n\n${body}\n`;

describe('NAMED_NO_PAGE', () => {
  const base = {
    'Characters/Mara_Quill.md': npc('Mara', 'She met [[Vesper_Hale]] at the quay.'),
    'Characters/Vesper_Hale.md': npc('Vesper', 'Secret: he is the ferryman.'),
  };

  it('the fix says listing under Publishing gives a page only when the manifest is what holds the note back', async () => {
    const byManifest = await faults(base, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.match(byManifest[0].fix, /then list it under Publishing in _meta\/publish-manifest\.md so it gets a page/);
    const byNote = await faults({
      'Characters/Mara_Quill.md': npc('Mara', 'She met [[Vesper_Hale]] at the quay.'),
      'Characters/Vesper_Hale.md': npc('Vesper', 'Secret.', 'publish: false\n'),
    }, {}, 'NAMED_NO_PAGE');
    assert.strictEqual(byNote[0].why, 'PUBLISH_FALSE');
    assert.ok(!/so it gets a page/.test(byNote[0].fix), byNote[0].fix);
    assert.match(byNote[0].fix, /the manifest is not what keeps it off the site \(PUBLISH_FALSE\): run explain "Characters\/Vesper_Hale\.md" for the rule/);
    assert.match(byNote[0].fix, /stays hidden: <why>/);
  });

  it('finds a withheld note named, as plain words, on a published page', async () => {
    const found = await faults(base, { excluded: ['Characters/Vesper_Hale.md — page body reveals the ferry'] }, 'NAMED_NO_PAGE');
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(found[0], {
      code: 'NAMED_NO_PAGE',
      severity: 'warning',
      path: 'Characters/Vesper_Hale.md',
      detail: found[0].detail,
      fix: found[0].fix,
      why: 'MANIFEST_EXCLUDED',
      reason: 'page body reveals the ferry',
      pages: ['Characters/Mara_Quill.md'],
      pageCount: 1,
      printed: ['Vesper Hale'],
      kind: 'entity',
      type: 'npc',
      settled: false,
    });
    assert.match(found[0].detail, /Vesper Hale/);
    assert.match(found[0].fix, /GM Notes/);
  });

  it('is silent when the linked note has a page', async () => {
    assert.deepStrictEqual(await faults(base, {}, 'NAMED_NO_PAGE'), []);
  });

  it('is silent when the link points at no note at all (that is LINK_UNRESOLVED)', async () => {
    const files = { 'Characters/Mara_Quill.md': npc('Mara', 'She met [[Nobody_Here]].') };
    assert.deepStrictEqual(await faults(files, {}, 'NAMED_NO_PAGE'), []);
  });

  it('does not count a link the page strips: GM Notes, gm-only, a comment, a fence the strip keeps out', async () => {
    const body = [
      'Open text.', '',
      '## GM Notes', '', 'She met [[Vesper_Hale]].', '',
    ].join('\n');
    const files = Object.assign({}, base, { 'Characters/Mara_Quill.md': npc('Mara', body) });
    assert.deepStrictEqual(await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE'), []);
    for (const hidden of ['<!-- gm-only -->\n[[Vesper_Hale]]\n<!-- /gm-only -->', '%% [[Vesper_Hale]] %%', '<!-- [[Vesper_Hale]] -->']) {
      const f2 = Object.assign({}, base, { 'Characters/Mara_Quill.md': npc('Mara', `Text.\n\n${hidden}\n`) });
      assert.deepStrictEqual(await faults(f2, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE'), [], hidden);
    }
  });

  it('prints the label of a labelled link, and says so', async () => {
    const files = Object.assign({}, base, { 'Characters/Mara_Quill.md': npc('Mara', 'She met [[Vesper_Hale|the hooded ferryman]].') });
    const [f] = await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(f.printed, ['the hooded ferryman']);
  });

  it('counts every page naming it, whole, sorted, and lists each printed spelling once', async () => {
    const files = Object.assign({}, base, {
      'Characters/Zed.md': npc('Z', 'Saw [[Vesper_Hale]] and [[Vesper_Hale|the ferryman]].'),
      'Characters/Abe.md': npc('A', '[[Vesper_Hale]] again.'),
    });
    const [f] = await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(f.pages, ['Characters/Abe.md', 'Characters/Mara_Quill.md', 'Characters/Zed.md']);
    assert.strictEqual(f.pageCount, 3);
    assert.deepStrictEqual(f.printed, ['Vesper Hale', 'the ferryman']);
  });

  it('counts a link in a frontmatter field the page prints, not in one it does not', async () => {
    const files = {
      'Items/Brass_Key.md': '---\ntype: item\ncurrent_holder: "[[Vesper_Hale]]"\n---\n\nA key.\n',
      'Items/Old_Coin.md': '---\ntype: item\nsession: "[[Vesper_Hale]]"\ntags: ["[[Vesper_Hale]]"]\n---\n\nA coin.\n',
      'Characters/Vesper_Hale.md': npc('V', 'x'),
    };
    const [f] = await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(f.pages, ['Items/Brass_Key.md']);
  });

  it('counts the target of a relationship', async () => {
    const files = {
      'Characters/Mara_Quill.md': '---\ntype: npc\nrelationships:\n  - target: "[[Vesper_Hale]]"\n    type: ally\n---\n\nx\n',
      'Characters/Vesper_Hale.md': npc('V', 'x'),
    };
    const [f] = await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(f.pages, ['Characters/Mara_Quill.md']);
  });

  it('does not count a note whose name is also a published page', async () => {
    const files = Object.assign({}, base, {
      'Characters/Mara_Quill.md': npc('Mara', 'See [[Vesper_Hale]].'),
      'Locations/Vesper_Hale.md': '---\ntype: location\n---\n\nA place.\n',
    });
    // Two notes share a name; the published one claims it.
    assert.deepStrictEqual(await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE'), []);
  });

  it('does not count an image embed, even when a hidden note has the image\'s name', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'See ![[Sketch.png]] here.'),
      'Characters/Sketch.png.md': npc('S', 'Notes about the sketch.'),
    };
    assert.deepStrictEqual(await faults(files, { excluded: ['Characters/Sketch.png.md'] }, 'NAMED_NO_PAGE'), []);
    // The same note linked as a note is counted: the embed above was left out for being an image.
    files['Characters/Mara_Quill.md'] = npc('Mara', 'See [[Sketch.png]] here.');
    assert.strictEqual((await faults(files, { excluded: ['Characters/Sketch.png.md'] }, 'NAMED_NO_PAGE')).length, 1);
  });

  it('does not count a hidden note whose name is an alias of a published page', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[The_Ferryman]].', 'aliases: ["The_Ferryman"]\n'),
      'Characters/The_Ferryman.md': npc('F', 'x'),
    };
    assert.deepStrictEqual(await faults(files, { excluded: ['Characters/The_Ferryman.md'] }, 'NAMED_NO_PAGE'), []);
  });

  it('reads a note in an excluded folder (DIR_EXCLUDED) and one with no type (NO_TYPE, kind null)', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[Hidden_Hall]] and [[Loose_Note]].'),
      'Quiet/Hidden_Hall.md': '---\ntype: location\n---\n\nx\n',
      'Characters/Loose_Note.md': 'no frontmatter at all\n',
    };
    const found = await faults(files, {}, 'NAMED_NO_PAGE');
    const byPath = Object.fromEntries(found.map((f) => [f.path, f]));
    assert.strictEqual(byPath['Quiet/Hidden_Hall.md'].why, 'DIR_EXCLUDED');
    assert.strictEqual(byPath['Quiet/Hidden_Hall.md'].kind, 'entity');
    assert.strictEqual(byPath['Characters/Loose_Note.md'].why, 'NO_TYPE');
    assert.strictEqual(byPath['Characters/Loose_Note.md'].kind, null);
    assert.strictEqual(byPath['Characters/Loose_Note.md'].type, null);
  });

  it('a note a manifest leaves unlisted says MANIFEST_UNLISTED; one under Needs Decision, MANIFEST_NEEDS_DECISION', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[Pending_One]] and [[Unlisted_One]].'),
      'Characters/Pending_One.md': npc('P', 'x'),
      'Characters/Unlisted_One.md': npc('U', 'x'),
    };
    const { vault, configPath } = site(files, { publish: ['Characters/Mara_Quill.md'] });
    fs.appendFileSync(path.join(vault, '_meta', 'publish-manifest.md'), '\n## Needs Decision (1 files)\n\n- [ ] Characters/Pending_One.md\n');
    const { json } = await doctor(configPath, { json: true });
    const why = Object.fromEntries(json.findings.filter((f) => f.code === 'NAMED_NO_PAGE').map((f) => [f.path, f.why]));
    assert.deepStrictEqual(why, {
      'Characters/Pending_One.md': 'MANIFEST_NEEDS_DECISION',
      'Characters/Unlisted_One.md': 'MANIFEST_UNLISTED',
    });
  });

  it('decides entity or working from the type', () => {
    for (const t of ['npc', 'pc', 'location', 'faction', 'organization', 'item', 'clue', 'document', 'event', 'creature']) {
      assert.strictEqual(kindOfType(t), 'entity', t);
    }
    for (const t of ['plan', 'session', 'session_wrap', 'session-plan', 'scene', 'campaign_overview', 'chapter', 'Session_Plan', 'something_new']) {
      assert.strictEqual(kindOfType(t), 'working', t);
    }
    assert.strictEqual(kindOfType(undefined), null);
    assert.strictEqual(kindOfType(''), null);
  });

  it('settles on a "stays hidden:" reason (case and spaces forgiven), and keeps an ordinary reason unsettled', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[Vesper_Hale]], [[Ada_Moor]], [[Cy_Dunn]], [[Bo_Pike]].'),
      'Characters/Vesper_Hale.md': npc('V', 'x'),
      'Characters/Ada_Moor.md': npc('A', 'x'),
      'Characters/Cy_Dunn.md': npc('C', 'x'),
      'Characters/Bo_Pike.md': npc('B', 'x'),
    };
    const found = await faults(files, {
      excluded: [
        'Characters/Vesper_Hale.md — stays hidden: the ferry is the twist',
        'Characters/Ada_Moor.md — Stays Hidden:   she is a plant',
        'Characters/Cy_Dunn.md —   STAYS HIDDEN:no space after',
        'Characters/Bo_Pike.md — page reveals the vault key',
      ],
    }, 'NAMED_NO_PAGE');
    const settled = Object.fromEntries(found.map((f) => [path.basename(f.path), f.settled]));
    assert.deepStrictEqual(settled, { 'Vesper_Hale.md': true, 'Ada_Moor.md': true, 'Cy_Dunn.md': true, 'Bo_Pike.md': false });
    assert.strictEqual(found.find((f) => f.path.endsWith('Bo_Pike.md')).reason, 'page reveals the vault key');
    assert.strictEqual(found.find((f) => f.path.endsWith('Vesper_Hale.md')).reason, 'stays hidden: the ferry is the twist');
  });

  it('a "stays hidden:" reason beside a Publishing entry is not settled (only an Excluded entry is)', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[Vesper_Hale]].'),
      // Listed under Publishing, and kept off the site by its own frontmatter.
      'Characters/Vesper_Hale.md': npc('V', 'x', 'publish: false\n'),
    };
    const { vault, configPath } = site(files, { publish: ['Characters/Mara_Quill.md', 'Characters/Vesper_Hale.md — stays hidden: x'] });
    assert.match(fs.readFileSync(path.join(vault, '_meta', 'publish-manifest.md'), 'utf8'), /## Publishing[^#]*Vesper_Hale\.md — stays hidden: x/);
    const { json } = await doctor(configPath, { json: true });
    const found = json.findings.find((f) => f.code === 'NAMED_NO_PAGE');
    assert.strictEqual(found.reason, 'stays hidden: x');
    assert.strictEqual(found.settled, false);
  });

  it('reads a GM alias link as naming the note that owns it, printing the owner\'s title', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('Mara', 'Met [[Old_Smuggler]].'),
      'Characters/Vesper_Hale.md': npc('V', 'x', 'gm_aliases: ["Old_Smuggler"]\n'),
    };
    const [f] = await faults(files, { excluded: ['Characters/Vesper_Hale.md'] }, 'NAMED_NO_PAGE');
    assert.strictEqual(f.path, 'Characters/Vesper_Hale.md');
    assert.deepStrictEqual(f.printed, ['Vesper Hale']);
  });
});

describe('NAMED_NO_PAGE with the rest of the audit', () => {
  it('reads a grouped Excluded reason ("- Reason: stays hidden: ...") as settling the notes under it', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', 'Met [[Vesper_Hale]].'),
      'Characters/Vesper_Hale.md': npc('V', 'x'),
    };
    const { vault, configPath } = site(files, { publish: ['Characters/Mara_Quill.md'] });
    fs.appendFileSync(path.join(vault, '_meta', 'publish-manifest.md'),
      '\n## Excluded (1 files)\n\n- Reason: stays hidden: the ferry is the twist\n  - Characters/Vesper_Hale.md\n');
    const { json } = await doctor(configPath, { json: true });
    const [f] = json.findings.filter((x) => x.code === 'NAMED_NO_PAGE');
    assert.strictEqual(f.settled, true);
    assert.strictEqual(f.reason, 'stays hidden: the ferry is the twist');
  });

  it('leaves a name that LINK_UNRESOLVED would repeat to NAMED_NO_PAGE, and still reports a typo', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', 'Met [[Vesper_Hale]] and [[Vesper_Hael]].'),
      'Characters/Vesper_Hale.md': npc('V', 'x'),
    };
    const { configPath } = site(files, { excluded: ['Characters/Vesper_Hale.md'] });
    const { json } = await doctor(configPath, { json: true });
    assert.deepStrictEqual(json.findings.filter((f) => f.code === 'LINK_UNRESOLVED').map((f) => f.detail.split(' ')[0]), ['[[Vesper_Hael]]']);
    assert.strictEqual(json.findings.filter((f) => f.code === 'NAMED_NO_PAGE').length, 1);
  });

  it('names a world-flags note, which the build never gives a page, as a working note', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', 'See [[Flags_Tracker]].'),
      'Characters/Flags_Tracker.md': '---\ntype: world_flags\n---\n\nx\n',
    };
    const [f] = await faults(files, {}, 'NAMED_NO_PAGE');
    assert.strictEqual(f.why, 'TYPE_NEVER_PUBLISHES');
    assert.strictEqual(f.kind, 'working');
  });
});

describe('COMMENT_STRAY', () => {
  it('is silent for a clean comment, inline or block, and for one in code or a gm-only block', async () => {
    const body = ['A %% private note %% line.', '', '%%', 'block', '%%', '', '```', '50%% in code', '```', '', '<!-- gm-only -->', '50%% x', '<!-- /gm-only -->', '', 'Done.'].join('\n');
    assert.deepStrictEqual(await faults({ 'Characters/Mara_Quill.md': npc('M', body) }, {}, 'COMMENT_STRAY'), []);
  });

  it('finds an unclosed %% and names the line in the file, frontmatter counted', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\n---\n\nFirst line.\nShe paid 50%% up front.\nThen left.\n' };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.deepStrictEqual(f, {
      code: 'COMMENT_STRAY', severity: 'warning', path: 'Characters/Mara_Quill.md',
      detail: f.detail, fix: f.fix,
      where: 'body', kind: 'UNCLOSED', line: 6, field: null, text: 'She paid 50%% up front.',
    });
    assert.match(f.detail, /hides the rest of the note/);
  });

  it('finds a glued pair, which hides what lies between', async () => {
    const files = { 'Characters/Mara_Quill.md': npc('M', 'It rose 100%% by noon and 50%% by dusk, so the middle is lost.') };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.strictEqual(f.kind, 'GLUED');
    assert.match(f.detail, /between/);
  });

  it('finds a stray in a frontmatter value', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "50%% off"\n---\n\nFine.\n' };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.strictEqual(f.where, 'frontmatter');
    assert.strictEqual(f.field, 'occupation');
    assert.strictEqual(f.kind, 'UNCLOSED');
    assert.strictEqual(f.line, null);
    assert.strictEqual(f.text, '50%% off');
  });

  it('finds an HTML comment never closed in a frontmatter value, and says what to add', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "Baker <!-- and a spy"\n---\n\nFine.\n' };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.deepStrictEqual(f, {
      code: 'COMMENT_STRAY', severity: 'warning', path: 'Characters/Mara_Quill.md',
      detail: 'the occupation: value holds a <!-- that is never closed, so it hides the rest of the value',
      fix: 'add the closing --> where the comment ends, or take the <!-- out',
      where: 'frontmatter', kind: 'UNCLOSED', mark: '<!--', line: null, field: 'occupation', text: 'Baker <!-- and a spy',
    });
  });

  it('finds a hidden block never closed in a frontmatter value', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "Baker <!-- GM-ONLY --> and a spy"\n---\n\nFine.\n' };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.strictEqual(f.detail, 'the occupation: value holds a <!-- gm-only --> that is never closed, so it hides the rest of the value');
    assert.strictEqual(f.fix, 'add the closing <!-- /gm-only --> where the hidden text ends, or take the marker out');
  });

  it('is silent for a closed HTML comment or hidden block in a frontmatter value', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "Baker <!-- note --> and <!-- gm-only -->spy<!-- /gm-only -->"\n---\n\nFine.\n' };
    assert.deepStrictEqual(await faults(files, {}, 'COMMENT_STRAY'), []);
  });

  it('is silent for a clean comment in a frontmatter value', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "Baker %% note %%"\n---\n\nFine.\n' };
    assert.deepStrictEqual(await faults(files, {}, 'COMMENT_STRAY'), []);
  });

  it('reads a note saved with CRLF line endings', async () => {
    const files = { 'Characters/Mara_Quill.md': '---\r\ntype: npc\r\n---\r\n\r\nOne.\r\nTwo 50%% off.\r\n' };
    const [f] = await faults(files, {}, 'COMMENT_STRAY');
    assert.strictEqual(f.line, 6);
    assert.strictEqual(f.text, 'Two 50%% off.');
  });

  it('only reports a note that publishes', async () => {
    const files = { 'Characters/Mara_Quill.md': npc('M', 'x 50%% y') };
    assert.deepStrictEqual(await faults(files, { publish: [] }, 'COMMENT_STRAY'), []);
  });
});

describe('FENCE_UNCLOSED', () => {
  it('is silent for a closed fence, even with markers below it', async () => {
    const body = '```\ncode\n```\n\n<!-- gm-only -->\nsecret\n<!-- /gm-only -->\n';
    assert.deepStrictEqual(await faults({ 'Characters/Mara_Quill.md': npc('M', body) }, {}, 'FENCE_UNCLOSED'), []);
  });

  it('is silent for an unclosed fence with nothing hidden below it', async () => {
    assert.deepStrictEqual(await faults({ 'Characters/Mara_Quill.md': npc('M', '```\ncode only') }, {}, 'FENCE_UNCLOSED'), []);
  });

  it('finds an unclosed fence with a gm-only block below it, with file lines', async () => {
    const body = 'Intro.\n\n```\ncode\n\n<!-- gm-only -->\nthe secret\n<!-- /gm-only -->\n';
    const [f] = await faults({ 'Characters/Mara_Quill.md': npc('M', body) }, {}, 'FENCE_UNCLOSED');
    assert.deepStrictEqual(f, {
      code: 'FENCE_UNCLOSED', severity: 'warning', path: 'Characters/Mara_Quill.md',
      detail: f.detail, fix: f.fix,
      line: 7, marker: 'gm-only', markerLine: 10, text: '```',
    });
    assert.match(f.fix, /closing/);
  });

  it('finds the other markers: %%, spoiler, an html comment', async () => {
    for (const [below, marker] of [['%% note %%', '%%'], ['<!-- spoiler -->\nx\n<!-- /spoiler -->', 'spoiler'], ['<!-- a note -->', '<!--']]) {
      const [f] = await faults({ 'Characters/Mara_Quill.md': npc('M', `~~~\ncode\n${below}\n`) }, {}, 'FENCE_UNCLOSED');
      assert.strictEqual(f.marker, marker, below);
    }
  });
});

describe('ALIAS_IN_PROSE', () => {
  const owner = { 'Characters/Vesper_Hale.md': npc('V', 'x', 'gm_aliases: ["Old Smuggler"]\n') };

  it('finds a GM alias in the text of a published page, with the sentence', async () => {
    const files = Object.assign({}, owner, { 'Characters/Mara_Quill.md': npc('M', 'Everyone feared the old smuggler of the quay.') });
    const [f] = await faults(files, {}, 'ALIAS_IN_PROSE');
    assert.deepStrictEqual(f, {
      code: 'ALIAS_IN_PROSE', severity: 'warning', path: 'Characters/Mara_Quill.md',
      detail: f.detail, fix: f.fix,
      // As often as the page prints it: an NPC page prints its opening line twice (the pull quote).
      alias: 'Old Smuggler', owner: 'Characters/Vesper_Hale.md', count: 2,
      context: 'Everyone feared the old smuggler of the quay.',
    });
    assert.match(f.fix, /public name/);
    assert.match(f.fix, /link the name/);
  });

  it('shows the sentence as the page prints it', async () => {
    const files = Object.assign({}, owner, { 'Characters/Mara_Quill.md': npc('M', 'She met [[Vesper_Hale]] and the **old** smuggler.') });
    const [f] = await faults(files, {}, 'ALIAS_IN_PROSE');
    assert.strictEqual(f.context, 'She met Vesper Hale and the old smuggler.');
  });

  it('counts each page once per alias, with how many times it appears', async () => {
    const files = Object.assign({}, owner, { 'Characters/Mara_Quill.md': npc('M', 'Intro.\n\n## Rumours\n\nThe Old Smuggler. Then the old smuggler again.') });
    const found = await faults(files, {}, 'ALIAS_IN_PROSE');
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].count, 2);
  });

  it('is silent when the name is inside a link, or only part of a longer word', async () => {
    const files = Object.assign({}, owner, {
      'Characters/Mara_Quill.md': npc('M', 'See [[Vesper_Hale|Old Smuggler]] and the old smugglers guild.'),
    });
    assert.deepStrictEqual(await faults(files, {}, 'ALIAS_IN_PROSE'), []);
  });

  it('is silent when the name sits in text the page strips', async () => {
    const files = Object.assign({}, owner, {
      'Characters/Mara_Quill.md': npc('M', 'Text.\n\n## GM Notes\n\nThe old smuggler.\n'),
    });
    assert.deepStrictEqual(await faults(files, {}, 'ALIAS_IN_PROSE'), []);
  });

  it('is silent when the alias is also the name of a published page', async () => {
    const files = Object.assign({}, owner, {
      'Characters/Old_Smuggler.md': npc('O', 'A real, public person.'),
      'Characters/Mara_Quill.md': npc('M', 'The old smuggler waved.'),
    });
    assert.deepStrictEqual(await faults(files, {}, 'ALIAS_IN_PROSE'), []);
  });

  it('is silent when no note declares a GM alias', async () => {
    assert.deepStrictEqual(await faults({ 'Characters/Mara_Quill.md': npc('M', 'Plain text.') }, {}, 'ALIAS_IN_PROSE'), []);
  });

  it('reads an alias given as a bare scalar', async () => {
    const files = {
      'Characters/Vesper_Hale.md': npc('V', 'x', 'gm_aliases: Old Smuggler\n'),
      'Characters/Mara_Quill.md': npc('M', 'The old smuggler waved.'),
    };
    assert.strictEqual((await faults(files, {}, 'ALIAS_IN_PROSE')).length, 1);
  });
});

describe('doctor --site report', () => {
  const many = () => {
    const files = { 'Characters/Hub.md': npc('Hub', Array.from({ length: 25 }, (_, i) => `[[Ghost_${String(i).padStart(2, '0')}]]`).join(' ')) };
    const excluded = [];
    for (let i = 0; i < 25; i++) {
      const rel = `Characters/Ghost_${String(i).padStart(2, '0')}.md`;
      files[rel] = npc('G', 'x');
      excluded.push(i === 0 ? `${rel} — stays hidden: ok` : rel);
    }
    return { files, excluded };
  };

  it('lists the new codes in the human report with a fix line, and leaves a settled finding out', async () => {
    const { files, excluded } = many();
    const { configPath } = site(files, { excluded });
    const { text } = await doctor(configPath);
    assert.match(text, /^NAMED_NO_PAGE \(24 warnings\)$/m);
    assert.ok(!text.includes('Ghost_00.md'));
    assert.match(text, /^ {2}Characters\/Ghost_01\.md — /m);
    assert.match(text, /^ {6}→ .*GM Notes/m);
    assert.match(text, /— 0 errors, 24 warnings$/m);
  });

  it('caps the human list and says how many more; the JSON is whole and carries the settled one', async () => {
    const { files, excluded } = many();
    const { configPath } = site(files, { excluded });
    const { text } = await doctor(configPath);
    assert.match(text, /^ {2}\+4 more — /m);
    const { json } = await doctor(configPath, { json: true });
    const named = json.findings.filter((f) => f.code === 'NAMED_NO_PAGE');
    assert.strictEqual(named.length, 25);
    assert.strictEqual(named.filter((f) => f.settled).length, 1);
    assert.strictEqual(json.counts.warnings, 24);
    assert.strictEqual(json.counts.settled, 1);
    assert.strictEqual(json.ok, true);
  });

  it('exits 0: these are warnings', async () => {
    const { configPath } = site({ 'Characters/Mara_Quill.md': npc('M', 'a 50%% b') });
    assert.strictEqual((await doctor(configPath)).rc, 0);
  });

  it('a vault with no fault says no findings and shows none of the codes', async () => {
    const { configPath } = site({ 'Characters/Mara_Quill.md': npc('M', 'Plain.') });
    const { text } = await doctor(configPath);
    assert.match(text, /No findings\./);
  });
});

describe('the build stays quiet, then says one line per code', () => {
  let lastWarnings = [];
  function buildWarnings(configPath) {
    const warns = [];
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = (...a) => warns.push(a.join(' '));
    try { build({ configPath }); } finally { console.log = log; console.warn = warn; }
    lastWarnings = warns;
    return warns.filter((w) => /Site Faults/.test(w));
  }

  it('prints nothing for a vault with no fault', () => {
    const { configPath } = site({ 'Characters/Mara_Quill.md': npc('M', 'Plain.') });
    assert.deepStrictEqual(buildWarnings(configPath), []);
  });

  it('the build line counts one as a stray comment mark', () => {
    const { configPath } = site({
      'Characters/Mara_Quill.md': '---\ntype: npc\noccupation: "Baker <!-- and a spy"\n---\n\nFine.\n',
      'Characters/Other.md': npc('O', 'It is 50%% off.'),
    });
    assert.deepStrictEqual(buildWarnings(configPath), [
      "  WARNING: 2 stray comment marks in published notes (Characters/Mara_Quill.md occupation:, Characters/Other.md line 5) — campaign-qa's Site Faults check fixes these.",
    ]);
  });

  it('prints one line per code: the count, the worst three by pages, and where to go', () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', 'a [[G1]] [[G2]] [[G3]] [[G4]] 50%% b'),
      'Characters/Other.md': npc('O', '[[G1]] [[G2]] [[G3]]'),
      'Characters/Third.md': npc('T', '[[G1]] [[G2]]'),
      'Characters/Fourth.md': npc('F', '[[G1]]'),
      'Characters/G1.md': npc('x', 'x'),
      'Characters/G2.md': npc('x', 'x'),
      'Characters/G3.md': npc('x', 'x'),
      'Characters/G4.md': npc('x', 'x'),
    };
    const { configPath } = site(files, { excluded: ['Characters/G1.md', 'Characters/G2.md', 'Characters/G3.md', 'Characters/G4.md'] });
    const lines = buildWarnings(configPath);
    assert.strictEqual(lines.length, 2, lines.join('\n'));
    const named = lines.find((l) => /no page/.test(l));
    assert.strictEqual(named,
      "  WARNING: 4 notes are named on published pages but have no page, so the name prints as plain words (most named: G1 4 pages, G2 3 pages, G3 2 pages) — campaign-qa's Site Faults check fixes these.");
    const stray = lines.find((l) => /%%/.test(l));
    assert.strictEqual(stray,
      "  WARNING: 1 stray %% in published notes (Characters/Mara_Quill.md line 5) — campaign-qa's Site Faults check fixes it.");
  });

  it('comes after every other warning', () => {
    const { configPath } = site({ 'Characters/Mara_Quill.md': npc('M', 'a [[Gone]] 50%% b'), 'Characters/Gone.md': npc('G', 'x') }, { excluded: ['Characters/Gone.md'] });
    assert.strictEqual(buildWarnings(configPath).length, 2);
    const others = lastWarnings.filter((w) => !/Site Faults/.test(w));
    assert.ok(others.length > 0, 'the fixture should carry another warning (settings left in vault.config.json)');
    assert.ok(lastWarnings.lastIndexOf(others[others.length - 1]) < lastWarnings.findIndex((w) => /Site Faults/.test(w)));
  });

  it('leaves settled findings out of the count, and prints no line when all are settled', () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', '[[G1]] [[G2]]'),
      'Characters/G1.md': npc('x', 'x'),
      'Characters/G2.md': npc('x', 'x'),
    };
    const one = site(files, { excluded: ['Characters/G1.md — stays hidden: yes', 'Characters/G2.md'] });
    assert.match(buildWarnings(one.configPath)[0], /^ {2}WARNING: 1 note is named/);
    const none = site(files, { excluded: ['Characters/G1.md — stays hidden: yes', 'Characters/G2.md — stays hidden: also'] });
    assert.deepStrictEqual(buildWarnings(none.configPath), []);
  });

  it('says it for an alias, a fence and a singular count', () => {
    const files = {
      'Characters/Vesper_Hale.md': npc('V', 'x', 'gm_aliases: ["Old Smuggler"]\n'),
      'Characters/Mara_Quill.md': npc('M', 'The old smuggler.\n\n```\ncode\n<!-- gm-only -->\nx\n<!-- /gm-only -->\n'),
    };
    const lines = buildWarnings(site(files).configPath);
    assert.ok(lines.some((l) => /^ {2}WARNING: 1 GM alias is printed on published pages \(Old Smuggler 1 page\)/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /^ {2}WARNING: 1 published note has a code fence that never closes, so hidden text below it is published \(Characters\/Mara_Quill\.md line 7\)/.test(l)), lines.join('\n'));
  });

  it('builds and the doctor return the same findings on one vault', async () => {
    const files = {
      'Characters/Mara_Quill.md': npc('M', 'Met [[Vesper_Hale]], and the old smuggler.\n\n```\nx\n<!-- spoiler -->\n'),
      'Characters/Cyra_Fenn.md': npc('C', 'It cost 50%% off the price.'),
      'Characters/Vesper_Hale.md': npc('V', 'x', 'gm_aliases: ["Old Smuggler"]\n'),
      'Items/Brass_Key.md': '---\ntype: item\ncurrent_holder: "[[Vesper_Hale]]"\noccupation: "a%% b"\n---\n\nKey.\n',
      'Sessions/Session_1.md': '---\ntype: session\nstatus: played\n---\n\n[[Vesper_Hale]] 9%% x\n',
      'Sessions/Session_1_Wrap.md': '---\ntype: session_wrap\nsession: "[[Session_1]]"\n---\n\n## Narrative Recap\n\nThey met [[Vesper_Hale]] again.\n',
      'Quiet/Hidden_Hall.md': '---\ntype: location\n---\n\nx\n',
      'Characters/Stubby.md': '---\ntype: npc\npublish: stub\npublish_include_sections: ["Public"]\n---\n\n## Public\n\nHello.\n\n## Hidden\n\nx 40%% y [[Vesper_Hale]]\n',
    };
    const { configPath } = site(files, { excluded: ['Characters/Vesper_Hale.md — a reason'] });
    const { json } = await doctor(configPath, { json: true });
    const fromDoctor = json.findings.filter((f) => /^(NAMED_NO_PAGE|COMMENT_STRAY|FENCE_UNCLOSED|ALIAS_IN_PROSE)$/.test(f.code));
    assert.ok(fromDoctor.length >= 5, JSON.stringify(fromDoctor));
    let fromBuild = null;
    const log = console.log; const warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { build({ configPath, onNoteFaults: (found) => { fromBuild = found; } }); } finally { console.log = log; console.warn = warn; }
    assert.deepStrictEqual(fromBuild, fromDoctor);
  });
});

describe('summaryLines', () => {
  it('is empty for no findings', () => {
    assert.deepStrictEqual(summaryLines([]), []);
  });
});
