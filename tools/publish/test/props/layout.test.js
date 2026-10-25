const { test } = require('node:test');
const assert = require('node:assert');
const { TOOL_NAMES, TOOL_HTML, FILTERS, checkLayout, layoutNames, layoutView, fillLayout } = require('../../lib/props/layout');

test('a field is text, never markup', () => {
  const html = fillLayout('<p>{{prop_stamp}}</p>', layoutView({ prop_stamp: '<img src=x onerror=alert(1)>' }, ['prop_stamp'], {}));
  assert.ok(html.includes('&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;'), html);
  assert.ok(!html.includes('<img'), html);
  const attr = fillLayout('<p title="{{prop_device}}">', layoutView({ prop_device: 'a" onmouseover="x' }, ['prop_device'], {}));
  assert.ok(attr.includes('title="a&quot; onmouseover&#x3D;&quot;x"'), attr);
});

test('a wikilink field prints its name', () => {
  const view = layoutView({ prop_device: '[[Corvid Financial|the bank]]' }, ['prop_device'], {});
  assert.strictEqual(fillLayout('{{prop_device}}', view), 'the bank');
});

test('a list or map field is empty', () => {
  const view = layoutView({ prop_list: ['a', 'b'], prop_map: { a: 1 } }, ['prop_list', 'prop_map'], {});
  assert.strictEqual(view.prop_list, '');
  assert.strictEqual(view.prop_map, '');
  assert.strictEqual(fillLayout('[{{prop_list}}][{{#prop_map}}x{{/prop_map}}]', view), '[][]');
});

test('the view holds only strings and booleans', () => {
  const fields = {
    prop_a: 'text', prop_b: 3, prop_c: true, prop_d: new Date('2026-10-25T00:00:00Z'),
    prop_e: ['x'], prop_f: { y: 1 }, prop_g: () => 'run', prop_h: null, prop_accent: '#123',
  };
  const tool = { title: 'T', body: '<p>b</p>', sheet_number: 2, sheet_count: 3, first: true, last: false, items: ['no'] };
  const names = [...Object.keys(fields), 'prop_accent|color', 'prop_missing', ...TOOL_NAMES];
  const view = layoutView(fields, names, tool);
  for (const [key, value] of Object.entries(view)) {
    assert.ok(['string', 'boolean'].includes(typeof value), `${key} is ${typeof value}`);
  }
  assert.strictEqual(view.prop_b, '3');
  assert.strictEqual(view.prop_c, 'true');
  assert.strictEqual(view.prop_d, '2026-10-25');
  assert.strictEqual(view.prop_g, '');
  assert.strictEqual(view['prop_accent|color'], '#123');
  assert.strictEqual(view.sheet_number, '2');
  assert.strictEqual(view.first, true);
  assert.strictEqual(view.last, false);
  assert.strictEqual(view.items, '');
});

test('filters keep only safe values', () => {
  assert.strictEqual(FILTERS.color('#43345e'), '#43345e');
  assert.strictEqual(FILTERS.color('rebeccapurple'), 'rebeccapurple');
  assert.strictEqual(FILTERS.color('red;background:url(javascript:x)'), '');
  assert.strictEqual(FILTERS.class('Chart'), 'chart');
  assert.strictEqual(FILTERS.class('a b'), '');
  assert.strictEqual(FILTERS.font('Reenie Beanie'), 'Reenie Beanie');
  assert.strictEqual(FILTERS.font("x'); }"), '');
  assert.strictEqual(FILTERS.color(undefined), '');
});

test('checkLayout refuses a field in a dangerous place', () => {
  const bad = [
    '<a href="{{prop_x}}">', "<img src='{{prop_x}}'>", '<div onclick="{{prop_x}}">', '<div {{prop_x}}>',
    '<div style="color:{{prop_x}}">', '<script>{{prop_x}}</script>', '<style>{{prop_x}}</style>',
    '{{{prop_x}}}', '{{& prop_x}}', '{{> other}}', '{{=<% %>=}}', '{{gm_aliases}}',
  ];
  for (const text of bad) {
    assert.strictEqual(checkLayout(text, { file: 'layout.html' }).length, 1, text);
  }
  const good = [
    '<p>{{prop_x}}</p>', '<p title="{{prop_x}}">', '<div style="--accent: {{prop_accent|color}}">',
    '<div class="scrap {{prop_paper|class}}">', '{{{body}}}', '{{#prop_stamp}}<i>{{prop_stamp}}</i>{{/prop_stamp}}',
    '{{^last}}MORE{{/last}}', '<div {{#first}}data-first{{/first}}>',
  ];
  for (const text of good) {
    assert.deepStrictEqual(checkLayout(text, { file: 'layout.html' }), [], text);
  }
});

test('checkLayout reads names, filters and contexts closely', () => {
  const problems = (text) => checkLayout(text, { file: 'f' });
  assert.match(problems('{{secret}}')[0], /reads "secret", which a style may not read \(only prop_ fields and the tool's names\)/);
  assert.strictEqual(problems('{{prop_x|upper}}').length, 1);
  assert.strictEqual(problems('<p>{{prop_x|color}}</p>').length, 1);
  assert.strictEqual(problems('<p class="{{prop_x|color}}">').length, 1);
  assert.strictEqual(problems('<p style="font-family: {{prop_x|font}}">').length, 0);
  assert.strictEqual(problems('<p class="{{prop_x}}">').length, 0);
  assert.strictEqual(problems('<p title={{prop_x}}>').length, 1);
  assert.strictEqual(problems('<A HREF="{{prop_x}}">').length, 1);
  assert.strictEqual(problems('<use xlink:href="{{prop_x}}"/>').length, 1);
  assert.strictEqual(problems('<p title="{{{text}}}">').length, 1);
  assert.strictEqual(problems('<script>{{#first}}x{{/first}}</script>').length, 1);
  assert.strictEqual(problems('<script>x</script><p>{{prop_x}}</p>').length, 0);
  assert.strictEqual(problems('a < b {{prop_x}}').length, 0);
  assert.strictEqual(problems('<!-- {{prop_x}} -->').length, 1);
  // A section must leave the HTML context as it found it, so both of its outcomes agree.
  assert.match(problems('{{#first}}<a href={{/first}}"{{prop_x}}"')[0], /\{\{#first\}\} changes the HTML around it/);
  assert.ok(problems('<div {{^first}}href{{/first}}{{#first}}title{{/first}}="{{prop_x}}">').length > 0);
  assert.strictEqual(problems('{{#first}}x').length, 1);
});

// Layouts where the browser reads the HTML differently from a simple walk: each must be refused.
test('checkLayout refuses what it cannot read the way the browser does', () => {
  const attacks = [
    '<!--><div title="-->" onclick="{{prop_x}}">x</div>',
    '<!---><div title="-->" onclick="{{prop_x}}">x</div>',
    '<!x title="><div onclick={{prop_x}}>">',
    '<?x title="><a href={{prop_x}}>y</a>">',
    '<title><a title="</title><a href={{prop_x}}>x</a>"></title>',
    '<textarea><a title="</textarea><img src=x onerror={{prop_x}}>"></textarea>',
    '<svg><![CDATA[<a title="]]><a href={{prop_x}}>x</a>">]]></svg>',
    '<script>x="<!--<script>";y="</script><p title=\'";{{prop_x}}//\'></p>";</script>',
    '<div {{#first}}onclic{{/first}}k="{{prop_x}}">',
    '<div on{{#first}} {{/first}}click="{{prop_x}}">',
    '<a hr{{#first}} {{/first}}ef="{{prop_x}}">',
    // Each of these is refused by name, whatever follows it.
    ...['xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template', 'math'].map(el => `<${el}><p title="{{prop_x}}"></p></${el}>`),
    '<![CDATA[x]]>',
    '<!DOCTYPE html><p>{{prop_x}}</p>',
    '<!-- a --!><a title="-->" href="{{prop_x}}">',
    '</!<a title="><a href={{prop_x}}>">',
    '<style>a{}<!-- </style> --></style>',
    '<script></scriptx><p title="{{prop_x}}"></script>',
    '<p title/="{{prop_x}}">',
    '<div {{#first}}title="{{/first}}x" onclick="{{prop_x}}">',
  ];
  for (const text of attacks) {
    assert.ok(checkLayout(text, { file: 'f' }).length > 0, text);
  }
  const fine = [
    '<div {{#first}}data-first{{/first}}>',
    '<div {{#first}}data-first{{/first}} class="a">',
    '<div {{#first}}title="{{prop_x}}"{{/first}}>',
    '<p {{^last}}data-more {{/last}}/>',
    '<!-- a note --><p>{{prop_x}}</p>',
    '<script>var a = 1;</script><p>{{prop_x}}</p>',
    '<p title=\'{{prop_x}}\' class=x>',
  ];
  for (const text of fine) {
    assert.deepStrictEqual(checkLayout(text, { file: 'f' }), [], text);
  }
});

test('each refusal says why', () => {
  const why = (text) => checkLayout(text, { file: 'f' })[0];
  assert.match(why('<!-->'), /^f line 1: <!--> is a comment the browser closes at once/);
  assert.match(why('<?x?>'), /processing instruction/);
  assert.match(why('<![CDATA[x]]>'), /CDATA section/);
  assert.match(why('<p>\n<noscript></noscript>'), /^f line 2: <noscript> is an element whose content the safety check cannot read/);
  assert.match(why('<script><!--</script>'), /<!-- is inside <script>/);
  assert.match(why('<div a{{#first}} b{{/first}}>'), /opens inside a tag without a space before it/);
  assert.match(why('<div {{#first}}b{{/first}}c>'), /closes inside a tag without a space, \/ or > after it/);
  assert.match(why('<div {{#first}}b="{{/first}} ">'), /unbalanced quote/);
});

test('a false or empty field skips its section; true prints', () => {
  const view = layoutView({ prop_envelope: false, prop_seal: '', prop_ok: true }, ['prop_envelope', 'prop_seal', 'prop_ok'], {});
  assert.deepStrictEqual(view, { prop_envelope: '', prop_seal: '', prop_ok: 'true' });
  assert.strictEqual(fillLayout('[{{#prop_envelope}}ENVELOPE{{/prop_envelope}}{{#prop_seal}}SEAL{{/prop_seal}}{{#prop_ok}}{{prop_ok}}{{/prop_ok}}]', view), '[true]');
});

test('a problem names the file and line', () => {
  const [problem] = checkLayout('<p>\n<a href="{{prop_x}}">', { file: 'layout.html' });
  assert.ok(problem.startsWith('layout.html line 2: {{prop_x}}'), problem);
});

test('layoutNames lists every name the template reads', () => {
  assert.deepStrictEqual(
    layoutNames('{{title}}{{#prop_a}}{{prop_b|color}}{{{body}}}{{/prop_a}}{{^last}}{{prop_b|color}}{{/last}}'),
    ['title', 'prop_a', 'prop_b|color', 'body', 'last'],
  );
});

test('the tool names and the HTML ones', () => {
  assert.deepStrictEqual(TOOL_NAMES, ['title', 'note_title', 'body', 'text', 'items', 'sheet_number', 'sheet_count', 'first', 'last']);
  assert.deepStrictEqual(TOOL_HTML, ['body', 'text', 'items']);
});

test('partials are never read', () => {
  assert.strictEqual(fillLayout('{{> x}}', {}), '');
});
