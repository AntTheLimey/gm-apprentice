const { test } = require('node:test');
const assert = require('node:assert');
const { runSheetShow } = require('../lib/sheet-cli');

// The player-safe view is a data boundary, not a promise to look away: it must
// strip exactly what the build strips, so a skill can read it instead of being
// told "don't look at GM Notes". These fixtures carry one of every kind of
// GM-only content the build knows how to remove.

const JANE_BODY = [
  '# Jane Ashford',
  '',
  'A dilettante with a revolver.',
  '',
  '## Current Status',
  '',
  'HP 11/11 — shaken but upright.',
  '',
  '## Equipment',
  '',
  '- Webley revolver',
  '',
  '> [!warning] Keeper only',
  '> She flinches at church bells.',
  '',
  '<!-- import note: transcribed from the 2019 sheet -->',
  '',
  '<!-- gm-only -->',
  'GMSECRET she is on the cult payroll.',
  '<!-- /gm-only -->',
  '',
  '<!-- spoiler -->',
  'SPOILERTEXT she dies in act three.',
  '<!-- /spoiler -->',
  '',
  '## GM Notes',
  '',
  'GMNOTESBODY twist ahead.',
  '',
].join('\n');

const JANE_FM = {
  type: 'pc',
  name: 'Jane Ashford',
  occupation: 'Dilettante',
  secrets: 'SECRETFIELD works for the cult',
  relationships: [
    { target: 'Bob Smith', type: 'ally' },
    { target: 'Cult Leader', type: 'serves', gm_only: true },
  ],
};

const JANE_RAW = [
  '---',
  'type: pc',
  'name: Jane Ashford',
  'occupation: Dilettante',
  'secrets: SECRETFIELD works for the cult',
  'relationships:',
  '  - target: Bob Smith',
  '    type: ally',
  '  - target: Cult Leader',
  '    type: serves',
  '    gm_only: true',
  '---',
  '',
  JANE_BODY,
].join('\n');

const BOB_BODY = ['# Bob Smith', '', '## Current Status', '', 'Fine.', ''].join('\n');

function pages() {
  return [
    {
      sourcePath: '/vault/Characters/PCs/Jane_Ashford.md',
      title: 'Jane_Ashford',
      displayTitle: 'Jane Ashford',
      frontmatter: JSON.parse(JSON.stringify(JANE_FM)),
      markdown: JANE_BODY,
    },
    {
      sourcePath: '/vault/Characters/PCs/Bob_Smith.md',
      title: 'Bob_Smith',
      displayTitle: 'Bob Smith',
      frontmatter: { type: 'pc', name: 'Bob Smith', publish: 'none' },
      markdown: BOB_BODY,
    },
    {
      sourcePath: '/vault/Characters/NPCs/Gatekeeper.md',
      title: 'Gatekeeper',
      displayTitle: 'Gatekeeper',
      frontmatter: { type: 'npc', name: 'Gatekeeper' },
      markdown: '# Gatekeeper\n',
    },
  ];
}

const CONFIG = { vaultPath: '/vault', siteTitle: 'Test Campaign', excludeDirs: [], folderMap: {} };

const PUBLISH_CONFIG = {
  exclude_fields: ['secrets'],
  exclude_sections: ['GM Notes'],
  exclude_callouts: true,
};

function run(over = {}) {
  const out = [];
  const err = [];
  const deps = Object.assign({
    config: CONFIG,
    publishConfig: PUBLISH_CONFIG,
    scan: pages,
    readFile: (p) => (p === '/vault/Characters/PCs/Jane_Ashford.md' ? JANE_RAW : '---\ntype: pc\n---\n'),
    out: (m) => out.push(String(m)),
    err: (m) => err.push(String(m)),
  }, over);
  return { promise: runSheetShow(deps), out, err };
}

test('default view prints the raw source file, GM content and all', async () => {
  const r = run({ pc: 'Jane Ashford' });
  const code = await r.promise;
  assert.equal(code, 0);
  const text = r.out.join('\n');
  for (const needle of [
    '## GM Notes', 'GMNOTESBODY', '<!-- gm-only -->', 'GMSECRET',
    '<!-- spoiler -->', 'SPOILERTEXT', 'import note', '[!warning]',
    'SECRETFIELD', 'gm_only: true',
  ]) {
    assert.ok(text.includes(needle), `default view should contain ${needle}`);
  }
});

test('--player-safe strips every kind of GM content the build strips', async () => {
  const r = run({ pc: 'Jane Ashford', playerSafe: true });
  const code = await r.promise;
  assert.equal(code, 0);
  const text = r.out.join('\n');
  for (const needle of [
    'GM Notes', 'GMNOTESBODY', 'gm-only', 'GMSECRET', 'spoiler', 'SPOILERTEXT',
    'import note', '[!warning]', 'church bells', 'SECRETFIELD', 'secrets',
    'gm_only', 'Cult Leader',
  ]) {
    assert.ok(!text.includes(needle), `player-safe view must not contain ${needle}\n---\n${text}`);
  }
});

test('--player-safe keeps the player-facing sections, the H1 and the safe frontmatter', async () => {
  const r = run({ pc: 'Jane Ashford', playerSafe: true });
  await r.promise;
  const text = r.out.join('\n');
  for (const needle of [
    '# Jane Ashford', '## Current Status', 'HP 11/11', '## Equipment',
    'Webley revolver', 'type: pc', 'occupation: Dilettante', 'Bob Smith',
  ]) {
    assert.ok(text.includes(needle), `player-safe view should contain ${needle}\n---\n${text}`);
  }
  // Frontmatter is fenced, so the output round-trips as a markdown file.
  assert.match(text, /^---\n/);
});

test('--player-safe reports a publish: none PC instead of printing it', async () => {
  const r = run({ pc: 'Bob Smith', playerSafe: true });
  const code = await r.promise;
  assert.equal(code, 0);
  const text = r.out.join('\n');
  assert.ok(text.includes('(Bob Smith is not published — publish: none)'), text);
  assert.ok(!text.includes('## Current Status'), text);
});

test('--player-safe honours publish: stub by keeping only the named sections', async () => {
  const stubbed = () => {
    const p = pages();
    p[0].frontmatter.publish = 'stub';
    p[0].frontmatter.publish_include_sections = ['Current Status'];
    return p;
  };
  const r = run({ pc: 'Jane Ashford', playerSafe: true, scan: stubbed });
  const code = await r.promise;
  assert.equal(code, 0);
  const text = r.out.join('\n');
  assert.ok(text.includes('## Current Status'), text);
  assert.ok(!text.includes('## Equipment'), text);
});

test('an unknown PC exits 1 and lists the PCs that exist', async () => {
  const r = run({ pc: 'Nobody' });
  const code = await r.promise;
  assert.equal(code, 1);
  const text = r.err.join('\n');
  assert.ok(text.includes('No PC named "Nobody"'), text);
  assert.ok(text.includes('Jane Ashford'), text);
  assert.ok(text.includes('Bob Smith'), text);
  assert.ok(!text.includes('Gatekeeper'), 'NPCs are not PCs');
  assert.equal(r.out.length, 0);
});

test('a PC matches on file name, display title or frontmatter name', async () => {
  for (const name of ['Jane_Ashford', 'jane ashford', 'Jane Ashford']) {
    const r = run({ pc: name });
    assert.equal(await r.promise, 0, `${name} should resolve`);
  }
});

test('--json emits the documented shape for the GM view', async () => {
  const r = run({ pc: 'Jane Ashford', json: true });
  const code = await r.promise;
  assert.equal(code, 0);
  const doc = JSON.parse(r.out.join('\n'));
  assert.equal(doc.pc, 'Jane Ashford');
  assert.equal(doc.sourcePath, '/vault/Characters/PCs/Jane_Ashford.md');
  assert.equal(doc.playerSafe, false);
  assert.equal(doc.frontmatter.secrets, 'SECRETFIELD works for the cult');
  assert.ok(doc.markdown.includes('GMSECRET'));
});

test('--json --player-safe carries the stripped body and published frontmatter', async () => {
  const r = run({ pc: 'Jane Ashford', json: true, playerSafe: true });
  await r.promise;
  const doc = JSON.parse(r.out.join('\n'));
  assert.equal(doc.playerSafe, true);
  assert.equal(doc.frontmatter.secrets, undefined);
  assert.equal(doc.frontmatter.relationships.length, 1);
  assert.ok(!doc.markdown.includes('GMSECRET'));
  assert.ok(doc.markdown.includes('## Equipment'));
});

test('stripping warnings go to stderr, never into the printed sheet', async () => {
  const unbalanced = () => {
    const p = pages();
    p[0].markdown = '# Jane\n\n<!-- gm-only -->\nGMSECRET dangling.\n';
    return p;
  };
  const r = run({ pc: 'Jane Ashford', playerSafe: true, scan: unbalanced });
  const code = await r.promise;
  assert.equal(code, 0);
  assert.ok(!r.out.join('\n').includes('GMSECRET'));
  assert.ok(r.err.length > 0, 'the unclosed gm-only block should warn on stderr');
});
