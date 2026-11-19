'use strict';
// tools/publish/test/leak-gate/names.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');
const { listFileText } = require('../helpers/publish-list');

const NOTES = {
  'NPCs/Lord Vane.md': '---\ntype: npc\ngm_aliases: [Elias Crowe]\n---\nA lord.\n',
  'NPCs/Vesper.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nA hidden one.\n',
  'NPCs/Linker.md': '---\ntype: npc\n---\nShe met [[Vesper]] at the quay. They whisper of [[Elias Crowe]].\n',
  'NPCs/Zorn Manor.md': '---\ntype: npc\n---\nA house.\n',
  'NPCs/Zorn.md': '---\ntype: npc\nwithheld: true\npublish: false\n---\nA man.\n',
  'NPCs/Visitor.md': '---\ntype: npc\n---\nShe visits [[Zorn Manor]] often.\n',
};
const SETTINGS = { player: { folder_map: { NPCs: 'npcs' } } };

describe('leak gate: secret names', () => {
  it('a clean build has no name finding (a linked alias prints the public name; a public name holding a withheld one is public)', () => {
    const s = leakSite(NOTES, SETTINGS);
    try { assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []); } finally { s.cleanup(); }
  });
  it('a GM alias in the finished folder stops the gate', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'Elias Crowe was here');
      const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.find((x) => x.code === 'ALIAS_IN_PROSE');
      assert.ok(f);
      assert.equal(f.page, 'npcs/linker.html');
      assert.equal(f.note, 'NPCs/Lord Vane.md');
      assert.equal(f.text, 'elias crowe');
    } finally { s.cleanup(); }
  });
  it('a disguised NPC\'s unmasked_name printed on a page stops the gate, as a GM alias does', () => {
    const notes = {
      'NPCs/Pedlar.md': '---\ntype: npc\nunmasked_name: "Captain Rook"\n---\nSells ribbons.\n',
      'NPCs/Gossip.md': '---\ntype: npc\n---\nShe swears the pedlar is Captain Rook.\n',
    };
    const s = leakSite(notes, SETTINGS);
    try {
      const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'ALIAS_IN_PROSE');
      const page = f.find((x) => x.page === 'npcs/gossip.html');
      assert.deepEqual(page && [page.note, page.text], ['NPCs/Pedlar.md', 'captain rook'], JSON.stringify(f));
      assert.match(page.reason, /unmasked_name/);
      // the build's own note audit finds it too
      assert.ok(s.logs.some((l) => /1 unmasked name is printed on published pages \(Captain Rook 1 page\)/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
  // #796 and the run sheet's unmasking: a secret name the GM also lists under `aliases` (so the link resolves in
  // Obsidian) is kept off the site and still searched, whether it is an unmasked_name or a gm_aliases name.
  for (const [field, line] of [['unmasked_name', 'unmasked_name: "Captain Rook"'], ['unmasked_name link', 'unmasked_name: [[Captain Rook|the captain]]'],
    ['gm_aliases', 'gm_aliases: ["Captain Rook"]']]) {
    it(`a ${field} name also written in aliases is on no page, and the gate finds it when a page prints it (#796)`, () => {
      const notes = {
        'NPCs/Pedlar.md': `---\ntype: npc\naliases: ["The Pedlar", "Captain Rook"]\n${line}\n---\nSells ribbons.\n`,
        'NPCs/Gossip.md': '---\ntype: npc\n---\nShe buys from [[Captain Rook]] and [[The Pedlar]].\n',
      };
      const s = leakSite(notes, SETTINGS);
      try {
        // `rook` alone: the search index holds a name as single words
        const holding = s.player.files().filter((f) => /rook/i.test(fs.readFileSync(f, 'utf8')));
        assert.deepEqual(holding.map((f) => path.relative(s.outputDir, f)), [], 'no built file holds the true name');
        assert.ok(s.player.exists('search-index.json') && s.player.exists('previews.json'), 'the index and previews were built');
        assert.match(s.player.read('npcs', 'gossip.html'), /She buys from <a [^>]*>Pedlar<\/a>/);
        assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
        leakInto(s.outputDir, 'npcs/gossip.html', 'the pedlar is Captain Rook');
        const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'ALIAS_IN_PROSE');
        assert.deepEqual(f.filter((x) => x.page.endsWith('.html')).map((x) => [x.page, x.note, x.text]), [['npcs/gossip.html', 'NPCs/Pedlar.md', 'captain rook']]);
      } finally { s.cleanup(); }
    });
  }
  // A name with an apostrophe: straight or curly, in a secret field alone or also in aliases, printed either way.
  for (const [quote, field, inAliases] of [["'", 'unmasked_name', true], ["'", 'gm_aliases', true], ['’', 'unmasked_name', false],
    ['’', 'gm_aliases', false], ['’', 'unmasked_name', true], ['’', 'gm_aliases', true]]) {
    const name = `Captain O${quote}Rook`;
    for (const printed of [...new Set([name, 'Captain O\'Rook', 'Captain O’Rook'])]) {
      it(`the gate finds ${printed} for ${name} in ${field}${inAliases ? ' and aliases' : ''} (#796, quotes)`, () => {
        const secret = field === 'unmasked_name' ? `unmasked_name: "${name}"` : `gm_aliases: ["${name}"]`;
        const notes = {
          'NPCs/Pedlar.md': `---\ntype: npc\naliases: ["The Pedlar"${inAliases ? `, "${name}"` : ''}]\n${secret}\n---\nSells ribbons.\n`,
          'NPCs/Gossip.md': `---\ntype: npc\n---\nThe pedlar is ${printed}.\n`,
        };
        const s = leakSite(notes, SETTINGS);
        try {
          const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'ALIAS_IN_PROSE');
          assert.ok(f.some((x) => x.page === 'npcs/gossip.html' && x.note === 'NPCs/Pedlar.md'), JSON.stringify(f));
        } finally { s.cleanup(); }
      });
    }
  }
  it('a page that prints a secret name in aliases is found by the build too (#796)', () => {
    const notes = {
      'NPCs/Pedlar.md': '---\ntype: npc\naliases: ["The Pedlar", "Captain Rook"]\nunmasked_name: "Captain Rook"\n---\nSells ribbons.\n',
      'NPCs/Gossip.md': '---\ntype: npc\n---\nShe swears the pedlar is Captain Rook.\n',
    };
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(s.logs.some((l) => /1 unmasked name is printed on published pages \(Captain Rook 1 page\)/.test(l)), s.logs.join('\n'));
      const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'ALIAS_IN_PROSE');
      assert.deepEqual(f.filter((x) => x.page.endsWith('.html')).map((x) => x.page), ['npcs/gossip.html']);
    } finally { s.cleanup(); }
  });
  it('a secret name that is a published page\'s own name is not searched, and the build says so (#796)', () => {
    const notes = {
      'NPCs/Pedlar.md': '---\ntype: npc\nunmasked_name: "Captain Rook"\ngm_aliases: [Mara Quill]\n---\nSells ribbons.\n',
      'NPCs/Captain Rook.md': '---\ntype: npc\n---\nA famous pirate.\n',
      'NPCs/Mara.md': '---\ntype: npc\naliases: [Mara Quill]\n---\nA clerk.\n',
    };
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(s.logs.some((l) => /2 secret names are also the names of published pages, so they are not looked for \(Captain Rook, Mara Quill\)/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
  for (const value of ['"[[Captain Rook]]"', '"[[Captain Rook|the captain]]"', '[[Captain Rook]]', '[[Captain Rook|the captain]]']) {
    it(`an unmasked_name written as a link (${value}) is searched as the name it links (C1)`, () => {
      const notes = {
        'NPCs/Pedlar.md': `---\ntype: npc\nunmasked_name: ${value}\n---\nSells ribbons.\n`,
        'NPCs/Gossip.md': '---\ntype: npc\n---\nShe swears the pedlar is Captain Rook.\n',
      };
      const s = leakSite(notes, SETTINGS);
      try {
        const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'ALIAS_IN_PROSE');
        assert.deepEqual(f.filter((x) => x.page.endsWith('.html')).map((x) => [x.page, x.text]), [['npcs/gossip.html', 'captain rook']], value);
      } finally { s.cleanup(); }
    });
  }
  it('an unmasked_name that names no one is told by the build (C1)', () => {
    const notes = { 'NPCs/Pedlar.md': '---\ntype: npc\nunmasked_name: "[[]]"\n---\nSells ribbons.\n' };
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(s.logs.some((l) => /NPCs\/Pedlar\.md: unmasked_name holds \[\[\]\], which names no one, so no true name is looked for on the site/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
  it('a withheld name written back by a step, in a JSON file, stops the gate', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      fs.writeFileSync(path.join(s.outputDir, 'extra.json'), JSON.stringify({ who: 'Vesper' }));
      const f = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.find((x) => x.code === 'WITHHELD_IN_PROSE');
      assert.ok(f);
      assert.equal(f.page, 'extra.json');
      assert.equal(f.note, 'NPCs/Vesper.md');
    } finally { s.cleanup(); }
  });
  for (const [where, html] of [
    ['a JSON island', '<script type="application/json" id="cx-data">{"who":"Elias Crowe"}</script>'],
    ['a data-* attribute', '<span data-who="Elias Crowe"></span>'],
    ['a name split by tags', 'They saw Eli<em>as</em> Crowe.'],
  ]) {
    it(`a GM alias in ${where} stops the gate (M5, M6)`, () => {
      const s = leakSite(NOTES, SETTINGS);
      try {
        leakInto(s.outputDir, 'npcs/linker.html', html);
        const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings;
        assert.ok(found.some((x) => x.code === 'ALIAS_IN_PROSE' && x.page === 'npcs/linker.html'), JSON.stringify(found));
      } finally { s.cleanup(); }
    });
  }
  it('a withheld name in a copied file\'s name stops the gate', () => {
    const s = leakSite(NOTES, SETTINGS);
    try {
      fs.mkdirSync(path.join(s.outputDir, 'images'), { recursive: true });
      fs.writeFileSync(path.join(s.outputDir, 'images', 'vesper-portrait.png'), 'x');
      assert.ok(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.some((x) => x.code === 'WITHHELD_IN_PROSE' && x.page === 'images/vesper-portrait.png'));
    } finally { s.cleanup(); }
  });
  it('a withheld note that publishes stops the gate', () => {
    // A withheld note publishes only from the publish list (#619).
    const notes = { ...NOTES, 'NPCs/Vesper.md': '---\ntype: npc\nwithheld: true\n---\nA hidden one.\n' };
    notes['_meta/publish-list.yaml'] = listFileText({ publishing: Object.keys(notes).filter((rel) => rel.endsWith('.md')) });
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.some((x) => x.code === 'WITHHELD_PUBLISHED' && x.note === 'NPCs/Vesper.md'));
    } finally { s.cleanup(); }
  });
  it('a withheld note kept off by its flag alone (no publish list) still has its name caught in prose (#619)', () => {
    const notes = {
      'NPCs/Hollis Crane.md': '---\ntype: npc\nwithheld: true\n---\nThe lodge master.\n',
      'NPCs/Teller.md': '---\ntype: npc\n---\nThe teller says Hollis Crane waits below.\n',
    };
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(!fs.existsSync(path.join(s.outputDir, 'npcs', 'hollis-crane.html')), 'no page for the withheld note');
      assert.ok(fs.existsSync(path.join(s.outputDir, 'npcs', 'teller.html')));
      const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings
        .filter((x) => x.code === 'WITHHELD_IN_PROSE' && x.note === 'NPCs/Hollis Crane.md');
      assert.ok(found.some((x) => x.page === 'npcs/teller.html'), JSON.stringify(found));
    } finally { s.cleanup(); }
  });
  it('a name finding can be accepted, keyed by the page and the name (amendment 4)', () => {
    const s = leakSite({ ...NOTES, '_meta/publish-list.yaml': 'accepted:\n  - page: npcs/linker.html\n    text: elias crowe\n    note: NPCs/Lord Vane.md\n' }, SETTINGS);
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'Elias Crowe was here');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
      leakInto(s.outputDir, 'npcs/visitor.html', 'Elias Crowe was here');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.map((f) => f.page), ['npcs/visitor.html']);
    } finally { s.cleanup(); }
  });
});

describe('leak gate: never-show words (player_site.never_show)', () => {
  const WORDS = { player: { folder_map: { NPCs: 'npcs' }, never_show: ['Blue Lady', 'Kestrel'] } };
  it('a clean build has no finding', () => {
    const s = leakSite(NOTES, WORDS);
    try { assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []); } finally { s.cleanup(); }
  });
  it('a listed phrase on a page, in any case and with a hyphen between its words, stops the gate', () => {
    const s = leakSite(NOTES, WORDS);
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'They feared the BLUE-lady most.');
      const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'NEVER_SHOW');
      assert.deepEqual(found.map((f) => [f.page, f.text, f.note]), [['npcs/linker.html', 'blue lady', 'player_site.never_show']]);
      assert.match(found[0].shown, /BLUE-lady/);
    } finally { s.cleanup(); }
  });
  it('a word inside a longer word is not a finding', () => {
    const s = leakSite(NOTES, WORDS);
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'The Kestrelton flew. The kestrels flew.');
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });
  it('a listed word in a public note\'s own text is still a finding: the GM said never', () => {
    const notes = { ...NOTES, 'NPCs/Kestrel.md': '---\ntype: npc\n---\nA bird of a name.\n' };
    const s = leakSite(notes, WORDS);
    try {
      const pages = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'NEVER_SHOW').map((f) => f.page);
      assert.ok(pages.includes('npcs/kestrel.html'), JSON.stringify(pages));
    } finally { s.cleanup(); }
  });
  it('a listed word in a copied file\'s name stops the gate', () => {
    const s = leakSite(NOTES, WORDS);
    try {
      fs.writeFileSync(path.join(s.outputDir, 'kestrel-map.png'), 'x');
      const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'NEVER_SHOW');
      assert.deepEqual(found.map((f) => f.page), ['kestrel-map.png']);
    } finally { s.cleanup(); }
  });
  it('an accepted finding no longer stops the gate', () => {
    const s = leakSite(NOTES, WORDS);
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'Kestrel was here.');
      const [f] = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings;
      const list = path.join(s.root, 'vault', '_meta', 'publish-list.yaml');
      assert.ok(fs.existsSync(path.dirname(list)));
      fs.appendFileSync(list, `accepted:\n  - page: ${f.page}\n    text: ${f.text}\n    note: ${f.note}\n`);
      assert.deepEqual(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings, []);
    } finally { s.cleanup(); }
  });
  it('a vault kept by a player is still checked for never-show words', () => {
    const s = leakSite(NOTES, { ...WORDS, vault: { kept_by: 'player' }, gm: { publish: false } });
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'Kestrel was here.');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.equal(r.skipped, null);
      assert.deepEqual(r.findings.map((f) => f.code), ['NEVER_SHOW']);
    } finally { s.cleanup(); }
  });
  it('a listed phrase in a public note\'s aliases is a finding on the search index (it holds them as single terms)', () => {
    const notes = { ...NOTES, 'NPCs/Bird.md': '---\ntype: npc\naliases: [Blue Lady, Wren]\n---\nA bird.\n' };
    const s = leakSite(notes, WORDS);
    try {
      const found = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.filter((x) => x.code === 'NEVER_SHOW');
      assert.deepEqual(found.map((f) => [f.page, f.text]), [['search-index.json', 'blue lady']]);
      assert.match(found[0].shown, /aliases of Bird/);
    } finally { s.cleanup(); }
  });
  it('the build\'s note audit warns of a listed word printed on a published page (NEVER_SHOW_IN_PROSE)', () => {
    const notes = { ...NOTES, 'NPCs/Bob.md': '---\ntype: npc\n---\nBob saw the blue lady at the quay.\n' };
    const s = leakSite(notes, WORDS);
    try {
      assert.ok(s.logs.some((l) => /1 never-show word is printed on published pages, so deploy will stop \(Blue Lady 1 note\)/.test(l)), s.logs.join('\n'));
    } finally { s.cleanup(); }
  });
  it('an older acceptance of another rule on the same page and text does not let a newly listed word through', () => {
    const s = leakSite(NOTES, { player: { folder_map: { NPCs: 'npcs' }, never_show: ['Vesper'] } });
    try {
      leakInto(s.outputDir, 'npcs/linker.html', 'Vesper was here.');
      const list = path.join(s.root, 'vault', '_meta', 'publish-list.yaml');
      fs.appendFileSync(list, 'accepted:\n  - page: npcs/linker.html\n    text: vesper\n    note: NPCs/Vesper.md\n');
      const r = runLeakGate({ configPath: s.configPath, outputDir: s.outputDir });
      assert.deepEqual(r.findings.map((f) => [f.code, f.page]), [['NEVER_SHOW', 'npcs/linker.html']]);
      assert.deepEqual(r.unneeded, []);
    } finally { s.cleanup(); }
  });
});

