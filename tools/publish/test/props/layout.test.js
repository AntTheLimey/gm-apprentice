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
  assert.strictEqual(problems('<svg><use xlink:href="{{prop_x}}"/></svg>').length, 1);
  assert.strictEqual(problems('<p title="{{{text}}}">').length, 1);
  assert.strictEqual(problems('<script>{{#first}}x{{/first}}</script>').length, 1);
  assert.strictEqual(problems('<script>x</script><p>{{prop_x}}</p>').length, 0);
  assert.strictEqual(problems('a < b {{prop_x}}').length, 0);
  assert.strictEqual(problems('<!-- {{prop_x}} -->').length, 1);
  // A section must leave the HTML context as it found it, so both of its outcomes agree.
  assert.match(problems('{{#first}}<a href={{/first}}"{{prop_x}}"')[0], /\{\{#first\}\} changes the HTML around it/);
  assert.strictEqual(problems('<div {{^first}}href{{/first}}{{#first}}title{{/first}}="{{prop_x}}">').length, 1);
  assert.strictEqual(problems('{{#first}}x').length, 1);
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
