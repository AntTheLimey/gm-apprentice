const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseNote } = require('../../lib/frontmatter');
const { splitFront } = require('../../lib/settings/write');
const { scanVaultReport } = require('../../lib/scanner');

// A frontmatter opener may name a language (`---js`). Only YAML is ever read: a note that
// names another language is a note whose frontmatter cannot be parsed, and nothing in it runs.
const JS_NOTE = (flag) => `---js\n(globalThis.${flag} = true, { type: 'npc' })\n---\nBody.\n`;

afterEach(() => { delete globalThis.__fmRanNote; delete globalThis.__fmRanSettings; delete globalThis.__fmRanScan; });

describe('frontmatter is YAML only', () => {
  it('parseNote refuses a ---js note without running it', () => {
    assert.throws(() => parseNote(JS_NOTE('__fmRanNote')), /YAML/);
    assert.strictEqual(globalThis.__fmRanNote, undefined);
  });

  it('parseNote refuses ---javascript and ---json openers too', () => {
    assert.throws(() => parseNote('---javascript\n({ type: "npc" })\n---\n'), /YAML/);
    assert.throws(() => parseNote('---json\n{ "type": "npc" }\n---\n'), /YAML/);
  });

  it('parseNote still reads plain and ---yaml frontmatter', () => {
    assert.deepStrictEqual(parseNote('---\ntype: npc\n---\nBody.\n').data, { type: 'npc' });
    assert.deepStrictEqual(parseNote('---yaml\ntype: npc\n---\nBody.\n').data, { type: 'npc' });
  });

  it('the old settings file split refuses a ---js file without running it', () => {
    assert.throws(() => splitFront(JS_NOTE('__fmRanSettings')), /YAML/);
    assert.strictEqual(globalThis.__fmRanSettings, undefined);
  });

  it('the scanner lists a ---js note as one whose frontmatter cannot be parsed', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-yaml-only-'));
    try {
      fs.writeFileSync(path.join(vault, 'Trap.md'), JS_NOTE('__fmRanScan'));
      fs.writeFileSync(path.join(vault, 'Fine.md'), '---\ntype: npc\n---\nBody.\n');
      const report = scanVaultReport({ vaultPath: vault, excludeDirs: [], folderMap: {} }, { quiet: true });
      assert.deepStrictEqual(report.malformed.map((m) => m.rel), ['Trap.md']);
      assert.strictEqual(globalThis.__fmRanScan, undefined);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
