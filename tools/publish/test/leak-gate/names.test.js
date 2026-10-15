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
