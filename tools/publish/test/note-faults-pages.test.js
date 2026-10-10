const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runSiteDoctor } = require('../lib/site-doctor');
const { build } = require('../lib/build');
const { pageText } = require('../lib/note-faults');

// The names a page prints and the secret names on it are decided by the page as the build
// makes it, not by a list of fields. These tests plant a link or a name where one type's
// page prints it and another's does not, and ask both the doctor and the build.

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A full-mode site: every typed note in a mapped folder publishes unless it says `publish: false`.
function site(files, extra = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-faults-pages-'));
  made.push(root);
  const vault = path.join(root, 'vault');
  const folders = new Set();
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
    if (rel.includes('/')) folders.add(path.dirname(rel));
  }
  fs.mkdirSync(path.join(vault, '_meta'), { recursive: true });
  const map = [...folders].map((f) => `    ${f}: ${f.toLowerCase()}\n`).join('');
  fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  mode: full\n${extra}  folder_map:\n${map}---\n`);
  const configPath = path.join(root, 'vault.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ vaultPath: vault, outputDir: './docs', attachmentsDir: '_attachments', siteTitle: 'T', excludeDirs: ['_meta', '_Templates'] }));
  return { root, vault, configPath };
}

const NOTE_FAULT = /^(NAMED_NO_PAGE|COMMENT_STRAY|FENCE_UNCLOSED|ALIAS_IN_PROSE)$/;

async function fromDoctor(configPath, options = {}) {
  const out = [];
  await runSiteDoctor({ configPath, json: true, ...options }, { out: (l) => out.push(String(l)), detect: () => null });
  return JSON.parse(out.join('')).findings.filter((f) => NOTE_FAULT.test(f.code));
}

function fromBuild(configPath) {
  let found = null;
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { build({ configPath, onNoteFaults: (f) => { found = f; } }); } finally { Object.assign(console, saved); }
  return found;
}

// The doctor's findings, after checking the build returns the very same list.
async function faults(files, code, extra) {
  const { configPath, root } = site(files, extra);
  const doctor = await fromDoctor(configPath);
  assert.ok(!fs.existsSync(path.join(root, 'docs')), 'the doctor wrote a site');
  assert.deepStrictEqual(fromBuild(configPath), doctor, 'the build and the doctor disagree');
  return code ? doctor.filter((f) => f.code === code) : doctor;
}

const hidden = (extra = '') => `---\ntype: npc\npublish: false\n${extra}---\n\nSecret body.\n`;
const pagesOf = (found, note) => (found.find((f) => f.path === note) || { pages: [] }).pages;

describe('NAMED_NO_PAGE is decided by the page as built', () => {
  it('counts a field on the type whose page prints it, and not on a type whose page does not', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Events/Masquerade.md': '---\ntype: event\nparticipants:\n  - "[[Old_Tam]] (host)"\n---\n\nA ball.\n',
      'People/Bo_Pike.md': '---\ntype: npc\nparticipants:\n  - "[[Old_Tam]] (host)"\nsession: "[[Old_Tam]]"\n---\n\nA guest.\n',
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(pagesOf(found, 'Hidden/Old_Tam.md'), ['Events/Masquerade.md']);
  });

  it('counts a link in a field no list names, when the page prints it: a creature\'s abilities, a link in a title', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Creatures/Mire_Hound.md': '---\ntype: creature\nabilities:\n  - "Tracks [[Old_Tam]] by scent"\n---\n\nA hound.\n',
      'People/Cy_Dunn.md': '---\ntype: npc\ntitle: "Cy Dunn, heir of [[Old_Tam]]"\n---\n\nAn heir.\n',
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(pagesOf(found, 'Hidden/Old_Tam.md'), ['Creatures/Mire_Hound.md', 'People/Cy_Dunn.md']);
  });

  it('counts a relationship target written without brackets, and not one marked gm_only', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Hidden/Ada_Moor.md': hidden(),
      'People/Bo_Pike.md': '---\ntype: npc\nrelationships:\n  - target: Old_Tam\n    type: knows\n  - target: Ada_Moor\n    type: serves\n    gm_only: true\n---\n\nA guest.\n',
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(found.map((f) => [f.path, f.pages, f.printed]), [['Hidden/Old_Tam.md', ['People/Bo_Pike.md'], ['Old Tam']]]);
  });

  it('on a PC page, counts a link in a section the page prints and not in one it leaves out', async () => {
    const pc = (body) => `---\ntype: pc\nplayer_name: Pat\n---\n\n# Ada Moor\n\n${body}\n`;
    const { configPath } = site({
      'Hidden/Old_Tam.md': hidden(),
      'Hidden/Brass_Key.md': hidden(),
      'PCs/Ada_Moor.md': pc('## Background\n\nRaised by [[Old_Tam]].\n\n## Notes To Self\n\nFind the [[Brass_Key]].\n'),
    }, '  character_sheets: false\n  pc_sections:\n    - Background\n');
    const found = (await fromDoctor(configPath)).filter((f) => f.code === 'NAMED_NO_PAGE');
    assert.deepStrictEqual(fromBuild(configPath).filter((f) => f.code === 'NAMED_NO_PAGE'), found);
    assert.deepStrictEqual(found.map((f) => f.path), ['Hidden/Old_Tam.md']);
  });

  it('reads a PC\'s story companion: its links and a secret name on the story page are reported against the story file', async () => {
    const found = await faults({
      'Hidden/Vesper_Hale.md': hidden('gm_aliases: ["The Informer"]\n'),
      'PCs/Ada_Moor.md': '---\ntype: pc\nplayer_name: Pat\n---\n\n# Ada Moor\n\n## Background\n\nPlain.\n',
      'PCs/Ada_Moor_Story.md': '---\ntype: character-story\n---\n\nShe met [[Vesper_Hale]]. The Informer lied.\n',
    });
    assert.deepStrictEqual(found.map((f) => [f.code, f.path, f.pages || f.alias]), [
      ['ALIAS_IN_PROSE', 'PCs/Ada_Moor_Story.md', 'The Informer'],
      ['NAMED_NO_PAGE', 'Hidden/Vesper_Hale.md', ['PCs/Ada_Moor_Story.md']],
    ]);
  });

  it('does not count a link whose words are on the page only as plain text typed elsewhere', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'People/Bo_Pike.md': '---\ntype: npc\n---\n\nEveryone knows Old Tam.\n\n## GM Notes\n\nSee [[Old_Tam]].\n',
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(found, []);
  });

  it('counts a link in the last cell of a table row', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'People/Bo_Pike.md': '---\ntype: npc\n---\n\n| who | where |\n|---|---|\n| x | [[Old_Tam]] |\n',
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual(pagesOf(found, 'Hidden/Old_Tam.md'), ['People/Bo_Pike.md']);
  });
});

describe('ALIAS_IN_PROSE is read off the page as built', () => {
  const owner = { 'People/Mr_Grey.md': '---\ntype: npc\ngm_aliases: ["The Watcher", "Madame D\'Or"]\n---\n\nA quiet man.\n' };
  const on = async (note) => (await faults(Object.assign({ 'People/Case.md': note }, owner), 'ALIAS_IN_PROSE')).filter((f) => f.path === 'People/Case.md');

  it('finds the name in a frontmatter field the page prints', async () => {
    const [f] = await on('---\ntype: npc\noccupation: "Servant of The Watcher"\n---\n\nText.\n');
    assert.strictEqual(f.alias, 'The Watcher');
    assert.match(f.context, /Servant of The Watcher/);
  });
  it('finds it in a title, in a relationship\'s description, and split by bold', async () => {
    assert.strictEqual((await on('---\ntype: npc\ntitle: "The Watcher Returns"\n---\n\nText.\n')).length, 1);
    assert.strictEqual((await on('---\ntype: npc\nrelationships:\n  - target: "[[Mr_Grey]]"\n    type: knows\n    description: "fears The Watcher"\n---\n\nText.\n')).length, 1);
    assert.strictEqual((await on('---\ntype: npc\n---\n\nIntro.\n\n## Seen\n\nThey saw **The** Watcher by the gate.\n')).length, 1);
  });
  it('finds it typed with a curly apostrophe where gm_aliases has a straight one', async () => {
    const [f] = await on('---\ntype: npc\n---\n\nIntro.\n\n## Court\n\nThey call her Madame D’Or at court.\n');
    assert.strictEqual(f.alias, "Madame D'Or");
    assert.strictEqual(f.count, 1);
  });
  it('is silent in a field the page does not print, as a link, and as part of a longer word', async () => {
    assert.deepStrictEqual(await on('---\ntype: npc\nprivate_memo: "The Watcher"\n---\n\nSee [[The Watcher]] and the Watchers.\n'), []);
  });
  it('does not count another page\'s public name printed as a link to it', async () => {
    const found = await faults(Object.assign({
      'People/The_Watcher_Returns.md': '---\ntype: npc\n---\n\nA play.\n',
      'People/Case.md': '---\ntype: npc\n---\n\nIntro.\n\n## Seen\n\nSee [[The_Watcher_Returns]].\n',
    }, owner), 'ALIAS_IN_PROSE');
    // The play's own page prints the name in its title; the page that links it does not own it.
    assert.deepStrictEqual(found.map((f) => f.path), ['People/The_Watcher_Returns.md']);
  });
  it('shows the same sentence to the build and the doctor when the line also holds a GM alias link', async () => {
    const [f] = await on('---\ntype: npc\n---\n\nIntro.\n\n## Seen\n\n[[The Watcher]] is not the watcher they fear.\n');
    assert.strictEqual(f.context, 'Mr Grey is not the watcher they fear.');
  });
});

const F = '```';
const npcNote = (body, extra = '') => `---\ntype: npc\n${extra}---\n\n${body}\n`;
const one = async (body, code, extra) => faults({ 'People/Case.md': npcNote(body, extra) }, code);

describe('FENCE_UNCLOSED: a hidden marker the page prints', () => {
  for (const [name, body, line, markerLine] of [
    ['a fence of four closed by three', `Text.\n\n${F}\`\ncode\n${F}\n\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\n`, 7, 11],
    ['a closing fence with words after it', `Text.\n\n${F}\ncode\n${F} end\n\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\n`, 7, 11],
    ['an unclosed fence inside a list item', `- item\n\n  ${F}\n  code\n\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\n\nAfter.\n`, 7, 10],
    ['a tilde fence closed by backticks', `Text.\n\n~~~\ncode\n${F}\n\n<!-- spoiler -->\nSECRET\n<!-- /spoiler -->\n`, 7, 11],
  ]) {
    it(`${name}: reported, with the fence line and the marker line`, async () => {
      const { configPath, root } = site({ 'People/Case.md': npcNote(body) });
      const [f] = (await fromDoctor(configPath)).filter((x) => x.code === 'FENCE_UNCLOSED');
      assert.ok(f, 'no finding');
      assert.deepStrictEqual([f.path, f.line, f.markerLine], ['People/Case.md', line, markerLine]);
      // The fault is real: the build prints the hidden word.
      fromBuild(configPath);
      assert.match(fs.readFileSync(path.join(root, 'docs', 'people', 'case.html'), 'utf8'), /SECRET/);
    });
  }

  it('is silent when the fence and its marker lie under a hidden heading: nothing of it is on the site', async () => {
    const body = `Text.\n\n## GM Notes\n\n${F}\ncode\n\n<!-- gm-only -->\nSECRET\n<!-- /gm-only -->\n`;
    const { configPath, root } = site({ 'People/Case.md': npcNote(body) });
    assert.deepStrictEqual(await fromDoctor(configPath), []);
    fromBuild(configPath);
    assert.ok(!/SECRET/.test(fs.readFileSync(path.join(root, 'docs', 'people', 'case.html'), 'utf8')));
  });
  it('is silent for markers shown in a fence that closes, at the margin, in a quote or in a list item', async () => {
    assert.deepStrictEqual(await one(`${F}\n<!-- gm-only -->\n%% x %%\n${F}\n\nAfter.`, 'FENCE_UNCLOSED'), []);
    assert.deepStrictEqual(await one(`- item\n\n  ${F}\n  <!-- a note -->\n  ${F}\n\nAfter.`, 'FENCE_UNCLOSED'), []);
    assert.deepStrictEqual(await one(`${F}${F}\n${F}\n<!-- a note -->\n${F}\n${F}${F}\n\nAfter.`, 'FENCE_UNCLOSED'), []);
  });
});

describe('COMMENT_STRAY: only where it changes what the site shows', () => {
  it('is found on a stub page, in a section the stub keeps', async () => {
    const stub = 'publish: stub\npublish_include_sections: ["Public"]\n';
    const [f] = await one('## Public\n\nB 100%% x 50%% y\n\n## Private\n\nz\n', 'COMMENT_STRAY', stub);
    assert.deepStrictEqual([f.kind, f.line, f.text], ['GLUED', 9, 'B 100%% x 50%% y']);
  });
  it('is silent on a stub page for a stray in a section the stub leaves out', async () => {
    const stub = 'publish: stub\npublish_include_sections: ["Public"]\n';
    assert.deepStrictEqual(await one('## Public\n\nFine.\n\n## Private\n\nB 100%% x 50%% y\n', 'COMMENT_STRAY', stub), []);
  });
  it('is silent for a pair that lies wholly under a hidden heading', async () => {
    assert.deepStrictEqual(await one('Text.\n\n## GM Notes\n\nTakes 10%% of it and 5%% of the rest.\n', 'COMMENT_STRAY'), []);
    assert.deepStrictEqual(await one('Text.\n\n## GM Notes\n\nTakes 10%% of it, never closed.\n', 'COMMENT_STRAY'), []);
  });
  it('is reported when an unclosed one under a hidden heading also hides a section the page would print', async () => {
    const [f] = await one('Text.\n\n## GM Notes\n\nTakes 10%% of it.\n\n## Rumours\n\nShown before, hidden now.\n', 'COMMENT_STRAY');
    assert.deepStrictEqual([f.kind, f.line], ['UNCLOSED', 9]);
  });
  it('is silent for a comment typed straight after a word, and for a percent sign after a number that is one', async () => {
    assert.deepStrictEqual(await one('Some text%%a note%% more.\n\nNow 50% off.', 'COMMENT_STRAY'), []);
  });
  it('a %% in backticks in a frontmatter value is neither cut nor reported, as the fix line says', async () => {
    const { configPath, root } = site({ 'People/Case.md': npcNote('Text.', 'occupation: "Gives `100%%` and the middle `50%%` more"\n') });
    assert.deepStrictEqual(await fromDoctor(configPath), []);
    fromBuild(configPath);
    assert.match(fs.readFileSync(path.join(root, 'docs', 'people', 'case.html'), 'utf8'), /and the middle/);
    const [f] = await one('Text.', 'COMMENT_STRAY', 'occupation: "Gives 100%% and the middle 50%% more"\n');
    assert.match(f.fix, /backticks/);
  });
});

describe('a PC note withheld whole (a link label changes its headings, sheets off)', () => {
  it('reports no stray and names no note: nothing of its body is on the site', async () => {
    const sheetsOff = '  character_sheets: false\n  pc_sections:\n    - Background\n';
    const { configPath } = site({
      'Hidden/Old_Tam.md': hidden(),
      'PCs/Jean.md': '---\ntype: pc\nplayer_name: Pat\n---\n\n# Jean\n## Background\nRaised by [[Old_Tam]], at 100%% and 50%% pay.\n[[Nowhere|## Skills]]\nSTAT14\n',
    }, sheetsOff);
    assert.deepStrictEqual(await fromDoctor(configPath), []);
    assert.deepStrictEqual(fromBuild(configPath), []);
    // The same note, steady, is read: the silence above is the withholding, not a blind spot.
    const steady = site({
      'Hidden/Old_Tam.md': hidden(),
      'PCs/Jean.md': '---\ntype: pc\nplayer_name: Pat\n---\n\n# Jean\n## Background\nRaised by [[Old_Tam]], at 100%% and 50%% pay.\n',
    }, sheetsOff);
    assert.deepStrictEqual((await fromDoctor(steady.configPath)).map((f) => f.code), ['COMMENT_STRAY', 'NAMED_NO_PAGE']);
  });
});

describe('a relationship whose type is only a comment', () => {
  it('builds: the page is written, with no type on the row', () => {
    const { configPath, root } = site({
      'People/Case.md': npcNote('Text.', 'relationships:\n  - target: "[[Bo]]"\n    type: "%%ally%%"\n'),
      'People/Bo.md': npcNote('Bo.'),
    });
    fromBuild(configPath);
    const html = fs.readFileSync(path.join(root, 'docs', 'people', 'case.html'), 'utf8');
    assert.ok(!/ally/.test(html), 'the comment is printed');
  });
  it('a type written as a list builds too, on the page of either end', () => {
    const { configPath, root } = site({
      'People/Case.md': npcNote('Text.', 'relationships:\n  - target: "[[Bo]]"\n    type: [ally, rival]\n'),
      'People/Bo.md': npcNote('Bo.'),
    });
    fromBuild(configPath);
    for (const page of ['case.html', 'bo.html']) assert.ok(fs.existsSync(path.join(root, 'docs', 'people', page)), page);
  });
});

describe('the look for a name in a page only ever sends more pages to the second render', () => {
  // The page prints "Marsh & Sons"; its HTML holds `&amp;` between the words.
  const amp = { 'Hidden/Marsh_&_Sons.md': hidden() };
  const named = async (files) => pagesOf(await faults(Object.assign({}, amp, { 'Hidden/Old_Tam.md': hidden() }, files), 'NAMED_NO_PAGE'), 'Hidden/Marsh_&_Sons.md');

  it('finds a name with an & in it in the body', async () => {
    assert.deepStrictEqual(await named({ 'People/Bo_Pike.md': npcNote('Intro.\n\n## Seen\n\nWe met [[Marsh_&_Sons]] today.') }), ['People/Bo_Pike.md']);
  });
  it('finds it in a frontmatter field the page prints', async () => {
    assert.deepStrictEqual(await named({ 'People/Bo_Pike.md': npcNote('Intro.', 'location: "[[Marsh_&_Sons]]"\n') }), ['People/Bo_Pike.md']);
  });
  it('finds it in a table cell, and as a label with an & in it', async () => {
    const found = await faults(Object.assign({}, amp, {
      'Hidden/Old_Tam.md': hidden(),
      'People/Bo_Pike.md': npcNote('Intro.\n\n## Seen\n\n| who | where |\n|---|---|\n| x | [[Marsh_&_Sons]] |\n'),
      'People/Cy_Dunn.md': npcNote('Intro.\n\n## Seen\n\n| who |\n|---|\n| [[Old_Tam\\|Tam & Co]] |\n'),
    }), 'NAMED_NO_PAGE');
    assert.deepStrictEqual(found.map((f) => [f.path, f.pages, f.printed]), [
      ['Hidden/Marsh_&_Sons.md', ['People/Bo_Pike.md'], ['Marsh & Sons']],
      ['Hidden/Old_Tam.md', ['People/Cy_Dunn.md'], ['Tam & Co']],
    ]);
  });
  it('finds a label with markup inside it, with a typed character reference, and one the typographer rewrites', async () => {
    for (const label of ['**Old** Tam', 'Feather**stone** Hall', 'Old_Tam the `elder`', 'Caf&eacute; Tam', 'Tam (tm) Co', 'Corwin->Thides']) {
      const found = await faults({
        'Hidden/Old_Tam.md': hidden(),
        'People/Bo_Pike.md': npcNote(`Intro.\n\n## Seen\n\nWe met [[Old_Tam|${label}]] today.`),
      }, 'NAMED_NO_PAGE');
      assert.deepStrictEqual(found.map((f) => f.pages), [['People/Bo_Pike.md']], label);
    }
  });
});

describe('a name only an index or listing page prints', () => {
  const npcs = (extra) => `---\ntype: npc\n${extra}---\n\nA guest.\n`;

  it('NAMED_NO_PAGE: counted against the note whose field supplies the words, and the finding names the index page', async () => {
    const { configPath, root } = site({
      'Hidden/Old_Tam.md': hidden(),
      'Characters/NPCs/Bo_Pike.md': npcs('first_appearance: "[[Old_Tam]]"\n'),
    });
    const found = (await fromDoctor(configPath)).filter((f) => f.code === 'NAMED_NO_PAGE');
    assert.deepStrictEqual(fromBuild(configPath).filter((f) => f.code === 'NAMED_NO_PAGE'), found);
    // The ground truth: the NPC's own page does not print the field, the index does.
    assert.ok(!/Old Tam/.test(fs.readFileSync(path.join(root, 'docs', 'characters', 'npcs', 'bo-pike.html'), 'utf8')));
    assert.match(fs.readFileSync(path.join(root, 'docs', 'characters', 'npcs', 'index.html'), 'utf8'), /Old Tam/);
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual([found[0].path, found[0].pages, found[0].viaListing, found[0].listings],
      ['Hidden/Old_Tam.md', ['Characters/NPCs/Bo_Pike.md'], ['Characters/NPCs/Bo_Pike.md'], ['characters/npcs/index.html']]);
    assert.match(found[0].detail, /for 1 of them it is an index or listing page that prints the name, from that note \(characters\/npcs\/index\.html\)/);
  });

  it('NAMED_NO_PAGE: a note whose own page prints the name too is not said to be index-only', async () => {
    const [f] = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Characters/NPCs/Bo_Pike.md': `---\ntype: npc\nfirst_appearance: "[[Old_Tam]]"\n---\n\nIntro.\n\n## Seen\n\nWith [[Old_Tam]].\n`,
    }, 'NAMED_NO_PAGE');
    assert.deepStrictEqual([f.pages, f.viaListing, f.listings], [['Characters/NPCs/Bo_Pike.md'], [], ['characters/npcs/index.html']]);
    assert.ok(!/index or listing page/.test(f.detail), f.detail);
  });

  it('ALIAS_IN_PROSE: a secret name an index page prints from a note\'s field is reported against that note', async () => {
    const found = await faults({
      'Characters/NPCs/Mr_Grey.md': npcs('gm_aliases: ["The Watcher"]\n'),
      'Creatures/Mire_Hound.md': '---\ntype: creature\nsubtype: "Hound of The Watcher"\n---\n\nA hound.\n',
      'Chapters/Chapter_1.md': '---\ntype: chapter\noverview: "In which The Watcher is met."\n---\n\nA chapter.\n',
    }, 'ALIAS_IN_PROSE');
    const byPath = new Map(found.map((f) => [f.path, f]));
    assert.deepStrictEqual(byPath.get('Creatures/Mire_Hound.md').listings, ['creatures/index.html']);
    assert.deepStrictEqual(byPath.get('Chapters/Chapter_1.md').listings, ['chapters/index.html']);
    assert.strictEqual(byPath.get('Creatures/Mire_Hound.md').owner, 'Characters/NPCs/Mr_Grey.md');
  });

  it('ALIAS_IN_PROSE: found in the words an index card prints under a name, which sit inside the card\'s link', async () => {
    const { configPath, root } = site({
      'Characters/NPCs/Mr_Grey.md': npcs('gm_aliases: ["The Watcher"]\n'),
      'Events/Ball.md': '---\ntype: event\noccupation: "Servant of The Watcher"\n---\n\nA ball.\n',
    });
    const found = (await fromDoctor(configPath)).filter((f) => f.code === 'ALIAS_IN_PROSE');
    assert.deepStrictEqual(fromBuild(configPath).filter((f) => f.code === 'ALIAS_IN_PROSE'), found);
    assert.match(fs.readFileSync(path.join(root, 'docs', 'events', 'index.html'), 'utf8'), /<a [^>]*>[^]*?Servant of The Watcher[^]*?<\/a>/);
    assert.deepStrictEqual(found.map((f) => [f.path, f.listings]), [['Events/Ball.md', ['events/index.html']]]);
  });

  it('ALIAS_IN_PROSE: found where an index card only carries it, in an attribute its filter reads', async () => {
    const found = await faults({
      'Characters/NPCs/Mr_Grey.md': npcs('gm_aliases: ["The Watcher"]\n'),
      'Events/Ball.md': '---\ntype: event\nstatus: "The Watcher"\n---\n\nA ball.\n',
    }, 'ALIAS_IN_PROSE');
    assert.deepStrictEqual(found.map((f) => [f.path, f.listings]), [['Events/Ball.md', ['events/index.html']]]);
  });

  it('NAMED_NO_PAGE: a name the landing page prints from a recap is counted, and the finding names the landing page', async () => {
    const [f] = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Sessions/Session_1.md': '---\ntype: session\nsession_number: 1\nstatus: played\ndocuments:\n  wrap_up: "[[Session_1_Wrap_Up]]"\n---\n\nPrep.\n',
      'Sessions/Session_1_Wrap_Up.md': '---\ntype: session_wrap\nsession: "[[Session_1]]"\ncanon_status: AUTHORITATIVE\n---\n\n## Narrative Recap\n\nThey met [[Old_Tam]] at the quay.\n',
    }, 'NAMED_NO_PAGE');
    assert.ok(f.pages.includes('Sessions/Session_1_Wrap_Up.md'), JSON.stringify(f.pages));
    assert.ok(f.listings.includes('index.html'), JSON.stringify(f.listings));
    assert.deepStrictEqual(f.viaListing, []);
  });

  it('is silent for a field no page of the site prints', async () => {
    assert.deepStrictEqual(await faults({
      'Hidden/Old_Tam.md': hidden(),
      'Characters/NPCs/Mr_Grey.md': npcs('gm_aliases: ["The Watcher"]\n'),
      'Characters/NPCs/Bo_Pike.md': npcs('private_memo: "[[Old_Tam]] and The Watcher"\n'),
    }), []);
  });
});

describe('the connections graph', () => {
  const rel = (target, extra = '') => `relationships:\n  - target: "${target}"\n    type: knows\n${extra}`;

  it('a name the graph prints on a page is counted on that page, two links away too', async () => {
    const found = await faults({
      'Hidden/Old_Tam.md': hidden(),
      'People/Bo_Pike.md': npcNote('Bo.', rel('[[Cy_Dunn]]')),
      'People/Cy_Dunn.md': npcNote('Cy.', rel('[[Old_Tam]]')),
    }, 'NAMED_NO_PAGE');
    // Cy's page prints the relationship; Bo's page prints the name only on its graph.
    assert.deepStrictEqual(found.map((f) => [f.path, f.pages]), [['Hidden/Old_Tam.md', ['People/Bo_Pike.md', 'People/Cy_Dunn.md']]]);
  });

  it('holds only the label of a labelled target that has no page: the note\'s own name is on neither page', async () => {
    const { configPath, root } = site({
      'Hidden/Vesper_Hale.md': hidden('portrait: secret.png\noccupation: Spy\naliases: [The Shade]\n'),
      'People/Bo_Pike.md': npcNote('Bo.', rel('[[Vesper_Hale|the stranger]]', '    description: "owes him money"\n  - target: "[[Cy_Dunn]]"\n    type: knows\n')),
      'People/Cy_Dunn.md': npcNote('Cy.', rel('[[Bo_Pike]]')),
    });
    const found = fromBuild(configPath);
    assert.deepStrictEqual(await fromDoctor(configPath), found);
    for (const page of ['bo-pike.html', 'cy-dunn.html']) {
      const html = fs.readFileSync(path.join(root, 'docs', 'people', page), 'utf8');
      assert.ok(/the stranger/.test(html), `${page} lacks the label`);
      for (const secret of ['Vesper', 'Spy', 'Shade', 'secret.png']) assert.ok(!html.includes(secret), `${page} prints ${secret}`);
    }
    assert.deepStrictEqual(found.map((f) => [f.path, f.pages, f.printed]), [['Hidden/Vesper_Hale.md', ['People/Bo_Pike.md', 'People/Cy_Dunn.md'], ['the stranger']]]);
  });

  it('a labelled target that has a page is read as it always was', () => {
    const { buildRelationshipGraph } = require('../lib/relationship-graph');
    const page = (title, relationships) => ({ title, displayTitle: title, outputPath: `${title}.html`, frontmatter: { type: 'npc', relationships } });
    const graph = buildRelationshipGraph('A', [page('A', [{ target: '[[B|the baker]]', type: 'knows' }]), page('B', [])], {});
    assert.deepStrictEqual(graph.nodes.map((n) => [n.id, n.displayTitle, n.outputPath]), [['A', 'A', 'A.html'], ['B|the baker', 'B|the baker', null]]);
  });
});

describe('a heading that holds a link to a note with no page', () => {
  const extra = '  exclude_sections:\n    - GM Notes\n    - Notes on Old Tam\n';
  const run = async (body) => {
    const { configPath, root } = site({ 'Hidden/Old_Tam.md': hidden(), 'Hidden/Notes.md': hidden(), 'Hidden/Brass_Key.md': hidden(), 'People/Bo_Pike.md': npcNote(body) }, extra);
    const found = (await fromDoctor(configPath)).filter((f) => f.code === 'NAMED_NO_PAGE');
    assert.deepStrictEqual(fromBuild(configPath).filter((f) => f.code === 'NAMED_NO_PAGE'), found);
    return { paths: found.map((f) => f.path), html: fs.readFileSync(path.join(root, 'docs', 'people', 'bo-pike.html'), 'utf8') };
  };

  it('is hidden or shown in the second render exactly as in the build: a heading the build shows', async () => {
    // The build reads this title as "notes on old_tam", which is not the excluded name, and
    // shows the section. A mark that changed the reading would hide it, and miss both links.
    const { paths, html } = await run('Intro.\n\n## Notes on [[Old_Tam]]\n\nThe [[Brass_Key]] is here.\n');
    assert.match(html, /Brass Key/);
    assert.deepStrictEqual(paths, ['Hidden/Brass_Key.md', 'Hidden/Old_Tam.md']);
  });
  it('a heading whose link is run on to a word, which the build shows as another word', async () => {
    const { paths, html } = await run('Intro.\n\n## GM[[Notes]]\n\nThe [[Brass_Key]] is here.\n');
    assert.match(html, /Brass Key/);
    assert.deepStrictEqual(paths, ['Hidden/Brass_Key.md', 'Hidden/Notes.md']);
  });
  it('a heading the build hides', async () => {
    const { paths, html } = await run('Intro.\n\n## [[Old_Tam|GM Notes]]\n\nThe [[Brass_Key]] is here.\n');
    assert.ok(!/Brass Key/.test(html));
    assert.deepStrictEqual(paths, []);
  });
});

describe('ALIAS_IN_PROSE: spellings and places that used to slip by', () => {
  const owner = { 'People/Mr_Grey.md': '---\ntype: npc\ngm_aliases: ["The Watcher", "Zorvek", "Old-Nick"]\n---\n\nA quiet man.\n' };
  const aliases = async (files) => (await faults(Object.assign({}, owner, files), 'ALIAS_IN_PROSE')).map((f) => [f.path, f.alias]);

  it('finds the name as the whole value of a stat box, where the label and the value run together', async () => {
    assert.deepStrictEqual(await aliases({ 'Items/Odd_Rig.md': '---\ntype: item\ntl: Zorvek\n---\n\nA rig.\n' }), [['Items/Odd_Rig.md', 'Zorvek']]);
  });
  it('finds it typed with an underscore or a hyphen for the space, and with a space for the hyphen', async () => {
    for (const typed of ['The_Watcher', 'The-Watcher', 'the  watcher', 'Old Nick', 'Old_Nick']) {
      const got = await aliases({ 'People/Case.md': npcNote(`Intro.\n\n## Seen\n\nThey fear ${typed} at night.`) });
      assert.strictEqual(got.length, 1, typed);
    }
  });
  it('finds it with a character that prints nothing set between its words', async () => {
    assert.strictEqual((await aliases({ 'People/Case.md': npcNote('Intro.\n\n## Seen\n\nThey fear The​ Watcher at night.') })).length, 1);
  });
  it('still leaves a longer word alone', async () => {
    assert.deepStrictEqual(await aliases({ 'People/Case.md': npcNote('Intro.\n\n## Seen\n\nThe Watchers and Zorveks.') }), []);
  });
});

describe('a page that fails to render', () => {
  // The story link of a PC page asks the scanner for a slug: made to fail once, for one PC.
  const scanner = require('../lib/scanner');
  const failingOnce = (title, fn) => {
    const real = scanner.slugify;
    let failed = false;
    scanner.slugify = (name) => {
      if (name === title && !failed) { failed = true; throw new Error('made to fail'); }
      return real(name);
    };
    return Promise.resolve().then(fn).finally(() => { scanner.slugify = real; });
  };
  const files = {
    'Hidden/Old_Tam.md': hidden(),
    'People/Bo_Pike.md': npcNote('Intro.\n\n## Seen\n\nWith [[Old_Tam]].'),
    'PCs/Doomed.md': '---\ntype: pc\nplayer_name: Pat\n---\n\n# Doomed\n\n## Background\n\nMet [[Old_Tam]] at 100%% and 50%% pay.\n',
    'PCs/Doomed_Story.md': '---\ntype: character-story\n---\n\nA story.\n',
  };

  it('doctor --site says the list is incomplete, as an error, and keeps the findings it did make', async () => {
    const { configPath } = site(files);
    const out = [];
    const rc = await failingOnce('Doomed', () => runSiteDoctor({ configPath, json: true }, { out: (l) => out.push(String(l)), detect: () => null }));
    const all = JSON.parse(out.join('')).findings;
    const unchecked = all.filter((f) => f.code === 'NOTE_FAULTS_UNCHECKED');
    assert.strictEqual(unchecked.length, 1, JSON.stringify(all.map((f) => f.code)));
    assert.strictEqual(unchecked[0].severity, 'error');
    assert.match(unchecked[0].detail, /1 page could not be rendered in memory \(pcs\/doomed\.html: made to fail\).*the list is incomplete/);
    assert.strictEqual(rc, 1);
    // The page that did render is still read.
    assert.deepStrictEqual(all.filter((f) => f.code === 'NAMED_NO_PAGE').map((f) => f.pages), [['People/Bo_Pike.md']]);
  });
  it('the same vault with nothing failing has no such error, and reads the PC too', async () => {
    const found = await fromDoctor(site(files).configPath);
    assert.deepStrictEqual(found.map((f) => f.code), ['COMMENT_STRAY', 'NAMED_NO_PAGE']);
    assert.deepStrictEqual(found[1].pages, ['PCs/Doomed.md', 'People/Bo_Pike.md']);
  });
});

describe('pageText', () => {
  it('reads a page a block to a line, with inline markup joined, entities decoded and scripts left out', () => {
    const html = '<main><h1>A &amp; B</h1><p>one <strong>tw</strong>o<br>three</p><script>var x = "no";</script><ul><li>four</li></ul></main>';
    assert.strictEqual(pageText(html), 'A & B\none two\nthree\nfour');
  });
  it('can leave out what a link to another page of the site prints, and keep an outside link\'s words', () => {
    const html = '<p>See <a href="../x.html">Other Page</a> and <a href="https://example.com">the paper</a>.</p>';
    assert.strictEqual(pageText(html, { links: false }), 'See and the paper.');
  });
  it('can set a sheet\'s small boxes apart for reading, where the plain reading joins them', () => {
    const html = '<div><span class="k">ST</span><span class="v">12</span></div>';
    assert.strictEqual(pageText(html), 'ST12');
    assert.strictEqual(pageText(html, { spaced: true }), 'ST 12');
  });
  it('can add the words a tag carries', () => {
    assert.strictEqual(pageText('<p>x<img alt="a sketch" src="a.png"></p>', { attributes: true }), 'x a sketch');
  });
});
