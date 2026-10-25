const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { planProps } = require('../../lib/props/plan');
const { takenAddresses } = require('../../lib/props/address');

// A temp vault of real files; `files` maps vault rel -> text (or Buffer).
function vault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'props-plan-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const page = (root, rel, frontmatter) => ({ rel, sourcePath: path.join(root, rel), frontmatter });

function plan(root, pages, { ships = () => true, taken = takenAddresses(), cutKeeper = true } = {}) {
  return planProps({ vaultPath: root, pages, relOf: (p) => p.rel, ships, taken, cutKeeper });
}

const outs = (p) => p.files.map((f) => f.out);
const INV = '<html><head><link rel="stylesheet" href="props.css"></head><body>Dear sir</body></html>';
const CSS = 'body{background:url("assets/paper.jpg")}';

test('a prop file beside the note plans the page, its stylesheet and the stylesheet\'s picture', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': INV, 'Props/props.css': CSS, 'Props/assets/paper.jpg': 'JPG' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/props.css', 'props/assets/paper.jpg']);
  assert.strictEqual(props[0].address, 'props/note.html');
  assert.strictEqual(props[0].source, fs.realpathSync(path.join(root, 'Props/inv.html')));
  assert.strictEqual(props[0].hash, crypto.createHash('sha1').update(INV).digest('hex'));
  assert.strictEqual(props[0].files[0].cut, true);
  assert.strictEqual(props[0].files[1].cut, false);
  assert.strictEqual(props[0].kind, 'document');
});

test('prop_address keeps a live address', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': INV, 'Props/props.css': CSS, 'Props/assets/paper.jpg': 'JPG' });
  const { props } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html', prop_address: 'gazetteer/papers/inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['gazetteer/papers/inv.html', 'gazetteer/papers/props.css', 'gazetteer/papers/assets/paper.jpg']);
});

test('a badly shaped prop_address falls back to the default with a problem', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': 'x' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html', prop_address: '/abs.html' })]);
  assert.strictEqual(props[0].address, 'props/note.html');
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [[
    'prop_address "/abs.html" is not a relative site path; it is published at props/note.html',
    'write a path such as props/note.html',
  ]]);
});

test('links outside the prop\'s folder are not copied', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': '<link rel="stylesheet" href="../shared.css">', 'shared.css': 'a{}' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html']);
  assert.strictEqual(problems.length, 1);
  assert.deepStrictEqual(problems[0], {
    rel: 'Props/Note.md', code: 'PROP_NOT_COPIED', severity: 'warning',
    detail: 'inv.html links "../shared.css", which is outside its folder',
    fix: 'put the file beside the prop file and link it by a relative path',
  });
});

test('a symlink to a file outside the vault is outside', () => {
  const outside = vault({ 'secret.html': 'SECRET', 'secret.png': 'PNG' });
  const root = vault({ 'Props/Note.md': '', 'Props/Other.md': '', 'Props/page.html': '<img src="pic.png">' });
  fs.symlinkSync(path.join(outside, 'secret.html'), path.join(root, 'Props/inv.html'));
  fs.symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'Props/pic.png'));
  const { props, problems } = plan(root, [
    page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' }),
    page(root, 'Props/Other.md', { type: 'prop', prop_file: 'page.html' }),
  ]);
  assert.strictEqual(props[0].address, null);
  assert.strictEqual(props[0].source, null);
  assert.strictEqual(props[0].hash, null);
  assert.deepStrictEqual(outs(props[1]), ['props/other.html']);
  assert.deepStrictEqual(problems.map((p) => p.detail), [
    'the prop file "inv.html" is outside the note\'s folder',
    'page.html links "pic.png", which is outside its folder',
  ]);
});

test('a prop_file climbing out of the note folder is outside', () => {
  const root = vault({ 'Props/Note.md': '', 'Other/x.html': 'x' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: '../Other/x.html' })]);
  assert.strictEqual(props[0].address, null);
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [[
    'the prop file "../Other/x.html" is outside the note\'s folder',
    "move the file into the note's folder (or a folder under it)",
  ]]);
});

test('a missing prop file and a wrong kind each raise one problem', () => {
  const root = vault({ 'Props/A.md': '', 'Props/B.md': '', 'Props/b.docx': 'x' });
  const { props, problems } = plan(root, [
    page(root, 'Props/A.md', { type: 'prop', prop_file: 'gone.html' }),
    page(root, 'Props/B.md', { type: 'prop', prop_file: 'b.docx' }),
  ]);
  assert.deepStrictEqual(props.map((p) => p.address), [null, null]);
  assert.deepStrictEqual(problems.map((p) => [p.rel, p.detail, p.fix]), [
    ['Props/A.md', 'the prop file "gone.html" is not in Props', 'put the file beside the note, or correct prop_file'],
    ['Props/B.md', 'the prop file "b.docx" is not a page, PDF or picture', 'use an .html, .pdf or picture file'],
  ]);
});

test('an NFD file name is found from an NFC prop_file', () => {
  const root = vault({ 'Props/Note.md': '', ['Props/' + 'Café.html'.normalize('NFD')]: 'x' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'Café.html'.normalize('NFC') })]);
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(props[0].address, 'props/note.html');
});

test('an NFD src is planned under its NFC name with a rewrite', () => {
  const nfd = 'café.png'.normalize('NFD');
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': `<img src="${nfd}">`, [`Props/${nfd}`]: 'PNG' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/' + 'café.png'.normalize('NFC')]);
  assert.deepStrictEqual(props[0].files[0].rewrite, [[nfd, 'café.png'.normalize('NFC')]]);
});

test('a case-only mismatch is not copied', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': '<img src="Assets/p.jpg">', 'Props/assets/p.jpg': 'JPG' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html']);
  assert.deepStrictEqual(problems.map((p) => p.detail), ['inv.html links "Assets/p.jpg", which differs in letter case from assets/p.jpg']);
});

test('missing, rooted and uncopied kinds of linked file are each reported', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': '<img src="gone.png"><img src="/x.png"><iframe src="other.html"></iframe>', 'Props/other.html': 'x' });
  const { problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems.map((p) => p.detail).sort(), [
    'inv.html links "/x.png", which starts with /, an address on the site',
    'inv.html links "gone.png", which is not there',
    'inv.html links "other.html", which is a kind of file a prop does not copy',
  ]);
});

test('a stylesheet\'s own bad link names the stylesheet', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': INV, 'Props/props.css': 'a{background:url(../up.png)}' });
  const { problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems.map((p) => p.detail), ['props.css links "../up.png", which is outside its folder']);
});

test('a file linked only inside a gm-only block is not planned', () => {
  const html = '<p>Hi</p><!-- gm-only --><img src="keeper.png"><!-- /gm-only --><!-- <img src="note.png"> -->';
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': html, 'Props/keeper.png': 'K', 'Props/note.png': 'N' });
  const pages = [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })];
  assert.deepStrictEqual(outs(plan(root, pages).props[0]), ['props/note.html']);
  // The GM site with gm_only_blocks on cuts nothing, so it copies both.
  const gm = plan(root, pages, { cutKeeper: false }).props[0];
  assert.deepStrictEqual(outs(gm), ['props/note.html', 'props/keeper.png', 'props/note.png']);
  assert.strictEqual(gm.files[0].cut, false);
});

test('claims: explicit beats default, then vault-path order', () => {
  const root = vault({ 'A/Letter.md': '', 'A/l.html': 'a', 'B/Letter.md': '', 'B/l.html': 'b', 'C/Note.md': '', 'C/l.html': 'c' });
  // B is later by path but explicit, so it takes props/letter.html from A's default.
  let r = plan(root, [
    page(root, 'A/Letter.md', { type: 'prop', prop_file: 'l.html' }),
    page(root, 'B/Letter.md', { type: 'prop', prop_file: 'l.html', prop_address: 'props/letter.html' }),
  ]);
  assert.deepStrictEqual(r.props.map((p) => p.address), [null, 'props/letter.html']);
  assert.deepStrictEqual(r.props[0].files, []);
  assert.deepStrictEqual(r.problems.map((p) => [p.rel, p.detail, p.fix]), [
    ['A/Letter.md', 'its address props/letter.html is taken by B/Letter.md', 'give it another prop_address'],
  ]);
  // Two equal defaults: the first by vault path wins, whatever order the pages came in.
  r = plan(root, [
    page(root, 'B/Letter.md', { type: 'prop', prop_file: 'l.html' }),
    page(root, 'A/Letter.md', { type: 'prop', prop_file: 'l.html' }),
  ]);
  assert.deepStrictEqual(r.props.map((p) => p.address), [null, 'props/letter.html']);
  assert.deepStrictEqual(r.problems.map((p) => p.detail), ['its address props/letter.html is taken by A/Letter.md']);
  // Two equal prop_address values, compared NFC and case-folded.
  r = plan(root, [
    page(root, 'C/Note.md', { type: 'prop', prop_file: 'l.html', prop_address: 'Papers/X.html' }),
    page(root, 'A/Letter.md', { type: 'prop', prop_file: 'l.html', prop_address: 'papers/x.html' }),
  ]);
  assert.deepStrictEqual(r.props.map((p) => p.address), [null, 'papers/x.html']);
  assert.deepStrictEqual(r.problems.map((p) => p.detail), ['its address Papers/X.html is taken by A/Letter.md']);
});

test('two notes whose names slug alike, untitled included, are settled by vault path', () => {
  const root = vault({ 'A/!!!.md': '', 'A/x.html': 'a', 'B/???.md': '', 'B/x.html': 'b' });
  const r = plan(root, [
    page(root, 'B/???.md', { type: 'prop', prop_file: 'x.html' }),
    page(root, 'A/!!!.md', { type: 'prop', prop_file: 'x.html' }),
  ]);
  assert.deepStrictEqual(r.props.map((p) => p.address), [null, 'props/untitled.html']);
  assert.deepStrictEqual(r.problems.map((p) => p.detail), ['its address props/untitled.html is taken by A/!!!.md']);
});

test('an address on a page is refused', () => {
  const root = vault({ 'Documents/Letter.md': '', 'Documents/l.html': 'x' });
  const taken = takenAddresses({ pageOutputs: ['documents/letter.html'] });
  const { props, problems } = plan(root, [page(root, 'Documents/Letter.md', { type: 'document', prop_file: 'l.html', prop_address: 'documents/letter.html' })], { taken });
  assert.strictEqual(props[0].address, null);
  assert.deepStrictEqual(props[0].files, []);
  assert.deepStrictEqual(problems.map((p) => p.detail), ['its address documents/letter.html is taken by a page the site builds']);
});

test('an explicit address inside a kept folder is planned and marked; a default one is refused', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': '<img src="p.png">', 'Props/p.png': 'P' });
  const taken = takenAddresses({ keptDirs: ['gazetteer', 'props'] });
  let r = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html', prop_address: 'gazetteer/inv.html' })], { taken });
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.props[0].address, 'gazetteer/inv.html');
  assert.strictEqual(r.props[0].replacesKept, true);
  assert.deepStrictEqual(outs(r.props[0]), ['gazetteer/inv.html', 'gazetteer/p.png']);
  assert.strictEqual(r.props[0].files[1].replacesKept, true);
  r = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html' })], { taken });
  assert.strictEqual(r.props[0].address, null);
  assert.strictEqual(r.props[0].replacesKept, undefined);
  assert.deepStrictEqual(r.problems.map((p) => p.detail), ['its address props/note.html is taken by the kept folder props']);
});

test('a linked file landing in a tool folder is refused', () => {
  const root = vault({ 'Props/Note.md': '', 'Props/inv.html': '<link rel="stylesheet" href="css/style.css">', 'Props/css/style.css': 'a{}' });
  const { props, problems } = plan(root, [page(root, 'Props/Note.md', { type: 'prop', prop_file: 'inv.html', prop_address: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['inv.html']);
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [[
    'inv.html links "css/style.css", which would land on css/style.css, taken by the site\'s css/ folder',
    'give it another prop_address',
  ]]);
});

test('two props sharing an identical props.css share one file', () => {
  const root = vault({ 'A/One.md': '', 'A/inv.html': INV, 'A/props.css': 'a{}', 'B/Two.md': '', 'B/inv.html': INV, 'B/props.css': 'a{}' });
  const { props, problems } = plan(root, [
    page(root, 'A/One.md', { type: 'prop', prop_file: 'inv.html' }),
    page(root, 'B/Two.md', { type: 'prop', prop_file: 'inv.html' }),
  ]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(props.flatMap(outs), ['props/one.html', 'props/props.css', 'props/two.html']);
});

test('different bytes at one output are refused for the second', () => {
  const root = vault({ 'A/One.md': '', 'A/inv.html': INV, 'A/props.css': 'a{}', 'B/Two.md': '', 'B/inv.html': INV, 'B/props.css': 'b{}' });
  const { props, problems } = plan(root, [
    page(root, 'A/One.md', { type: 'prop', prop_file: 'inv.html' }),
    page(root, 'B/Two.md', { type: 'prop', prop_file: 'inv.html' }),
  ]);
  assert.deepStrictEqual(outs(props[1]), ['props/two.html']);
  assert.deepStrictEqual(problems.map((p) => [p.rel, p.detail]), [
    ['B/Two.md', 'inv.html links "props.css", which would land on props/props.css, taken by A/One.md'],
  ]);
});

test('a prop that does not ship claims nothing and plans no files but has its hash', () => {
  const root = vault({ 'A/Letter.md': '', 'A/l.html': INV, 'A/props.css': 'a{}', 'B/Letter.md': '', 'B/l.html': 'b' });
  const held = page(root, 'A/Letter.md', { type: 'prop', prop_file: 'l.html' });
  const { props, problems } = plan(root, [held, page(root, 'B/Letter.md', { type: 'prop', prop_file: 'l.html' })], { ships: (p) => p !== held });
  assert.strictEqual(props[0].ships, false);
  assert.strictEqual(props[0].address, 'props/letter.html');
  assert.strictEqual(props[0].source, fs.realpathSync(path.join(root, 'A/l.html')));
  assert.strictEqual(props[0].hash, crypto.createHash('sha1').update(INV).digest('hex'));
  assert.deepStrictEqual(props[0].files, []);
  assert.deepStrictEqual(outs(props[1]), ['props/letter.html']);
  assert.deepStrictEqual(problems, []);
});

test('a prop that does not ship raises no problems', () => {
  const root = vault({ 'A/Letter.md': '' });
  const { problems } = plan(root, [page(root, 'A/Letter.md', { type: 'prop', prop_file: 'gone.html' })], { ships: () => false });
  assert.deepStrictEqual(problems, []);
});

test('a prop with no prop_file plans nothing and raises nothing', () => {
  const root = vault({ 'A/Letter.md': '' });
  const { props, problems } = plan(root, [page(root, 'A/Letter.md', { type: 'prop', prop_kind: 'object' })]);
  assert.strictEqual(props.length, 1);
  assert.strictEqual(props[0].kind, 'object');
  assert.strictEqual(props[0].address, null);
  assert.deepStrictEqual(props[0].files, []);
  assert.deepStrictEqual(problems, []);
});

test('a document note without prop_file is not in the plan', () => {
  const root = vault({ 'A/Letter.md': '', 'A/Ref.md': '' });
  const { props } = plan(root, [
    page(root, 'A/Letter.md', { type: 'document' }),
    page(root, 'A/Ref.md', { type: 'reference', prop: 'x.html', prop_look: 'form' }),
  ]);
  assert.deepStrictEqual(props, []);
});

test('a stub note\'s prop does not ship (ships is the caller\'s)', () => {
  const root = vault({ 'A/Letter.md': '', 'A/l.html': 'x' });
  const stub = page(root, 'A/Letter.md', { type: 'prop', prop_file: 'l.html', publish: 'stub' });
  const { props } = plan(root, [stub], { ships: (p) => p.frontmatter.publish !== 'stub' });
  assert.strictEqual(props[0].ships, false);
  assert.deepStrictEqual(props[0].files, []);
});

test('a PDF prop plans only itself', () => {
  const root = vault({ 'A/Map.md': '', 'A/map.pdf': '%PDF' });
  const { props } = plan(root, [page(root, 'A/Map.md', { type: 'handout', prop_file: 'map.pdf' })]);
  assert.deepStrictEqual(props[0].files, [{ source: fs.realpathSync(path.join(root, 'A/map.pdf')), out: 'props/map.pdf', cut: false }]);
});

test('a linked SVG is cut and its own links followed, each file once', () => {
  const root = vault({
    'A/Note.md': '', 'A/inv.html': '<img src="d.svg"><img src="i.png">',
    'A/d.svg': '<svg><image href="i.png"/><!-- gm-only --><image href="k.png"/><!-- /gm-only --></svg>',
    'A/i.png': 'I', 'A/k.png': 'K',
  });
  const { props } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(props[0].files.map((f) => [f.out, f.cut]), [['props/note.html', true], ['props/d.svg', true], ['props/i.png', false]]);
});

test('a symlinked folder pointing out of the vault is never entered', () => {
  const outside = vault({ 'pics/p.png': 'P' });
  const root = vault({ 'A/Note.md': '', 'A/inv.html': '<img src="ext/p.png">' });
  fs.symlinkSync(path.join(outside, 'pics'), path.join(root, 'A/ext'));
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html']);
  assert.deepStrictEqual(problems.map((p) => p.detail), ['inv.html links "ext/p.png", which is outside its folder']);
});

// Fix round 1.
const KIND_FIX = 'a prop page cannot carry this kind of file: a PDF can be published as its own prop (its own note with prop_file), a picture can take its place; otherwise leave it out (the site does not publish audio, video or other pages)';
test('audio, video and PDF links are not copied; a module script is', () => {
  const root = vault({
    'A/Note.md': '', 'A/inv.html': '<audio src="a.mp3"></audio><video src="v.mp4"></video><embed src="d.pdf"><script type="module" src="m.mjs"></script>',
    'A/a.mp3': 'A', 'A/v.mp4': 'V', 'A/d.pdf': 'D', 'A/m.mjs': 'M',
  });
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/m.mjs']);
  assert.deepStrictEqual(problems.map((p) => p.detail).sort(), [
    'inv.html links "a.mp3", which is a kind of file a prop does not copy',
    'inv.html links "d.pdf", which is a kind of file a prop does not copy',
    'inv.html links "v.mp4", which is a kind of file a prop does not copy',
  ]);
  for (const p of problems) assert.strictEqual(p.fix, KIND_FIX);
});

test('a picture name that is a symlink to a note is not copied', () => {
  const root = vault({ 'A/Note.md': '', 'A/inv.html': '<img src="pic.png">', 'A/Secret.md': 'SECRET' });
  fs.symlinkSync(path.join(root, 'A/Secret.md'), path.join(root, 'A/pic.png'));
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html']);
  assert.deepStrictEqual(problems.map((p) => [p.detail, p.fix]), [['inv.html links "pic.png", which is not really a .png file', 'link the real file, not a link to another kind of file']]);
});

test('a prop file name that is a symlink to a note is refused', () => {
  const root = vault({ 'A/Note.md': '', 'A/Secret.md': 'SECRET' });
  fs.symlinkSync(path.join(root, 'A/Secret.md'), path.join(root, 'A/inv.html'));
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.strictEqual(props[0].address, null);
  assert.strictEqual(props[0].hash, null);
  assert.deepStrictEqual(problems.map((p) => p.detail), ['the prop file "inv.html" is not a page, PDF or picture']);
});

test('one picture reached by two paths is planned at both', () => {
  const root = vault({ 'A/Note.md': '', 'A/inv.html': '<img src="a/x.png"><img src="b/x.png">', 'A/a/x.png': 'X' });
  fs.symlinkSync(path.join(root, 'A/a'), path.join(root, 'A/b'));
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/a/x.png', 'props/b/x.png']);
});

test('one stylesheet reached by two paths is planned once, with a problem for the other', () => {
  const root = vault({ 'A/Note.md': '', 'A/inv.html': '<link rel="stylesheet" href="a/s.css"><link rel="stylesheet" href="b/s.css">', 'A/a/s.css': 'a{background:url(b/s.css)}' });
  fs.symlinkSync(path.join(root, 'A/a'), path.join(root, 'A/b'));
  fs.symlinkSync(path.join(root, 'A/a'), path.join(root, 'A/a/b'));
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/a/s.css']);
  assert.deepStrictEqual(problems.map((p) => p.detail), [
    'inv.html links "b/s.css", which is the same file as props/a/s.css, reached by another path',
    'a/s.css links "b/s.css", which is the same file as props/a/s.css, reached by another path',
  ]);
});

test('a percent-encoded NFD link is rewritten to the encoded NFC spelling', () => {
  const nfd = 'café.png'.normalize('NFD');
  const root = vault({ 'A/Note.md': '', 'A/inv.html': '<img src="cafe%CC%81.png?v=1">', [`A/${nfd}`]: 'PNG' });
  const { props, problems } = plan(root, [page(root, 'A/Note.md', { type: 'prop', prop_file: 'inv.html' })]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/note.html', 'props/' + 'café.png'.normalize('NFC')]);
  assert.deepStrictEqual(props[0].files[0].rewrite, [['cafe%CC%81.png?v=1', 'caf%C3%A9.png?v=1']]);
});

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test('an unreadable prop file or linked file is a problem, not a crash', { skip: asRoot && 'root reads every file' }, () => {
  const root = vault({ 'A/One.md': '', 'A/one.html': 'x', 'B/Two.md': '', 'B/two.html': '<img src="p.png">', 'B/p.png': 'P' });
  fs.chmodSync(path.join(root, 'A/one.html'), 0o000);
  fs.chmodSync(path.join(root, 'B/p.png'), 0o000);
  try {
    const { props, problems } = plan(root, [
      page(root, 'A/One.md', { type: 'prop', prop_file: 'one.html' }),
      page(root, 'B/Two.md', { type: 'prop', prop_file: 'two.html' }),
    ]);
    assert.strictEqual(props[0].address, null);
    assert.deepStrictEqual(outs(props[1]), ['props/two.html']);
    assert.deepStrictEqual(problems.map((p) => [p.rel, p.detail, p.fix]), [
      ['A/One.md', 'the prop file "one.html" could not be read (EACCES)', 'make the file readable, or correct prop_file'],
      ['B/Two.md', 'two.html links "p.png", which could not be read (EACCES)', 'make the file readable'],
    ]);
  } finally {
    fs.chmodSync(path.join(root, 'A/one.html'), 0o644);
    fs.chmodSync(path.join(root, 'B/p.png'), 0o644);
  }
});

test('a file two props share byte for byte is planned once, and is listed as shared on the second', () => {
  const root = vault({
    'Documents/Alpha.md': '', 'Documents/a.html': '<link rel="stylesheet" href="style.css">', 'Documents/style.css': 'a{}',
    'Letters/Beta.md': '', 'Letters/b.html': '<link rel="stylesheet" href="style.css">', 'Letters/style.css': 'a{}',
  });
  const { props, problems } = plan(root, [
    page(root, 'Documents/Alpha.md', { type: 'prop', prop_file: 'a.html' }),
    page(root, 'Letters/Beta.md', { type: 'prop', prop_file: 'b.html' }),
  ]);
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/alpha.html', 'props/style.css']);
  assert.deepStrictEqual(outs(props[1]), ['props/beta.html']);
  assert.deepStrictEqual(props[0].shared, []);
  assert.deepStrictEqual(props[1].shared, ['props/style.css']);
});

test('what a shared stylesheet reaches is shared too; a nested file with other bytes is a conflict', () => {
  const files = (more) => ({
    'Documents/Alpha.md': '', 'Documents/a.html': '<link rel="stylesheet" href="props.css">', 'Documents/props.css': '@import "more.css";', 'Documents/more.css': 'a{}',
    'Letters/Beta.md': '', 'Letters/b.html': '<link rel="stylesheet" href="props.css">', 'Letters/props.css': '@import "more.css";', 'Letters/more.css': more,
  });
  const pages = (root) => [
    page(root, 'Documents/Alpha.md', { type: 'prop', prop_file: 'a.html' }),
    page(root, 'Letters/Beta.md', { type: 'prop', prop_file: 'b.html' }),
  ];
  const same = vault(files('a{}'));
  const { props, problems } = plan(same, pages(same));
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(outs(props[0]), ['props/alpha.html', 'props/props.css', 'props/more.css']);
  assert.deepStrictEqual(outs(props[1]), ['props/beta.html']);
  assert.deepStrictEqual(props[1].shared, ['props/props.css', 'props/more.css']);
  const other = vault(files('b{}'));
  const differs = plan(other, pages(other));
  assert.deepStrictEqual(differs.problems.map((p) => [p.rel, p.detail]), [
    ['Letters/Beta.md', 'props.css links "more.css", which would land on props/more.css, taken by Documents/Alpha.md'],
  ]);
  assert.deepStrictEqual(differs.props[1].shared, ['props/props.css']);
});

test('a file\'s text goes back to the same bytes: UTF-8 with its byte-order mark, or latin1 when not UTF-8', () => {
  const { textOf, bytesOfText } = require('../../lib/props/plan');
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Café “hush”')]);
  const u = textOf(bom);
  assert.strictEqual(u.encoding, 'utf8');
  assert.ok(bytesOfText(u.text, u.encoding).equals(bom));
  const cp1252 = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x68, 0x94]);
  const l = textOf(cp1252);
  assert.strictEqual(l.encoding, 'latin1');
  assert.ok(bytesOfText(l.text, l.encoding).equals(cp1252));
  assert.strictEqual(bytesOfText('a–b', 'latin1', '.html').toString('latin1'), 'a&#x2013;b');
  assert.strictEqual(bytesOfText('a–b', 'latin1', '.css').toString('latin1'), 'a\\2013 b');
});
