const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fourOhFourTemplate } = require('../../lib/templates/four-oh-four');

describe('fourOhFourTemplate', () => {
  const baseConfig = {
    siteTitle: 'Test Campaign',
    four_oh_four: {
      message: 'The stars are not yet right...',
    },
    theme: {
      campaign_image: null,
    },
  };

  it('renders the 404 message', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('The stars are not yet right...'));
  });

  it('includes the genre theme stylesheet when a preset is set', () => {
    const html = fourOhFourTemplate({
      ...baseConfig,
      siteUrl: 'https://example.github.io/my-campaign',
      genrePreset: 'cosmic-horror',
    });
    assert.ok(
      html.includes('href="/my-campaign/css/themes/cosmic-horror.css"'),
      'genre theme link should be present so the 404 matches site theming',
    );
  });

  it('links stylesheets in the same order as every other page (#268)', () => {
    const { baseShell } = require('../../lib/templates/base');
    const sheetOrder = html => [...html.matchAll(/<link rel="stylesheet" href="[^"]*\/(css\/[^"]+)"/g)]
      .map(m => m[1]);
    const notFound = fourOhFourTemplate({ ...baseConfig, genrePreset: 'horror', overridesCss: true });
    const page = baseShell({
      title: 'T', siteTitle: 'S', cssHref: '/css/style.css', navHtml: '', rootHref: '/',
      content: '', footer: '', genrePreset: 'horror', overridesCss: true,
    });
    const expected = ['css/style.css', 'css/themes/horror.css', 'css/theme.css', 'css/overrides.css'];
    assert.deepStrictEqual(sheetOrder(page), expected);
    assert.deepStrictEqual(sheetOrder(notFound), expected);
  });

  it('omits the genre theme link when no preset', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(!html.includes('css/themes/'), 'no genre link without a preset');
  });

  it('includes the site title', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('Test Campaign'));
  });

  it('includes a link back to home', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('index.html'));
    assert.ok(html.includes('Return to Safety'));
  });

  it('uses absolute paths when siteUrl is provided', () => {
    const config = {
      ...baseConfig,
      siteUrl: 'https://example.github.io/my-campaign',
    };
    const html = fourOhFourTemplate(config);
    assert.ok(html.includes('href="/my-campaign/css/style.css"'));
    assert.ok(html.includes('href="/my-campaign/css/theme.css"'));
    assert.ok(html.includes('href="/my-campaign/index.html"'));
  });

  it('uses root paths when no siteUrl', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('href="/css/style.css"'));
    assert.ok(html.includes('href="/index.html"'));
  });

  it('is a valid HTML document', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  it('references theme.css', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('theme.css'));
  });

  it('includes campaign image when provided', () => {
    const config = {
      ...baseConfig,
      theme: { campaign_image: 'images/publish/campaign-header.png' },
    };
    const html = fourOhFourTemplate(config);
    assert.ok(html.includes('src="/images/publish/campaign-header.png"'));
  });

  it('uses absolute path for campaign image with siteUrl', () => {
    const config = {
      ...baseConfig,
      siteUrl: 'https://example.github.io/my-campaign',
      theme: { campaign_image: 'images/campaign-image.svg' },
    };
    const html = fourOhFourTemplate(config);
    assert.ok(html.includes('src="/my-campaign/images/campaign-image.svg"'));
  });

  it('includes generated SVG placeholder when no image', () => {
    const html = fourOhFourTemplate(baseConfig);
    assert.ok(html.includes('four-oh-four-hero'));
  });

  it('escapes HTML in message', () => {
    const config = {
      ...baseConfig,
      four_oh_four: { message: '<script>alert("xss")</script>' },
    };
    const html = fourOhFourTemplate(config);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});
