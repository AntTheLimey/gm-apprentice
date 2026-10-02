const { describe, it } = require('node:test');
const assert = require('node:assert');
const { pcTemplate } = require('../../lib/templates/pc');

const page = { frontmatter: { type: 'pc', name: 'Six' }, displayTitle: 'Six', outputPath: 'pcs/six.html', title: 'Six' };
const noop = () => '';
const cfg = { siteTitle: 'S', footer: '' };
const render = (live) =>
  pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, { publishConfig: { live } });

describe('pcTemplate chatbox gating', () => {
  it('omits the chatbox and its script when inbox is off', () => {
    const html = render({ inbox: false, stats: false });
    assert.ok(!html.includes('id="cr-root"'), 'no chatbox root');
    assert.ok(!html.includes('js/change-request.js'), 'no chatbox script');
  });

  it('omits the chatbox when live is entirely absent', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined, {});
    assert.ok(!html.includes('id="cr-root"'), 'no chatbox root when unconfigured');
  });

  it('emits the chatbox and its script when inbox is on', () => {
    const html = render({ inbox: true, stats: false });
    assert.ok(html.includes('id="cr-root"'), 'chatbox root present');
    assert.ok(html.includes('js/change-request.js'), 'chatbox script present');
  });
});

describe('pcTemplate status-bar gating', () => {
  const liveCtx = (live) => ({
    publishConfig: { live, system: 'gurps-4e' },
    systemStatusPanelHtml: '<div id="probe-status-panel">hp</div>',
    systemLiveData: { vitals: { hp: 10 } },
  });

  it('omits the status panel and live scripts when live stats are off', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined,
      liveCtx({ inbox: false, stats: false }));
    assert.ok(!html.includes('probe-status-panel'), 'no status panel');
    assert.ok(!html.includes('gurps-live.js'), 'no live client script');
  });

  it('emits the status panel and live scripts when live stats are on', () => {
    const html = pcTemplate(page, { html: '', relationships: '' }, [], noop, cfg, {}, undefined,
      liveCtx({ inbox: false, stats: true }));
    assert.ok(html.includes('probe-status-panel'), 'status panel present');
    assert.ok(html.includes('gurps-live.js'), 'live client script present');
  });
});
