const { describe, it } = require('node:test');
const assert = require('node:assert');
const { filterSections, strippedSectionTitles, sheetWithheldTitles, playerSafeMarkdown, processContent } = require('../../lib/processor');
const { PC_PROSE_SECTIONS, pcKeepList } = require('../../lib/pc-prose');
const pc = { type: 'pc' };
const rules = { pcKeepSections: PC_PROSE_SECTIONS };
const note = [
  '## Stat Sheet', '| ST | 14 |', '',
  '## Background', 'A sailor.', '### Skills', 'Mentioned in passing.', '',
  '## Skills', '| Brawling | 14 |', '',
  '## **Current Status**', '**Location:** Brest', '',
  '## Psionics', 'Telepathy 3', '',
  '## Notes:', 'Player notes.', '',
  '## GM Notes', '### Background', 'Secret.', '',
].join('\n');

describe('PC keep-list with character sheets off', () => {
  const out = filterSections(note, ['GM Notes'], pc, rules);
  it('keeps the prose sections, however the heading is dressed', () => {
    for (const kept of ['A sailor.', 'Mentioned in passing.', '**Location:** Brest', 'Player notes.']) assert.ok(out.includes(kept), kept);
  });
  it('withholds every other section, known or not', () => {
    for (const gone of ['| ST | 14 |', '| Brawling | 14 |', 'Telepathy 3', 'Secret.']) assert.ok(!out.includes(gone), gone);
  });
  it('does nothing without the rule', () => assert.ok(filterSections(note, ['GM Notes'], pc).includes('| ST | 14 |')));
  it('does nothing to a note that is not a PC', () => assert.ok(filterSections(note, ['GM Notes'], { type: 'npc' }, rules).includes('| ST | 14 |')));
  it('reports the sheet sections apart from the excluded ones', () => {
    assert.deepStrictEqual(sheetWithheldTitles(note, ['GM Notes'], pc, rules), ['Stat Sheet', 'Skills', 'Psionics']);
    assert.deepStrictEqual(strippedSectionTitles(note, ['GM Notes'], pc, rules), ['GM Notes']);
  });
  it('honours a GM-added heading', () =>
    assert.ok(filterSections(note, ['GM Notes'], pc, { pcKeepSections: [...PC_PROSE_SECTIONS, 'psionics'] }).includes('Telepathy 3')));
  it('reads the PC type case-insensitively', () => assert.ok(!filterSections(note, [], { type: 'PC' }, rules).includes('| ST | 14 |')));
});

describe('PC keep-list edge cases', () => {
  const body = (head) => `## Stat Sheet\n| ST | 14 |\n\n${head}\nProse here.\n`;
  it('keeps a keep-listed heading dressed as lower case, with a colon, or in italics', () => {
    for (const head of ['## background', '## Background:', '## *Background*', '## __Background__', '## **Background:**']) {
      const out = filterSections(body(head), [], pc, rules);
      assert.ok(out.includes('Prose here.'), head);
      assert.ok(!out.includes('| ST | 14 |'), head);
    }
  });
  it('keeps a GM-added entry however it is written', () => {
    const out = filterSections(body('## Psionics'), [], pc, { pcKeepSections: ['**Psionics:**'] });
    assert.ok(out.includes('Prose here.'));
  });
  it('ignores non-text entries in the list', () => {
    const out = filterSections(body('## Background'), [], pc, { pcKeepSections: [null, 7, { a: 1 }] });
    assert.ok(!out.includes('Prose here.'));
  });
  it('withholds a keep-listed heading inside an excluded section', () => {
    const md = '## GM Notes\n### Background\nSecret.\n## Background\nPublic.\n';
    const out = filterSections(md, ['GM Notes'], pc, rules);
    assert.ok(!out.includes('Secret.'));
    assert.ok(out.includes('Public.'));
  });
  it('withholds a keep-listed heading nested under a withheld section', () => {
    const out = filterSections('## Skills\n### Background\nInside skills.\n', [], pc, rules);
    assert.ok(!out.includes('Inside skills.'));
  });
  it('does not apply when the type is missing', () => {
    assert.ok(filterSections(note, [], {}, rules).includes('| ST | 14 |'));
    assert.ok(filterSections(note, [], null, rules).includes('| ST | 14 |'));
    assert.ok(filterSections(note, [], { name: 'x' }, rules).includes('| ST | 14 |'));
  });
  it('an empty keep-list withholds every level-2 section', () => {
    const out = filterSections(note, [], pc, { pcKeepSections: [] });
    for (const gone of ['A sailor.', '**Location:** Brest', 'Player notes.', '| ST | 14 |']) assert.ok(!out.includes(gone), gone);
  });
  it('a keep-list that is not an array keeps nothing, it does not switch the rule off', () => {
    for (const bad of ['Background', 'true', 7, {}, true]) {
      const out = filterSections(note, [], pc, { pcKeepSections: bad });
      assert.ok(!out.includes('A sailor.'), String(bad));
      assert.ok(!out.includes('| ST | 14 |'), String(bad));
    }
  });
  it('null or undefined means no rule (sheets on)', () => {
    assert.ok(filterSections(note, [], pc, { pcKeepSections: null }).includes('| ST | 14 |'));
    assert.ok(filterSections(note, [], pc, { pcKeepSections: undefined }).includes('| ST | 14 |'));
  });
  it('withholds text before the first section but keeps the note title', () => {
    const md = '# Jean\nSTR 14 DEX 12\n| ST | 14 |\n\n### Loose\nmore stats\n\n## Background\nA sailor.\n';
    const out = filterSections(md, [], pc, rules);
    assert.ok(out.includes('# Jean'));
    assert.ok(!out.includes('STR 14'));
    assert.ok(!out.includes('| ST | 14 |'));
    assert.ok(!out.includes('more stats'));
    assert.ok(out.includes('A sailor.'));
  });
  it('a note with only preamble text publishes none of it', () => {
    const out = filterSections('# Jean\nJust prose, no sections.\n', [], pc, rules);
    assert.ok(!out.includes('Just prose'));
  });
  it('preamble is untouched when the rule is off', () => {
    assert.ok(filterSections('# Jean\nJust prose.\n', [], pc).includes('Just prose.'));
  });
  it('judges a later level-1 heading like a section', () => {
    const md = '# Jean\n## Background\nA sailor.\n# Stats\n| ST | 14 |\n';
    const out = filterSections(md, [], pc, rules);
    assert.ok(out.includes('A sailor.'));
    assert.ok(!out.includes('| ST | 14 |'));
  });
  it('works on CRLF', () => {
    const out = filterSections(note.replace(/\n/g, '\r\n'), ['GM Notes'], pc, rules);
    assert.ok(out.includes('A sailor.'));
    assert.ok(!out.includes('| ST | 14 |'));
  });
  it('leaves the document rule and the exclude list unchanged', () => {
    assert.deepStrictEqual(strippedSectionTitles('## Context\nx\n## Text\ny\n', [], { type: 'document' }, rules), ['Context']);
    assert.deepStrictEqual(sheetWithheldTitles('## Context\nx\n## Text\ny\n', [], { type: 'document' }, rules), []);
  });
});

describe('PC keep-list threading', () => {
  it('playerSafeMarkdown reads options.pcKeepSections', () => {
    const on = playerSafeMarkdown(note, { excludeSections: ['GM Notes'], frontmatter: pc, pcKeepSections: PC_PROSE_SECTIONS }).text;
    assert.ok(!on.includes('| ST | 14 |') && on.includes('A sailor.'));
    const off = playerSafeMarkdown(note, { excludeSections: ['GM Notes'], frontmatter: pc }).text;
    assert.ok(off.includes('| ST | 14 |'));
  });
  it('processContent reads options.pcKeepSections', () => {
    const page = { markdown: note, frontmatter: pc, outputPath: 'pcs/jean.html' };
    const on = processContent(page, {}, ['GM Notes'], {}, { pcKeepSections: PC_PROSE_SECTIONS }).html;
    assert.ok(!on.includes('Brawling') && on.includes('A sailor.'));
    assert.ok(processContent(page, {}, ['GM Notes'], {}, {}).html.includes('Brawling'));
  });
  it('pcKeepList is null unless sheets are explicitly off', () => {
    assert.strictEqual(pcKeepList({}), null);
    assert.strictEqual(pcKeepList({ switches: { characterSheets: true } }), null);
    assert.strictEqual(pcKeepList({ switches: {} }), null);
    assert.deepStrictEqual(pcKeepList({ switches: { characterSheets: false } }), PC_PROSE_SECTIONS);
  });
  it('pcKeepList appends the GM list, text entries only', () => {
    const list = pcKeepList({ switches: { characterSheets: false }, pc_prose_sections: ['Psionics', 3, null] });
    assert.deepStrictEqual(list, [...PC_PROSE_SECTIONS, 'Psionics']);
    assert.deepStrictEqual(pcKeepList({ switches: { characterSheets: false }, pc_prose_sections: 'Psionics' }), PC_PROSE_SECTIONS);
  });
});

describe('publish.pc_prose_sections in the config', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { resolveConfig } = require('../../lib/config');
  const load = (yaml) => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-pcp-'));
    fs.mkdirSync(path.join(vault, '_meta'));
    fs.writeFileSync(path.join(vault, '_meta', 'vault-config.md'), `---\npublish:\n  character_sheets: false\n${yaml}---\n`);
    try { return resolveConfig({ vaultPath: vault }, vault, () => {}).publishConfig; }
    finally { fs.rmSync(vault, { recursive: true, force: true }); }
  };
  it('a list is read; a non-list is ignored with a note, never "keep everything"', () => {
    const ok = load('  pc_prose_sections: [Psionics]\n');
    assert.deepStrictEqual(pcKeepList(ok), [...PC_PROSE_SECTIONS, 'Psionics']);
    assert.ok(!ok.switches.notes.some((n) => n.key === 'pc_prose_sections'));
    const bad = load('  pc_prose_sections: everything\n');
    assert.deepStrictEqual(pcKeepList(bad), PC_PROSE_SECTIONS);
    assert.ok(bad.switches.notes.some((n) => n.key === 'pc_prose_sections' && /not a list/.test(n.problem)));
    const mixed = load('  pc_prose_sections: [Psionics, 3]\n');
    assert.deepStrictEqual(pcKeepList(mixed), [...PC_PROSE_SECTIONS, 'Psionics']);
    assert.ok(mixed.switches.notes.some((n) => n.key === 'pc_prose_sections' && /not text/.test(n.problem)));
  });
});

describe('PC keep-list reads headings the way a renderer does', () => {
  const f = (md) => filterSections(md, ['Stat Sheet'], pc, rules);
  it('(a) a setext heading ends the kept section, either underline', () => {
    assert.strictEqual(f('## Background\nprose\n\nSkills\n------\nSTAT\n'), '## Background\nprose\n');
    assert.strictEqual(f('## Background\nprose\n\nSkills\n======\nSTAT\n'), '## Background\nprose\n');
    assert.deepStrictEqual(sheetWithheldTitles('## Background\nprose\n\nSkills\n------\nSTAT\n', [], pc, rules), ['Skills']);
  });
  it('a setext heading that is keep-listed is kept', () => {
    assert.strictEqual(f('## Skills\nSTAT\n\nNotes\n-----\nplayer text\n'), 'Notes\n-----\nplayer text\n');
  });
  it('a multi-line setext heading takes the whole paragraph as its title', () => {
    assert.strictEqual(f('## Background\nprose\n\nStat\nblock\n-----\nSTAT\n'), '## Background\nprose\n');
  });
  it('(b) an ATX heading indented 1-3 spaces is judged like an unindented one', () => {
    assert.strictEqual(f('## Background\nprose\n  ## Skills\nSTAT\n'), '## Background\nprose');
    assert.strictEqual(f('## Skills\nSTAT\n   ## Notes\nplayer text\n'), '   ## Notes\nplayer text\n');
  });
  it('four spaces of indent is code, not a heading', () => {
    assert.strictEqual(f('## Background\nprose\n\n    ## Skills\n'), '## Background\nprose\n\n    ## Skills\n');
  });
  it('(c) an HTML heading ends the kept section until the next level 1-2 heading', () => {
    assert.strictEqual(f('## Background\nprose\n<h2>Skills</h2>\nSTAT\n## Notes\nplayer text\n'), '## Background\nprose\n## Notes\nplayer text\n');
    assert.deepStrictEqual(sheetWithheldTitles('## Background\nprose\n<h2>Skills</h2>\nSTAT\n', [], pc, rules), ['Skills']);
    assert.deepStrictEqual(sheetWithheldTitles('## Background\nprose\n<H3 class="x">\nSTAT\n', [], pc, rules), ['(html heading)']);
  });
  it('(d) a heading inside a fence is not a heading', () => {
    assert.strictEqual(f('## Stat Sheet\n```\n## Background\n```\nSTAT\n## Notes\nok\n'), '## Notes\nok\n');
    assert.strictEqual(f('## Background\n```\n## Skills\n```\nprose\n'), '## Background\n```\n## Skills\n```\nprose\n');
  });
  it('an unclosed fence runs to the end of the note', () => {
    assert.strictEqual(f('## Stat Sheet\n```\n## Background\nSTAT\n## Notes\nSTAT2\n'), '');
  });
  it('~~~ fences work, and a closing fence must match the opener', () => {
    assert.strictEqual(f('## Stat Sheet\n~~~\n## Background\n~~~\nSTAT\n## Notes\nok\n'), '## Notes\nok\n');
    assert.strictEqual(f('## Stat Sheet\n~~~\n```\n## Background\nSTAT\n'), '');
    assert.strictEqual(f('## Stat Sheet\n````\n```\n## Background\nSTAT\n'), '');
  });
  it('a horizontal rule after a blank line does not end the section', () => {
    assert.strictEqual(f('## Background\nprose\n\n---\nmore prose\n'), '## Background\nprose\n\n---\nmore prose\n');
  });
  it('with no rule, the output is what the exclude-list walk gave at f848d8b5', () => {
    const cases = [
      ['## Background\nprose\n\nSkills\n------\nSTAT\n', '## Background\nprose\n\nSkills\n------\nSTAT\n'],
      ['## Background\nprose\n\nSkills\n======\nSTAT\n', '## Background\nprose\n\nSkills\n======\nSTAT\n'],
      ['## Background\nprose\n  ## Skills\nSTAT\n', '## Background\nprose\n  ## Skills\nSTAT\n'],
      ['## Background\nprose\n<h2>Skills</h2>\nSTAT\n', '## Background\nprose\n<h2>Skills</h2>\nSTAT\n'],
      ['## Stat Sheet\n```\n## Background\n```\nSTAT\n', '## Background\n```\nSTAT\n'],
    ];
    for (const [input, expected] of cases) {
      assert.strictEqual(filterSections(input, ['Stat Sheet'], pc), expected);
      assert.strictEqual(filterSections(input, ['Stat Sheet'], pc, {}), expected);
      assert.strictEqual(filterSections(input, ['Stat Sheet'], pc, { pcKeepSections: null }), expected);
    }
  });
});

describe('PC keep-list and the page title', () => {
  it('after the H1 strip, a later # is judged, not mistaken for the title', () => {
    const page = { markdown: '# Jean\n# Stats\n| ST | 14 |\n## Background\nok\n', frontmatter: pc, outputPath: 'pcs/jean.html' };
    const html = processContent(page, {}, [], {}, { pcKeepSections: PC_PROSE_SECTIONS }).html;
    assert.ok(!html.includes('Stats') && !html.includes('ST'), html);
    // The withheld `# Stats` runs to the next level-1 heading, `## Background` included.
    assert.ok(!html.includes('ok'));
  });
  it('without the strip, the first # is the title and a later # is judged', () => {
    const md = '# Jean\n# Stats\n| ST | 14 |\n# Background\nkept\n';
    assert.strictEqual(filterSections(md, [], pc, rules), '# Jean\n# Background\nkept\n');
  });
  it('level 1 is judged like level 2: # Background kept, # Stats withheld', () => {
    const md = '# Jean\n# Background\nkept\n# Stats\ngone\n';
    const out = filterSections(md, [], pc, rules);
    assert.ok(out.includes('kept') && !out.includes('gone') && !out.includes('# Stats'));
  });
});
