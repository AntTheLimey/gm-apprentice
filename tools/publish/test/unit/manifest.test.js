const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseManifest, loadManifest } = require('../../lib/manifest');

describe('parseManifest', () => {
  it('parses frontmatter metadata', () => {
    const md = [
      '---',
      'generated: 2026-04-18T14:30:00Z',
      'vault: "Test Campaign"',
      'mode: player',
      'total_files: 10',
      'publishing: 7',
      'excluded: 3',
      'needs_decision: 0',
      '---',
      '',
      '## Publishing (7 files)',
      '',
      '- [x] Characters/PCs/Hero.md',
      '- [x] Locations/Tavern.md',
      '',
      '## Excluded (3 files)',
      '',
      '- Reason: prep',
      '  - Sessions/Session 2.md',
    ].join('\n');

    const result = parseManifest(md);
    assert.strictEqual(result.meta.vault, 'Test Campaign');
    assert.strictEqual(result.meta.mode, 'player');
    assert.strictEqual(result.publishing.length, 2);
    assert.strictEqual(result.publishing[0], 'Characters/PCs/Hero.md');
    assert.strictEqual(result.publishing[1], 'Locations/Tavern.md');
  });

  it('parses needs_decision items with unchecked checkboxes', () => {
    const md = [
      '---',
      'generated: 2026-04-18T14:30:00Z',
      'needs_decision: 2',
      '---',
      '',
      '## Needs Decision (2 files)',
      '',
      '- [ ] Events/Mystery.md',
      '  — no status field',
      '- [x] Clues/Letter.md',
      '  — resolved: include',
    ].join('\n');

    const result = parseManifest(md);
    assert.strictEqual(result.needsDecision.length, 1);
    assert.strictEqual(result.needsDecision[0], 'Events/Mystery.md');
    assert.strictEqual(result.resolved.length, 1);
    assert.strictEqual(result.resolved[0], 'Clues/Letter.md');
  });

  it('returns empty arrays when no content', () => {
    const md = '---\ngenerated: 2026-04-18\n---\n';
    const result = parseManifest(md);
    assert.deepStrictEqual(result.publishing, []);
    assert.deepStrictEqual(result.needsDecision, []);
    assert.deepStrictEqual(result.resolved, []);
  });
});

describe('loadManifest', () => {
  it('returns null when manifest file does not exist', () => {
    const result = loadManifest('/nonexistent/path');
    assert.strictEqual(result, null);
  });

  it('loads and parses manifest from vault path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    const metaDir = path.join(tmpDir, '_meta');
    fs.mkdirSync(metaDir);
    const md = [
      '---',
      'generated: 2026-04-18T14:30:00Z',
      'publishing: 1',
      '---',
      '',
      '## Publishing (1 files)',
      '',
      '- [x] Characters/PCs/Hero.md',
    ].join('\n');
    fs.writeFileSync(path.join(metaDir, 'publish-manifest.md'), md);

    const result = loadManifest(tmpDir);
    assert.strictEqual(result.publishing.length, 1);
    assert.strictEqual(result.publishing[0], 'Characters/PCs/Hero.md');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
