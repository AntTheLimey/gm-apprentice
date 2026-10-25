const { test } = require('node:test');
const assert = require('node:assert');
const { localRefs } = require('../../lib/props/links');

const paths = (t, ext = '.html') => localRefs(t, ext).refs.map((r) => r.path);

test('link href, query dropped', () => {
  const r = localRefs('<link rel="stylesheet" href="props.css?v=2">', '.html');
  assert.deepStrictEqual(r.refs, [{ raw: 'props.css?v=2', path: 'props.css' }]);
});

test('srcset candidates, decoded', () => {
  assert.deepStrictEqual(paths('<img srcset="a.png 1x, b%20c.png 2x">'), ['a.png', 'b c.png']);
});

test('anchors, data URIs, schemes, fragments and // are not files', () => {
  assert.deepStrictEqual(paths('<a href="other.html">x</a>'), []);
  assert.deepStrictEqual(paths('<img src="data:image/png;base64,AA">'), []);
  assert.deepStrictEqual(paths('<img src="https://x/y.png"><img src="//x/y.png"><use href="#id"/>'), []);
});

test('rooted references are listed apart', () => {
  const r = localRefs('<img src="/x.png">', '.html');
  assert.deepStrictEqual(r.rooted, ['/x.png']);
  assert.deepStrictEqual(r.refs, []);
});

test('poster, svg image and use, xlink:href', () => {
  assert.deepStrictEqual(paths('<video poster="p.jpg"></video>'), ['p.jpg']);
  assert.deepStrictEqual(paths('<svg><image xlink:href="i.png"/><use href="s.svg#a"/></svg>', '.svg'), ['i.png', 's.svg']);
});

test('url() and @import in <style> and style=""', () => {
  assert.deepStrictEqual(paths('<style>a{background:url("b.png")} @import "m.css";</style><p style="background:url(c.png)">'), ['c.png', 'b.png', 'm.css']);
});

test('CSS files', () => {
  assert.deepStrictEqual(paths("a{background:url('assets/paper-light.jpg')}\n@import \"more.css\";", '.css'), ['assets/paper-light.jpg', 'more.css']);
});
