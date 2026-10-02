const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'with-gurps-pc');
const KV_TOML = '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n';

// Builds the with-gurps-pc fixture in a temp site whose vault file carries `publish`
// (a YAML fragment), and returns the PC page HTML plus every line the build printed.
function buildSite({ publish = '', siteExtra = {}, wrangler = false, functions = false, pcAppend = '' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-switches-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.cpSync(FIXTURE, vault, { recursive: true });
  if (pcAppend) fs.appendFileSync(path.join(vault, 'Characters', 'PCs', 'Karl Brenner.md'), pcAppend);
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: player\n  system: gurps-4e\n  folder_map:\n    Characters/PCs: characters/pcs\n${publish}---\n`);
  if (wrangler) fs.writeFileSync(path.join(root, 'wrangler.toml'), KV_TOML);
  if (functions) {
    fs.mkdirSync(path.join(root, 'functions', 'api'), { recursive: true });
    fs.writeFileSync(path.join(root, 'functions', 'api', 'request.js'), '// fn');
    fs.writeFileSync(path.join(root, 'functions', 'api', 'loadout.js'), '// fn');
  }
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs'), ...siteExtra }));
  const real = { warn: console.warn, log: console.log };
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  console.log = (...a) => lines.push(a.join(' '));
  try { build({ configPath }); } finally { Object.assign(console, real); }
  const pcDir = path.join(root, 'docs', 'characters', 'pcs');
  const pcFile = fs.readdirSync(pcDir).find((f) => f.endsWith('.html') && !f.startsWith('index') && !f.includes('player-characters'));
  return { html: fs.readFileSync(path.join(pcDir, pcFile), 'utf8'), lines, root };
}

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

describe('live stats and the inbox follow the switches', () => {
  it('both on with a KV store wired: chatbox and live scripts appear', () => {
    const { html, lines } = buildSite({ publish: '  live_stats: true\n  inbox: true\n', wrangler: true, functions: true });
    assert.ok(html.includes('id="cr-root"'), 'chatbox root');
    assert.ok(html.includes('gurps-live.js'), 'live client script');
    assert.ok(html.includes('js/change-request.js'), 'change-request client script');
    assert.ok(!lines.some((l) => /WARNING: publish\.(live_stats|inbox)/.test(l)), lines.join('\n'));
  });

  it('both on with no KV store: neither appears, and the build says why for each', () => {
    const { html, lines } = buildSite({ publish: '  live_stats: true\n  inbox: true\n' });
    assert.ok(!html.includes('id="cr-root"'));
    assert.ok(!html.includes('gurps-live.js'));
    assert.ok(lines.some((l) => l.includes('WARNING: publish.live_stats is on but this site has no KV store wired')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('WARNING: publish.inbox is on but this site has no KV store wired')), lines.join('\n'));
  });

  it('switches unset with the backend not deployed: nothing appears and nothing is warned', () => {
    const { html, lines } = buildSite({});
    assert.ok(!html.includes('id="cr-root"'));
    assert.ok(!html.includes('gurps-live.js'));
    assert.ok(!lines.some((l) => l.includes('WARNING')), lines.join('\n'));
  });

  it('switches unset with the backend deployed: nothing appears, and the build says so', () => {
    const { html, lines } = buildSite({ wrangler: true, functions: true });
    assert.ok(!html.includes('id="cr-root"'));
    assert.ok(!html.includes('gurps-live.js'));
    assert.strictEqual(lines.filter((l) => l.includes('WARNING: live stats are deployed on this site but publish.live_stats is not set, so they are off. Set publish.live_stats to true to keep them, or to false to remove their functions.')).length, 1, lines.join('\n'));
    assert.strictEqual(lines.filter((l) => l.includes('WARNING: the inbox is deployed on this site but publish.inbox is not set, so it is off. Set publish.inbox to true to keep it, or to false to remove its functions.')).length, 1, lines.join('\n'));
  });

  it('character_sheets off forces live stats off, with one line saying so', () => {
    const { html, lines } = buildSite({ publish: '  character_sheets: false\n  live_stats: true\n', wrangler: true, functions: true });
    assert.ok(!html.includes('gurps-live.js'));
    const said = lines.filter((l) => l.includes('publish.live_stats is on but character_sheets is off; live stats are not published'));
    assert.strictEqual(said.length, 1, lines.join('\n'));
  });
});

describe('an unmigrated site that loses live stats or the inbox is told', () => {
  const LIVE = 'WARNING: live stats were on for this site and are now off: publish.live_stats is not set. Run `migrate.py <vault>` to keep them.';
  const INBOX = 'WARNING: the inbox was on for this site and is now off: publish.inbox is not set. Run `migrate.py <vault>` to keep it.';
  const said = (lines, text) => lines.filter((l) => l.includes(text)).length;
  const deployed = { wrangler: true, functions: true };

  it('old settings left, both switches unset, backend deployed: one warning each', () => {
    const { lines, html } = buildSite({ ...deployed, siteExtra: { siteTitle: 'Old' } });
    assert.strictEqual(said(lines, LIVE), 1, lines.join('\n'));
    assert.strictEqual(said(lines, INBOX), 1, lines.join('\n'));
    assert.ok(!html.includes('gurps-live.js'), 'unset still means off');
  });

  it('a site with only deployment keys is not sent to migrate.py: the other wording applies', () => {
    const { lines } = buildSite({ ...deployed });
    assert.strictEqual(said(lines, 'were on for this site'), 0, lines.join('\n'));
    assert.strictEqual(said(lines, 'was on for this site'), 0, lines.join('\n'));
    assert.strictEqual(said(lines, 'publish.live_stats is not set, so they are off'), 1, lines.join('\n'));
    assert.strictEqual(said(lines, 'publish.inbox is not set, so it is off'), 1, lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('migrate.py')), lines.join('\n'));
  });

  it('a switch set either way, in either file, is not warned', () => {
    const a = buildSite({ ...deployed, publish: '  live_stats: false\n  inbox: true\n', siteExtra: { siteTitle: 'Old' } });
    assert.strictEqual(said(a.lines, LIVE), 0, a.lines.join('\n'));
    assert.strictEqual(said(a.lines, INBOX), 0, a.lines.join('\n'));
    const b = buildSite({ ...deployed, siteExtra: { backend: { statusBar: false, inbox: false } } });
    assert.strictEqual(said(b.lines, LIVE), 0, b.lines.join('\n'));
    assert.strictEqual(said(b.lines, INBOX), 0, b.lines.join('\n'));
    for (const r of [a, b]) assert.ok(!r.lines.some((l) => l.includes('is not set, so')), r.lines.join('\n'));
  });

  it('no deployed backend: nothing was lost, so nothing is said', () => {
    const { lines } = buildSite({ siteExtra: { siteTitle: 'Old' } });
    assert.strictEqual(said(lines, 'on for this site and'), 0, lines.join('\n'));
  });

  it('character_sheets off: no live stats warning, the inbox one stays', () => {
    const { lines } = buildSite({ ...deployed, publish: '  character_sheets: false\n', siteExtra: { siteTitle: 'Old' } });
    assert.strictEqual(said(lines, LIVE), 0, lines.join('\n'));
    assert.strictEqual(said(lines, INBOX), 1, lines.join('\n'));
    const clean = buildSite({ ...deployed, publish: '  character_sheets: false\n' });
    assert.strictEqual(said(clean.lines, 'live stats are deployed'), 0, clean.lines.join('\n'));
    assert.strictEqual(said(clean.lines, 'the inbox is deployed'), 1, clean.lines.join('\n'));
  });

  it('the warnings come with the closing lines, after the campaign-settings one', () => {
    const { lines } = buildSite({ ...deployed, siteExtra: { siteTitle: 'Old' } });
    const settings = lines.findIndex((l) => l.includes('still holds campaign settings'));
    assert.ok(settings >= 0 && lines.findIndex((l) => l.includes(LIVE)) > settings, lines.join('\n'));
  });
});

describe('the closing line about campaign settings left in vault.config.json', () => {
  it('names each key and each list entry still applied, once, and says how to move them', () => {
    const { lines } = buildSite({
      publish: '  exclude_dirs: [_meta]\n',
      siteExtra: { siteTitle: 'Old Title', excludeDirs: ['Secrets'] },
    });
    const said = lines.filter((l) => l.includes('WARNING: vault.config.json still holds campaign settings'));
    assert.strictEqual(said.length, 1, lines.join('\n'));
    assert.match(said[0], /siteTitle/);
    assert.match(said[0], /excludeDirs \(ignored; the vault file sets it\)/);
    assert.match(said[0], /excludeDirs entry "Secrets" is still applied from vault\.config\.json/);
    assert.ok(said[0].endsWith('Settings left in vault.config.json are planned to stop being read in plugin 1.11.0. Run `migrate.py <vault>` to move them.'), said[0]);
  });

  it('a site-file exclusion the vault list lacks keeps hiding its section everywhere', () => {
    const { lines, root } = buildSite({
      publish: '  exclude_sections: [GM Notes]\n',
      siteExtra: { excludeSections: ['Keeper Only'] },
      pcAppend: '\n## Keeper Only\n\nZorblatt the unspeakable.\n',
    });
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.join(root, 'docs'));
    assert.ok(files.length > 3);
    for (const f of files) {
      if (/\.(png|jpe?g|webp|woff2?)$/.test(f)) continue;
      assert.ok(!/zorblatt/i.test(fs.readFileSync(f, 'utf8')), `${path.relative(root, f)} carries the section`);
    }
    const said = lines.filter((l) => l.includes('still holds campaign settings'));
    assert.strictEqual(said.length, 1, lines.join('\n'));
    assert.match(said[0], /excludeSections entry "Keeper Only" is still applied from vault\.config\.json/);
  });

  it('names landingTagline and backend, either of which gives the migration work', () => {
    for (const [extra, key] of [[{ landingTagline: 'Hi' }, 'landingTagline'], [{ backend: { inbox: false } }, 'backend']]) {
      const { lines } = buildSite({ siteExtra: extra });
      const said = lines.filter((l) => l.includes('still holds campaign settings'));
      assert.strictEqual(said.length, 1, lines.join('\n'));
      assert.ok(said[0].includes(`settings: ${key}.`), said[0]);
    }
  });

  it('a site-file list that is not a list gets its own clause', () => {
    const { lines } = buildSite({ siteExtra: { excludeSections: 'Keeper Only' } });
    const clause = lines.filter((l) => l.includes('excludeSections in vault.config.json is not a list and is ignored; remove it or move its entries to publish.exclude_sections by hand'));
    assert.strictEqual(clause.length, 1, lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('migrate.py')), 'alone, it does not send the GM to migrate.py');
    const both = buildSite({ siteExtra: { excludeSections: 'Keeper Only', siteTitle: 'Old' } });
    const settings = both.lines.filter((l) => l.includes('still holds campaign settings'));
    assert.strictEqual(settings.length, 1, both.lines.join('\n'));
    assert.ok(settings[0].includes('settings: siteTitle.') && !settings[0].includes('excludeSections'), settings[0]);
    assert.ok(both.lines.some((l) => l.includes('excludeSections in vault.config.json is not a list')));
  });

  it('a list holding only entries that cannot be moved is named by hand and never sent to migrate.py', () => {
    const { lines } = buildSite({ siteExtra: { excludeDirs: [null] } });
    const clause = lines.filter((l) => l.includes('excludeDirs in vault.config.json holds entries that are not text and cannot be moved; remove them or the key by hand'));
    assert.strictEqual(clause.length, 1, lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('migrate.py') || l.includes('still holds campaign settings')), lines.join('\n'));
    const both = buildSite({ siteExtra: { excludeDirs: [null], siteTitle: 'Old' } });
    const settings = both.lines.filter((l) => l.includes('still holds campaign settings'));
    assert.strictEqual(settings.length, 1, both.lines.join('\n'));
    assert.ok(settings[0].includes('settings: siteTitle.') && !settings[0].includes('excludeDirs'), settings[0]);
  });

  it('is absent when the site file holds only deploy keys', () => {
    const { lines } = buildSite({});
    assert.ok(!lines.some((l) => l.includes('still holds campaign settings')));
  });
});

describe('the PC keep-list reaches the search index', () => {
  // lunr stores lower-cased, stemmed terms as object keys.
  const search = (root) => fs.readFileSync(path.join(root, 'docs', 'search-index.json'), 'utf8');
  const has = (text, term) => text.includes(`"${term}"`);
  it('character_sheets off: sheet sections stay out of search, kept prose stays in', () => {
    const { root } = buildSite({ publish: '  character_sheets: false\n' });
    const text = search(root);
    assert.ok(!has(text, 'broadsword'), 'equipment section withheld');
    assert.ok(!has(text, 'hauberk'), 'equipment sub-section withheld');
    assert.ok(has(text, 'district'), 'Current Status kept');
  });
  it('character_sheets on: nothing is withheld by the keep-list', () => {
    const { root } = buildSite({});
    const text = search(root);
    for (const term of ['broadsword', 'hauberk', 'district']) assert.ok(has(text, term), term);
  });
});

describe('a malformed pc_prose_sections', () => {
  it('prints a warning in the build output and never keeps everything', () => {
    const { lines, root } = buildSite({ publish: '  character_sheets: false\n  pc_prose_sections: everything\n' });
    assert.ok(lines.some((l) => l.includes('WARNING: publish.pc_prose_sections is not a list')), lines.join('\n'));
    assert.ok(!fs.readFileSync(path.join(root, 'docs', 'search-index.json'), 'utf8').includes('"broadsword"'));
  });
});

describe('PC notes whose labels shift their headings', () => {
  const SENT = 'STAT14';
  const bodies = {
    labelNewline: { text: '[[Nowhere|a\n## Skills]]', warns: 0 },
    embedNewline: { text: '![[m.png|a\n## Skills]]', warns: 0 },
    labelSpace: { text: '[[Nowhere| ## Skills]]', warns: 1 },
    embedDashes: { text: 'Skills\n![[m.png]]---', warns: 1 },
    embedHeading: { text: '![[m.png]]## Skills', warns: 1 },
  };
  const allOutput = (root) => {
    const out = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else if (/\.(html|json|js|md|txt|xml)$/.test(e.name)) out.push([f, fs.readFileSync(f, 'utf8')]);
    });
    walk(path.join(root, 'docs'));
    return out;
  };
  for (const [name, { text, warns }] of Object.entries(bodies)) {
    const pcAppend = `\n## Background\nok\n${text}\n${SENT}\n`;
    it(`${name}: sheets off publishes no ${SENT} anywhere and warns ${warns} time(s)`, () => {
      const { lines, root } = buildSite({ publish: '  character_sheets: false\n', pcAppend });
      for (const [f, body] of allOutput(root)) assert.ok(!body.includes(SENT), f);
      const warned = lines.filter((l) => l.includes("changes this note's headings; nothing after its title is published while character sheets are off. Fix the label."));
      assert.strictEqual(warned.length, warns, lines.join('\n'));
      if (warns) assert.ok(warned[0].includes('WARNING: characters/pcs/'), warned[0]);
    });
    it(`${name}: sheets on builds as before, with no keep-list warning`, () => {
      const { lines, root } = buildSite({ pcAppend });
      assert.ok(!lines.some((l) => l.includes('changes this note')), lines.join('\n'));
      assert.ok(allOutput(root).some(([, body]) => body.includes(SENT)), 'the note still publishes its body');
    });
  }
  it('a normal note with links and embeds is stable and keeps its sections', () => {
    const pcAppend = '\n## Background\nMet [[Nowhere]] and [[Karl Brenner]]. ![[m.png]]\n\n**Note:** kept prose\n';
    const { lines, html } = buildSite({ publish: '  character_sheets: false\n', pcAppend });
    assert.ok(!lines.some((l) => l.includes('changes this note')), lines.join('\n'));
    assert.ok(html.includes('kept prose'));
  });
});
