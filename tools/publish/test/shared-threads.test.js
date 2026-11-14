const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build } = require('../lib/build');
const { sharedEntries, withSharedThreads } = require('../lib/shared-threads');
const { strippedLines } = require('../lib/processor');
const { settingsText, NEW_FILE } = require('./helpers/vault-files');
const { writeNewConfig } = require('./helpers/settings-files');
const { writePublishList } = require('./helpers/publish-list');

const FIXTURE = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'shared-threads');
// A CRLF checkout (Windows) gives the fixtures CRLF endings: read them as LF, so the assertions and the `replace`s
// below see the text they are written for.
const lf = (text) => text.replace(/\r\n/g, '\n');
const overview = () => lf(fs.readFileSync(path.join(FIXTURE, 'Campaign Overview.md'), 'utf8'));
const pc = (name) => lf(fs.readFileSync(path.join(FIXTURE, 'PCs', `${name}.md`), 'utf8'));
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shared-thread-vectors.json'), 'utf8'));

function buildVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-build-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; console.log = () => {};
  try { build({ configPath }); } finally { console.log = real; }
  return { read: (...p) => fs.readFileSync(path.join(root, 'docs', ...p), 'utf8') };
}

// The page with every GM-marked block (and its nested divs) taken out: what a reader of the GM page sees unmarked.
function unmarked(html) {
  let out = '';
  let i = 0;
  const open = /<(div|span) class="gm-mark[^"]*"/g;
  for (;;) {
    open.lastIndex = i;
    const m = open.exec(html);
    if (!m) return out + html.slice(i);
    out += html.slice(i, m.index);
    const tag = m[1];
    const re = new RegExp(`<(/?)${tag}\\b`, 'g');
    re.lastIndex = m.index;
    let depth = 0;
    let n;
    while ((n = re.exec(html))) {
      depth += n[1] ? -1 : 1;
      if (depth === 0) { i = html.indexOf('>', n.index) + 1; break; }
    }
    if (depth !== 0) return out;
  }
}

const CONFIG = settingsText({ 'player_site.title': 'T', 'player_site.folder_map': { PCs: 'pcs' } });

test('shared threads: reads the entries the Python writer writes', () => {
  const entries = sharedEntries(overview());
  assert.strictEqual(entries.length, 2, 'the plain bullet under GM Notes is not read');
  assert.deepStrictEqual(entries[0], { markdown: "- **The missing ledger** — Harrow Ford's toll keeper wants it back — since Session 2", involves: [], party: true });
  assert.deepStrictEqual(entries[1].involves, ['Ines_Marlowe', 'Corwin_Hale']);
  assert.strictEqual(entries[1].party, false);
  const noSince = sharedEntries('## Open Threads\n\n- A thing — involves [[Tobin]]\n- Hand-written, no tail\n');
  assert.deepStrictEqual(noSince, [{ markdown: '- A thing', involves: ['Tobin'], party: false }]);
});

// The same input as tests/test_threads.py NESTED: a nested bullet belongs to the thread above it.
const NESTED = '# T\n\n## Open Threads\n\n'
  + '- **Bell** — rings at dusk — since Session 2; involves [[Ines_Marlowe]]\n'
  + '  - the sexton knows\n'
  + '    more of the sexton\n'
  + '- **Ledger** — involves the party\n\n## Key\n\nK.\n';

test('shared threads: a nested bullet is part of the thread above, as Python reads it', () => {
  assert.deepStrictEqual(sharedEntries(NESTED), [
    { markdown: '- **Bell** — rings at dusk; the sexton knows more of the sexton — since Session 2', involves: ['Ines_Marlowe'], party: false },
    { markdown: '- **Ledger**', involves: [], party: true },
  ]);
  // A nested bullet with a tail of its own is still not a thread.
  const tailed = '## Open Threads\n\n- Parent — involves [[A]]\n  - child — involves [[B]]\n';
  assert.deepStrictEqual(sharedEntries(tailed).map((e) => e.involves), [['A']]);
});

// The same vectors pin threads.py `shared_threads` (tests/test_threads.py), so the two read one thread alike.
test('shared threads: each thread is read whole, as Python reads it', () => {
  for (const c of VECTORS.cases) assert.deepStrictEqual(sharedEntries(c.markdown), c.entries, c.about);
  // CRLF reads as LF.
  for (const c of VECTORS.cases) assert.deepStrictEqual(sharedEntries(c.markdown.replace(/\n/g, '\r\n')), c.entries, c.about);
});

test('shared threads: they go in before the first subsection of Current Status', () => {
  const page = '# P\n\n## Current Status\n\n**Location:** dock\n\n### GM Notes\n\nS.\n\n## Notes\n';
  assert.strictEqual(withSharedThreads(page, [{ markdown: '- a', involves: [], party: true }]),
    '# P\n\n## Current Status\n\n**Location:** dock\n\n**Shared threads:**\n- a\n\n### GM Notes\n\nS.\n\n## Notes\n');
  const fenced = '## Current Status\n\nX.\n```\n### not one\n```\n';
  assert.match(withSharedThreads(fenced, [{ markdown: '- a', involves: [], party: true }]), /```\n\n\*\*Shared threads:\*\*\n- a\n$/);
});

for (const site of ['player', 'gm']) {
  test(`shared threads: a Current Status ending in a GM Notes subsection still shows them (${site} site)`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-sub-'));
    const vault = path.join(root, 'vault');
    const notes = {
      'Campaign Overview.md': overview(),
      'PCs/Corwin_Hale.md': pc('Corwin_Hale').replace('\n## Notes', '\n### GM Notes\n\nThe lamp is his.\n\n## Notes'),
    };
    for (const [rel, text] of Object.entries(notes)) {
      fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
      fs.writeFileSync(path.join(vault, rel), text);
    }
    const siteDir = path.join(root, 'campaign');
    fs.mkdirSync(siteDir);
    writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' } }, gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
    const configPath = path.join(siteDir, 'vault.config.json');
    fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
    const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
    try { build({ configPath, site }); } finally { console.log = real; console.warn = warn; }
    const out = site === 'gm' ? path.join(root, 'campaign-gm') : path.join(siteDir, 'docs');
    const html = fs.readFileSync(path.join(out, 'pcs', 'corwin-hale.html'), 'utf8');
    assert.match(unmarked(html), /Shared threads/);
    assert.match(unmarked(html), /The missing ledger/);
    if (site === 'player') assert.doesNotMatch(html, /The lamp is his/);
  });
}

// A `###` inside a hidden span is no place to stop: the threads would be hidden with it.
const HIDDEN_SUBSECTIONS = {
  'gm-only': '\n<!-- gm-only -->\n### GM Notes\n\nThe lamp is his.\n<!-- /gm-only -->\n',
  '%%': '\n%%\n### Aside\n\nThe lamp is his.\n%%\n',
  'HTML comment': '\n<!--\n### Aside\n\nThe lamp is his.\n-->\n',
};

test('shared threads: never put inside a hidden span', () => {
  const add = (page) => withSharedThreads(page, [{ markdown: '- a', involves: [], party: true }]);
  for (const [kind, hidden] of Object.entries(HIDDEN_SUBSECTIONS)) {
    const page = `## Current Status\n\n**Location:** dock\n${hidden}\n## Notes\n`;
    const out = add(page);
    const shown = strippedLines(out).lines.join('\n');
    assert.match(shown, /\*\*Shared threads:\*\*\n- a/, kind);
    assert.doesNotMatch(shown, /lamp/, kind);
  }
  // The section ends inside an unclosed fence: they go in before its opener.
  const open = '## Current Status\n\nX.\n\n<!-- gm-only -->\nS.\n';
  assert.match(strippedLines(add(open)).lines.join('\n'), /X\.\n\n\*\*Shared threads:\*\*\n- a/);
});

for (const site of ['player', 'gm']) {
  for (const [kind, hidden] of Object.entries(HIDDEN_SUBSECTIONS)) {
    test(`shared threads: a ${kind} subsection in Current Status does not hide them (${site} site)`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-hid-'));
      const vault = path.join(root, 'vault');
      const notes = {
        'Campaign Overview.md': overview(),
        'PCs/Corwin_Hale.md': pc('Corwin_Hale').replace('\n## Notes', `${hidden}\n## Notes`),
      };
      for (const [rel, text] of Object.entries(notes)) {
        fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
        fs.writeFileSync(path.join(vault, rel), text);
      }
      const siteDir = path.join(root, 'campaign');
      fs.mkdirSync(siteDir);
      writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' } }, gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
      const configPath = path.join(siteDir, 'vault.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
      const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
      try { build({ configPath, site }); } finally { console.log = real; console.warn = warn; }
      const out = site === 'gm' ? path.join(root, 'campaign-gm') : path.join(siteDir, 'docs');
      const html = fs.readFileSync(path.join(out, 'pcs', 'corwin-hale.html'), 'utf8');
      assert.match(unmarked(html), /Shared threads/);
      assert.match(unmarked(html), /The missing ledger/);
      if (site === 'player') assert.doesNotMatch(html, /The lamp is his/);
    });
  }
}

test('shared threads: names the PC through an alias link', () => {
  const entry = sharedEntries(overview())[1];
  assert.ok(entry.involves.includes('Corwin_Hale'), 'the alias label is dropped, the target kept');
  const page = withSharedThreads(pc('Corwin_Hale'), [entry]);
  assert.match(page, /\*\*Shared threads:\*\*\n- \*\*Corwin's debt to the ferrywoman\*\* — owed for the night crossing — since Session 3\n\n## Notes/);
  assert.doesNotMatch(page, /involves/);
});

test('shared threads: party threads go on every PC page', () => {
  const party = sharedEntries(overview()).filter((e) => e.party);
  for (const name of ['Corwin_Hale', 'Ines_Marlowe']) {
    assert.match(withSharedThreads(pc(name), party), /\*\*Shared threads:\*\*\n- \*\*The missing ledger\*\*/);
  }
});

test('shared threads: a gm-only shared thread stays off the player PC page', () => {
  const secret = 'Nobody must know about the sunken bell';
  const files = {
    [NEW_FILE]: CONFIG,
    'Campaign Overview.md': overview().replace('## Key Factions',
      `<!-- gm-only -->\n- ${secret} — since Session 1; involves the party\n- ${secret} again — involves [[Corwin_Hale]]\n<!-- /gm-only -->\n\n## Key Factions`),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
    'PCs/Ines_Marlowe.md': pc('Ines_Marlowe'),
  };
  const { read } = buildVault(files);
  const corwin = read('pcs', 'corwin-hale.html');
  assert.doesNotMatch(corwin, /sunken bell/);
  assert.match(corwin, /Shared threads/);
  assert.match(corwin, /The missing ledger/);
  assert.match(corwin, /Corwin.s debt to the ferrywoman/, 'the alias-linked thread reaches Corwin');
  const ines = read('pcs', 'ines-marlowe.html');
  assert.doesNotMatch(ines, /sunken bell/);
  assert.match(ines, /Corwin.s debt/, 'the thread names Ines too');
});

test('shared threads: a PC with no Current Status is unchanged', () => {
  const bare = '---\ntype: pc\n---\n\n# Tobin\n\n## Notes\n\nx\n';
  assert.strictEqual(withSharedThreads(bare, sharedEntries(overview())), bare);
});

test('shared threads: no Open Threads section changes nothing', () => {
  assert.deepStrictEqual(sharedEntries('# Overview\n\n## Premise\n\nx\n'), []);
  const page = pc('Ines_Marlowe');
  assert.strictEqual(withSharedThreads(page, []), page);
});

test('shared threads: the tail is split at the last valid one, as Python does', () => {
  const md = [
    '## Open Threads', '',
    '- **Smuggling ring** — involves the harbourmaster — since Session 4; involves the party',
    '- **Debt** — involves the ferrywoman — since Session 5; involves [[Corwin_Hale|Corwin]]',
    '',
  ].join('\n');
  const [ring, debt] = sharedEntries(md);
  assert.deepStrictEqual(ring, { markdown: '- **Smuggling ring** — involves the harbourmaster — since Session 4', involves: [], party: true });
  assert.deepStrictEqual(debt.involves, ['Corwin_Hale']);
  assert.strictEqual(debt.markdown, '- **Debt** — involves the ferrywoman — since Session 5');
});

test('shared threads: a PC whose Current Status players do not see gets none, on either site', () => {
  const notes = {
    'Campaign Overview.md': overview(),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-gm-'));
  const vault = path.join(root, 'vault');
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' }, hide: { sections: ['Current Status'] } },
    gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { for (const s of ['player', 'gm']) build({ configPath, site: s }); } finally { console.log = real; console.warn = warn; }
  const player = fs.readFileSync(path.join(siteDir, 'docs', 'pcs', 'corwin-hale.html'), 'utf8');
  const gm = fs.readFileSync(path.join(root, 'campaign-gm', 'pcs', 'corwin-hale.html'), 'utf8');
  assert.doesNotMatch(player, /Shared threads|The missing ledger/);
  assert.doesNotMatch(unmarked(gm), /Shared threads|The missing ledger/, 'the GM page never shows an unmarked copy');
});

// The Overview is left off the publish list, as a real vault's usually is.
function unpublishedOverview(site, { thread = '', extra = {} } = {}) {
  const secret = 'Nobody must know about the sunken bell';
  const loose = 'The harbourmaster is the Pale Man';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-unpub-'));
  const vault = path.join(root, 'vault');
  const notes = {
    'Campaign Overview.md': overview().replace('\n## Key Factions', `${thread ? `- ${thread}\n` : ''}\n## Key Factions`).replace('## Key Factions',
      `<!-- gm-only -->\n- ${secret} — since Session 1; involves the party\n<!-- /gm-only -->\n\n## Key Factions`).replace('## Premise', `## Premise\n\n${loose}.`),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
    'PCs/Ines_Marlowe.md': pc('Ines_Marlowe'),
    ...extra,
  };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writePublishList(vault, { publishing: ['PCs/Corwin_Hale.md', 'PCs/Ines_Marlowe.md', ...Object.keys(extra)], excluded: ['Campaign Overview.md'] });
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' } }, gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { build({ configPath, site }); } finally { console.log = real; console.warn = warn; }
  const out = site === 'gm' ? path.join(root, 'campaign-gm') : path.join(siteDir, 'docs');
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f); } })(out);
  return { out, files, secret, loose };
}

for (const site of ['player', 'gm']) {
  test(`shared threads: an unpublished Overview still feeds the PC pages (${site} site), and nothing else of it`, () => {
    const { out, files, secret, loose } = unpublishedOverview(site);
    const corwin = fs.readFileSync(path.join(out, 'pcs', 'corwin-hale.html'), 'utf8');
    assert.match(corwin, /Shared threads/);
    assert.match(corwin, /The missing ledger/);
    assert.match(corwin, /Corwin.s debt to the ferrywoman/);
    // The GM site shows every note, marked, so its own Overview page is the GM's; the player site writes none.
    if (site === 'player') assert.ok(!files.some((f) => /campaign-overview/.test(f)), 'the Overview gets no page');
    for (const f of files.filter((x) => /\.(html|js|json)$/.test(x) && (site === 'player' || /corwin-hale|ines-marlowe/.test(x)))) {
      const text = fs.readFileSync(f, 'utf8');
      assert.ok(!text.includes('sunken bell'), `gm-only thread leaked into ${f}`);
      assert.ok(!text.includes(loose), `Overview prose leaked into ${f}`);
      assert.ok(!text.includes('lamp that was paid'), `GM notes leaked into ${f}`);
    }
    if (site === 'gm') assert.doesNotMatch(corwin, /class="gm-mark/, 'players see the thread, so it is not marked');
  });
}

test('the leak check counts the shared threads a PC page shows as published, and the rest of an unpublished Overview as hidden (#674)', () => {
  const { runLeakGate } = require('../lib/leak-gate');
  // Whole sentences before the tail, as a GM writes them: each sentence is a hidden piece of the Overview on its own.
  const thread = 'Corwin carries a forged toll pass that will not survive a close look. The Guild clerk has started asking questions — since Session 4; involves [[Corwin_Hale]]';
  const { out, loose, secret } = unpublishedOverview('player', { thread });
  const configPath = path.join(path.dirname(out), 'vault.config.json');
  const threads = (r) => r.findings.filter((f) => /ledger|ferrywoman|toll pass|clerk/i.test(String(f.text)));
  const corwin = fs.readFileSync(path.join(out, 'pcs', 'corwin-hale.html'), 'utf8');
  assert.match(corwin, /forged toll pass/, 'the build puts the thread on the PC page');
  assert.deepEqual(threads(runLeakGate({ configPath, outputDir: out })), []);
  // The Overview's other prose is still hidden text: planted on a PC page, it is found.
  const page = path.join(out, 'pcs', 'corwin-hale.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</body>', `<p>${loose}. The Toll Guild keeps the bridges.</p></body>`));
  const found = runLeakGate({ configPath, outputDir: out }).findings;
  assert.ok(found.some((f) => f.code === 'HIDDEN_TEXT' && f.page === 'pcs/corwin-hale.html' && /toll guild keeps the bridges/i.test(f.text)), JSON.stringify(found.map((f) => f.text)));
  assert.deepEqual(threads({ findings: found }), []);
  // A gm-only thread never reaches a PC page, so it is still hidden text: planted there, it is found.
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</body>', `<p>${secret} — since Session 1; involves the party</p></body>`));
  assert.ok(runLeakGate({ configPath, outputDir: out }).findings.some((f) => /sunken bell/i.test(f.text) && f.page === 'pcs/corwin-hale.html'));
});

test('the leak check reads a shared thread after the GM-alias rewrite, as the site prints it (#674)', () => {
  const { runLeakGate } = require('../lib/leak-gate');
  // Two sentences: the first, alias and all, is a hidden piece of the Overview on its own.
  const thread = '[[Elias Crowe]] pays the toll keeper in silver every night. Nobody has asked him why — since Session 4; involves [[Corwin_Hale]]';
  const extra = { 'NPCs/Lord_Vane.md': '---\ntype: npc\ngm_aliases: ["Elias Crowe"]\n---\n# Lord Vane\n\nA lord.\n' };
  const { out } = unpublishedOverview('player', { thread, extra });
  const configPath = path.join(path.dirname(out), 'vault.config.json');
  const page = path.join(out, 'pcs', 'corwin-hale.html');
  const html = fs.readFileSync(page, 'utf8');
  assert.match(html, /pays the toll keeper in silver every night/);
  assert.doesNotMatch(html, /Elias Crowe/, 'the site prints the public name');
  assert.deepEqual(runLeakGate({ configPath, outputDir: out }).findings, []);
  // The thread as the GM wrote it, alias and all, is still hidden text: planted on a page it is found as a sentence,
  // not only as the alias.
  fs.writeFileSync(page, html.replace('</body>', '<p>Elias Crowe pays the toll keeper in silver every night.</p></body>'));
  const found = runLeakGate({ configPath, outputDir: out }).findings;
  assert.ok(found.some((f) => f.code === 'HIDDEN_TEXT' && /pays the toll keeper in silver/i.test(f.text)), JSON.stringify(found.map((f) => [f.code, f.text])));
});

test('the leak check keeps a shared thread hidden on a stub PC page that cuts it (#674)', () => {
  const { runLeakGate } = require('../lib/leak-gate');
  const { html, configPath, out } = stubVault('player');
  assert.doesNotMatch(html, /missing ledger/, 'the stub cuts its Current Status, threads and all');
  const page = path.join(out, 'pcs', 'corwin-hale.html');
  // The thread as a page that kept it would print it.
  fs.writeFileSync(page, html.replace('</body>', '<ul><li><strong>The missing ledger</strong> — Harrow Ford’s toll keeper wants it back — since Session 2</li></ul></body>'));
  assert.ok(runLeakGate({ configPath, outputDir: out }).findings.some((f) => /toll keeper wants it back/i.test(f.text)));
});

function stubVault(site, { throwView = false, fm = 'publish: stub\npublish_include_sections: [Notes]\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-stub-'));
  const vault = path.join(root, 'vault');
  const notes = {
    'Campaign Overview.md': overview(),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale').replace('type: pc\n', `type: pc\n${fm}`),
  };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  writePublishList(vault, { publishing: ['PCs/Corwin_Hale.md'], excluded: ['Campaign Overview.md'] });
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { PCs: 'pcs' } }, gm_site: { publish: true, folder: path.join(root, 'campaign-gm') } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const warnings = [];
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = (m) => warnings.push(String(m));
  const pv = require('../lib/published-view');
  const original = pv.publishView;
  if (throwView) pv.publishView = () => { throw new Error('boom'); };
  try { build({ configPath, site }); } finally { pv.publishView = original; console.log = real; console.warn = warn; }
  const out = site === 'gm' ? path.join(root, 'campaign-gm') : path.join(siteDir, 'docs');
  return { html: fs.readFileSync(path.join(out, 'pcs', 'corwin-hale.html'), 'utf8'), warnings, configPath, out };
}

for (const site of ['player', 'gm']) {
  test(`shared threads: a stub PC whose Current Status is cut gets none (${site} site)`, () => {
    const { html } = stubVault(site);
    assert.doesNotMatch(unmarked(html), /Shared threads|The missing ledger/);
  });
  test(`shared threads: a stub PC that keeps Current Status shows them (${site} site, unmarked)`, () => {
    const { html } = stubVault(site, { fm: 'publish: stub\npublish_include_sections: [Current Status]\n' });
    assert.match(unmarked(html), /Shared threads/);
    assert.match(unmarked(html), /The missing ledger/);
  });
}

test('shared threads: an Overview view that cannot be made is warned about and adds nothing', () => {
  const { html, warnings } = stubVault('player', { throwView: true, fm: '' });
  assert.ok(warnings.some((w) => /^ {2}WARNING: Campaign Overview\.md: shared threads were left off the PC pages/.test(w)), warnings.join('\n'));
  assert.doesNotMatch(html, /Shared threads/);
  assert.match(stubVault('player', { fm: '' }).html, /Shared threads/, 'the same vault shows them when the view is made');
});

test('shared threads: the section is found as Python finds it, and only - and * bullets are read', () => {
  const md = [
    '```', '## Open Threads', '- fenced heading — involves the party', '```', '',
    '### Open Threads', '', '- level three — involves the party', '',
    '## Open threads', '',
    '- a — involves the party',
    '  - indented — involves the party',
    '* star — involves the party',
    '+ plus — involves the party',
    '```', '- code — involves the party', '```',
    '', '## Key', '',
  ].join('\n');
  // A nested bullet is part of the one above (its own tail is text), and a `+` line carries a thread on, as Python
  // reads them (`_blocks`, `_lazy`).
  assert.deepStrictEqual(sharedEntries(md).map((e) => e.markdown), ['- a; indented — involves the party', '- star + plus — involves the party']);
  const status = '# P\n\n```\n## Current Status\n```\n\n## Current status\n\nHere.\n\n## Notes\n';
  assert.match(withSharedThreads(status, [{ markdown: '- a', involves: [], party: true }]), /Here\.\n\n\*\*Shared threads:\*\*\n- a\n\n## Notes/);
});

test('shared threads: party threads skip an out-of-play PC; a thread that names one still reaches it', () => {
  const files = {
    [NEW_FILE]: CONFIG,
    'Campaign Overview.md': overview(),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale').replace('type: pc', 'type: pc\nstatus: deceased'),
    'PCs/Ines_Marlowe.md': pc('Ines_Marlowe'),
  };
  const { read } = buildVault(files);
  const corwin = read('pcs', 'corwin-hale.html');
  assert.doesNotMatch(corwin, /The missing ledger/);
  assert.match(corwin, /Corwin.s debt to the ferrywoman/);
  assert.match(read('pcs', 'ines-marlowe.html'), /The missing ledger/);
});

// The Overview's Open Threads reach PC pages wherever the note sits: in a folder the player site hides too (the writer
// has taken the threads off the PC notes). An archived copy of it, first by path, is never the one read.
test('shared threads: an Overview in a hidden folder still feeds PC pages; an archived copy never does', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-hidden-'));
  const vault = path.join(root, 'vault');
  const notes = {
    '_Campaign/Campaign Overview.md': overview(),
    '_archive/Campaign Overview.md': overview().replace(/The missing ledger/g, 'An archived thread'),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
  };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { _Campaign: 'campaign', PCs: 'pcs' }, hide: { folders: ['_Campaign'] } } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = real; console.warn = warn; }
  const html = fs.readFileSync(path.join(siteDir, 'docs', 'pcs', 'corwin-hale.html'), 'utf8');
  assert.match(html, /The missing ledger/);
  assert.doesNotMatch(html, /An archived thread/);
  assert.ok(!fs.existsSync(path.join(siteDir, 'docs', 'campaign')), 'the hidden folder still gets no pages');
});

// A long hidden span left open to the section's end costs one strip, not one per line (2,000 lines took seconds).
// Timed as a ratio, not against a clock (a loaded machine is slow at any length): four times the lines take about four
// times as long; one strip per line took about sixteen.
test('shared threads: a long unclosed hidden span puts them before its opener, fast', () => {
  const md = (n) => `# P\n\n## Current Status\n\n**Location:** x\n\n%%\n${Array.from({ length: n }, (_, i) => `secret line ${i}`).join('\n')}\n\n## Notes\n`;
  const timed = (n) => { const started = process.hrtime.bigint(); const out = withSharedThreads(md(n), [{ markdown: '- a', involves: [], party: true }]); return { out, ms: Number(process.hrtime.bigint() - started) / 1e6 }; };
  const small = timed(500);
  const big = timed(2000);
  assert.match(big.out, /x\n\n\*\*Shared threads:\*\*\n- a\n\n%%\nsecret line 0/);
  assert.ok(big.ms < small.ms * 10 + 50, `500 lines ${small.ms.toFixed(0)} ms, 2000 lines ${big.ms.toFixed(0)} ms`);
});

// The Overview the site reads is the one Python picks: first by vault path, in a folder no folder_map entry covers too.
test('shared threads: the Overview is the first by path, mapped or not, as Python picks it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-threads-pick-'));
  const vault = path.join(root, 'vault');
  const notes = {
    'Admin/Campaign Overview.md': overview().replace(/The missing ledger/g, 'The first by path'),
    'Zed/Campaign Overview.md': overview().replace(/The missing ledger/g, 'A later copy'),
    'PCs/Corwin_Hale.md': pc('Corwin_Hale'),
  };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
  const siteDir = path.join(root, 'campaign');
  fs.mkdirSync(siteDir);
  // Zed is mapped and visible; Admin is neither mapped nor shown.
  writeNewConfig(vault, { version: 1, player_site: { folder: siteDir, folder_map: { Zed: 'zed', PCs: 'pcs' } } });
  const configPath = path.join(siteDir, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault }));
  const real = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { build({ configPath }); } finally { console.log = real; console.warn = warn; }
  const html = fs.readFileSync(path.join(siteDir, 'docs', 'pcs', 'corwin-hale.html'), 'utf8');
  assert.match(html, /The first by path/);
  assert.doesNotMatch(html, /A later copy/);
  assert.ok(!fs.existsSync(path.join(siteDir, 'docs', '_overview')), 'the rescan makes no page');
});
