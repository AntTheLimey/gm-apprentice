'use strict';
// tools/publish/test/leak-gate/names.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leakSite, leakInto } = require('../helpers/leak-site');
const { runLeakGate } = require('../../lib/leak-gate');

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
    const notes = { ...NOTES, 'NPCs/Vesper.md': '---\ntype: npc\nwithheld: true\n---\nA hidden one.\n' };
    const s = leakSite(notes, SETTINGS);
    try {
      assert.ok(runLeakGate({ configPath: s.configPath, outputDir: s.outputDir }).findings.some((x) => x.code === 'WITHHELD_PUBLISHED' && x.note === 'NPCs/Vesper.md'));
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
      leakInto(s.outputDir, 'npcs/linker.html', 'The Kestrels flew.');
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

