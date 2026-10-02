// tools/publish/test/integration/build-sheets-off.test.js
// publish.character_sheets: false. A PC page is an identity strip, a line saying
// sheets aren't published, and the kept prose. Nothing from the sheet reaches any
// output file, which is what the leak test below walks every file for.
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { build } = require('../../lib/build');
const { templateBody, setRow, replace } = require('../helpers/pc-template');

const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

// Sentinels sit in every stat position. The ability value is 4 digits so that it
// cannot occur by chance in a stylesheet, a hash or an index.
const ABILITY = '8731';
const SKILL = 'Zzyzx Lore 93';
const ITEM = 'Sentinel Cutlass';
const SPELL = 'Vexing Quoin';
const PROSE = 'BACKGROUND-PROSE-SENTINEL';
const GM = 'GMSECRET-77';
const SENTINELS = [ABILITY, SKILL, ITEM, SPELL, GM];

function addUnder(body, heading, text) {
  const at = `\n## ${heading}\n`;
  return body.includes(at) ? body.replace(at, `${at}\n${text}\n`) : body;
}

// The system's template with sentinels in its stat positions and identity values filled in.
function pcFor(system) {
  const file = { 'dnd-5e-2024': 'pc-dnd-5e-2024.md', pf2e: 'pc-pf2e.md', 'gurps-4e': 'pc-gurps-4e.md', 'coc-7e': 'pc-coc-7e.md', fitd: 'pc-fitd.md', generic: 'pc-generic.md' }[system];
  let b = templateBody(file);
  let fm = '';
  let identity = [];
  if (system === 'dnd-5e-2024') {
    b = setRow(b, 'STR', [ABILITY, '+0', 'No']);
    b = setRow(b, 'Level', ['4']);
    b = replace(b, '**Species:** {Species name}', '**Species:** Gnome');
    b = replace(b, '**Class/Subclass:** {Class (Subclass)}', '**Class/Subclass:** Rogue (Thief)');
    b = replace(b, '**Background:** {Background name}', '**Background:** Sage');
    identity = [['Level', '4'], ['Class', 'Rogue (Thief)'], ['Species', 'Gnome'], ['Background', 'Sage']];
  } else if (system === 'pf2e') {
    b = setRow(b, 'STR', [`+${ABILITY}`]);
    b = setRow(b, 'Level', ['2']);
    b = replace(b, '**Ancestry:** {Ancestry name}', '**Ancestry:** Elf');
    b = replace(b, '**Heritage:** {Heritage name}', '**Heritage:** Woodland Elf');
    b = replace(b, '**Background:** {Background name}', '**Background:** Herbalist');
    b = replace(b, '**Class/Subclass:** {Class (subclass choice — doctrine, muse, instinct, etc.)}', '**Class/Subclass:** Druid (Leaf)');
    identity = [['Level', '2'], ['Class', 'Druid (Leaf)'], ['Ancestry', 'Elf'], ['Heritage', 'Woodland Elf'], ['Background', 'Herbalist']];
  } else if (system === 'gurps-4e') {
    b = setRow(b, 'ST', [ABILITY, '—', '0']);
    fm = 'point_total: 250\n';
    identity = [['Points', '250']];
  } else if (system === 'coc-7e') {
    b = setRow(b, 'STR', [ABILITY, '4365', '1746']);
    fm = 'occupation: Antiquarian\nage: 41\n';
    identity = [];   // the header badges already show occupation and age
  } else if (system === 'fitd') {
    b = setRow(b, 'Skirmish', [ABILITY]);
    b = replace(b, '**Playbook:** {Playbook name}', '**Playbook:** Cutter');
    b = replace(b, '**Heritage:** {Heritage}', '**Heritage:** Marrow Coast');
    b = replace(b, '**Vice/Purveyor:** {Vice type — Purveyor name}', '**Vice/Purveyor:** Obligation');
    identity = [['Playbook', 'Cutter'], ['Heritage', 'Marrow Coast'], ['Vice', 'Obligation']];
  } else {
    b = replace(b, '{Free-form stat block. Adapt to the game system in use.}', `STR ${ABILITY}`);
  }
  for (const h of ['Skills']) b = addUnder(b, h, SKILL);
  for (const h of ['Equipment']) b = addUnder(b, h, ITEM);
  for (const h of ['Spellcasting', 'Spells', 'Arcane Tomes & Spells']) b = addUnder(b, h, SPELL);
  b = addUnder(b, 'Background', PROSE);
  b = addUnder(b, 'GM Notes', GM);
  return { body: b, fm, identity };
}

// Builds a vault of one PC, one NPC and a roster. `publish` is a YAML fragment for
// the vault file. Returns the output root plus every line the build printed.
function buildSite({ system, sheets = false, publish = '', pcBody, pcFm = '', npc = true, wrangler = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-sheets-off-'));
  roots.push(root);
  const vault = path.join(root, 'vault');
  fs.mkdirSync(path.join(vault, 'Characters', 'PCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Characters', 'NPCs'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const sys = system && system !== 'generic' ? `  system: ${system}\n` : '';
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
    `---\npublish:\n  mode: player\n${sys}  folder_map:\n    Characters/PCs: characters/pcs\n    Characters/NPCs: characters/npcs\n${sheets ? '' : '  character_sheets: false\n'}${publish}---\n`);
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Test Hero.md'),
    `---\ntype: pc\nplayer_name: Pat\nstatus: alive\n${pcFm}---\n\n# Test Hero\n\n${pcBody}`);
  fs.writeFileSync(path.join(vault, 'Characters', 'PCs', 'Player Characters.md'),
    '---\ntype: pc_roster\n---\n\n# Player Characters\n\nThe Cold Fleet.\n');
  if (npc) {
    fs.writeFileSync(path.join(vault, 'Characters', 'NPCs', 'Marta.md'),
      '---\ntype: npc\noccupation: Harbormaster\n---\n\n# Marta\n\n## Background\n\nKeeps the docks.\n\n## Stat Sheet\n\n| Attribute | Value |\n|---|---|\n| STR | 12 |\n');
  }
  if (wrangler) fs.writeFileSync(path.join(root, 'wrangler.toml'), '[[kv_namespaces]]\nbinding = "INBOX"\nid = "abc123def456"\n');
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs') }));
  const real = { warn: console.warn, log: console.log };
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  console.log = (...a) => lines.push(a.join(' '));
  try { build({ configPath }); } finally { Object.assign(console, real); }
  const read = (rel) => fs.readFileSync(path.join(root, 'docs', rel), 'utf8');
  return { root, lines, read, pc: () => read('characters/pcs/test-hero.html') };
}

// Every text file under the output directory, as [path, text].
function allOutput(root) {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (!/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i.test(e.name)) out.push([f, fs.readFileSync(f, 'utf8')]);
  });
  walk(path.join(root, 'docs'));
  return out;
}

// The [label, value] pairs inside <div class="pc-identity">, or null when there is none.
function identityOf(html) {
  const m = html.match(/<div class="pc-identity">([\s\S]*?)\n?<\/div>/);
  if (!m) return null;
  return [...m[1].matchAll(/<span><span class="label">([^<]*)<\/span> ([^<]*)<\/span>/g)].map((x) => [x[1], x[2]]);
}

const SYSTEMS = ['dnd-5e-2024', 'pf2e', 'gurps-4e', 'coc-7e', 'fitd', 'generic'];

describe('character sheets off: nothing from the sheet is published', () => {
  for (const system of SYSTEMS) {
    describe(system, () => {
      const { body, fm, identity } = pcFor(system);
      const off = buildSite({ system, pcBody: body, pcFm: fm });
      const on = buildSite({ system, sheets: true, pcBody: body, pcFm: fm });

      it('no sentinel appears in any output file', () => {
        for (const [file, text] of allOutput(off.root)) {
          for (const s of SENTINELS) assert.ok(!text.includes(s), `${s} in ${file}`);
        }
      });

      it('the same sentinels do publish with sheets on (the fixture is not broken)', () => {
        assert.ok(on.pc().includes(ABILITY), 'sheets-on page carries the stat');
        assert.ok(allOutput(on.root).some(([, text]) => text.includes(ABILITY)));
        assert.ok(!on.pc().includes('sheet-withheld'));
        assert.ok(!on.pc().includes('pc-identity'));
        // The sheets-on page keeps its own tabs (it is byte-identical to the build before this change).
        assert.ok(on.pc().includes(system === 'coc-7e' ? 'data-target="p-equipment"' : 'data-tab="equipment"'), 'the system\'s own equipment tab');
        assert.ok(!on.pc().includes('data-sheets'));
      });

      it('the page says sheets are withheld, keeps the Background prose and has no Combat or Equipment tab', () => {
        const html = off.pc();
        assert.ok(html.includes('<p class="sheet-withheld">Character sheets aren\'t published for this campaign.</p>'));
        assert.ok(html.includes(PROSE));
        assert.ok(!html.includes('data-tab="equipment"'));
        assert.ok(!html.includes('data-tab="combat"'));
        assert.ok(!html.includes('id="tab-equipment"') && !html.includes('id="tab-combat"'));
        assert.ok(!html.includes('p-equipment') && !html.includes('foliotab'), 'no CoC folio without a sheet');
        assert.ok(!html.includes('No equipment data available'));
        assert.ok(/data-tab="sheet"[^>]*>Character<\/button>/.test(html), 'first tab is Character, id sheet');
        assert.ok(html.includes('data-tab="story"') && html.includes('data-tab="journey"'));
      });

      it('pc-identity holds exactly the identity pairs', () => {
        assert.deepStrictEqual(identityOf(off.pc()), identity.length ? identity : null);
      });

      it('no status panel, live island or live scripts', () => {
        const html = off.pc();
        assert.ok(!/live-data|-live\.js|status-panel|statusbar|gl-status|data-live/i.test(html), 'live artefacts');
        assert.ok(!/class="[^"]*\b(quick-stats|stat-item|sheet-section|gurps-|dnd-|fitd-|pf2e-|coc-sheet)/.test(html), 'sheet classes');
      });

      it('the roster page has no party board', () => {
        assert.ok(!off.read('characters/pcs/player-characters.html').includes('gl-party'));
        assert.ok(off.read('characters/pcs/player-characters.html').includes('The Cold Fleet.'));
      });

      it('the build prints no sheetless or empty-sheet line', () => {
        assert.ok(!off.lines.some((l) => /no character sheet|parsed no characteristics|no longer read/.test(l)), off.lines.join('\n'));
      });

      it('an NPC page is byte-equal to the sheets-on build', () => {
        assert.strictEqual(off.read('characters/npcs/marta.html'), on.read('characters/npcs/marta.html'));
      });
    });
  }
});

describe('character sheets off: more cases', () => {
  const dnd = pcFor('dnd-5e-2024');

  it('a prose-only note builds with no "no character sheet" line, for a system with a sheet renderer', () => {
    for (const system of ['dnd-5e-2024', 'coc-7e', 'fitd', 'pf2e', 'gurps-4e']) {
      const { lines } = buildSite({ system, pcBody: '## Background\n\nA sailor.\n' });
      assert.ok(!lines.some((l) => /no character sheet|parsed no characteristics/.test(l)), `${system}: ${lines.join('\n')}`);
    }
    // Control: with sheets on the same note is reported.
    const { lines } = buildSite({ system: 'dnd-5e-2024', sheets: true, pcBody: '## Background\n\nA sailor.\n' });
    assert.ok(lines.some((l) => l.includes('no character sheet')));
  });

  it('sheet_source is named only when display_meta lists it, and escaped', () => {
    const fm = 'sheet_source: "Roll20 <Hero> & co"\n';
    const quiet = buildSite({ system: 'gurps-4e', pcBody: dnd.body, pcFm: fm }).pc();
    assert.ok(!quiet.includes('This sheet is kept'));
    assert.ok(!quiet.includes('Roll20'));
    const shown = buildSite({ system: 'gurps-4e', pcBody: dnd.body, pcFm: `${fm}display_meta: [sheet_source]\n` }).pc();
    assert.ok(shown.includes('Character sheets aren\'t published for this campaign. This sheet is kept: Roll20 &lt;Hero&gt; &amp; co.</p>'), shown.match(/sheet-withheld[^\n]*/)[0]);
  });

  it('publish.pc_prose_sections publishes the named section, and only then', () => {
    const body = `${dnd.body}\n## Personality\n\nPERSONALITY-SENTINEL\n`;
    assert.ok(!buildSite({ system: 'dnd-5e-2024', pcBody: body }).pc().includes('PERSONALITY-SENTINEL'));
    const kept = buildSite({ system: 'dnd-5e-2024', pcBody: body, publish: '  pc_prose_sections: [Personality]\n' });
    assert.ok(kept.pc().includes('PERSONALITY-SENTINEL'));
    assert.ok(allOutput(kept.root).every(([, t]) => !t.includes(ABILITY)));
  });

  it('an identity value the GM excluded is not shown', () => {
    const { pc } = buildSite({ system: 'dnd-5e-2024', pcBody: dnd.body, publish: '  exclude_sections: [GM Notes, Background]\n' });
    assert.deepStrictEqual(identityOf(pc()), [['Level', '4']]);
    assert.ok(!pc().includes('Rogue') && !pc().includes('Gnome'));
  });

  it('a Level row only inside GM Notes is not shown', () => {
    let body = dnd.body;
    body = body.replace('| Level | 4 |', '| Rank | 4 |');
    body = body.replace(`${GM}`, `${GM}\n\n| Attribute | Value |\n|---|---|\n| Level | 19 |\n`);
    const { pc, root } = buildSite({ system: 'dnd-5e-2024', pcBody: body });
    assert.ok(!(identityOf(pc()) || []).some(([l]) => l === 'Level'));
    for (const [f, t] of allOutput(root)) assert.ok(!t.includes(GM), f);
  });

  it('identity values are HTML-escaped', () => {
    const { pc } = buildSite({ system: 'gurps-4e', pcBody: '## Background\n\nx\n', pcFm: 'point_total: 150\n', publish: '' });
    assert.deepStrictEqual(identityOf(pc()), [['Points', '150']]);
    const body = '## Points Summary\n\n| Category | Points |\n|---|---|\n| **Total** | **1 <i>x</i>** |\n';
    assert.deepStrictEqual(identityOf(buildSite({ system: 'gurps-4e', pcBody: body }).pc()), [['Points', '1 &lt;i&gt;x&lt;/i&gt;']]);
  });

  it('a fact the header already shows is said once: CoC default header carries occupation and age', () => {
    const html = buildSite({ system: 'coc-7e', pcBody: '## Background\n\nx\n', pcFm: 'occupation: Antiquarian\nage: 41\n' }).pc();
    assert.strictEqual(identityOf(html), null, 'no strip, no empty div');
    assert.ok(!html.includes('pc-identity'));
    assert.strictEqual(html.split('Antiquarian').length - 1, 1, 'occupation appears once');
    assert.ok(html.includes('sheet-withheld'));
  });

  it('a display_meta that leaves a field out of the header lets the strip carry it', () => {
    const html = buildSite({ system: 'coc-7e', pcBody: '## Background\n\nx\n', pcFm: 'occupation: Antiquarian\nage: 41\ndisplay_meta: [occupation]\n' }).pc();
    assert.deepStrictEqual(identityOf(html), [['Age', '41']]);
  });

  it('a header that shows an invalid point_total leaves the body total in the strip', () => {
    const body = '## Background\n\nx\n\n## Points Summary\n\n| Category | Points |\n|---|---|\n| **Total** | **197** |\n';
    for (const bad of ['"ca. 150"', '0', '[150]']) {
      const html = buildSite({ system: 'gurps-4e', pcBody: body, pcFm: `point_total: ${bad}\ndisplay_meta: [point_total]\n` }).pc();
      assert.deepStrictEqual(identityOf(html), [['Points', '197']], bad);
    }
    // The same valid number in header and strip is still said once.
    const same = buildSite({ system: 'gurps-4e', pcBody: body, pcFm: 'point_total: 197\ndisplay_meta: [point_total]\n' }).pc();
    assert.strictEqual(identityOf(same), null);
  });

  it('a display_meta naming point_total puts the points in the header only', () => {
    const named = buildSite({ system: 'gurps-4e', pcBody: '## Background\n\nx\n', pcFm: 'point_total: 250\ndisplay_meta: [point_total]\n' }).pc();
    assert.strictEqual(identityOf(named), null);
    assert.strictEqual(named.split('250').length - 1, 1);
    const plain = buildSite({ system: 'gurps-4e', pcBody: '## Background\n\nx\n', pcFm: 'point_total: 250\n' }).pc();
    assert.deepStrictEqual(identityOf(plain), [['Points', '250']]);
  });

  it('a note whose headings shift shows only frontmatter identity and none of its body', () => {
    const shifting = '## Background\n\n**Class:** Rogue\n\n[[Nowhere| ## Skills]]\n\nUNSTABLE-SENTINEL\n';
    const d = buildSite({ system: 'dnd-5e-2024', pcBody: shifting });
    assert.ok(d.lines.some((l) => l.includes("changes this note's headings")), d.lines.join('\n'));
    assert.strictEqual(identityOf(d.pc()), null);
    const g = buildSite({ system: 'gurps-4e', pcBody: shifting, pcFm: 'point_total: 250\n' });
    assert.deepStrictEqual(identityOf(g.pc()), [['Points', '250']]);
    for (const [f, t] of [...allOutput(d.root), ...allOutput(g.root)]) {
      assert.ok(!t.includes('UNSTABLE-SENTINEL') && !t.includes('Rogue'), f);
    }
  });

  it('the chatbox root says sheets are off, when the inbox is live', () => {
    const off = buildSite({ system: 'gurps-4e', pcBody: dnd.body, publish: '  inbox: true\n', wrangler: true }).pc();
    assert.ok(/<div id="cr-root"[^>]* data-sheets="off"><\/div>/.test(off), off.match(/id="cr-root"[^>]*/));
    const on = buildSite({ system: 'gurps-4e', sheets: true, pcBody: dnd.body, publish: '  inbox: true\n', wrangler: true }).pc();
    assert.ok(on.includes('id="cr-root"') && !on.includes('data-sheets'));
  });

  it('the roster of a vault with real party stats shows a board with sheets on and none with sheets off', () => {
    const roster = (sheets) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-publish-sheets-off-'));
      roots.push(root);
      const vault = path.join(root, 'vault');
      fs.cpSync(path.join(__dirname, '..', 'fixtures', 'with-party-roster'), vault, { recursive: true });
      fs.appendFileSync(path.join(vault, '_meta', 'vault-config.md'), '');
      fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'),
        `---\npublish:\n  mode: player\n  system: gurps-4e\n  folder_map:\n    Characters/PCs: characters/pcs\n${sheets ? '' : '  character_sheets: false\n'}---\n`);
      const configPath = path.join(root, 'vault.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: path.join(root, 'docs') }));
      const real = { warn: console.warn, log: console.log };
      console.warn = () => {}; console.log = () => {};
      try { build({ configPath }); } finally { Object.assign(console, real); }
      return fs.readFileSync(path.join(root, 'docs', 'characters', 'pcs', 'player-characters.html'), 'utf8');
    };
    assert.ok(roster(true).includes('gl-party'), 'control: the board renders with sheets on');
    const off = roster(false);
    assert.ok(!off.includes('gl-party') && !off.includes('Party Status'));
    assert.ok(off.includes('The Cold Fleet'));
  });
});
