const { describe, it } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../../lib/templates/pc');

const page = { frontmatter: { type: 'pc', name: 'Six' }, displayTitle: 'Six', outputPath: 'pcs/six.html', title: 'Six' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };
const render = (backend) =>
  pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, { publishConfig: { backend } });

describe('pcTemplate chatbox gating', () => {
  it('omits the chatbox and its script when inbox is off', () => {
    const html = render({ inbox: false, statusBar: false });
    assert.ok(!html.includes('id="cr-root"'), 'no chatbox root');
    assert.ok(!html.includes('js/change-request.js'), 'no chatbox script');
  });

  it('omits the chatbox when backend is entirely absent', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, {});
    assert.ok(!html.includes('id="cr-root"'), 'no chatbox root when unconfigured');
  });

  it('emits the chatbox and its script when inbox is on', () => {
    const html = render({ inbox: true, statusBar: false });
    assert.ok(html.includes('id="cr-root"'), 'chatbox root present');
    assert.ok(html.includes('js/change-request.js'), 'chatbox script present');
  });
});
