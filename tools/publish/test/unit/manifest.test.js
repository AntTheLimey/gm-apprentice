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

  it('handles CRLF line endings', () => {
    const md = '---\r\ngenerated: 2026-04-18\r\npublishing: 2\r\n---\r\n\r\n## Publishing (2 files)\r\n\r\n- [x] Characters/PCs/Hero.md\r\n- [x] Locations/Tavern.md\r\n';
    const result = parseManifest(md);
    assert.strictEqual(result.publishing.length, 2);
    assert.strictEqual(result.publishing[0], 'Characters/PCs/Hero.md');
    assert.strictEqual(result.publishing[1], 'Locations/Tavern.md');
  });

  it('accepts uppercase X in checkboxes', () => {
    const md = '---\ngenerated: 2026-04-18\n---\n\n## Publishing (1 files)\n\n- [X] Characters/PCs/Hero.md\n';
    const result = parseManifest(md);
    assert.strictEqual(result.publishing.length, 1);
    assert.strictEqual(result.publishing[0], 'Characters/PCs/Hero.md');
  });

  it('returns empty arrays when no content', () => {
    const md = '---\ngenerated: 2026-04-18\n---\n';
    const result = parseManifest(md);
    assert.deepStrictEqual(result.publishing, []);
    assert.deepStrictEqual(result.needsDecision, []);
    assert.deepStrictEqual(result.resolved, []);
    assert.deepStrictEqual(result.excluded, []);
  });

  it('parses excluded file paths, skipping the Reason category bullets', () => {
    const md = [
      '---',
      'generated: 2026-04-18T14:30:00Z',
      'excluded: 2',
      '---',
      '',
      '## Excluded (2 files)',
      '',
      '- Reason: prep',
      '  - Sessions/Planned Session.md',
      '- Reason: GM override',
      '  - Characters/NPCs/Secret Villain.md — kept off-site',
    ].join('\n');

    const result = parseManifest(md);
    assert.deepStrictEqual(result.excluded, [
      'Sessions/Planned Session.md',
      'Characters/NPCs/Secret Villain.md',
    ]);
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

describe('parseManifest inline comments (issue #80)', () => {
  const { stripInlineComment } = require('../../lib/manifest');

  it('keeps only the path from an annotated Publishing entry', () => {
    const md = [
      '## Publishing (2 files)',
      '- [x] Documents/Freefighting (Spacer Kung-Fu).md — Six’s style writeup',
      '- [x] Locations/Thides.md',
    ].join('\n');
    assert.deepStrictEqual(parseManifest(md).publishing, [
      'Documents/Freefighting (Spacer Kung-Fu).md',
      'Locations/Thides.md',
    ]);
  });

  it('strips en-dash and double-hyphen comments too', () => {
    assert.strictEqual(stripInlineComment('A/B.md – note'), 'A/B.md');
    assert.strictEqual(stripInlineComment('A/B.md -- note'), 'A/B.md');
  });

  it('leaves a bare path untouched', () => {
    assert.strictEqual(stripInlineComment('A/B.md'), 'A/B.md');
  });

  it('does not cut a hyphenated filename', () => {
    assert.strictEqual(stripInlineComment('Docs/well-known-file.md'), 'Docs/well-known-file.md');
  });

  it('strips comments from Needs Decision entries as well', () => {
    const md = [
      '## Needs Decision (2 files)',
      '- [ ] A.md — undecided',
      '- [x] B.md — resolved, publish it',
    ].join('\n');
    const parsed = parseManifest(md);
    assert.deepStrictEqual(parsed.needsDecision, ['A.md']);
    assert.deepStrictEqual(parsed.resolved, ['B.md']);
  });
});

describe('parseManifest does not truncate dashed filenames (review regression)', () => {
  const { stripInlineComment } = require('../../lib/manifest');

  it('keeps an em-dash that is part of the filename', () => {
    assert.strictEqual(
      stripInlineComment('Items & Artifacts/Six — Field Sundries & Reloads.md'),
      'Items & Artifacts/Six — Field Sundries & Reloads.md');
  });

  it('keeps an en-dash that is part of the filename', () => {
    assert.strictEqual(
      stripInlineComment('Sessions/Session 3 – Aftermath.md'),
      'Sessions/Session 3 – Aftermath.md');
  });

  it('strips the comment from a dashed filename that also carries one', () => {
    assert.strictEqual(stripInlineComment('Items/Six — Field.md — the note'), 'Items/Six — Field.md');
  });

  it('is not confused by a dot in a directory name', () => {
    assert.strictEqual(stripInlineComment('v1.2/Notes.md — note'), 'v1.2/Notes.md');
    assert.strictEqual(stripInlineComment('v1.2/Notes.md'), 'v1.2/Notes.md');
  });

  it('stops at the path, not a .md mentioned inside the comment', () => {
    assert.strictEqual(stripInlineComment('Foo.md — see Bar.md'), 'Foo.md');
  });

  it('leaves an extensionless entry alone', () => {
    assert.strictEqual(stripInlineComment('NoExtension'), 'NoExtension');
  });
});
