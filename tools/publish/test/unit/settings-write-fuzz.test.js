'use strict';
// A seeded property test of the settings writer, on both layouts. Files are generated in many shapes
// (block and flow lists and maps, comments, blank lines, quoted keys, block scalars, empty groups, one-line
// groups, CRLF, no final newline, an old file's body holding --- lines), then random valid steps are done.
// After every step: the file reads, readSettings shows exactly the intended change, the lines nobody
// meant to touch are still there in order, the old body is byte-identical, no temp file is left, and no
// valid step is refused. The seed is fixed so CI is deterministic; a failure prints the file and the step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyChanges } = require('../../lib/settings/write');
const { readSettings, entry, legacyNameOf, stops } = require('../../lib/settings');
const { NEW_FILE, OLD_FILE, at } = require('../../lib/settings/layout');

const ITERATIONS = 100; // per layout; FUZZ_SEED tries another run, and a fixed seed keeps CI deterministic
const SEED = Number(process.env.FUZZ_SEED) || 20261013; // FUZZ_SEED tries another

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The settings the generator uses, by kind.
const POOL = [
  { name: 'player_site.title', kind: 'text' },
  { name: 'player_site.footer', kind: 'text' },
  { name: 'player_site.theme.tagline', kind: 'text' },
  { name: 'player_site.theme.palette.primary', kind: 'text' },
  { name: 'vault.setting_year', kind: 'text' },
  { name: 'player_site.features.search', kind: 'switch' },
  { name: 'player_site.hide.sections', kind: 'list' },
  { name: 'player_site.hide.fields', kind: 'list' },
  { name: 'player_site.landing.featured_npcs', kind: 'list' },
  { name: 'player_site.landing.quick_links', kind: 'list' },
];
const GROUPS = ['player_site.hide', 'player_site.features', 'player_site.theme', 'player_site.theme.palette', 'player_site.landing'];
const pathOf = (name, legacy) => (legacy ? legacyNameOf(entry(name)) : name).split('.');
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'north gate', 'The Keeper', 'Rumours', 'gm notes', 'c: d', 'it\'s', 'a "b"', '#hash', 'x y z'];

function generate(r, legacy) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const chance = (p) => r() < p;
  let uid = 0;
  const unique = (s) => `${s} u${uid++}`;
  const indent = pick([2, 4]);
  const flush = chance(0.3); // list dashes at the key's column
  const lines = []; // { t, owner }
  const eolComment = () => (chance(0.3) ? `${pick([' ', '  ', '   '])}# c${uid++}` : '');
  let inside = 'root';
  const maybeBlank = () => { if (chance(0.2)) lines.push({ t: '', owner: 'free', inside }); };
  const maybeAbove = (pad) => { if (chance(0.25)) lines.push({ t: `${pad}# above${uid++}`, owner: 'free', inside }); };
  const keyText = (k) => pick([k, k, k, `"${k}"`, `'${k}'`]);
  const q = (s) => JSON.stringify(s);

  // Which pool settings are in the file.
  const chosen = POOL.filter(() => chance(0.55));
  const tree = {}; // nested groups of paths
  for (const s of chosen) {
    const p = pathOf(s.name, legacy);
    let cur = tree;
    for (const seg of p.slice(0, -1)) cur = cur[seg] = cur[seg] || {};
    cur[p[p.length - 1]] = s;
  }
  const isLeaf = (n) => n && n.name !== undefined && n.kind !== undefined;

  const scalarText = (s) => {
    const word = unique(pick(WORDS).replace(/[#:'"]/g, '')).replace(/ +/g, ' ');
    return pick([word, q(unique(pick(WORDS))), `'${unique(pick(WORDS)).replace(/'/g, "''")}'`]);
  };
  const flowLeaf = (leaf) => {
    if (leaf.kind === 'switch') return pick(['true', 'false']);
    if (leaf.kind === 'list') return `[${Array.from({ length: Math.floor(r() * 3) }, () => q(unique(pick(WORDS)))).join(', ')}]`;
    return q(unique(pick(WORDS)));
  };
  const flowGroup = (node) => `{${Object.entries(node).map(([k, v]) => `${keyText(k)}: ${isLeaf(v) ? flowLeaf(v) : flowGroup(v)}`).join(', ')}}`;
  const flowable = (node) => Object.values(node).every((v) => isLeaf(v) || flowable(v));

  function emitLeaf(key, leaf, col, ownerOf) {
    const pad = ' '.repeat(col);
    const own = leaf.name;
    maybeAbove(pad);
    const k = keyText(key);
    if (leaf.kind === 'switch') {
      lines.push({ t: `${pad}${k}: ${pick(['true', 'false', '"on"', 'no'])}${eolComment()}`, owner: own });
    } else if (leaf.kind === 'text') {
      const style = pick(['inline', 'inline', 'inline', 'literal', 'literal-strip', 'folded', 'literal-keep']);
      if (style === 'inline') {
        lines.push({ t: `${pad}${k}: ${scalarText()}${eolComment()}`, owner: own });
      } else {
        const head = { literal: '|', 'literal-strip': '|-', folded: '>' }[style];
        lines.push({ t: `${pad}${k}: ${head}`, owner: own });
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) lines.push({ t: `${' '.repeat(col + indent)}${unique('body line')}`, owner: own });
        // A keep-chomped block holds its trailing blank lines as content.
        if (style === 'literal-keep') for (let i = 0; i < 1 + Math.floor(r() * 2); i++) lines.push({ t: '', owner: own });
      }
    } else {
      const style = pick(['block', 'block', 'flow', 'empty', 'null']);
      if (style === 'flow') {
        lines.push({ t: `${pad}${k}: [${Array.from({ length: 1 + Math.floor(r() * 3) }, () => scalarText()).join(', ')}]${eolComment()}`, owner: own });
      } else if (style === 'empty') {
        lines.push({ t: `${pad}${k}: []${eolComment()}`, owner: own });
      } else if (style === 'null') {
        lines.push({ t: `${pad}${k}:${eolComment()}`, owner: own });
      } else {
        lines.push({ t: `${pad}${k}:${eolComment()}`, owner: own });
        const dash = ' '.repeat(flush ? col : col + indent);
        for (let i = 0; i < 1 + Math.floor(r() * 3); i++) lines.push({ t: `${dash}- ${scalarText()}${eolComment()}`, owner: own });
      }
    }
  }
  function emitGroup(key, node, col, groupPath) {
    const pad = ' '.repeat(col);
    const owner = `group:${groupPath}`;
    maybeAbove(pad);
    if (flowable(node) && Object.keys(node).length && chance(0.3)) {
      lines.push({ t: `${pad}${keyText(key)}: ${flowGroup(node)}${eolComment()}`, owner });
      return;
    }
    lines.push({ t: `${pad}${keyText(key)}:${eolComment()}`, owner });
    const outer = inside;
    inside = groupPath;
    for (const [k, v] of Object.entries(node)) {
      maybeBlank();
      if (isLeaf(v)) emitLeaf(k, v, col + indent);
      else emitGroup(k, v, col + indent, `${groupPath}.${k}`);
    }
    // Decoys: known groups with nothing in them, written empty or bare, beside the settings.
    if (col === 0 && (legacy ? groupPath === 'publish' : groupPath === 'player_site')) {
      for (const d of (legacy ? ['theme', 'landing'] : ['features', 'theme', 'landing', 'hide'])) {
        if (!(d in node) && chance(0.25)) lines.push({ t: `${' '.repeat(col + indent)}${d}:${pick([' {}', ''])}`, owner: `group:${groupPath}.${d}` });
      }
    }
    inside = outer;
  }

  const emitTop = (key, node, groupPath) => emitGroup(key, node, 0, groupPath);
  if (legacy) {
    lines.push({ t: 'type: meta', owner: 'top' });
    if (chance(0.5)) lines.push({ t: `gm_apprentice_version: "1.10.${uid++}"   # kept`, owner: 'top' });
    if (chance(0.3)) { maybeBlank(); lines.push({ t: `chapter_naming: "Chapter ${uid++}"`, owner: 'top' }); }
    for (const [k, v] of Object.entries(tree)) {
      maybeBlank();
      if (isLeaf(v)) emitLeaf(k, v, 0);
      else emitTop(k, v, k);
    }
  } else {
    lines.push({ t: 'version: 1', owner: 'top' });
    for (const [k, v] of Object.entries(tree)) {
      maybeBlank();
      emitTop(k, v, k);
    }
  }
  if (chance(0.3)) lines.push({ t: `# the end ${uid++}`, owner: 'tail' });
  return { lines, chosen };
}

function renderFile(g, r, legacy) {
  const crlf = r() < 0.3;
  const eol = crlf ? '\r\n' : '\n';
  const core = g.lines.map((l) => l.t);
  const final = r() < 0.7;
  if (legacy) {
    const body = ['', '# Notes', 'Some prose.', '---', 'more prose', '---', 'end'];
    return { text: `---${eol}${core.join(eol)}${eol}---${eol}${body.join(eol)}${final ? eol : ''}`, eol, crlf };
  }
  return { text: core.join(eol) + (final ? eol : ''), eol, crlf };
}

// A step to try, with the data it should leave behind.
function makeStep(r, read) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const s = pick(POOL);
  const e = entry(s.name);
  const cur = s.name.split('.').reduce((o, k) => (o ? o[k] : undefined), read.values);
  const words = () => Array.from({ length: Math.floor(r() * 4) }, (_, i) => `${pick(['rat', 'owl', 'elk', 'Fox Den', 'a: b', '#x'])} ${Math.floor(r() * 1000)}${i}`);
  const dflt = e.default === undefined ? null : JSON.parse(JSON.stringify(e.default));
  const op = s.kind === 'list' ? pick(['set', 'unset', 'add', 'remove', 'add']) : pick(['set', 'unset', 'set']);
  if (op === 'set') {
    let value;
    if (s.kind === 'switch') value = r() < 0.5;
    else if (s.kind === 'list') value = words();
    else value = pick([`Plain ${Math.floor(r() * 99)}`, `He said "hi" ${Math.floor(r() * 9)}`, `two\nlines ${Math.floor(r() * 9)}`, `# not a comment ${Math.floor(r() * 9)}`, `colon: here ${Math.floor(r() * 9)}`, 'yes please', `${1900 + Math.floor(r() * 99)}`]);
    return { change: { op, name: s.name, value }, name: s.name, expect: value };
  }
  if (op === 'unset') return { change: { op, name: s.name }, name: s.name, expect: dflt };
  if (op === 'add') {
    const entries = words().concat(`new ${Math.floor(r() * 1000)}`);
    const next = [...(cur || [])];
    for (const x of entries) if (!next.includes(x)) next.push(x);
    return { change: { op, name: s.name, entries }, name: s.name, expect: next };
  }
  const have = cur || [];
  const entries = [...have.filter(() => r() < 0.5), 'not there'];
  return { change: { op, name: s.name, entries }, name: s.name, expect: have.filter((x) => !entries.includes(x)) };
}

const setIn = (obj, dotted, value) => {
  const segs = dotted.split('.');
  let cur = obj;
  for (const s of segs.slice(0, -1)) cur = cur[s] = cur[s] || {};
  cur[segs[segs.length - 1]] = value;
};

// `want` as a subsequence of `have`.
function inOrder(want, have) {
  return firstMissing(want, have) === null;
}
// The first line of `want` that `have` does not carry on, in order; null when all are there.
function firstMissing(want, have) {
  let i = 0;
  for (const l of have) if (i < want.length && l === want[i]) i++;
  return i === want.length ? null : want[i];
}

function run(legacy) {
  const r = rng(SEED + (legacy ? 1 : 0));
  let steps = 0;
  for (let it = 0; it < ITERATIONS; it++) {
    const g = generate(r, legacy);
    const file = renderFile(g, r, legacy);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfuzz-'));
    const rel = legacy ? OLD_FILE : NEW_FILE;
    fs.mkdirSync(path.dirname(at(dir, rel)), { recursive: true });
    fs.writeFileSync(at(dir, rel), file.text);
    try {
      let text = file.text;
      let lines = g.lines.map((l) => ({ ...l }));
      // The text of each group's key line as generated (the first line of that group).
      const groupLine = new Map();
      for (const l of lines) if (l.owner.startsWith('group:') && !groupLine.has(l.owner)) groupLine.set(l.owner, l.t);
      for (let n = 0, count = 1 + Math.floor(r() * 4); n < count; n++) {
        const before = readSettings({ vaultPath: dir, siteConfig: {} });
        assert.deepEqual(stops(before.faults), [], 'the generated file has a stop fault');
        const step = makeStep(r, before);
        const label = `iteration ${it} step ${n} ${JSON.stringify(step.change)}`;
        let out;
        try {
          out = applyChanges(dir, [step.change]);
        } catch (e) {
          assert.fail(`${label}: a valid step was refused: ${e.message}\n--- file ---\n${text}`);
        }
        steps++;
        const after = fs.readFileSync(at(dir, rel), 'utf8');
        const read = readSettings({ vaultPath: dir, siteConfig: {} });
        assert.deepEqual(stops(read.faults), [], `${label}: a stop fault after\n${after}`);
        const want = JSON.parse(JSON.stringify(before.values));
        setIn(want, step.name, step.expect);
        assert.deepEqual(read.values, want, `${label}: values\n--- before ---\n${text}\n--- after ---\n${after}`);
        // No eol mixing; the old body is as it was.
        if (file.crlf) assert.ok(!after.replace(/\r\n/g, '').includes('\n'), `${label}: a bare line feed`);
        if (legacy) {
          const fence = `${file.eol}---${file.eol}`;
          assert.equal(after.slice(after.indexOf(fence, 3)), text.slice(text.indexOf(fence, 3)), `${label}: the body changed`);
        }
        // Lines nobody meant to touch are still there, in order.
        const segs = pathOf(step.name, legacy);
        const mine = new Set([step.name, ...segs.slice(0, -1).map((_, i) => `group:${segs.slice(0, i + 1).join('.')}`)]);
        const afterLines = after.split(/\r?\n/);
        // Comments and blank lines inside a group that went with its last setting went with it.
        const goneGroups = new Set([...mine].filter((o) => o.startsWith('group:') && groupLine.has(o) && !afterLines.includes(groupLine.get(o))).map((o) => o.slice(6)));
        const exempt = (l) => mine.has(l.owner) || (l.owner === 'free' && goneGroups.has(l.inside));
        assert.ok(inOrder(lines.filter((l) => !exempt(l)).map((l) => l.t), afterLines), `${label}: an untouched line was lost or moved: ${JSON.stringify(firstMissing(lines.filter((l) => !exempt(l)).map((l) => l.t), afterLines))}\n--- before ---\n${text}\n--- after ---\n${after}`);
        // What this step may have rewritten is not checked again by the later steps.
        lines = lines.filter((l) => !exempt(l));
        text = after;
        assert.ok(out && Array.isArray(out.changed));
        // No temp file is left behind.
        const left = fs.readdirSync(path.join(dir, '_meta'));
        assert.deepEqual(left, [path.basename(rel)], `${label}: files left behind: ${left.join(', ')}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return steps;
}

test('seeded property test: the new file', () => {
  const steps = run(false);
  assert.ok(steps > 50, `ran ${steps} steps`);
});

test('seeded property test: the old file', () => {
  const steps = run(true);
  assert.ok(steps > 50, `ran ${steps} steps`);
});

test('the generator makes a spread of shapes', () => {
  const r = rng(7);
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const t = renderFile(generate(r, false), r, false).text;
    for (const [name, re] of [['block scalar', /: [|>]-?$/m], ['flow list', /: \[/], ['flow group', /: \{"?\w/], ['quoted key', /^\s*["']\w+["']:/m], ['crlf', /\r\n/], ['comment', /# c\d+/], ['bare group', /^\s*\w+:\s*$/m]]) {
      if (re.test(t)) seen.add(name);
    }
  }
  assert.equal(seen.size, 7, [...seen].join(', '));
});

